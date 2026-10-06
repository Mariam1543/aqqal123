# DocLens + Confidence-gated Abstention (CDC)

An extension of [DocLens](https://github.com/dwzhu-pku/DocLens) (Zhu et al., ACL 2026) that adds a
**Confidence and Degradation Check** stage between the Lens Module and the Reasoning Module.
Cases with reliable evidence **abstain** from correction and keep their original evidence. Cases with
unreliable evidence are **routed** to a degradation-aware Reasoning Module that corrects them.

```
                 ┌──────────── Lens Module (DocLens) ───────────┐
question + doc → │ Page Navigator (k samples) → Element Localizer│
                 └───────────────────────┬──────────────────────┘
                                         ▼
               ┌──────── Confidence & Degradation Check (new) ────────┐
               │ per page: image reliability (blur, noise, JPEG,      │
               │           contrast) · OCR-text reliability ·         │
               │           crop reliability → q_page, degradation type│
               │ per case: c = w_e·E(evidence) + w_s·S(Lens agreement)│
               │           (+ w_v·V optional LLM verbal confidence)   │
               └──────────────┬──────────────────────┬────────────────┘
                   c ≥ τ_case │                      │ c < τ_case
                              ▼                      ▼
                ABSTAIN: original evidence,   CORRECT: restore pages with q_page < τ_evidence,
                one answer, no correction     flag their OCR text, Answer Sampler (k) +
                or verification               Adjudicator with degradation-aware prompts
```

No DocLens file is modified. The extension imports DocLens' agents, prompts, Gemini wrapper and
evaluation code, and subclasses its `DocLensProcessor`.

## Step 1: reproduce DocLens (`kaggle/doclens_reproduce_kaggle.ipynb`)

Before adding anything, this notebook reproduces the paper's main results with the **unmodified** DocLens code:

- the full benchmark (every MMLongBench-Doc question, or FinRAGBench-V);
- DocLens end-to-end (`--mode doclens`) and the vanilla baseline (`--mode baseline`, DocLens' `--phase_name baseline`);
- the paper's metrics, via `scripts/report_reproduction.py`. This is a port of MMLongBench-Doc's official `eval_acc_and_f1`/`show_results`: Acc, F1, TXT/LAY/CHA/TAB/IMG and SIN/MUL/UNA. It prints the difference to the numbers you copy from the paper.

To match the paper, three things must hold:

1. **Same models.** Gemini 2.5 Pro answers, 2.5 Flash-Lite navigates and 2.5 Flash scores. New Gemini API keys can no longer call these, so the notebook supports **Vertex AI** (DocLens' original setup) through a `GCP_SA_KEY` service-account secret. Section 3 tests each model and states whether the run counts as a reproduction or as a re-run with substitute models.
2. **Same settings.** Set the number of candidates (`PHASE1_K`, `PHASE2_K`) from the paper's implementation details, because the repository's scripts disagree with each other. Temperature 0.7 and 200 DPI are DocLens defaults.
3. **Tolerance.** Sampling at temperature 0.7 means a faithful reproduction lands within about 1–2 points of the paper, not on its exact digits.

The parsed benchmark under `full/clean` is then reused for the novelty experiments (step 2 below).

## Step 2: the novelty (`kaggle/doclens_cdc_kaggle.ipynb`)

## What is in this folder

| Path | Purpose |
|---|---|
| `cdc/quality.py` | No-reference reliability features: Crété-Roffet blur, Immerkær/MAD noise, JPEG blockiness, contrast. Also lexicon-free OCR-garbage features, MinerU span confidences, and an optional softmax degradation classifier |
| `cdc/confidence.py` | Page scoring, Lens self-consistency, case confidence, the gate, and the reliability notes |
| `cdc/restoration.py` | Correction filters for each degradation type (applied only to flagged evidence) |
| `cdc/evidence.py` | Loads localized evidence and renders it in DocLens' exact content format |
| `cdc/processor.py` | `CDCDocLensProcessor`: the `doclens`, `cdc` and `analyze` modes, scoring, and resumable JSONL checkpoints |
| `cdc/llm_setup.py` | Uses a Gemini API key instead of Vertex AI, adds a requests-per-minute limiter, and overrides the eval model |
| `cdc/degradation.py` | Synthetic degradations (blur, noise, jpeg, lowres, fade, mixed × severity 1–3) |
| `run_cdc.py` | Entry point (the equivalent of DocLens' `main.py`) |
| `scripts/` | Data download, subset selection, degraded variants, MinerU parsing, calibration, analysis |
| `kaggle/doclens_reproduce_kaggle.ipynb` | Step 1: full reproduction of DocLens (baseline + DocLens, paper metrics) |
| `kaggle/doclens_cdc_kaggle.ipynb` | Step 2: the confidence-gated abstention experiments |
| `scripts/report_reproduction.py` | MMLongBench-Doc Acc/F1 and breakdowns, compared with the paper |
| `tests/` | Offline tests (no API, no GPU). They run against the real DocLens code with a fake LLM |

## Run it on Kaggle

1. Create a notebook and choose **File → Import Notebook** → `kaggle/doclens_cdc_kaggle.ipynb`.
2. Under **Settings**, set the accelerator to **GPU T4 x2** and turn **Internet** on.
3. Under **Add-ons → Secrets**, add `GEMINI_API_KEY` (a Google AI Studio key). Add `GITHUB_TOKEN` too if this repository is private.
4. Edit the settings cell (subset size, variants, models), then use **Run All**.

The notebook goes through these steps: clone, install MinerU, download MMLongBench-Doc, pick a subset of
short documents, render the pages at 200 DPI, create degraded variants, run MinerU on every variant, and
optionally calibrate. It then runs a smoke test, the main `analyze` experiment and the report. All
outputs go to `/kaggle/working/results`. Every long step can be resumed: re-run the same cell after an
interruption.

The same steps from a shell:

```bash
python scripts/download_data.py --dataset MMLongBenchDoc --out DocLens/data
python scripts/prepare_subset.py --samples DocLens/data/MMLongBenchDoc/samples.json \
    --documents DocLens/data/MMLongBenchDoc/documents --out_root variants --max_docs 8 --max_pages 30
python scripts/make_variants.py --out_root variants --variants blur_s2 noise_s2 jpeg_s3 lowres_s2 mixed_s2
for v in clean blur_s2 noise_s2 jpeg_s3 lowres_s2 mixed_s2; do
  python scripts/parse_mineru.py --root variants/$v
  python run_cdc.py --doclens_root DocLens --data_root variants/$v --variant $v \
      --samples variants/samples_subset.json --mode analyze --rpm 10 --output results/${v}_analyze.jsonl
done
python scripts/analyze_results.py results/*_analyze.jsonl --out_dir results/report
```

## Modes

| `--mode` | What runs | Use |
|---|---|---|
| `baseline` | DocLens' vanilla baseline: the model reads every page once | Paper's "without DocLens" row |
| `doclens` | Unmodified DocLens end-to-end: Lens → Sampler (k) → Adjudicator | Reproduction and the main baseline for CDC |
| `cdc` | Lens → CDC → only the path the gate picks | Deployment numbers and real cost |
| `analyze` | Lens → CDC → **all** paths (abstain, correct, DocLens) on the same Lens output | Threshold sweeps, over-refinement, oracle and ablations |

## Metrics produced by `scripts/analyze_results.py`

- **Accuracy**, using DocLens' own MMLongBench-Doc protocol: LLM answer extraction followed by rule-based scoring.
- **Over-refinement rate**: the answer before verification was correct, but the final answer is wrong.
  - For DocLens: the first sampled candidate is correct and the adjudicated answer is wrong.
  - For CDC: the abstain-path answer is correct, but the gate routed the case to correction and the correction made it wrong.
- **Under-correction rate**: the gate abstained, the abstain answer is wrong, and correction would have fixed it.
- **Abstention rate** and **tokens per question**.
- **AUROC** of the CDC confidence for predicting that the abstain answer is correct, which measures how well the gate's confidence predicts correctness.
- **Ablations**: an evidence-only gate, a consistency-only gate, and the combined gate. You can also add the LLM verbal confidence (`--use_confidence_judge --w_verbal 0.2`), switch the abstain policy (`--abstain_policy lens_answer`), or replace pages with their restored copies instead of adding them (`--replace_restored`).
- τ is selected on a dev split (`--dev_frac 0.3`) and reported on the held-out questions.

## Key settings

| Flag | Default | Meaning |
|---|---|---|
| `--tau_case` | 0.70 | Case confidence at or above this abstains |
| `--tau_evidence` | 0.50 | A page whose reliability is below this gets corrected |
| `--w_evidence / --w_consistency` | 0.7 / 0.3 | Weights of the case-confidence signals |
| `--abstain_policy` | `single_pass` | `single_pass`: one Answer-Sampler call on the original evidence (temperature 0). `lens_answer`: keep the Page Navigator's majority answer (no extra call) |
| `--calibration` | – | `calibration.json` from `scripts/calibrate_cdc.py` (fitted thresholds, optional classifier) |
| `--phase{1,2}_candidate_num` | 2 / 2 | As in DocLens' `run_doclens_end2end.sh` |

## Notes and limitations

- **Validation so far is offline only.** The quality features were checked on synthetic 200-DPI pages: clean pages are never flagged, every severity ≥ 2 degradation is flagged, and its type is recovered. The pipeline logic was tested against the real DocLens code with a fake LLM, so no accuracy numbers exist yet. They will come from your Kaggle run.
- **Calibrate before you trust the default thresholds.** They were set on synthetic text pages. Real slide decks with photos have different clean statistics. `calibrate_cdc.py` refits the thresholds on your pages and prints detection rates.
- **Only Gemini models are supported.** DocLens' Claude path has bugs upstream: `PageNavigator.process` and `call_claude_with_retry_async` do not return the `(texts, tokens)` pair the rest of the code expects.
- **MinerU must be version 2.x.** MinerU 3 and 4 replaced the command-line interface DocLens uses, so the notebook pins `mineru[core]==2.7.6`. `parse_mineru.py` passes `-b pipeline -t False`, which turns table recognition off as DocLens does.
- **Check the dataset layout.** DocLens' README points to `dwzhu/DocLensDatasets` on Hugging Face. The notebook asserts that `data/MMLongBenchDoc/samples.json` exists and lists the JSON files it found otherwise.
- **Budget for cost.** The Page Navigator reads every page (screenshot + OCR) of a document. In `analyze` mode each question takes about 13 Gemini calls: 6 for the pipeline (Lens, abstain, correction sampler and adjudicator, DocLens sampler and adjudicator) and 7 for scoring. With 60 questions that is about 800 calls per variant. Use a billing-enabled key, or start with `--limit`.

## Related work this design builds on

- **PreP-OCR**: degradation is real and restorable, but in a static pipeline. Here restoration is gated.
- **IEEE Access**: degradation can be detected and classified. Here that is done by the no-reference features and the optional classifier.
- **EMNLP 2025**: confidence calibration reduces hallucination. Here that role is played by the gate and the optional verbal confidence.
- **Applied Sciences**: LLM correction can damage clean text. Here, correction prompts are applied only to flagged evidence.
- **ORCA**: 12% of its failures come from over-refinement. That is measured directly by the over-refinement rate above.

## Tests

```bash
pip install pytest -r requirements-kaggle.txt
git clone https://github.com/dwzhu-pku/DocLens /tmp/DocLens
DOCLENS_ROOT=/tmp/DocLens pytest tests -q
```
