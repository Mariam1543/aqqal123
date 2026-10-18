"""Build kaggle/adaptive_astar_step_by_step.ipynb from the library sources.

The notebook is fully self-contained (no repository clone, no Internet): each
module of ``src/adaptive_astar`` becomes one explained code cell (copied
verbatim, minus package-relative imports), the maps digitised from the paper's
Fig. 5 and the paper's published numbers are embedded, and every experiment
runs in its own cell with its table and figure underneath.

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


def map_rows(stem: str) -> list[str]:
    """Rows of a digitised map CSV as '#'/'.' strings, top row first (as in the figure)."""
    lines = (ROOT / "maps" / f"{stem}.csv").read_text().split()
    return ["".join("#" if v == "1" else "." for v in line.split(",")) for line in lines]


def map3_lattice() -> tuple[list[int], list[int], list[tuple[int, int]]]:
    """Lower-left corners (paper coordinates) of the 5x5 blocks of the digitised map3."""
    import numpy as np
    from scipy import ndimage
    occ = np.loadtxt(ROOT / "maps" / "paper_map3.csv", delimiter=",", dtype=int)[::-1].astype(bool)
    objs = ndimage.find_objects(ndimage.label(occ)[0])
    xs = sorted({o[1].start + 1 for o in objs})
    ys = sorted({o[0].start + 1 for o in objs})
    present = {(o[1].start + 1, o[0].start + 1) for o in objs}
    missing = [(x, y) for x in xs for y in ys if (x, y) not in present]
    rebuilt = np.zeros_like(occ)
    for x in xs:
        for y in ys:
            if (x, y) not in missing:
                rebuilt[y - 1:y + 4, x - 1:x + 4] = True
    assert np.array_equal(rebuilt, occ), "map3 is not a pure 5x5 block lattice"
    return xs, ys, missing


def digitiser_code() -> str:
    """Constants and functions of scripts/digitize_figure5.py (without file output)."""
    text = (ROOT / "scripts" / "digitize_figure5.py").read_text()
    return text[text.index("# Pixel geometry of the three panels"):text.index("def save(occ_top_down")].strip() + "\n"


def calibration() -> dict:
    calib = json.loads((ROOT / "maps" / "calibration.json").read_text())
    return {m: {"seed": calib[m]["seed"], "params": calib[m]["params"]} for m in ("map1", "map2", "map3")}


def build() -> dict:
    calib = calibration()
    m3 = map3_lattice()
    cells = [
        md("""
# Adaptive A\\* for Mobile-Robot Global Path Planning — Independent Re-Implementation and Reproduction Study

| | |
|---|---|
| **Student** | *Your name* — *Roll number* |
| **Course** | *Course name* — Assignment 1: Research Paper Re-Implementation |
| **Paper** | H. Cao, Z. Guo, Y. Zhang, Z. Lu, and L. Jiang, "An Adaptive A\\* Algorithm for Mobile Robots Global Path Planning," *Electronics*, vol. 15, no. 13, Art. 2807, 2026, doi: 10.3390/electronics15132807 |
| **Source code of the paper** | Not publicly available; everything below was written independently from the paper |

The notebook runs top to bottom with **Run All**: CPU only, no Internet, no uploaded files.
"""),
        md("""
## What is our own work in this notebook?

The paper gives only equations, a short description and result tables. **Everything below was produced by us:**

| # | Our contribution | Where |
|---|---|---|
| 1 | Read and analysed the paper: problem, method, data, feasibility and what is missing (assignment Q1–Q7) | Part 0 |
| 2 | **Wrote the whole implementation from scratch:** grid model, A\\* (Algorithm 1), adaptive weight (Eq. 6), hybrid heuristic (Eq. 7), redundant point deletion (Sec. 3.3), Dijkstra, bidirectional A\\*, an exact line-of-sight test, the metrics | Part 2 |
| 3 | Made and documented every decision the paper leaves open (17 missing details → explicit assumptions) | Parts 0 and 2 |
| 4 | Wrote correctness tests | Part 3 |
| 5 | **Digitised the paper's maps from its Fig. 5** (published only as a picture). Our baseline A\\* and Dijkstra on these maps reproduce the paper's node counts almost exactly, which also revealed two settings the paper never states | Part 4 |
| 6 | **Audited the paper's published numbers** and found internal contradictions: e.g. several percentages in the text do not match its tables, two rows of Table 1 are swapped, and a Table 5 start cell is an obstacle in its own figure | Parts 5 and 6 |
| 7 | Reproduced every experiment of Tables 1–5 and compared each row with the paper | Parts 6 and 8 |
| 8 | **Added experiments the paper does not have:** A\\* + pruning and octile baselines, a paired timing study, 150 random maps with Wilcoxon tests, and an optimality check. We also identified what the authors most likely ran: their published Adaptive A\\* numbers match the hybrid heuristic **without** the ½ of Eq. 7 | Parts 7, 9 and 10 |
| 9 | Critical analysis: comparable / improved / lower, with technical justification | Part 11 |

