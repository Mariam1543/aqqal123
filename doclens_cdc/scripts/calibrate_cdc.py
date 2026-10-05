"""
Calibrate the CDC degradation detector on your own pages.

Because degraded variants are generated synthetically, every page has a known
label (clean / blur / noise / jpeg / lowres / fade / mixed). This script

  1. measures the no-reference image features on the same pages in every variant,
  2. re-fits the logistic midpoints of the heuristic scorer from the clean vs.
     degraded feature distributions (calibrated to *your* documents: slides with
     photos have very different clean statistics from text-only reports),
  3. fits a small softmax degradation classifier and reports its held-out
     accuracy (degradation can be detected and classified),
  4. writes calibration.json for `run_cdc.py --calibration`.

Calibrate on documents that are NOT used for evaluation (or report it as such).
"""

import argparse
import json
import random
import sys
import zlib
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np
from PIL import Image
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cdc.degradation import parse_variant  # noqa: E402
from cdc.quality import (  # noqa: E402
    QualityThresholds,
    assess_features,
    fit_degradation_classifier,
    image_features,
)

# feature -> (variant kinds that should move it, direction of "worse")
FEATURE_TARGETS = {
    "blur": (("blur", "lowres"), +1),
    "noise": (("noise",), +1),
    "blockiness": (("jpeg", "mixed"), +1),
    "contrast": (("fade",), -1),
}
FEATURE_TO_FIELDS = {
    "blur": ("blur_mid", "blur_scale"),
    "noise": ("noise_mid", "noise_scale"),
    "blockiness": ("block_mid", "block_scale"),
    "contrast": ("contrast_mid", "contrast_scale"),
}


def collect(root: Path, dataset: str, variants, pages_per_doc: int, seed: int):
    clean_docs = root / "clean" / "data" / dataset / "documents"
    rnd = random.Random(seed)
    rows = []
    doc_dirs = sorted(d for d in clean_docs.iterdir() if d.is_dir())
    for doc in tqdm(doc_dirs, desc="Measuring pages"):
        pages = sorted(doc.glob("*.jpeg"), key=lambda p: int(p.stem))
        for page in rnd.sample(pages, min(pages_per_doc, len(pages))):
            for variant in ["clean"] + list(variants):
                path = root / variant / "data" / dataset / "documents" / doc.name / page.name
                if not path.exists():
                    continue
                with Image.open(path) as img:
                    feats = image_features(img)
                kind, sev = parse_variant(variant)
                rows.append({"doc": doc.name, "page": page.name, "variant": variant,
                             "kind": kind, "severity": sev, **feats})
    return rows


def fit_thresholds(rows, min_severity: int) -> tuple[QualityThresholds, dict]:
    th = QualityThresholds()
    clean = [r for r in rows if r["kind"] == "clean"]
    report = {}
    for feat, (kinds, direction) in FEATURE_TARGETS.items():
        deg = [r[feat] for r in rows if r["kind"] in kinds and r["severity"] >= min_severity]
        if not deg or not clean:
            report[feat] = "kept default (no matching variant)"
            continue
        c = np.array([r[feat] for r in clean])
        d = np.array(deg)
        if direction > 0:
            c_edge, d_center = np.percentile(c, 95), np.median(d)
        else:
            c_edge, d_center = np.percentile(c, 5), np.median(d)
        if (d_center - c_edge) * direction <= 0:
            report[feat] = f"kept default (no separation: clean edge {c_edge:.3f}, degraded median {d_center:.3f})"
            continue
        mid = (c_edge + d_center) / 2
        scale = abs(d_center - c_edge) / 6
        mid_field, scale_field = FEATURE_TO_FIELDS[feat]
        setattr(th, mid_field, float(mid))
        setattr(th, scale_field, float(max(scale, 1e-3)))
        report[feat] = {"clean_edge": float(c_edge), "degraded_median": float(d_center),
                        "mid": float(mid), "scale": float(scale)}
    return th, report


def detection_report(rows, th, clf, holdout_docs):
    """How often is a page flagged (reliability < 0.5) / its type recovered, per variant."""
    out = defaultdict(lambda: Counter())
    for r in rows:
        if clf is not None and r["doc"] not in holdout_docs:
            continue
        feats = {k: r[k] for k in ("blur", "noise", "blockiness", "contrast", "ink_ratio")}
        a = assess_features(feats, th, clf)
        out[r["variant"]]["n"] += 1
        out[r["variant"]]["flagged"] += a.reliability < 0.5
        expected = {"lowres": "blur", "mixed": "jpeg"}.get(r["kind"], r["kind"]) if clf is None else r["kind"]
        out[r["variant"]]["type_ok"] += a.degradation == expected
    return {
        v: {"pages": c["n"], "flag_rate": c["flagged"] / c["n"], "type_accuracy": c["type_ok"] / c["n"]}
        for v, c in sorted(out.items())
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--variants_root", required=True)
    p.add_argument("--dataset_name", default="MMLongBenchDoc")
    p.add_argument("--variants", nargs="+", required=True)
    p.add_argument("--pages_per_doc", type=int, default=6)
    p.add_argument("--min_severity", type=int, default=2,
                   help="Severity from which a degradation should count as unreliable")
    p.add_argument("--use_classifier", action="store_true",
                   help="Make run_cdc.py use the learned classifier instead of the heuristic")
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    root = Path(args.variants_root)
    rows = collect(root, args.dataset_name, args.variants, args.pages_per_doc, args.seed)
    if not rows:
        raise SystemExit("No pages found.")
    th, th_report = fit_thresholds(rows, args.min_severity)

    docs = sorted({r["doc"] for r in rows})
    holdout = {d for d in docs if zlib.crc32(d.encode()) % 3 == 0} or set(docs[-1:])
    train = [r for r in rows if r["doc"] not in holdout]
    clf = fit_degradation_classifier(train, [r["kind"] for r in train]) if train else None

    result = {
        "thresholds": asdict(th),
        "use_classifier": bool(args.use_classifier),
        "classifier": asdict(clf) if clf else None,
        "report": {
            "n_pages": len(rows),
            "threshold_fit": th_report,
            "heuristic_detection": detection_report(rows, th, None, holdout),
            "classifier_heldout_detection": detection_report(rows, th, clf, holdout) if clf else None,
            "classifier_train_accuracy": clf.train_accuracy if clf else None,
            "holdout_docs": sorted(holdout),
        },
    }
    Path(args.out).write_text(json.dumps(result, indent=2))
    print(json.dumps(result["report"], indent=2))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
