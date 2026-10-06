"""
Parse page images with MinerU into DocLens' layout (MinerU_Page<n>/...).

Requires MinerU 2.x (pip install "mineru[core]==2.7.6"); MinerU 3+/4 replaced
this command-line interface. Equivalent to DocLens' preprocess/doc_parse_parallel_mineru.py, adapted for a
single Kaggle GPU: pages of all documents are staged into batches so the MinerU
models are loaded once per batch instead of once per document. Already-parsed
pages are skipped, so the script can be re-run after an interruption.

    python scripts/parse_mineru.py --root /kaggle/working/variants/blur_s2
"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def find_output_dir(out: Path, stem: str):
    """MinerU writes <out>/<stem>/<method>/<stem>.md; <method> depends on the backend."""
    for md in (out / stem).rglob(f"{stem}.md"):
        return md.parent
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True, help="Variant root containing data/<dataset>/documents")
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--backend", default="pipeline")
    p.add_argument("--table", default="False", help="DocLens parses with table recognition off")
    p.add_argument("--batch_size", type=int, default=150)
    p.add_argument("--extra_args", default="", help="Extra CLI args passed to mineru")
    p.add_argument("--keep_debug_files", action="store_true",
                   help="Keep MinerU's per-page debug PDFs (layout/span/origin); DocLens never reads them")
    args = p.parse_args()

    docs = Path(args.root) / "data" / args.dataset_name / "documents"
    todo = []
    for img in sorted(docs.glob("*/*.jpeg")):
        page = img.stem
        if not page.isdigit():
            continue
        if not (img.parent / f"MinerU_Page{page}" / f"{page}.md").exists():
            todo.append(img)
    print(f"{len(todo)} pages to parse under {docs}")

    stage = Path(args.root) / "_mineru_stage"
    for b in range(0, len(todo), args.batch_size):
        batch = todo[b : b + args.batch_size]
        shutil.rmtree(stage, ignore_errors=True)
        (stage / "in").mkdir(parents=True)
        names = {}
        for i, img in enumerate(batch):
            stem = f"p{b + i:06d}"
            shutil.copy(img, stage / "in" / f"{stem}.jpeg")
            names[stem] = img

        env = os.environ.copy()
        env["MINERU_TABLE_ENABLE"] = "false"  # same as DocLens
        cmd = ["mineru", "-p", str(stage / "in"), "-o", str(stage / "out"), "-b", args.backend,
               "-t", args.table]
        cmd += args.extra_args.split()
        print(f"[batch {b // args.batch_size + 1}] {' '.join(cmd)}")
        subprocess.run(cmd, env=env, check=True)

        missing = 0
        for stem, img in names.items():
            src = find_output_dir(stage / "out", stem)
            page = img.stem
            dst = img.parent / f"MinerU_Page{page}"
            shutil.rmtree(dst, ignore_errors=True)
            dst.mkdir(parents=True)
            if src is None:
                # DocLens reads <page>.md for every page; blank/unparsable pages get an empty one.
                (dst / f"{page}.md").write_text("")
                missing += 1
                continue
            for f in src.iterdir():
                # rename p000123.md -> <page>.md, p000123_middle.json -> <page>_middle.json, ...
                name = f.name.replace(stem, page, 1) if f.name.startswith(stem) else f.name
                if f.suffix == ".pdf" and not args.keep_debug_files:
                    continue  # saves several GB on the full benchmark
                shutil.move(str(f), str(dst / name))
        if missing:
            print(f"  {missing} pages produced no MinerU output (blank pages?); wrote empty markdown")
    shutil.rmtree(stage, ignore_errors=True)

    print("Done.")


if __name__ == "__main__":
    main()
