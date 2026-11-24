"""
Agreement gate around the DocLens Adjudicator (novelty, version A1), evaluated offline.

DocLens' Reasoning Module samples k answers (Answer Sampler, Ta = 8) and always lets an Adjudicator
pick the final one. The gate looks only at how much the k sampled answers agree:

    agreement = share of the valid sampled answers equal to the most common one (after normalisation)
    agreement >= tau  ->  return the majority answer, skip the Adjudicator
    agreement <  tau  ->  run the Adjudicator (unchanged DocLens)

Compared with
    B1  always run the Adjudicator (= DocLens)
    B2  always return the majority vote (never run the Adjudicator)
    oracle  per question, the better of majority vote and Adjudicator (upper bound for any gate)

Reported: accuracy, over-correction rate (the majority answer was right but the returned answer is
wrong, i.e. the Adjudicator overturned a correct consensus), fix rate (majority wrong, returned
answer right), Adjudicator rate and token cost. tau is swept over every possible agreement level,
and also chosen by cross-validation (picked on the other folds, applied to the held-out fold) so the
headline A1 number is not tuned on the questions it is reported on. A paired bootstrap gives the
95% CI of A1 minus B1 and A1 minus B2.

Needs a DocLens results file whose sampled answers were scored (run_cdc.py --mode doclens does this;
records from older runs are scored when the run is resumed):

    python scripts/analyze_gate.py results_qwen/MMLongBenchDoc/qwen_doclens.jsonl --out gate_report.md
"""

import argparse
import json
import re
import zlib
from collections import Counter
from pathlib import Path

import numpy as np

CORRECT_AT = 0.5  # MMLongBench-Doc scores are 0/1 (partial credit for lists)


def norm(a) -> str:  # same normalisation as cdc/confidence.py::_norm_answer
    a = str(a).lower().strip()
    return re.sub(r"[\s\"'`.,;:!?()\[\]{}]+", " ", a).strip()


def load(paths, prefix="doclens_"):
    best = {}
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if "cdc_error" not in r and "final_score" in r:
                    best[(r["doc_id"], r["question"], str(r.get("answer", "")))] = r
    rows, unscored = [], 0
    for r in best.values():
        k = 0
        while f"{prefix}cand{k + 1}_prediction" in r:
            k += 1
        if k == 0 or f"{prefix}cand1_score" not in r:
            unscored += 1
            continue
        rows.append(case(r, k, prefix))
    return rows, unscored


def adjudicator_chars(r, k, prefix):
    text = r.get("preprocessed_question", r.get("question", ""))
    for i in range(1, k + 1):
        text += str(r.get(f"{prefix}cand{i}_analysis", "")) + str(r.get(f"{prefix}cand{i}_prediction", ""))
    return len(text) + len(str(r.get(f"{prefix}analysis", ""))) + len(str(r.get(f"{prefix}prediction", "")))


def case(r, k, prefix):
    preds = [str(r[f"{prefix}cand{i}_prediction"]) for i in range(1, k + 1)]
    scores = [float(r.get(f"{prefix}cand{i}_score", 0.0)) for i in range(1, k + 1)]
    valid = [i for i, p in enumerate(preds) if norm(p) and norm(p) != "error"]
    if valid:
        counts = Counter(norm(preds[i]) for i in valid)
        top = max(counts.values())
        # tie: the answer sampled first among the most common ones
        maj = next(i for i in valid if counts[norm(preds[i])] == top)
        agreement, maj_score = top / len(valid), scores[maj]
    else:
        agreement, maj_score = 0.0, 0.0
    total = float(r.get("final_tokens", 0))
    adj = r.get(f"{prefix}adjudicator_tokens")
    return {
        "id": f"{r['doc_id']}||{r['question']}",
        "doc": str(r["doc_id"]),
        "agreement": agreement,
        "maj": maj_score,
        "adj": float(r["final_score"]),
        "total_tokens": total,
        "adj_tokens": None if adj is None else float(adj),
        "adj_chars": adjudicator_chars(r, k, prefix),
        "k": k,
    }


