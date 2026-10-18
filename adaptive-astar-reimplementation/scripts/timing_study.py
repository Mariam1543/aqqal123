"""Paired, interleaved timing study: Adaptive A* vs A* (planning-time metric).

Single-shot sub-millisecond timings drift with CPU frequency, cache state and
other load. Here the planners are run in alternating order (A*, Adaptive A*,
A*, ...) many times, so slow drifts affect both equally. Reported per map:
median times, the median of the paired ratios t_adaptive / t_A*, a 95 %
bootstrap confidence interval of that ratio, and the expanded-node ratio
(hardware independent).

Output: results/timing_study.csv and results/timing_study.md
Usage:  python scripts/timing_study.py [--pairs 300]
"""

from __future__ import annotations

import argparse
import gc
from dataclasses import replace
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import PLANNERS, GridMap, from_paper  # noqa: E402
from adaptive_astar.maps import MAP_SETS, load_map_set  # noqa: E402

CASES = [("30x30", "map1", (2, 2), (28, 28)), ("60x60", "map2", (2, 2), (58, 58)),
         ("100x100", "map3", (2, 2), (99, 99))]
PUBLISHED_REDUCTION = {"30x30": 75.0, "60x60": 66.7, "100x100": 64.3}   # Tables 2-4


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pairs", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--map-set", choices=sorted(MAP_SETS), default="paper")
    args = ap.parse_args()
    maps = load_map_set(args.map_set, ROOT / "maps")
    los = MAP_SETS[args.map_set]["los"]
    out = ROOT / "results" / ("paper_maps" if args.map_set == "paper" else "")
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    rows, md = [], ["# Interleaved timing study (Adaptive A* vs A*)", "",
                    f"{args.pairs} alternating pairs per map, GC disabled, `time.perf_counter`; "
                    "ratio = t(Adaptive A*) / t(A*) per pair; 95% CI by bootstrap (2000 resamples).", "",
                    "| Map | A* median (ms) | Adaptive A* median (ms) | Median ratio [95% CI] | "
                    "Time reduction ours | Time reduction paper | Node ratio |",
                    "|---|---|---|---|---|---|---|"]
    a_spec, b_spec = PLANNERS["A*"], replace(PLANNERS["Adaptive A*"], los=los)
    for size, map_id, s, g in CASES:
        grid = maps[size]
        s, g = from_paper(*s), from_paper(*g)
        for _ in range(5):                       # warm-up
            a_spec.plan(grid, s, g)
            b_spec.plan(grid, s, g)
        ta, tb = [], []
        gc.disable()
        try:
            for i in range(args.pairs):
                order = (a_spec, b_spec) if i % 2 == 0 else (b_spec, a_spec)
                for spec in order:
                    t0 = time.perf_counter()
                    spec.plan(grid, s, g)
                    (ta if spec is a_spec else tb).append(time.perf_counter() - t0)
        finally:
            gc.enable()
        ta, tb = np.array(ta), np.array(tb)
        ratio = tb / ta
        boots = [np.median(rng.choice(ratio, ratio.size)) for _ in range(2000)]
        lo, hi = np.percentile(boots, [2.5, 97.5])
        nodes = b_spec.plan(grid, s, g).expanded / a_spec.plan(grid, s, g).expanded
        med = np.median(ratio)
        rows.append({"map": size, "astar_ms": 1e3 * np.median(ta), "adaptive_ms": 1e3 * np.median(tb),
                     "ratio_median": med, "ratio_ci_lo": lo, "ratio_ci_hi": hi,
                     "time_reduction_pct": 100 * (1 - med), "paper_reduction_pct": PUBLISHED_REDUCTION[size],
                     "node_ratio": nodes, "pairs": args.pairs})
        md.append(f"| {size} | {1e3 * np.median(ta):.3f} | {1e3 * np.median(tb):.3f} | "
                  f"{med:.3f} [{lo:.3f}, {hi:.3f}] | {100 * (1 - med):.1f}% | "
                  f"{PUBLISHED_REDUCTION[size]:.1f}% | {nodes:.3f} |")
        print(md[-1])
    df = pd.DataFrame(rows)
    df.to_csv(out / "timing_study.csv", index=False, float_format="%.6g")
    mean_red = df["time_reduction_pct"].mean()
    md += ["", f"Mean time reduction over the three maps: ours {mean_red:.1f}% vs paper 68.7%."]
    (out / "timing_study.md").write_text("\n".join(md) + "\n")


if __name__ == "__main__":
    main()
