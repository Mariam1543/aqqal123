# %% [markdown]
# # 01 — Prepare the evaluation data (Translation Tangles reproduction)
#
# Builds the fixed test sets every model is run on: **500 sentence pairs per direction**,
# sampled once with a fixed seed, so all models see exactly the same inputs.
#
# | Suite | Source | Directions |
# |---|---|---|
# | general | WMT19 validation, WMT18 test (et, tr), BanglaNMT test | 24 (12 pairs, both ways) |
# | literature | Kaz-Rus-Eng Literature Corpus | ru↔kk, en↔kk, ru↔en (6) |
# | medical | ELRC-Medical-V2 | en→fr, hr, it, pl, de, es, pt, fi (8) |
# | law | MultiEURLEX test | en→es, fr, pl, it, pt, ro, el, de (8) |
#
# Both directions of a pair use the same 500 sentence pairs, swapped.
#
# **Run on CPU** (Accelerator: None), Internet On, secret `HF_TOKEN` attached.
# Takes ~15–25 min, mostly downloading MultiEURLEX.
#
# Output: `/kaggle/working/tt_data/` (one JSONL file per direction + `manifest.json`)
# and `/kaggle/working/tt_data.zip`. Save the notebook output as a Kaggle Dataset named
# **`tt-data`** so both accounts can attach it, and upload the zip back here.

# %%
import json, os, random, shutil, subprocess, sys, textwrap
from collections import Counter
from pathlib import Path

from kaggle_secrets import UserSecretsClient
from huggingface_hub import login
from datasets import load_dataset

SEED = 42
N = 500
OUT = Path("/kaggle/working/tt_data")
RAW = Path("/kaggle/working/raw")
shutil.rmtree(OUT, ignore_errors=True)
for d in (OUT, RAW):
    d.mkdir(parents=True, exist_ok=True)

HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")
login(token=HF_TOKEN, add_to_git_credential=False)

# Full language names go into the translation prompt (App. A.1)
LANG_NAMES = {
    "en": "English", "cs": "Czech", "de": "German", "fr": "French", "ru": "Russian",
    "fi": "Finnish", "lt": "Lithuanian", "et": "Estonian", "gu": "Gujarati", "kk": "Kazakh",
    "bn": "Bengali", "zh": "Chinese", "tr": "Turkish", "hr": "Croatian", "it": "Italian",
    "pl": "Polish", "es": "Spanish", "pt": "Portuguese", "ro": "Romanian", "el": "Greek",
}
manifest = {"seed": SEED, "n_per_direction": N, "files": {}, "pools": {}, "notes": []}

# %% [markdown]
# ## Helpers

# %%
def clean_pairs(pairs):
    """Strip whitespace, drop empty sides, drop exact duplicates (keeping first occurrence)."""
    seen, out = set(), []
    for a, b in pairs:
        a, b = (a or "").strip(), (b or "").strip()
        if a and b and (a, b) not in seen:
            seen.add((a, b))
            out.append((a, b))
    return out

def sample(pairs, n=N, seed=SEED):
    """Deterministic sample of n pairs, kept in original order."""
    if len(pairs) <= n:
        return list(pairs)
    idx = sorted(random.Random(seed).sample(range(len(pairs)), n))
    return [pairs[i] for i in idx]

def write_direction(suite, dataset, src, tgt, rows):
    """rows: list of (pair_id, source_text, reference_text)."""
    path = OUT / suite / f"{src}-{tgt}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for pair_id, s, r in rows:
            f.write(json.dumps({
                "id": f"{suite}:{src}-{tgt}:{pair_id}", "pair_id": pair_id,
                "suite": suite, "dataset": dataset,
                "src_lang": src, "tgt_lang": tgt,
                "src_name": LANG_NAMES[src], "tgt_name": LANG_NAMES[tgt],
                "source": s, "reference": r,
            }, ensure_ascii=False) + "\n")
    manifest["files"][f"{suite}/{src}-{tgt}"] = {"dataset": dataset, "n": len(rows)}

