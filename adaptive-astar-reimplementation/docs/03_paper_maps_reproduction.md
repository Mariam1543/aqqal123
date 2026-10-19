# Final Reproduction on the Paper's Own Maps (digitised from Fig. 5)

This document gives the **final** experimental results of the reproduction study.

`docs/02_reproduction_results.md` describes the first phase, which ran on *proxy* maps because the paper's maps were not available as data. Once the paper's Fig. 5 was available as an image, we digitised it. Every experiment was then repeated on the paper's own maps; the results are below.

**How the results are presented.** The main results implement Eqs. 5–7 **exactly as printed in the paper**. The variant "V4" (E + M without the ½ of Eq. 7) is not the paper's method. It appears only as a *hypothesis* about the authors' code (§2.2).

All numbers come from:
- `results/paper_maps/`:
  - `comparison.md`
  - `timing_study.md`
  - `robustness.md`
  - `admissibility.md`
  - `figure_agreement.md`
- the step-by-step notebook `kaggle/adaptive_astar_step_by_step.ipynb`.

---

## 1. Digitising the maps (our work)

The input is the paper's Fig. 5 (`data/paper_figure5_maps.png`), a 753 × 337 px image of the open-access figure. `scripts/digitize_figure5.py` converts it into occupancy grids. The result is in `maps/paper_map{1,2,3}.csv`, and the visual check is `figures/fig_digitised_maps.png`.

| Map | Pixels per cell | Method |
|---|---|---|
| 30×30 irregular | ≈ 4.9 | Each cell is classified by the mean blackness around its centre. The histogram is cleanly bimodal: obstacle cells ≤ 89, free cells ≥ 175 on a 0–255 scale. No parameter is tuned |
| 60×60 maze | ≈ 2.45 | The cell pitch is fixed by the two black border walls (cells 1 and 60). Each cell centre is sampled on a 10× bilinear upsampling and thresholded. No parameter is tuned against results |
| 100×100 array | ≈ 1.49 | Per-cell sampling is impossible at this scale, but the map is a lattice of **99 blocks of 5 × 5 cells**. Each block is found as a dark connected component. At 1.5 px per cell, a block group can be off by one cell, so its position was **calibrated** (§1.4) |

### 1.1 Validation: our baselines on the digitised maps vs the paper

| Table | Map, start → goal | Algorithm | Length paper / ours | Nodes paper / ours | Corners paper / ours |
|---|---|---|---|---|---|
| T2 | 30×30, (2,2)→(28,28) | Dijkstra | 40.30 / 40.28 | 632 / **633** | 11 / **11** |
| T2 | 30×30, (2,2)→(28,28) | A\* | 40.41 / 40.28 | 130 / **130** | 9 / 8 |
| T3 | 60×60, (2,2)→(58,58) | Dijkstra | 92.10 / 92.08 | 1740 / **1741** | 13 / **13** |
| T3 | 60×60, (2,2)→(58,58) | A\* | 92.30 / 92.08 | 716 / **715** | 12 / 11 |
| T4 | 100×100, (2,2)→(99,99) | Dijkstra | 146.41 / 146.55 | 7520 / **7521** | 31 / **31** |
| T4 | 100×100, (2,2)→(99,99) | A\* | 146.56 / **146.55** | 2191 / **2188** | 34 / 35 |
| T5 | 30×30, (28,28)→(2,2) | A\* | 40.30 / 40.28 | 202 / **203** | 13 / **13** |
| T5 | 30×30, (4,24)→(29,2) | A\* | **38.21 / 38.21** | **250 / 250** | **14 / 14** |
| T5 | 60×60, (58,58)→(2,2) | A\* | 92.08 / **92.08** | 898 / 882 | 19 / 23 |
| T5 | 60×60, (4,54)→(59,2) | A\* | 118.49 / **118.50** | 1159 / 1146 | 27 / 44 |

**The baselines agree closely.** Most node counts agree within 1–5, and one case is identical in all three metrics. The relative cost of Dijkstra vs A\* also matches: +386.9 / +143.5 / +243.7% for us vs +386.2 / +143.0 / +243.2% in the paper.

