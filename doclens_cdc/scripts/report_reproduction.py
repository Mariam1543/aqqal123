"""
Reproduction report: our runs next to the numbers printed in the DocLens paper.

Reads <results_dir>/<experiment>.jsonl for every experiment in reproduction/experiments.py and
reports, per experiment, the paper's metrics:
  * MMLongBench-Doc: accuracy by evidence source (TXT, LAY, CHA, TAB, FIG), on unanswerable (UNA)
    and answerable (ANS) questions, overall (ALL); plus the official generalized F1
  * FinRAGBench-V: accuracy (ALL) and, when the samples carry evidence types, TXT/TAB/CHA
  * Page Navigator retrieval (Tables 3-4): pages per question, recall and precision vs. the
    annotated evidence pages (questions with at least one evidence page)
  * the per-domain breakdown of Table 10 (MMLongBench-Doc `doc_type`)

Scoring is DocLens' own (MMLongBench-Doc: LLM answer extraction + rule-based score; FinRAGBench-V:
LLM judge), computed while running.

    python scripts/report_reproduction.py --results_dir results_repro --dataset_name MMLongBenchDoc \
        --out results_repro/reproduction.md [--expected_questions 1082]
"""

import argparse
import json
import sys
from ast import literal_eval
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PKG))
from reproduction.experiments import EXPERIMENTS  # noqa: E402

NA = "Not answerable"
MML_SOURCES = {
    "TXT": "Pure-text (Plain-text)",
    "LAY": "Generalized-text (Layout)",
    "CHA": "Chart",
    "TAB": "Table",
    "FIG": "Figure",
}
FIN_KEYWORDS = {"TXT": "text", "TAB": "table", "CHA": "chart"}
DOMAINS = {
    "Academic": ("academic",),
    "Admin/Ind.": ("administration", "industry"),
    "Brochure": ("brochure",),
    "Financial": ("financial",),
    "Guidebook": ("guidebook",),
    "Report/Intro": ("research report", "introduction"),
    "Tutorial/WS": ("tutorial", "workshop"),
}
COLUMNS = {
    "MMLongBenchDoc": ["n", "TXT", "LAY", "CHA", "TAB", "FIG", "UNA", "ANS", "ALL", "F1", "Pages", "Recall", "Prec"],
    "FinRAGBench-V": ["n", "TXT", "TAB", "CHA", "ALL", "Pages", "Recall", "Prec"],
}


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
        return out if isinstance(out, (list, tuple)) else [out]
    except Exception:
        return []


def _mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else None


def _score(r):
    return float(r["final_score"])


def page_metrics(rows):
    """Tables 3-4: retrieved pages vs. annotated evidence pages (DocLens' own definitions)."""
    with_pred = [r for r in rows if "pgnav_all_located_pages" in r]
    if not with_pred:
        return {}
    recall, prec = [], []
    for r in with_pred:
        pred, gt = set(_list(r["pgnav_all_located_pages"])), set(_list(r.get("evidence_pages", "[]")))
        if not gt:
            continue
        tp = len(pred & gt)
        recall.append(tp / len(gt))
        prec.append(tp / len(pred) if pred else 0.0)
    return {
        "Pages": _mean(len(_list(r["pgnav_all_located_pages"])) for r in with_pred),
        "Recall": _mean(recall),
        "Prec": _mean(prec),
    }


def metrics(rows, dataset):
    rows = [r for r in rows if "final_score" in r]
    if not rows:
        return {}
    out = {"n": len(rows), "ALL": _mean(map(_score, rows))}
    if dataset == "MMLongBenchDoc":
        for short, name in MML_SOURCES.items():
            out[short] = _mean(_score(r) for r in rows if name in _list(r.get("evidence_sources", "[]")))
        out["UNA"] = _mean(_score(r) for r in rows if r["answer"] == NA)
        out["ANS"] = _mean(_score(r) for r in rows if r["answer"] != NA)
        # MMLongBench-Doc's official eval_acc_and_f1
        pred = lambda r: str(r.get("final_extracted_pred", r.get("final_prediction", ""))).strip()
        answerable = [r for r in rows if r["answer"] != NA]
        predicted = [r for r in rows if pred(r) != NA]
        rec = sum(map(_score, answerable)) / len(answerable) if answerable else 0.0
        pre = sum(map(_score, answerable)) / len(predicted) if predicted else 0.0
        out["F1"] = 2 * rec * pre / (rec + pre) if rec + pre > 0 else 0.0
    else:
        for short, kw in FIN_KEYWORDS.items():
            def has(r, kw=kw):
                fields = [r.get(k) for k in ("evidence_sources", "evidence_type", "type", "question_type")]
                return any(kw in str(f).lower() for f in fields if f is not None)
            out[short] = _mean(_score(r) for r in rows if has(r))
    out.update(page_metrics(rows))
    if any(r.get("cdc_mode") == "oracle" for r in rows):
        out.update({"Pages": _mean(len(_list(r.get("evidence_pages", "[]"))) for r in rows),
                    "Recall": 1.0, "Prec": 1.0})
    return out


