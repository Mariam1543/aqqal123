"""Fast metrics (BLEU, chrF, TER, WER, CER, ROUGE) for one model's outputs, run off Kaggle.

Uses the exact refusal filter and metric code of notebooks/03_metrics.ipynb, so numbers match
what that notebook will report. BERTScore and COMET still come from the notebook (GPU).

    python analysis/score_local.py <outputs_dir>/<run_name> results/fast_metrics_<run_name>.json

Directions already in the results file are skipped, so it can be re-run as zips arrive.
"""
import json, re, sys
from pathlib import Path

import jiwer, sacrebleu
from rouge_score import rouge_scorer

HERE = Path(__file__).resolve().parent
_code = [c["source"] for c in json.load(open(HERE.parent / "notebooks" / "03_metrics.ipynb"))["cells"]
         if c["cell_type"] == "code"]
_ns = {"re": re, "sacrebleu": sacrebleu, "jiwer": jiwer, "rouge_scorer": rouge_scorer}
exec(next(c for c in _code if "REFUSAL = [" in c), _ns)
_fast = next(c for c in _code if "def fast_metrics" in c)
exec(_fast[:_fast.index("rows, kept")], _ns)
is_refusal, fast_metrics = _ns["is_refusal"], _ns["fast_metrics"]


def score_run(run_dir, results_path):
    results = json.load(open(results_path)) if Path(results_path).exists() else {}
    for path in sorted(Path(run_dir).glob("*/*.jsonl")):
        key = f"{path.parent.name}/{path.stem}"
        if key in results:
            continue
        rows = [json.loads(l) for l in open(path, encoding="utf-8")]
        use = [r for r in rows if not is_refusal(r["output"])]
        m = fast_metrics([r["output"] for r in use], [r["reference"] for r in use], path.stem.split("-")[1])
        m.update(n_total=len(rows), n_refused=len(rows) - len(use),
                 n_hit_max_tokens=sum(r.get("finish_reason") == "length" for r in rows),
                 prompt_mode=rows[0].get("prompt_mode") if rows else None)
        results[key] = m
        json.dump(results, open(results_path, "w"), indent=1)
        print(f"{key:20s} BLEU {m['bleu']:6.2f}  chrF {m['chrf']:6.2f}  TER {m['ter']:8.1f}  refused {m['n_refused']}",
              flush=True)
    return results


if __name__ == "__main__":
    score_run(sys.argv[1], sys.argv[2])
