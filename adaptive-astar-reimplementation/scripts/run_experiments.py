"""Reproduce the experiments of Tables 1-5 and compare with the published numbers.

Outputs (in ``results/``):
  reproduced_results.csv  every run: metrics + timing statistics
  comparison.csv          published vs reproduced, absolute and relative to A*
  comparison.md           the same as Markdown tables (assignment format)
  robustness.csv/.md      Adaptive A* vs A* on N random maps per scene type
  environment.json        software / hardware used

Usage:
  python scripts/run_experiments.py                 # full run (30 timing repeats)
  python scripts/run_experiments.py --repeats 5 --robust-maps 10   # quick run
"""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
import math
import platform
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import PLANNERS, GridMap, from_paper, time_planner  # noqa: E402
from adaptive_astar.maps import MAP_SETS, load_map_set, make_map  # noqa: E402

METRICS = [("time_s", "Time (s)"), ("length_m", "Length (m)"),
           ("expanded_nodes", "Expanded nodes"), ("corners_ge45", "Corners >= 45 deg")]

# Algorithms the paper reports but whose full method is not reproducible from the
# paper alone (missing item M13): compared on their published numbers only.
PUBLISHED_ONLY = {"Chen et al. [29]", "Zhang et al. [31]"}
ALGO_ORDER = ["A*", "Adaptive estimation function", "Distance model optimization",
              "Redundant point deletion", "Dijkstra", "Chen et al. [29]", "Bidirectional A*",
              "Zhang et al. [31]", "Adaptive A*", "AEF+DMO (no pruning)", "A*+Octile+RPD",
              "Redundant point deletion (single-pass)", "Adaptive A* (single-pass pruning)"]
# Published label -> our planner name.
ALIASES = {"Dijkstra [28]": "Dijkstra", "Bidirectional A* [30]": "Bidirectional A*"}

EXPERIMENTS = [
    # (table, map size, start, goal, planners)
    *[("T1", size, (2, 2), goal,
       ["A*", "Adaptive estimation function", "Distance model optimization",
        "Redundant point deletion", "AEF+DMO (no pruning)", "Adaptive A*",
        "Redundant point deletion (single-pass)", "Adaptive A* (single-pass pruning)"])
      for size, goal in (("30x30", (28, 28)), ("60x60", (58, 58)))],
    *[(table, size, (2, 2), goal,
       ["A*", "Dijkstra", "Bidirectional A*", "Adaptive A*", "Redundant point deletion",
        "A*+Octile+RPD", "Adaptive A* (single-pass pruning)", "Adaptive A* (V4: E+M without 1/2)"])
      for table, size, goal in (("T2", "30x30", (28, 28)), ("T3", "60x60", (58, 58)),
                                ("T4", "100x100", (99, 99)))],
    *[("T5", size, s, g, ["A*", "Adaptive A*", "Adaptive A* (single-pass pruning)",
                          "Adaptive A* (V4: E+M without 1/2)"])
      for size, s, g in (("30x30", (28, 28), (2, 2)), ("30x30", (4, 24), (29, 2)),
                         ("60x60", (58, 58), (2, 2)), ("60x60", (4, 54), (59, 2)))],
]


def pt(p: tuple[int, int]) -> str:
    return f"{p[0]};{p[1]}"


# Settings of the active map set (set in main(); see adaptive_astar.maps.MAP_SETS).
SETTINGS = {"map_set": "proxy", "los": "supercover", "corner_cutting": False}


def load_maps(map_set: str) -> dict[str, GridMap]:
    for stem in MAP_SETS[map_set]["files"].values():
        if not (ROOT / "maps" / f"{stem}.csv").exists():
            sys.exit(f"maps/{stem}.csv missing - run scripts/calibrate_maps.py or scripts/digitize_figure5.py")
    return load_map_set(map_set, ROOT / "maps")


