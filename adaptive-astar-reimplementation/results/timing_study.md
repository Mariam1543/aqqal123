# Interleaved timing study (Adaptive A* vs A*)

300 alternating pairs per map, GC disabled, `time.perf_counter`; ratio = t(Adaptive A*) / t(A*) per pair; 95% CI by bootstrap (2000 resamples).

| Map | A* median (ms) | Adaptive A* median (ms) | Median ratio [95% CI] | Time reduction ours | Time reduction paper | Node ratio |
|---|---|---|---|---|---|---|
| 30x30 | 0.633 | 0.561 | 0.882 [0.870, 0.898] | 11.8% | 75.0% | 0.438 |
| 60x60 | 3.598 | 1.815 | 0.505 [0.502, 0.509] | 49.5% | 66.7% | 0.369 |
| 100x100 | 12.932 | 5.104 | 0.397 [0.394, 0.401] | 60.3% | 64.3% | 0.298 |

Mean time reduction over the three maps: ours 40.5% vs paper 68.7%.
