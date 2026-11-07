# %% [markdown]
# # 03 — Translation metrics (Translation Tangles reproduction)
#
# Scores every model output with the paper's metrics (Sec. 4.4, App. F):
# BLEU, chrF, TER (sacrebleu, corpus level), WER, CER (jiwer, corpus level),
# ROUGE-1/2/L (rouge-score, mean F1), BERTScore (F1, baseline-rescaled) and COMET (wmt22-comet-da).
#
# Refusals ("I'm sorry, I can't…") and empty outputs are **excluded** before scoring, as the
# paper does (Sec. 6.4); how many were dropped is kept in the table.
#
# **Kaggle settings:** GPU T4 x2 (BERTScore and COMET need it), Internet On.
# **Inputs:** attach every `outputs-<model>` dataset you made from `02_generate`
# (or upload the `outputs_<model>.zip` files as one dataset — Kaggle unzips them).
# Attach an earlier `metrics.csv` too and only new directions are scored.
#
# Output: `/kaggle/working/metrics.csv` — upload it back to the chat.

# %%
RUN_NEURAL = True    # False = only the fast metrics (no GPU needed)
COMET_MODEL = "Unbabel/wmt22-comet-da"

# %%
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "sacrebleu", "jiwer", "rouge-score",
                "bert-score"] + (["unbabel-comet"] if RUN_NEURAL else []), check=False)

# %%
import glob, json, re
from collections import defaultdict
from pathlib import Path
import pandas as pd
import sacrebleu, jiwer
from rouge_score import rouge_scorer

# One file per (model, suite, direction); later copies of the same file win
files = {}
for p in sorted(glob.glob("/kaggle/input/**/outputs/*/*/*.jsonl", recursive=True)
                + glob.glob("/kaggle/working/outputs/*/*/*.jsonl")):
    model, suite, name = Path(p).parts[-3:]
    files[(model, suite, name[:-6])] = p
print(len(files), "output files from", len({k[0] for k in files}), "models:", sorted({k[0] for k in files}))

done = set()
prev = glob.glob("/kaggle/input/**/metrics.csv", recursive=True)
old = pd.read_csv(prev[0]) if prev else pd.DataFrame()
if len(old):
    done = set(zip(old.model, old.suite, old.direction))
    print("Already scored:", len(done))
todo = {k: v for k, v in files.items() if k not in done}
print("To score:", len(todo))

# %% [markdown]
# ## Refusal filter
#
# A row is dropped when the output is empty or opens with a refusal / safety disclaimer
# instead of a translation (the paper's App. E example is "I'm sorry, I can't provide a direct
# translation…"). Only the start of the output is checked, so a translation that merely
# contains "sorry" is kept.

# %%
CANT = r"(can(no|')t|cannot|am unable to|'m unable to|won'?t|am not able to|'m not able to|must decline to)"
TASK = r"(provide|translate|help|assist|fulfil|comply|complete|create|generate|do that|process|produce)"
REFUSAL = [
    re.compile(rf"^\W*(i'?m|i am) sorry\b.{{0,80}}\b(i )?{CANT}", re.I | re.S),     # "I'm sorry, but I can't ..."
    re.compile(rf"^\W*sorry,? (but )?i {CANT}", re.I),
    re.compile(rf"^\W*i {CANT} {TASK}\b", re.I),                                  # "I cannot translate ..."
    re.compile(r"^\W*(as an ai\b|i apologi[sz]e,? but)", re.I),
]

def is_refusal(text):
    head = text.strip()[:200]
    return not head or any(p.match(head) for p in REFUSAL)

# %% [markdown]
# ## Fast metrics
#
# BLEU uses sacrebleu's `zh` tokenizer for Chinese targets and `13a` otherwise.
# ROUGE uses rouge-score's default tokenizer, which keeps only Latin letters and digits, so
# targets in other scripts score near 0 — the paper's tables show exactly this (e.g. en→kk
# ROUGE ≈ 0.01, Figs. 13–18), so it is kept for comparability.

# %%
rouge = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=False)