def with_free_start(grid: GridMap, cell) -> GridMap:
    """Copy of ``grid`` whose ``cell`` is free. Needed for Table 5's start (4, 24) on map1,
    which is an obstacle cell in the paper's own Fig. 5 (the paper planned from it anyway)."""
    occ = grid.occ.copy()
    occ[cell[1], cell[0]] = False
    return GridMap(occ, allow_corner_cutting=grid.allow_corner_cutting, name=grid.name)


def run_one(spec_name, grid, start, goal, repeats) -> dict:
    spec = replace(PLANNERS[spec_name], los=SETTINGS["los"])
    s, t = from_paper(*start), from_paper(*goal)
    for cell in (s, t):
        if not grid.is_free(*cell):
            print(f"  note: {start if cell == s else goal} is an obstacle in this map - freed for this run")
            grid = with_free_start(grid, cell)
    res = spec.plan(grid, s, t)
    timing = time_planner(spec, grid, s, t, repeats=repeats)
    return {
        "algorithm": spec_name,
        "time_s": timing["time_median"], "time_iqr_s": timing["time_iqr"],
        "time_mean_s": timing["time_mean"], "time_std_s": timing["time_std"],
        "length_m": res.length, "raw_grid_cost_m": res.raw_cost,
        "expanded_nodes": res.expanded, "generated_nodes": res.generated,
        "corners_ge45": res.corners, "path_nodes": len(res.path),
    }


def reproduce(maps, repeats) -> pd.DataFrame:
    rows = []
    for table, size, start, goal, planners in EXPERIMENTS:
        for name in planners:
            row = {"table": table, "map": size, "start": pt(start), "goal": pt(goal)}
            row.update(run_one(name, maps[size], start, goal, repeats))
            rows.append(row)
            print(f"{table} {size} {start}->{goal} {name:30s} "
                  f"t={row['time_s'] * 1e3:8.2f}ms L={row['length_m']:7.2f} "
                  f"N={row['expanded_nodes']:5d} C={row['corners_ge45']}")
    return pd.DataFrame(rows)


def relative_to_astar(df: pd.DataFrame, cols) -> pd.DataFrame:
    """Add <col>_rel columns: change relative to A* in the same table/map/pair."""
    df = df.copy()
    key = ["table", "map", "start", "goal"]
    base = df[df["algorithm"] == "A*"].set_index(key)
    for col in cols:
        ref = df.set_index(key).index.map(base[col].to_dict().get)
        ref = pd.Series(list(ref), index=df.index, dtype=float)
        if col == "length_m":
            df[f"{col}_rel"] = df[col] - ref                      # metres
        else:
            df[f"{col}_rel"] = 100.0 * (df[col] - ref) / ref      # percent
    return df


def compare(reproduced: pd.DataFrame) -> pd.DataFrame:
    published = pd.read_csv(ROOT / "data" / "published_results.csv")
    published["algorithm"] = published["algorithm"].replace(ALIASES)
    cols = [m for m, _ in METRICS]
    pub = relative_to_astar(published, cols)
    rep = relative_to_astar(reproduced, cols)
    key = ["table", "map", "start", "goal", "algorithm"]
    merged = pub.merge(rep, on=key, how="outer", suffixes=("_paper", "_ours"))
    for col in cols:
        merged[f"{col}_diff"] = merged[f"{col}_ours"] - merged[f"{col}_paper"]
        merged[f"{col}_rel_diff"] = merged[f"{col}_rel_ours"] - merged[f"{col}_rel_paper"]
    merged["source"] = np.where(merged["algorithm"].isin(PUBLISHED_ONLY), "published only",
                                np.where(merged["time_s_paper"].isna(), "extra (ours only)",
                                         "reproduced"))
    order = {"T1": 1, "T2": 2, "T3": 3, "T4": 4, "T5": 5}
    merged["_o"] = merged["table"].map(order)
    merged["_a"] = merged["algorithm"].map(lambda a: ALGO_ORDER.index(a) if a in ALGO_ORDER else 99)
    merged["_m"] = merged["map"].map({"30x30": 0, "60x60": 1, "100x100": 2})
    merged = merged.sort_values(["_o", "_m", "start", "goal", "_a"], kind="stable")
    return merged.drop(columns=["_o", "_a", "_m"])


