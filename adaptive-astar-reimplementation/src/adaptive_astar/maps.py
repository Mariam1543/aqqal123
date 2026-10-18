"""Procedural generators for the three scene types of the paper (Sec. 4.1, Fig. 5).

The original obstacle matrices are not published (missing item M1), so the
experiments use *proxy maps*: maps of the same size and scene type whose
parameters are calibrated (``scripts/calibrate_maps.py``) so that Dijkstra and
A* reproduce the paper's published search statistics as closely as possible.

* ``irregular``  - map1, 30 x 30, irregular outdoor scene (random blobs);
* ``maze``       - map2, 60 x 60, structured indoor scene (maze + corridors);
* ``array``      - map3, 100 x 100, array-like scene (PV panel rows / racks).

All generators take an explicit ``numpy.random.Generator`` so every map is
reproducible from its seed.
"""

from __future__ import annotations

from collections import deque

import numpy as np

from .grid import Cell, GridMap, from_paper

# Start/goal pairs used in the paper (1-based paper coordinates).
PAPER_POINTS: dict[str, list[tuple[int, int]]] = {
    "map1": [(2, 2), (28, 28), (4, 24), (29, 2)],
    "map2": [(2, 2), (58, 58), (4, 54), (59, 2)],
    "map3": [(2, 2), (99, 99)],
}
MAP_SIZES = {"map1": 30, "map2": 60, "map3": 100}

# The two map sets used in the experiments.
#  * "paper": the paper's own maps, digitised from its Fig. 5 (scripts/digitize_figure5.py).
#    Diagonal corner cutting is allowed and pruning uses a Bresenham line of sight: with
#    these settings A* and Dijkstra reproduce the paper's published node counts.
#  * "proxy": procedurally generated maps calibrated to the paper's statistics
#    (scripts/calibrate_maps.py), with the conservative settings (no corner cutting,
#    supercover line of sight). Used before the figure was available, and for the
#    random-map robustness study.
MAP_SETS = {
    "paper": {"files": {"30x30": "paper_map1", "60x60": "paper_map2", "100x100": "paper_map3"},
              "corner_cutting": True, "los": "bresenham"},
    "proxy": {"files": {"30x30": "map1", "60x60": "map2", "100x100": "map3"},
              "corner_cutting": False, "los": "supercover"},
}


def load_map_set(name: str, maps_dir) -> dict:
    """Load the three maps of a map set as ``{"30x30": GridMap, ...}``."""
    from pathlib import Path
    cfg = MAP_SETS[name]
    return {size: GridMap.load_csv(Path(maps_dir) / f"{stem}.csv", allow_corner_cutting=cfg["corner_cutting"])
            for size, stem in cfg["files"].items()}
MAP_KINDS = {"map1": "irregular", "map2": "maze", "map3": "array"}


# --------------------------------------------------------------- generators
def irregular(n: int, rng: np.random.Generator, n_blobs: int = 18,
              blob_cells: tuple[int, int] = (6, 30)) -> np.ndarray:
    """Irregular outdoor obstacles: blobs grown by random cell accretion."""
    occ = np.zeros((n, n), dtype=bool)
    for _ in range(n_blobs):
        size = int(rng.integers(blob_cells[0], blob_cells[1] + 1))
        blob = [(int(rng.integers(0, n)), int(rng.integers(0, n)))]
        occ[blob[0][1], blob[0][0]] = True
        attempts = 0
        while len(blob) < size and attempts < 50 * size:   # a boxed-in blob just stops growing
            attempts += 1
            x, y = blob[int(rng.integers(0, len(blob)))]
            dx, dy = ((1, 0), (-1, 0), (0, 1), (0, -1))[int(rng.integers(0, 4))]
            nx, ny = x + dx, y + dy
            if 0 <= nx < n and 0 <= ny < n and not occ[ny, nx]:
                occ[ny, nx] = True
                blob.append((nx, ny))
    return occ