### Why does it run in a few minutes?
This is a **classical graph-search algorithm**, not deep learning: there is no training. One A\\* search on a 30×30 to 100×100 grid takes about 0.5–15 ms in Python. The paper itself reports 0.01–1.93 s per search in MATLAB.

A full run of this notebook executes roughly **6,000 searches**:
- about 1,400 for Tables 1–5 (30 timing repeats each);
- 1,800 for the paired timing study;
- 2,700 for the 150-map robustness study.

Digitising the maps from Fig. 5 was done beforehand; the digitised maps are embedded in Part 4. With Internet access, Part 4.1 re-runs the digitiser on the figure and confirms it gives exactly the same maps.
"""),
        md("""
## 0. Paper analysis and feasibility (assignment Section 3)

**Q1. Problem, objectives, contributions.**

*Problem.* Conventional A\\* for global path planning on a grid is slow (many expanded nodes), adapts poorly to different maps (one fixed distance metric), and produces jagged paths with many sharp turns.

*Objective.* Shorter planning time, shorter and smoother paths.

*Contributions claimed by the paper:*
1. An **adaptive estimation function** f = g + ω(n)·h with ω = ln(1 + e^(d/D)).
2. A **hybrid distance model** h = (Euclidean + Manhattan)/2.
3. A **redundant point deletion** step based on collinearity and obstacle checks.

The paper reports, versus A\\*: 69% less time, 2.66 m shorter paths, and 38.1% fewer turns ≥ 45°.

**Q2. Methodology.** A grid map with 1 m cells. A\\* search with the weighted hybrid heuristic produces a raw grid path, and redundant point deletion turns it into the final path. The evaluation uses four metrics: time, length, expanded nodes, and corners ≥ 45°.

**Q3. Dataset.** There is no dataset, only three hand-made grid maps (30×30, 60×60, 100×100) with given start/goal points. **They are not publicly available**; they appear only as a figure (Fig. 5), which we digitised (Part 4).

**Q4. Tools and resources.**
- *Paper:* MATLAB R2023b on an Intel i5 laptop with 16 GB RAM.
- *Ours:* Python with NumPy, pandas, SciPy and Matplotlib, on CPU only. No GPU is needed.

**Q5. Feasibility.** Highly feasible: the method is deterministic and cheap, with no training. The main obstacles are the missing maps and the two baselines (Chen et al., Zhang et al.), which the paper does not describe.

**Q6. Enough detail?** Partly. The equations are clear, so the method and its trends can be reproduced. The exact numbers cannot, because the maps, several definitions and the test protocol are missing.

**Q7. Missing, unclear or hard to reproduce** (each becomes an assumption in Part 2):
- *Maps and motion model:* the obstacle maps; 4- vs 8-connected moves; whether diagonal moves may cut corners.
- *Definitions:* which distance d and D use; what "traversed nodes" means; the corner definition; how path length is measured.
- *Algorithm details:* the tie-breaking rule; the line-of-sight test and pruning order used for deletion.
- *Protocol:* the number of timing runs.
- *Baselines:* the Chen / Zhang methods; whether the ablation rows are isolated or cumulative.

**We also found** (see Parts 2.2, 5.1, 6 and 10):
- The hybrid heuristic **overestimates** the true 8-connected cost by up to 20.7%, so it is not admissible and optimality is lost. This is computed in Part 2.2.
- The paper's own numbers contain contradictions. These are audited in Part 5.
- The paper's published Adaptive A\\* numbers are reproduced only if the ½ of Eq. 7 is dropped in the full method (Part 10).
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
import gc, heapq, io, itertools, math, os, platform, statistics, time
from collections import deque
from dataclasses import dataclass, field, replace
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
## 2. Implementation (written by us from the paper)

**Our implementation decisions.** These are needed wherever the paper is silent; each is applied to *every* planner alike.

