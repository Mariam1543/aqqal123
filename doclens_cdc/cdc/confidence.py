"""
The Confidence and Degradation Check (CDC) stage.

Sits between DocLens' Lens Module (Page Navigator + Element Localizer) and its
Reasoning Module (Answer Sampler + Adjudicator):

    evidence-level : every localized page gets a reliability score
                     q_page = q_image^w_i * q_text^w_t * q_crops^w_c
                     and a detected degradation type; pages with
                     q_page < tau_evidence are marked for correction.
    case-level     : c = w_e * E + w_s * S (+ w_v * V)
                     E = evidence reliability (mean/min blend over located pages)
                     S = Lens self-consistency (answer + page agreement of the
                         Page Navigator's sampled candidates; costs no extra call)
                     V = optional verbalized confidence from an LLM judge
    gate           : c >= tau_case -> ABSTAIN (keep original evidence, no correction)
                     c <  tau_case -> CORRECT (restore unreliable evidence and run the
                                      full Reasoning Module with degradation-aware prompts)
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field, asdict
from itertools import combinations
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

from .evidence import PageEvidence
from .quality import (
    DegradationClassifier,
    QualityThresholds,
    assess_image,
    mineru_span_confidence,
    text_features,
    text_reliability,
)

ABSTAIN = "abstain"
CORRECT = "correct"


@dataclass
class CDCConfig:
    tau_case: float = 0.70
    tau_evidence: float = 0.50
    w_image: float = 0.50
    w_text: float = 0.35
    w_crops: float = 0.15
    w_evidence: float = 0.70
    w_consistency: float = 0.30
    w_verbal: float = 0.0
    min_weight: float = 0.5  # E = (1 - min_weight) * mean + min_weight * min
    max_pages_scored: int = 30
    min_crop_side: int = 96
    thresholds: QualityThresholds = field(default_factory=QualityThresholds)
    classifier: Optional[DegradationClassifier] = None


@dataclass
class PageScore:
    page: int
    q_page: float
    q_image: float
    q_text: Optional[float]
    q_crops: Optional[float]
    degradation: str
    needs_correction: bool
    image_factors: Dict[str, float]
    image_features: Dict[str, float]
    text_features: Dict[str, float]
    mineru_confidence: Optional[float]


@dataclass
class CDCReport:
    confidence: float
    decision: str
    evidence_reliability: Optional[float]
    consistency: Optional[float]
    answer_agreement: Optional[float]
    page_agreement: Optional[float]
    verbal_confidence: Optional[float]
    pages: List[PageScore]

    @property
    def low_confidence_pages(self) -> List[PageScore]:
        return [p for p in self.pages if p.needs_correction]

    def summary(self) -> dict:
        d = asdict(self)
        d["pages"] = [
            {k: v for k, v in asdict(p).items() if k not in ("image_features", "text_features", "image_factors")}
            for p in self.pages
        ]
        d["page_details"] = [asdict(p) for p in self.pages]
        d["n_low_confidence_pages"] = len(self.low_confidence_pages)
        d["detected_degradations"] = dict(Counter(p.degradation for p in self.pages))
        return d


# --------------------------------------------------------------------------- #
# Evidence-level scoring
# --------------------------------------------------------------------------- #
_ASSESS_CACHE: Dict[tuple, object] = {}


def _assess_file(path: Path, cfg: CDCConfig):
    """Image assessment, cached because many questions share the same document pages."""
    key = (str(path), path.stat().st_mtime, id(cfg.thresholds), id(cfg.classifier))
    if key not in _ASSESS_CACHE:
        if len(_ASSESS_CACHE) > 8192:
            _ASSESS_CACHE.clear()
        with Image.open(path) as img:
            _ASSESS_CACHE[key] = assess_image(img, cfg.thresholds, cfg.classifier)
    return _ASSESS_CACHE[key]


def _geo_mean(values: Dict[str, Optional[float]], weights: Dict[str, float]) -> float:
    num, den = 0.0, 0.0
    for k, v in values.items():
        if v is None or weights.get(k, 0) <= 0:
            continue
        num += weights[k] * math.log(max(v, 1e-6))
        den += weights[k]
    return math.exp(num / den) if den > 0 else 1.0


def score_page(pe: PageEvidence, cfg: CDCConfig) -> PageScore:
    img = _assess_file(pe.image_path, cfg)

    md = pe.markdown
    tfeats = text_features(md)
    mineru_conf = mineru_span_confidence(pe.middle_json_path) if pe.middle_json_path.exists() else None
    q_text = text_reliability(tfeats, cfg.thresholds, mineru_conf, img.features.get("ink_ratio"))

    crop_scores = []
    for crop in pe.crop_paths:
        try:
            with Image.open(crop) as c:
                if min(c.size) < cfg.min_crop_side:
                    continue
            crop_scores.append(_assess_file(crop, cfg).reliability)
        except Exception:
            continue
    q_crops = sum(crop_scores) / len(crop_scores) if crop_scores else None

    q_page = _geo_mean(
        {"image": img.reliability, "text": q_text, "crops": q_crops},
        {"image": cfg.w_image, "text": cfg.w_text, "crops": cfg.w_crops},
    )
    degradation = img.degradation
    if degradation == "clean" and q_text is not None and q_text < 0.5:
        degradation = "ocr_text"  # image looks fine but the OCR output is corrupted
    return PageScore(
        page=pe.page,
        q_page=q_page,
        q_image=img.reliability,
        q_text=q_text,
        q_crops=q_crops,
        degradation=degradation,
        needs_correction=q_page < cfg.tau_evidence,
        image_factors=img.factors,
        image_features=img.features,
        text_features=tfeats,
        mineru_confidence=mineru_conf,
    )


# --------------------------------------------------------------------------- #
# Lens self-consistency (free signal: the Page Navigator already samples k answers)
# --------------------------------------------------------------------------- #
def _norm_answer(a: str) -> str:
    a = str(a).lower().strip()
    a = re.sub(r"[\s\"'`.,;:!?()\[\]{}]+", " ", a).strip()
    return a


def _pages(s) -> set:
    return {int(x) for x in re.findall(r"\d+", str(s))}


def lens_consistency(data: dict, k: int) -> Dict[str, Optional[float]]:
    answers = [
        _norm_answer(data.get(f"pgnav_cand{i}_prediction", ""))
        for i in range(1, k + 1)
    ]
    answers = [a for a in answers if a and a != "error"]
    answer_agreement = None
    if len(answers) >= 2:
        answer_agreement = Counter(answers).most_common(1)[0][1] / len(answers)

    page_sets = [_pages(data.get(f"pgnav_cand{i}_located_pages", "")) for i in range(1, k + 1)]
    page_agreement = None
    if len(page_sets) >= 2:
        jac = []
        for a, b in combinations(page_sets, 2):
            union = a | b
            jac.append(len(a & b) / len(union) if union else 1.0)
        page_agreement = sum(jac) / len(jac)

    parts = [v for v in (answer_agreement, page_agreement) if v is not None]
    if not parts:
        consistency = None
    elif answer_agreement is not None and page_agreement is not None:
        consistency = 0.7 * answer_agreement + 0.3 * page_agreement
    else:
        consistency = parts[0]
    return {
        "answer_agreement": answer_agreement,
        "page_agreement": page_agreement,
        "consistency": consistency,
    }


def lens_majority_answer(data: dict, k: int) -> str:
    raw = [str(data.get(f"pgnav_cand{i}_prediction", "")) for i in range(1, k + 1)]
    raw = [r for r in raw if r.strip() and r.strip().lower() != "error"]
    if not raw:
        return ""
    counts = Counter(_norm_answer(r) for r in raw)
    best = counts.most_common(1)[0][0]
    return next(r for r in raw if _norm_answer(r) == best)


# --------------------------------------------------------------------------- #
# Case-level confidence and gate
# --------------------------------------------------------------------------- #
def evidence_reliability(pages: List[PageScore], min_weight: float) -> Optional[float]:
    if not pages:
        return None
    qs = [p.q_page for p in pages]
    return (1 - min_weight) * (sum(qs) / len(qs)) + min_weight * min(qs)


def combine(
    evidence: Optional[float],
    consistency: Optional[float],
    verbal: Optional[float],
    cfg: CDCConfig,
) -> float:
    parts = [
        (evidence, cfg.w_evidence),
        (consistency, cfg.w_consistency),
        (verbal, cfg.w_verbal),
    ]
    num = sum(v * w for v, w in parts if v is not None and w > 0)
    den = sum(w for v, w in parts if v is not None and w > 0)
    return num / den if den > 0 else 0.0


def build_report(
    page_scores: List[PageScore],
    consistency: Dict[str, Optional[float]],
    verbal: Optional[float],
    cfg: CDCConfig,
) -> CDCReport:
    ev = evidence_reliability(page_scores, cfg.min_weight)
    c = combine(ev, consistency["consistency"], verbal, cfg)
    return CDCReport(
        confidence=c,
        decision=ABSTAIN if c >= cfg.tau_case else CORRECT,
        evidence_reliability=ev,
        consistency=consistency["consistency"],
        answer_agreement=consistency["answer_agreement"],
        page_agreement=consistency["page_agreement"],
        verbal_confidence=verbal,
        pages=page_scores,
    )


def correction_note(ps: PageScore) -> str:
    labels = {
        "blur": "blur / low resolution",
        "noise": "sensor noise",
        "jpeg": "compression artifacts",
        "fade": "low contrast (faded print)",
        "lowres": "low resolution",
        "mixed": "mixed scan degradation",
        "ocr_text": "corrupted OCR text",
    }
    kind = labels.get(ps.degradation, ps.degradation)
    q_text = "n/a" if ps.q_text is None else f"{ps.q_text:.2f}"
    return (
        f"Page {ps.page} was flagged as LOW-CONFIDENCE evidence (reliability {ps.q_page:.2f}; "
        f"detected degradation: {kind}; OCR text reliability: {q_text}). The extracted text "
        f"below may contain recognition errors (e.g. 0/O, 1/l/I, 5/S, 8/B, dropped decimals or "
        f"minus signs). Verify every number, name and label against the page screenshot "
        f"(and its restored copy, if provided); when they disagree, trust the image."
    )


def load_calibration(path: Optional[str], cfg: CDCConfig) -> CDCConfig:
    """Apply a calibration file written by scripts/calibrate_cdc.py."""
    if not path:
        return cfg
    import json

    data = json.loads(Path(path).read_text())
    cfg.thresholds = QualityThresholds.load(path)
    if data.get("use_classifier"):
        cfg.classifier = DegradationClassifier.load(path)
    return cfg
