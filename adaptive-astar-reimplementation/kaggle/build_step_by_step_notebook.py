"""Build kaggle/adaptive_astar_step_by_step.ipynb from the library sources.

The notebook is fully self-contained (no repository clone, no Internet): each
module of ``src/adaptive_astar`` becomes one explained code cell (copied
verbatim, minus package-relative imports), the proxy maps are rebuilt from
their calibrated seeds, the paper's published numbers are embedded, and every
experiment runs in its own cell with its table and figure underneath.

Re-run this script whenever the library changes:
    python kaggle/build_step_by_step_notebook.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "adaptive_astar"
OUT = ROOT / "kaggle" / "adaptive_astar_step_by_step.ipynb"


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text: str) -> dict:
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


def module(name: str) -> str:
    """Library module source without the future import and package-relative imports."""
    text = (SRC / f"{name}.py").read_text()
    text = re.sub(r"^from __future__ import annotations\n", "", text, flags=re.M)
    text = re.sub(r"^from \.[a-z_]+ import \([^)]*\)\n", "", text, flags=re.M)
    text = re.sub(r"^from \.[a-z_]+ import .*\n", "", text, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n\n", text).strip() + "\n"


def published_csv() -> str:
    return (ROOT / "data" / "published_results.csv").read_text().strip()


def calibration() -> dict:
    calib = json.loads((ROOT / "maps" / "calibration.json").read_text())
    return {m: {"seed": calib[m]["seed"], "params": calib[m]["params"]} for m in ("map1", "map2", "map3")}


def build() -> dict:
    calib = calibration()
    cells = [
        md("""
# Adaptive A\\* for Mobile-Robot Global Path Planning — Step-by-Step Re-Implementation

**Paper reproduced:** H. Cao, Z. Guo, Y. Zhang, Z. Lu, and L. Jiang, "An Adaptive A\\* Algorithm for Mobile Robots Global Path Planning," *Electronics*, vol. 15, no. 13, Art. 2807, 2026, doi: 10.3390/electronics15132807.

The paper has no public source code, so this notebook re-implements its method from scratch and reproduces its experiments. It runs top to bottom with **Run All**, on CPU only, with no Internet and no uploaded files.

| Part | What it does |
|---|---|
| 1 | Setup |
| 2 | Implementation: grid model, heuristics + **adaptive weight (Eq. 6)**, **hybrid distance (Eq. 7)**, A\\* / Dijkstra / bidirectional A\\*, **redundant point deletion (Sec. 3.3)**, metrics, planners |
| 3 | Sanity checks (correctness tests) |
| 4 | Maps: proxy maps calibrated to the paper's statistics |
| 5 | The paper's published results (Tables 1–5) |
| 6 | Experiments: Table 1 ablation, Tables 2–4 algorithm comparison, Table 5 start/goal points |
| 7 | Headline comparison: published vs. reproduced (Metrics 1–4) |
| 8 | Paired timing study |
| 9 | Robustness on 150 random maps (Wilcoxon tests) |
| 10 | Sensitivity to the ambiguous pruning rule |
| 11 | Summary |
"""),
        md("## 1. Setup"),
        code("""
# Run configuration. QUICK = True gives a ~1-minute smoke run; use False for the reported numbers.
QUICK = False
TIMING_REPEATS = 3 if QUICK else 30     # timing repetitions per configuration (median reported)
TIMING_PAIRS = 30 if QUICK else 300     # interleaved A* / Adaptive A* pairs in the timing study
ROBUST_MAPS = 5 if QUICK else 50        # random maps per scene type in the robustness study
"""),
        code("""
%matplotlib inline
import gc, heapq, io, itertools, math, platform, statistics, time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
import scipy
from scipy.stats import wilcoxon
from IPython.display import display, Markdown

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 30)
print(f"Python {platform.python_version()} | numpy {np.__version__} | pandas {pd.__version__} | "
      f"scipy {scipy.__version__} | matplotlib {matplotlib.__version__}")
print("CPU:", platform.processor() or platform.machine(), "| cores:", __import__("os").cpu_count())
"""),
        md("""
## 2. Implementation

### 2.1 Environment model (paper Sec. 2.1)
The workspace is a grid of 1 m × 1 m cells; black cells are obstacles. The robot moves in **8 directions** (straight cost 1, diagonal cost √2).

