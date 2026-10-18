"""Compare our planners with the paths and explored regions drawn in the paper's Figs. 8 and 9.

The paper's result figures shade every expanded (CLOSED) cell grey and draw the
final path in red. For the 30 x 30 map (Fig. 8, ~4.9 px per cell) and the
60 x 60 map (Fig. 9, ~2.4 px per cell) we classify every free cell of a panel
as explored / not explored and count:

* how many of the paper's explored cells our planner also expands, and
* how many cells our planner expands that the paper shows as NOT explored
  (cells under the red line are ignored: the pruned path crosses cells that
  were never expanded).

For Adaptive A* this distinguishes Eqs. 5-7 as printed from the "V4" variant
(E+M without the 1/2). The 100 x 100 panels (Fig. 10, ~1.5 px per cell) are
too coarse for a reliable cell-level classification and are not used.

Output: results/paper_maps/figure_agreement.md and
        figures/paper_maps/fig_paper_vs_ours_panels.png
Usage:  python scripts/compare_paper_figures.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import PLANNERS, PlannerSpec, from_paper  # noqa: E402
from adaptive_astar.maps import load_map_set  # noqa: E402

SPECS = {
    "A*": PLANNERS["A*"],
    "Dijkstra": PLANNERS["Dijkstra"],
    "Adaptive A* (Eqs. as printed)": PlannerSpec("as printed", heuristic="hybrid", adaptive=True,
                                                  prune=True, los="bresenham"),
    "Adaptive A* (V4: E+M, no 1/2)": PlannerSpec("V4", heuristic="hybrid_sum", adaptive=True,
                                                  prune=True, los="bresenham"),
}
ADAPTIVE = ["Adaptive A* (Eqs. as printed)", "Adaptive A* (V4: E+M, no 1/2)"]

# (figure file, map, goal, panel letter -> pixel box of the panel's grid, planners to compare)
# 30 x 30: box = grid extent; 60 x 60: box = search window for the black border walls.
CASES = [
    ("paper_figure8_30x30.png", "30x30", (28, 28), "a", (50, 196, 110, 256), ["A*"]),
    ("paper_figure8_30x30.png", "30x30", (28, 28), "b", (310, 456, 110, 256), ["Dijkstra"]),
    ("paper_figure8_30x30.png", "30x30", (28, 28), "f", (570, 717, 340, 486), ADAPTIVE),
    ("paper_figure9_60x60.png", "60x60", (58, 58), "a", (40, 205, 100, 265), ["A*"]),
    ("paper_figure9_60x60.png", "60x60", (58, 58), "f", (560, 725, 330, 495), ADAPTIVE),
]


def cells_30(rgb: np.ndarray, box) -> tuple[np.ndarray, np.ndarray]:
    """Mean colour of each cell centre (30 x 30 panel); returns (luminance, redness) as [y, x] bottom-up."""
    x0, x1, y0, y1 = box
    n = 30
    w, h = (x1 - x0 + 1) / n, (y1 - y0 + 1) / n
    lum, red = np.zeros((n, n)), np.zeros((n, n))
    for r in range(n):
        for c in range(n):
            p = rgb[int(y0 + r * h + h / 4):int(y0 + (r + 1) * h - h / 4) + 1,
                    int(x0 + c * w + w / 4):int(x0 + (c + 1) * w - w / 4) + 1].reshape(-1, 3)
            m = p.mean(0)
            lum[n - 1 - r, c] = m.mean()
            red[n - 1 - r, c] = ((p[:, 0] - p[:, 1]) > 50).mean() * 100
    return lum, red


def cells_60(img: Image.Image, box) -> tuple[np.ndarray, np.ndarray]:
    """Mean colour of each cell centre (60 x 60 panel), with the pitch fixed by the border walls."""
    rgb = np.asarray(img.convert("RGB")).astype(float)
    x0, x1, y0, y1 = box
    dark = rgb[y0:y1, x0:x1].max(2) < 120
    cols = np.flatnonzero(dark.sum(0) > 0.7 * dark.shape[0])
    rows = np.flatnonzero(dark.sum(1) > 0.7 * dark.shape[1])

    def centres(ix):
        splits = np.flatnonzero(np.diff(ix) > 1)
        first, last = ix[:splits[0] + 1] if len(splits) else ix, ix[splits[-1] + 1:] if len(splits) else ix
        return first.mean(), last.mean()

    xl, xr = (x0 + v for v in centres(cols))
    yt, yb = (y0 + v for v in centres(rows))
    n, s = 60, 10
    px, py = (xr - xl) / (n - 1), (yb - yt) / (n - 1)
    left, top = int(xl - px), int(yt - py)
    crop = img.convert("RGB").crop((left, top, int(xr + px) + 1, int(yb + py) + 1))
    big = np.asarray(crop.resize((crop.width * s, crop.height * s), Image.BILINEAR)).astype(float)
    lum, red = np.zeros((n, n)), np.zeros((n, n))
    for r in range(n):
        for c in range(n):
            cx, cy = (xl + c * px - left) * s, (yt + r * py - top) * s
            m = big[int(cy - 0.3 * py * s):int(cy + 0.3 * py * s) + 1,
                    int(cx - 0.3 * px * s):int(cx + 0.3 * px * s) + 1].reshape(-1, 3).mean(0)
            lum[n - 1 - r, c] = m.mean()
            red[n - 1 - r, c] = m[0] - m[1]
    return lum, red


def explored_cells(lum, red, occ, size):
    """Paper-explored cells and cells under the red path line (sets of internal (x, y))."""
    free = ~occ
    if size == "30x30":
        on_path = red > 15
        explored = free & ~on_path & (lum < 222)               # grey vs white (~250)
    else:
        on_path = red > 40
        cand = free & ~on_path
        explored = cand & (lum < np.median(lum[cand]) - 12)   # darker than the usual grid-lined free cell
    as_set = lambda m: {(x, y) for y, x in zip(*np.nonzero(m))}
    return as_set(explored), as_set(on_path)


def main() -> None:
    maps = load_map_set("paper", ROOT / "maps")
    rows = ["# Paper figures vs our planners (explored cells)", "",
            "Generated by `scripts/compare_paper_figures.py`. *Covered* = share of the cells the paper shades as "
            "explored that our planner also expands. *Extra* = cells our planner expands that the paper shows as "
            "not explored (cells under the red path line are ignored).", "",
            "| Figure panel | Planner | Our expanded nodes | Paper explored cells covered | Extra cells (not explored in paper) |",
            "|---|---|---|---|---|"]
    panels = []
    for fname, size, goal, letter, box, names in CASES:
        img = Image.open(ROOT / "data" / fname)
        grid = maps[size]
        lum, red = (cells_30(np.asarray(img.convert("RGB")).astype(float), box) if size == "30x30"
                    else cells_60(img, box))
        explored, on_path = explored_cells(lum, red, grid.occ, size)
        s, t = from_paper(2, 2), from_paper(*goal)
        for name in names:
            res = SPECS[name].plan(grid, s, t)
            covered = len(explored & res.closed)
            extra = len(res.closed - explored - on_path)
            rows.append(f"| Fig. {fname[12:14].strip('_')}({letter}) {size} | {name} | {res.expanded} | "
                        f"{covered}/{len(explored)} ({100 * covered / max(1, len(explored)):.0f}%) | {extra} |")
            print(rows[-1])
            if letter == "f":
                panels.append((img, box, size, name, res, grid))
    rows += ["", "On the 60 x 60 panels the dense grid lines make the shading threshold over-detect explored "
             "cells (e.g. 743 for A*, which expands 715), so there the *Extra* column is the reliable measure.",
             "The 100 x 100 panels of Fig. 10 (~1.5 px per cell) are too coarse for this cell-level comparison."]
    out = ROOT / "results" / "paper_maps"
    out.mkdir(parents=True, exist_ok=True)
    (out / "figure_agreement.md").write_text("\n".join(rows) + "\n")
    side_by_side(panels)


def side_by_side(panels) -> None:
    """Paper panel (f) next to our two Adaptive A* readings, for each map."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    by_size: dict[str, list] = {}
    for p in panels:
        by_size.setdefault(p[2], []).append(p)
    fig, axes = plt.subplots(len(by_size), 3, figsize=(11, 3.8 * len(by_size)))
    for row, (size, items) in enumerate(by_size.items()):
        img, box = items[0][0], items[0][1]
        x0, x1, y0, y1 = box
        pad = 2 if size == "30x30" else -8
        axes[row, 0].imshow(img.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad)), interpolation="nearest")
        axes[row, 0].set_title(f"Paper Fig. {'8' if size == '30x30' else '9'}(f), {size}")
        for col, (_, _, _, name, res, grid) in enumerate(items, start=1):
            imgc = np.zeros(grid.occ.shape, dtype=int)
            for x, y in res.closed:
                imgc[y, x] = 1
            imgc[grid.occ] = 2
            ax = axes[row, col]
            ax.imshow(imgc, cmap=ListedColormap(["#fcfcfb", "#c8c8c4", "#1a1a19"]), origin="lower",
                      interpolation="nearest", extent=(0.5, grid.width + 0.5, 0.5, grid.height + 0.5))
            ax.plot([c[0] + 1 for c in res.path], [c[1] + 1 for c in res.path], color="#e34948", lw=1.5)
            ax.set_title(f"Ours: {name.replace('Adaptive A* ', '')}\nN={res.expanded}, L={res.length:.2f} m")
        for ax in axes[row]:
            ax.set_xticks([])
            ax.set_yticks([])
    fig.tight_layout()
    out = ROOT / "figures" / "paper_maps"
    out.mkdir(parents=True, exist_ok=True)
    fig.savefig(out / "fig_paper_vs_ours_panels.png", dpi=150)
    print("wrote results/paper_maps/figure_agreement.md and figures/paper_maps/fig_paper_vs_ours_panels.png")


if __name__ == "__main__":
    main()