def fmt(v, col, rel=False) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    if rel:
        return f"{v:+.2f} m" if col == "length_m" else f"{v:+.1f}%"
    if col == "time_s":
        return f"{v:.4f}"
    if col == "length_m":
        return f"{v:.2f}"
    return f"{int(round(v))}"


def fmt_diff(v, col) -> str:
    """Absolute difference ours - paper, in the metric's own unit."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    if col == "time_s":
        return f"{v:+.4f}"
    if col == "length_m":
        return f"{v:+.2f}"
    return f"{int(round(v)):+d}"


def markdown(cmp: pd.DataFrame) -> str:
    out = ["# Published vs reproduced results", "",
           "Generated by `scripts/run_experiments.py`. *Paper* = Cao et al. (2026), "
           f"*Ours* = this re-implementation on the **{SETTINGS['map_set']}** maps "
           f"(corner cutting {'allowed' if SETTINGS['corner_cutting'] else 'not allowed'}, "
           f"{SETTINGS['los']} line of sight). "
           "Time is the median of repeated runs (Python); the paper's time is MATLAB, "
           "reported to 0.01 s. Relative columns are the change against the A* "
           "baseline of the same experiment (length in metres, others in percent).", ""]
    titles = {"T1": "Table 1 - Ablation", "T2": "Table 2 - Algorithms on 30x30",
              "T3": "Table 3 - Algorithms on 60x60", "T4": "Table 4 - Algorithms on 100x100",
              "T5": "Table 5 - Different start and end points"}
    for table, tdf in cmp.groupby("table", sort=False):
        out += [f"## {titles[table]}", ""]
        for (size, start, goal), g in tdf.groupby(["map", "start", "goal"], sort=False):
            out += [f"### {size}, start ({start.replace(';', ',')}) -> goal ({goal.replace(';', ',')})", ""]
            # Absolute comparison
            hdr = "| Algorithm | Source |" + "".join(f" {lbl} paper | {lbl} ours | Diff |" for _, lbl in METRICS)
            out += [hdr, "|" + "---|" * (2 + 3 * len(METRICS))]
            for _, r in g.iterrows():
                cells = [r["algorithm"], r["source"]]
                for col, _ in METRICS:
                    cells += [fmt(r[f"{col}_paper"], col), fmt(r[f"{col}_ours"], col),
                              fmt_diff(r[f"{col}_diff"], col)]
                out.append("| " + " | ".join(cells) + " |")
            out += ["", "Change relative to A* (paper vs ours):", ""]
            hdr = "| Algorithm |" + "".join(f" {lbl} paper | {lbl} ours |" for _, lbl in METRICS)
            out += [hdr, "|" + "---|" * (1 + 2 * len(METRICS))]
            for _, r in g.iterrows():
                if r["algorithm"] == "A*":
                    continue
                cells = [r["algorithm"]]
                for col, _ in METRICS:
                    cells += [fmt(r[f"{col}_rel_paper"], col, True), fmt(r[f"{col}_rel_ours"], col, True)]
                out.append("| " + " | ".join(cells) + " |")
            out.append("")
    return "\n".join(out)


def headline(cmp: pd.DataFrame) -> str:
    """The abstract's three averages (Tables 2-4, Adaptive A* vs A*) - paper vs ours."""
    sub = cmp[(cmp["table"].isin(["T2", "T3", "T4"])) & (cmp["algorithm"] == "Adaptive A*")]
    lines = ["## Headline (abstract) metrics - mean over the three maps", "",
             "| Evaluation metric | Published result | Our result | Difference |",
             "|---|---|---|---|"]
    for col, label, unit in (("time_s", "Planning-time reduction vs A*", "%"),
                             ("length_m", "Path-length reduction vs A*", "m"),
                             ("expanded_nodes", "Expanded-node reduction vs A*", "%"),
                             ("corners_ge45", "Reduction of corners >= 45 deg vs A*", "%")):
        p = -sub[f"{col}_rel_paper"].mean()
        o = -sub[f"{col}_rel_ours"].mean()
        if unit == "m":
            lines.append(f"| {label} | {p:.2f} m | {o:.2f} m | {o - p:+.2f} m |")
        else:
            lines.append(f"| {label} | {p:.1f}% | {o:.1f}% | {o - p:+.1f} pp |")
    return "\n".join(lines) + "\n"