What this agreement does and does not show:
- **Maps 1 and 2 were not tuned.** Their agreement is a genuine check of the digitisation and of the inferred settings.
- **Map 3 and the corner-cutting setting were chosen to fit these baseline numbers** (§1.4). For them the agreement is partly built in.
- **Correctness of A\* and Dijkstra is shown separately** by the unit tests, e.g. A\* equals Dijkstra's optimal cost on random maps. It does not rest on these matches.

### 1.2 Settings the paper never states, inferred from the evidence

| Setting | Evidence | Adopted |
|---|---|---|
| Diagonal corner cutting | *Not* allowing it gives A\* 231 nodes on 30×30 (paper 130) and Dijkstra 7713 on 100×100 (paper 7520). Allowing it gives 130 and 7521 | **Allowed** (decision D2 changed) |
| Baseline heuristic | Euclidean: 130 / 715 / 2188 nodes. Octile: 106 / 604 / 1298. Chebyshev: 271 / 1021 / 3922. Manhattan: 40 / 281 / 113 | **Euclidean** (confirms D3) |
| Line of sight for pruning | Bresenham raster line: pruned lengths 39.21 / 87.25 / 140.72 m vs paper 38.74 / 87.49 / 140.67 m. Strict supercover test: 40.03 / 88.30 / 145.30 m | **Bresenham** (D6 changed). Supercover reported as a sensitivity check (§2.8) |

### 1.3 Validation against the paper's result figures (Figs. 4, 8, 9)

The paper's result figures shade every expanded cell grey and draw the final path in red. `scripts/compare_paper_figures.py` classifies every free cell of the paper's panels as shaded or white and compares them with the cells our planners expand. The outputs are `results/paper_maps/figure_agreement.md` and `figures/paper_maps/fig_paper_vs_ours_panels.png`.

Two counts are reported:
- **Covered:** the paper's shaded cells that we also expand.
- **Wrongly expanded:** cells we expand that are **white (never explored) in the paper's figure**. Zero means our explored region lies entirely inside the paper's.

| Paper panel | Our planner | Our nodes | Covered | Wrongly expanded |
|---|---|---|---|---|
| Fig. 8(a) 30×30 | A\* | 130 | 99/99 (100%) | **0** |
| Fig. 8(b) 30×30 | Dijkstra | 633 | 600/600 (100%) | **0** |
| Fig. 8(f) 30×30 | Adaptive A\*, Eqs. as printed (main) | 66 | 12/18 | 29 |
| Fig. 8(f) 30×30 | Adaptive A\*, V4 (hypothesis) | 40 | 13/18 | 2 |
| Fig. 9(a) 60×60 | A\* | 715 | 638/743\* | **0** |
| Fig. 9(f) 60×60 | Adaptive A\*, Eqs. as printed (main) | 370 | 209/578\* | 122 |
| Fig. 9(f) 60×60 | Adaptive A\*, V4 (hypothesis) | 261 | 228/578\* | 2 |

\*On the 60×60 panels the dense grid lines make the shading threshold over-detect shaded cells, so there the *Wrongly expanded* column is the reliable measure.

- **A\* and Dijkstra:** our explored regions coincide with the paper's.
- **Adaptive A\*, Eqs. as printed:** it expands **29 cells (30×30) and 122 cells (60×60) that the paper's figure shows as never explored**, so it searches regions the authors' planner did not.
- **Adaptive A\*, V4:** it expands only 2 such cells on each map, and its explored patches and path shape on 60×60 coincide visually with Fig. 9(f). This is a second line of evidence, after the node counts, that is *consistent with* the authors' code omitting the ½ (§2.2).
- The 100×100 panels (≈1.5 px per cell) are too coarse for this check.
- **Fig. 4** (the pruning diagram) keeps node A fixed while B is deleted and C advances. This is the *anchor-based* window we implement by default.

### 1.4 Calibration disclosure