**Assumption (not stated in the paper):** a diagonal move may not cut between two obstacles that touch at a corner.
"""),
        code(module("grid")),
        md("""
### 2.2 Distance models, adaptive weight and hybrid heuristic (Sec. 2.2, 3.1, 3.2)

**Contribution 1 — adaptive estimation function (Eqs. 5–6):**
$$f(n) = g(n) + \\omega(n)\\,h(n), \\qquad \\omega(n) = \\ln\\!\\left(1 + e^{d/D}\\right)$$
where *d* is the distance from node *n* to the goal and *D* is the distance from start to goal.

**Contribution 2 — hybrid distance model (Eq. 7):**
$$h(n) = \\frac{\\text{Euclidean}(n, goal) + \\text{Manhattan}(n, goal)}{2}$$
"""),
        code(module("heuristics")),
        code("""
# What does the adaptive weight look like?
w = adaptive_weight((0, 0), (10, 0))
print(f"omega at the start (d/D = 1): {w((0, 0)):.4f}   = ln(1+e)")
print(f"omega half way    (d/D = .5): {w((5, 0)):.4f}")
print(f"omega at the goal (d/D = 0): {w((10, 0)):.4f}   = ln 2")
# How much does the hybrid heuristic over-estimate the true 8-connected cost?
ratios = [hybrid((0, 0), (math.cos(t), math.sin(t))) / octile((0, 0), (math.cos(t), math.sin(t)))
          for t in np.linspace(0, math.pi / 2, 181)]
print(f"max hybrid / true cost = {max(ratios):.4f}  (at 45 degrees) -> the hybrid heuristic is NOT admissible")
"""),
        md("""
### 2.3 Search algorithms: A\\* (Algorithm 1), Dijkstra, bidirectional A\\*
- **A\\*:** an OPEN list (binary heap) and a CLOSED list (set). Nodes on CLOSED are never re-opened, and the search stops when the goal is popped, exactly as in the paper's Algorithm 1. The optional `weight` argument turns plain A\\* into the paper's adaptive A\\*.
- **Dijkstra:** A\\* with h = 0.
"""),
        code(module("search")),
        md("""
### 2.4 Redundant point deletion (Contribution 3, Sec. 3.3, Fig. 4)
A three-node window (P*i*, P*i*+1, P*i*+2) moves along the raw path:
- **Step 2:** if the three nodes are collinear, delete the middle one.
- **Step 3:** otherwise, connect P*i* to P*i*+2. If that straight line touches no obstacle cell (exact *line-of-sight* test), delete the middle node; if it does, keep it.
"""),
        code(module("smoothing")),
        md("### 2.5 Evaluation metrics (as in Tables 1–5)\nPath length (m), expanded nodes (size of CLOSED), number of corners with heading change ≥ 45°, and planning time."),
        code(module("metrics")),
        md("""
### 2.6 Planners: every combination needed for the experiments
`A*` is the baseline. The paper's three improvements can each be switched on alone (the ablation of Table 1) or all together (**Adaptive A\\***).
"""),
        code(module("planners")),
        md("""
## 3. Sanity checks
These tests confirm the implementation behaves correctly before any experiment is run.
"""),
        code("""
def check(name, condition):
    print(("PASS " if condition else "FAIL ") + name)
    assert condition, name

e = GridMap(np.zeros((10, 10), dtype=bool))
check("A* on an empty grid finds the exact diagonal cost 9*sqrt(2)",
      abs(astar(e, (0, 0), (9, 9)).cost - 9 * math.sqrt(2)) < 1e-9)
occ = np.zeros((3, 3), dtype=bool); occ[0, 1] = occ[1, 0] = True
check("no diagonal corner cutting between touching obstacles",
      (1, 1) not in [n for n, _ in GridMap(occ).neighbors((0, 0))])
occ = np.zeros((5, 5), dtype=bool); occ[2, 2] = True; g5 = GridMap(occ)
check("line of sight is blocked through an obstacle", not line_of_sight(g5, (0, 0), (4, 4)))
check("line of sight is free along an empty row", line_of_sight(g5, (0, 0), (4, 0)))
check("pruning straightens a staircase into one segment",
      delete_redundant_points(e, [(0, 0), (1, 0), (2, 0), (3, 1), (4, 2), (5, 3)]) == [(0, 0), (5, 3)])