def robustness(n_maps: int, repeats: int) -> pd.DataFrame:
    """Adaptive A* (and A*+pruning) vs A* on fresh random maps of each scene type.

    Uses the calibrated generator parameters with *new* seeds, so these maps were
    never seen by the calibration.
    """
    calib = json.loads((ROOT / "maps" / "calibration.json").read_text())
    pairs = {"map1": ((2, 2), (28, 28)), "map2": ((2, 2), (58, 58)), "map3": ((2, 2), (99, 99))}
    rows = []
    for map_id, (start, goal) in pairs.items():
        params = {k: tuple(v) if isinstance(v, list) else v for k, v in calib[map_id]["params"].items()}
        seed, made = 0, 0
        while made < n_maps:
            seed += 1
            grid = make_map(map_id, 900_000 + seed, **params)
            if grid is None:
                continue
            grid.allow_corner_cutting = SETTINGS["corner_cutting"]
            made += 1
            for name in ("A*", "Redundant point deletion", "Adaptive A*"):
                r = run_one(name, grid, start, goal, repeats)
                rows.append({"map": map_id, "seed": 900_000 + seed, **r})
    return pd.DataFrame(rows)


def robustness_summary(rob: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    from scipy.stats import wilcoxon

    recs = []
    for (map_id, algo), g in rob.groupby(["map", "algorithm"]):
        if algo == "A*":
            continue
        base = rob[(rob["map"] == map_id) & (rob["algorithm"] == "A*")].set_index("seed")
        g = g.set_index("seed")
        for col, _ in METRICS:
            a, b = base.loc[g.index, col].to_numpy(float), g[col].to_numpy(float)
            change = (b - a) if col == "length_m" else 100.0 * (b - a) / a
            try:
                p = wilcoxon(a, b).pvalue if np.any(a != b) else 1.0
            except ValueError:
                p = float("nan")
            recs.append({"map": map_id, "algorithm": algo, "metric": col,
                         "mean_change": change.mean(), "std_change": change.std(ddof=1),
                         "median_change": np.median(change), "wins": int(np.sum(b < a)),
                         "ties": int(np.sum(b == a)), "losses": int(np.sum(b > a)),
                         "n": len(a), "wilcoxon_p": p})
    s = pd.DataFrame(recs)
    md = ["# Robustness on random maps", "",
          f"Each scene type: {s['n'].max()} fresh random maps (calibrated generator, unseen seeds), "
          "paper start/goal. Change vs A* (length in metres, others in percent); "
          "W/T/L = maps where the method is lower / equal / higher than A*; "
          "p = two-sided Wilcoxon signed-rank test.", "",
          "| Map | Method | Metric | Mean +- std | Median | W/T/L | p |", "|---|---|---|---|---|---|---|"]
    for _, r in s.iterrows():
        unit = " m" if r["metric"] == "length_m" else "%"
        md.append(f"| {r['map']} | {r['algorithm']} | {r['metric']} | "
                  f"{r['mean_change']:+.2f}{unit} +- {r['std_change']:.2f} | {r['median_change']:+.2f}{unit} | "
                  f"{r['wins']}/{r['ties']}/{r['losses']} | {r['wilcoxon_p']:.2g} |")
    md += ["", "## Path optimality (where do the length gains come from?)", "",
           "*Raw suboptimality*: grid cost of the raw Adaptive A* search path vs the optimal A* path "
           "(before pruning). *Adaptive A* vs A*+pruning*: final length difference "
           "(positive = Adaptive A* longer).", "",
           "| Map | Raw path suboptimal on | Mean / max raw suboptimality | "
           "Adaptive A* longer than A*+pruning on | Mean length difference |",
           "|---|---|---|---|---|"]
    key = ["map", "seed"]
    a = rob[rob["algorithm"] == "A*"].set_index(key)
    b = rob[rob["algorithm"] == "Adaptive A*"].set_index(key)
    c = rob[rob["algorithm"] == "Redundant point deletion"].set_index(key)
    gap = 100 * (b["raw_grid_cost_m"] - a["raw_grid_cost_m"]) / a["raw_grid_cost_m"]
    diff = b["length_m"] - c["length_m"]
    for map_id in sorted(rob["map"].unique()):
        g, d = gap.loc[map_id], diff.loc[map_id]
        md.append(f"| {map_id} | {(g > 1e-9).sum()}/{len(g)} maps | {g.mean():.2f}% / {g.max():.2f}% | "
                  f"{(d > 1e-9).sum()}/{len(d)} maps | {d.mean():+.2f} m |")
    return s, "\n".join(md) + "\n"


def environment() -> dict:
    import matplotlib
    import scipy
    cpu = platform.processor() or ""
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    return {"python": sys.version.split()[0], "numpy": np.__version__, "pandas": pd.__version__,
            "scipy": scipy.__version__, "matplotlib": matplotlib.__version__,
            "platform": platform.platform(), "cpu": cpu}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repeats", type=int, default=30, help="timing repetitions per run")
    ap.add_argument("--robust-maps", type=int, default=50, help="random maps per scene type")
    ap.add_argument("--robust-repeats", type=int, default=5)
    ap.add_argument("--map-set", choices=sorted(MAP_SETS), default="paper",
                    help="paper = maps digitised from the paper's Fig. 5 (default); proxy = calibrated proxy maps")
    ap.add_argument("--summarize-only", action="store_true",
                    help="rebuild the Markdown/summary files from existing CSVs without re-running")
    args = ap.parse_args()
    SETTINGS.update(map_set=args.map_set, los=MAP_SETS[args.map_set]["los"],
                    corner_cutting=MAP_SETS[args.map_set]["corner_cutting"])
    out = ROOT / "results" / ("paper_maps" if args.map_set == "paper" else "")
    if args.summarize_only:
        cmp = compare(pd.read_csv(out / "reproduced_results.csv"))
        cmp.to_csv(out / "comparison.csv", index=False, float_format="%.6g")
        (out / "comparison.md").write_text(headline(cmp) + "\n" + markdown(cmp))
        rob_path = out / "robustness.csv"
        if rob_path.exists():
            summary, md = robustness_summary(pd.read_csv(rob_path))
            summary.to_csv(out / "robustness_summary.csv", index=False, float_format="%.6g")
            (out / "robustness.md").write_text(md)
        print(headline(cmp))
        return

    out.mkdir(parents=True, exist_ok=True)
    maps = load_maps(args.map_set)
    for g in maps.values():
        print(g)

    reproduced = reproduce(maps, args.repeats)
    reproduced.to_csv(out / "reproduced_results.csv", index=False, float_format="%.6g")
    cmp = compare(reproduced)
    cmp.to_csv(out / "comparison.csv", index=False, float_format="%.6g")
    (out / "comparison.md").write_text(headline(cmp) + "\n" + markdown(cmp))
    print(headline(cmp))

    if args.robust_maps > 0:
        rob = robustness(args.robust_maps, args.robust_repeats)
        rob.to_csv(out / "robustness.csv", index=False, float_format="%.6g")
        summary, md = robustness_summary(rob)
        summary.to_csv(out / "robustness_summary.csv", index=False, float_format="%.6g")
        (out / "robustness.md").write_text(md)
        print(md)

    env = environment() | {"timing_repeats": args.repeats, "robust_maps": args.robust_maps} | SETTINGS
    (out / "environment.json").write_text(json.dumps(env, indent=2))


if __name__ == "__main__":
    main()