Some choices were made **because they made our numbers match the paper's**. That is calibration, and we list every instance. The rule we tried to follow: calibrate only against **baseline** numbers (A\*, Dijkstra) and never against the proposed method. One choice breaks that rule, as the table shows.

| Choice | Alternatives tried | Published numbers it was matched to | Uses the proposed method's numbers? |
|---|---|---|---|
| Diagonal corner cutting allowed | allowed / not allowed | A\* and Dijkstra node counts (Tables 2–4) | No |
| Euclidean baseline heuristic | Euclidean, octile, Chebyshev, Manhattan | A\* node counts (Tables 2–4) | No |
| Map 3 block positions (±1 cell for 2 of 8 block groups) | all 3⁸ = 6,561 offset combinations | Table 4 Dijkstra nodes and length, A\* nodes | No |
| Bresenham line of sight | Bresenham / supercover | Pruned lengths: Table 1 "redundant point deletion" rows (30×30, 60×60) and the full method's 100×100 length (Table 4) | **Yes.** Pruning is one of the paper's three changes, so we also report the supercover results (§2.8) |
| Table 5 start (4,24) freed | free the cell / move the start / skip | Table 5 A\* row (38.21 m, 250, 14) | No (§2.5) |

Consequences:
- **The Adaptive A\* node counts were never used for calibration.** Expanded nodes do not depend on the line-of-sight test, which only affects the path after the search. The node-count comparison of the full method (§2.1, §2.2) is therefore not tuned.
- **Lengths and corners do depend on the line-of-sight choice.** Metrics 2 and 4 are given under both readings (§2.8).
- **The paper-map unit tests are map-regression tests**, e.g. "A\* expands 130 nodes" and "Table 5 gives 38.21 m / 250 / 14". They check that the digitised maps and settings still reproduce the published baselines. They do not test the algorithm, since the maps and settings were partly chosen to pass them. Algorithm correctness is tested separately on synthetic grids.

### 1.5 Open check: Map 2 against the high-resolution Fig. 7

Map 2 was digitised from Fig. 5 at about 2.45 px per cell. Its baseline agreement (715 vs 716 A\* nodes, 1741 vs 1740 Dijkstra nodes) and the Fig. 9(a) region match (0 wrongly expanded cells) support it. Fig. 9, however, has the same low resolution.

A cell-by-cell cross-check against the paper's high-resolution figure (Fig. 7, about 3500 px wide) would be stronger. The MDPI site is not reachable from our environment, so this check is **still pending**: the figure has to be added as `data/paper_figure7.png`.

---

## 2. Results — published vs reproduced

Main settings:
- Eqs. 5–7 **exactly as printed**;
- corner cutting allowed;
- Bresenham line of sight;
- anchor-based pruning;
- time taken from the paired study (300 interleaved pairs).

### 2.1 Headline metrics (assignment table; mean over Tables 2–4, Adaptive A\* vs A\*)

| Evaluation metric | Published result | Our result (Eqs. as printed) | Difference |
|---|---|---|---|
| Metric 1 — Planning-time reduction | 68.7% (75.0 / 66.7 / 64.3) | 40.0% (19.5 / 28.1 / 72.4) | −28.7 pp |
| Metric 2 — Path-length reduction | 2.66 m (0.69 / 1.41 / 5.89) | 3.70 m (1.08 / 4.18 / 5.83) | +1.04 m |
| Metric 3 — Expanded-node reduction | 76.6% (72.3 / 62.6 / 94.8) | 59.0% (49.2 / 48.3 / 79.5) | −17.6 pp |
| Metric 4 — Reduction of corners ≥ 45° | 38.1% (22.2 / 33.3 / 58.8) | 67.4% (50.0 / 63.6 / 88.6) | +29.3 pp |

With the supercover line of sight, Metric 2 becomes 1.29 m and Metric 4 becomes 40.0% (§2.8).

### 2.2 Hypothesis: did the authors' code omit the ½ of Eq. 7?

This section is a **sensitivity analysis, not our main result**. It asks which implementation would produce the paper's own numbers.

