"""Occupancy-grid environment model (paper Sec. 2.1).

Cells are 1 m x 1 m squares. Internally a map is a boolean NumPy array
``occ[y, x]`` (True = obstacle) with 0-based indices. The paper uses 1-based
``(x, y)`` coordinates with the origin at the bottom-left, e.g. start ``(2, 2)``
on every map and goal ``(99, 99)`` on the 100 x 100 map; ``from_paper`` and
``to_paper`` convert between the two conventions.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

SQRT2 = math.sqrt(2.0)

# 8-connected motion model (assumption M2): straight moves cost 1, diagonal sqrt(2).
STRAIGHT_MOVES = ((1, 0), (-1, 0), (0, 1), (0, -1))
DIAGONAL_MOVES = ((1, 1), (1, -1), (-1, 1), (-1, -1))

Cell = tuple[int, int]


def from_paper(x: int, y: int) -> Cell:
    """Convert a 1-based paper coordinate to a 0-based internal cell."""
    return (x - 1, y - 1)


def to_paper(cell: Cell) -> tuple[int, int]:
    """Convert a 0-based internal cell to a 1-based paper coordinate."""
    return (cell[0] + 1, cell[1] + 1)


class GridMap:
    """A 2-D occupancy grid with an 8-connected (or 4-connected) neighbourhood.

    Parameters
    ----------
    occ:
        Boolean array indexed ``[y, x]``; True marks an obstacle cell.
    connectivity:
        8 (default, as implied by the paper's 45-degree turn metric) or 4.
    allow_corner_cutting:
        If False (default, assumption M3) a diagonal move is only allowed when
        both orthogonally adjacent cells are free, so the robot never squeezes
        between two obstacles that touch at a corner.
    """

    def __init__(self, occ: np.ndarray, connectivity: int = 8,
                 allow_corner_cutting: bool = False, name: str = "map"):
        if connectivity not in (4, 8):
            raise ValueError("connectivity must be 4 or 8")
        self.occ = np.asarray(occ, dtype=bool)
        self.height, self.width = self.occ.shape
        self.connectivity = connectivity
        self.allow_corner_cutting = allow_corner_cutting
        self.name = name
        # Plain nested lists are much faster than NumPy for scalar look-ups
        # inside the Python search loop.
        self._occ_rows = self.occ.tolist()

    # ------------------------------------------------------------------ cells
    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def is_free(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height and not self._occ_rows[y][x]

    def neighbors(self, cell: Cell):
        """Yield ``(neighbour_cell, step_cost)`` pairs for a free cell."""
        x, y = cell
        rows = self._occ_rows
        w, h = self.width, self.height
        for dx, dy in STRAIGHT_MOVES:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not rows[ny][nx]:
                yield (nx, ny), 1.0
        if self.connectivity == 4:
            return
        for dx, dy in DIAGONAL_MOVES:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h) or rows[ny][nx]:
                continue
            if not self.allow_corner_cutting and (rows[y][nx] or rows[ny][x]):
                continue
            yield (nx, ny), SQRT2

    # -------------------------------------------------------------------- I/O
    def save_csv(self, path: str | Path) -> None:
        """Save as CSV with the top row = largest y (so the file looks like the figure)."""
        np.savetxt(path, self.occ[::-1].astype(int), fmt="%d", delimiter=",")

    @classmethod
    def load_csv(cls, path: str | Path, **kwargs) -> "GridMap":
        arr = np.loadtxt(path, delimiter=",", dtype=int)[::-1]
        kwargs.setdefault("name", Path(path).stem)
        return cls(arr.astype(bool), **kwargs)

    def obstacle_ratio(self) -> float:
        return float(self.occ.mean())

    def __repr__(self) -> str:
        return (f"GridMap(name={self.name!r}, size={self.width}x{self.height}, "
                f"obstacles={self.obstacle_ratio():.1%}, connectivity={self.connectivity})")
