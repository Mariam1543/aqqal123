# Part 3 — Research Paper Analysis and Feasibility

**Selected article.** H. Cao, Z. Guo, Y. Zhang, Z. Lu, and L. Jiang, "An Adaptive A\* Algorithm for Mobile Robots Global Path Planning," *Electronics*, vol. 15, no. 13, Art. no. 2807, Jun. 2026, doi: 10.3390/electronics15132807.

**Source-code check (Assignment §2).** Searches for the title, the DOI and the authors on the web and GitHub (October 2026) found no public implementation, so the article meets the "no public source code" requirement. Before submitting, also check the *Data Availability Statement* at the end of the MDPI article (it usually says "available on request" or "contained within the article") and include a screenshot of your GitHub search as evidence. Generic A\* code is available online (for example, PythonRobotics), but none of it implements this paper's method. Do not copy any of it: the A\* core, the adaptive weight, the hybrid heuristic and the pruning must all be your own code.

---

## Q1. What problem does the work address, and what are its objectives and contributions?

**Problem.** The paper looks at global (offline, static-map) path planning for a mobile robot on a 2-D occupancy grid. The authors say conventional A\* has three weaknesses:

1. **Low search efficiency.** A fixed, usually underestimating heuristic makes A\* expand many nodes, so planning is slow, especially with dense obstacles (the OPEN list grows quickly).
2. **Poor environmental adaptability.** One fixed distance metric (Euclidean, Manhattan or Chebyshev) fits some motion models (4- vs 8-direction) and map types better than others.
3. **Unsmooth paths.** Grid paths contain many redundant waypoints and sharp 45°/90° turns that do not suit robot kinematics.

The authors also argue that earlier work improves only one of these at a time, uses fixed or linear heuristic weights, and ignores safety when removing waypoints.

**Objectives.** Shorten planning time, keep or shorten path length, reduce the number of sharp turns (heading changes ≥ 45°), and stay robust across map sizes, map types and start/goal pairs.

**Contributions (as claimed):**

| # | Contribution | Targets |
|---|---|---|
| C1 | **Adaptive estimation function**: $f(n)=g(n)+\omega(n)\,h(n)$ with $\omega(n)=\ln(1+e^{d/D})$. The weight depends on the ratio of the current node's distance to the goal ($d$) to the start's distance to the goal ($D$). | Planning time, expanded nodes |
| C2 | **Hybrid distance model**: $h(n)=\tfrac12\big(\text{Euclidean}+\text{Manhattan}\big)$ | Adaptability to 4- and 8-direction motion, node count |
| C3 | **Redundant-point deletion** using collinearity and obstacle line-of-sight checks | Path smoothness, path length |

**Reported headline results.** Averaged over three maps and compared with conventional A\*: 69% less planning time, paths 2.66 m shorter, and 38.1% fewer turns ≥ 45°. The paper also says the method gives the shortest and smoothest paths among A\*, Dijkstra, Chen's method, Bidirectional A\* and Zhang's method.

---

## Q2. What methodology is proposed?

The pipeline (paper Fig. 3) is:

```
grid map ─► A* search with  f = g + ω(n)·h_hyb(n) ─► raw grid path ─► redundant-point deletion ─► final path
```

**(a) Environment model (Sec. 2.1).** A 2-D grid of 1 m × 1 m cells; white cells are free and black cells are obstacles. Cell coordinates are $(x_i,y_j)$. The text and the 45° turn metric imply 8-connected motion with diagonal moves.

**(b) Baseline A\* (Sec. 2.2, Alg. 1).** Standard OPEN/CLOSED-list A\*, with $f=g+h$.

**(c) Adaptive weight (Sec. 3.1, Eqs. 5–6).**
$$f(n)=g(n)+\omega(n)\,h(n),\qquad \omega(n)=\ln\!\left(1+e^{d/D}\right)$$
where $d$ is the distance from node $n$ to the goal and $D$ is the distance from the start to the goal. Plugging in the endpoints (my calculation):

| Location | $d/D$ | $\omega$ |
|---|---|---|
| At start | 1 | $\ln(1+e) \approx 1.313$ |
| At goal | 0 | $\ln 2 \approx 0.693$ |
| Detour node farther from the goal than the start | 1.5 | ≈ 1.70 |

