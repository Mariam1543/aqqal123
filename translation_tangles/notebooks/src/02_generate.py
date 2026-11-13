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
PROMPT_MODE = None       # None = the model's default below; "chat" or "raw" to override (saved under <model>@<mode>)
MAX_NEW_TOKENS = None    # None = default (400, or 2048 for reasoning models); a number to override
IGNORE_EOS = False       # True = keep generating past the end-of-text token up to MAX_NEW_TOKENS
# A non-default MAX_NEW_TOKENS or IGNORE_EOS is added to the run name, e.g. olmo2-1b@noeos256

# %% [markdown]
# ## Model registry
#
# `size` follows Sec. 5.1 (small ≤ 7B, medium 7–30B, large > 30B, by total parameters).
# `suites` follows the paper: 13 models on the general benchmark (Figs. 7–16) and
# 8 on the domain benchmark (Figs. 17–25).
# Large models load pre-quantized 4-bit (AWQ) weights so they fit on 2× T4 (29 GB).
#
# `prompt` is how the prompt reaches the model:
# - **chat**: one user turn through the model's chat template — how the Groq-hosted models in the
#   paper were called.
# - **raw**: the prompt as plain text with no chat template, and the whole continuation kept.
#   The paper's locally run small models (OLMo, Phi-3.5-mini, Qwen) have TER 365–990 and WER 3.7–7.8
#   on de-en (Figs. 9, 11), i.e. outputs several times longer than the reference, which is what this
#   produces. Their BLEU is also far below what these models reach with a chat template.
#
# Llama-3.2-1B is named in Sec. 4.3 but appears in none of the result tables, so it is not run.
# Models under "needs a bigger GPU" do not fit on Kaggle even at 4-bit.

# %%
GEN = ["general"]
DOM = ["literature", "medical", "law"]
REGISTRY = {
    # small (<= 7B)
    "qwen2.5-0.5b": dict(hf="Qwen/Qwen2.5-0.5B-Instruct", size="small", suites=GEN, prompt="raw"),
    "qwen2.5-1.5b": dict(hf="Qwen/Qwen2.5-1.5B-Instruct", size="small", suites=GEN, prompt="raw"),
    "qwen2.5-3b": dict(hf="Qwen/Qwen2.5-3B-Instruct", size="small", suites=GEN, prompt="raw"),
    "olmo-1b": dict(hf="allenai/OLMo-1B-hf", size="small", suites=GEN, prompt="raw"),
    # The paper cites the 2025 OLMo report; its 1B model may be OLMo-2 1B Instruct rather than the
    # 2024 base model. Run this too: the 2024 base model scores far below the paper (see SPEC §15).
    "olmo2-1b": dict(hf="allenai/OLMo-2-0425-1B-Instruct", size="small", suites=GEN, prompt="raw"),
    "phi-3.5-mini": dict(hf="microsoft/Phi-3.5-mini-instruct", size="small", suites=GEN, prompt="raw"),
    "llama-3.2-1b": dict(hf="meta-llama/Llama-3.2-1B-Instruct", size="small", suites=GEN),   # not in the tables
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
MODE = PROMPT_MODE or cfg.get("prompt", "chat")
RAW = MODE == "raw"
RUN_NAME = MODEL if MODE == cfg.get("prompt", "chat") else f"{MODEL}@{MODE}"
MAX_MODEL_LEN = 6144 if REASONING else 4096
MAX_NEW = MAX_NEW_TOKENS or (2048 if REASONING else 400)
if IGNORE_EOS or MAX_NEW_TOKENS:
    RUN_NAME += "@" + ("noeos" if IGNORE_EOS else "max") + str(MAX_NEW)
INPUT_LIMIT = MAX_MODEL_LEN - max(500, MAX_NEW + 100)   # App. A.1: reserve room for prompt + response
TEMPERATURE, SEED, HF_BATCH = 0.1, 42, 16
print(RUN_NAME, cfg, "| prompt mode:", MODE, "| suites:", suites)
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

OUT = Path("/kaggle/working") / ("smoke" if SMOKE else "outputs") / RUN_NAME
OUT.mkdir(parents=True, exist_ok=True)

# Resume: copy finished files from an attached earlier output of this model, if any
for prev in glob.glob(f"/kaggle/input/**/outputs/{RUN_NAME}", recursive=True):
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
USE_CHAT = (not RAW) and bool(tok.chat_template)
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
    Everything else (notes, refusals, and in raw mode the whole continuation) is kept,
    as in the paper's outputs (App. E, Figs. 9, 11)."""
    if REASONING:
        text = text.split("</think>", 1)[1] if "</think>" in text else ("" if "<think>" in text else text)
    text = text.strip()
    if text.lower().startswith("translation:"):
        text = text[len("translation:"):].strip()
    return text

def generate(id_lists):
    """Returns (raw_text, finish_reason) per prompt, in input order."""
    if backend == "vllm":
        sp = SamplingParams(temperature=TEMPERATURE, max_tokens=MAX_NEW, seed=SEED, ignore_eos=IGNORE_EOS)
        outs = llm.generate([{"prompt_token_ids": ids} for ids in id_lists], sp, use_tqdm=False)
        return [(o.outputs[0].text, o.outputs[0].finish_reason) for o in outs]
    results = [None] * len(id_lists)
    order = sorted(range(len(id_lists)), key=lambda i: len(id_lists[i]))   # batch similar lengths
    for start in range(0, len(order), HF_BATCH):
        idx = order[start:start + HF_BATCH]
        enc = tok.pad({"input_ids": [id_lists[i] for i in idx]}, return_tensors="pt").to(model.device)
        with torch.no_grad():
            gen = model.generate(**enc, do_sample=True, temperature=TEMPERATURE, max_new_tokens=MAX_NEW,
                                 min_new_tokens=MAX_NEW if IGNORE_EOS else None, pad_token_id=tok.pad_token_id)
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
            f.write(json.dumps({**r, "model": RUN_NAME, "hf_id": weights, "backend": backend,
                                "prompt_mode": MODE, "max_new_tokens": MAX_NEW, "ignore_eos": IGNORE_EOS,
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
    shutil.make_archive(f"/kaggle/working/outputs_{RUN_NAME}", "zip", OUT.parent, RUN_NAME)
    print(f"Saved /kaggle/working/outputs_{RUN_NAME}.zip")