Each cell shows expanded nodes / path length (m) / corners ≥ 45°.

| Case | Paper | **Eqs. as printed (main)** | As printed, single-pass pruning | V4: E+M without ½ | V4, single-pass |
|---|---|---|---|---|---|
| T2 30×30 | 36 / 39.72 / 7 | **66 / 39.21 / 4** | 66 / 39.93 / 5 | 40 / 39.92 / 5 | 40 / 40.92 / 7 |
| T3 60×60 | 268 / 90.89 / 8 | **370 / 87.90 / 4** | 370 / 93.50 / 10 | 261 / 89.64 / 4 | 261 / 96.93 / 16 |
| T4 100×100 | 113 / 140.67 / 14 | **448 / 140.72 / 4** | 448 / 143.88 / 13 | 114 / 140.72 / 4 | 114 / 144.24 / 14 |
| T5 30×30 (28,28)→(2,2) | 43 / 39.92 / 6 | **89 / 40.83 / 2** | 89 / 42.27 / 6 | 45 / 41.92 / 3 | 45 / 42.74 / 5 |
| T5 30×30 (4,24)→(29,2) | 33 / 37.68 / 5 | **93 / 37.73 / 2** | 93 / 38.62 / 5 | 35 / 37.73 / 2 | 35 / 38.62 / 5 |
| T5 60×60 (58,58)→(2,2) | 123 / 88.81 / 7 | **391 / 87.75 / 2** | 391 / 91.37 / 6 | 128 / 88.76 / 4 | 128 / 94.21 / 10 |
| T5 60×60 (4,54)→(59,2) | 478 / 114.96 / 13 | **964 / 111.83 / 7** | 964 / 116.36 / 13 | 550 / 114.41 / 8 | 550 / 121.57 / 15 |

**Observation.** The equations as printed expand clearly more nodes than the paper reports on every case. V4 matches the published counts within a few percent on six of seven cases (e.g. 114 vs 113 on 100×100). Each change *alone* matches the paper with the ½ (§2.3).

**Interpretation (hypothesis).** The published full-method numbers are *consistent with* an implementation that dropped the ½ of Eq. 7. Two independent lines of evidence point the same way: the node counts, and the explored regions in Figs. 8(f) and 9(f) (§1.3).

This is strong evidence but **not proof**, for three reasons:
- ω·(E + M) is the same as 2·ω·hybrid, so a missing ½ cannot be told apart from an extra weight of 2.
- Other undocumented details, such as tie-breaking or the exact OPEN-list implementation, could also contribute.
- We do not have the authors' code.

V4 headline metrics, for comparison only:
- nodes −75.8% (paper −76.6%);
- length −2.88 m (paper −2.66 m);
- time −57.5% (30-run medians; paper −68.7%);
- corners −63.2% (paper −38.1%).

Corner counts are not reproduced by either pruning reading. The paper's values sit between the anchor and single-pass results, so the pruning procedure is under-specified.

### 2.3 Table 1 — ablation (each improvement alone vs A\*)

| Map | Change vs A\* (paper / ours) | Time | Length | Nodes | Corners |
|---|---|---|---|---|---|
| 30×30 | Adaptive estimation function | −25% / −32% | −0.21 / 0.00 | **−9.2% / −8.5%** (118 vs 119) | +44% / +13% |
| | Distance model optimisation | −50% / −72% | **+1.04 / +1.18** (41.45 vs 41.46 m) | **−65.4% / −64.6%** (45 vs 46) | 0% / +63% |
| | Redundant point deletion | −50% / −29%\* | −1.67 / −1.07 | 0% / 0% | −44% / −50% |
| 60×60 | Adaptive estimation function | −50% / +12%\* | −0.25 / 0.00 | −42.5% / −3.2% | 0% / −9% |
| | Distance model optimisation | −33% / −38% | −1.22 / 0.00 | −3.5% / −42.2% | −17% / −18% |
| | Redundant point deletion | −33% / +7% | −4.81 / −4.83 | −3.5% / 0% | −42% / −82% |

