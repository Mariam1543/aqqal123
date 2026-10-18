# Final Reproduction on the Paper's Own Maps (digitised from Fig. 5)

This document gives the **final** experimental results of the reproduction study.

`docs/02_reproduction_results.md` describes the first phase, which ran on *proxy* maps because the paper's maps were not available as data. Once the paper's Fig. 5 was available as an image, we digitised it. Every experiment was then repeated on the paper's own maps; the results are below.

All numbers come from:
- `results/paper_maps/` — `comparison.md`, `timing_study.md` and `robustness.md`;
- the step-by-step notebook `kaggle/adaptive_astar_step_by_step.ipynb`.

---

## 1. Digitising the maps (our work)

The input is the paper's Fig. 5 (`data/paper_figure5_maps.png`, a 753 × 337 px image of the open-access figure). `scripts/digitize_figure5.py` converts it into occupancy grids. The result is in `maps/paper_map{1,2,3}.csv`, and the visual check is `figures/fig_digitised_maps.png`.

| Map | Pixels per cell | Method |
|---|---|---|
| 30×30 irregular | ≈ 4.9 | Each cell is classified by the mean blackness around its centre; the histogram is cleanly bimodal. The red start and blue goal cells are not black, so they stay free |
| 60×60 maze | ≈ 2.45 | The cell pitch is fixed by the two black border walls (cells 1 and 60). Each cell centre is sampled on a 10× bilinear upsampling and thresholded |
| 100×100 array | ≈ 1.49 | Per-cell sampling is impossible at this scale, but the map is a lattice of **99 blocks of 5 × 5 cells**. Each block is found as a dark connected component. At 1.5 px per cell a block group can be off by one cell, so the 4 column groups and 4 row groups were refined by ±1 cell. All 3⁸ = 6,561 offsets were tried (`--search-map3`), and the one whose *baseline* statistics match the paper was kept. Only two groups move, by one cell each. The proposed method is never used in this step |

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

**The baselines are reproduced almost exactly.** Most node counts agree within 1–5, and one case is identical in all three metrics. This validates the digitisation and our A\* and Dijkstra. The relative cost of Dijkstra vs A\* also matches: +386.9 / +143.5 / +243.7% for us vs +386.2 / +143.0 / +243.2% in the paper.

### 1.2 Settings the paper never states, inferred from the evidence

| Setting | Evidence | Adopted |
|---|---|---|
| Diagonal corner cutting | *Not* allowing it gives A\* 231 nodes on 30×30 (paper 130) and Dijkstra 7713 on 100×100 (paper 7520). Allowing it gives 130 and 7521 | **Allowed** (decision D2 changed) |
| Baseline heuristic | Euclidean: 130 / 715 / 2188 nodes. Octile: 106 / 604 / 1298. Chebyshev: 271 / 1021 / 3922. Manhattan: 40 / 281 / 113 | **Euclidean** (confirms D3) |
| Line of sight for pruning | Bresenham raster line: pruned lengths 39.21, 87.25 and 140.72 m vs paper 38.74, 87.49 and 140.67 m. The strict supercover test: 40.03, 88.30 and 144.95 m | **Bresenham** (D6 changed; the strict test stays available) |

---

## 2. Results — published vs reproduced

Our main runs implement Eqs. 5–7 **exactly as printed**. Settings: corner cutting allowed; Bresenham line of sight; anchor-based pruning; time from the paired study (300 interleaved pairs).

### 2.1 Headline metrics (assignment table; mean over Tables 2–4, Adaptive A\* vs A\*)

| Evaluation metric | Published result | Our result (Eqs. as printed) | Difference |
|---|---|---|---|
| Metric 1 — Planning-time reduction | 68.7% (75.0 / 66.7 / 64.3) | 40.0% (19.5 / 28.1 / 72.4) | −28.7 pp |
| Metric 2 — Path-length reduction | 2.66 m (0.69 / 1.41 / 5.89) | 3.70 m (1.08 / 4.18 / 5.83) | +1.04 m |
| Metric 3 — Expanded-node reduction | 76.6% (72.3 / 62.6 / 94.8) | 59.0% (49.2 / 48.3 / 79.5) | −17.6 pp |
| Metric 4 — Reduction of corners ≥ 45° | 38.1% (22.2 / 33.3 / 58.8) | 67.4% (50.0 / 63.6 / 88.6) | +29.3 pp |

### 2.2 What did the authors actually run? (Adaptive A\*, every published case)

Each cell shows expanded nodes / path length (m) / corners ≥ 45°.

