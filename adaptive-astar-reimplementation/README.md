# Adaptive A\* for Mobile-Robot Global Path Planning — Independent Re-Implementation

Re-implementation and reproduction study of

> H. Cao, Z. Guo, Y. Zhang, Z. Lu, and L. Jiang, "An Adaptive A\* Algorithm for Mobile Robots Global Path Planning," *Electronics*, vol. 15, no. 13, Art. no. 2807, 2026, doi: 10.3390/electronics15132807.

No public source code exists for the paper. Everything in `src/` was written from the paper's equations and textual description. Only the Python standard library, NumPy, pandas, SciPy and Matplotlib are used, as generic tools.

## Repository layout

```
adaptive-astar-reimplementation/
├── src/adaptive_astar/        core library (independent implementation)
│   ├── grid.py                occupancy grid, 8-connected moves, paper <-> internal coordinates
│   ├── heuristics.py          Euclidean / Manhattan / Chebyshev / hybrid (Eq. 7), adaptive weight (Eq. 6)
│   ├── search.py              A* (Alg. 1, weighted f = g + w·h), Dijkstra, bidirectional A*
│   ├── smoothing.py           exact line-of-sight test + redundant point deletion (Sec. 3.3)
│   ├── metrics.py             path length, turn angles, corners >= 45°
│   ├── planners.py            named planners (ablation switches) + timing harness
│   └── maps.py                proxy-map generators (irregular / maze / array scenes)
├── scripts/
│   ├── calibrate_maps.py      builds maps/map{1,2,3}.csv calibrated to the paper's baseline statistics
│   ├── run_experiments.py     reproduces Tables 1-5, compares with the paper, robustness study
│   ├── timing_study.py        paired, interleaved timing of Adaptive A* vs A*
│   └── make_figures.py        all figures in figures/
├── data/published_results.csv every number of the paper's Tables 1-5
├── maps/                      proxy maps (CSV, top row = largest y) + calibration.json
├── results/                   reproduced_results.csv, comparison.{csv,md}, robustness.{csv,md}, environment.json
├── figures/                   PNG figures for the report
├── docs/                      01_analysis_and_feasibility.md, 02_reproduction_results.md
├── kaggle/                    step-by-step notebook (+ builder) and one-click runner notebook
└── tests/test_core.py         unit tests
```

## Setup

Requires Python 3.10 or newer (developed with 3.13).

```bash
cd adaptive-astar-reimplementation
python -m venv .venv && source .venv/bin/activate     # optional
pip install -r requirements.txt
```

## How to run

```bash
# 1. unit tests (about 1 s)
python -m unittest discover -s tests

# 2. (optional) rebuild the proxy maps; the calibrated maps are already in maps/
python scripts/calibrate_maps.py --budget-scale 4 --workers 4     # a few minutes

# 3. reproduce Tables 1-5 + 50-map robustness study (a few minutes)
python scripts/run_experiments.py --repeats 30 --robust-maps 50

# 4. paired timing study for the planning-time metric (about 1 min)
python scripts/timing_study.py --pairs 300

# 5. figures
python scripts/make_figures.py
```

Quick smoke run: `python scripts/run_experiments.py --repeats 3 --robust-maps 5`.

The tables are written to `results/comparison.md`. The discussion is in `docs/02_reproduction_results.md`.

## Headline results

Adaptive A\* vs A\*, mean over the three maps (Tables 2-4):

| Metric | Published | Reproduced |
|---|---|---|
| Planning-time reduction | 68.7% | 40.5% (paired timing) |
| Path-length reduction | 2.66 m | 2.72 m |
| Expanded-node reduction | 76.6% | 63.2% |
| Reduction of corners >= 45 deg | 38.1% | 84.4% |

Over 150 random maps, the direction of every effect is confirmed. The length and smoothness gains come from the pruning step, and the adaptive search alone is not optimal. Full analysis: `docs/02_reproduction_results.md` §7.

### Running on Kaggle

There are two notebooks in `kaggle/`. Both run on CPU only.

