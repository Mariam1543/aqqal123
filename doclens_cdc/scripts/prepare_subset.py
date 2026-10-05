"""
Pick a Kaggle-sized subset of a DocLens benchmark and render its pages.

MinerU has to parse every page of every selected document once per degradation
variant, so the subset is chosen by documents (short ones first) rather than by
questions.

Output:
    <out_root>/samples_subset.json
    <out_root>/clean/data/<dataset>/documents/<doc_stem>/<page>.jpeg
"""

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

import pymupdf
from tqdm import tqdm


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", required=True, help="DocLens samples JSON (e.g. data/MMLongBenchDoc/samples.json)")
    p.add_argument("--documents", required=True, help="Directory with the PDFs")
    p.add_argument("--out_root", required=True)
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--max_docs", type=int, default=8)
    p.add_argument("--max_pages", type=int, default=30, help="Skip documents longer than this")
    p.add_argument("--max_questions", type=int, default=60)
    p.add_argument("--dpi", type=int, default=200, help="DocLens renders at 200 DPI")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    samples = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    docs_dir = Path(args.documents)
    by_doc = defaultdict(list)
    for s in samples:
        by_doc[s["doc_id"]].append(s)

    page_counts = {}
    for doc_id in by_doc:
        pdf = docs_dir / doc_id
        if not pdf.exists():
            continue
        try:
            with pymupdf.open(pdf) as d:
                page_counts[doc_id] = len(d)
        except Exception as e:
            print(f"skip {doc_id}: {e}")
    eligible = [d for d, n in page_counts.items() if n <= args.max_pages]
    rnd = random.Random(args.seed)
    rnd.shuffle(eligible)
    chosen = eligible[: args.max_docs]
    if not chosen:
        raise SystemExit("No document satisfies --max_pages; increase it.")

    # Round-robin over documents so every document contributes questions.
    queues = {d: list(by_doc[d]) for d in chosen}
    for q in queues.values():
        rnd.shuffle(q)
    subset = []
    while len(subset) < args.max_questions and any(queues.values()):
        for d in chosen:
            if queues[d] and len(subset) < args.max_questions:
                subset.append(queues[d].pop())

    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "samples_subset.json").write_text(json.dumps(subset, ensure_ascii=False, indent=2))

    clean_docs = out_root / "clean" / "data" / args.dataset_name / "documents"
    total_pages = 0
    for doc_id in tqdm(chosen, desc="Rendering pages"):
        target = clean_docs / Path(doc_id).stem
        target.mkdir(parents=True, exist_ok=True)
        with pymupdf.open(docs_dir / doc_id) as d:
            for i, page in enumerate(d, start=1):
                path = target / f"{i}.jpeg"
                if not path.exists():
                    page.get_pixmap(dpi=args.dpi).save(str(path))
                total_pages += 1

    print(f"{len(subset)} questions from {len(chosen)} documents ({total_pages} pages)")
    print(f"  samples: {out_root / 'samples_subset.json'}")
    print(f"  pages:   {clean_docs}")


if __name__ == "__main__":
    main()
