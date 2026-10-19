# Archive: first-phase code (not used for the final results)

`calibrate_maps.py` built the *proxy* maps `maps/map{1,2,3}.csv`, which we used before the paper's Fig. 5 was available as an image (first phase, `docs/02_reproduction_results.md`).

**None of the final results use it.** The final results are in `results/paper_maps/` and `docs/03_paper_maps_reproduction.md`. They run on the maps digitised from the paper's Fig. 5 (`scripts/digitize_figure5.py` → `maps/paper_map{1,2,3}.csv`).

The script is kept for transparency only, together with its random-map generator parameters (`maps/calibration.json`). The robustness study's random maps reuse those generator settings to draw *new*, unseen maps.

Usage (from the project root): `python archive/calibrate_maps.py --budget-scale 4`
