# %% [markdown]
# # 02 — Generate translations (Translation Tangles reproduction)
#
# Runs **one model** over its suites and saves one JSONL file per direction.
# Change `MODEL` in the next cell and run again for the next model.
#
# Prompt and settings follow App. A.1: the paper's prompt verbatim, temperature 0.1,
# input truncated to `context − 500` tokens. Instruct models get the prompt as a single
# user turn through their chat template; base models (OLMo-1B) get it as raw text.
#
# **Kaggle settings:** Accelerator **GPU T4 x2**, Internet On, secret `HF_TOKEN`,
# and the **`tt-data`** dataset attached (Add Input → Your Datasets).
#
# **First run with `SMOKE = True`** (5 sentences × 2 directions, ~10 min incl. install) to check the
# model loads and the outputs look like translations. Then set `SMOKE = False` and use
# **Save Version → Save & Run All** so it runs in the background.
#
# Output: `/kaggle/working/outputs/<model>/<suite>/<src>-<tgt>.jsonl` and `outputs_<model>.zip`.

# %%
MODEL = "qwen2.5-0.5b"   # a key of REGISTRY below
SMOKE = True             # True: 5 sentences x 2 directions, printed, not saved as results
BACKEND = "auto"         # "vllm", "hf" (transformers), or "auto" (try vLLM, fall back to hf)
SUITES = None            # None = the suites the paper ran this model on; or e.g. ["general"]

# %% [markdown]
# ## Model registry
#
# `size` follows Sec. 5.1 (small ≤ 7B, medium 7–30B, large > 30B, by total parameters).
# `suites` follows the paper: 13 models on the general benchmark (Figs. 7–16) and
# 8 on the domain benchmark (Figs. 17–25).
# Large models load pre-quantized 4-bit (AWQ) weights so they fit on 2× T4 (29 GB).
# Models under "needs a bigger GPU" do not fit on Kaggle even at 4-bit.

# %%
GEN = ["general"]
DOM = ["literature", "medical", "law"]
REGISTRY = {
    # small (<= 7B)
    "qwen2.5-0.5b": dict(hf="Qwen/Qwen2.5-0.5B-Instruct", size="small", suites=GEN),
    "qwen2.5-1.5b": dict(hf="Qwen/Qwen2.5-1.5B-Instruct", size="small", suites=GEN),
    "qwen2.5-3b": dict(hf="Qwen/Qwen2.5-3B-Instruct", size="small", suites=GEN),
    "llama-3.2-1b": dict(hf="meta-llama/Llama-3.2-1B-Instruct", size="small", suites=GEN),
    "olmo-1b": dict(hf="allenai/OLMo-1B-hf", size="small", suites=GEN, base=True),
    "phi-3.5-mini": dict(hf="microsoft/Phi-3.5-mini-instruct", size="small", suites=GEN),
    # medium (7-30B)
    "gemma-7b": dict(hf="google/gemma-7b-it", size="medium", suites=GEN),
    "gemma2-9b": dict(hf="google/gemma-2-9b-it", size="medium", suites=GEN),
    "llama3-8b": dict(hf="meta-llama/Meta-Llama-3-8B-Instruct", size="medium", suites=GEN),
    "llama-3.1-8b": dict(hf="meta-llama/Llama-3.1-8B-Instruct", size="medium", suites=GEN + DOM),
    # large (> 30B), 4-bit on Kaggle
    "mixtral-8x7b": dict(hf="mistralai/Mixtral-8x7B-Instruct-v0.1", size="large", suites=GEN + DOM,
                         awq="TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ"),
    "qwen-2.5-32b": dict(hf="Qwen/Qwen2.5-32B-Instruct", size="large", suites=DOM,
                         awq="Qwen/Qwen2.5-32B-Instruct-AWQ"),
    "deepseek-r1-distill-32b": dict(hf="deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", size="large", suites=DOM,
                                    awq="casperhansen/deepseek-r1-distill-qwen-32b-awq", reasoning=True),
    # needs a bigger GPU (>= 48 GB at 4-bit)
    "llama3-70b": dict(hf="meta-llama/Meta-Llama-3-70B-Instruct", size="large", suites=GEN, big=True),
    "llama-3.1-70b": dict(hf="meta-llama/Llama-3.1-70B-Instruct", size="large", suites=GEN, big=True),
    "llama-3.2-90b-vision": dict(hf="meta-llama/Llama-3.2-90B-Vision-Instruct", size="large",
                                 suites=GEN + DOM, big=True),
    "llama-3.3-70b": dict(hf="meta-llama/Llama-3.3-70B-Instruct", size="large", suites=DOM, big=True),
    "deepseek-r1-distill-70b": dict(hf="deepseek-ai/DeepSeek-R1-Distill-Llama-70B", size="large",
                                    suites=DOM, big=True, reasoning=True),
}
cfg = REGISTRY[MODEL]
suites = SUITES or cfg["suites"]
REASONING = cfg.get("reasoning", False)
BASE = cfg.get("base", False)
MAX_MODEL_LEN = 6144 if REASONING else 4096
MAX_NEW = 2048 if REASONING else (256 if BASE else 400)
INPUT_LIMIT = MAX_MODEL_LEN - max(500, MAX_NEW + 100)   # App. A.1: reserve room for prompt + response
TEMPERATURE, SEED, HF_BATCH = 0.1, 42, 16
print(MODEL, cfg, "| suites:", suites)
if cfg.get("big"):
    print("WARNING: this model does not fit on Kaggle 2x T4; run it on a >= 48 GB GPU.")