def write_pair(suite, dataset, a, b, pairs, both_ways=True):
    """pairs are (text_in_a, text_in_b). Samples once and writes a→b (and b→a)."""
    pairs = clean_pairs(pairs)
    manifest["pools"][f"{suite}/{a}-{b}"] = len(pairs)
    chosen = sample(pairs)
    ids = [f"{a}{b}{i:04d}" for i in range(len(chosen))]
    write_direction(suite, dataset, a, b, [(i, x, y) for i, (x, y) in zip(ids, chosen)])
    if both_ways:
        write_direction(suite, dataset, b, a, [(i, y, x) for i, (x, y) in zip(ids, chosen)])
    print(f"{suite:10s} {a}-{b}: pool {len(pairs):>7}, sampled {len(chosen)}"
          + (" (both directions)" if both_ways else ""))

# %% [markdown]
# ## General benchmark — WMT19 / WMT18
#
# WMT19 has no test split on HF, so the validation split (newstest2018) is used, as in the
# paper (App. C). Estonian and Turkish are not in WMT19, so they come from the WMT18 test split.

# %%
WMT = [
    ("wmt/wmt19", "cs-en", "validation"), ("wmt/wmt19", "de-en", "validation"),
    ("wmt/wmt19", "fi-en", "validation"), ("wmt/wmt19", "gu-en", "validation"),
    ("wmt/wmt19", "kk-en", "validation"), ("wmt/wmt19", "lt-en", "validation"),
    ("wmt/wmt19", "ru-en", "validation"), ("wmt/wmt19", "zh-en", "validation"),
    ("wmt/wmt19", "fr-de", "validation"),
    ("wmt/wmt18", "et-en", "test"), ("wmt/wmt18", "tr-en", "test"),
]
for repo, cfg, split in WMT:
    a, b = cfg.split("-")
    ds = load_dataset(repo, cfg, split=split)
    write_pair("general", f"{repo.split('/')[1]}:{split}", a, b,
               [(r["translation"][a], r["translation"][b]) for r in ds])

# %% [markdown]
# ## Literature — Kaz-Rus-Eng Literature Corpus
#
# Rows are stored in one orientation (`X_lang` → `y_lang`); both orientations of a language
# pair are pooled and then sampled once. No `Similarity` filter is applied (the paper does not
# mention one); the distribution is recorded in the manifest.

# %%
lit = load_dataset("Nothingger/kaz-rus-eng-literature-parallel-corpus", split="train")
code = lambda tag: {"kaz": "kk", "rus": "ru", "eng": "en"}.get(str(tag)[:3])
orient = Counter((code(r["X_lang"]), code(r["y_lang"])) for r in lit)
print("Orientations in corpus:", dict(orient))
manifest["notes"].append(f"literature orientations: { {f'{k[0]}->{k[1]}': v for k, v in orient.items()} }")

for a, b in [("ru", "kk"), ("en", "kk"), ("ru", "en")]:
    pairs = []
    for r in lit:
        x, y = code(r["X_lang"]), code(r["y_lang"])
        if (x, y) == (a, b):
            pairs.append((r["X"], r["y"]))
        elif (x, y) == (b, a):
            pairs.append((r["y"], r["X"]))
    write_pair("literature", "kaz-rus-eng-literature", a, b, pairs)

sims = sorted(r["Similarity"] for r in lit if r["Similarity"] is not None)
if sims:
    manifest["notes"].append(
        f"literature Similarity quartiles: {[round(sims[int(q * (len(sims) - 1))], 3) for q in (0, .25, .5, .75, 1)]}")

# %% [markdown]
# ## Script-based datasets — BanglaNMT, ELRC-Medical-V2, MultiEURLEX
#
# These only load with `datasets` 3.6 (`trust_remote_code=True`), which `00b` showed works.
# It is installed in a side folder and run in a separate process, which writes raw candidate
# pairs to `/kaggle/working/raw/`; sampling then happens here with the same seed.
#
# **MultiEURLEX is document-level.** The paper does not say how documents were segmented.
# Here each test document's English and target texts are split on newlines and paired line by
# line **only when both versions have the same number of lines** (EU documents share layout
# across languages). Lines that are identical in both languages (CELEX ids, numbers) and very
# short or very long English lines (< 4 or > 120 words) are dropped.

# %%
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--target", "/kaggle/working/ds3",
                "datasets==3.6.0"], check=True)

