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
│   ├── smoothing.py           supercover / Bresenham line of sight + redundant point deletion (Sec. 3.3)
│   ├── metrics.py             path length, turn angles, corners >= 45°
│   ├── planners.py            named planners (ablation switches) + timing harness
│   └── maps.py                map sets (digitised paper maps, proxy maps) + random-map generators
├── scripts/
│   ├── digitize_figure5.py    digitises the paper's Fig. 5 into maps/paper_map{1,2,3}.csv
│   ├── compare_paper_figures.py  compares our explored cells/paths with the paper's Figs. 8 and 9
│   ├── calibrate_maps.py      builds the proxy maps maps/map{1,2,3}.csv (first phase)
│   ├── run_experiments.py     reproduces Tables 1-5, compares with the paper, robustness study
│   ├── timing_study.py        paired, interleaved timing of Adaptive A* vs A*
│   └── make_figures.py        all figures in figures/
├── data/                      published_results.csv (Tables 1-5) + screenshots of the paper's Figs. 4, 5, 8, 9, 10
├── maps/                      paper_map{1,2,3}.csv (digitised, final) and map{1,2,3}.csv (proxy) + calibration.json
├── results/paper_maps/        FINAL results on the digitised maps (comparison, timing, robustness)
├── results/                   first-phase results on the proxy maps
├── figures/paper_maps/        FINAL figures; figures/ = first phase + fig_digitised_maps.png
├── docs/                      01 analysis & feasibility, 02 first phase (proxy maps), 03 FINAL results
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

# 2. (optional) re-digitise the paper's maps from data/paper_figure5_maps.png (seconds;
#    add --search-map3 to redo the +-1-cell block search for map3, about 1 min)
python scripts/digitize_figure5.py

# 3. reproduce Tables 1-5 + 50-map-per-scene robustness study on the paper maps (a few minutes)
python scripts/run_experiments.py --map-set paper --repeats 30 --robust-maps 50

# 4. paired timing study for the planning-time metric (about 1 min)
python scripts/timing_study.py --map-set paper --pairs 300

# 5. figures
python scripts/make_figures.py --map-set paper
```

`--map-set paper` is the default. `--map-set proxy` reproduces the first phase on the calibrated proxy maps (`scripts/calibrate_maps.py --budget-scale 4` rebuilds them).

Quick smoke run: `python scripts/run_experiments.py --repeats 3 --robust-maps 5`.

The final tables are written to `results/paper_maps/comparison.md`. The discussion is in `docs/03_paper_maps_reproduction.md`.

## Headline results (paper's own maps, digitised from Fig. 5)

**The baselines reproduce the paper almost exactly.**
- A\* nodes: 130 vs 130, 715 vs 716, 2188 vs 2191.
- Dijkstra nodes: 633 vs 632, 1741 vs 1740, 7521 vs 7520.
- Table 5 pair (4,24)→(29,2): 38.21 m / 250 nodes / 14 corners, identical to the paper.

Adaptive A\* vs A\*, mean over Tables 2-4:

| Metric | Published | Reproduced (Eqs. 5-7 as printed) | Reproduced (V4: E+M without ½) |
|---|---|---|---|
| Planning-time reduction | 68.7% | 40.0% (paired timing) | 57.5% |
| Path-length reduction | 2.66 m | 3.70 m | 2.88 m |
| Expanded-node reduction | 76.6% | 59.0% | 75.8% |
| Reduction of corners >= 45 deg | 38.1% | 67.4% | 63.2% |

The paper's published Adaptive A\* node counts are matched only when the hybrid heuristic is used without the ½ of Eq. 7 (36 / 268 / 113 published vs 40 / 261 / 114). Each improvement on its own does match the equations as printed. The paper's result figures confirm this: in Figs. 8(f) and 9(f), the equations as printed expand 29 and 122 cells that the paper never explored, while V4 expands only 2 such cells on each map. A\* and Dijkstra match the paper's shaded regions cell for cell (`results/paper_maps/figure_agreement.md`).

Over 150 random maps every effect has the claimed direction, but:
- the adaptive search is not optimal (its raw path is suboptimal on 90 of 150 maps);
- the length and smoothness gains come mostly from the pruning step (A\* + pruning is shorter on 110 of 150 maps).

Full analysis: `docs/03_paper_maps_reproduction.md`.

### Running on Kaggle

There are two notebooks in `kaggle/`. Both run on CPU only.

- **`adaptive_astar_step_by_step.ipynb` — recommended for submission.** It is fully self-contained: no Internet, no uploads, just *File → Import Notebook* and *Run All*. Every part of the method is in its own explained cell, and each experiment prints its paper-vs-ours table and figure underneath:
  1. grid model;
  2. adaptive weight (Eq. 6) and hybrid heuristic (Eq. 7);
  3. A\* / Dijkstra / bidirectional A\*;
  4. redundant point deletion;
  5. metrics;
  6. sanity checks;
  7. the digitised paper maps, with validation against the paper and an optional digitiser re-check;
  8. Tables 1–5;
  9. headline comparison;
  10. paired timing;
  11. 150-map robustness study with Wilcoxon tests;
  12. sensitivity analysis: what the authors most likely ran (V4, pruning order).

  A full run takes about 1–5 minutes; set `QUICK = True` for a smoke run. The code cells are generated from `src/` by `kaggle/build_step_by_step_notebook.py`, so they always match the tested library.
- `adaptive_astar_kaggle.ipynb` runs the repository scripts in one go. It clones the public repository (needs *Settings → Internet* on), or reads the folder uploaded as a Kaggle Dataset. Outputs go to `/kaggle/working/adaptive_astar_outputs.zip`.

Both notebooks were tested on Python 3.11 with an older library stack (numpy 1.26, pandas 2.2, scipy 1.13, matplotlib 3.8). Path length, expanded nodes and corners are identical on every machine. Planning times vary with the CPU, and the 30×30 time reduction varies the most, because that search takes under 1 ms.

### Using the library directly

```python
import sys; sys.path.insert(0, "src")
from adaptive_astar import GridMap, PLANNERS, from_paper