| ID | Topic | Paper | Our choice |
|---|---|---|---|
| D1 | Maps | Figure only | Digitised from Fig. 5 (Part 4) |
| D2 | Motion | Not stated | 8-connected, cost 1 / √2, **diagonal corner cutting allowed**. Inferred: only this reproduces the paper's A\\* / Dijkstra node counts |
| D3 | Baseline heuristic | "Traditional" | Euclidean (admissible, so our A\\* baseline is optimal) |
| D4 | d, D in Eq. 6 | Not stated | Euclidean distances |
| D5 | Ties in OPEN | Not stated | Lower f, then lower h, then first-in-first-out (deterministic) |
| D6 | Line of sight | Not stated | **Bresenham** raster line. Inferred: reproduces the paper's pruned path lengths (the stricter test is kept as an option) |
| D7 | Pruning order | Ambiguous | Anchor-based three-node window (alternative tested in Part 10) |
| D8 | Path length | Not stated | Euclidean length of the final polyline |
| D9 | Timing | One value at 0.01 s resolution | Median of 30 runs, plus a paired study (Part 7) |
| D10 | Chen / Zhang baselines | Not described | Compared on their published numbers only |
| D11 | Table 5 start (4,24) | Obstacle in the paper's own figure | That single cell is freed for that experiment only |
| D12 | Full method | Eqs. 5–7 | Main results use the equations **exactly as printed**. The variant without the ½ of Eq. 7 ("V4") is reported separately because it matches the published numbers |

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
- **Step 3:** otherwise, connect P*i* to P*i*+2. If that straight line touches no obstacle cell (*line-of-sight* test), delete the middle node; if it does, keep it.

The paper's Fig. 4 keeps node A fixed while B is deleted and C advances, so we implement an **anchor-based** window. The line-of-sight test can be the strict "supercover" test or a Bresenham raster line; the paper's numbers indicate Bresenham (Part 4).
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
## 4. Maps: digitised from the paper's Fig. 5 (our reconstruction)

The paper publishes its three maps **only as a picture** (Fig. 5). We converted that picture into occupancy grids ourselves:

| Map | Pixels per cell | How we digitised it |
|---|---|---|
| 30×30 (irregular) | ≈ 4.9 | Each cell classified by the mean blackness around its centre. Red start / blue goal cells are not black, so they stay free |
| 60×60 (maze) | ≈ 2.45 | Cell pitch fixed exactly by the two black border walls; each cell centre sampled on a 10× upsampled image |
| 100×100 (array) | ≈ 1.49 | Too fine for per-cell sampling, so each dark block (all 5×5 cells) is detected as a whole. Block groups were then refined by ±1 cell, using **only baseline** statistics |

**Validation (next cells).** On these maps our *baseline* A\\* and Dijkstra reproduce the paper's published numbers almost exactly. For example: A\\* 130 vs 130 nodes, 715 vs 716, and 2188 vs 2191; Dijkstra 633 vs 632, 1741 vs 1740, and 7521 vs 7520. The Table 5 pair (4,24)→(29,2) gives 38.21 m / 250 nodes / 14 corners, identical to the paper.

This also **resolves two settings the paper never states:**
- Diagonal moves may cut obstacle corners. Without corner cutting the node counts do not match.
- Pruning uses a Bresenham line of sight. This reproduces the paper's pruned path lengths.

The random maps of Part 9 still come from our procedural generators (code below).
"""),
        code(module("maps")),
        code(f"""
# ---- Our digitisation of Fig. 5 (scripts/digitize_figure5.py). '#' = obstacle; first row = top of the figure.
MAP1_ROWS = {json.dumps(map_rows("paper_map1"), indent=4)}

MAP2_ROWS = {json.dumps(map_rows("paper_map2"), indent=4)}

# map3 is a regular lattice of 5x5-cell blocks; lower-left corners in paper coordinates
MAP3_XS = {m3[0]}
MAP3_YS = {m3[1]}
MAP3_MISSING = {set(map(tuple, m3[2]))}

CORNER_CUTTING = True    # inferred: with it, A* and Dijkstra reproduce the paper's node counts
LOS = "bresenham"        # inferred: reproduces the paper's pruned path lengths

def grid_from_rows(rows, name):
    occ = np.array([[ch == "#" for ch in row] for row in rows])[::-1]     # internal grids are bottom-up
    return GridMap(occ, allow_corner_cutting=CORNER_CUTTING, name=name)

def map3_grid():
    occ = np.zeros((100, 100), dtype=bool)
    for x in MAP3_XS:
        for y in MAP3_YS:
            if (x, y) not in MAP3_MISSING:
                occ[y - 1:y + 4, x - 1:x + 4] = True
    return GridMap(occ, allow_corner_cutting=CORNER_CUTTING, name="paper_map3")

MAPS = {{"30x30": grid_from_rows(MAP1_ROWS, "paper_map1"), "60x60": grid_from_rows(MAP2_ROWS, "paper_map2"),
        "100x100": map3_grid()}}
