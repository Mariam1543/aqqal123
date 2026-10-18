# Robustness on random maps

Each scene type: 50 fresh random maps (calibrated generator, unseen seeds), paper start/goal. Change vs A* (length in metres, others in percent); W/T/L = maps where the method is lower / equal / higher than A*; p = two-sided Wilcoxon signed-rank test.

| Map | Method | Metric | Mean +- std | Median | W/T/L | p |
|---|---|---|---|---|---|---|
| map1 | Adaptive A* | time_s | -22.77% +- 27.23 | -25.45% | 44/0/6 | 4.2e-08 |
| map1 | Adaptive A* | length_m | -1.34 m +- 1.04 | -1.42 m | 45/1/4 | 4.1e-08 |
| map1 | Adaptive A* | expanded_nodes | -50.42% +- 14.68 | -50.93% | 50/0/0 | 7.6e-10 |
| map1 | Adaptive A* | corners_ge45 | -81.33% +- 16.40 | -82.58% | 49/1/0 | 1.1e-09 |
| map1 | Redundant point deletion | time_s | +10.86% +- 12.23 | +8.65% | 1/0/49 | 3.6e-15 |
| map1 | Redundant point deletion | length_m | -1.72 m +- 0.64 | -1.71 m | 49/1/0 | 1.1e-09 |
| map1 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map1 | Redundant point deletion | corners_ge45 | -82.89% +- 16.37 | -85.71% | 49/1/0 | 1.1e-09 |
| map2 | Adaptive A* | time_s | -21.46% +- 30.98 | -24.40% | 41/0/9 | 2.2e-05 |
| map2 | Adaptive A* | length_m | -1.07 m +- 3.29 | -2.06 m | 37/0/13 | 0.00062 |
| map2 | Adaptive A* | expanded_nodes | -39.84% +- 23.09 | -39.82% | 48/0/2 | 2.4e-13 |
| map2 | Adaptive A* | corners_ge45 | -69.71% +- 16.65 | -73.80% | 49/0/1 | 7.8e-10 |
| map2 | Redundant point deletion | time_s | +7.11% +- 15.15 | +6.67% | 9/0/41 | 0.00053 |
| map2 | Redundant point deletion | length_m | -3.40 m +- 1.14 | -3.38 m | 50/0/0 | 1.8e-15 |
| map2 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map2 | Redundant point deletion | corners_ge45 | -72.92% +- 12.99 | -73.91% | 50/0/0 | 7.3e-10 |
| map3 | Adaptive A* | time_s | -62.70% +- 12.77 | -66.11% | 50/0/0 | 1.8e-15 |
| map3 | Adaptive A* | length_m | -1.76 m +- 2.25 | -2.56 m | 38/0/12 | 3e-06 |
| map3 | Adaptive A* | expanded_nodes | -71.22% +- 9.69 | -73.72% | 50/0/0 | 1.8e-15 |
| map3 | Adaptive A* | corners_ge45 | -81.39% +- 10.63 | -82.97% | 50/0/0 | 7.3e-10 |
| map3 | Redundant point deletion | time_s | +4.93% +- 14.28 | +2.86% | 10/0/40 | 2.1e-05 |
| map3 | Redundant point deletion | length_m | -4.03 m +- 0.87 | -3.85 m | 50/0/0 | 1.8e-15 |
| map3 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map3 | Redundant point deletion | corners_ge45 | -82.55% +- 8.42 | -83.33% | 50/0/0 | 7.4e-10 |

## Path optimality (where do the length gains come from?)

*Raw suboptimality*: grid cost of the raw Adaptive A* search path vs the optimal A* path (before pruning). *Adaptive A* vs A*+pruning*: final length difference (positive = Adaptive A* longer).

| Map | Raw path suboptimal on | Mean / max raw suboptimality | Adaptive A* longer than A*+pruning on | Mean length difference |
|---|---|---|---|---|
| map1 | 20/50 maps | 1.57% / 14.92% | 23/50 maps | +0.38 m |
| map2 | 25/50 maps | 2.11% / 16.88% | 45/50 maps | +2.33 m |
| map3 | 45/50 maps | 2.15% / 6.02% | 42/50 maps | +2.27 m |
