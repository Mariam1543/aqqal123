"""Named planners used in the experiments, built from the three switches of the paper.

Every planner returns a :class:`PlanResult` with the raw grid path, the final
path (after redundant point deletion when enabled) and the four paper metrics.

=====================  ===============  ==============  =============  =======
Planner                heuristic h(n)   weight w(n)     pruning        paper
=====================  ===============  ==============  =============  =======
A*                     Euclidean        1               no             Tab 1-5
Dijkstra               0                -               no             Tab 2-4
Bidirectional A*       Euclidean        1               no             Tab 2-4
AEF (isolated)         Euclidean        Eq. (6)         no             Tab 1
DMO (isolated)         hybrid Eq. (7)   1               no             Tab 1
RPD (isolated)         Euclidean        1               yes            Tab 1
AEF+DMO (cumulative)   hybrid           Eq. (6)         no             extra
Adaptive A*            hybrid           Eq. (6)         yes            Tab 1-5
A*+Octile+RPD          octile           1               yes            extra
... (single-pass)      as above         as above        single-pass    extra
... (V4: E+M w/o 1/2)  Euclid+Manhattan Eq. (6)         yes            extra
=====================  ===============  ==============  =============  =======
"""

from __future__ import annotations

import gc
import statistics
import time
from dataclasses import dataclass
from typing import Callable

from .grid import Cell, GridMap
from .heuristics import adaptive_weight, euclidean, hybrid, hybrid_sum, octile
from .metrics import count_sharp_turns, path_length
from .search import SearchResult, astar, bidirectional_astar, dijkstra
from .smoothing import delete_redundant_points


@dataclass
class PlanResult:
    planner: str
    raw_path: list[Cell]
    path: list[Cell]
    expanded: int
    generated: int
    raw_cost: float
    length: float
    corners: int
    closed: set[Cell]

    @property
    def found(self) -> bool:
        return bool(self.path)


@dataclass(frozen=True)
class PlannerSpec:
    name: str
    search: str = "astar"          # astar | dijkstra | bidirectional
    heuristic: str = "euclidean"   # euclidean | hybrid | octile
    adaptive: bool = False         # use the adaptive weight of Eq. (6)
    prune: bool = False            # apply redundant point deletion (Sec. 3.3)
    prune_mode: str = "anchor"     # anchor | single-pass (sensitivity, assumption M10)
    los: str = "supercover"        # supercover | bresenham line-of-sight test (assumption M9)

    def search_only(self, grid: GridMap, start: Cell, goal: Cell) -> SearchResult:
        h = {"euclidean": euclidean, "hybrid": hybrid, "hybrid_sum": hybrid_sum,
             "octile": octile}[self.heuristic]
        if self.search == "dijkstra":
            return dijkstra(grid, start, goal)
        if self.search == "bidirectional":
            return bidirectional_astar(grid, start, goal, heuristic=h)
        weight = adaptive_weight(start, goal) if self.adaptive else None
        return astar(grid, start, goal, heuristic=h, weight=weight)

    def plan(self, grid: GridMap, start: Cell, goal: Cell) -> PlanResult:
        res = self.search_only(grid, start, goal)
        final = (delete_redundant_points(grid, res.path, self.prune_mode, self.los)
                 if (self.prune and res.found) else res.path)
        return PlanResult(
            planner=self.name, raw_path=res.path, path=final,
            expanded=res.expanded, generated=res.generated, raw_cost=res.cost,
            length=path_length(final) if final else float("nan"),
            corners=count_sharp_turns(final) if final else -1,
            closed=res.closed,
        )


PLANNERS: dict[str, PlannerSpec] = {p.name: p for p in [
    PlannerSpec("A*"),
    PlannerSpec("Dijkstra", search="dijkstra"),
    PlannerSpec("Bidirectional A*", search="bidirectional"),
    PlannerSpec("Adaptive estimation function", adaptive=True),
    PlannerSpec("Distance model optimization", heuristic="hybrid"),
    PlannerSpec("Redundant point deletion", prune=True),
    PlannerSpec("AEF+DMO (no pruning)", heuristic="hybrid", adaptive=True),
    PlannerSpec("Adaptive A*", heuristic="hybrid", adaptive=True, prune=True),
    PlannerSpec("A*+Octile+RPD", heuristic="octile", prune=True),
    PlannerSpec("Redundant point deletion (single-pass)", prune=True, prune_mode="single-pass"),
    PlannerSpec("Adaptive A* (single-pass pruning)", heuristic="hybrid", adaptive=True,
                prune=True, prune_mode="single-pass"),
    PlannerSpec("Adaptive A* (V4: E+M without 1/2)", heuristic="hybrid_sum", adaptive=True, prune=True),
]}


def time_planner(spec: PlannerSpec, grid: GridMap, start: Cell, goal: Cell,
                 repeats: int = 30, warmup: int = 2) -> dict[str, float]:
    """Wall-clock time of search + pruning (assumption M11/M12).

    Returns median, inter-quartile range, mean and std over ``repeats`` runs,
    measured with ``time.perf_counter`` and the garbage collector disabled.
    """
    run: Callable[[], PlanResult] = lambda: spec.plan(grid, start, goal)
    for _ in range(warmup):
        run()
    samples = []
    gc_was_enabled = gc.isenabled()
    gc.disable()
    try:
        for _ in range(repeats):
            t0 = time.perf_counter()
            run()
            samples.append(time.perf_counter() - t0)
    finally:
        if gc_was_enabled:
            gc.enable()
    q = statistics.quantiles(samples, n=4) if len(samples) >= 2 else [samples[0]] * 3
    return {
        "time_median": statistics.median(samples),
        "time_iqr": q[2] - q[0],
        "time_mean": statistics.fmean(samples),
        "time_std": statistics.pstdev(samples),
        "repeats": repeats,
    }