check("a 45-degree turn is counted as a corner", count_sharp_turns([(0, 0), (1, 0), (2, 1)]) == 1)
check("adaptive weight = ln(1+e) at start and ln 2 at goal",
      abs(adaptive_weight((0, 0), (10, 0))((0, 0)) - math.log(1 + math.e)) < 1e-12
      and abs(adaptive_weight((0, 0), (10, 0))((10, 0)) - math.log(2)) < 1e-12)
"""),
        md("""
## 4. Maps

The paper shows its three maps **only as figures** (30×30 irregular outdoor, 60×60 maze/corridor, 100×100 array-like). No map data is published.

We therefore use **proxy maps** of the same size and scene type:
- Thousands of seeded candidate maps were generated, and the one whose **Dijkstra / A\\* statistics** best match the paper's was kept (repository script `scripts/calibrate_maps.py`).
- The proposed method was never used during calibration, so the maps are not tuned in its favour.
- The generator code is below. Each map is rebuilt exactly from its recorded seed.
"""),
        code(module("maps")),
        code(f"""
# Calibrated generator parameters and seeds (from maps/calibration.json)
CALIBRATION = {json.dumps(calib, indent=4)}

def build_proxy_map(map_id):
    c = CALIBRATION[map_id]
    params = {{k: tuple(v) if isinstance(v, list) else v for k, v in c["params"].items()}}
    grid = make_map(map_id, c["seed"], **params)
    grid.name = map_id
    return grid

MAPS = {{"30x30": build_proxy_map("map1"), "60x60": build_proxy_map("map2"), "100x100": build_proxy_map("map3")}}
for size, grid in MAPS.items():
    print(size, grid)
"""),
        code("""
# How close are the proxy maps to the paper? (baseline statistics only)
rows = []
for size, goal, paper in (("30x30", (28, 28), (632, 40.30, 130)), ("60x60", (58, 58), (1740, 92.10, 716)),
                          ("100x100", (99, 99), (7520, 146.41, 2191))):
    s, t = from_paper(2, 2), from_paper(*goal)
    d, a = dijkstra(MAPS[size], s, t), astar(MAPS[size], s, t)
    rows.append({"map": size, "Dijkstra nodes (paper)": paper[0], "Dijkstra nodes (proxy)": d.expanded,
                 "optimal length (paper)": paper[1], "optimal length (proxy)": round(d.cost, 2),
                 "A* nodes (paper)": paper[2], "A* nodes (proxy)": a.expanded})
display(pd.DataFrame(rows).set_index("map"))
"""),
        code("""
# Palette and a helper that draws a map with explored cells and a path
INK, INK2, MUTED, SURFACE, GRID_LINE = "#0b0b0b", "#52514e", "#8a8984", "#fcfcfb", "#e4e3df"
OBSTACLE, EXPLORED, BLUE, ORANGE = "#3a3936", "#cde2fb", "#2a78d6", "#eb6834"
plt.rcParams.update({"font.size": 9, "axes.titlesize": 9.5, "axes.edgecolor": GRID_LINE,
                     "figure.facecolor": "white", "axes.facecolor": SURFACE})

def draw(ax, grid, start, goal, planner=None, title="", color=BLUE):
    img = np.zeros(grid.occ.shape, dtype=int)
    res = None
    if planner:
        res = PLANNERS[planner].plan(grid, from_paper(*start), from_paper(*goal))
        for x, y in res.closed:
            img[y, x] = 1
    img[grid.occ] = 2
    ax.imshow(img, cmap=ListedColormap([SURFACE, EXPLORED, OBSTACLE]), vmin=0, vmax=2, origin="lower",
              interpolation="nearest", extent=(0.5, grid.width + 0.5, 0.5, grid.height + 0.5))
    if res:
        xs, ys = [c[0] + 1 for c in res.path], [c[1] + 1 for c in res.path]
        ax.plot(xs, ys, color=color, lw=1.8)
        if PLANNERS[planner].prune:
            ax.plot(xs, ys, "o", ms=2.8, color=color)
        title += f"\\nL={res.length:.2f} m, N={res.expanded}, C={res.corners}"
    ax.plot(*start, "s", ms=6, color=INK)
    ax.plot(*goal, "*", ms=10, color=INK, mec=SURFACE)
    ax.set_title(title)
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)

