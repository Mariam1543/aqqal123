"""
Choose the questions for the CDC (novelty) experiments from the Table 9 sample.

Every degraded variant has to be re-parsed by MinerU, page by page, so the cost of a variant is
the number of PAGES of the chosen documents, not the number of questions. This script keeps whole
documents and picks those with the most questions per page first, until --n_questions is reached
(and never more than --max_total_pages pages). The chosen questions are a subset of the Table 9
questions, so the reproduction run's Lens outputs and DocLens answers can be reused for the clean
variant (run_cdc.py --reuse_from).

    python scripts/select_novelty_subset.py --samples samples_random200_seed0.json \
        --documents DocLens/data/MMLongBenchDoc/documents --n_questions 100 --out novelty_samples.json
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import pymupdf


def select(samples, page_counts, n_questions, max_total_pages, max_doc_pages):
    by_doc = defaultdict(list)
    for q in samples:
        if q["doc_id"] in page_counts and page_counts[q["doc_id"]] <= max_doc_pages:
            by_doc[q["doc_id"]].append(q)
    # most questions per page first; ties: shorter document, then name (deterministic)
    order = sorted(by_doc, key=lambda d: (-len(by_doc[d]) / page_counts[d], page_counts[d], d))
    chosen, n_q, n_p = [], 0, 0
    for d in order:
        if n_q >= n_questions:
            break
        if n_p + page_counts[d] > max_total_pages:
            continue
        chosen.append(d)
        n_q += len(by_doc[d])
        n_p += page_counts[d]
    keep = set(chosen)
    return [q for q in samples if q["doc_id"] in keep], chosen, n_p


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", required=True, help="The Table 9 sample (samples_random200_seed0.json)")
    p.add_argument("--documents", required=True, help="Directory with the PDFs")
    p.add_argument("--n_questions", type=int, default=100)
    p.add_argument("--max_total_pages", type=int, default=1500, help="MinerU pages per degraded variant")
    p.add_argument("--max_doc_pages", type=int, default=120, help="Skip documents longer than this")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    samples = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    page_counts = {}
    for doc_id in {q["doc_id"] for q in samples}:
        pdf = Path(args.documents) / doc_id
        if pdf.exists():
            with pymupdf.open(pdf) as d:
                page_counts[doc_id] = len(d)
    subset, docs, pages = select(samples, page_counts, args.n_questions, args.max_total_pages, args.max_doc_pages)
    Path(args.out).write_text(json.dumps(subset, ensure_ascii=False, indent=1))
    print(f"{len(subset)} questions from {len(docs)} documents, {pages} pages per variant -> {args.out}")


if __name__ == "__main__":
    main()
