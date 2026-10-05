"""
Analyse `run_cdc.py --mode analyze` outputs.

Because analyze mode runs every path for every question, the CDC gate can be
simulated at any threshold offline. Reported per variant (clean, blur_s2, ...):

  * accuracy of DocLens, always-correct, always-abstain, CDC (gated) and the oracle gate
  * over-refinement rate: the un-verified answer was right but the final answer is wrong
      - DocLens: first sampled candidate right, adjudicated answer wrong
      - CDC:     abstain-path answer right, but the gate sent the case to correction
                 and the corrected answer is wrong
  * under-correction rate: gate abstained, abstain answer wrong, correction would have fixed it
  * abstention rate and token cost
  * AUROC of the CDC confidence for predicting that the abstain answer is correct
  * gate ablations: evidence-only, consistency-only, combined

The threshold tau is chosen on a dev split (--dev_frac) and reported on the rest.

    python scripts/analyze_results.py results/*.jsonl --out_dir results/report
"""

import argparse
import json
import zlib
from collections import defaultdict
from pathlib import Path

import numpy as np

CORRECT_AT = 0.5  # scores are 0/1 or ANLS in [0, 1]


def load(paths):
    best = {}
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if "cdc_error" in r:
                continue
            key = (r.get("variant"), r["doc_id"], r["question"], str(r.get("answer", "")))
            best[key] = r
    return list(best.values())


def ok(score):
    return score is not None and score >= CORRECT_AT


def gate_confidence(r, gate):
    rep = r.get("cdc_report", {})
    ev, cons = rep.get("evidence_reliability"), rep.get("consistency")
    if gate == "combined":
        return r.get("cdc_confidence")
    if gate == "evidence":
        return ev
    if gate == "consistency":
        return cons
    raise ValueError(gate)


def auroc(conf, labels):
    conf, labels = np.asarray(conf, float), np.asarray(labels, bool)
    pos, neg = conf[labels], conf[~labels]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    greater = (pos[:, None] > neg[None, :]).mean()
    ties = (pos[:, None] == neg[None, :]).mean()
    return float(greater + 0.5 * ties)


def simulate(rows, tau, gate="combined"):
    """Gated accuracy / cost / over-refinement at threshold tau."""
    acc, tokens, abstained, over, under = [], [], [], [], []
    for r in rows:
        c = gate_confidence(r, gate)
        c = 0.0 if c is None else c
        abstain = c >= tau
        s = r["abstain_score"] if abstain else r["correct_score"]
        acc.append(s)
        base = r.get("lens_tokens", 0) + r.get("cdc_judge_tokens", 0)
        tokens.append(base + (r.get("abstain_tokens", 0) if abstain else r.get("correct_tokens", 0)))
        abstained.append(abstain)
        over.append((not abstain) and ok(r["abstain_score"]) and not ok(r["correct_score"]))
        under.append(abstain and not ok(r["abstain_score"]) and ok(r["correct_score"]))
    return {
        "accuracy": float(np.mean(acc)),
        "abstain_rate": float(np.mean(abstained)),
        "over_refinement": float(np.mean(over)),
        "under_correction": float(np.mean(under)),
        "tokens": float(np.mean(tokens)),
    }


def baselines(rows):
    def mean(key):
        return float(np.mean([r[key] for r in rows]))

    def tok(*keys):
        return float(np.mean([sum(r.get(k, 0) for k in keys) for r in rows]))

    return {
        "DocLens (always verify, original evidence)": {
            "accuracy": mean("doclens_score"),
            "over_refinement": float(np.mean([ok(r["doclens_first_score"]) and not ok(r["doclens_score"]) for r in rows])),
            "tokens": tok("lens_tokens", "doclens_tokens"),
            "abstain_rate": 0.0,
        },
        "Always correct (CDC correction for every case)": {
            "accuracy": mean("correct_score"),
            "over_refinement": float(np.mean([ok(r["abstain_score"]) and not ok(r["correct_score"]) for r in rows])),
            "tokens": tok("lens_tokens", "correct_tokens"),
            "abstain_rate": 0.0,
        },
        "Always abstain (no correction)": {
            "accuracy": mean("abstain_score"),
            "over_refinement": 0.0,
            "tokens": tok("lens_tokens", "abstain_tokens"),
            "abstain_rate": 1.0,
        },
        "Oracle gate (upper bound)": {
            "accuracy": float(np.mean([max(r["abstain_score"], r["correct_score"]) for r in rows])),
            "over_refinement": 0.0,
            "tokens": float("nan"),
            "abstain_rate": float(np.mean([r["abstain_score"] >= r["correct_score"] for r in rows])),
        },
    }


def choose_tau(rows, gate, grid):
    if not rows:
        return None
    scored = []
    for t in grid:
        m = simulate(rows, t, gate)
        scored.append((m["accuracy"], m["abstain_rate"], t))
    # best accuracy; ties broken towards more abstention (cheaper)
    return max(scored)[2]


def split(rows, dev_frac, seed):
    dev, test = [], []
    for r in rows:
        h = zlib.crc32(f"{seed}|{r['doc_id']}|{r['question']}".encode()) % 1000 / 1000
        (dev if h < dev_frac else test).append(r)
    return dev, test