fig, axes = plt.subplots(1, 3, figsize=(12, 4))
for ax, (size, goal) in zip(axes, (("30x30", (28, 28)), ("60x60", (58, 58)), ("100x100", (99, 99)))):
    draw(ax, MAPS[size], (2, 2), goal, title=f"Proxy map {size}")
plt.show()
"""),
        md("## 5. The paper's published results (Tables 1–5)"),
        code(f'''
PUBLISHED_CSV = """
{published_csv()}
"""
PUBLISHED = pd.read_csv(io.StringIO(PUBLISHED_CSV.strip()))
PUBLISHED["algorithm"] = PUBLISHED["algorithm"].replace({{"Dijkstra [28]": "Dijkstra",
                                                          "Bidirectional A* [30]": "Bidirectional A*"}})
display(PUBLISHED)
'''),
        md("""
## 6. Experiments

Each experiment runs on the proxy maps with the paper's start/goal points.
- **Length, nodes and corners** are deterministic, identical on every run and every machine.
- **Time** is the median of repeated runs. The paper used MATLAB and we use Python, so absolute times are not comparable. We compare the **change relative to A\\*** instead.
"""),
        code("""
METRICS = ["time_s", "length_m", "expanded_nodes", "corners_ge45"]
PUBLISHED_ONLY = {"Chen et al. [29]", "Zhang et al. [31]"}   # not described in the paper -> published numbers only

def run_case(name, size, start, goal):
    spec = PLANNERS[name]
    s, t = from_paper(*start), from_paper(*goal)
    res = spec.plan(MAPS[size], s, t)
    timing = time_planner(spec, MAPS[size], s, t, repeats=TIMING_REPEATS)
    return {"algorithm": name, "time_s": timing["time_median"], "length_m": res.length,
            "expanded_nodes": res.expanded, "corners_ge45": res.corners, "raw_cost": res.raw_cost}

def relative(df):
    \"\"\"Change relative to the A* row: metres for length, percent for the rest.\"\"\"
    base = df[df["algorithm"] == "A*"].iloc[0]
    out = df[["algorithm"]].copy()
    for m in METRICS:
        out[m] = df[m] - base[m] if m == "length_m" else 100 * (df[m] - base[m]) / base[m]
    return out

def experiment(table, size, start, goal, algorithms):
    \"\"\"Run one experiment and show paper vs ours (absolute values and change vs A*).\"\"\"
    ours = pd.DataFrame([run_case(a, size, start, goal) for a in algorithms])
    key = f"{start[0]};{start[1]}"
    pub = PUBLISHED[(PUBLISHED["table"] == table) & (PUBLISHED["map"] == size)
                    & (PUBLISHED["start"] == key) & (PUBLISHED["goal"] == f"{goal[0]};{goal[1]}")]
    merged = pub[["algorithm"] + METRICS].merge(ours[["algorithm"] + METRICS], on="algorithm",
                                                 how="outer", suffixes=(" paper", " ours"))
    order = list(dict.fromkeys(list(pub["algorithm"]) + list(ours["algorithm"])))
    merged = merged.set_index("algorithm").loc[order]
    absolute = pd.DataFrame(index=merged.index)
    for m in METRICS:
        absolute[f"{m} paper"] = merged[f"{m} paper"]
        absolute[f"{m} ours"] = merged[f"{m} ours"]
        if m != "time_s":
            absolute[f"{m} diff"] = merged[f"{m} ours"] - merged[f"{m} paper"]
    rel_p = relative(pub.reset_index(drop=True)).set_index("algorithm").add_suffix(" paper")
    rel_o = relative(ours).set_index("algorithm").add_suffix(" ours")
    rel = rel_p.join(rel_o, how="outer").reindex(order).drop(index="A*")
    rel = rel[[f"{m} {w}" for m in METRICS for w in ("paper", "ours")]]
    display(Markdown(f"**{table} — {size}, start {start} → goal {goal}** (absolute values)"))
    display(absolute.style.format(precision=4, na_rep="—"))
    display(Markdown("Change relative to A\\\\* (length in m, others in %; negative = better):"))
    display(rel.style.format("{:+.1f}", na_rep="—"))
    return ours.assign(table=table, map=size, start=str(start), goal=str(goal))

ALL_RESULTS = []
"""),
        md("""
### 6.1 Table 1 — Ablation of the three improvements
- **AEF** = adaptive estimation function only.
- **DMO** = hybrid distance model only.
- **RPD** = redundant point deletion only.

