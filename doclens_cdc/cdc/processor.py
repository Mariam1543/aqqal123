"""
DocLens + Confidence and Degradation Check (CDC).

    Lens Module (Page Navigator)  ->  CDC stage  ->  ABSTAIN : keep original evidence,
                                                              single answer, no correction
                                                 ->  CORRECT : restore unreliable evidence,
                                                              Answer Sampler (k) + Adjudicator
                                                              with degradation-aware prompts

Modes
  baseline: DocLens' vanilla baseline (backbone reads all pages once; DocLens' main.py --phase_name baseline)
  doclens : the unmodified DocLens end-to-end pipeline
  cdc     : the gated pipeline above
  analyze : computes the CDC report AND runs every path (abstain, correct, doclens) for
            every question, so thresholds can be swept offline (scripts/analyze_results.py)

This module imports DocLens' own packages (`agents`, `utils`), so the DocLens
repository root must be on sys.path (run_cdc.py takes care of it).
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
from tqdm.asyncio import tqdm

from utils import eval_toolkits, generation_utils
from utils.doclens_processor import DocLensProcessor

from .confidence import (
    ABSTAIN,
    CORRECT,
    CDCConfig,
    CDCReport,
    build_report,
    correction_note,
    lens_consistency,
    lens_majority_answer,
    score_page,
)
from .evidence import (
    PageCorrection,
    doc_image_dir,
    load_page,
    render_content,
    resolve_target_pages,
)
from .prompts import (
    CONFIDENCE_JUDGE_SYSTEM_PROMPT,
    DEGRADATION_AWARE_ADJUDICATOR_ADDENDUM,
    DEGRADATION_AWARE_SAMPLER_ADDENDUM,
    insert_before_output_format,
)
from .restoration import restore, to_base64_jpeg


@dataclass
class PathResult:
    prediction: str
    analysis: str
    tokens: int
    seconds: float
    candidates: Optional[List[Dict[str, str]]] = None


def _user_prompt(question: str) -> str:
    return f"""\n\n**Question**: {question}\n\n**Your Output**:"""


class CDCDocLensProcessor(DocLensProcessor):
    def __init__(
        self,
        *args,
        cdc_config: CDCConfig,
        mode: str = "cdc",
        abstain_policy: str = "single_pass",
        abstain_temperature: float = 0.0,
        use_confidence_judge: bool = False,
        keep_original_on_restore: bool = True,
        output_jsonl: Optional[Path] = None,
        evaluate: bool = True,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        if mode not in ("baseline", "doclens", "cdc", "analyze"):
            raise ValueError(f"Unknown mode {mode}")
        if abstain_policy not in ("single_pass", "lens_answer"):
            raise ValueError(f"Unknown abstain policy {abstain_policy}")
        self.cdc = cdc_config
        self.mode = mode
        self.abstain_policy = abstain_policy
        self.abstain_temperature = abstain_temperature
        self.use_confidence_judge = use_confidence_judge
        self.keep_original_on_restore = keep_original_on_restore
        self.output_jsonl = output_jsonl
        self.evaluate = evaluate
        self._write_lock = asyncio.Lock()

        self.correct_sampler_prompt = insert_before_output_format(
            self.answer_sampler.system_prompt, DEGRADATION_AWARE_SAMPLER_ADDENDUM
        )
        self.correct_adjudicator_prompt = insert_before_output_format(
            self.adjudicator.system_prompt, DEGRADATION_AWARE_ADJUDICATOR_ADDENDUM
        )

    # ------------------------------------------------------------------ #
    # CDC stage
    # ------------------------------------------------------------------ #
    def _located_pages(self, data: dict):
        cfg = self.exp_config
        image_dir = doc_image_dir(cfg.work_dir, cfg.dataset_name, data["doc_id"])
        pages = resolve_target_pages(data, cfg.phase2_input_pages, image_dir)
        return image_dir, [load_page(image_dir, p) for p in pages]

    def _score_pages_sync(self, page_evidence):
        scored = page_evidence[: self.cdc.max_pages_scored]
        return [score_page(pe, self.cdc) for pe in scored]

    async def confidence_and_degradation_check(self, data: dict) -> Tuple[CDCReport, int]:
        _, page_evidence = self._located_pages(data)
        loop = asyncio.get_running_loop()
        page_scores = await loop.run_in_executor(None, self._score_pages_sync, page_evidence)
        consistency = lens_consistency(data, self.exp_config.phase1_candidate_num)
        verbal, tokens = None, 0
        if self.use_confidence_judge:
            verbal, tokens = await self._verbal_confidence(data, page_evidence)
        return build_report(page_scores, consistency, verbal, self.cdc), tokens

    async def _verbal_confidence(self, data, page_evidence) -> Tuple[Optional[float], int]:
        """Optional: ask the model to rate legibility/sufficiency (verbalized confidence)."""
        content = render_content(page_evidence[:8], "vanilla")
        content = await generation_utils.resize_contents_images(content, scale_factor=0.5)
        content.append({"type": "text", "text": _user_prompt(data["preprocessed_question"])})
        texts, tokens = await self.answer_sampler.call_llm_with_retry_async(
            content_list=content,
            system_prompt=CONFIDENCE_JUDGE_SYSTEM_PROMPT,
            temperature=0,
            candidate_num=1,
        )
        parsed = self.answer_sampler._parse_response(texts[0], ["legibility", "sufficiency"], "cdc_judge")
        data.update(parsed)
        try:
            leg = float(parsed["cdc_judge_legibility"])
            suf = float(parsed["cdc_judge_sufficiency"])
            return max(0.0, min(1.0, (leg + suf) / 2)), tokens
        except (TypeError, ValueError):
            return None, tokens

    # ------------------------------------------------------------------ #
    # Paths
    # ------------------------------------------------------------------ #
    async def _abstain_path(self, data: dict) -> PathResult:
        """High confidence: keep the original evidence, answer once, no correction/verification."""
        start = time.time()
        k1 = self.exp_config.phase1_candidate_num
        if self.abstain_policy == "lens_answer":
            return PathResult(lens_majority_answer(data, k1), "CDC abstained: Lens answer kept.", 0, 0.0)
        content = await generation_utils.get_doc_content_list_async(
            data=data,
            input_pages=self.exp_config.phase2_input_pages,
            input_mode=self.exp_config.phase2_input_mode,
            exp_config=self.exp_config,
        )
        content.append({"type": "text", "text": _user_prompt(data["preprocessed_question"])})
        texts, tokens = await self.answer_sampler.call_llm_with_retry_async(
            content_list=content,
            system_prompt=self.answer_sampler.system_prompt,
            temperature=self.abstain_temperature,
            candidate_num=1,
        )
        parsed = self.answer_sampler._parse_response(texts[0], ["analysis", "prediction"], "x")
        return PathResult(parsed["x_prediction"], parsed["x_analysis"], tokens, time.time() - start)

    def _build_corrections_sync(self, report: CDCReport, page_evidence) -> Dict[int, PageCorrection]:
        by_page = {pe.page: pe for pe in page_evidence}
        corrections = {}
        for ps in report.low_confidence_pages:
            pe = by_page[ps.page]
            restored_page, restored_crops = None, {}
            if ps.degradation != "ocr_text":  # image itself is degraded -> restore it
                with Image.open(pe.image_path) as img:
                    restored_page = to_base64_jpeg(restore(img, ps.degradation))
                for crop in pe.crop_paths:
                    with Image.open(crop) as c:
                        restored_crops[crop.name] = to_base64_jpeg(restore(c, ps.degradation))
            corrections[ps.page] = PageCorrection(
                note=correction_note(ps),
                restored_image_b64=restored_page,
                restored_crops_b64=restored_crops,
                replace_original=not self.keep_original_on_restore,
            )
        return corrections

    async def _correct_path(self, data: dict, report: CDCReport) -> PathResult:
        """Low confidence: correct unreliable evidence, then the full Reasoning Module."""
        start = time.time()
        _, page_evidence = self._located_pages(data)
        loop = asyncio.get_running_loop()
        corrections = await loop.run_in_executor(
            None, self._build_corrections_sync, report, page_evidence
        )
        question = data["preprocessed_question"]
        content = render_content(page_evidence, self.exp_config.phase2_input_mode, corrections)
        content.append({"type": "text", "text": _user_prompt(question)})
        k = self.exp_config.phase2_candidate_num
        texts, tokens = await self.answer_sampler.call_llm_with_retry_async(
            content_list=content,
            system_prompt=self.correct_sampler_prompt if corrections else self.answer_sampler.system_prompt,
            temperature=self.exp_config.temperature,
            candidate_num=k,
        )
        cands = []
        for i in range(k):
            p = self.answer_sampler._parse_response(texts[i], ["analysis", "prediction"], "x")
            cands.append({"analysis": p["x_analysis"], "prediction": p["x_prediction"]})

        agent_answers = "".join(
            f"Agent {i + 1}\nAnalysis: {c['analysis']}\nAnswer: {c['prediction']}\n"
            for i, c in enumerate(cands)
        )
        reliability = ""
        if corrections:
            flagged = ", ".join(
                f"page {ps.page} ({ps.degradation}, reliability {ps.q_page:.2f})"
                for ps in report.low_confidence_pages
            )
            reliability = f"\n\n**Evidence reliability summary**: flagged pages: {flagged}. All other pages passed the quality check."
        user_prompt = (
            f"""\n\n**Question**: {question}{reliability}\n\n"""
            f"""**List of Agent Analyses and Answers**:\n {agent_answers}\n\n**Your Output**:"""
        )
        adj_texts, adj_tokens = await self.adjudicator.call_llm_with_retry_async(
            content_list=[{"type": "text", "text": user_prompt}],
            system_prompt=self.correct_adjudicator_prompt if corrections else self.adjudicator.system_prompt,
            temperature=0,
            candidate_num=1,
        )
        adj = self.adjudicator._parse_response(adj_texts[0], ["analysis", "prediction"], "x")
        return PathResult(
            adj["x_prediction"], adj["x_analysis"], tokens + adj_tokens, time.time() - start, cands
        )

    async def _doclens_path(self, data: dict) -> PathResult:
        """Unmodified DocLens Reasoning Module on the original evidence."""
        start = time.time()
        d = dict(data)
        d, t1 = await self.answer_sampler.process(d)
        d, t2 = await self.adjudicator.process(d)
        k = self.exp_config.phase2_candidate_num
        cands = [
            {"analysis": d.get(f"cand{i}_analysis", ""), "prediction": d.get(f"cand{i}_prediction", "")}
            for i in range(1, k + 1)
        ]
        return PathResult(
            d.get("adjudicator_prediction", ""), d.get("adjudicator_analysis", ""), t1 + t2,
            time.time() - start, cands,
        )

    @staticmethod
    def _store(data: dict, prefix: str, res: PathResult) -> None:
        data[f"{prefix}prediction"] = res.prediction
        data[f"{prefix}analysis"] = res.analysis
        data[f"{prefix}tokens"] = res.tokens
        data[f"{prefix}time_sec"] = res.seconds
        if res.candidates:
            for i, c in enumerate(res.candidates, 1):
                data[f"{prefix}cand{i}_prediction"] = c["prediction"]
            # first sampled candidate = the answer before any verification/adjudication
            data[f"{prefix}first_prediction"] = res.candidates[0]["prediction"]

    # ------------------------------------------------------------------ #
    # Main per-question pipeline
    # ------------------------------------------------------------------ #
    async def process_single_document(self, data: Dict[str, Any]) -> Dict[str, Any]:
        data["preprocessed_question"] = re.sub(
            r"page\s+(\d+)",
            r"the page with printed page number \1",
            data["question"].strip(),
            flags=re.IGNORECASE,
        )
        data["cdc_mode"] = self.mode

        if self.mode == "baseline":
            # DocLens' vanilla baseline: the backbone reads every page (screenshot + OCR) once.
            start = time.time()
            d, tokens = await self.vanilla_reader.process(dict(data))
            data["final_prediction"] = d.get("cand1_prediction", "")
            data["final_analysis"] = d.get("cand1_analysis", "")
            data["final_tokens"] = tokens
            data["final_time_sec"] = time.time() - start
            if self.evaluate and "answer" in data:
                await self._score(data, ["final_"])
            return data

        # Lens Module
        start = time.time()
        data, lens_tokens = await self.page_navigator.process(data)
        data["lens_tokens"] = lens_tokens
        data["lens_time_sec"] = time.time() - start
        data["lens_prediction"] = lens_majority_answer(data, self.exp_config.phase1_candidate_num)
        score_prefixes = []

        if self.mode == "doclens":
            res = await self._doclens_path(data)
            self._store(data, "doclens_", res)
            data["final_prediction"] = res.prediction
            data["final_tokens"] = lens_tokens + res.tokens
            score_prefixes = ["final_", "doclens_first_"]
        else:
            # Confidence and Degradation Check
            start = time.time()
            report, judge_tokens = await self.confidence_and_degradation_check(data)
            data["cdc_time_sec"] = time.time() - start
            data["cdc_judge_tokens"] = judge_tokens
            data["cdc_confidence"] = report.confidence
            data["cdc_decision"] = report.decision
            data["cdc_report"] = report.summary()

            if self.mode == "cdc":
                if report.decision == ABSTAIN:
                    res = await self._abstain_path(data)
                    self._store(data, "abstain_", res)
                else:
                    res = await self._correct_path(data, report)
                    self._store(data, "correct_", res)
                data["final_prediction"] = res.prediction
                data["final_tokens"] = lens_tokens + judge_tokens + res.tokens
                score_prefixes = ["final_"]
            else:  # analyze: run every path so any threshold can be simulated offline
                abstain, correct, doclens = await asyncio.gather(
                    self._abstain_path(data),
                    self._correct_path(data, report),
                    self._doclens_path(data),
                )
                self._store(data, "abstain_", abstain)
                self._store(data, "correct_", correct)
                self._store(data, "doclens_", doclens)
                chosen = abstain if report.decision == ABSTAIN else correct
                data["final_prediction"] = chosen.prediction
                data["final_tokens"] = lens_tokens + judge_tokens + chosen.tokens
                score_prefixes = [
                    "final_", "abstain_", "correct_", "doclens_", "doclens_first_",
                    "correct_first_", "lens_",
                ]

        if self.evaluate and "answer" in data:
            await self._score(data, score_prefixes)
        return data

    async def _score(self, data: dict, prefixes: List[str]) -> None:
        """Score each prefix with DocLens' own evaluation protocol for the dataset."""
        name = self.exp_config.dataset_name
        for prefix in prefixes:
            if f"{prefix}prediction" not in data:
                continue
            try:
                extracted = ""
                if name == "MMLongBenchDoc":
                    score, _, extracted = await eval_toolkits.get_score_for_response_mmlongbenchdoc(data, prefix)
                elif name == "LongDocURL":
                    score, _, extracted = await eval_toolkits.get_score_for_response_longdocurl(data, prefix)
                elif name == "PaperTab":
                    score, _ = await eval_toolkits.get_score_for_response_papertab(data, prefix)
                else:
                    score, _ = await eval_toolkits.get_score_for_response(data, prefix)
                data[f"{prefix}score"] = float(score)
                data[f"{prefix}extracted_pred"] = extracted
            except Exception as e:  # DocLens' extractors raise on malformed judge output
                data[f"{prefix}score"] = 0.0
                data[f"{prefix}score_error"] = repr(e)

    # ------------------------------------------------------------------ #
    # Batch processing with checkpointing (Kaggle sessions can be interrupted)
    # ------------------------------------------------------------------ #
    @staticmethod
    def sample_key(data: dict) -> str:
        return f"{data['doc_id']}||{data['question']}||{data.get('answer', '')}"

    async def process_documents_batch(self, data_list, max_concurrent: int = 4):
        done = {}
        if self.output_jsonl and self.output_jsonl.exists():
            for line in self.output_jsonl.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    rec = json.loads(line)
                    if "cdc_error" not in rec:
                        done[self.sample_key(rec)] = rec
            print(f"Resuming: {len(done)} questions already finished in {self.output_jsonl}")
        todo = [d for d in data_list if self.sample_key(d) not in done]
        results = list(done.values())
        semaphore = asyncio.Semaphore(max_concurrent)

        async def run(doc):
            async with semaphore:
                try:
                    return await self.process_single_document(doc)
                except Exception as e:
                    doc["cdc_error"] = f"{e!r}\n{traceback.format_exc()}"
                    return doc

        tasks = [asyncio.create_task(run(d)) for d in todo]
        with tqdm(total=len(tasks), desc=f"DocLens[{self.mode}]") as pbar:
            for fut in asyncio.as_completed(tasks):
                res = await fut
                results.append(res)
                if self.output_jsonl:
                    async with self._write_lock:
                        with open(self.output_jsonl, "a", encoding="utf-8") as f:
                            f.write(json.dumps(res, ensure_ascii=False, default=str) + "\n")
                ok = [r for r in results if "final_score" in r]
                postfix = {"errors": sum("cdc_error" in r for r in results)}
                if ok:
                    postfix["acc"] = f"{np.mean([r['final_score'] for r in ok]):.3f}"
                decided = [r for r in results if "cdc_decision" in r]
                if decided:
                    postfix["abstain"] = f"{np.mean([r['cdc_decision'] == ABSTAIN for r in decided]):.2f}"
                pbar.set_postfix(**postfix)
                pbar.update(1)
        return results