grid = GridMap.load_csv("maps/paper_map1.csv", allow_corner_cutting=True)
res = PLANNERS["Adaptive A*"].plan(grid, from_paper(2, 2), from_paper(28, 28))
print(res.length, res.expanded, res.corners, res.path)
```

### Using your own map

Save a 0/1 CSV, with 1 = obstacle and the top row as the top of the figure, under `maps/`. Point a map set in `adaptive_astar/maps.py` (`MAP_SETS`) at it, then re-run steps 3–5.

## Configuration and parameters

| Parameter | Value | Source |
|---|---|---|
| Cell size | 1 m | paper Sec. 2.1 |
| Motion model | 8-connected, cost 1 / √2, diagonal corner cutting allowed (paper maps) | inferred: reproduces the published A\*/Dijkstra node counts (M2, M3) |
| Baseline heuristic | Euclidean | paper Sec. 3.2 ("traditional") (M5) |
| Adaptive weight | ω(n) = ln(1 + e^(d/D)), d and D Euclidean | Eq. (6) (M4) |
| Hybrid heuristic | (Euclidean + Manhattan) / 2 | Eq. (7) |
| Tie-breaking | lower f, then lower h, then FIFO | assumption (M8) |
| CLOSED nodes re-opened? | no | Algorithm 1 |
| "Expanded nodes" | size of the CLOSED list | assumption (M6) |
| Line-of-sight | Bresenham raster line (paper maps); strict supercover available | inferred: reproduces the published pruned lengths (M9) |
| Pruning order | anchor-based 3-node window | Sec. 3.3 (M10) |
| Path length | Euclidean polyline length of the final path | assumption (M16) |
| Corner | heading change ≥ 45° between consecutive segments | assumption (M7) |
| Timing | median of 30 runs, `perf_counter`, GC off, search + pruning | assumption (M11, M12) |
| Robustness | 50 unseen random maps per scene, Wilcoxon signed-rank | added |
| Table 5 start (4,24) | freed for that experiment | it is an obstacle in the paper's own Fig. 5 |
| Full-method heuristic | Eq. 7 as printed (main); E+M without ½ as "V4" sensitivity | V4 matches the published node counts |

Each assumption ID (M1–M17) is explained in `docs/01_analysis_and_feasibility.md`.

## Dataset

The paper uses three hand-made grid maps (30×30, 60×60, 100×100) that it publishes only as a figure (Fig. 5).

- **Final results: the paper's own maps.** `scripts/digitize_figure5.py` digitises `data/paper_figure5_maps.png`, a screenshot of the open-access MDPI figure (CC BY 4.0, from Cao et al., *Electronics* 2026). Output: `maps/paper_map{1,2,3}.csv`; visual check: `figures/fig_digitised_maps.png`. Our baseline A\* and Dijkstra reproduce the paper's node counts on these maps almost exactly. Map 3's block groups were refined by ±1 cell using **baseline** statistics only.
- **First phase: proxy maps.** These were used before the figure was available, and the random-map robustness study still uses their generators. `scripts/calibrate_maps.py` searches seeded candidates and keeps the one whose baseline statistics are closest to the published values. The proposed method is never used in calibration.

## Baselines

| Baseline | Status |
|---|---|
| A\*, Dijkstra, Bidirectional A\* | Re-implemented |
| Chen et al. [29], Zhang et al. [31] | Not described in the paper; compared on their **published numbers only** |
| A\* + pruning, A\* + octile + pruning | Extra baselines added for a fair comparison |