\*Single 30-run medians of sub-millisecond runs are noisy. Isolated pruning can only add time; the paired study and the robustness study measure that cost at +3 to +11%.

On 30×30 each component matches the paper almost exactly. **On 60×60 two rows of the paper's Table 1 appear to be swapped, and its pruning row is not isolated.** The evidence:

| Paper's 60×60 row | Paper nodes, time | Our run with the **same** label | Our run with the **other** label |
|---|---|---|---|
| Adaptive estimation function | 412, 0.09 s | 692 | **413** (distance model) |
| Distance model optimisation | 691, 0.12 s | 413 | **692** (adaptive estimation) |
| Redundant point deletion | 691, 0.12 s | 715 (= A\*) | — |

1. **Node counts.** Each of our isolated runs lands within one node of the *other* row. The same code matches both rows on 30×30 to within one node, so a code error would have to affect only one map.
2. **Theory.** ω = ln(1 + e^(d/D)) is below 1 for nodes with d < 0.54·D and above 1 elsewhere, so on its own it changes the search only a little. The paper's own 30×30 row agrees (−9.2%). A −42.5% effect from the adaptive weight alone is implausible, while a hybrid heuristic that inflates h can give it (−65.4% on 30×30).
3. **The pruning row copies another row.** Pruning is post-processing and cannot change the number of expanded nodes, so an isolated pruning row must show A\*'s count. On 30×30 it does (130 = A\*). On 60×60 it instead repeats the 691-node row exactly, in both nodes and time (691, 0.12 s), rather than A\*'s 716. This suggests the pruning was applied **on top of** another change on 60×60 (cumulative) but alone on 30×30 (isolated).

Points 1 and 2 support the swap; point 3 supports a protocol change between maps. Neither can be proven without the authors' code. In the report this is written as "appear to be swapped" and "suggests".

### 2.4 Tables 2–4 — all algorithms, including Chen et al. and Zhang et al. (published numbers only)

Change vs the A\* of the same experiment (paper / ours). Lengths are in metres; nodes and corners in %.

| Map | Method | Length | Nodes | Corners |
|---|---|---|---|---|
| 30×30 | Dijkstra | −0.11 / 0.00 | +386% / +387% | +22% / +38% |
| | Bidirectional A\* | +2.24 / 0.00 | +20% / +29% | 0% / +13% |
| | Chen et al. [29] | +1.28 / — | −0.8% / — | 0% / — |
| | Zhang et al. [31] | −0.12 / — | −24.6% / — | +22% / — |
| | **Adaptive A\*** (as printed; V4 in brackets) | −0.69 / −1.07 (−0.36) | −72.3% / −49.2% (−69.2%) | −22% / −50% (−38%) |
| 60×60 | Dijkstra | −0.20 / 0.00 | +143% / +144% | +8% / +18% |
| | Bidirectional A\* | +1.61 / 0.00 | −1.7% / +2.0% | 0% / −9% |
| | Chen / Zhang | −0.22 / −0.19 | −2.8% / −27.0% | 0% / −17% |
| | **Adaptive A\*** (as printed; V4 in brackets) | −1.41 / −4.18 (−2.44) | −62.6% / −48.3% (−63.5%) | −33% / −64% (−64%) |
| 100×100 | Dijkstra | −0.15 / 0.00 | +243% / +244% | −9% / −11% |
| | Bidirectional A\* | +1.82 / 0.00 | −48.6% / −42.6% | −6% / −9% |
| | Chen / Zhang | 0.00 / 0.00 | −1.0% / −59.3% | 0% / −12% |
| | **Adaptive A\*** (as printed; V4 in brackets) | −5.89 / −5.83 (−5.83) | −94.8% / −79.5% (−94.8%) | −59% / −89% (−89%) |

The relative cost of Dijkstra is reproduced to within one percentage point.

Measured against each paper's own A\*, Adaptive A\* (as printed) improves more than Chen et al. and Zhang et al. on every map, so the paper's ranking holds.

