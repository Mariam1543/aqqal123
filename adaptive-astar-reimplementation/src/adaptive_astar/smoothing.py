"""Redundant point deletion strategy (paper Sec. 3.3, Fig. 4).

Path nodes are cell centres. A straight segment between two nodes is safe only
if it does not touch any obstacle cell. Cells are treated as closed squares
``[x - 0.5, x + 0.5] x [y - 0.5, y + 0.5]``, so a segment that merely grazes an
obstacle corner is rejected (assumption M9: conservative, no corner cutting -
consistent with the search's no-corner-cutting rule).
"""

from __future__ import annotations

import math

from .grid import Cell, GridMap

_EPS = 1e-9


def segment_cells(a: Cell, b: Cell) -> list[Cell]:
    """All grid cells whose closed square intersects the segment a-b (exact supercover)."""
    (x0, y0), (x1, y1) = a, b
    cells: list[Cell] = []
    if x0 == x1:
        for y in range(min(y0, y1), max(y0, y1) + 1):
            cells.append((x0, y))
        return cells
    if x0 > x1:
        (x0, y0), (x1, y1) = (x1, y1), (x0, y0)
    slope = (y1 - y0) / (x1 - x0)
    for cx in range(x0, x1 + 1):
        # Portion of the segment lying inside column cx (|x - cx| <= 0.5).
        xa = max(cx - 0.5, x0)
        xb = min(cx + 0.5, x1)
        ya = y0 + slope * (xa - x0)
        yb = y0 + slope * (xb - x0)
        lo, hi = min(ya, yb), max(ya, yb)
        # Rows r whose interval [r - 0.5, r + 0.5] meets [lo, hi].
        r_lo = math.ceil(lo - 0.5 - _EPS)
        r_hi = math.floor(hi + 0.5 + _EPS)
        for cy in range(r_lo, r_hi + 1):
            cells.append((cx, cy))
    # Column boundaries are closed too: a segment passing exactly through the
    # boundary x = cx + 0.5 already enumerates both columns above.
    return cells


def line_of_sight(grid: GridMap, a: Cell, b: Cell) -> bool:
    """True if the straight segment between cell centres a and b is obstacle-free."""
    for x, y in segment_cells(a, b):
        if not grid.is_free(x, y):
            return False
    return True


def is_collinear(p: Cell, q: Cell, r: Cell) -> bool:
    """Collinearity test via the 2-D cross product (Step 2)."""
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) == 0


def delete_redundant_points(grid: GridMap, path: list[Cell], mode: str = "anchor") -> list[Cell]:
    """Remove redundant nodes from a grid path (Steps 1-4 of Sec. 3.3).

    Walk the path with a three-node window (P_i, P_i+1, P_i+2) anchored at P_i:
      * Step 2 - if the three nodes are collinear and the segment is free,
        delete the middle node;
      * Step 3 - otherwise connect P_i to P_i+2 and delete the middle node if
        that line does not cross an obstacle, else keep it and advance the anchor.
    After a deletion the anchor stays put and the window slides to the next
    node (assumption M10), so the anchor keeps "pulling the string" until line
    of sight is lost. Step 4 joins the kept nodes into the new path.

    ``mode="single-pass"`` is the alternative, more literal reading used as a
    sensitivity check: the window is never re-anchored, i.e. after deleting the
    middle node the window jumps to the next triple (P_i+2, P_i+3, P_i+4), so
    each node is examined once and at most every other node can be removed.
    """
    if mode not in ("anchor", "single-pass"):
        raise ValueError("mode must be 'anchor' or 'single-pass'")
    if len(path) <= 2:
        return list(path)
    kept = [path[0]]
    anchor = path[0]
    i = 1
    while i < len(path) - 1:
        middle, nxt = path[i], path[i + 1]
        # Step 2: a collinear triple is free by construction (anchor->middle was
        # already verified and middle->nxt is a free grid step). Step 3: otherwise
        # the shortcut anchor->nxt needs an explicit line-of-sight test.
        removable = is_collinear(anchor, middle, nxt) or line_of_sight(grid, anchor, nxt)
        if not removable:
            kept.append(middle)                    # Step 3: shortcut blocked, keep node
            anchor = middle
            i += 1
        elif mode == "anchor":
            i += 1                                 # keep the anchor, test the next node
        else:
            if i + 1 < len(path) - 1:
                kept.append(nxt)                   # window jumps past the deleted node
            anchor = nxt
            i += 2
    kept.append(path[-1])
    return kept