def impute_adjudicator_tokens(rows):
    """Records from runs before the token split was stored: fit tokens = a + b * chars on the
    records that have it (the Adjudicator prompt is text only, temperature 0)."""
    known = [r for r in rows if r["adj_tokens"] is not None]
    missing = [r for r in rows if r["adj_tokens"] is None]
    if not missing:
        return 0, None
    if len(known) >= 5:
        b, a = np.polyfit([r["adj_chars"] for r in known], [r["adj_tokens"] for r in known], 1)
    else:  # no measured records yet: system prompt ~ 600 tokens, ~3.5 characters per token
        a, b = 600.0, 1 / 3.5
    for r in missing:
        r["adj_tokens"] = float(a + b * r["adj_chars"])
    return len(missing), (a, b)


def evaluate(rows, tau):
    """tau = None -> B1 (always Adjudicator); tau = 0 -> B2 (never); else the agreement gate."""
    acc, over, fix, used, tokens = [], [], [], [], []
    for r in rows:
        run_adj = tau is None or (tau > 0 and r["agreement"] < tau)
        s = r["adj"] if run_adj else r["maj"]
        acc.append(s)
        over.append(r["maj"] >= CORRECT_AT and s < CORRECT_AT)
        fix.append(r["maj"] < CORRECT_AT and s >= CORRECT_AT)
        used.append(run_adj)
        tokens.append(r["total_tokens"] - (0 if run_adj else r["adj_tokens"]))
    return {"acc": np.mean(acc), "over": np.mean(over), "fix": np.mean(fix), "adj_rate": np.mean(used),
            "tokens": np.mean(tokens), "scores": np.array(acc)}


def oracle(rows):
    s = np.array([max(r["maj"], r["adj"]) for r in rows])
    return {"acc": s.mean(), "scores": s}


def taus(rows):
    levels = sorted({r["agreement"] for r in rows})
    return [0.0] + [t for t in levels if t > 0] + [1.01]  # 0 = never adjudicate (B2), 1.01 = always (B1)


def pick_tau(rows):
    """Best accuracy; ties -> fewest Adjudicator calls (lowest tau)."""
    best = None
    for t in taus(rows):
        m = evaluate(rows, t)
        key = (round(m["acc"], 12), -m["adj_rate"])
        if best is None or key > best[0]:
            best = (key, t)
    return best[1]


def cross_validated(rows, folds=5):
    """Each question gets the gate decision of a tau chosen on the other folds. Folds are made of
    whole documents, so tau is never chosen on questions about the document it is applied to."""
    fold = [zlib.crc32(r["doc"].encode()) % folds for r in rows]
    out = [None] * len(rows)
    chosen = []
    for f in range(folds):
        train = [r for r, g in zip(rows, fold) if g != f]
        t = pick_tau(train) if train else 1.01
        chosen.append(t)
        for i, (r, g) in enumerate(zip(rows, fold)):
            if g == f:
                out[i] = (r, t)
    acc, over, fix, used, tokens = [], [], [], [], []
    for r, t in out:
        m = evaluate([r], t)
        acc.append(m["acc"]); over.append(m["over"]); fix.append(m["fix"])
        used.append(m["adj_rate"]); tokens.append(m["tokens"])
    return {"acc": np.mean(acc), "over": np.mean(over), "fix": np.mean(fix), "adj_rate": np.mean(used),
            "tokens": np.mean(tokens), "scores": np.array(acc), "taus": chosen}


def paired_bootstrap(a, b, n_boot=10000, seed=0):
    rng = np.random.default_rng(seed)
    d = np.asarray(a) - np.asarray(b)
    idx = rng.integers(0, len(d), size=(n_boot, len(d)))
    boots = d[idx].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return d.mean(), lo, hi, float((boots <= 0).mean())