We also add the full combination and a single-pass pruning variant.
"""),
        code("""
ABLATION = ["A*", "Adaptive estimation function", "Distance model optimization", "Redundant point deletion",
            "AEF+DMO (no pruning)", "Adaptive A*"]
ALL_RESULTS.append(experiment("T1", "30x30", (2, 2), (28, 28), ABLATION))
"""),
        code("""
ALL_RESULTS.append(experiment("T1", "60x60", (2, 2), (58, 58), ABLATION))
"""),
        code("""
fig, axes = plt.subplots(1, 4, figsize=(13, 3.6))
for ax, (name, title) in zip(axes, [("A*", "(a) A*"), ("Adaptive estimation function", "(b) Adaptive estimation"),
                                    ("Distance model optimization", "(c) Distance model"),
                                    ("Redundant point deletion", "(d) Redundant point deletion")]):
    draw(ax, MAPS["60x60"], (2, 2), (58, 58), name, title)
fig.suptitle("Ablation on the 60x60 map (cf. paper Fig. 7) - explored cells shaded", color=INK2)
plt.show()
"""),
        md("""
### 6.2 Tables 2–4 — Comparison with other algorithms
Chen et al. [29] and Zhang et al. [31] are not described in the paper, so they appear with their **published numbers only**.

**A\\* + pruning** and **A\\* + octile + pruning** are extra baselines we added for a fair comparison.
"""),
        code("""
COMPARISON = ["A*", "Dijkstra", "Bidirectional A*", "Adaptive A*", "Redundant point deletion", "A*+Octile+RPD"]
ALL_RESULTS.append(experiment("T2", "30x30", (2, 2), (28, 28), COMPARISON))
"""),
        code("""
ALL_RESULTS.append(experiment("T3", "60x60", (2, 2), (58, 58), COMPARISON))
"""),
        code("""
ALL_RESULTS.append(experiment("T4", "100x100", (2, 2), (99, 99), COMPARISON))
"""),
        code("""
for size, goal in (("30x30", (28, 28)), ("60x60", (58, 58)), ("100x100", (99, 99))):
    fig, axes = plt.subplots(1, 5, figsize=(15, 3.4))
    for ax, (name, title) in zip(axes, [("A*", "(a) A*"), ("Dijkstra", "(b) Dijkstra"),
                                        ("Bidirectional A*", "(c) Bidirectional A*"),
                                        ("Redundant point deletion", "(d) A* + pruning"),
                                        ("Adaptive A*", "(e) Adaptive A*")]):
        draw(ax, MAPS[size], (2, 2), goal, name, title, ORANGE if name == "Adaptive A*" else BLUE)
    fig.suptitle(f"Algorithms on the {size} map (cf. paper Figs. 8-10)", color=INK2)
    plt.show()
"""),
        md("### 6.3 Table 5 — Different start and end points"),
        code("""
for size, start, goal in (("30x30", (28, 28), (2, 2)), ("30x30", (4, 24), (29, 2)),
                          ("60x60", (58, 58), (2, 2)), ("60x60", (4, 54), (59, 2))):
    ALL_RESULTS.append(experiment("T5", size, start, goal, ["A*", "Adaptive A*"]))
"""),
        code("""
fig, axes = plt.subplots(2, 4, figsize=(13, 6.5))
for col, (size, s, g) in enumerate((("30x30", (28, 28), (2, 2)), ("30x30", (4, 24), (29, 2)),
                                    ("60x60", (58, 58), (2, 2)), ("60x60", (4, 54), (59, 2)))):
    draw(axes[0, col], MAPS[size], s, g, "A*", f"A* {s}->{g}")
    draw(axes[1, col], MAPS[size], s, g, "Adaptive A*", f"Adaptive A* {s}->{g}", ORANGE)
fig.suptitle("Different start and end points (cf. paper Figs. 11-12)", color=INK2)
plt.show()
"""),
        md("""
## 7. Paired timing study (planning-time metric)
A single run takes well under a millisecond, so one-off timings are noisy. Here A\\* and Adaptive A\\* are run **alternately**, many times, and we report the median of the paired ratios with a bootstrap 95% confidence interval.
"""),
        code("""