**Bidirectional A\*: the stopping rule.** The paper does not describe the method of its ref. [30], so we implemented a **standard generic** bidirectional A\*, not [30] itself:
1. A forward search (from the start, Euclidean distance to the goal) and a backward search (from the goal, distance to the start) alternate one expansion each.
2. The search **stops at the first meeting**: when one side expands a node the other side has already expanded (closed).
3. The path is the forward half-path to that node joined to the backward half-path from it.

This rule is **not guaranteed to give the shortest path**. The first node where the two closed sets meet need not lie on an optimal path. An optimal variant would record the best meeting cost μ and continue until min f_forward + min f_backward ≥ μ.

The paper's bidirectional paths are 1.6–2.2 m longer than its A\* paths, which fits a first-meeting rule like ours. On these three maps our searches happen to meet on an optimal path, so our lengths equal A\*'s. The relative node counts have the same sign as the paper's on all three maps (+29% / +2.0% / −42.6% vs +20% / −1.7% / −48.6%) except for the near-zero 60×60 case.

### 2.5 Table 5 — different start and end points (Adaptive A\* vs A\*; paper / as printed / V4)

| Case | Nodes | Length (m) |
|---|---|---|
| 30×30 (28,28)→(2,2) | −78.7% / −56.2% / −77.8% | −0.38 / +0.55 / +1.64 |
| 30×30 (4,24)→(29,2)\* | −86.8% / −62.8% / −86.0% | −0.53 / −0.48 / −0.48 |
| 60×60 (58,58)→(2,2) | −86.3% / −55.7% / −85.5% | −3.27 / −4.33 / −3.32 |
| 60×60 (4,54)→(59,2) | −58.8% / −15.9% / −52.0% | −3.53 / −6.67 / −4.09 |

\***The start cell (4,24) is an obstacle in the paper's own Fig. 5.** In the figure the cell is solid black (mean pixel value 8 on a 0–255 scale; every free cell is ≥ 175), so this is not a digitisation borderline. It is the bottom cell of the obstacle above row 24. The paper nevertheless reports a path from it.

**What our code does:** `run_experiments.py` (`with_free_start`) **frees that single cell for this experiment only**. It prints a note when it does so, and every planner in the experiment uses the same modified map. The original map is not changed.

**Why freeing, and not moving or skipping:**

| Option | A\* result (paper: 38.21 m / 250 nodes / 14 corners) |
|---|---|
| **Free (4,24)** (our choice) | **38.21 / 250 / 14, identical** |
| Move start to (3,24) | 38.63 / 229 / 14 |
| Move start to (5,24) | 37.80 / 249 / 16 |
| Move start to (4,23) | 37.21 / 224 / 14 |
| Skip the case | one of the paper's four Table 5 cases lost |

Only freeing the cell reproduces the paper's A\* exactly, which suggests the authors' planner also treated the start cell as free. Many grid planners mark the start and goal free before searching. Skipping would remove a published case, and moving would change the experiment.

### 2.6 Paired timing study (`results/paper_maps/timing_study.md`)

| Map | A\* (ms) | Adaptive A\* (ms) | Ratio [95% CI] | Our reduction | Paper |
|---|---|---|---|---|---|
| 30×30 | 0.52 | 0.42 | 0.805 [0.785, 0.818] | 19.5% | 75.0% |
| 60×60 | 2.86 | 2.04 | 0.719 [0.716, 0.723] | 28.1% | 66.7% |
| 100×100 | 9.74 | 2.69 | 0.276 [0.274, 0.278] | **72.4%** | 64.3% |

### 2.7 Robustness: 150 random maps with the same settings (`results/paper_maps/robustness.md`)

Each row compares Adaptive A\* (as printed) with A\* on 50 unseen random maps of that scene type. W/T/L = maps where Adaptive A\* is better / equal / worse than A\*.