# %% [markdown]
# ## Data and secrets

# %%
import glob, json, os, time, shutil, re
from pathlib import Path
from kaggle_secrets import UserSecretsClient

os.environ["HF_TOKEN"] = UserSecretsClient().get_secret("HF_TOKEN")
manifests = glob.glob("/kaggle/input/**/manifest.json", recursive=True)
assert manifests, "Attach the tt-data dataset (Add Input -> Your Datasets -> tt-data)"
DATA = Path(manifests[0]).parent
directions = sorted(p for s in suites for p in (DATA / s).glob("*.jsonl"))
print(f"Data: {DATA}  |  {len(directions)} directions")
if SMOKE:
    directions = directions[:2]

OUT = Path("/kaggle/working") / ("smoke" if SMOKE else "outputs") / MODEL
OUT.mkdir(parents=True, exist_ok=True)

# Resume: copy finished files from an attached earlier output of this model, if any
for prev in glob.glob(f"/kaggle/input/**/outputs/{MODEL}", recursive=True):
    if not SMOKE:
        shutil.copytree(prev, OUT, dirs_exist_ok=True)
        print("Resumed from", prev)

# %% [markdown]
# ## Load the model
#
# vLLM is much faster; it is installed fresh (~5 min). If it fails on the T4s, the notebook
# falls back to plain transformers. Which backend ran is saved with every output.

# %%
import subprocess, sys
backend = BACKEND
if backend in ("auto", "vllm"):
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "vllm"], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        if backend == "vllm":
            raise RuntimeError("vLLM install failed")
        backend = "hf"

import torch
from transformers import AutoTokenizer
torch.manual_seed(SEED)
n_gpu = torch.cuda.device_count()
weights = cfg.get("awq") or cfg["hf"]
tok = AutoTokenizer.from_pretrained(cfg["hf"], trust_remote_code=True)
USE_CHAT = (not BASE) and bool(tok.chat_template)
print("GPUs:", n_gpu, "| weights:", weights, "| chat template:", USE_CHAT)

llm = model = None
if backend in ("auto", "vllm"):
    try:
        from vllm import LLM, SamplingParams
        small = cfg["size"] == "small"
        llm = LLM(model=weights, tokenizer=cfg["hf"], dtype="float16",
                  tensor_parallel_size=1 if small else min(2, n_gpu),
                  quantization="awq" if cfg.get("awq") else None,
                  max_model_len=MAX_MODEL_LEN, gpu_memory_utilization=0.90,
                  seed=SEED, trust_remote_code=True)
        backend = "vllm"
    except Exception as e:
        print("vLLM could not load the model:", repr(e)[:1500])
        if backend == "vllm":
            raise
        backend = "hf"

if backend == "hf":
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig
    quant = None
    if cfg["size"] == "large":
        quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                   bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForCausalLM.from_pretrained(cfg["hf"], torch_dtype=torch.float16, device_map="auto",
                                                 quantization_config=quant, trust_remote_code=True)
    model.eval()
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
print("Backend:", backend)

# %% [markdown]
# ## Prompt, generation, cleaning

