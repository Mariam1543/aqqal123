# Agreement gate around the Adjudicator (A1)

200 questions with scored sampled answers (k = 8).
All k sampled answers agree on 48.0% of the questions.
B1 (Adjudicator) and B2 (majority) give a different score on 4.5% of the questions (the gate can only change the result on these).
All k answers agree but are wrong on 10.5% of the questions (the gate skips the Adjudicator there; it fixed 0 of them).

| Method | Accuracy | Over-correction | Fix rate | Adjudicator rate | Tokens / question | Saved vs B1 |
|---|---|---|---|---|---|---|
| B1: always Adjudicator (DocLens) | 56.3 | 1.5 | 3.0 | 100.0 | 87,620 | 0.0% |
| B2: majority vote | 54.8 | 0.0 | 0.0 | 0.0 | 84,977 | 3.0% |
| **A1: agreement gate** (tau by 5-fold CV over documents) | 54.8 | 1.5 | 1.5 | 30.0 | 85,940 | 1.9% |
| Oracle gate (upper bound) | 57.8 | | | | | |

Over-correction: the majority answer was right, the returned answer is wrong. Fix rate: the majority answer was wrong, the returned answer is right.

A1 vs B1 (paired bootstrap, 10,000 resamples): accuracy -1.5 points (95% CI -3.4 to +0.0; p(A1 not better) = 1.000).
A1 vs B2 (paired bootstrap, 10,000 resamples): accuracy +0.0 points (95% CI -2.5 to +2.5; p(A1 not better) = 0.583).

tau chosen in the 5 folds: 0.875, 0.750, 0.875, 0.375, 0.875

## Every threshold

| tau (run the Adjudicator if agreement < tau) | Accuracy | Over-correction | Fix rate | Adjudicator rate | Saved vs B1 |
|---|---|---|---|---|---|
| 0 (= B2) | 54.8 | 0.0 | 0.0 | 0.0 | 3.0% |
| 0.125 | 54.8 | 0.0 | 0.0 | 0.0 | 3.0% |
| 0.250 | 54.8 | 0.0 | 0.0 | 0.5 | 3.0% |
| 0.375 | 55.3 | 0.0 | 0.5 | 5.5 | 2.7% |
| 0.500 | 55.3 | 0.5 | 1.0 | 14.0 | 2.4% |
| 0.625 | 55.3 | 1.0 | 1.5 | 24.5 | 2.0% |
| 0.750 | 55.8 | 1.5 | 2.5 | 31.5 | 1.7% |
| 0.875 | 56.3 | 1.5 | 3.0 | 42.0 | 1.4% |
| 1.000 | 56.3 | 1.5 | 3.0 | 52.0 | 1.1% |
| >1 (= B1) | 56.3 | 1.5 | 3.0 | 100.0 | 0.0% |
