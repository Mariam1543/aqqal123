"""Build the three proxy maps by calibrating procedural maps to the paper's statistics.

The paper only shows its maps as figures (missing item M1). This script runs a
seeded random search over generator parameters and keeps, for each map, the
candidate whose *baseline* statistics (Dijkstra and A* only - never the
proposed method, to avoid tuning the maps in its favour) are closest to the
published values in Tables 2-5:

* Dijkstra expanded nodes and path length,
* A* expanded nodes for every published start/goal pair,
* A* path length of the random start/goal pair (Table 5),
* A* number of turns >= 45 degrees.

The error is a weighted sum of absolute log-ratios. Output: ``maps/map{1,2,3}.csv``
and ``maps/calibration.json`` (parameters, seed, achieved vs. target values).

Usage:  python archive/calibrate_maps.py [--budget-scale 1.0] [--workers 4]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import astar, count_sharp_turns, dijkstra, from_paper  # noqa: E402
from adaptive_astar.maps import make_map  # noqa: E402

# (start, goal, quantity, published target, weight)
TARGETS = {
    "map1": [
        ((2, 2), (28, 28), "dijkstra_nodes", 632, 1.0),
        ((2, 2), (28, 28), "dijkstra_length", 40.30, 2.0),
        ((2, 2), (28, 28), "astar_nodes", 130, 1.0),
        ((2, 2), (28, 28), "astar_corners", 9, 0.3),
        ((28, 28), (2, 2), "astar_nodes", 202, 0.5),
        ((4, 24), (29, 2), "astar_nodes", 250, 0.5),
        ((4, 24), (29, 2), "astar_length", 38.21, 2.0),
    ],
    "map2": [
        ((2, 2), (58, 58), "dijkstra_nodes", 1740, 1.0),
        ((2, 2), (58, 58), "dijkstra_length", 92.10, 2.0),
        ((2, 2), (58, 58), "astar_nodes", 716, 1.0),
        ((2, 2), (58, 58), "astar_corners", 12, 0.3),
        ((58, 58), (2, 2), "astar_nodes", 898, 0.5),
        ((4, 54), (59, 2), "astar_nodes", 1159, 0.5),
        ((4, 54), (59, 2), "astar_length", 118.49, 2.0),
    ],
    "map3": [
        ((2, 2), (99, 99), "dijkstra_nodes", 7520, 1.0),
        ((2, 2), (99, 99), "dijkstra_length", 146.41, 2.0),
        ((2, 2), (99, 99), "astar_nodes", 2191, 1.0),
        ((2, 2), (99, 99), "astar_corners", 34, 0.3),
    ],
}

BUDGET = {"map1": 3000, "map2": 1500, "map3": 600}


def sample_params(map_id: str, rng: np.random.Generator) -> dict:
    """Draw generator parameters from a broad prior for the map's scene type."""
    if map_id == "map1":
        lo = int(rng.integers(3, 11))
        return {"n_blobs": int(rng.integers(8, 45)),
                "blob_cells": (lo, lo + int(rng.integers(4, 50)))}
    if map_id == "map2":
        return {"corridor": int(rng.integers(2, 6)), "wall": int(rng.integers(1, 4)),
                "loop_prob": float(np.round(rng.uniform(0.0, 0.5), 3))}
    lo = int(rng.integers(4, 13))
    g_lo = int(rng.integers(1, 4))
    return {"panel_h": int(rng.integers(1, 4)), "aisle": int(rng.integers(1, 5)),
            "panel_len": (lo, lo + int(rng.integers(2, 21))),
            "gap": (g_lo, g_lo + int(rng.integers(0, 5))),
            "missing_prob": float(np.round(rng.uniform(0.0, 0.3), 3)),
            "clutter": int(rng.integers(0, 81))}


def measure(grid, targets) -> dict:
    """Compute every calibration quantity on a candidate map."""
    out, cache = {}, {}
    for start, goal, quantity, _, _ in targets:
        s, t = from_paper(*start), from_paper(*goal)
        algo = quantity.split("_")[0]
        key = (algo, start, goal)
        if key not in cache:
            cache[key] = dijkstra(grid, s, t) if algo == "dijkstra" else astar(grid, s, t)
        res = cache[key]
        if quantity.endswith("nodes"):
            val = res.expanded
        elif quantity.endswith("length"):
            val = res.cost
        else:
            val = count_sharp_turns(res.path)
        out[f"{quantity}@{start}->{goal}"] = val
    return out


def score(measured: dict, targets) -> float:
    err = 0.0
    for start, goal, quantity, target, weight in targets:
        val = measured[f"{quantity}@{start}->{goal}"]
        err += weight * abs(math.log((val + 1) / (target + 1)))
    return err


def evaluate(job):
    map_id, trial = job
    rng = np.random.default_rng(10_000 * (list(TARGETS).index(map_id) + 1) + trial)
    params = sample_params(map_id, rng)
    seed = int(rng.integers(0, 2**31 - 1))
    grid = make_map(map_id, seed, **params)
    if grid is None:
        return None
    measured = measure(grid, TARGETS[map_id])
    return score(measured, TARGETS[map_id]), trial, seed, params, measured


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--budget-scale", type=float, default=1.0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--maps", nargs="*", default=list(TARGETS))
    args = ap.parse_args()

    out_dir = ROOT / "maps"
    out_dir.mkdir(exist_ok=True)
    report_path = out_dir / "calibration.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}

    with Pool(args.workers) as pool:
        for map_id in args.maps:
            n_trials = int(BUDGET[map_id] * args.budget_scale)
            results = [r for r in pool.imap_unordered(evaluate, [(map_id, i) for i in range(n_trials)],
                                                      chunksize=8) if r is not None]
            err, trial, seed, params, measured = min(results, key=lambda r: r[0])
            grid = make_map(map_id, seed, **params)
            grid.save_csv(out_dir / f"{map_id}.csv")
            report[map_id] = {
                "scene": {"map1": "irregular", "map2": "maze", "map3": "array"}[map_id],
                "trials": n_trials, "valid_trials": len(results), "best_trial": trial,
                "seed": seed, "params": params, "error": round(err, 4),
                "obstacle_ratio": round(grid.obstacle_ratio(), 4),
                "achieved_vs_target": {
                    f"{q}@{s}->{g}": {"proxy": round(measured[f'{q}@{s}->{g}'], 2), "paper": tgt}
                    for s, g, q, tgt, _ in TARGETS[map_id]},
            }
            print(f"{map_id}: error={err:.3f} seed={seed} params={params}")
            for k, v in report[map_id]["achieved_vs_target"].items():
                print(f"    {k:40s} proxy={v['proxy']:>9}  paper={v['paper']:>9}")

    report_path.write_text(json.dumps(report, indent=2))
    print(f"wrote {report_path}")


if __name__ == "__main__":
    main()