for size, grid in MAPS.items():
    print(size, grid)
"""),
        code("""
# Palette and a helper that draws a map with explored cells and a path
INK, INK2, MUTED, SURFACE, GRID_LINE = "#0b0b0b", "#52514e", "#8a8984", "#fcfcfb", "#e4e3df"
OBSTACLE, EXPLORED, BLUE, ORANGE = "#3a3936", "#cde2fb", "#2a78d6", "#eb6834"
plt.rcParams.update({"font.size": 9, "axes.titlesize": 9.5, "axes.edgecolor": GRID_LINE,
                     "figure.facecolor": "white", "axes.facecolor": SURFACE})

def free_start(grid, cell):
    \"\"\"Table 5 starts at (4, 24) on map1, which is an obstacle in the paper's own Fig. 5
    (the paper planned from it anyway). We free that single cell for that experiment only.\"\"\"
    if grid.is_free(*cell):
        return grid
    occ = grid.occ.copy(); occ[cell[1], cell[0]] = False
    return GridMap(occ, allow_corner_cutting=grid.allow_corner_cutting, name=grid.name)

def plan(name, grid, start, goal):
    s, t = from_paper(*start), from_paper(*goal)
    return replace(PLANNERS[name], los=LOS).plan(free_start(grid, s), s, t)

def draw(ax, grid, start, goal, planner=None, title="", color=BLUE):
    res = plan(planner, grid, start, goal) if planner else None
    grid = free_start(grid, from_paper(*start))
    img = np.zeros(grid.occ.shape, dtype=int)
    if res:
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
    draw(ax, MAPS[size], (2, 2), goal, title=f"Digitised paper map {size}")
plt.show()
"""),
        code("""
# Validation: our baseline planners on the digitised maps vs the paper's published numbers
CHECKS = [  # (table, map, start, goal, algorithm, paper length, paper nodes, paper corners)
    ("T2", "30x30", (2, 2), (28, 28), "Dijkstra", 40.30, 632, 11), ("T2", "30x30", (2, 2), (28, 28), "A*", 40.41, 130, 9),
    ("T3", "60x60", (2, 2), (58, 58), "Dijkstra", 92.10, 1740, 13), ("T3", "60x60", (2, 2), (58, 58), "A*", 92.30, 716, 12),
    ("T4", "100x100", (2, 2), (99, 99), "Dijkstra", 146.41, 7520, 31), ("T4", "100x100", (2, 2), (99, 99), "A*", 146.56, 2191, 34),
    ("T5", "30x30", (28, 28), (2, 2), "A*", 40.30, 202, 13), ("T5", "30x30", (4, 24), (29, 2), "A*", 38.21, 250, 14),
    ("T5", "60x60", (58, 58), (2, 2), "A*", 92.08, 898, 19), ("T5", "60x60", (4, 54), (59, 2), "A*", 118.49, 1159, 27),
]
rows = []
for table, size, s, g, alg, pl, pn, pc in CHECKS:
    r = plan(alg, MAPS[size], s, g)
    rows.append({"table": table, "map": size, "start->goal": f"{s}->{g}", "algorithm": alg,
                 "length paper": pl, "length ours": round(r.length, 2),
                 "nodes paper": pn, "nodes ours": r.expanded, "corners paper": pc, "corners ours": r.corners})
display(pd.DataFrame(rows))
"""),
        md("""
### 4.1 Our digitiser
This is the code that produced the maps above from the paper's figure. With Internet access, the next cell downloads the figure from the project repository, re-digitises it, and checks that the result is identical to the embedded maps. Without Internet it is skipped.
"""),
        code("from PIL import Image\nfrom scipy import ndimage\n\n" + digitiser_code()),
        code("""
FIG5_URL = ("https://raw.githubusercontent.com/Mariam1543/aqqal123/claude/relaxed-johnson-4f4051/"
            "adaptive-astar-reimplementation/data/paper_figure5_maps.png")
