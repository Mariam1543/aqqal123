"""Run several models one after another, unattended (e.g. on a university GPU).

    python tools/run_queue.py llama-3.1-70b llama3-70b llama-3.3-70b
    python tools/run_queue.py --dry-run llama-3.1-70b

Needs HF_TOKEN in the environment and the unzipped tt_data folder (TT_DATA, default ./tt_data).
Each model runs in its own process via notebooks/src/02_generate.py, so one failure does not stop
the queue. Finished directions are skipped on a re-run, so an interrupted queue can be started again.
Logs go to logs/<model>.log and zips to work/outputs_<model>.zip.
"""
import argparse, os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "notebooks" / "src" / "02_generate.py"


def registry():
    src = SCRIPT.read_text()
    block = src[src.index("GEN = ["):src.index("cfg = REGISTRY[MODEL]")]
    ns = {}
    exec(block, ns)
    return ns["REGISTRY"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-new", type=int)
    ap.add_argument("--ignore-eos", action="store_true")
    args = ap.parse_args()
    reg = registry()
    (ROOT / "logs").mkdir(exist_ok=True)
    results = []
    for m in args.models:
        if m not in reg:
            print(f"[skip] {m}: not in the registry"); results.append((m, "unknown model")); continue
        awq = reg[m].get("awq")
        if awq and not args.dry_run:
            try:
                from huggingface_hub import auth_check
                auth_check(awq)
            except Exception as e:
                print(f"[skip] {m}: 4-bit weights '{awq}' not reachable ({type(e).__name__}); fix the id in the registry")
                results.append((m, "4-bit weights not found")); continue
        env = dict(os.environ, TT_MODEL=m, TT_SMOKE="False")
        if args.max_new: env["TT_MAX_NEW"] = str(args.max_new)
        if args.ignore_eos: env["TT_IGNORE_EOS"] = "True"
        cmd = [sys.executable, str(SCRIPT)]
        print(f"[run] {m}: TT_MODEL={m} {' '.join(cmd)}  -> logs/{m}.log")
        if args.dry_run:
            continue
        t0 = time.time()
        with open(ROOT / "logs" / f"{m}.log", "w") as log:
            rc = subprocess.run(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT).returncode
        results.append((m, "ok" if rc == 0 else f"FAILED (exit {rc}); see logs/{m}.log"))
        print(f"[done] {m}: {results[-1][1]} in {(time.time() - t0) / 60:.0f} min")
    print("\nSummary:"); [print(f"  {m:28s} {r}") for m, r in results]


if __name__ == "__main__":
    main()