So the search is greedier than A\* (ω > 1) far from the goal and less greedy than A\* (ω < 1) near the goal. This is a softplus-shaped form of the classic dynamic-weighting idea (Pohl, 1973), which moves from ω > 1 down to ω = 1 as the search progresses.

**(d) Hybrid heuristic (Sec. 3.2, Eq. 7).**
$$h(n)=\frac{\sqrt{(x_n-x_g)^2+(y_n-y_g)^2}+|x_n-x_g|+|y_n-y_g|}{2}$$

**(e) Redundant-point deletion (Sec. 3.3, Fig. 4).** Walk along the raw path in windows of three nodes $(P_i,P_{i+1},P_{i+2})$:
- If the three nodes are collinear and the segment is obstacle-free, delete $P_{i+1}$.
- If they are not collinear, connect $P_i$ to $P_{i+2}$. If that line misses every obstacle, delete $P_{i+1}$; otherwise keep it.
- Repeat until no more nodes can be removed, then join the remaining nodes.

In effect this is line-of-sight "string pulling": the final path is any-angle and no longer limited to grid directions.

**(f) Evaluation.** Four metrics: planning time (s), path length (m), number of traversed nodes, and number of turns with heading change ≥ 45°. There are three experiments: an ablation (Table 1), a comparison against five baselines on three maps (Tables 2–4), and changed start/goal pairs (Table 5).

---

## Q3. What datasets are used, and are they publicly available?

There is no dataset in the machine-learning sense. The "data" are **three hand-built binary grid maps** plus start/goal pairs:

| Map | Size | Scene type | Start → Goal (main) | Extra pairs (Table 5) |
|---|---|---|---|---|
| map1 | 30 × 30 | irregular outdoor | (2,2) → (28,28) | (28,28)→(2,2); (4,24)→(29,2) |
| map2 | 60 × 60 | structured indoor (maze/corridor) | (2,2) → (58,58) | (58,58)→(2,2); (4,54)→(59,2) |
| map3 | 100 × 100 | array-like (PV station/warehouse) | (2,2) → (99,99) | none |

**Availability: not public.** The maps appear only as images (Figs. 5–12). No occupancy matrix, `.mat` file or link is given. To reproduce them I must **digitise the maps from the figures**: overlay a grid on Fig. 5a–c, read each cell as 0 or 1, and check the result by confirming the published A\* path length is reproduced. This is the main source of reproduction error and must be documented as a deviation.

