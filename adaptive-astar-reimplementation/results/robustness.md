# Robustness on random maps

Each scene type: 50 fresh random maps (calibrated generator, unseen seeds), paper start/goal. Change vs A* (length in metres, others in percent); W/T/L = maps where the method is lower / equal / higher than A*; p = two-sided Wilcoxon signed-rank test.

| Map | Method | Metric | Mean +- std | Median | W/T/L | p |
|---|---|---|---|---|---|---|
| map1 | Adaptive A* | time_s | -21.77% +- 21.14 | -24.71% | 42/0/8 | 3.6e-08 |
| map1 | Adaptive A* | length_m | -1.58 m +- 1.12 | -1.82 m | 48/0/2 | 9.8e-10 |
| map1 | Adaptive A* | expanded_nodes | -47.79% +- 16.02 | -51.26% | 50/0/0 | 7.5e-10 |
| map1 | Adaptive A* | corners_ge45 | -77.98% +- 12.66 | -78.76% | 50/0/0 | 7.3e-10 |
| map1 | Redundant point deletion | time_s | +13.09% +- 9.74 | +11.68% | 1/0/49 | 1.8e-14 |
| map1 | Redundant point deletion | length_m | -1.86 m +- 0.57 | -2.01 m | 50/0/0 | 1.8e-15 |
| map1 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map1 | Redundant point deletion | corners_ge45 | -79.18% +- 13.00 | -80.91% | 50/0/0 | 7.3e-10 |
| map2 | Adaptive A* | time_s | -13.77% +- 31.10 | -21.51% | 32/0/18 | 0.0088 |
| map2 | Adaptive A* | length_m | -1.97 m +- 3.24 | -2.88 m | 41/0/9 | 2e-05 |
| map2 | Adaptive A* | expanded_nodes | -35.51% +- 21.78 | -34.74% | 49/0/1 | 7.6e-14 |
| map2 | Adaptive A* | corners_ge45 | -65.49% +- 8.80 | -64.29% | 50/0/0 | 7.2e-10 |
| map2 | Redundant point deletion | time_s | +8.22% +- 12.78 | +8.03% | 7/0/43 | 3.4e-06 |
| map2 | Redundant point deletion | length_m | -4.06 m +- 0.89 | -4.01 m | 50/0/0 | 1.8e-15 |
| map2 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map2 | Redundant point deletion | corners_ge45 | -67.32% +- 8.30 | -67.12% | 50/0/0 | 7.3e-10 |
| map3 | Adaptive A* | time_s | -65.65% +- 10.61 | -68.65% | 50/0/0 | 1.8e-15 |
| map3 | Adaptive A* | length_m | -2.84 m +- 2.36 | -3.85 m | 45/0/5 | 7.2e-10 |
| map3 | Adaptive A* | expanded_nodes | -73.99% +- 6.63 | -75.21% | 50/0/0 | 1.8e-15 |
| map3 | Adaptive A* | corners_ge45 | -76.68% +- 7.12 | -76.94% | 50/0/0 | 7.3e-10 |
| map3 | Redundant point deletion | time_s | +3.70% +- 10.16 | +4.99% | 12/0/38 | 0.00016 |
| map3 | Redundant point deletion | length_m | -5.79 m +- 0.99 | -6.01 m | 50/0/0 | 1.8e-15 |
| map3 | Redundant point deletion | expanded_nodes | +0.00% +- 0.00 | +0.00% | 0/50/0 | 1 |
| map3 | Redundant point deletion | corners_ge45 | -82.01% +- 6.50 | -82.02% | 50/0/0 | 7.3e-10 |

## Path optimality (where do the length gains come from?)

*Raw suboptimality*: grid cost of the raw Adaptive A* search path vs the optimal A* path (before pruning). *Adaptive A* vs A*+pruning*: final length difference (positive = Adaptive A* longer).

| Map | Raw path suboptimal on | Mean / max raw suboptimality | Adaptive A* longer than A*+pruning on | Mean length difference |
|---|---|---|---|---|
| map1 | 16/50 maps | 1.12% / 14.15% | 22/50 maps | +0.28 m |
| map2 | 27/50 maps | 2.02% / 13.69% | 40/50 maps | +2.09 m |
| map3 | 42/50 maps | 2.19% / 6.93% | 43/50 maps | +2.95 m |