def report(rows, n_imputed, fit, unscored):
    b1, b2 = evaluate(rows, None), evaluate(rows, 0.0)
    a1 = cross_validated(rows)
    orc = oracle(rows)
    pct = lambda x: f"{100 * x:.1f}"
    saved = lambda m: f"{100 * (1 - m['tokens'] / b1['tokens']):.1f}%" if b1["tokens"] else "n/a"
    agree_all = np.mean([r["agreement"] == 1.0 for r in rows])
    differ = np.mean([(r["maj"] >= CORRECT_AT) != (r["adj"] >= CORRECT_AT) for r in rows])
    unan = [r for r in rows if r["agreement"] == 1.0 and r["maj"] < CORRECT_AT]
    unanimous_wrong = len(unan) / len(rows)
    fixed_unanimous = sum(r["adj"] >= CORRECT_AT for r in unan)
    L = [f"# Agreement gate around the Adjudicator (A1)", "",
         f"{len(rows)} questions with scored sampled answers (k = {rows[0]['k']})"
         + (f"; {unscored} without candidate scores were skipped" if unscored else "") + ".",
         f"All k sampled answers agree on {pct(agree_all)}% of the questions.",
         f"B1 (Adjudicator) and B2 (majority) give a different score on {pct(differ)}% of the questions "
         "(the gate can only change the result on these).",
         f"All k answers agree but are wrong on {pct(unanimous_wrong)}% of the questions "
         "(the gate skips the Adjudicator there; it fixed {0} of them).".format(fixed_unanimous), ""]
    if n_imputed:
        L += [f"Adjudicator tokens were not stored for {n_imputed} questions (earlier runs); they are estimated "
              f"from the Adjudicator prompt length (tokens = {fit[0]:.0f} + {fit[1]:.3f} x characters, fitted "
              f"on the questions where they were measured).", ""]
    L += ["| Method | Accuracy | Over-correction | Fix rate | Adjudicator rate | Tokens / question | Saved vs B1 |",
          "|---|---|---|---|---|---|---|"]
    for name, m in (("B1: always Adjudicator (DocLens)", b1), ("B2: majority vote", b2),
                    (f"**A1: agreement gate** (tau by 5-fold CV over documents)", a1)):
        L.append(f"| {name} | {pct(m['acc'])} | {pct(m['over'])} | {pct(m['fix'])} | {pct(m['adj_rate'])} | "
                 f"{m['tokens']:,.0f} | {saved(m)} |")
    L.append(f"| Oracle gate (upper bound) | {pct(orc['acc'])} | | | | | |")
    L += ["", "Over-correction: the majority answer was right, the returned answer is wrong. "
          "Fix rate: the majority answer was wrong, the returned answer is right.", ""]
    for name, other in (("B1", b1), ("B2", b2)):
        d, lo, hi, p = paired_bootstrap(a1["scores"], other["scores"])
        L.append(f"A1 vs {name} (paired bootstrap, 10,000 resamples): accuracy {100 * d:+.1f} points "
                 f"(95% CI {100 * lo:+.1f} to {100 * hi:+.1f}; p(A1 not better) = {p:.3f}).")
    L += ["", f"tau chosen in the 5 folds: {', '.join(f'{t:.3f}' for t in a1['taus'])}", "",
          "## Every threshold", "",
          "| tau (run the Adjudicator if agreement < tau) | Accuracy | Over-correction | Fix rate | Adjudicator rate | Saved vs B1 |",
          "|---|---|---|---|---|---|"]
    for t in taus(rows):
        m = evaluate(rows, t)
        label = "0 (= B2)" if t == 0 else (">1 (= B1)" if t > 1 else f"{t:.3f}")
        L.append(f"| {label} | {pct(m['acc'])} | {pct(m['over'])} | {pct(m['fix'])} | {pct(m['adj_rate'])} | {saved(m)} |")
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("results", nargs="+", help="DocLens results JSONL file(s) (run_cdc.py --mode doclens)")
    p.add_argument("--out", default=None, help="Write the Markdown report here")
    args = p.parse_args()
    rows, unscored = load(args.results)
    if not rows:
        raise SystemExit("No question has scored sampled answers yet (resume the DocLens run once to score them).")
    n_imputed, fit = impute_adjudicator_tokens(rows)
    text = report(rows, n_imputed, fit, unscored)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