extract = textwrap.dedent(r'''
    import json, sys
    from pathlib import Path
    from datasets import load_dataset

    RAW = Path(sys.argv[1])
    stats = {}

    def dump(name, pairs):
        with open(RAW / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for a, b in pairs:
                f.write(json.dumps({"a": a, "b": b}, ensure_ascii=False) + "\n")
        stats[name] = len(pairs)
        print(name, len(pairs), flush=True)

    # BanglaNMT: official test split (1K)
    ds = load_dataset("csebuetnlp/BanglaNMT", "BanglaNMT", split="test", trust_remote_code=True)
    dump("general_bn-en", [(r["bn"], r["en"]) for r in ds])

    # ELRC-Medical-V2: only a train split exists; all of it is the pool
    for t in ["fr", "hr", "it", "pl", "de", "es", "pt", "fi"]:
        ds = load_dataset("qanastek/ELRC-Medical-V2", f"en-{t}", split="train", trust_remote_code=True)
        dump(f"medical_en-{t}", [(r["translation"]["en"], r["translation"][t]) for r in ds])

    # MultiEURLEX: test documents, line-aligned where line counts match
    ds = load_dataset("coastalcph/multi_eurlex", "all_languages", split="test", trust_remote_code=True)
    for t in ["es", "fr", "pl", "it", "pt", "ro", "el", "de"]:
        pairs, docs_used, docs_total = [], 0, 0
        for r in ds:
            en, tx = r["text"].get("en"), r["text"].get(t)
            if not en or not tx:
                continue
            docs_total += 1
            el, tl = en.split("\n"), tx.split("\n")
            if len(el) != len(tl):
                continue
            docs_used += 1
            for a, b in zip(el, tl):
                a, b = a.strip(), b.strip()
                if a and b and a != b and 4 <= len(a.split()) <= 120:
                    pairs.append((a, b))
        stats[f"law_en-{t}_docs"] = f"{docs_used}/{docs_total} documents line-aligned"
        dump(f"law_en-{t}", pairs)

    print("STATS" + json.dumps(stats))
''')
open("/kaggle/working/extract_ds3.py", "w").write(extract)
env = dict(os.environ, PYTHONPATH="/kaggle/working/ds3", HF_TOKEN=HF_TOKEN)
p = subprocess.run([sys.executable, "/kaggle/working/extract_ds3.py", str(RAW)],
                   capture_output=True, text=True, env=env, timeout=5400)
print(p.stdout[-3000:])
if p.returncode != 0:
    print(p.stderr[-3000:])
    raise RuntimeError("datasets 3.6 extraction failed — send the error above")
stats_line = next(l for l in p.stdout.splitlines() if l.startswith("STATS"))
manifest["notes"].append({"script_datasets": json.loads(stats_line[5:])})

# %%
def read_raw(name):
    with open(RAW / f"{name}.jsonl", encoding="utf-8") as f:
        return [(d["a"], d["b"]) for d in map(json.loads, f)]

write_pair("general", "banglanmt:test", "bn", "en", read_raw("general_bn-en"))
for t in ["fr", "hr", "it", "pl", "de", "es", "pt", "fi"]:
    write_pair("medical", "elrc-medical-v2", "en", t, read_raw(f"medical_en-{t}"), both_ways=False)
for t in ["es", "fr", "pl", "it", "pt", "ro", "el", "de"]:
    write_pair("law", "multi_eurlex:test", "en", t, read_raw(f"law_en-{t}"), both_ways=False)

# %% [markdown]
# ## Check, save manifest, zip

# %%
expected = {"general": 24, "literature": 6, "medical": 8, "law": 8}
counts = Counter(k.split("/")[0] for k in manifest["files"])
short = {k: v["n"] for k, v in manifest["files"].items() if v["n"] < N}
print("Files per suite:", dict(counts), "expected:", expected)
print("Directions with fewer than", N, "pairs:", short or "none")
assert dict(counts) == expected, "missing directions — see above"

with open(OUT / "manifest.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

for key in ["general/de-en", "general/en-gu", "literature/kk-ru", "medical/en-fr", "law/en-el"]:
    with open(OUT / f"{key}.jsonl", encoding="utf-8") as f:
        ex = json.loads(f.readline())
    print(f"\n[{key}]\n  SRC: {ex['source'][:200]}\n  REF: {ex['reference'][:200]}")

shutil.make_archive("/kaggle/working/tt_data", "zip", OUT)
shutil.rmtree(RAW, ignore_errors=True)
shutil.rmtree("/kaggle/working/ds3", ignore_errors=True)
print("\nDone:", sum(v["n"] for v in manifest["files"].values()), "rows in",
      len(manifest["files"]), "files -> /kaggle/working/tt_data.zip")
