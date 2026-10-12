"""Unit tests for the re-implementation (run: python -m unittest discover -s tests)."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from adaptive_astar import (PLANNERS, GridMap, adaptive_weight, astar, bidirectional_astar,  # noqa: E402
                            count_sharp_turns, delete_redundant_points, dijkstra, euclidean,
                            hybrid, line_of_sight, octile, path_length)
from adaptive_astar.maps import make_map, PAPER_POINTS  # noqa: E402
from adaptive_astar.grid import from_paper  # noqa: E402


def empty(n=10):
    return GridMap(np.zeros((n, n), dtype=bool))


def is_valid_grid_path(grid, path):
    if not all(grid.is_free(*c) for c in path):
        return False
    return all(max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1 for a, b in zip(path, path[1:]))


class TestHeuristics(unittest.TestCase):
    def test_paper_equations(self):
        a, b = (0, 0), (3, 4)
        self.assertAlmostEqual(euclidean(a, b), 5.0)
        self.assertAlmostEqual(hybrid(a, b), (5.0 + 7.0) / 2)

    def test_adaptive_weight_range(self):
        w = adaptive_weight((0, 0), (10, 0))
        self.assertAlmostEqual(w((0, 0)), math.log(1 + math.e))   # ~1.313 at start
        self.assertAlmostEqual(w((10, 0)), math.log(2))           # ~0.693 at goal

    def test_hybrid_overestimates_diagonal(self):
        # The paper's hybrid heuristic is inadmissible on 8-connected grids.
        self.assertGreater(hybrid((0, 0), (5, 5)), octile((0, 0), (5, 5)))
        self.assertAlmostEqual(hybrid((0, 0), (5, 5)) / octile((0, 0), (5, 5)), 1.2071, places=3)


class TestSearch(unittest.TestCase):
    def test_empty_grid_diagonal(self):
        g = empty()
        res = astar(g, (0, 0), (9, 9))
        self.assertAlmostEqual(res.cost, 9 * math.sqrt(2))
        self.assertTrue(is_valid_grid_path(g, res.path))

    def test_astar_matches_dijkstra_on_random_maps(self):
        for seed in range(5):
            g = make_map("map1", seed)
            s, t = from_paper(2, 2), from_paper(28, 28)
            self.assertAlmostEqual(astar(g, s, t).cost, dijkstra(g, s, t).cost)
            self.assertLessEqual(astar(g, s, t).expanded, dijkstra(g, s, t).expanded)

    def test_no_corner_cutting(self):
        occ = np.zeros((3, 3), dtype=bool)
        occ[0, 1] = occ[1, 0] = True          # obstacles touching diagonally
        g = GridMap(occ)
        self.assertNotIn((1, 1), [n for n, _ in g.neighbors((0, 0))])

    def test_unreachable_goal(self):
        occ = np.zeros((5, 5), dtype=bool)
        occ[:, 2] = True
        res = astar(GridMap(occ), (0, 0), (4, 4))
        self.assertFalse(res.found)

    def test_bidirectional_returns_valid_path(self):
        g = make_map("map2", 3)
        s, t = from_paper(2, 2), from_paper(58, 58)
        res = bidirectional_astar(g, s, t)
        self.assertTrue(is_valid_grid_path(g, res.path))
        self.assertEqual((res.path[0], res.path[-1]), (s, t))
        self.assertGreaterEqual(res.cost + 1e-9, dijkstra(g, s, t).cost)


class TestSmoothing(unittest.TestCase):
    def test_line_of_sight_blocked_and_corner(self):
        occ = np.zeros((5, 5), dtype=bool)
        occ[2, 2] = True
        g = GridMap(occ)
        self.assertFalse(line_of_sight(g, (0, 0), (4, 4)))    # through the obstacle
        self.assertTrue(line_of_sight(g, (0, 0), (4, 0)))
        self.assertFalse(line_of_sight(g, (1, 3), (3, 1)))    # grazes obstacle via (2,2)

    def test_pruning_straightens_staircase(self):
        g = empty()
        path = [(0, 0), (1, 0), (2, 0), (3, 1), (4, 2), (5, 3)]
        self.assertEqual(delete_redundant_points(g, path), [(0, 0), (5, 3)])

    def test_pruned_path_is_collision_free_and_not_longer(self):
        for mid in PAPER_POINTS:
            g = make_map(mid, 7)
            s, t = [from_paper(*p) for p in PAPER_POINTS[mid][:2]]
            raw = astar(g, s, t).path
            for mode in ("anchor", "single-pass"):
                pruned = delete_redundant_points(g, raw, mode)
                self.assertEqual((pruned[0], pruned[-1]), (s, t))
                self.assertLessEqual(path_length(pruned), path_length(raw) + 1e-9)
                for a, b in zip(pruned, pruned[1:]):
                    self.assertTrue(line_of_sight(g, a, b))

    def test_single_pass_removes_every_other_node(self):
        g = empty()
        path = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
        self.assertEqual(delete_redundant_points(g, path, "single-pass"), [(0, 0), (2, 0), (4, 0)])
        self.assertEqual(delete_redundant_points(g, path, "anchor"), [(0, 0), (4, 0)])


class TestMetrics(unittest.TestCase):
    def test_turn_counting(self):
        path = [(0, 0), (1, 0), (2, 1), (2, 2), (1, 3)]   # 45, 45, 45 degree turns
        self.assertEqual(count_sharp_turns(path), 3)
        self.assertEqual(count_sharp_turns([(0, 0), (1, 0), (2, 0)]), 0)

    def test_planner_registry(self):
        g = make_map("map1", 0)
        s, t = from_paper(2, 2), from_paper(28, 28)
        for name, spec in PLANNERS.items():
            res = spec.plan(g, s, t)
            self.assertTrue(res.found, name)
            self.assertEqual((res.path[0], res.path[-1]), (s, t))


if __name__ == "__main__":
    unittest.main()