def maze(n: int, rng: np.random.Generator, corridor: int = 3, wall: int = 2,
         loop_prob: float = 0.15) -> np.ndarray:
    """Structured indoor scene: a randomised-DFS maze with corridors of width
    ``corridor`` and walls of thickness ``wall``; a fraction ``loop_prob`` of the
    remaining internal walls is opened to create alternative routes."""
    pitch = corridor + wall
    m = max(2, (n - wall) // pitch)                    # coarse cells per side
    occ = np.ones((n, n), dtype=bool)
    offset = (n - (m * pitch + wall)) // 2

    def room_origin(i: int, j: int) -> tuple[int, int]:
        return offset + wall + i * pitch, offset + wall + j * pitch

    for i in range(m):
        for j in range(m):
            x0, y0 = room_origin(i, j)
            occ[y0:y0 + corridor, x0:x0 + corridor] = False

    def open_between(a: tuple[int, int], b: tuple[int, int]) -> None:
        (i0, j0), (i1, j1) = a, b
        x0, y0 = room_origin(min(i0, i1), min(j0, j1))
        if i0 != i1:   # horizontal neighbours: knock out the vertical wall
            occ[y0:y0 + corridor, x0 + corridor:x0 + pitch] = False
        else:
            occ[y0 + corridor:y0 + pitch, x0:x0 + corridor] = False

    visited = np.zeros((m, m), dtype=bool)
    stack = [(0, 0)]
    visited[0, 0] = True
    walls_left = []
    while stack:
        i, j = stack[-1]
        nbrs = [(i + di, j + dj) for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= i + di < m and 0 <= j + dj < m and not visited[i + di, j + dj]]
        if not nbrs:
            stack.pop()
            continue
        k = nbrs[int(rng.integers(0, len(nbrs)))]
        open_between((i, j), k)
        visited[k] = True
        stack.append(k)
    for i in range(m):
        for j in range(m):
            for di, dj in ((1, 0), (0, 1)):
                if i + di < m and j + dj < m:
                    walls_left.append(((i, j), (i + di, j + dj)))
    for a, b in walls_left:
        if rng.random() < loop_prob:
            open_between(a, b)
    return occ


def array_field(n: int, rng: np.random.Generator, panel_h: int = 2, aisle: int = 3,
                panel_len: tuple[int, int] = (8, 16), gap: tuple[int, int] = (1, 3),
                missing_prob: float = 0.08, clutter: int = 20) -> np.ndarray:
    """Array-like scene: staggered rows of rectangular panels (PV strings,
    warehouse racks) separated by aisles, with random gaps, missing panels and
    a little random clutter."""
    occ = np.zeros((n, n), dtype=bool)
    y = aisle
    while y + panel_h < n - 1:
        x = int(rng.integers(0, panel_len[1]))
        while x < n:
            length = int(rng.integers(panel_len[0], panel_len[1] + 1))
            if rng.random() >= missing_prob:
                occ[y:y + panel_h, x:min(n, x + length)] = True
            x += length + int(rng.integers(gap[0], gap[1] + 1))
        y += panel_h + aisle
    for _ in range(clutter):
        cx, cy = int(rng.integers(0, n)), int(rng.integers(0, n))
        occ[cy:cy + int(rng.integers(1, 3)), cx:cx + int(rng.integers(1, 3))] = True
    return occ


GENERATORS = {"irregular": irregular, "maze": maze, "array": array_field}


# ----------------------------------------------------------------- helpers
def clear_points(occ: np.ndarray, cells: list[Cell], radius: int = 1) -> None:
    """Free the given cells and their (2r+1)^2 neighbourhood in place."""
    h, w = occ.shape
    for x, y in cells:
        occ[max(0, y - radius):min(h, y + radius + 1), max(0, x - radius):min(w, x + radius + 1)] = False


def connected(grid: GridMap, cells: list[Cell]) -> bool:
    """True if all cells lie in one 8-connected free component (BFS)."""
    if not all(grid.is_free(*c) for c in cells):
        return False
    seen = {cells[0]}
    queue = deque([cells[0]])
    while queue:
        cur = queue.popleft()
        for nb, _ in grid.neighbors(cur):
            if nb not in seen:
                seen.add(nb)
                queue.append(nb)
    return all(c in seen for c in cells)


def largest_component(grid: GridMap) -> set[Cell]:
    """Cells of the largest 8-connected free component."""
    unseen = {(x, y) for y in range(grid.height) for x in range(grid.width) if grid.is_free(x, y)}
    best: set[Cell] = set()
    while unseen:
        seed = unseen.pop()
        comp = {seed}
        queue = deque([seed])
        while queue:
            for nb, _ in grid.neighbors(queue.popleft()):
                if nb in unseen:
                    unseen.discard(nb)
                    comp.add(nb)
                    queue.append(nb)
        if len(comp) > len(best):
            best = comp
    return best


def carve_access(occ: np.ndarray, cells: list[Cell]) -> None:
    """Connect each required cell to the main free region with an L-shaped,
    1-cell-wide corridor (needed when a start/goal falls inside a wall)."""
    comp = largest_component(GridMap(occ))
    for x, y in cells:
        if (x, y) in comp:
            continue
        tx, ty = min(comp, key=lambda c: (c[0] - x) ** 2 + (c[1] - y) ** 2)
        occ[y, min(x, tx):max(x, tx) + 1] = False
        occ[min(y, ty):max(y, ty) + 1, tx] = False
        comp = largest_component(GridMap(occ))


def make_map(map_id: str, seed: int, **params) -> GridMap | None:
    """Generate a proxy map for ``map_id`` ("map1" | "map2" | "map3").

    The paper's start/goal cells are freed and, if necessary, linked to the
    main free region. Returns ``None`` if they are still not mutually reachable.
    """
    n = MAP_SIZES[map_id]
    rng = np.random.default_rng(seed)
    occ = GENERATORS[MAP_KINDS[map_id]](n, rng, **params)
    cells = [from_paper(*p) for p in PAPER_POINTS[map_id]]
    clear_points(occ, cells, radius=1)
    carve_access(occ, cells)
    grid = GridMap(occ, name=f"{map_id}_seed{seed}")
    return grid if connected(grid, cells) else None
