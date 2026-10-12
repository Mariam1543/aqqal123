"""Create the figures for the report (written to ``figures/``).

  fig_ablation_{30x30,60x60}.png   paper Fig. 6 / 7 analogue
  fig_algorithms_{size}.png        paper Fig. 8-10 analogue (reproducible baselines)
  fig_start_goal.png               paper Fig. 11 / 12 analogue
  fig_relative_change.png          published vs reproduced change relative to A*
  fig_robustness.png               distribution of changes on random maps
  fig_weight_heuristic.png         omega(d/D) and hybrid/octile overestimation

Usage:  python scripts/make_figures.py   (after run_experiments.py)
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import ListedColormap  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive_astar import PLANNERS, GridMap, from_paper, hybrid, octile  # noqa: E402

FIG = ROOT / "figures"
RES = ROOT / "results"

# Palette (validated reference palette, light mode)
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#8a8984"
SURFACE, GRID_LINE = "#fcfcfb", "#e4e3df"
OBSTACLE = "#3a3936"
EXPLORED = "#cde2fb"
BLUE, ORANGE = "#2a78d6", "#eb6834"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.titlesize": 9.5,
    "axes.edgecolor": GRID_LINE, "axes.labelcolor": INK2, "xtick.color": INK2,
    "ytick.color": INK2, "text.color": INK, "figure.facecolor": "white",
    "axes.facecolor": SURFACE, "savefig.dpi": 200, "savefig.bbox": "tight",
})

MAPS = {"30x30": "map1", "60x60": "map2", "100x100": "map3"}


def load(size: str) -> GridMap:
    return GridMap.load_csv(ROOT / "maps" / f"{MAPS[size]}.csv")


def draw_panel(ax, grid: GridMap, start, goal, planner: str, title: str, color=BLUE):
    s, t = from_paper(*start), from_paper(*goal)
    res = PLANNERS[planner].plan(grid, s, t)
    img = np.zeros(grid.occ.shape, dtype=int)
    for x, y in res.closed:
        img[y, x] = 1
    img[grid.occ] = 2
    cmap = ListedColormap([SURFACE, EXPLORED, OBSTACLE])
    # Paper coordinates: cell (x, y) centred on integer x, y (1-based).
    ax.imshow(img, cmap=cmap, vmin=0, vmax=2, origin="lower", interpolation="nearest",
              extent=(0.5, grid.width + 0.5, 0.5, grid.height + 0.5))
    px = [c[0] + 1 for c in res.path]
    py = [c[1] + 1 for c in res.path]
    ax.plot(px, py, color=color, lw=1.8, solid_capstyle="round", zorder=3)
    if planner in ("Adaptive A*", "Redundant point deletion", "A*+Octile+RPD"):
        ax.plot(px, py, "o", ms=2.8, color=color, zorder=4)
    ax.plot(*start, marker="s", ms=6, color=INK, zorder=5)
    ax.plot(*goal, marker="*", ms=10, color=INK, mec=SURFACE, zorder=5)
    ax.set_title(f"{title}\nL={res.length:.2f} m, N={res.expanded}, C={res.corners}", color=INK)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    return res


def fig_ablation() -> None:
    panels = [("A*", "(a) A*"), ("Adaptive estimation function", "(b) Adaptive estimation fn."),
              ("Distance model optimization", "(c) Distance model opt."),
              ("Redundant point deletion", "(d) Redundant point deletion")]
    for size, goal in (("30x30", (28, 28)), ("60x60", (58, 58))):
        grid = load(size)
        fig, axes = plt.subplots(1, 4, figsize=(11, 3.2))
        for ax, (name, title) in zip(axes, panels):
            draw_panel(ax, grid, (2, 2), goal, name, title)
        fig.suptitle(f"Ablation on the {size} proxy map (explored cells shaded; "
                     "L = length, N = expanded nodes, C = corners >= 45 deg)", color=INK2, y=1.02)
        fig.savefig(FIG / f"fig_ablation_{size}.png")
        plt.close(fig)


def fig_algorithms() -> None:
    panels = [("A*", "(a) A*"), ("Dijkstra", "(b) Dijkstra"), ("Bidirectional A*", "(c) Bidirectional A*"),
              ("Redundant point deletion", "(d) A* + pruning (extra)"), ("Adaptive A*", "(e) Adaptive A*")]
    for size, goal in (("30x30", (28, 28)), ("60x60", (58, 58)), ("100x100", (99, 99))):
        grid = load(size)
        fig, axes = plt.subplots(1, 5, figsize=(13.5, 3.2))
        for ax, (name, title) in zip(axes, panels):
            draw_panel(ax, grid, (2, 2), goal, name, title,
                       color=ORANGE if name == "Adaptive A*" else BLUE)
        fig.suptitle(f"Reproducible algorithms on the {size} proxy map", color=INK2, y=1.02)
        fig.savefig(FIG / f"fig_algorithms_{size}.png")
        plt.close(fig)


def fig_start_goal() -> None:
    cases = [("30x30", (28, 28), (2, 2)), ("30x30", (4, 24), (29, 2)),
             ("60x60", (58, 58), (2, 2)), ("60x60", (4, 54), (59, 2))]
    fig, axes = plt.subplots(2, 4, figsize=(11, 6))
    for col, (size, s, g) in enumerate(cases):
        grid = load(size)
        draw_panel(axes[0, col], grid, s, g, "A*", f"A*  {s}->{g}")
        draw_panel(axes[1, col], grid, s, g, "Adaptive A*", f"Adaptive A*  {s}->{g}", color=ORANGE)
    fig.suptitle("Different start and end points (Table 5 analogue)", color=INK2)
    fig.savefig(FIG / "fig_start_goal.png")
    plt.close(fig)


def _bars(ax, labels, paper, ours, unit):
    x = np.arange(len(labels))
    w = 0.36
    b1 = ax.bar(x - w / 2 - 0.01, paper, w, color=BLUE, label="Published (paper)")
    b2 = ax.bar(x + w / 2 + 0.01, ours, w, color=ORANGE, label="Reproduced (ours)")
    ax.axhline(0, color=MUTED, lw=0.8)
    ax.set_xticks(x, labels)
    ax.grid(axis="y", color=GRID_LINE, lw=0.6)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    lo = np.nanmin(np.concatenate([paper, ours, [0]]))
    hi = np.nanmax(np.concatenate([paper, ours, [0]]))
    span = hi - lo
    ax.set_ylim(lo - 0.04 * span, hi + 0.04 * span if hi > 0 else 0.02 * span)
    for bars in (b1, b2):
        for b in bars:
            v = b.get_height()
            if math.isnan(v):
                continue
            inside = abs(v) > 0.18 * span
            # Long bars: label inside the bar end (white); short bars: just beyond it.
            ax.annotate(f"{v:+.1f}{unit}", (b.get_x() + b.get_width() / 2, v),
                        xytext=(0, (4 if v < 0 else -4) if inside else (-4 if v < 0 else 4)),
                        textcoords="offset points", ha="center",
                        va=("bottom" if v < 0 else "top") if inside else ("top" if v < 0 else "bottom"),
                        fontsize=6.5, color="white" if inside else INK2, rotation=90 if inside else 0)
    return b1, b2


def fig_relative_change() -> None:
    cmp = pd.read_csv(RES / "comparison.csv")
    sub = cmp[cmp["table"].isin(["T2", "T3", "T4"]) & (cmp["algorithm"] == "Adaptive A*")]
    sub = sub.set_index("map").loc[["30x30", "60x60", "100x100"]]
    time_ours = sub["time_s_rel_ours"].to_numpy()
    time_title = "Planning time (% vs A*)"
    study = RES / "timing_study.csv"
    if study.exists():   # prefer the paired, interleaved measurement
        ts = pd.read_csv(study).set_index("map").loc[sub.index]
        time_ours = -ts["time_reduction_pct"].to_numpy()
        time_title = "Planning time (% vs A*, paired timing)"
    metrics = [("time_s", time_title, "%", time_ours),
               ("expanded_nodes", "Expanded nodes (% vs A*)", "%", None),
               ("length_m", "Path length (m vs A*)", "", None),
               ("corners_ge45", "Corners >= 45 deg (% vs A*)", "%", None)]
    fig, axes = plt.subplots(1, 4, figsize=(13, 3.4))
    for ax, (col, title, unit, override) in zip(axes, metrics):
        ours = override if override is not None else sub[f"{col}_rel_ours"].to_numpy()
        handles = _bars(ax, list(sub.index), sub[f"{col}_rel_paper"].to_numpy(), ours, unit)
        ax.set_title(title, color=INK)
    fig.legend(handles, ["Published (paper)", "Reproduced (ours)"], frameon=False, ncol=2,
               loc="upper right", bbox_to_anchor=(0.99, 1.08), fontsize=8.5)
    fig.suptitle("Adaptive A* relative to A* - published vs reproduced (negative = better)",
                 color=INK2, x=0.02, ha="left", y=1.06)
    fig.savefig(FIG / "fig_relative_change.png")
    plt.close(fig)


def fig_robustness() -> None:
    path = RES / "robustness.csv"
    if not path.exists():
        return
    rob = pd.read_csv(path)
    metrics = [("time_s", "Time (% vs A*)"), ("expanded_nodes", "Expanded nodes (% vs A*)"),
               ("length_m", "Length (m vs A*)"), ("corners_ge45", "Corners >= 45 deg (% vs A*)")]
    algos = [("Redundant point deletion", "A* + pruning", BLUE), ("Adaptive A*", "Adaptive A*", ORANGE)]
    fig, axes = plt.subplots(1, 4, figsize=(13, 3.4))
    for ax, (col, title) in zip(axes, metrics):
        pos = 0
        ticks, ticklabels = [], []
        for map_id in ("map1", "map2", "map3"):
            base = rob[(rob["map"] == map_id) & (rob["algorithm"] == "A*")].set_index("seed")[col]
            for k, (algo, _, color) in enumerate(algos):
                v = rob[(rob["map"] == map_id) & (rob["algorithm"] == algo)].set_index("seed")[col]
                change = (v - base) if col == "length_m" else 100 * (v - base) / base
                bp = ax.boxplot(change.to_numpy(), positions=[pos + k * 0.42], widths=0.34,
                                patch_artist=True, showfliers=True,
                                flierprops={"marker": "o", "ms": 2.5, "mfc": color, "mec": color},
                                medianprops={"color": INK, "lw": 1.2},
                                whiskerprops={"color": MUTED}, capprops={"color": MUTED})
                bp["boxes"][0].set(facecolor=color, edgecolor=color, alpha=0.85)
            ticks.append(pos + 0.21)
            ticklabels.append({"map1": "30x30", "map2": "60x60", "map3": "100x100"}[map_id])
            pos += 1.2
        ax.axhline(0, color=MUTED, lw=0.8)
        ax.set_xticks(ticks, ticklabels)
        ax.set_title(title, color=INK)
        ax.grid(axis="y", color=GRID_LINE, lw=0.6)
        ax.set_axisbelow(True)
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for _, _, c in algos]
    fig.legend(handles, [lbl for _, lbl, _ in algos], frameon=False, ncol=2,
               loc="upper right", bbox_to_anchor=(0.99, 1.08), fontsize=8.5)
    n = rob.groupby("map")["seed"].nunique().min()
    fig.suptitle(f"Change relative to A* on {n} random maps per scene type (negative = better)",
                 color=INK2, x=0.02, ha="left", y=1.06)
    fig.savefig(FIG / "fig_robustness.png")
    plt.close(fig)


def fig_weight_heuristic() -> None:
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9, 3.2))
    r = np.linspace(0, 1.5, 200)
    a1.plot(r, np.log1p(np.exp(r)), color=BLUE, lw=2)
    a1.axhline(1.0, color=MUTED, lw=0.8, ls="--")
    a1.annotate("ln 2 = 0.693 (at goal)", (0, math.log(2)), xytext=(0.12, 0.70), fontsize=8, color=INK2)
    a1.annotate("ln(1+e) = 1.313 (at start)", (1, math.log1p(math.e)), xytext=(0.55, 1.45),
                fontsize=8, color=INK2, arrowprops={"arrowstyle": "-", "color": MUTED})
    a1.plot([0, 1], [math.log(2), math.log1p(math.e)], "o", color=BLUE, ms=6)
    a1.set_xlabel("d / D  (distance to goal / start-goal distance)")
    a1.set_ylabel("adaptive weight  omega")
    a1.set_title("Eq. (6): omega = ln(1 + e^(d/D))", color=INK)

    theta = np.linspace(0, 90, 181)
    dx, dy = np.cos(np.radians(theta)), np.sin(np.radians(theta))
    ratio = [hybrid((0, 0), (x, y)) / octile((0, 0), (x, y)) for x, y in zip(dx, dy)]
    a2.plot(theta, ratio, color=ORANGE, lw=2)
    a2.axhline(1.0, color=MUTED, lw=0.8, ls="--")
    a2.annotate("max 1.207 at 45 deg", (45, max(ratio)), xytext=(52, 1.17), fontsize=8, color=INK2)
    a2.set_xlabel("direction to goal (deg)")
    a2.set_ylabel("h_hybrid / true 8-connected cost")
    a2.set_title("Eq. (7) overestimates on 8-connected grids", color=INK)
    for ax in (a1, a2):
        ax.grid(color=GRID_LINE, lw=0.6)
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(FIG / "fig_weight_heuristic.png")
    plt.close(fig)


def main() -> None:
    FIG.mkdir(exist_ok=True)
    fig_weight_heuristic()
    fig_ablation()
    fig_algorithms()
    fig_start_goal()
    fig_relative_change()
    fig_robustness()
    print("figures written to", FIG)


if __name__ == "__main__":
    main()