# %%
PROMPT = "Translate the following {src} text to {tgt}:\n{text}\nTranslation:"   # App. A.1, verbatim

def encode(row):
    """Token ids for one row, with the source truncated to INPUT_LIMIT tokens."""
    ids = tok(row["source"], add_special_tokens=False)["input_ids"]
    truncated = len(ids) > INPUT_LIMIT
    text = tok.decode(ids[:INPUT_LIMIT]) if truncated else row["source"]
    prompt = PROMPT.format(src=row["src_name"], tgt=row["tgt_name"], text=text)
    if USE_CHAT:
        prompt = tok.apply_chat_template([{"role": "user", "content": prompt}],
                                         tokenize=False, add_generation_prompt=True)
    # the chat template already contains BOS; add it only for raw prompts
    return tok(prompt, add_special_tokens=not USE_CHAT)["input_ids"], truncated

def clean(text):
    """Minimal post-processing: drop reasoning blocks and a leading 'Translation:' echo.
    Everything else (notes, refusals) is kept, as in the paper's outputs (App. E)."""
    if REASONING:
        text = text.split("</think>", 1)[1] if "</think>" in text else ("" if "<think>" in text else text)
    text = text.strip()
    if text.lower().startswith("translation:"):
        text = text[len("translation:"):].strip()
    if BASE:   # a base model keeps writing after the translation; keep its first line
        text = next((l.strip() for l in text.splitlines() if l.strip()), "")
    return text

def generate(id_lists):
    """Returns (raw_text, finish_reason) per prompt, in input order."""
    if backend == "vllm":
        sp = SamplingParams(temperature=TEMPERATURE, max_tokens=MAX_NEW, seed=SEED,
                            stop=["\n\n"] if BASE else None)
        outs = llm.generate([{"prompt_token_ids": ids} for ids in id_lists], sp, use_tqdm=False)
        return [(o.outputs[0].text, o.outputs[0].finish_reason) for o in outs]
    results = [None] * len(id_lists)
    order = sorted(range(len(id_lists)), key=lambda i: len(id_lists[i]))   # batch similar lengths
    for start in range(0, len(order), HF_BATCH):
        idx = order[start:start + HF_BATCH]
        enc = tok.pad({"input_ids": [id_lists[i] for i in idx]}, return_tensors="pt").to(model.device)
        with torch.no_grad():
            gen = model.generate(**enc, do_sample=True, temperature=TEMPERATURE,
                                 max_new_tokens=MAX_NEW, pad_token_id=tok.pad_token_id)
        for j, i in enumerate(idx):
            new = gen[j, enc["input_ids"].shape[1]:]
            n = int((new != tok.pad_token_id).sum())
            results[i] = (tok.decode(new, skip_special_tokens=True), "length" if n >= MAX_NEW else "stop")
    return results

# %% [markdown]
# ## Run

# %%
t_all = time.time()
for path in directions:
    suite = path.parent.name
    dest = OUT / suite / path.name
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    if SMOKE:
        rows = rows[:5]
    if dest.exists() and sum(1 for _ in open(dest)) == len(rows):
        print(f"skip {suite}/{path.stem} (done)")
        continue
    t0 = time.time()
    enc = [encode(r) for r in rows]
    outs = generate([ids for ids, _ in enc])
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        for r, (ids, trunc), (raw, finish) in zip(rows, enc, outs):
            f.write(json.dumps({**r, "model": MODEL, "hf_id": weights, "backend": backend,
                                "output": clean(raw), "raw_output": raw, "finish_reason": finish,
                                "n_prompt_tokens": len(ids), "truncated": trunc}, ensure_ascii=False) + "\n")
    dt = time.time() - t0
    print(f"{suite}/{path.stem}: {len(rows)} rows in {dt:.0f}s "
          f"({sum(o[1] == 'length' for o in outs)} hit max tokens)")
    if SMOKE:
        for r, (raw, _) in zip(rows[:3], outs[:3]):
            print(f"  SRC: {r['source'][:150]}\n  REF: {r['reference'][:150]}\n  OUT: {clean(raw)[:150]}\n")
print(f"Total: {(time.time() - t_all) / 60:.1f} min, backend {backend}")

# %%
if not SMOKE:
    shutil.make_archive(f"/kaggle/working/outputs_{MODEL}", "zip", OUT.parent, MODEL)
    print(f"Saved /kaggle/working/outputs_{MODEL}.zip")