def domain_metrics(rows):
    rows = [r for r in rows if "final_score" in r and r.get("doc_type")]
    out = {}
    for name, keys in DOMAINS.items():
        sub = [r for r in rows if any(k in str(r["doc_type"]).lower() for k in keys)]
        out[name] = _mean(map(_score, sub))
    out["ALL"] = _mean(map(_score, rows))
    return out if rows else {}


def fmt(col, value):
    if value is None:
        return "-"
    if col == "n":
        return str(value)
    if col == "Pages":
        return f"{value:.1f}"
    return f"{100 * value:.1f}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--results_dir", required=True)
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--paper", default=str(PKG / "reproduction" / "paper_numbers.json"))
    p.add_argument("--expected_questions", type=int, default=0)
    p.add_argument("--out", required=True)
    args = p.parse_args()

    paper_all = json.loads(Path(args.paper).read_text())
    paper = paper_all.get(args.dataset_name, {})
    cols = COLUMNS.get(args.dataset_name, ["n", "ALL", "Pages", "Recall", "Prec"])
    results_dir = Path(args.results_dir)

    lines = [f"# DocLens reproduction: {args.dataset_name}", ""]
    lines.append("Each experiment shows **ours**, then the **paper** value and the **difference** (ours - paper), "
                 "in percentage points. `-` means the paper does not report that cell or the run has no such questions.")
    lines.append("")
    header = "| Experiment | Row | " + " | ".join(cols) + " |"
    lines += [header, "|---|---|" + "---|" * len(cols)]
    status, ran = [], {}
    for key, exp in EXPERIMENTS.items():
        path = results_dir / f"{key}.jsonl"
        if not path.exists():
            continue
        rows = load(path)
        m = metrics(rows, args.dataset_name)
        ran[key] = rows
        errors = sum("cdc_error" in r for r in rows)
        models = sorted({str(r.get("model_name", "?")) for r in rows})
        cover = f" ({100 * m.get('n', 0) / args.expected_questions:.1f}% of {args.expected_questions})" if args.expected_questions else ""
        status.append(f"- `{key}` ({exp['note']}): {m.get('n', 0)} scored{cover}, {errors} failed; model(s) {', '.join(models)}")
        ref = paper.get(key, {})
        lines.append(f"| `{key}` | ours | " + " | ".join(fmt(c, m.get(c)) for c in cols) + " |")
        if ref:
            lines.append("| | paper | " + " | ".join(
                "" if c == "n" else (f"{ref[c]:.1f}" if c in ref else "-") for c in cols) + " |")
            diffs = []
            for c in cols:
                if c == "n" or c not in ref or m.get(c) is None:
                    diffs.append("")
                else:
                    ours = m[c] if c == "Pages" else 100 * m[c]
                    diffs.append(f"{ours - ref[c]:+.1f}")
            lines.append("| | diff | " + " | ".join(diffs) + " |")
    lines.append("")
    lines.append("## Runs")
    lines += status or ["- no result files found"]

    domains_paper = paper_all.get(f"{args.dataset_name}_domains", {})
    if args.dataset_name == "MMLongBenchDoc" and ran:
        dcols = ["ALL"] + list(DOMAINS)
        drows = [(k, domain_metrics(v)) for k, v in ran.items()]
        drows = [(k, d) for k, d in drows if d]
        if drows:
            lines += ["", "## Per-domain accuracy (Table 10)", "",
                      "| Experiment | Row | " + " | ".join(dcols) + " |", "|---|---|" + "---|" * len(dcols)]
            for key, d in drows:
                lines.append(f"| `{key}` | ours | " + " | ".join(fmt(c, d.get(c)) for c in dcols) + " |")
                if key in domains_paper:
                    ref = domains_paper[key]
                    lines.append("| | paper | " + " | ".join(f"{ref[c]:.1f}" for c in dcols) + " |")
        elif not any(r.get("doc_type") for rows in ran.values() for r in rows):
            lines += ["", "Per-domain table skipped: the samples have no `doc_type` field."]

    if args.dataset_name == "MMLongBenchDoc":
        lines += ["", f"Human experts on MMLongBench-Doc: {paper_all.get('_human_expert_MMLongBenchDoc')} (paper, Sec. 4.1)."]
    Path(args.out).write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