def paired_timing(size, goal, pairs=TIMING_PAIRS, seed=0):
    grid, s, t = MAPS[size], from_paper(2, 2), from_paper(*goal)
    a_spec, b_spec = PLANNERS["A*"], PLANNERS["Adaptive A*"]
    for _ in range(5):
        a_spec.plan(grid, s, t); b_spec.plan(grid, s, t)
    ta, tb = [], []
    gc.disable()
    try:
        for i in range(pairs):
            for spec in ((a_spec, b_spec) if i % 2 == 0 else (b_spec, a_spec)):
                t0 = time.perf_counter(); spec.plan(grid, s, t)
                (ta if spec is a_spec else tb).append(time.perf_counter() - t0)
    finally:
        gc.enable()
    ratio = np.array(tb) / np.array(ta)
    rng = np.random.default_rng(seed)
    lo, hi = np.percentile([np.median(rng.choice(ratio, ratio.size)) for _ in range(2000)], [2.5, 97.5])
    return {"map": size, "A* median (ms)": 1e3 * np.median(ta), "Adaptive A* median (ms)": 1e3 * np.median(tb),
            "ratio": np.median(ratio), "95% CI": f"[{lo:.3f}, {hi:.3f}]",
            "time reduction ours (%)": 100 * (1 - np.median(ratio))}

TIMING = pd.DataFrame([paired_timing(s, g) for s, g in (("30x30", (28, 28)), ("60x60", (58, 58)),
                                                        ("100x100", (99, 99)))])
TIMING["time reduction paper (%)"] = [75.0, 66.7, 64.3]
display(TIMING.set_index("map").round(3))
"""),
        md("## 8. Headline comparison — published vs. reproduced (assignment table)"),
        code("""
RESULTS = pd.concat(ALL_RESULTS, ignore_index=True)

def mean_reduction(df_rows, metric):
    vals = []
    for size in ("30x30", "60x60", "100x100"):
        r = df_rows[df_rows["map"] == size].set_index("algorithm")
        a, b = r.loc["A*", metric], r.loc["Adaptive A*", metric]
        vals.append(a - b if metric == "length_m" else 100 * (a - b) / a)
    return np.mean(vals), vals

ours_tab = RESULTS[RESULTS["table"].isin(["T2", "T3", "T4"])]
paper_tab = PUBLISHED[PUBLISHED["table"].isin(["T2", "T3", "T4"])]
rows = []
for label, metric, unit in (("Metric 1: planning-time reduction vs A*", "time_s", "%"),
                            ("Metric 2: path-length reduction vs A*", "length_m", "m"),
                            ("Metric 3: expanded-node reduction vs A*", "expanded_nodes", "%"),
                            ("Metric 4: reduction of corners >= 45 deg vs A*", "corners_ge45", "%")):
    p, p_each = mean_reduction(paper_tab, metric)
    if metric == "time_s":   # paired timing study is the reliable time measurement
        o_each = list(TIMING["time reduction ours (%)"]); o = float(np.mean(o_each))
    else:
        o, o_each = mean_reduction(ours_tab, metric)
    fmt = (lambda v: f"{v:.2f} m") if unit == "m" else (lambda v: f"{v:.1f}%")
    rows.append({"Evaluation metric": label,
                 "Published result": f"{fmt(p)}  ({', '.join(fmt(v) for v in p_each)})",
                 "Our result": f"{fmt(o)}  ({', '.join(fmt(v) for v in o_each)})",
                 "Difference": f"{o - p:+.2f} m" if unit == "m" else f"{o - p:+.1f} pp"})
HEADLINE = pd.DataFrame(rows).set_index("Evaluation metric")
display(HEADLINE)
"""),
        code("""
fig, axes = plt.subplots(1, 4, figsize=(14, 3.6))
sizes = ["30x30", "60x60", "100x100"]
for ax, (metric, title) in zip(axes, (("time_s", "Planning time (% vs A*)"),
                                      ("expanded_nodes", "Expanded nodes (% vs A*)"),
                                      ("length_m", "Path length (m vs A*)"),
                                      ("corners_ge45", "Corners >= 45 deg (% vs A*)"))):
    p = [-v for v in mean_reduction(paper_tab, metric)[1]]
    o = ([-v for v in TIMING["time reduction ours (%)"]] if metric == "time_s"
         else [-v for v in mean_reduction(ours_tab, metric)[1]])
    x = np.arange(3)
    ax.bar(x - 0.19, p, 0.36, color=BLUE, label="Published (paper)")
    ax.bar(x + 0.19, o, 0.36, color=ORANGE, label="Reproduced (ours)")
    ax.axhline(0, color=MUTED, lw=0.8); ax.set_xticks(x, sizes); ax.set_title(title)
    ax.grid(axis="y", color=GRID_LINE); ax.set_axisbelow(True)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in (BLUE, ORANGE)]