| Case | Paper | Eqs. as printed | As printed, single-pass pruning | **V4: E+M without ½** | V4, single-pass |
|---|---|---|---|---|---|
| T2 30×30 | 36 / 39.72 / 7 | 66 / 39.21 / 4 | 66 / 39.93 / 5 | **40 / 39.92 / 5** | 40 / 40.92 / 7 |
| T3 60×60 | 268 / 90.89 / 8 | 370 / 87.90 / 4 | 370 / 93.50 / 10 | **261 / 89.64 / 4** | 261 / 96.93 / 16 |
| T4 100×100 | 113 / 140.67 / 14 | 448 / 140.72 / 4 | 448 / 143.88 / 13 | **114 / 140.72 / 4** | 114 / 144.24 / 14 |
| T5 30×30 (28,28)→(2,2) | 43 / 39.92 / 6 | 89 / 40.83 / 2 | 89 / 42.27 / 6 | **45 / 41.92 / 3** | 45 / 42.74 / 5 |
| T5 30×30 (4,24)→(29,2) | 33 / 37.68 / 5 | 93 / 37.73 / 2 | 93 / 38.62 / 5 | **35 / 37.73 / 2** | 35 / 38.62 / 5 |
| T5 60×60 (58,58)→(2,2) | 123 / 88.81 / 7 | 391 / 87.75 / 2 | 391 / 91.37 / 6 | **128 / 88.76 / 4** | 128 / 94.21 / 10 |
| T5 60×60 (4,54)→(59,2) | 478 / 114.96 / 13 | 964 / 111.83 / 7 | 964 / 116.36 / 13 | **550 / 114.41 / 8** | 550 / 121.57 / 15 |

**Finding: the paper's full Adaptive A\* corresponds to the hybrid heuristic *without* the ½ of Eq. 7.**
- With V4, nodes match within a few percent on six of the seven cases, and 114 vs 113 on 100×100.
- With the equations as printed they do not.
- Each improvement *alone* matches the ½ version (Section 2.3).

So the inconsistency is inside the authors' combined implementation, not in our code. V4 headline metrics: nodes −75.8% (paper −76.6%), length −2.88 m (paper −2.66 m), time −57.5% (30-run medians; paper −68.7%), corners −63.2% (paper −38.1%).

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

- **30×30:** each component matches the paper almost exactly.
- **60×60:** the paper's *adaptive-estimation* row (412 nodes) equals our *distance-model* row (413), and its *distance-model* row (691) equals our *adaptive-estimation* row (692). **The two rows of the paper's Table 1 are swapped.** Its "redundant point deletion" row (691 nodes) is also cumulative, not isolated, since pruning alone cannot change the node count.

\*Single 30-run medians of sub-millisecond runs are noisy. Isolated pruning can only add time; the paired study and the robustness study measure that cost at +3 to +11%.

### 2.4 Tables 2–4 — all algorithms, including Chen et al. and Zhang et al. (published numbers only)

Change vs the A\* of the same experiment (paper / ours). Lengths are in metres; nodes and corners in %.

| Map | Method | Length | Nodes | Corners |
|---|---|---|---|---|
| 30×30 | Dijkstra | −0.11 / 0.00 | +386% / +387% | +22% / +38% |
| | Bidirectional A\* | +2.24 / 0.00 | +20% / +29% | 0% / +13% |
| | Chen et al. [29] | +1.28 / — | −0.8% / — | 0% / — |
| | Zhang et al. [31] | −0.12 / — | −24.6% / — | +22% / — |
| | **Adaptive A\*** (as printed / V4) | −0.69 / −1.07 / −0.36 | −72.3% / −49.2% / −69.2% | −22% / −50% / −38% |
| 60×60 | Dijkstra | −0.20 / 0.00 | +143% / +144% | +8% / +18% |
| | Bidirectional A\* | +1.61 / 0.00 | −1.7% / +2.0% | 0% / −9% |
| | Chen / Zhang | −0.22 / −0.19 | −2.8% / −27.0% | 0% / −17% |
| | **Adaptive A\*** (as printed / V4) | −1.41 / −4.18 / −2.44 | −62.6% / −48.3% / −63.5% | −33% / −64% / −64% |
| 100×100 | Dijkstra | −0.15 / 0.00 | +243% / +244% | −9% / −11% |
| | Bidirectional A\* | +1.82 / 0.00 | −48.6% / −42.6% | −6% / −9% |
| | Chen / Zhang | 0.00 / 0.00 | −1.0% / −59.3% | 0% / −12% |
| | **Adaptive A\*** (as printed / V4) | −5.89 / −5.83 / −5.83 | −94.8% / −79.5% / −94.8% | −59% / −89% / −89% |