| Scene | Nodes | Time | Length | Raw path suboptimal | A\*+pruning shorter than Adaptive A\* |
|---|---|---|---|---|---|
| Irregular | −50.4% (50/0/0) | −22.8% (44/0/6) | −1.34 m (45/1/4) | 20/50 maps (max 14.9%) | 23/50 |
| Maze | −39.8% (48/0/2) | −21.5% (41/0/9) | −1.07 m (37/0/13) | 25/50 (max 16.9%) | 45/50 |
| Array | −71.2% (50/0/0) | −62.7% (50/0/0) | −1.76 m (38/0/12) | 45/50 (max 6.0%) | 42/50 |

All differences are significant (Wilcoxon p < 10⁻³). A\* + pruning alone shortens paths by 1.7 / 3.4 / 4.0 m and removes 73–83% of the corners, at a 3–11% time cost.

### 2.8 Sensitivity to the line-of-sight test (because it was calibrated, §1.4)

Adaptive A\* (as printed) vs A\*, Tables 2–4:

| Line of sight | Path-length reduction (30 / 60 / 100; mean) | Corner reduction (30 / 60 / 100; mean) |
|---|---|---|
| Paper | 0.69 / 1.41 / 5.89; **2.66 m** | 22.2 / 33.3 / 58.8%; **38.1%** |
| Bresenham (main) | 1.08 / 4.18 / 5.83; **3.70 m** | 50.0 / 63.6 / 88.6%; **67.4%** |
| Supercover (strict) | 0.25 / 2.68 / 0.94; **1.29 m** | 25.0 / 63.6 / 31.4%; **40.0%** |

Expanded nodes and the search time do not depend on this choice.

Under both readings, Adaptive A\* is shorter and smoother than A\*. The *size* of the gain depends on an implementation detail the paper does not state. The published values lie between the two readings.

---

## 3. Critical analysis (assignment Section 6)

### 3.1 Verdict

A higher or lower number alone does not settle a verdict, so we judge each claim separately:

| Claim | Verdict | Justification |
|---|---|---|
| A\* and Dijkstra baselines | **Comparable** | Within 1–5 nodes of the paper, one case identical in every metric (§1.1). Part of this agreement is by calibration (§1.4) |
| Each improvement alone (Table 1) | **Comparable** | 30×30: 119 vs 118 and 46 vs 45 nodes; 41.46 vs 41.45 m. 60×60: matches after the apparent row swap (§2.3) |
| Full Adaptive A\* as printed (Eqs. 5–7) | **Partly comparable** | Same direction on every metric and every map: it is faster, expands fewer nodes, and gives shorter, smoother paths than A\*. The magnitudes differ: nodes −59% vs −77%, time −40% vs −69% (§2.1). The node gap is consistent with the authors' code omitting the ½ of Eq. 7 (V4, §2.2), but that is a hypothesis |
| "The improved heuristic yields shorter / near-optimal paths" | **Not supported** | The heuristic overestimates the true cost by up to 58.5% (§3.3), so the raw adaptive path is suboptimal on 90 of 150 random maps. A\* + pruning is as short or shorter than Adaptive A\* on 110 of 150 maps. The paper's own Table 1 agrees (pruning alone: 38.74 m vs 39.72 m for the full method). **The length and smoothness gains come from the pruning step**; the heuristic buys speed |

Per assignment metric (Eqs. as printed):

| Metric | Category | Note |
|---|---|---|
| 1 Planning time | **(C) lower** | 40.0% vs 68.7%. It is bounded by the node reduction, and Python's per-node overhead is relatively larger than MATLAB's. On 100×100 ours is higher (72% vs 64%) |
| 2 Path length | **(B) higher** with Bresenham (3.70 vs 2.66 m), **(C) lower** with supercover (1.29 m) | The size depends on the line-of-sight test, which was calibrated (§2.8); the sign is the same |
| 3 Expanded nodes | **(C) lower** | 59.0% vs 76.6%; with V4, 75.8% (hypothesis, §2.2) |
| 4 Corners ≥ 45° | **(B) higher** with Bresenham (67.4%), **(A) comparable** with supercover (40.0% vs 38.1%) | Depends on the under-specified pruning and corner definition |