- **`adaptive_astar_step_by_step.ipynb` — recommended for submission.** It is fully self-contained: no Internet, no uploads, just *File → Import Notebook* and *Run All*. Every part of the method is in its own explained cell, and each experiment prints its paper-vs-ours table and figure underneath:
  1. grid model;
  2. adaptive weight (Eq. 6) and hybrid heuristic (Eq. 7);
  3. A\* / Dijkstra / bidirectional A\*;
  4. redundant point deletion;
  5. metrics;
  6. sanity checks;
  7. proxy maps rebuilt from their seeds;
  8. Tables 1–5;
  9. headline comparison;
  10. paired timing;
  11. 150-map robustness study with Wilcoxon tests;
  12. pruning sensitivity.

  A full run takes about 1–5 minutes; set `QUICK = True` for a smoke run. The code cells are generated from `src/` by `kaggle/build_step_by_step_notebook.py`, so they always match the tested library.
- `adaptive_astar_kaggle.ipynb` runs the repository scripts in one go. It clones the public repository (needs *Settings → Internet* on), or reads the folder uploaded as a Kaggle Dataset. Outputs go to `/kaggle/working/adaptive_astar_outputs.zip`.

Both notebooks were tested on Python 3.11 with an older library stack (numpy 1.26, pandas 2.2, scipy 1.13, matplotlib 3.8). Path length, expanded nodes and corners are identical on every machine. Planning times vary with the CPU, and the 30×30 time reduction varies the most, because that search takes under 1 ms.

### Using the library directly

```python
import sys; sys.path.insert(0, "src")
from adaptive_astar import GridMap, PLANNERS, from_paper

grid = GridMap.load_csv("maps/map1.csv")
res = PLANNERS["Adaptive A*"].plan(grid, from_paper(2, 2), from_paper(28, 28))
print(res.length, res.expanded, res.corners, res.path)
```

### Using your own (e.g. digitised) map

Save a 0/1 CSV, with 1 = obstacle and the top row as the top of the figure, to `maps/map1.csv`, `maps/map2.csv` or `maps/map3.csv`. Then re-run steps 3 and 4. Everything else stays the same.

## Configuration and parameters

| Parameter | Value | Source |
|---|---|---|
| Cell size | 1 m | paper Sec. 2.1 |
| Motion model | 8-connected, cost 1 / √2, no corner cutting | assumption (M2, M3) |
| Baseline heuristic | Euclidean | paper Sec. 3.2 ("traditional") (M5) |
| Adaptive weight | ω(n) = ln(1 + e^(d/D)), d and D Euclidean | Eq. (6) (M4) |
| Hybrid heuristic | (Euclidean + Manhattan) / 2 | Eq. (7) |
| Tie-breaking | lower f, then lower h, then FIFO | assumption (M8) |
| CLOSED nodes re-opened? | no | Algorithm 1 |
| "Expanded nodes" | size of the CLOSED list | assumption (M6) |
| Line-of-sight | exact supercover; touching an obstacle corner counts as blocked | assumption (M9) |
| Pruning order | anchor-based 3-node window | Sec. 3.3 (M10) |
| Path length | Euclidean polyline length of the final path | assumption (M16) |
| Corner | heading change ≥ 45° between consecutive segments | assumption (M7) |
| Timing | median of 30 runs, `perf_counter`, GC off, search + pruning | assumption (M11, M12) |
| Robustness | 50 unseen random maps per scene, Wilcoxon signed-rank | added |

Each assumption ID (M1–M17) is explained in `docs/01_analysis_and_feasibility.md`.

## Dataset

The paper uses three hand-made grid maps (30×30, 60×60, 100×100) that appear only as figures. They are **not available**. This repository therefore uses **proxy maps**: procedurally generated maps of the same size and scene type, chosen by `scripts/calibrate_maps.py`.

- The script searches thousands of seeded candidates and keeps the one whose **baseline** statistics are closest to the published values. Those statistics are Dijkstra's expanded nodes and length, A\* expanded nodes for every start/goal pair, and A\* corners.
- The proposed method is never used in calibration, so the maps are not tuned in its favour.
- The match achieved is recorded in `maps/calibration.json`.

## Baselines

| Baseline | Status |
|---|---|
| A\*, Dijkstra, Bidirectional A\* | Re-implemented |
| Chen et al. [29], Zhang et al. [31] | Not described in the paper; compared on their **published numbers only** |
| A\* + pruning, A\* + octile + pruning | Extra baselines added for a fair comparison |
