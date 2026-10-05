"""
Create degraded copies of the rendered pages (one DocLens data root per variant).

    python scripts/make_variants.py --out_root /kaggle/working/variants \
        --variants blur_s2 noise_s2 jpeg_s3 lowres_s2 mixed_s2

Variant names are <kind>_s<severity>, kind in {blur, noise, jpeg, lowres, fade, mixed},
severity in {1, 2, 3}. Pages are stored as JPEG quality 95, like DocLens' clean pages.
"""

import argparse
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cdc.degradation import degrade, parse_variant  # noqa: E402


def _one(job):
    src, dst, kind, sev = job
    if dst.exists():
        return
    seed = zlib.crc32(f"{src.parent.name}/{src.name}".encode())
    with Image.open(src) as img:
        degrade(img, kind, sev, seed).save(dst, format="JPEG", quality=95)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out_root", required=True)
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--variants", nargs="+", required=True)
    p.add_argument("--workers", type=int, default=4)
    args = p.parse_args()

    root = Path(args.out_root)
    clean_docs = root / "clean" / "data" / args.dataset_name / "documents"
    pages = sorted(clean_docs.glob("*/*.jpeg"))
    if not pages:
        raise SystemExit(f"No clean pages in {clean_docs}; run prepare_subset.py first.")

    for variant in args.variants:
        kind, sev = parse_variant(variant)
        jobs = []
        for src in pages:
            dst = root / variant / "data" / args.dataset_name / "documents" / src.parent.name / src.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            jobs.append((src, dst, kind, sev))
        with ProcessPoolExecutor(args.workers) as ex:
            list(tqdm(ex.map(_one, jobs, chunksize=8), total=len(jobs), desc=variant))
    print("Done. Next: parse every variant (including clean) with scripts/parse_mineru.py")


if __name__ == "__main__":
    main()