try:
    import urllib.request
    request = urllib.request.Request(FIG5_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as resp:
        fig5 = Image.open(io.BytesIO(resp.read()))
except Exception as exc:
    fig5 = None
    print("Figure not downloaded (no Internet?) - digitiser check skipped:", type(exc).__name__)
if fig5 is not None:
    bk = blackness(fig5)
    redone = {"30x30": digitise_map1(bk)[::-1], "60x60": digitise_map2(fig5)[::-1], "100x100": digitise_map3(bk)[::-1]}
    for size, occ in redone.items():
        print(f"{size}: re-digitised map identical to the embedded map -> {np.array_equal(occ, MAPS[size].occ)}")
    plt.figure(figsize=(9, 3.5)); plt.imshow(fig5); plt.axis("off"); plt.title("Paper Fig. 5 (input of the digitiser)"); plt.show()
"""),
        code(f"""
# Generator parameters for the random maps of Part 9 (calibrated earlier; see scripts/calibrate_maps.py)
CALIBRATION = {json.dumps(calib, indent=4)}
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
### 5.1 Our audit of the paper's published numbers
Before comparing against the paper, we checked whether its own numbers are internally consistent.
"""),
        code("""
# (a) Abstract claims recomputed from Tables 2-4
t = PUBLISHED[PUBLISHED["table"].isin(["T2", "T3", "T4"])].set_index(["map", "algorithm"])
maps = ["30x30", "60x60", "100x100"]
time_red = np.mean([100 * (t.loc[(m, "A*"), "time_s"] - t.loc[(m, "Adaptive A*"), "time_s"]) / t.loc[(m, "A*"), "time_s"] for m in maps])
len_red = np.mean([t.loc[(m, "A*"), "length_m"] - t.loc[(m, "Adaptive A*"), "length_m"] for m in maps])
cor_red = np.mean([100 * (t.loc[(m, "A*"), "corners_ge45"] - t.loc[(m, "Adaptive A*"), "corners_ge45"]) / t.loc[(m, "A*"), "corners_ge45"] for m in maps])
print(f"Abstract: 69% time, 2.66 m, 38.1% corners  ->  recomputed: {time_red:.2f}%, {len_red:.2f} m, {cor_red:.1f}%  (consistent)")

# (b) Claims in the text vs the paper's own tables
def pct(a, b):
    return 100 * (a - b) / a
claims = pd.DataFrame([
    ("T1 30x30: adaptive weight 'nodes dropped to 86.2%'", "86.2%", f"{pct(130, 118):.1f}% drop (130 -> 118)"),
    ("T2: Dijkstra 'increase of 79.4%' nodes vs A*", "+79.4%", f"+{100 * (632 - 130) / 130:.0f}% (79.4% is the reduction relative to Dijkstra)"),
    ("T5 60x60 swapped: time reduction '88.9%'", "88.9%", f"{pct(0.25, 0.04):.1f}% (0.25 -> 0.04 s)"),
    ("T5 30x30 swapped: node reduction '86.8%'", "86.8%", f"{pct(202, 43):.1f}% (202 -> 43); 86.8% is the random-pair row"),
], columns=["Statement in the paper", "Stated", "Computed from the paper's own table"])
display(claims)

# (c) Optimality check: an admissible A* must give the same length as Dijkstra, in both directions
rows = []
for m in maps:
    rows.append({"map": m, "paper A* length": t.loc[(m, "A*"), "length_m"],
                 "paper Dijkstra length": t.loc[(m, "Dijkstra"), "length_m"],
                 "A* longer than Dijkstra?": t.loc[(m, "A*"), "length_m"] > t.loc[(m, "Dijkstra"), "length_m"]})
display(pd.DataFrame(rows).set_index("map"))
t5 = PUBLISHED[(PUBLISHED["table"] == "T5") & (PUBLISHED["algorithm"] == "A*")]
print("A* length when start and goal are swapped (should be identical to the forward run):")
print(f"  30x30: forward 40.41 vs swapped {t5.iloc[0]['length_m']:.2f};  60x60: forward 92.30 vs swapped {t5.iloc[2]['length_m']:.2f}")

# (d) Can the published lengths be built from 8-connected grid steps (1 and sqrt 2)?
def is_grid_length(L, dx, dy, tol=0.01):
    for b in range(0, 400):
        a = L - b * math.sqrt(2)
        if a < -tol:
            return False
        A = round(a)
        if abs(a - A) <= tol and A + 2 * b >= dx + dy and A + b >= max(dx, dy) and (A - dx - dy) % 2 == 0:
            return True
    return False
checks = [(m, alg, t.loc[(m, alg), "length_m"], d) for m, d in (("30x30", 26), ("60x60", 56), ("100x100", 97))
          for alg in ("A*", "Dijkstra")]
display(pd.DataFrame([{"map": m, "algorithm": a, "published length": L, "valid 8-connected grid length?": is_grid_length(L, d, d)}
                      for m, a, L, d in checks]))
print("Conclusion: the paper's baseline A* is not optimal under its own length metric, and its length metric is "
      "not plain grid-step cost -> exact lengths cannot be matched; we compare changes relative to A*.")

# (e) Table 5 starts at (4, 24) on map1 - is that cell free in the paper's own Fig. 5?
print("\\nTable 5 start (4, 24) is free in the digitised Fig. 5:", MAPS["30x30"].is_free(*from_paper(4, 24)),
      "-> the paper planned from an obstacle cell (we free that one cell for that experiment).")
"""),
        md("""
## 6. Experiments

Each experiment runs on the digitised paper maps with the paper's start/goal points, corner cutting allowed and Bresenham line of sight (D2, D6).
- **Length, nodes and corners** are deterministic, identical on every run and every machine.
- **Time** is the median of repeated runs. The paper used MATLAB and we use Python, so absolute times are not comparable. We compare the **change relative to A\\*** instead.
"""),
        code("""
METRICS = ["time_s", "length_m", "expanded_nodes", "corners_ge45"]
PUBLISHED_ONLY = {"Chen et al. [29]", "Zhang et al. [31]"}   # not described in the paper -> published numbers only

def run_case(name, size, start, goal):
    spec = replace(PLANNERS[name], los=LOS)
    s, t = from_paper(*start), from_paper(*goal)
    grid = free_start(MAPS[size], s)
    res = spec.plan(grid, s, t)
    timing = time_planner(spec, grid, s, t, repeats=TIMING_REPEATS)
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
        md("""
**Observation — two rows of the paper's Table 1 (60×60) appear to be swapped.**

On 30×30 our isolated components match the paper almost exactly: adaptive weight 119 vs 118 nodes, and hybrid distance 46 vs 45 nodes with 41.46 vs 41.45 m.

On 60×60, however, our *adaptive-weight* row matches the paper's *distance-model* row, and vice versa:
"""),
        code("""
t1 = pd.concat(ALL_RESULTS)
t1 = t1[(t1["table"] == "T1") & (t1["map"] == "60x60")].set_index("algorithm")
p1 = PUBLISHED[(PUBLISHED["table"] == "T1") & (PUBLISHED["map"] == "60x60")].set_index("algorithm")
display(pd.DataFrame({
    "paper nodes": [p1.loc["Adaptive estimation function", "expanded_nodes"], p1.loc["Distance model optimization", "expanded_nodes"]],
    "our nodes, same row": [t1.loc["Adaptive estimation function", "expanded_nodes"], t1.loc["Distance model optimization", "expanded_nodes"]],
    "our nodes, other row": [t1.loc["Distance model optimization", "expanded_nodes"], t1.loc["Adaptive estimation function", "expanded_nodes"]],
}, index=["paper row: Adaptive estimation function", "paper row: Distance model optimization"]))
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
COMPARISON = ["A*", "Dijkstra", "Bidirectional A*", "Adaptive A*", "Redundant point deletion", "A*+Octile+RPD",
              "Adaptive A* (V4: E+M without 1/2)"]
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
    ALL_RESULTS.append(experiment("T5", size, start, goal, ["A*", "Adaptive A*", "Adaptive A* (V4: E+M without 1/2)"]))
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
    a_spec, b_spec = PLANNERS["A*"], replace(PLANNERS["Adaptive A*"], los=LOS)
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
        grid.allow_corner_cutting = CORNER_CUTTING        # same settings as the paper maps
        made += 1
        s, t = from_paper(sx, sy), from_paper(gx, gy)
        for name in ("A*", "Redundant point deletion", "Adaptive A*"):
            spec = replace(PLANNERS[name], los=LOS)
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
## 10. What did the authors actually run? (sensitivity analysis)

Our implementation follows Eqs. 5–7 **exactly as printed**. On the digitised maps, the baselines and each improvement *alone* reproduce the paper almost exactly (Parts 4 and 6.1). The **full** Adaptive A\\* is the exception: it expands clearly more nodes than published.

The table tests the two remaining ambiguities on every published Adaptive A\\* case:
- **(i) Pruning order:** anchor-based vs single-pass three-node window.
- **(ii) Heuristic:** Eq. 7 as printed, (E+M)/2, vs **V4**, E+M without the ½.
"""),
        code("""
VARIANTS = {
    "as printed": PlannerSpec("x", heuristic="hybrid", adaptive=True, prune=True, los=LOS),
    "as printed, single-pass": PlannerSpec("x", heuristic="hybrid", adaptive=True, prune=True, prune_mode="single-pass", los=LOS),
    "V4 (E+M)": PlannerSpec("x", heuristic="hybrid_sum", adaptive=True, prune=True, los=LOS),
    "V4, single-pass": PlannerSpec("x", heuristic="hybrid_sum", adaptive=True, prune=True, prune_mode="single-pass", los=LOS),
}
rows = []
for _, r in PUBLISHED[PUBLISHED["algorithm"] == "Adaptive A*"].iterrows():
    s = from_paper(*map(int, r["start"].split(";"))); t = from_paper(*map(int, r["goal"].split(";")))
    grid = free_start(MAPS[r["map"]], s)
    row = {"case": f"{r['table']} {r['map']} {r['start']}->{r['goal']}",
           "paper N / L / C": f"{r['expanded_nodes']} / {r['length_m']:.2f} / {r['corners_ge45']}"}
    for name, spec in VARIANTS.items():
        res = spec.plan(grid, s, t)
        row[name] = f"{res.expanded} / {res.length:.2f} / {res.corners}"
    rows.append(row)
display(Markdown("Each cell: expanded nodes / path length (m) / corners >= 45 deg"))
display(pd.DataFrame(rows).set_index("case"))
"""),
        code("""
# Headline metrics again, now for V4 (cf. Part 8). Time here is the 30-run median.
v4 = RESULTS[RESULTS["table"].isin(["T2", "T3", "T4"])]
rows = []
for label, metric, unit in (("planning-time reduction", "time_s", "%"), ("path-length reduction", "length_m", "m"),
                            ("expanded-node reduction", "expanded_nodes", "%"), ("corners >= 45 deg reduction", "corners_ge45", "%")):
    vals = []
    for size in ("30x30", "60x60", "100x100"):
        r = v4[v4["map"] == size].set_index("algorithm")
        a, b = r.loc["A*", metric], r.loc["Adaptive A* (V4: E+M without 1/2)", metric]
        vals.append(a - b if unit == "m" else 100 * (a - b) / a)
    p = mean_reduction(paper_tab, metric)[0]
    rows.append({"metric": label, "published": f"{p:.2f} m" if unit == "m" else f"{p:.1f}%",
                 "V4 (ours)": f"{np.mean(vals):.2f} m" if unit == "m" else f"{np.mean(vals):.1f}%"})
display(pd.DataFrame(rows).set_index("metric"))
"""),
        md("""
**Reading the table:**
- **Expanded nodes.** With V4 they match the published Adaptive A\\* closely on every case (e.g. 40 vs 36, 261 vs 268, 114 vs 113, 35 vs 33). With the equations as printed they do not (66, 370, 448, 93). So the authors' full method most likely used E+M without the ½, even though Eq. 7 and their isolated distance-model row both use the ½.
- **Path lengths.** They are close to the paper with both readings.
- **Corners.** The paper's counts sit between the anchor and single-pass pruning readings, and no single reading reproduces all of them. The pruning step is under-specified.
"""),
        md("""
### 10.1 Second line of evidence: the paper's own result figures

The paper's Figs. 8 and 9 shade every expanded cell grey. Classifying each cell of those panels (repository script `scripts/compare_paper_figures.py`) gives:

| Paper panel | Our planner | Our nodes | Paper-explored cells we also expand | Cells we expand that the paper did **not** |
|---|---|---|---|---|
| Fig. 8(a) 30×30 | A\\* | 130 | 99/99 (100%) | **0** |
| Fig. 8(b) 30×30 | Dijkstra | 633 | 600/600 (100%) | **0** |
| Fig. 8(f) 30×30 | Adaptive A\\*, Eqs. as printed | 66 | 12/18 | 29 |
| Fig. 8(f) 30×30 | Adaptive A\\*, **V4** | 40 | 13/18 | **2** |
| Fig. 9(a) 60×60 | A\\* | 715 | (grid lines blur the shading) | **0** |
| Fig. 9(f) 60×60 | Adaptive A\\*, Eqs. as printed | 370 | (grid lines blur the shading) | 122 |
| Fig. 9(f) 60×60 | Adaptive A\\*, **V4** | 261 | (grid lines blur the shading) | **2** |

- A\\* and Dijkstra reproduce the paper's shaded regions cell for cell.
- For Adaptive A\\*, only V4 stays inside the paper's explored region.

The figure below (downloaded from the repository if Internet is on) puts the paper's panels next to ours.
"""),
        code("""
PANELS_URL = ("https://raw.githubusercontent.com/Mariam1543/aqqal123/claude/relaxed-johnson-4f4051/"
              "adaptive-astar-reimplementation/figures/paper_maps/fig_paper_vs_ours_panels.png")
try:
    import urllib.request
    request = urllib.request.Request(PANELS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as resp:
        panels = Image.open(io.BytesIO(resp.read()))
    plt.figure(figsize=(12, 8.5)); plt.imshow(panels); plt.axis("off"); plt.show()
except Exception as exc:
    print("Comparison figure not downloaded (no Internet?):", type(exc).__name__)
"""),
        md("""
## 11. Critical analysis (assignment Section 6)

**What reproduces exactly.** On the digitised maps, every *baseline* number of the paper is reproduced almost exactly:
- A\\* nodes: 130 vs 130, 715 vs 716, 2188 vs 2191.
- Dijkstra nodes: 633 vs 632, 1741 vs 1740, 7521 vs 7520.
- Table 5 random pair: 38.21 m / 250 nodes / 14 corners, identical to the paper.
- Each improvement *alone*: adaptive weight 119 vs 118 nodes; hybrid distance 46 vs 45 nodes and 41.46 vs 41.45 m.

This confirms that the maps, the motion model and our implementation of every building block are faithful.

**The full method, verdict per metric.** Values are the mean over Tables 2–4, Adaptive A\\* vs A\\*; Part 8 shows the as-printed numbers and Part 10 the V4 numbers.

| Metric | Published | Ours, Eqs. 5–7 as printed | Ours, V4 (E+M, no ½) | Verdict |
|---|---|---|---|---|
| Expanded nodes | −76.6% | ≈ −59% | ≈ −76% | **(C)** as printed; **(A)** with V4 |
| Path length | −2.66 m | ≈ −3.7 m | ≈ −2.9 m | **(A)** comparable; slightly better, caused by the pruning reading |
| Planning time | −68.7% | ≈ −40% (paired) | ≈ −59% | **(C)** lower, mostly a Python vs MATLAB effect |
| Corners ≥ 45° | −38.1% | ≈ −67% | ≈ −63% | **(B)** numerically, but from the pruning reading, not a better method |

**Overall: (A) comparable.** The paper's results are reproducible on its own maps, with one important qualification: the published Adaptive A\\* numbers correspond to E+M **without** the ½ of Eq. 7. This is confirmed independently by the node counts (Part 10) and by the explored regions drawn in the paper's Figs. 8 and 9 (Part 10.1). With the equations exactly as printed, the method is less greedy and saves fewer nodes.

**Technical justification of the remaining differences:**
- **Dataset.** We use our digitisation of Fig. 5, validated by the exact baseline matches. One start cell is an obstacle in the paper's own figure, so we free that cell for that experiment.
- **Settings and parameters.** The paper never states that corner cutting is allowed or which line-of-sight test it uses. Both were inferred from the published numbers. The pruning order is still ambiguous: our corner counts differ from the paper with either reading (Part 10).
- **Randomness.** Length, nodes and corners are deterministic and exactly repeatable. Time is the only noisy metric, so we report medians and a paired study with confidence intervals. Robustness is tested on 150 random maps with Wilcoxon tests.
- **Software and hardware.** MATLAB on an i5 laptop vs Python on a cloud CPU. On small maps Python's per-node overhead (computing ω) and the pruning step hide most of the saving: 30×30 runs in under 1 ms. On 100×100 our reduction (≈ 72%) exceeds the paper's 64%. The paper's 0.01 s timer resolution adds ±16 pp of uncertainty to its own percentages.
- **Missing details.** See Q7. In addition, the paper's text contradicts its tables in several places, and two Table 1 rows (60×60) are swapped (Parts 5.1 and 6.1).
- **Our deviations.** D1–D12 apply identically to every planner, and none favours the proposed method.

**What our reproduction adds beyond the paper:**
1. **The adaptive search is not optimal.** Its heuristic is inadmissible (it overestimates by up to 20.7%), and on random maps the raw Adaptive A\\* path is longer than optimal on many maps (Part 9).
2. **The length and smoothness gains come mostly from the pruning step.** A\\* + pruning alone is usually as short or shorter (Part 9); the paper's own Table 1 shows the same. The real benefit of the adaptive heuristic is **speed**.
3. **On published numbers alone**, Adaptive A\\* improves on A\\* more than Chen et al. and Zhang et al. do, so the paper's ranking holds.

## 12. Limitations and conclusion
**Limitations:**
- The maps are digitised from a 753×337 px screenshot. Maps 1 and 2 are cell-accurate (validated); map 3's block groups were placed using baseline statistics.
- Chen et al. and Zhang et al. were not re-implemented.
- Python timing is not directly comparable with MATLAB timing.
- Static grids only, as in the paper.

**Conclusion.** Re-implemented independently and run on the paper's own (digitised) maps, the baselines and each improvement reproduce the published numbers almost exactly. The full Adaptive A\\* reproduces the paper's claims (fewer nodes, faster on larger maps, shorter and smoother paths), and its published node counts are matched once the hybrid heuristic is used without the ½ of Eq. 7. Our additional experiments show that the adaptive heuristic trades optimality for speed, and that the redundant point deletion provides most of the path-quality improvement.
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
