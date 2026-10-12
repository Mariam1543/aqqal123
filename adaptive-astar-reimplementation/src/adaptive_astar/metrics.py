"""Evaluation metrics used in the paper's Tables 1-5."""

from __future__ import annotations

import math

from .grid import Cell


def path_length(path: list[Cell], cell_size: float = 1.0) -> float:
    """Euclidean polyline length in metres (assumption M16)."""
    return cell_size * sum(math.dist(path[i], path[i + 1]) for i in range(len(path) - 1))


def turn_angles(path: list[Cell]) -> list[float]:
    """Absolute heading change (degrees) at every interior node."""
    angles = []
    for i in range(1, len(path) - 1):
        ax, ay = path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]
        bx, by = path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]
        cross = ax * by - ay * bx
        dot = ax * bx + ay * by
        angles.append(abs(math.degrees(math.atan2(cross, dot))))
    return angles


def count_sharp_turns(path: list[Cell], threshold_deg: float = 45.0) -> int:
    """Number of corners whose heading change is >= threshold (assumption M7)."""
    return sum(1 for a in turn_angles(path) if a >= threshold_deg - 1e-9)