fig.legend(handles, ["Published (paper)", "Reproduced (ours)"], frameon=False, ncol=2,
           loc="upper right", bbox_to_anchor=(0.99, 1.08))
fig.suptitle("Adaptive A* relative to A*: published vs reproduced (negative = better)",
             color=INK2, x=0.01, ha="left", y=1.06)
plt.show()
"""),
        md("""
## 9. Robustness on random maps (multiple runs)
The algorithms are deterministic, so the meaningful "multiple runs" vary the **map**. We use the same calibrated generators with **unseen seeds**: 50 maps per scene type, 150 in total. Each method is compared with A\\* on the same map using the paired **Wilcoxon signed-rank test**.
"""),
        code("""
ROB_PAIRS = {"map1": (2, 2, 28, 28), "map2": (2, 2, 58, 58), "map3": (2, 2, 99, 99)}
rob_rows = []
for map_id, (sx, sy, gx, gy) in ROB_PAIRS.items():
    params = {k: tuple(v) if isinstance(v, list) else v for k, v in CALIBRATION[map_id]["params"].items()}
    seed, made = 0, 0
    while made < ROBUST_MAPS:
        seed += 1
        grid = make_map(map_id, 900_000 + seed, **params)
        if grid is None:
            continue
        made += 1
        s, t = from_paper(sx, sy), from_paper(gx, gy)
        for name in ("A*", "Redundant point deletion", "Adaptive A*"):
            spec = PLANNERS[name]
            res = spec.plan(grid, s, t)
            tm = time_planner(spec, grid, s, t, repeats=5)
            rob_rows.append({"map": map_id, "seed": 900_000 + seed, "algorithm": name, "time_s": tm["time_median"],
                             "length_m": res.length, "expanded_nodes": res.expanded,
                             "corners_ge45": res.corners, "raw_cost": res.raw_cost})
ROB = pd.DataFrame(rob_rows)
print(f"{ROB.groupby(['map', 'seed']).ngroups} random maps evaluated ({ROBUST_MAPS} per scene type)")
"""),
        code("""
summary = []
for map_id in ROB_PAIRS:
    base = ROB[(ROB["map"] == map_id) & (ROB["algorithm"] == "A*")].set_index("seed")
    for name in ("Redundant point deletion", "Adaptive A*"):
        other = ROB[(ROB["map"] == map_id) & (ROB["algorithm"] == name)].set_index("seed")
        for m in METRICS:
            a, b = base[m].to_numpy(float), other.loc[base.index, m].to_numpy(float)
            change = b - a if m == "length_m" else 100 * (b - a) / a
            p = wilcoxon(a, b).pvalue if np.any(a != b) else 1.0
            summary.append({"map": map_id, "method": "A* + pruning" if name != "Adaptive A*" else name,
                            "metric": m, "mean change": change.mean(), "std": change.std(ddof=1),
                            "better/equal/worse": f"{(b < a).sum()}/{(b == a).sum()}/{(b > a).sum()}",
                            "Wilcoxon p": p})
display(pd.DataFrame(summary).style.format({"mean change": "{:+.2f}", "std": "{:.2f}", "Wilcoxon p": "{:.2g}"}))

# Where do the length gains come from?
a = ROB[ROB["algorithm"] == "A*"].set_index(["map", "seed"])
b = ROB[ROB["algorithm"] == "Adaptive A*"].set_index(["map", "seed"])
c = ROB[ROB["algorithm"] == "Redundant point deletion"].set_index(["map", "seed"])
gap = 100 * (b["raw_cost"] - a["raw_cost"]) / a["raw_cost"]
diff = b["length_m"] - c["length_m"]
display(pd.DataFrame({
    "raw Adaptive A* path suboptimal (maps)": (gap > 1e-9).groupby(level=0).sum(),
    "mean / max suboptimality (%)": gap.groupby(level=0).agg(lambda g: f"{g.mean():.2f} / {g.max():.2f}"),
    "Adaptive A* longer than A*+pruning (maps)": (diff > 1e-9).groupby(level=0).sum(),
    "mean length difference (m)": diff.groupby(level=0).mean().round(2),
}))
"""),
        code("""
