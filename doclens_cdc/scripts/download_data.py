"""
Download one DocLens benchmark from the Hugging Face Hub.

    python scripts/download_data.py --dataset MMLongBenchDoc --out /kaggle/working/DocLens/data

The DocLens README points to `dwzhu/DocLensDatasets`; the script prints what it
finds so you can point --samples / --documents of the next step at it.
"""

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo_id", default="dwzhu/DocLensDatasets")
    p.add_argument("--dataset", default="MMLongBenchDoc")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=args.repo_id,
        repo_type="dataset",
        local_dir=out,
        allow_patterns=[f"{args.dataset}/*", f"{args.dataset}/**"],
    )
    root = out / args.dataset
    jsons = sorted(root.rglob("*.json"))
    pdfs = sorted(root.rglob("*.pdf"))
    print(f"Downloaded to {root}")
    print(f"  {len(pdfs)} PDFs, e.g. {pdfs[0] if pdfs else '-'}")
    print("  JSON files:", *[str(j) for j in jsons[:10]], sep="\n    ")


if __name__ == "__main__":
    main()