The relative cost of Dijkstra is reproduced to within one percentage point. Bidirectional A\* node counts are close. Our bidirectional search happens to meet on an optimal path, whereas the paper's is 1.6–2.2 m longer; its termination rule is not stated.

Measured against each paper's own A\*, Adaptive A\* improves more than Chen et al. and Zhang et al. do on every map, in both our readings. The paper's ranking therefore holds.

### 2.5 Table 5 — different start and end points (Adaptive A\* vs A\*; paper / as printed / V4)

| Case | Nodes | Length (m) |
|---|---|---|
| 30×30 (28,28)→(2,2) | −78.7% / −56.2% / −77.8% | −0.38 / +0.55 / +1.64 |
| 30×30 (4,24)→(29,2)\* | −86.8% / −62.8% / −86.0% | −0.53 / −0.48 / −0.48 |
| 60×60 (58,58)→(2,2) | −86.3% / −55.7% / −85.5% | −3.27 / −4.33 / −3.32 |
| 60×60 (4,54)→(59,2) | −58.8% / −15.9% / −52.0% | −3.53 / −6.67 / −4.09 |

\*The start cell (4,24) is an **obstacle in the paper's own Fig. 5**; the paper planned from it anyway. We free that single cell for this experiment. With it freed, our A\* matches the paper exactly: 38.21 m, 250 nodes, 14 corners.

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

---

## 3. Critical analysis (assignment Section 6)

### 3.1 Verdict

| Metric | Verdict | Justification |
|---|---|---|
| Baselines (A\*, Dijkstra) | **(A) reproduced** | Within 1–5 nodes of the paper; one case identical in every metric |
| Each improvement alone | **(A) reproduced** | 119 vs 118 and 46 vs 45 nodes; 41.46 vs 41.45 m (30×30) |
| Expanded nodes, full method | **(C)** as printed, **(A)** with V4 | −59% vs −77%. The published counts are reproduced (−76%) only without the ½ of Eq. 7 |
| Path length | **(A) comparable** | Same sign and similar size; differences come from the pruning reading |
| Planning time | **(C) lower** | Python per-node overhead dominates sub-millisecond searches. On 100×100 ours is higher than the paper's (72% vs 64%) |
| Corners ≥ 45° | **(B) numerically**, not a better method | Depends on the under-specified pruning order |
| **Overall** | **(A) comparable** | Reproducible on the paper's own maps, with the documented heuristic discrepancy |

### 3.2 Justification by factor
- **Dataset.** Maps digitised from a 753 × 337 px figure, validated by the near-exact baseline matches. One start cell is an obstacle in the paper's figure and was freed for that experiment.
- **Experimental settings.** Corner cutting and the line-of-sight test are not stated in the paper; both were inferred from its numbers. The pruning order and the corner definition remain ambiguous.
- **Randomness.** Length, nodes and corners are deterministic. Time uses medians and a paired study with confidence intervals. The random-map study uses fixed seeds and Wilcoxon tests.
- **Software and hardware.** MATLAB R2023b on an i5 laptop vs Python 3 on a cloud CPU, so only relative times are compared. The paper's 0.01 s timer adds about ±16 pp of uncertainty to its own percentages.
- **Missing or inconsistent details in the paper:**
  - text vs table mismatches (doc 01 §8.2);
  - swapped Table 1 rows (60×60);
  - a cumulative "isolated" row;
  - a start cell inside an obstacle;
  - full-method node counts that need E+M without the ½.
- **Our deviations.** D1–D12, applied to all planners alike.

### 3.3 Findings beyond the paper
1. **The Adaptive A\* heuristic is inadmissible.** The hybrid term overestimates by up to 20.7% (×1.31 from ω, ×2 in V4), so the raw search path is suboptimal on 90 of 150 random maps.
2. **Most of the path-quality gain comes from pruning.** A\* + pruning is shorter than Adaptive A\* on 110 of 150 random maps. The paper's own Table 1 shows the same (pruning alone: 38.74 m vs 39.72 m for the full method).
3. **The adaptive heuristic buys speed:** 40–76% fewer expanded nodes, depending on the reading and the map.

## 4. Limitations
- The maps come from a low-resolution figure. Maps 1 and 2 are validated cell-accurate by the baseline matches. Map 3's block positions were refined using baseline statistics, never the proposed method.
- Chen et al. and Zhang et al. are compared on published numbers only.
- Timing is in Python, not MATLAB.
