"""Digitise the paper's three maps from its Figure 5 (data/paper_figure5_maps.png).

The paper publishes its maps only as a figure. This script reads that figure
(a 753 x 337 px screenshot of Fig. 5 from the open-access MDPI article) and
converts each panel into an occupancy grid:

* map1 (30 x 30, ~4.9 px per cell): each cell is classified by the mean
  "blackness" of the pixels around its centre (bimodal, threshold 128).
  The red start / blue goal cells are coloured, not black, so they stay free.
* map2 (60 x 60, ~2.45 px per cell): the cell pitch is fixed by the two black
  border walls (cell 1 and cell 60). Each cell centre is sampled on a 10x
  bilinear upsampling of the panel and thresholded.
* map3 (100 x 100, ~1.49 px per cell): too fine for per-cell sampling, but the
  map is a regular array of 5 x 5-cell blocks. Each dark connected component is
  converted to a block from its pixel bounding box. At 1.5 px per cell a block
  group can be misplaced by one cell, so the four column groups and four row
  groups are refined by +-1 cell: ``--search-map3`` evaluates all 3^8 offsets
  and keeps the one whose *baseline* statistics (Dijkstra nodes and length, A*
  nodes; never the proposed method) are closest to the paper. The stored result
  (MAP3_GROUP_OFFSETS) moves only two groups by one cell.

Output: maps/paper_map1.csv, maps/paper_map2.csv, maps/paper_map3.csv (same CSV
format as the proxy maps) and figures/fig_digitised_maps.png (original panel
next to the digitised grid, for visual verification).

Usage:  python scripts/digitize_figure5.py [path/to/figure.png] [--search-map3]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import GridMap, astar, dijkstra, from_paper  # noqa: E402

# Pixel geometry of the three panels in data/paper_figure5_maps.png, measured from
# the image (map extents for map1/map3; border-wall centre lines for map2).
MAP1_BOX = (47, 194, 104, 252)          # x0, x1, y0, y1 of the 30 x 30 grid
MAP2_BORDER_CENTRES = (307.5, 452.0, 106.0, 250.5)   # x of col 1 / col 60, y of row 60 / row 1
MAP3_BOX = (565, 713, 104, 252)         # extent of the 100 x 100 grid
MAP3_BLOCK = 5                          # block size in cells (all 99 detected blocks are 5 x 5)
# Block-group offsets (cells) for the 4 column groups and 4 row groups, found by --search-map3.
MAP3_GROUP_OFFSETS = {"dx": (-1, 0, 0, 0), "dy": (0, 0, 1, 0)}
MAP3_GROUPS = ((0, 3), (3, 6), (6, 9), (9, 10))   # block columns / rows that move together


def blackness(img: Image.Image) -> np.ndarray:
    """Per-pixel max over RGB: black obstacles are low, white/grey/red/blue are high."""
    return np.asarray(img.convert("RGB")).astype(float).max(axis=2)


def digitise_map1(bk: np.ndarray) -> np.ndarray:
    x0, x1, y0, y1 = MAP1_BOX
    n = 30
    w, h = (x1 - x0 + 1) / n, (y1 - y0 + 1) / n
    occ = np.zeros((n, n), dtype=bool)                     # row 0 = top of the figure
    for r in range(n):
        for c in range(n):
            cx, cy = x0 + (c + 0.5) * w, y0 + (r + 0.5) * h
            patch = bk[int(np.floor(cy - h / 4)):int(np.ceil(cy + h / 4)) + 1,
                       int(np.floor(cx - w / 4)):int(np.ceil(cx + w / 4)) + 1]
            occ[r, c] = patch.mean() < 128
    return occ


def digitise_map2(img: Image.Image) -> np.ndarray:
    n, s = 60, 10
    xl, xr, yt, yb = MAP2_BORDER_CENTRES
    pitch_x, pitch_y = (xr - xl) / (n - 1), (yb - yt) / (n - 1)
    left, top = int(xl - pitch_x), int(yt - pitch_y)
    right, bottom = int(xr + pitch_x) + 1, int(yb + pitch_y) + 1
    crop = img.convert("RGB").crop((left, top, right, bottom))
    big = blackness(crop.resize(((right - left) * s, (bottom - top) * s), Image.BILINEAR))
    occ = np.zeros((n, n), dtype=bool)
    half = 0.3                                              # sample +-0.3 cell around the centre
    for r in range(n):
        for c in range(n):
            cx = (xl + c * pitch_x - left) * s
            cy = (yt + r * pitch_y - top) * s
            patch = big[int(cy - half * pitch_y * s):int(cy + half * pitch_y * s) + 1,
                        int(cx - half * pitch_x * s):int(cx + half * pitch_x * s) + 1]
            occ[r, c] = patch.mean() < 140
    return occ


def detect_map3_blocks(bk: np.ndarray):
    """Lower-left corners (paper coordinates) of the 5 x 5 blocks detected in panel (c).

    Returns the sorted distinct block x and y origins and the set of (x, y) lattice
    positions where no block is drawn (the top row has no 10th column)."""
    x0, x1, y0, y1 = MAP3_BOX
    n = 100
    w, h = (x1 - x0 + 1) / n, (y1 - y0 + 1) / n
    labels, _ = ndimage.label(bk[y0:y1 + 1, x0:x1 + 1] < 110)
    origins = set()
    for ys, xs in ndimage.find_objects(labels):
        if ys.stop - ys.start < 3 or xs.stop - xs.start < 3:      # ignore specks
            continue
        col = int(round(xs.start / w)) + 1                         # 1-based paper x of the left column
        top_row = int(round(ys.start / h))                         # 0-based row from the top
        origins.add((col, n - top_row - MAP3_BLOCK + 1))           # paper y of the bottom row
    bx, by = sorted({o[0] for o in origins}), sorted({o[1] for o in origins})
    missing = {(x, y) for x in bx for y in by if (x, y) not in origins}
    return bx, by, missing


def build_map3(bx, by, missing, dx=(0, 0, 0, 0), dy=(0, 0, 0, 0)) -> np.ndarray:
    """Top-down occupancy array of the block lattice with per-group offsets applied."""
    occ = np.zeros((100, 100), dtype=bool)                         # [y-1, x-1], bottom-up
    for gi, (a, b) in enumerate(MAP3_GROUPS):
        for i in range(a, b):
            for gj, (c, d) in enumerate(MAP3_GROUPS):
                for j in range(c, d):
                    if (bx[i], by[j]) in missing:
                        continue
                    x, y = bx[i] + dx[gi], by[j] + dy[gj]
                    occ[y - 1:y - 1 + MAP3_BLOCK, x - 1:x - 1 + MAP3_BLOCK] = True
    return occ[::-1]


def _baseline_error(args):
    bx, by, missing, offsets = args
    grid = GridMap(build_map3(bx, by, missing, offsets[:4], offsets[4:])[::-1].copy(), allow_corner_cutting=True)
    s, t = from_paper(2, 2), from_paper(99, 99)
    if not (grid.is_free(*s) and grid.is_free(*t)):
        return None
    d, a = dijkstra(grid, s, t), astar(grid, s, t)
    err = (abs(np.log(d.expanded / 7520)) + abs(np.log(a.expanded / 2191))
           + 3 * abs(np.log(d.cost / 146.41)))                     # paper Table 4 baselines
    return err, sum(map(abs, offsets)), offsets


def search_map3_offsets(bx, by, missing):
    """Try every +-1 offset of the 8 block groups; prefer the best fit, then the fewest moves."""
    import itertools
    from multiprocessing import Pool
    jobs = [(bx, by, missing, o) for o in itertools.product((-1, 0, 1), repeat=8)]
    with Pool() as pool:
        results = [r for r in pool.map(_baseline_error, jobs, chunksize=64) if r]
    err, _, best = min(results, key=lambda r: (round(r[0], 6), r[1]))
    print(f"map3 offset search: best error {err:.4f} with dx={best[:4]}, dy={best[4:]}")
    return {"dx": tuple(best[:4]), "dy": tuple(best[4:])}


def digitise_map3(bk: np.ndarray, search: bool = False) -> np.ndarray:
    bx, by, missing = detect_map3_blocks(bk)
    offsets = search_map3_offsets(bx, by, missing) if search else MAP3_GROUP_OFFSETS
    return build_map3(bx, by, missing, offsets["dx"], offsets["dy"])


def save(occ_top_down: np.ndarray, name: str) -> GridMap:
    grid = GridMap(occ_top_down[::-1].copy(), name=name)    # internal grids are bottom-up
    grid.save_csv(ROOT / "maps" / f"{name}.csv")
    return grid


def comparison_figure(img: Image.Image, grids: list[GridMap]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    boxes = [MAP1_BOX, (305, 455, 104, 252), MAP3_BOX]
    fig, axes = plt.subplots(2, 3, figsize=(12, 8))
    for k, (grid, (x0, x1, y0, y1)) in enumerate(zip(grids, boxes)):
        axes[0, k].imshow(img.crop((x0, y0, x1 + 1, y1 + 1)), interpolation="nearest")
        axes[0, k].set_title(f"Paper Fig. 5 ({grid.width}x{grid.height})")
        axes[1, k].imshow(grid.occ, cmap=ListedColormap(["#fcfcfb", "#3a3936"]), origin="lower",
                          interpolation="nearest")
        axes[1, k].set_title(f"Digitised: {grid.obstacle_ratio():.1%} obstacles")
        for ax in axes[:, k]:
            ax.set_xticks([])
            ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(ROOT / "figures" / "fig_digitised_maps.png", dpi=150)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = Path(args[0]) if args else ROOT / "data" / "paper_figure5_maps.png"
    img = Image.open(path)
    bk = blackness(img)
    grids = [save(digitise_map1(bk), "paper_map1"), save(digitise_map2(img), "paper_map2"),
             save(digitise_map3(bk, search="--search-map3" in sys.argv), "paper_map3")]
    for g in grids:
        print(g)
    comparison_figure(img, grids)
    print("wrote maps/paper_map{1,2,3}.csv and figures/fig_digitised_maps.png")


if __name__ == "__main__":
    main()