def fast_metrics(hyps, refs, tgt):
    tok = "zh" if tgt == "zh" else "13a"
    r = [rouge.score(ref, hyp) for hyp, ref in zip(hyps, refs)]
    return {
        "bleu": sacrebleu.corpus_bleu(hyps, [refs], tokenize=tok).score,
        "chrf": sacrebleu.corpus_chrf(hyps, [refs]).score,
        "ter": sacrebleu.corpus_ter(hyps, [refs]).score,
        "wer": jiwer.wer(refs, hyps),
        "cer": jiwer.cer(refs, hyps),
        "rouge1": sum(x["rouge1"].fmeasure for x in r) / len(r),
        "rouge2": sum(x["rouge2"].fmeasure for x in r) / len(r),
        "rougeL": sum(x["rougeL"].fmeasure for x in r) / len(r),
    }

rows, kept = [], {}
for (model, suite, direction), path in sorted(todo.items()):
    data = [json.loads(l) for l in open(path, encoding="utf-8")]
    use = [d for d in data if not is_refusal(d["output"])]
    src, tgt = direction.split("-")
    row = {"model": model, "suite": suite, "direction": direction, "src": src, "tgt": tgt,
           "n_total": len(data), "n_refused": len(data) - len(use),
           "n_truncated_input": sum(d.get("truncated", False) for d in data),
           "n_hit_max_tokens": sum(d.get("finish_reason") == "length" for d in data),
           "backend": data[0].get("backend") if data else None}
    if use:
        row.update(fast_metrics([d["output"] for d in use], [d["reference"] for d in use], tgt))
    rows.append(row)
    kept[(model, suite, direction)] = use
    print(f"{model:24s} {suite:10s} {direction}: BLEU {row.get('bleu', float('nan')):6.2f}  "
          f"refused {row['n_refused']}")
df = pd.DataFrame(rows)

# %% [markdown]
# ## BERTScore and COMET (GPU)
#
# BERTScore F1 with `rescale_with_baseline=True` — the paper's BERTScore values go negative
# (Fig. 10), which only happens with rescaling. Default models: roberta-large for English
# targets, multilingual BERT otherwise. If a language has no baseline file, the raw F1 is used
# and `bertscore_rescaled` is False for that row.

# %%
if RUN_NEURAL and len(df):
    import torch
    from bert_score import BERTScorer
    df["bertscore"], df["bertscore_rescaled"], df["comet"] = float("nan"), False, float("nan")
    by_tgt = defaultdict(list)
    for i, r in df.iterrows():
        if kept[(r.model, r.suite, r.direction)]:
            by_tgt[r.tgt].append(i)
    for tgt, idx in sorted(by_tgt.items()):
        try:
            scorer, rescaled = BERTScorer(lang=tgt, rescale_with_baseline=True), True
        except Exception as e:
            print(f"[{tgt}] no rescale baseline ({type(e).__name__}); using raw F1")
            scorer, rescaled = BERTScorer(lang=tgt), False
        for i in idx:
            r = df.loc[i]
            use = kept[(r.model, r.suite, r.direction)]
            _, _, f1 = scorer.score([d["output"] for d in use], [d["reference"] for d in use], batch_size=64)
            df.at[i, "bertscore"], df.at[i, "bertscore_rescaled"] = f1.mean().item(), rescaled
        print(f"BERTScore done for target {tgt} ({len(idx)} directions)")
        del scorer
        torch.cuda.empty_cache()

    try:
        from comet import download_model, load_from_checkpoint
        comet = load_from_checkpoint(download_model(COMET_MODEL))
        for i, r in df.iterrows():
            use = kept[(r.model, r.suite, r.direction)]
            if not use:
                continue
            out = comet.predict([{"src": d["source"], "mt": d["output"], "ref": d["reference"]} for d in use],
                                batch_size=64, gpus=1, progress_bar=False)
            df.at[i, "comet"] = out.system_score
        print("COMET done")
    except Exception as e:
        print("COMET failed:", repr(e)[:800])

# %% [markdown]
# ## Save

# %%
out = pd.concat([old, df], ignore_index=True) if len(old) else df
out.to_csv("/kaggle/working/metrics.csv", index=False)
print(out.groupby(["model", "suite"]).size().rename("directions"))
show = [c for c in ["model", "suite", "direction", "bleu", "chrf", "bertscore", "comet", "n_refused"] if c in out]
print(out[show].round(3).to_string(max_rows=60))