fig, axes = plt.subplots(1, 4, figsize=(14, 3.6))
for ax, m in zip(axes, METRICS):
    for k, (map_id, size) in enumerate((("map1", "30x30"), ("map2", "60x60"), ("map3", "100x100"))):
        base = ROB[(ROB["map"] == map_id) & (ROB["algorithm"] == "A*")].set_index("seed")[m]
        for j, (name, color) in enumerate((("Redundant point deletion", BLUE), ("Adaptive A*", ORANGE))):
            v = ROB[(ROB["map"] == map_id) & (ROB["algorithm"] == name)].set_index("seed")[m]
            change = (v - base) if m == "length_m" else 100 * (v - base) / base
            bp = ax.boxplot(change.to_numpy(), positions=[k * 1.2 + j * 0.42], widths=0.34, patch_artist=True,
                            medianprops={"color": INK}, flierprops={"marker": "o", "ms": 2.5,
                                                                    "mfc": color, "mec": color})
            bp["boxes"][0].set(facecolor=color, edgecolor=color, alpha=0.85)
    ax.set_xticks([k * 1.2 + 0.21 for k in range(3)], ["30x30", "60x60", "100x100"])
    ax.axhline(0, color=MUTED, lw=0.8)
    ax.set_title({"time_s": "Time (% vs A*)", "length_m": "Length (m vs A*)",
                  "expanded_nodes": "Expanded nodes (% vs A*)", "corners_ge45": "Corners (% vs A*)"}[m])
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in (BLUE, ORANGE)]
fig.legend(handles, ["A* + pruning", "Adaptive A*"], frameon=False, ncol=2,
           loc="upper right", bbox_to_anchor=(0.99, 1.08))
fig.suptitle("Change relative to A* on random maps (negative = better)", color=INK2, x=0.01, ha="left", y=1.06)
plt.show()
"""),
        md("""
## 10. Sensitivity to the ambiguous pruning rule
Section 3.3 of the paper can be read in two ways:
- **anchor** (our default): the anchor node stays until line of sight is lost;
- **single-pass**: the window jumps forward after each deletion.

This choice changes the corner count noticeably.
"""),
        code("""
rows = []
for size, goal in (("30x30", (28, 28)), ("60x60", (58, 58)), ("100x100", (99, 99))):
    s, t = from_paper(2, 2), from_paper(*goal)
    a = PLANNERS["Adaptive A*"].plan(MAPS[size], s, t)
    b = PLANNERS["Adaptive A* (single-pass pruning)"].plan(MAPS[size], s, t)
    paper = PUBLISHED[(PUBLISHED["table"].isin(["T2", "T3", "T4"])) & (PUBLISHED["map"] == size)
                      & (PUBLISHED["algorithm"] == "Adaptive A*")].iloc[0]
    rows.append({"map": size, "corners anchor": a.corners, "corners single-pass": b.corners,
                 "corners paper": int(paper["corners_ge45"]), "length anchor": round(a.length, 2),
                 "length single-pass": round(b.length, 2), "length paper": paper["length_m"]})
display(pd.DataFrame(rows).set_index("map"))
"""),
        md("""
## 11. Summary

| Metric | Verdict |
|---|---|
| Path length | **Comparable** to the paper |
| Expanded nodes | **Same trend**, smaller on 30×30 and 100×100 |
| Planning time | **Lower** reduction than published; Python per-node overhead dominates on small maps |
| Corners | Larger reduction, caused by the pruning interpretation (Section 10), **not** a better method |

Over 150 random maps every claimed effect has the right sign and is statistically significant. Two further findings:
- The raw Adaptive A\\* path is **not optimal** on many maps, because the heuristic is inadmissible.
- **A\\* + pruning alone** is usually shorter than Adaptive A\\*. The length and smoothness gains therefore come mainly from the redundant point deletion, while the adaptive heuristic mainly buys search speed.

The full discussion, with every assumption and deviation, is in the repository: `docs/01_analysis_and_feasibility.md` and `docs/02_reproduction_results.md`.
"""),
    ]
    for i, cell in enumerate(cells):
        cell["id"] = f"cell-{i:02d}"
    return {"cells": cells,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)
