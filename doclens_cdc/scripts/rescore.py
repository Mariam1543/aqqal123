"""
Re-score finished MMLongBench-Doc results with a better answer extractor (no new model run).

MMLongBench-Doc scoring has two steps: an LLM extracts a concise answer (and its format) from the
model's answer, then fixed rules compare it with the ground truth. DocLens runs the extraction on
Gemini-2.5-Flash and passes it only the short final answer. With Qwen3-VL-8B doing that step, short
answers are often mis-extracted (e.g. "1" -> "Not answerable", "White, 10 percentage points" kept as
a string although the answer is a list), so correct answers are scored 0.

  --extractor qwen    (default) Qwen on the local vLLM server, given the question, the reasoning AND
                      the final answer, with explicit rules for lists and for "Not answerable"; if it
                      still returns "Not answerable" for an answer that states something, the answer
                      itself is used.
  --extractor gemini  DocLens' official extraction on Gemini-2.5-Flash (needs GEMINI_API_KEY).

The scoring rules are MMLongBench-Doc's own (DocLens' rule_based_eval_score_mmlongbenchdoc). Every
scored answer (final, first sample, each sampled candidate) is re-scored; the old score/extraction
are kept as <prefix>score_v1 / <prefix>extracted_pred_v1, so report_reproduction.py and
analyze_gate.py can run unchanged on the output directory. Re-running skips finished questions.

    python scripts/rescore.py --doclens_root DocLens --results_dir results_qwen/MMLongBenchDoc \
        --out_dir results_qwen_rescored/MMLongBenchDoc --qwen_base_url http://localhost:8000/v1
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent

EXTRACTION_ADDENDUM = """
Additional rules (follow them strictly):
- The analysis is followed by the model's FINAL ANSWER. Extract the answer from the FINAL ANSWER; read the analysis only to understand it.
- Type "Not answerable" only if the FINAL ANSWER itself says that the question cannot be answered from the document. A short final answer such as "1", "Vision" or "3840 x 2160" is an answer: extract it.
- If the FINAL ANSWER contains several items (for example a group and a value, or several names or numbers), give a List, e.g. ['White', '10%'], and use Answer format: List.
- Keep numbers as written in the answer (a percentage stays a percentage); do not add units or words that are not in the answer.
"""

NA_LIKE = re.compile(
    r"not answerable|unanswerable|cannot be (answered|determined|found)|can ?not (be )?(determine|answer|find)"
    r"|not (provided|available|mentioned|shown|present|included|specified|stated)|does not (contain|provide|mention|include|show|specify)"
    r"|no (information|data|such)|unable to|insufficient|fail to answer",
    re.IGNORECASE,
)


def norm(s) -> str:
    return re.sub(r"[\s\"'`.,;:!?()\[\]{}]+", " ", str(s).lower()).strip()


def is_na(s) -> bool:
    return norm(s) in {"not answerable", "unanswerable", "fail to answer"}


def scored_prefixes(rec: dict):
    out = []
    for p in ("final_", "doclens_first_", "final_first_"):
        if f"{p}prediction" in rec and f"{p}score" in rec:
            out.append(p)
    for base in ("doclens_", "final_"):
        i = 1
        while f"{base}cand{i}_prediction" in rec:  # sampled answers (scored here even if never scored before)
            out.append(f"{base}cand{i}_")
            i += 1
    return out


def analysis_for(rec: dict, prefix: str) -> str:
    keys = {
        "final_": ["final_analysis", "doclens_analysis"],
        "doclens_first_": ["doclens_cand1_analysis"],
        "final_first_": ["final_cand1_analysis"],
    }.get(prefix, [f"{prefix}analysis"])
    for k in keys:
        if rec.get(k):
            return str(rec[k])
    return ""


def parse_extraction(text: str):
    text = str(text).replace("```json", "").replace("```", "").strip()
    if "Extracted answer:" not in text:
        return None
    return text.split("Extracted answer:")[1].split("Answer format:")[0].strip()


def load_records(paths):
    best = {}
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if "cdc_error" not in r:
                    best[(r["doc_id"], r["question"], str(r.get("answer", "")))] = r
    return best


class QwenExtractor:
    def __init__(self, call, system_prompt: str):
        self.call = call  # async (system, user) -> text
        self.system = system_prompt + EXTRACTION_ADDENDUM

    async def __call__(self, question: str, analysis: str, prediction: str) -> str:
        if str(prediction).strip() in ("", "Error"):
            return ""
        user = f"\n\nQuestion:{question}\nAnalysis:{analysis}\nFINAL ANSWER: {prediction}\n"
        text = await self.call(self.system, user)
        pred = parse_extraction(text)
        if pred is None:  # unparsable output: score the final answer as written
            return str(prediction).strip()
        if is_na(pred) and not NA_LIKE.search(str(prediction)):
            return str(prediction).strip()  # the answer states something; never turn it into "Not answerable"
        return pred


async def rescore_record(rec: dict, extract, score_fn) -> dict:
    """extract: async (question, analysis, prediction) -> extracted answer.
    score_fn: (ground_truth, extracted, answer_format) -> float."""
    rec = dict(rec)
    cache = {}
    prefixes = scored_prefixes(rec)

    async def one(p):
        pred = rec[f"{p}prediction"]
        key = norm(pred)
        if key not in cache:
            cache[key] = asyncio.ensure_future(extract(rec["question"], analysis_for(rec, p), pred))
        extracted = await cache[key]
        try:
            score = float(score_fn(rec["answer"], extracted, rec.get("answer_format", "Str")))
        except Exception:
            score = 0.0
        return p, extracted, score

    for p, extracted, score in await asyncio.gather(*(one(p) for p in prefixes)):
        if f"{p}score_v1" not in rec:
            rec[f"{p}score_v1"] = rec.get(f"{p}score")
            rec[f"{p}extracted_pred_v1"] = rec.get(f"{p}extracted_pred", "")
        rec[f"{p}score"] = score
        rec[f"{p}extracted_pred"] = extracted
    return rec


async def rescore_file(src: Path, dst: Path, extract, score_fn, tag: str, concurrency: int = 8):
    records = load_records([src])
    done = load_records([dst]) if dst.exists() else {}
    done = {k: r for k, r in done.items() if r.get("rescored") == tag}
    todo = [(k, r) for k, r in records.items() if k not in done]
    sem = asyncio.Semaphore(concurrency)

    async def run(k, r):
        async with sem:
            new = await rescore_record(r, extract, score_fn)
            new["rescored"] = tag
            return k, new

    dst.parent.mkdir(parents=True, exist_ok=True)
    with open(dst, "a", encoding="utf-8") as f:
        for fut in asyncio.as_completed([run(k, r) for k, r in todo]):
            k, new = await fut
            done[k] = new
            f.write(json.dumps(new, ensure_ascii=False, default=str) + "\n")
            f.flush()
    rows = [r for k, r in done.items() if k in records]
    v1 = [r.get("final_score_v1") or 0.0 for r in rows if "final_score" in r]
    v2 = [r["final_score"] for r in rows if "final_score" in r]
    changed = sum(1 for r in rows if (r.get("final_score_v1") or 0.0) != r.get("final_score"))
    if v2:
        print(f"{src.name}: {len(v2)} questions | accuracy {100 * sum(v1) / len(v1):.1f} -> "
              f"{100 * sum(v2) / len(v2):.1f} ({changed} final scores changed)")
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--doclens_root", required=True)
    p.add_argument("--results_dir", required=True, help="Directory with the *.jsonl results")
    p.add_argument("--out_dir", required=True)
    p.add_argument("--extractor", choices=["qwen", "gemini"], default="qwen")
    p.add_argument("--qwen_base_url", default="http://localhost:8000/v1")
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--rpm", type=float, default=0, help="Gemini requests per minute (free keys: ~8)")
    args = p.parse_args()

    sys.path.insert(0, str(Path(args.doclens_root).resolve()))
    sys.path.insert(0, str(PKG_ROOT))
    from prompts.eval_prompts import EXTRACTION_SYSTEM_PROMPT_MMLONG
    from utils import eval_toolkits

    score_fn = eval_toolkits.rule_based_eval_score_mmlongbenchdoc
    if args.extractor == "qwen":
        from cdc.qwen_local import SERVED_MODEL, call_qwen, configure_qwen

        configure_qwen(args.qwen_base_url, max_tokens=512, nav_chunk_pages=0, parallel_requests=args.concurrency)

        async def call(system, user):
            texts, _ = await call_qwen(SERVED_MODEL, [{"type": "text", "text": user}], {
                "system_prompt": system, "temperature": 0, "candidate_num": 1, "max_output_tokens": 512})
            return texts[0]

        extract = QwenExtractor(call, EXTRACTION_SYSTEM_PROMPT_MMLONG)
        tag = "qwen_v2"
    else:
        from cdc.llm_setup import configure_gemini, get_secret

        key = get_secret("GEMINI_API_KEY")
        if not key:
            sys.exit("Set GEMINI_API_KEY (env var or Kaggle secret).")
        configure_gemini(key, rpm=args.rpm, eval_model="gemini-2.5-flash")

        async def extract(question, analysis, prediction):  # DocLens' official extraction, unchanged
            _, _, pred = await eval_toolkits.get_score_for_response_mmlongbenchdoc(
                {"question": question, "answer": "", "answer_format": "Str", "x_prediction": prediction}, "x_")
            return pred

        tag = "gemini"

    async def run_all():
        for src in sorted(Path(args.results_dir).glob("*.jsonl")):
            await rescore_file(src, Path(args.out_dir) / src.name, extract, score_fn, tag, args.concurrency)

    asyncio.run(run_all())


if __name__ == "__main__":
    main()
