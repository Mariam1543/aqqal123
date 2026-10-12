"""Distance models and the adaptive heuristic weight (paper Sec. 2.2, 3.1, 3.2)."""

from __future__ import annotations

import math
from typing import Callable

from .grid import Cell

DistanceFn = Callable[[Cell, Cell], float]
WeightFn = Callable[[Cell], float]


def euclidean(a: Cell, b: Cell) -> float:
    """Eq. (2): straight-line distance."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def manhattan(a: Cell, b: Cell) -> float:
    """Eq. (3): city-block distance."""
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def chebyshev(a: Cell, b: Cell) -> float:
    """Eq. (4): maximum axis difference."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def octile(a: Cell, b: Cell) -> float:
    """Exact 8-connected cost on an empty grid (not used by the paper; reference only)."""
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (math.sqrt(2.0) - 1.0) * min(dx, dy)


def hybrid(a: Cell, b: Cell) -> float:
    """Eq. (7): arithmetic mean of the Euclidean and Manhattan distances."""
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return 0.5 * (math.hypot(dx, dy) + dx + dy)


def zero(a: Cell, b: Cell) -> float:
    """h = 0: A* degenerates into Dijkstra's algorithm."""
    return 0.0


DISTANCES: dict[str, DistanceFn] = {
    "euclidean": euclidean,
    "manhattan": manhattan,
    "chebyshev": chebyshev,
    "octile": octile,
    "hybrid": hybrid,
    "zero": zero,
}


def adaptive_weight(start: Cell, goal: Cell, distance: DistanceFn = euclidean) -> WeightFn:
    """Eq. (6): omega(n) = ln(1 + exp(d / D)).

    ``d`` is the distance from node ``n`` to the goal and ``D`` the distance from
    the start to the goal, both measured with ``distance`` (assumption M4:
    Euclidean). omega = ln(1 + e) ~ 1.313 at the start and ln 2 ~ 0.693 at the goal.
    """
    big_d = distance(start, goal)
    if big_d == 0:
        return lambda n: 1.0

    def omega(n: Cell) -> float:
        return math.log1p(math.exp(distance(n, goal) / big_d))

    return omega


def constant_weight(value: float = 1.0) -> WeightFn:
    return lambda n: value
