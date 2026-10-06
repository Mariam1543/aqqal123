"""
Reproduction report: DocLens' results in the metrics of the paper's tables.

For MMLongBench-Doc this follows the benchmark's official `eval_acc_and_f1` /
`show_results` (MMLongBench-Doc repository): overall accuracy, generalized F1,
and accuracy by evidence source (TXT, LAY, CHA, TAB, IMG) and by number of
evidence pages (SIN, MUL, UNA). Other datasets report accuracy.

    python scripts/report_reproduction.py \
        --run "Gemini-2.5-Pro (vanilla)=results/baseline.jsonl" \
        --run "Gemini-2.5-Pro + DocLens=results/doclens.jsonl" \
        --expected_questions 1091 --paper paper_numbers.json --out results/reproduction.md

`--paper` is an optional JSON you fill in from the paper's table, e.g.
    {"Gemini-2.5-Pro + DocLens": {"Acc": 0.0, "F1": 0.0, "UNA": 0.0}}
(numbers in percent). The report then prints the difference to the paper.
"""

import argparse
import json
from ast import literal_eval
from pathlib import Path

NA = "Not answerable"
SOURCES = {
    "TXT": "Pure-text (Plain-text)",
    "LAY": "Generalized-text (Layout)",
    "CHA": "Chart",
    "TAB": "Table",
    "IMG": "Figure",
}
COLUMNS = ["n", "Acc", "F1", "TXT", "LAY", "CHA", "TAB", "IMG", "SIN", "MUL", "UNA"]


def load(path):
    rows = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            rows[(r["doc_id"], r["question"], str(r.get("answer", "")))] = r
    return list(rows.values())


def _list(value):
    if isinstance(value, list):
        return value
    try:
        out = literal_eval(str(value))
        return out if isinstance(out, list) else [out]
    except Exception:
        return []


def mmlongbench_metrics(rows):
    """Port of MMLongBench-Doc's eval_acc_and_f1 + show_results breakdown."""
    rows = [r for r in rows if "final_score" in r]
    if not rows:
        return {}
    score = lambda r: float(r["final_score"])
    pred = lambda r: str(r.get("final_extracted_pred", r.get("final_prediction", ""))).strip()
    acc = sum(map(score, rows)) / len(rows)

    answerable = [r for r in rows if r["answer"] != NA]
    predicted = [r for r in rows if pred(r) != NA]
    recall = sum(map(score, answerable)) / len(answerable) if answerable else 0.0
    precision = sum(map(score, answerable)) / len(predicted) if predicted else 0.0
    f1 = 2 * recall * precision / (recall + precision) if recall + precision > 0 else 0.0

    out = {"n": len(rows), "Acc": acc, "F1": f1}
    for short, name in SOURCES.items():
        sub = [r for r in rows if name in _list(r.get("evidence_sources", "[]"))]
        out[short] = sum(map(score, sub)) / len(sub) if sub else None
    groups = {
        "SIN": [r for r in rows if len(_list(r.get("evidence_pages", "[]"))) == 1],
        "MUL": [r for r in rows if len(_list(r.get("evidence_pages", "[]"))) > 1],
        "UNA": [r for r in rows if len(_list(r.get("evidence_pages", "[]"))) == 0],
    }
    for k, sub in groups.items():
        out[k] = sum(map(score, sub)) / len(sub) if sub else None
    return out


def accuracy_only(rows):
    rows = [r for r in rows if "final_score" in r]
    return {"n": len(rows), "Acc": sum(float(r["final_score"]) for r in rows) / len(rows)} if rows else {}


def pct(x):
    return "-" if x is None else f"{100 * x:.1f}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--run", action="append", required=True, help='"Label=path/to/results.jsonl"')
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--expected_questions", type=int, default=0, help="Size of the full benchmark split")
    p.add_argument("--paper", default=None, help="JSON with the paper's numbers (percent) per label")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    paper = json.loads(Path(args.paper).read_text()) if args.paper else {}
    metric_fn = mmlongbench_metrics if args.dataset_name == "MMLongBenchDoc" else accuracy_only

    lines = [f"# DocLens reproduction: {args.dataset_name}", ""]
    table = []
    for spec in args.run:
        label, path = spec.split("=", 1)
        rows = load(path)
        errors = sum("cdc_error" in r for r in rows)
        models = sorted({r.get("model_name", "?") for r in rows})
        m = metric_fn(rows)
        table.append((label, m))
        complete = m.get("n", 0)
        note = f"- **{label}**: {complete} scored questions, {errors} failed, model(s): {', '.join(models)}"
        if args.expected_questions:
            note += f" ({100 * complete / args.expected_questions:.1f}% of the {args.expected_questions}-question benchmark)"
        lines.append(note)
    lines.append("")

    cols = [c for c in COLUMNS if any(c in m for _, m in table)]
    lines.append("| Method | " + " | ".join(cols) + " |")
    lines.append("|---|" + "---|" * len(cols))
    for label, m in table:
        cells = [str(m.get(c, "-")) if c == "n" else pct(m.get(c)) for c in cols]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
        if label in paper:
            ref = paper[label]
            lines.append("| ↳ paper | " + " | ".join("" if c == "n" else (f"{ref[c]:.1f}" if c in ref else "-") for c in cols) + " |")
            lines.append("| ↳ difference | " + " | ".join(
                "" if c == "n" or c not in ref or m.get(c) is None else f"{100 * m[c] - ref[c]:+.1f}" for c in cols) + " |")
    lines.append("")
    lines.append("Accuracy and F1 follow MMLongBench-Doc's official evaluation (answer extraction by an LLM, "
                 "then rule-based scoring), as implemented in DocLens' `utils/eval_toolkits.py`.")

    Path(args.out).write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
