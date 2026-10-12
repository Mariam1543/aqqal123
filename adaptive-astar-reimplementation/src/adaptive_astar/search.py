"""Grid search algorithms: (weighted) A* per Algorithm 1, Dijkstra and bidirectional A*.

All searches are written from scratch on top of ``heapq``. Counting convention
(assumption M6): ``expanded`` is the number of nodes moved to the CLOSED list,
``generated`` is the number of distinct nodes ever placed on the OPEN list.
"""

from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass, field

from .grid import Cell, GridMap
from .heuristics import DistanceFn, WeightFn, euclidean, zero


@dataclass
class SearchResult:
    path: list[Cell]            # start ... goal; empty if no path exists
    cost: float                 # accumulated g-cost of the path (1 / sqrt(2) steps)
    expanded: int               # |CLOSED|
    generated: int              # distinct nodes ever opened
    closed: set[Cell] = field(default_factory=set, repr=False)

    @property
    def found(self) -> bool:
        return bool(self.path)


def _reconstruct(parent: dict[Cell, Cell | None], node: Cell) -> list[Cell]:
    path = [node]
    while parent[node] is not None:
        node = parent[node]
        path.append(node)
    path.reverse()
    return path


def astar(grid: GridMap, start: Cell, goal: Cell,
          heuristic: DistanceFn = euclidean, weight: WeightFn | None = None) -> SearchResult:
    """Best-first search with ``f(n) = g(n) + w(n) * h(n)`` (Eq. 1 / Eq. 5).

    Follows the paper's Algorithm 1: a node is finalised when popped from OPEN,
    CLOSED nodes are never re-opened, and the search stops when the goal is popped.
    Ties in ``f`` are broken by smaller ``h`` and then by insertion order
    (assumption M8), which makes every run deterministic.
    """
    if not (grid.is_free(*start) and grid.is_free(*goal)):
        return SearchResult([], float("inf"), 0, 0)

    h_cache: dict[Cell, float] = {}

    def h_term(n: Cell) -> float:
        val = h_cache.get(n)
        if val is None:
            hn = heuristic(n, goal)
            val = hn * weight(n) if weight is not None else hn
            h_cache[n] = val
        return val

    counter = itertools.count()
    g: dict[Cell, float] = {start: 0.0}
    parent: dict[Cell, Cell | None] = {start: None}
    hs = h_term(start)
    open_heap = [(hs, hs, next(counter), start)]
    closed: set[Cell] = set()

    while open_heap:
        _, _, _, current = heapq.heappop(open_heap)
        if current in closed:          # stale heap entry (lazy deletion)
            continue
        if current == goal:
            closed.add(current)
            return SearchResult(_reconstruct(parent, current), g[current],
                                len(closed), len(g), closed)
        closed.add(current)
        g_cur = g[current]
        for nb, step in grid.neighbors(current):
            if nb in closed:
                continue
            g_new = g_cur + step
            if g_new < g.get(nb, float("inf")):
                g[nb] = g_new
                parent[nb] = current
                hn = h_term(nb)
                heapq.heappush(open_heap, (g_new + hn, hn, next(counter), nb))

    return SearchResult([], float("inf"), len(closed), len(g), closed)


def dijkstra(grid: GridMap, start: Cell, goal: Cell) -> SearchResult:
    """Dijkstra's algorithm = A* with h(n) = 0."""
    return astar(grid, start, goal, heuristic=zero)


def bidirectional_astar(grid: GridMap, start: Cell, goal: Cell,
                        heuristic: DistanceFn = euclidean) -> SearchResult:
    """Bidirectional A* (assumption M14).

    A forward search (towards ``goal``) and a backward search (towards ``start``)
    alternate one expansion each. The search stops as soon as a node expanded by
    one side has already been expanded by the other, and the two half-paths are
    joined there. Stopping at the first meeting node (rather than continuing
    until the optimal-termination bound is met) is the textbook simple variant;
    it is fast but may return a slightly longer path, matching the paper's
    observation that BA* paths are longer.
    """
    if not (grid.is_free(*start) and grid.is_free(*goal)):
        return SearchResult([], float("inf"), 0, 0)
    if start == goal:
        return SearchResult([start], 0.0, 1, 1, {start})

    counter = itertools.count()
    sides = []
    for origin, target in ((start, goal), (goal, start)):
        h0 = heuristic(origin, target)
        sides.append({
            "target": target,
            "g": {origin: 0.0},
            "parent": {origin: None},
            "open": [(h0, h0, next(counter), origin)],
            "closed": set(),
        })

    turn = 0
    while sides[0]["open"] and sides[1]["open"]:
        me, other = sides[turn], sides[1 - turn]
        _, _, _, current = heapq.heappop(me["open"])
        if current in me["closed"]:
            continue
        me["closed"].add(current)
        if current in other["closed"]:
            fwd, bwd = sides[0], sides[1]
            first = _reconstruct(fwd["parent"], current)
            second = _reconstruct(bwd["parent"], current)[::-1][1:]
            closed = fwd["closed"] | bwd["closed"]
            cost = fwd["g"][current] + bwd["g"][current]
            generated = len(set(fwd["g"]) | set(bwd["g"]))
            return SearchResult(first + second, cost,
                                len(fwd["closed"]) + len(bwd["closed"]), generated, closed)
        g_cur = me["g"][current]
        for nb, step in grid.neighbors(current):
            if nb in me["closed"]:
                continue
            g_new = g_cur + step
            if g_new < me["g"].get(nb, float("inf")):
                me["g"][nb] = g_new
                me["parent"][nb] = current
                hn = heuristic(nb, me["target"])
                heapq.heappush(me["open"], (g_new + hn, hn, next(counter), nb))
        turn = 1 - turn

    expanded = len(sides[0]["closed"]) + len(sides[1]["closed"])
    return SearchResult([], float("inf"), expanded, len(set(sides[0]["g"]) | set(sides[1]["g"])))