**Overall: partly reproduced.**
- The baselines and every individual improvement are comparable.
- The full method's claimed advantages are reproduced in direction, but not in magnitude when Eq. 7 is followed as printed.
- The claim that the heuristic itself shortens paths is not supported.

### 3.2 Justification by factor
- **Dataset.**
  - Maps digitised from a 753 × 337 px figure.
  - Maps 1 and 2 are untuned. Map 3's block positions were calibrated on baseline statistics (§1.4).
  - One start cell is an obstacle in the paper's figure and was freed for that experiment (§2.5).
- **Experimental settings.**
  - Corner cutting and the line-of-sight test are not stated in the paper. Both were inferred by matching published numbers, which is disclosed as calibration in §1.4.
  - The pruning order and the corner definition remain ambiguous.
- **Randomness.**
  - Length, nodes and corners are deterministic.
  - Time uses medians and a paired study with confidence intervals.
  - The random-map study uses fixed seeds and Wilcoxon tests.
- **Software and hardware.**
  - MATLAB R2023b on an i5 laptop vs Python 3 on a cloud CPU, so only relative times are compared.
  - The paper's 0.01 s timer adds about ±16 pp of uncertainty to its own percentages.
- **Missing or inconsistent details in the paper:**
  - text vs table mismatches (doc 01 §8.2);
  - two Table 1 rows (60×60) that appear swapped, and a pruning row that is cumulative on one map (§2.3);
  - a start cell inside an obstacle (§2.5);
  - full-method node counts consistent with E+M without the ½ (§2.2);
  - no description of the bidirectional A\* [30] (§2.4).
- **Our deviations.** D1–D12, applied to all planners alike.

### 3.3 Findings beyond the paper
1. **The Adaptive A\* heuristic is inadmissible** (`results/paper_maps/admissibility.md`). The true cost-to-go h\* is octile on an obstacle-free 45° diagonal.

   | Estimate | Worst case vs true cost (analytic) | Measured max on the paper maps |
   |---|---|---|
   | Euclidean (baseline) | 1.000 (admissible) | 1.000 |
   | Hybrid term alone, (E + M)/2 | 1.207 (+20.7%) | 1.207 |
   | **Full adaptive estimate ω·(E + M)/2, as printed** | **1.585 (+58.5%)** | 1.36–1.49 |
   | ω·(E + M), V4 | **3.17×** | 2.73–2.99 |

   The ω bound (ω ≤ ln(1 + e) = 1.313) holds for nodes no farther from the goal than the start; detour nodes get a larger ω. The 3.17× of V4 explains why V4 expands so few nodes: it behaves almost like greedy best-first search.
2. **Most of the path-quality gain comes from pruning.** A\* + pruning is shorter than Adaptive A\* on 110 of 150 random maps, and the paper's own Table 1 shows the same.
3. **The adaptive heuristic buys speed:** 48–80% fewer expanded nodes as printed, depending on the map.

### 3.4 What the tests prove (for the viva)
- **Algorithm tests (synthetic grids):**
  - A\* finds the optimal cost and agrees with Dijkstra on random maps;
  - no corner cutting when it is disabled;
  - line of sight is blocked by obstacles;
  - pruning never lengthens a path or passes through an obstacle;
  - ω is ln(1+e) at the start and ln 2 at the goal;
  - the overestimation bounds of 1.207, 1.585 and 3.17 hold.

  These test the *code*.
- **Map-regression tests (digitised paper maps):** A\* expands 130 nodes, and Table 5 gives 38.21 m / 250 / 14. These test the *maps and the inferred settings*, which were partly chosen to fit these numbers. They guard against accidental changes; they are not evidence that A\* is correct.

## 4. Limitations
- The maps come from a low-resolution figure. Map 3's block positions and two settings were calibrated (§1.4). Map 2 has not yet been cross-checked against the high-resolution Fig. 7 (§1.5).
- Chen et al. [29] and Zhang et al. [31] are compared on published numbers only. Bidirectional A\* is a generic version, not ref. [30].
- Timing is in Python, not MATLAB.