def fmt(x, pct=True):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "-"
    return f"{100 * x:.1f}" if pct else f"{x:,.0f}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+")
    p.add_argument("--out_dir", required=True)
    p.add_argument("--dev_frac", type=float, default=0.3, help="0 -> use --tau for every variant")
    p.add_argument("--tau", type=float, default=0.7)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    required = ["abstain_score", "correct_score", "doclens_score", "doclens_first_score", "cdc_confidence"]
    rows = [r for r in load(args.files) if all(k in r for k in required)]
    if not rows:
        raise SystemExit("No complete analyze-mode records found (need --mode analyze with evaluation).")
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    grid = [round(t, 2) for t in np.arange(0.0, 1.01, 0.02)]

    by_variant = defaultdict(list)
    for r in rows:
        by_variant[r.get("variant", "?")].append(r)
    by_variant = dict(sorted(by_variant.items(), key=lambda kv: (kv[0] != "clean", kv[0])))
    by_variant["ALL"] = rows

    dev_all, _ = split(rows, args.dev_frac, args.seed) if args.dev_frac > 0 else ([], rows)
    taus = {g: (choose_tau(dev_all, g, grid) if args.dev_frac > 0 else args.tau)
            for g in ("combined", "evidence", "consistency")}

    lines = ["# DocLens + Confidence and Degradation Check: results", ""]
    lines.append(f"{len(rows)} questions; a score >= {CORRECT_AT} counts as correct. "
                 + (f"tau chosen on a {int(args.dev_frac * 100)}% dev split (pooled over variants), "
                    f"metrics on the remaining test questions." if args.dev_frac > 0 else f"tau fixed at {args.tau}."))
    lines.append("")
    lines.append("Selected thresholds: " + ", ".join(f"{g} gate tau={t}" for g, t in taus.items()))
    lines.append("")

    csv = ["variant,method,n,accuracy,abstain_rate,over_refinement,under_correction,tokens"]
    sweep = {}
    for variant, vrows in by_variant.items():
        _, test = split(vrows, args.dev_frac, args.seed) if args.dev_frac > 0 else ([], vrows)
        if not test:
            continue
        table = baselines(test)
        for gate, label in (("combined", "CDC (evidence + consistency)"),
                            ("evidence", "CDC ablation: evidence-only gate"),
                            ("consistency", "CDC ablation: consistency-only gate")):
            table[f"{label} @ tau={taus[gate]}"] = simulate(test, taus[gate], gate)
        lines.append(f"## {variant} (n={len(test)})")
        lines.append("")
        lines.append("| Method | Acc. | Abstain | Over-refinement | Under-correction | Tokens / q |")
        lines.append("|---|---|---|---|---|---|")
        for name, m in table.items():
            lines.append(f"| {name} | {fmt(m['accuracy'])} | {fmt(m.get('abstain_rate'))} | "
                         f"{fmt(m.get('over_refinement'))} | {fmt(m.get('under_correction'))} | "
                         f"{fmt(m.get('tokens'), pct=False)} |")
            csv.append(f"{variant},{name},{len(test)},{m['accuracy']:.4f},{m.get('abstain_rate', 0):.4f},"
                       f"{m.get('over_refinement', 0):.4f},{m.get('under_correction', 0) or 0:.4f},{m.get('tokens', 0):.0f}")
        conf = [r["cdc_confidence"] for r in test]
        lines.append("")
        lines.append(f"AUROC of CDC confidence for 'abstain answer is correct': "
                     f"{auroc(conf, [ok(r['abstain_score']) for r in test]):.3f}; "
                     f"mean confidence {np.mean(conf):.3f}; "
                     f"pages flagged as low-confidence per question: "
                     f"{np.mean([r['cdc_report'].get('n_low_confidence_pages', 0) for r in test]):.2f}")
        lines.append("")
        sweep[variant] = [simulate(vrows, t) | {"tau": t} for t in grid]

    (out / "report.md").write_text("\n".join(lines))
    (out / "summary.csv").write_text("\n".join(csv))
    (out / "threshold_sweep.json").write_text(json.dumps(sweep, indent=1))
    print("\n".join(lines))

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 2, figsize=(11, 4))
        for variant, pts in sweep.items():
            if variant == "ALL":
                continue
            axes[0].plot([q["tau"] for q in pts], [q["accuracy"] for q in pts], label=variant)
            axes[1].plot([q["abstain_rate"] for q in pts], [q["accuracy"] for q in pts], label=variant)
        axes[0].set_xlabel("tau (confidence threshold)")
        axes[0].set_ylabel("gated accuracy")
        axes[1].set_xlabel("abstention rate")
        axes[1].set_ylabel("gated accuracy")
        axes[0].legend(fontsize=8)
        fig.tight_layout()
        fig.savefig(out / "threshold_sweep.png", dpi=150)
        print(f"Plot: {out / 'threshold_sweep.png'}")
    except ImportError:
        pass
    print(f"Report: {out / 'report.md'}")


if __name__ == "__main__":
    main()
