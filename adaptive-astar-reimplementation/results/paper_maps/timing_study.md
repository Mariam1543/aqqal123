# Interleaved timing study (Adaptive A* vs A*)

300 alternating pairs per map, GC disabled, `time.perf_counter`; ratio = t(Adaptive A*) / t(A*) per pair; 95% CI by bootstrap (2000 resamples).

| Map | A* median (ms) | Adaptive A* median (ms) | Median ratio [95% CI] | Time reduction ours | Time reduction paper | Node ratio |
|---|---|---|---|---|---|---|
| 30x30 | 0.524 | 0.419 | 0.805 [0.785, 0.818] | 19.5% | 75.0% | 0.508 |
| 60x60 | 2.860 | 2.043 | 0.719 [0.716, 0.723] | 28.1% | 66.7% | 0.517 |
| 100x100 | 9.742 | 2.686 | 0.276 [0.274, 0.278] | 72.4% | 64.3% | 0.205 |

Mean time reduction over the three maps: ours 40.0% vs paper 68.7%.
