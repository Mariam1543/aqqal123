"""
Offline tests: no API key or GPU needed. Tests marked `requires_doclens` import
the upstream DocLens code (set DOCLENS_ROOT) and replace every LLM call by a fake.
"""

import asyncio
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from cdc.confidence import (
    ABSTAIN,
    CORRECT,
    CDCConfig,
    build_report,
    lens_consistency,
    lens_majority_answer,
    score_page,
)
from cdc.degradation import degrade
from cdc.evidence import PageCorrection, load_page, render_content
from cdc.quality import QualityThresholds, assess_image, text_features, text_reliability
from cdc.synthetic import corrupt_text, make_page
from conftest import PKG_ROOT, requires_doclens

CLEAN_MD = (
    "# Annual Report 2021\n\nThe revenue increased significantly during fiscal year 2021 compared "
    "with the previous quarter. Operating margin improved to 12.5% because of lower costs, while "
    "international sales grew strongly in emerging markets. The board approved a dividend of $0.45 "
    "per share and total assets reached $1,450.2 million.\n"
)


def _stored(img):
    """DocLens stores pages as JPEG (pymupdf default quality)."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


@pytest.fixture(scope="module")
def page():
    return make_page(seed=3)


# --------------------------------------------------------------------------- #
# Quality scoring
# --------------------------------------------------------------------------- #
def test_clean_page_is_reliable(page):
    a = assess_image(_stored(page), QualityThresholds())
    assert a.degradation == "clean"
    assert a.reliability > 0.8


@pytest.mark.parametrize(
    "kind,expected",
    [("blur", "blur"), ("lowres", "blur"), ("noise", "noise"), ("jpeg", "jpeg"), ("fade", "fade"), ("mixed", "jpeg")],
)
def test_severe_degradation_detected_and_classified(page, kind, expected):
    a = assess_image(_stored(degrade(page, kind, 3, seed=1)), QualityThresholds())
    assert a.reliability < 0.3, (kind, a)
    assert a.degradation == expected


@pytest.mark.parametrize("kind", ["blur", "noise", "jpeg", "lowres", "fade"])
def test_reliability_decreases_with_severity(page, kind):
    th = QualityThresholds()
    rel = [assess_image(_stored(degrade(page, kind, s, seed=1)), th).reliability for s in (1, 2, 3)]
    assert rel[0] >= rel[1] - 1e-6 >= rel[2] - 2e-6, rel


def test_text_reliability_drops_with_ocr_corruption():
    th = QualityThresholds()
    q = [text_reliability(text_features(corrupt_text(CLEAN_MD, r, 1)), th) for r in (0.0, 0.1, 0.3)]
    assert q[0] > 0.9 and q[2] < 0.2 and q[0] >= q[1] >= q[2]


def test_dollar_amounts_are_not_stripped_as_latex():
    f = text_features("Revenue was $1,200 in 2020 and $1,450 in 2021 per the report.")
    assert f["n_tokens"] >= 10 and f["wordlike"] > 0.9


def test_cjk_text_counts_as_wordlike():
    f = text_features("统计年鉴 国内生产总值 增长 8.1% 二零二一年 各省 数据 汇总 表格 说明")
    assert f["wordlike"] > 0.9


def test_empty_ocr_on_inked_page_is_unreliable():
    f = text_features("")
    assert text_reliability(f, QualityThresholds(), ink_ratio=0.1) == pytest.approx(0.2)
    assert text_reliability(f, QualityThresholds(), ink_ratio=0.0) is None


# --------------------------------------------------------------------------- #
# Lens consistency and the gate
# --------------------------------------------------------------------------- #
def test_lens_consistency_and_majority():
    data = {
        "pgnav_cand1_prediction": "42%", "pgnav_cand1_located_pages": "[1, 2]",
        "pgnav_cand2_prediction": "42 %", "pgnav_cand2_located_pages": "[2]",
        "pgnav_cand3_prediction": "17", "pgnav_cand3_located_pages": "[2, 3]",
    }
    c = lens_consistency(data, 3)
    assert c["answer_agreement"] == pytest.approx(1 / 3)  # "42%" and "42 %" normalise differently
    assert 0 < c["page_agreement"] < 1
    assert lens_majority_answer({"pgnav_cand1_prediction": "A", "pgnav_cand2_prediction": "B",
                                 "pgnav_cand3_prediction": "B"}, 3) == "B"
    single = lens_consistency({"pgnav_cand1_prediction": "x", "pgnav_cand1_located_pages": "[1]"}, 1)
    assert single["consistency"] is None


def _doc(tmp_path, kinds):
    """Fake DocLens document: pages + MinerU outputs (one figure crop per page)."""
    image_dir = tmp_path / "data" / "MMLongBenchDoc" / "documents" / "doc1"
    image_dir.mkdir(parents=True)
    for i, (kind, sev) in enumerate(kinds, start=1):
        img = degrade(make_page(seed=i), kind, sev, seed=i)
        img.save(image_dir / f"{i}.jpeg", format="JPEG", quality=95)
        mineru = image_dir / f"MinerU_Page{i}"
        (mineru / "images").mkdir(parents=True)
        md = CLEAN_MD if kind == "clean" else corrupt_text(CLEAN_MD, 0.3, i)
        (mineru / f"{i}.md").write_text(md + "\n![](images/fig.jpg)\n")
        img.crop((150, 1250, 1500, 2000)).save(mineru / "images" / "fig.jpg", format="JPEG", quality=95)
    return image_dir


def test_gate_abstains_on_clean_and_corrects_degraded(tmp_path):
    image_dir = _doc(tmp_path, [("clean", 0), ("noise", 3)])
    cfg = CDCConfig()
    clean_score = score_page(load_page(image_dir, 1), cfg)
    noisy_score = score_page(load_page(image_dir, 2), cfg)
    assert not clean_score.needs_correction and clean_score.q_page > 0.8
    assert noisy_score.needs_correction and noisy_score.degradation == "noise"

    agree = {"consistency": 1.0, "answer_agreement": 1.0, "page_agreement": 1.0}
    assert build_report([clean_score], agree, None, cfg).decision == ABSTAIN
    report = build_report([clean_score, noisy_score], agree, None, cfg)
    assert report.decision == CORRECT
    assert [p.page for p in report.low_confidence_pages] == [2]
    # Clean evidence + disagreeing Lens candidates -> still routed to correction.
    disagree = {"consistency": 0.0, "answer_agreement": 0.0, "page_agreement": 0.0}
    assert build_report([clean_score], disagree, None, cfg).decision == CORRECT


def test_render_inserts_note_and_restored_copy_only_for_flagged_pages(tmp_path):
    image_dir = _doc(tmp_path, [("clean", 0), ("blur", 3)])
    pages = [load_page(image_dir, 1), load_page(image_dir, 2)]
    corr = {2: PageCorrection(note="NOTE-2", restored_image_b64="UkVTVE9SRUQ=")}
    content = render_content(pages, "use_element_localizer", corr)
    texts = [c["text"] for c in content if c["type"] == "text"]
    assert sum("NOTE-2" in t for t in texts) == 1
    assert any("Restored screenshot of page 2" in t for t in texts)
    assert not any("Restored screenshot of page 1" in t for t in texts)
    assert sum(c["type"] == "image" for c in content) == 5  # 2 pages + 1 restored + 2 crops


# --------------------------------------------------------------------------- #
# Integration with the upstream DocLens code (fake LLM)
# --------------------------------------------------------------------------- #
@requires_doclens
def test_render_matches_doclens_content_list(tmp_path):
    from utils import config, generation_utils

    _doc(tmp_path, [("clean", 0), ("jpeg", 2)])
    cfg = config.ExpConfig(work_dir=tmp_path, model_name="gemini-2.5-flash")
    data = {"doc_id": "doc1.pdf", "pgnav_all_located_pages": "[1, 2]"}
    for mode in ("use_element_localizer", "use_ocr"):
        upstream = asyncio.run(generation_utils.get_doc_content_list_async(
            data=data, input_pages="pgnav_all_located_pages", input_mode=mode, exp_config=cfg))
        ours = render_content([load_page(tmp_path / "data/MMLongBenchDoc/documents/doc1", p) for p in (1, 2)], mode)
        assert ours == upstream


def _make_processor(tmp_path, mode, calls, monkeypatch, **kw):
    from agents import adjudicator_agent, answer_sampler_agent, base_agent, page_navigator_agent, vanilla_agent
    from prompts.agent_prompts import (ADJUDICATOR_SYSTEM_PROMPT, ANSWER_SAMPLER_SYSTEM_PROMPT,
                                       PAGE_NAVIGATOR_SYSTEM_PROMPT, VANILLA_READER_SYSTEM_PROMPT)
    from utils import config, eval_toolkits

    from cdc.processor import CDCDocLensProcessor

    async def fake_llm(self, content_list, system_prompt, temperature, candidate_num):
        calls.append({"agent": type(self).__name__, "system": system_prompt, "content": content_list,
                      "k": candidate_num})
        if system_prompt == PAGE_NAVIGATOR_SYSTEM_PROMPT:
            out = {"analysis": "found", "located_pages": "[1, 2]", "prediction": "42"}
        else:
            out = {"analysis": "read the table", "prediction": "42"}
        return [json.dumps(out)] * candidate_num, 100 * candidate_num

    async def fake_score(sample, prefix):
        pred = sample[f"{prefix}prediction"]
        return (1.0 if pred == sample["answer"] else 0.0), "", pred

    monkeypatch.setattr(base_agent.BaseAgent, "call_llm_with_retry_async", fake_llm)
    monkeypatch.setattr(eval_toolkits, "get_score_for_response_mmlongbenchdoc", fake_score)

    cfg = config.ExpConfig(work_dir=tmp_path, model_name="gemini-2.5-flash", phase1_candidate_num=2,
                           phase2_candidate_num=2)
    mk = lambda cls, prompt: cls(model_name="gemini-2.5-flash", system_prompt=prompt, exp_config=cfg)
    return CDCDocLensProcessor(
        exp_config=cfg,
        page_navigator=mk(page_navigator_agent.PageNavigator, PAGE_NAVIGATOR_SYSTEM_PROMPT),
        answer_sampler=mk(answer_sampler_agent.AnswerSampler, ANSWER_SAMPLER_SYSTEM_PROMPT),
        adjudicator=mk(adjudicator_agent.Adjudicator, ADJUDICATOR_SYSTEM_PROMPT),
        vanilla_reader=mk(vanilla_agent.VanillaAgent, VANILLA_READER_SYSTEM_PROMPT),
        cdc_config=CDCConfig(), mode=mode, **kw,
    )


def _sample():
    return {"doc_id": "doc1.pdf", "question": "What is the value on page 2?", "answer": "42",
            "answer_format": "Str", "evidence_pages": "[2]"}


@requires_doclens
def test_cdc_mode_abstains_on_clean_document(tmp_path, monkeypatch):
    _doc(tmp_path, [("clean", 0), ("clean", 0)])
    calls = []
    proc = _make_processor(tmp_path, "cdc", calls, monkeypatch)
    out = asyncio.run(proc.process_single_document(_sample()))
    assert out["cdc_decision"] == ABSTAIN
    assert out["final_prediction"] == "42" and out["final_score"] == 1.0
    reasoning_calls = calls[1:]
    assert len(reasoning_calls) == 1 and reasoning_calls[0]["k"] == 1  # no sampling, no adjudication
    assert not any("RELIABILITY NOTE" in c.get("text", "") for c in reasoning_calls[0]["content"])


@requires_doclens
def test_cdc_mode_corrects_degraded_document(tmp_path, monkeypatch):
    _doc(tmp_path, [("clean", 0), ("noise", 3)])
    calls = []
    proc = _make_processor(tmp_path, "cdc", calls, monkeypatch)
    out = asyncio.run(proc.process_single_document(_sample()))
    assert out["cdc_decision"] == CORRECT
    sampler, adjudicator = calls[1], calls[2]
    assert sampler["k"] == 2 and "Degraded-evidence protocol" in sampler["system"]
    texts = [c["text"] for c in sampler["content"] if c["type"] == "text"]
    assert any("Restored screenshot of page 2" in t for t in texts)
    assert sum("RELIABILITY NOTE" in t for t in texts) == 1
    assert "flagged pages: page 2" in adjudicator["content"][0]["text"]
    assert out["final_tokens"] == 200 + 200 + 100  # lens(k=2) + sampler(k=2) + adjudicator


@requires_doclens
def test_analyze_and_doclens_modes_and_batch_resume(tmp_path, monkeypatch):
    _doc(tmp_path, [("clean", 0), ("blur", 3)])
    calls = []
    out_file = tmp_path / "res.jsonl"
    proc = _make_processor(tmp_path, "analyze", calls, monkeypatch, output_jsonl=out_file)
    res = asyncio.run(proc.process_documents_batch([_sample()], max_concurrent=2))
    r = res[0]
    for prefix in ("final_", "abstain_", "correct_", "doclens_", "doclens_first_", "correct_first_", "lens_"):
        assert r[f"{prefix}score"] == 1.0, prefix
    n_calls = len(calls)
    asyncio.run(proc.process_documents_batch([_sample()], max_concurrent=2))
    assert len(calls) == n_calls  # resumed from the JSONL, nothing recomputed

    calls.clear()
    proc = _make_processor(tmp_path, "doclens", calls, monkeypatch)
    r = asyncio.run(proc.process_single_document(_sample()))
    assert "cdc_decision" not in r and r["final_prediction"] == "42"
    assert [c["agent"] for c in calls] == ["PageNavigator", "AnswerSampler", "Adjudicator"]

    report_dir = tmp_path / "report"
    subprocess.run([sys.executable, str(PKG_ROOT / "scripts/analyze_results.py"), str(out_file),
                    "--out_dir", str(report_dir), "--dev_frac", "0"], check=True, capture_output=True)
    assert "DocLens" in (report_dir / "report.md").read_text()


def test_calibration_script(tmp_path):
    root = tmp_path / "variants"
    for v, (kind, sev) in {"clean": ("clean", 0), "blur_s2": ("blur", 2), "noise_s2": ("noise", 2)}.items():
        d = root / v / "data" / "MMLongBenchDoc" / "documents" / "docA"
        d.mkdir(parents=True)
        for i in (1, 2):
            degrade(make_page(seed=i), kind, sev, seed=i).save(d / f"{i}.jpeg", quality=95)
    out = tmp_path / "calibration.json"
    subprocess.run([sys.executable, str(PKG_ROOT / "scripts/calibrate_cdc.py"), "--variants_root", str(root),
                    "--variants", "blur_s2", "noise_s2", "--out", str(out)], check=True, capture_output=True)
    cal = json.loads(out.read_text())
    assert cal["thresholds"]["blur_mid"] != QualityThresholds().blur_mid
    assert cal["report"]["heuristic_detection"]["clean"]["flag_rate"] == 0.0
    assert cal["report"]["heuristic_detection"]["noise_s2"]["flag_rate"] == 1.0


@requires_doclens
def test_run_cdc_cli_with_fake_gemini(tmp_path, monkeypatch):
    """Full CLI path: API-key client injection, rate limiter, DocLens' Gemini wrapper and scorer."""
    from types import SimpleNamespace

    from google import genai

    _doc(tmp_path, [("clean", 0), ("mixed", 3)])
    samples = tmp_path / "samples.json"
    samples.write_text(json.dumps([_sample()]))
    seen_models = []

    class FakeModels:
        async def generate_content(self, model, contents, config):
            seen_models.append(model)
            sys_prompt = config.system_instruction or ""
            if "located_pages" in sys_prompt:
                text = json.dumps({"analysis": "a", "located_pages": "[1, 2]", "prediction": "42"})
            elif "Extracted answer" in sys_prompt or "extract" in sys_prompt.lower():
                text = "Extracted answer: 42\nAnswer format: String"
            else:
                text = json.dumps({"analysis": "a", "prediction": "42"})
            cand = SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(text=text)]))
            return SimpleNamespace(candidates=[cand] * (config.candidate_count or 1),
                                   usage_metadata=SimpleNamespace(total_token_count=10))

    class FakeClient:
        def __init__(self, api_key=None, **kw):
            assert api_key == "test-key"
            self.aio = SimpleNamespace(models=FakeModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    out = tmp_path / "out.jsonl"
    argv = ["run_cdc.py", "--doclens_root", str(Path(__import__("os").environ["DOCLENS_ROOT"])),
            "--data_root", str(tmp_path), "--samples", str(samples), "--mode", "analyze",
            "--output", str(out), "--rpm", "6000", "--eval_model", "judge-model"]
    monkeypatch.setattr(sys, "argv", argv)
    import importlib.util

    spec = importlib.util.spec_from_file_location("run_cdc", PKG_ROOT / "run_cdc.py")
    run_cdc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(run_cdc)
    asyncio.run(run_cdc.main())

    rec = json.loads(out.read_text().splitlines()[-1])
    assert "cdc_error" not in rec, rec.get("cdc_error")
    assert rec["cdc_decision"] == CORRECT and rec["final_score"] == 1.0 and rec["doclens_score"] == 1.0
    assert "judge-model" in seen_models and "gemini-2.5-flash-lite" in seen_models


@requires_doclens
@pytest.mark.parametrize("mode,expect_ocr", [("vanilla", False), ("vanilla_ocr", True)])
def test_single_reader_baselines_read_every_page(tmp_path, monkeypatch, mode, expect_ocr):
    """Table 1 baselines: screenshots only (vanilla) or screenshots + OCR (DocLens' --phase_name baseline)."""
    _doc(tmp_path, [("clean", 0), ("clean", 0)])
    calls = []
    proc = _make_processor(tmp_path, mode, calls, monkeypatch)
    r = asyncio.run(proc.process_single_document(_sample()))
    assert [c["agent"] for c in calls] == ["VanillaAgent"]
    content = calls[0]["content"]
    assert sum(c["type"] == "image" for c in content) == 2  # every page, no navigation, no crops
    assert any("OCR of page" in c.get("text", "") for c in content) == expect_ocr
    assert calls[0]["k"] == 1
    assert r["final_prediction"] == "42" and r["final_score"] == 1.0
    assert "lens_tokens" not in r


@requires_doclens
def test_ablation_modes_follow_the_paper(tmp_path, monkeypatch):
    _doc(tmp_path, [("clean", 0), ("clean", 0), ("clean", 0)])

    # w/o Lens Module: Reasoning Module (k samples + adjudicator) on all pages, screenshot + OCR
    calls = []
    proc = _make_processor(tmp_path, "no_lens", calls, monkeypatch)
    asyncio.run(proc.process_single_document(_sample()))
    assert [c["agent"] for c in calls] == ["AnswerSampler", "Adjudicator"]
    texts = [c["text"] for c in calls[0]["content"] if c["type"] == "text"]
    assert sum("OCR of page" in t for t in texts) == 3 and calls[0]["k"] == 2

    # w/o Reasoning Module: Lens Module, then one answer on the localized evidence
    calls = []
    proc = _make_processor(tmp_path, "no_reasoning", calls, monkeypatch)
    r = asyncio.run(proc.process_single_document(_sample()))
    assert [c["agent"] for c in calls] == ["PageNavigator", "AnswerSampler"]
    assert calls[1]["k"] == 1 and r["final_score"] == 1.0

    # Oracle: Reasoning Module on the annotated evidence pages only (page 2 in _sample)
    calls = []
    proc = _make_processor(tmp_path, "oracle", calls, monkeypatch)
    asyncio.run(proc.process_single_document(_sample()))
    assert [c["agent"] for c in calls] == ["AnswerSampler", "Adjudicator"]
    texts = [c["text"] for c in calls[0]["content"] if c["type"] == "text"]
    assert [t for t in texts if "Screenshot of page" in t] == ["---- Screenshot of page 2 ----\n"]


def test_paper_common_sense_rule_is_inserted_once():
    from cdc.prompts import with_paper_common_sense_rule

    prompt = "## Role:\nx\n## Follow these instructions carefully:\n- a\n## Input Format\ny\n## Output Format:\nz"
    out = with_paper_common_sense_rule(prompt)
    assert out.count("Rule of Common Sense") == 1
    assert out.index("Rule of Common Sense") < out.index("## Input Format")
    assert with_paper_common_sense_rule(out) == out


def test_experiment_registry_matches_paper_numbers():
    sys.path.insert(0, str(PKG_ROOT))
    from reproduction.experiments import EXPERIMENTS, run_args, substitute

    paper = json.loads((PKG_ROOT / "reproduction" / "paper_numbers.json").read_text())
    for key, exp in EXPERIMENTS.items():
        assert key in paper["MMLongBenchDoc"], key  # every runnable experiment has a paper number
        assert exp["k1"] in (1, 2, 8) and exp["k2"] in (2, 8)
    assert EXPERIMENTS["pro_doclens"]["navigator"] == "gemini-2.5-pro"  # main result: Pro navigator
    assert "--phase1_input_mode vanilla" in run_args(EXPERIMENTS["pro_no_ocr"])
    sub = substitute(EXPERIMENTS["pro_nav_flash"], {"gemini-2.5-pro": "new-pro"})
    assert sub["model"] == "new-pro" and sub["navigator"] == "gemini-2.5-flash"


def test_reproduction_report_against_paper(tmp_path):
    rows = [
        # answerable, single page, table, correct; navigator found the page plus one extra
        {"doc_id": "a", "question": "q1", "answer": "5", "final_score": 1.0, "final_extracted_pred": "5",
         "evidence_pages": "[1]", "evidence_sources": "['Table']", "pgnav_all_located_pages": "[1, 2]",
         "doc_type": "Financial report", "model_name": "m"},
        # answerable, chart + text, wrong; navigator missed one of two pages
        {"doc_id": "a", "question": "q2", "answer": "7", "final_score": 0.0, "final_extracted_pred": "Not answerable",
         "evidence_pages": "[1, 2]", "evidence_sources": "['Chart', 'Pure-text (Plain-text)']",
         "pgnav_all_located_pages": "[2]", "doc_type": "Financial report", "model_name": "m"},
        # unanswerable, correctly abstained
        {"doc_id": "a", "question": "q3", "answer": "Not answerable", "final_score": 1.0,
         "final_extracted_pred": "Not answerable", "evidence_pages": "[]", "evidence_sources": "[]",
         "pgnav_all_located_pages": "[]", "doc_type": "Academic paper", "model_name": "m"},
        {"doc_id": "a", "question": "q4", "answer": "1", "cdc_error": "boom"},
    ]
    results = tmp_path / "results"
    results.mkdir()
    (results / "pro_doclens.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    out = tmp_path / "report.md"
    subprocess.run([sys.executable, str(PKG_ROOT / "scripts/report_reproduction.py"), "--results_dir", str(results),
                    "--expected_questions", "4", "--out", str(out)], check=True, capture_output=True)

    sys.path.insert(0, str(PKG_ROOT / "scripts"))
    from report_reproduction import domain_metrics, metrics

    m = metrics(rows, "MMLongBenchDoc")
    assert m["n"] == 3 and m["ALL"] == pytest.approx(2 / 3)
    assert m["TAB"] == 1.0 and m["CHA"] == 0.0 and m["TXT"] == 0.0 and m["FIG"] is None
    assert m["UNA"] == 1.0 and m["ANS"] == 0.5
    assert m["F1"] == pytest.approx(2 / 3)  # recall 1/2, precision 1/1
    assert m["Recall"] == pytest.approx(0.75) and m["Prec"] == pytest.approx(0.75) and m["Pages"] == 1.0
    d = domain_metrics(rows)
    assert d["Financial"] == 0.5 and d["Academic"] == 1.0 and d["Brochure"] is None

    text = out.read_text()
    assert "| `pro_doclens` | ours |" in text and "| | paper |" in text
    assert "-0.9" in text and "+27.8" in text and "-2.5" in text  # ALL 66.7-67.6, UNA 100-72.2, Pages 1.0-3.5
    assert "1 failed" in text and "Per-domain accuracy" in text