To support multiple runs and fair comparison, I will also generate **random benchmark maps** of the same sizes and obstacle densities with fixed seeds. As an optional extra, I can use public grid benchmarks (Sturtevant's Moving-AI maze/room maps), which are freely downloadable. These count as supplementary experiments, not as the paper's own data.

---

## Q4. What language, libraries, tools and compute are required?

| Item | Original paper | My planned re-implementation |
|---|---|---|
| Language/tool | MATLAB R2023b | **Python 3.10+** (MATLAB/Octave optional as a cross-check) |
| Core libraries | MATLAB base | `numpy` (grid), `heapq` (priority queue, standard library), `math` |
| Visualisation | MATLAB plots | `matplotlib` |
| Results/tables | not stated | `pandas` (CSV/LaTeX tables) |
| Map digitising | not applicable | `Pillow`/`opencv-python` (optional) or manual entry |
| OS/CPU/RAM | Windows 11, Intel i5-1340P @ 1.9 GHz, 16 GB | Any laptop |
| GPU | none | none |

**Compute.** Very small. A\* on a 100 × 100 grid (10⁴ cells) runs in milliseconds to tens of milliseconds in Python. The whole experimental suite, including 100 timing repetitions per configuration, finishes in minutes on a CPU.

---

## Q5. Is the method practically feasible with the available resources?

**Yes, highly feasible.** Reasons:

- The algorithm is deterministic and classical: A\* with a modified $f$, plus one geometric post-processing pass. There is no training, no GPU and no external data.
- Every equation (Eqs. 1–7) is explicit and cheap to compute.
- The total implementation is roughly 300–500 lines of Python: grid A\*, the heuristic variants, the adaptive weight, line-of-sight (Bresenham/supercover), pruning, metrics, Dijkstra, Bidirectional A\* and plotting.

**Feasibility risks:**

1. **Exact maps** must be digitised from figures. This is feasible but tedious and approximate.
2. **Absolute timing** will not match. MATLAB vs Python and a different CPU change wall-clock times, and the paper reports time to only 0.01 s. I should compare **relative** improvements (%), not raw seconds.
3. **Two baselines** ("Chen's method" and "Zhang's method") cannot be built exactly without their references and details. See Q7.

---

## Q6. Are there enough implementation details to reproduce the research?

**Partly.** The core idea can be reproduced, but bit-exact numbers cannot.

**Well specified:**
- The cost function and adaptive weight formula (Eqs. 5–6).
- The hybrid heuristic (Eq. 7).
- The overall pipeline (Fig. 3) and the logic of the pruning steps.
- Map sizes, start/goal coordinates, and 1 m cell size.
- The four evaluation metrics and the hardware/software environment.

**Under-specified or missing:**
- The exact obstacle layouts.
- The neighbourhood and cost model.
- The precise definitions of the metrics.
- The number of runs and timing protocol.
- The baseline definitions.

These are listed in Q7. With documented assumptions, the **trends** should be reproducible: fewer expanded nodes, less time, fewer turns after pruning. The **exact table values** can only be approximated.

---

## Q7. What is missing, unclear or hard to reproduce?

### 7.1 Missing information

| # | Missing item | Impact | My assumption (to document) |
|---|---|---|---|
| M1 | Obstacle matrices for map1–3 | High: every metric depends on them | Digitise from Fig. 5; validate against published A\* length |
| M2 | **4- or 8-connectivity**, move costs | High | 8-connected; cost 1 (straight) and √2 (diagonal) |
| M3 | **Corner-cutting rule** (can a diagonal move pass between two diagonal obstacle cells?) | Medium | Disallow diagonal moves if either adjacent orthogonal cell is blocked (safe for a robot) |
| M4 | Which metric is used for $d$ and $D$ in Eq. 6 | Medium | Euclidean (one variant will also use the hybrid metric) |
| M5 | Heuristic used by baseline A\* | High (baseline numbers depend on it) | Euclidean, as Sec. 3.2 says it is "traditional" |
| M6 | Definition of **"traversed nodes"** (CLOSED size? OPEN+CLOSED? path nodes?) | High | Report expanded (CLOSED) count as primary, OPEN+CLOSED as secondary |
| M7 | Definition of **turn angle ≥ 45°** (heading change between consecutive segments?) | Medium | Absolute heading change between consecutive path segments ≥ 45° − ε |
| M8 | Tie-breaking rule in OPEN list | Medium: changes the path shape and turn count | Lower $h$ first, then FIFO; also report sensitivity |
| M9 | Line-of-sight test used in pruning (Bresenham? supercover? clearance margin?) | Medium | Supercover line (every cell the segment touches must be free) |
| M10 | Order of pruning (anchor-based greedy vs sliding window; single or repeated pass) | Medium | Anchor-based greedy, repeated until no change |
| M11 | **Number of runs / timing method** (mean? median? warm-up?) | High for time | 100 repetitions, report median ± IQR using `time.perf_counter` |
| M12 | Whether reported time includes pruning | Low–Medium | Report search-only and total separately |
| M13 | **Chen's method and Zhang's method**: references and parameters are not in the main text, and "Chen" is not cited in the introduction | High for Tables 2–4 | Implement only if the reference list gives an algorithm; otherwise mark as "not reproduced" |
| M14 | Bidirectional A\* termination rule | Low–Medium | Stop when frontiers meet; report the meeting-point path (as the paper seems to do) |
| M15 | Coordinate convention ((x,y) vs (row,col); origin at top-left or bottom-left; 1-based indexing) | Low but error-prone | 1-based (x = column, y = row), origin at bottom-left as in Fig. 1 |
| M16 | Raw values of Tables 1–5 (not in my copy of the paper) | Needed for the comparison table | Take them from the published PDF |

### 7.2 Unclear or inconsistent statements (good points for the critical analysis and viva)

1. **The text and the formula disagree about ω.** Sec. 3.1 says the weight depends on "the ratio of the distance between the current node and the starting point to the distance to the destination". Eq. 6 instead uses $d/D$ = (current→goal)/(start→goal). I follow the equation.
2. **"Tuning the coefficients"** (Abstract) suggests tunable parameters, but Eq. 6 has none. The weight is fully determined by geometry.
3. **The hybrid heuristic is not admissible on 8-connected grids.** For a diagonal offset (Δx = Δy = k), $h=\tfrac{k\sqrt2+2k}{2}\approx1.707k$, while the true octile cost is $\sqrt2 k\approx1.414k$. That is a **20.7% overestimate**, and my numerical check confirms 1.207 is the maximum ratio. Combined with ω ≤ 1.313 (more for detour nodes), the effective inflation reaches about 1.59, so **the A\* search no longer guarantees an optimal grid path.** The paper's claim that the hybrid "maintains the optimal trend of Euclidean distance" is therefore not strictly correct. On 4-connected grids the hybrid is admissible, since (E + M)/2 ≤ M.
4. **"Shorter than A\*" comes from post-processing, not the search.** Weighted search cannot beat optimal A\* on grid path length. The adaptive method is shorter only because pruning turns the grid path into an any-angle path. A fair test is to apply the same pruning to plain A\* ("A\* + pruning").
5. **Ablation vs full method (30 × 30).** Pruning alone reportedly shortens the path by 1.67 m (40.41 → about 38.74 m) and cuts ≥ 45° turns from 9 to 5. The full method reaches only 39.72 m and 7 turns. So **the full combination is worse on length and smoothness than pruning alone**, which undercuts the "synergy" claim. A likely cause is that the adaptive weight produces a worse raw path for the pruning step to start from. Confirm this against Table 1.
6. **Ambiguous percentages.** "The number of nodes dropped to 86.2%" could mean dropped *by* or *to*. The Dijkstra comparison says "an increase of 79.4% and 71.4%", but those numbers are (632−130)/632 and (0.14−0.04)/0.14. They are **reductions relative to Dijkstra**, not increases relative to A\*.
7. **Timing resolution.** Times like 0.01–0.04 s at 2-decimal precision mean "75% faster" (0.04 → 0.01) could come from rounding alone. No repetitions or variance are reported.
8. **Heuristic theory is misstated.** Sec. 3.1 says overestimation "enlarges the explored region". In standard theory, overestimation (weighted A\*) usually **shrinks** the explored region at the cost of optimality. The text also says ω "avoids local optima", but A\* is a complete best-first search and does not get stuck in local optima.
9. **Wrong figure reference.** Step 2 of the pruning cites "Figure 3b", but this should be Figure 4b.
10. **Safety is claimed but not modelled.** The paper criticises prior work for ignoring safety, yet pruning uses only obstacle-intersection tests with no clearance or inflation radius. Shortcut segments may graze obstacle corners.
11. **The square-root argument is inconsistent.** Sec. 3.2 says Euclidean distance is slower because of the square root, yet the proposed hybrid also computes one.

### 7.3 Reproducibility verdict

| Aspect | Rating |
|---|---|
| Algorithm description | Good (equations explicit) |
| Data/maps | Poor (figures only) |
| Experimental protocol | Poor (no runs, no variance, coarse timing) |
| Baselines | Partial (A\*, Dijkstra, BA\* reproducible; Chen/Zhang uncertain) |
| **Overall** | **Moderately reproducible.** Qualitative trends can be reproduced; exact numbers cannot. |

---

## Implications for the re-implementation plan (Parts 4–6)

1. Implement baseline A\* and the three improvements as **independent switches**, so the ablation (Table 1) can be reproduced: `--weight {none,adaptive}`, `--heuristic {euclid,manhattan,octile,hybrid}`, `--prune {off,on}`.
2. Add a fair extra baseline: **A\* + pruning only**. This tests whether the length and smoothness gains come from pruning or from the search changes.
3. Digitise map1–3 from Fig. 5, store them as `.csv`/`.npy`, and record the validation error against the published A\* length.
4. Time with 100 repetitions and report median ± IQR. Report node counts, which are deterministic and do not depend on hardware, as the main efficiency metric.
5. Run robustness tests on N = 50 random maps per size (fixed seeds) and use a paired Wilcoxon test to compare adaptive A\* with A\*.
6. Record every assumption M1–M16 in the README and in the IEEE report's "Deviations" subsection.
