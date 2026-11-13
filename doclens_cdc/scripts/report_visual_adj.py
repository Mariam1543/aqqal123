"""
Report for Option 1 + 4 (unanimity gate + visual Adjudicator), from a `run_cdc.py --mode visual_adj` file.

Compared on the same questions, the same sampled answers and the same scoring:
    B1   DocLens: always the text-only Adjudicator
    B2   majority vote of the k sampled answers (no Adjudicator)
    O1   Option 1: unanimity gate + DocLens' text-only Adjudicator (no new model call)
    O14  Option 1 + 4: unanimity gate + visual Adjudicator (this run)

    python scripts/report_visual_adj.py results_qwen/MMLongBenchDoc/qwen_visual_adj.jsonl --out visual_adj_report.md
"""

import argparse
import ast
import json
from pathlib import Path

import numpy as np

CORRECT_AT = 0.5


def load(path):
    best = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            if "cdc_error" not in r and "final_score" in r and "b1_score" in r:
                best[(r["doc_id"], r["question"], str(r.get("answer", "")))] = r
    return list(best.values())


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def rows_of(recs):
    out = []
    for r in recs:
        base = num(r.get("lens_tokens")) + num(r.get("doclens_sampler_tokens"))
        b1_tok = num(r.get("b1_tokens")) or base
        adj_tok = num(r.get("doclens_adjudicator_tokens")) or max(b1_tok - base, 0.0)
        unanimous = not r.get("visadj_called", False)
        b1, b2 = num(r["b1_score"]), num(r["majority_score"])
        try:
            sources = ast.literal_eval(r.get("evidence_sources") or "[]")
        except (ValueError, SyntaxError):
            sources = []
        out.append({
            "unanimous": unanimous,
            "B1": b1, "B2": b2, "O1": b2 if unanimous else b1, "O14": num(r["final_score"]),
            "tok_B1": base + adj_tok, "tok_B2": base, "tok_O1": base + (0.0 if unanimous else adj_tok),
            "tok_O14": num(r.get("final_tokens")),
            "calls_B1": 1, "calls_B2": 0, "calls_O1": 0 if unanimous else 1, "calls_O14": 0 if unanimous else 1,
            "sources": sources or ["No evidence (unanswerable)"],
            "unanswerable": str(r.get("answer", "")).strip().lower() == "not answerable",
        })
    return out


def bootstrap(a, b, n=10_000, seed=0):
    a, b = np.asarray(a), np.asarray(b)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(a), size=(n, len(a)))
    d = (a[idx] - b[idx]).mean(axis=1) * 100
    return (a.mean() - b.mean()) * 100, np.percentile(d, 2.5), np.percentile(d, 97.5), float((d <= 0).mean())


def report(rows):
    n = len(rows)
    acc = lambda k, rs=rows: 100 * np.mean([r[k] for r in rs]) if rs else float("nan")
    names = {"B1": "B1: DocLens (always text-only Adjudicator)", "B2": "B2: majority vote (no Adjudicator)",
             "O1": "Option 1: unanimity gate + text-only Adjudicator",
             "O14": "**Option 1 + 4: unanimity gate + visual Adjudicator (ours)**"}
    tok_b1 = np.mean([r["tok_B1"] for r in rows])
    dis = [r for r in rows if not r["unanimous"]]
    L = [f"# Option 1 + 4: unanimity gate + visual Adjudicator", "",
         f"{n} questions. All sampled answers agree on {100 * (n - len(dis)) / n:.1f}% "
         f"(Adjudicator skipped); the visual Adjudicator runs on the other {len(dis)} questions.", "",
         "| Method | Accuracy | Adjudicator calls | Tokens / question | Tokens vs B1 |", "|---|---|---|---|---|"]
    for k, name in names.items():
        t = np.mean([r[f"tok_{k}"] for r in rows])
        L.append(f"| {name} | {acc(k):.1f} | {100 * np.mean([r[f'calls_{k}'] for r in rows]):.1f}% | "
                 f"{t:,.0f} | {100 * (t - tok_b1) / tok_b1:+.1f}% |")
    L.append("")
    for other in ("B1", "B2", "O1"):
        d, lo, hi, p = bootstrap([r["O14"] for r in rows], [r[other] for r in rows])
        L.append(f"Option 1 + 4 vs {other} (paired bootstrap, 10,000 resamples): {d:+.1f} points "
                 f"(95% CI {lo:+.1f} to {hi:+.1f}; p(not better) = {p:.3f})")
    ok = lambda s: s >= CORRECT_AT
    fixed = sum(ok(r["O14"]) and not ok(r["B1"]) for r in dis)
    broke = sum(ok(r["B1"]) and not ok(r["O14"]) for r in dis)
    L += ["", f"On the {len(dis)} questions where the sampled answers disagree: DocLens {acc('B1', dis):.1f}, "
          f"visual Adjudicator {acc('O14', dis):.1f}. Fixed {fixed} questions DocLens got wrong, "
          f"broke {broke} it got right (net {fixed - broke:+d}).", ""]
    # by evidence source, as in MMLongBench-Doc
    cats = sorted({s for r in rows for s in r["sources"]})
    L += ["## By evidence source", "", "| Evidence source | n | B1 (DocLens) | Option 1 + 4 |", "|---|---|---|---|"]
    for c in cats:
        rs = [r for r in rows if c in r["sources"]]
        L.append(f"| {c} | {len(rs)} | {acc('B1', rs):.1f} | {acc('O14', rs):.1f} |")
    for label, rs in (("Unanswerable", [r for r in rows if r["unanswerable"]]),
                      ("Answerable", [r for r in rows if not r["unanswerable"]])):
        L.append(f"| {label} | {len(rs)} | {acc('B1', rs):.1f} | {acc('O14', rs):.1f} |")
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("results")
    p.add_argument("--out", default=None)
    a = p.parse_args()
    rows = rows_of(load(a.results))
    if not rows:
        raise SystemExit(f"No finished visual_adj questions in {a.results}")
    text = report(rows)
    print(text)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
