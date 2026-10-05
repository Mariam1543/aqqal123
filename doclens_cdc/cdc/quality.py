"""
No-reference reliability scoring for the evidence produced by DocLens' Lens Module.

Three kinds of evidence are scored:
  * page screenshots and zoomed-in element crops  -> image features
  * MinerU markdown (the OCR'd text of the page)   -> text features
  * MinerU's own OCR span confidences (if present) -> parser features

Image features are classic, training-free no-reference measures:
  * blur        : Crete-Roffet perceptual blur metric (0 = sharp, 1 = fully blurred)
  * noise       : robust (MAD) estimate of the std of a Laplacian-like residual,
                  following Immerkaer's fast noise variance estimator
  * blockiness  : ratio of luminance jumps on 8x8 JPEG grid lines vs. elsewhere
  * contrast    : spread between ink and paper percentiles

The heuristic scorer maps each feature to a [0, 1] reliability with a logistic
curve. Optionally a small softmax classifier (see `fit_degradation_classifier`)
can be fitted on clean/degraded pages so that the degradation *type* is
classified from data instead of thresholds.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np
from PIL import Image

# Longest side used for image analysis. Pages rendered at 200 DPI are ~2200px;
# we keep native resolution up to this size because downscaling hides blur/noise.
MAX_ANALYSIS_SIDE = 2400

IMAGE_FEATURES = ("blur", "noise", "blockiness", "contrast", "ink_ratio")


# --------------------------------------------------------------------------- #
# Image features
# --------------------------------------------------------------------------- #
def _to_gray(img: Image.Image) -> np.ndarray:
    img = img.convert("L")
    w, h = img.size
    scale = MAX_ANALYSIS_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.BILINEAR)
    return np.asarray(img, dtype=np.float32)


def _box1d(a: np.ndarray, size: int, axis: int) -> np.ndarray:
    """Moving average along one axis (edge-padded), via cumulative sums."""
    pad = size // 2
    pad_width = [(0, 0)] * a.ndim
    pad_width[axis] = (pad, size - 1 - pad)
    p = np.pad(a, pad_width, mode="edge")
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    zero_shape = list(c.shape)
    zero_shape[axis] = 1
    c = np.concatenate([np.zeros(zero_shape), c], axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(size, size + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / size).astype(np.float32)


def crete_blur(g: np.ndarray) -> float:
    """Crete-Roffet et al. (2007) no-reference blur metric in [0, 1]."""
    if min(g.shape) < 16:
        return 0.0
    scores = []
    for axis in (0, 1):
        b = _box1d(g, 9, axis)
        d_f = np.abs(np.diff(g, axis=axis))
        d_b = np.abs(np.diff(b, axis=axis))
        s_f = float(d_f.sum())
        if s_f <= 1e-6:
            scores.append(1.0)
            continue
        s_v = float(np.maximum(0.0, d_f - d_b).sum())
        scores.append((s_f - s_v) / s_f)
    return float(max(scores))


def noise_sigma(g: np.ndarray) -> float:
    """Robust noise std estimate (grey levels) from a Laplacian-like residual."""
    if min(g.shape) < 3:
        return 0.0
    # Immerkaer mask [[1,-2,1],[-2,4,-2],[1,-2,1]] written as slices.
    r = (
        g[:-2, :-2] - 2 * g[:-2, 1:-1] + g[:-2, 2:]
        - 2 * g[1:-1, :-2] + 4 * g[1:-1, 1:-1] - 2 * g[1:-1, 2:]
        + g[2:, :-2] - 2 * g[2:, 1:-1] + g[2:, 2:]
    )
    # For unit-variance white noise the residual has std 6. Median absolute
    # value is robust to the (sparse) text edges that dominate documents.
    return float(np.median(np.abs(r)) / 0.6745 / 6.0)


def jpeg_blockiness(g: np.ndarray) -> float:
    """>1 when luminance jumps concentrate on the 8x8 JPEG block grid."""
    ratios = []
    for axis in (0, 1):
        d = np.abs(np.diff(g, axis=axis))
        n = d.shape[axis]
        if n < 32:
            continue
        idx = np.arange(n)
        on_grid = (idx % 8) == 7
        # Ignore strong text edges, which are not related to blocking.
        mask = d < 40
        d_on = np.take(d, idx[on_grid], axis=axis)
        d_off = np.take(d, idx[~on_grid], axis=axis)
        m_on = np.take(mask, idx[on_grid], axis=axis)
        m_off = np.take(mask, idx[~on_grid], axis=axis)
        on = float(d_on[m_on].mean()) if m_on.any() else 0.0
        off = float(d_off[m_off].mean()) if m_off.any() else 0.0
        ratios.append((on + 0.05) / (off + 0.05))
    return float(np.mean(ratios)) if ratios else 1.0


def contrast_and_ink(g: np.ndarray) -> tuple[float, float]:
    lo, hi = np.percentile(g, [1, 99])
    contrast = float(hi - lo) / 255.0
    ink_ratio = float((g < (lo + hi) / 2).mean()) if hi - lo > 10 else 0.0
    return contrast, ink_ratio


def image_features(img: Image.Image) -> Dict[str, float]:
    g = _to_gray(img)
    contrast, ink = contrast_and_ink(g)
    return {
        "blur": crete_blur(g),
        "noise": noise_sigma(g),
        "blockiness": jpeg_blockiness(g),
        "contrast": contrast,
        "ink_ratio": ink,
    }


# --------------------------------------------------------------------------- #
# Text (OCR markdown) features
# --------------------------------------------------------------------------- #
_CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯]")
_WORD = re.compile(
    r"""^(
        [A-Za-z]+(['’-][A-Za-z]+)*        # words, hyphenated words, contractions
      | [$€£¥]?\d{1,3}(,\d{3})+(\.\d+)?%? # 1,234.5
      | [$€£¥]?\d+(\.\d+)?%?              # 12 / 3.5% / $40
      | \d+(st|nd|rd|th|s)                # 1st / 1990s
      | [IVXLCM]+                         # roman numerals
    )$""",
    re.VERBOSE,
)
_VOWEL = re.compile(r"[aeiouyAEIOUY]")
_MD_NOISE = [
    re.compile(r"!\[[^\]]*\]\([^)]*\)"),     # image links
    re.compile(r"<[^>]+>"),                  # html tags (MinerU tables)
    re.compile(r"\$\$?[^$\n]*[\\^_{}][^$\n]*\$\$?"),  # latex (not dollar amounts)
    re.compile(r"^\s*#+\s*", re.MULTILINE),  # headings
    re.compile(r"[|*_`>#]+"),                # md syntax
]


def _strip_markdown(md: str) -> str:
    for pat in _MD_NOISE:
        md = pat.sub(" ", md)
    return md


def text_features(markdown: str) -> Dict[str, float]:
    """Lexicon-free indicators of OCR corruption."""
    has_figures = bool(re.search(r"!\[[^\]]*\]\([^)]*\)", markdown or ""))
    text = _strip_markdown(markdown or "")
    tokens = [t.strip(".,;:!?()[]{}\"'“”‘’") for t in text.split()]
    tokens = [t for t in tokens if t]
    n_chars = sum(len(t) for t in tokens)
    if not tokens:
        return {"n_tokens": 0, "n_chars": 0, "wordlike": 0.0, "bad_char": 0.0,
                "short_frag": 0.0, "has_figures": float(has_figures)}

    wordlike = 0
    short_frag = 0
    for t in tokens:
        if _CJK.search(t):
            wordlike += 1
        elif _WORD.match(t) and (len(t) <= 3 or not t.isalpha() or _VOWEL.search(t)):
            # Long all-consonant strings ("rnnlh") are typical OCR garbage.
            wordlike += 1 if len(t) <= 25 else 0
        if len(t) == 1 and t.isalpha() and t not in "aAI":
            short_frag += 1

    printable = sum(
        1 for ch in "".join(tokens)
        if ch.isalnum() or ch in "$€£¥%&+-=/.,:;'’\"()[]" or _CJK.match(ch)
    )
    return {
        "n_tokens": len(tokens),
        "n_chars": n_chars,
        "wordlike": wordlike / len(tokens),
        "bad_char": 1.0 - printable / max(1, n_chars),
        "short_frag": short_frag / len(tokens),
        "has_figures": float(has_figures),
    }


def mineru_span_confidence(middle_json_path: Path) -> Optional[float]:
    """Length-weighted mean OCR score of MinerU text spans, if the parser stored them."""
    try:
        data = json.loads(Path(middle_json_path).read_text(encoding="utf-8"))
    except Exception:
        return None
    total, weight = 0.0, 0.0

    def visit(node):
        nonlocal total, weight
        if isinstance(node, dict):
            if "score" in node and isinstance(node.get("content"), str) and node.get("type", "text") == "text":
                try:
                    s = float(node["score"])
                except (TypeError, ValueError):
                    s = None
                if s is not None and 0.0 <= s <= 1.0:
                    w = max(1, len(node["content"]))
                    total += s * w
                    weight += w
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(data)
    return total / weight if weight > 0 else None


# --------------------------------------------------------------------------- #
# Heuristic reliability mapping
# --------------------------------------------------------------------------- #
def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, x))))


@dataclass
class QualityThresholds:
    """Midpoints/scales of the logistic maps (feature value -> reliability).

    Defaults were set on synthetic 200-DPI pages (see tests/ and README) and can be
    re-fitted on your own data with `scripts/calibrate_cdc.py`.
    """

    blur_mid: float = 0.38
    blur_scale: float = 0.04
    noise_mid: float = 10.0
    noise_scale: float = 2.0
    block_mid: float = 1.20
    block_scale: float = 0.04
    contrast_mid: float = 0.45
    contrast_scale: float = 0.06
    wordlike_mid: float = 0.70
    wordlike_scale: float = 0.06
    mineru_mid: float = 0.80
    mineru_scale: float = 0.05

    @classmethod
    def load(cls, path: Optional[str]) -> "QualityThresholds":
        if not path:
            return cls()
        data = json.loads(Path(path).read_text())
        data = data.get("thresholds", data)
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def image_reliability(feats: Dict[str, float], th: QualityThresholds) -> Dict[str, float]:
    """Per-factor reliabilities in [0, 1] (1 = no sign of that degradation)."""
    return {
        "blur": 1 - _sigmoid((feats["blur"] - th.blur_mid) / th.blur_scale),
        "noise": 1 - _sigmoid((feats["noise"] - th.noise_mid) / th.noise_scale),
        "jpeg": 1 - _sigmoid((feats["blockiness"] - th.block_mid) / th.block_scale),
        "fade": _sigmoid((feats["contrast"] - th.contrast_mid) / th.contrast_scale),
    }


def text_reliability(
    tfeats: Dict[str, float],
    th: QualityThresholds,
    mineru_conf: Optional[float] = None,
    ink_ratio: Optional[float] = None,
) -> Optional[float]:
    """Reliability of the OCR text of one page; None when there is nothing to judge."""
    if tfeats["n_tokens"] == 0:
        # Page has visible content but OCR produced nothing (and it's not a figure page).
        if ink_ratio is not None and ink_ratio > 0.02 and not tfeats["has_figures"]:
            return 0.2
        return None
    if tfeats["n_tokens"] < 8:
        return None  # too little text for the statistics to mean anything
    q = 1 - _sigmoid((th.wordlike_mid - tfeats["wordlike"]) / th.wordlike_scale)
    q *= 1 - min(1.0, 3 * tfeats["bad_char"])
    if mineru_conf is not None:
        q = 0.5 * q + 0.5 * _sigmoid((mineru_conf - th.mineru_mid) / th.mineru_scale)
    return float(max(0.0, min(1.0, q)))


# --------------------------------------------------------------------------- #
# Optional learned degradation classifier (multinomial logistic regression)
# --------------------------------------------------------------------------- #
CLASSIFIER_FEATURES = ("blur", "noise", "blockiness", "contrast")


def _feature_vector(feats: Dict[str, float]) -> np.ndarray:
    return np.array(
        [feats["blur"], math.log1p(feats["noise"]), feats["blockiness"], feats["contrast"]],
        dtype=np.float64,
    )


@dataclass
class DegradationClassifier:
    classes: List[str]
    mean: List[float]
    std: List[float]
    weights: List[List[float]]  # (n_features + 1) x n_classes
    train_accuracy: float = 0.0
    confusion: Dict[str, Dict[str, int]] = field(default_factory=dict)

    def predict_proba(self, feats: Dict[str, float]) -> Dict[str, float]:
        x = (_feature_vector(feats) - np.array(self.mean)) / np.array(self.std)
        x = np.append(x, 1.0)
        z = x @ np.array(self.weights)
        z = z - z.max()
        p = np.exp(z) / np.exp(z).sum()
        return {c: float(v) for c, v in zip(self.classes, p)}

    def save(self, path: str) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: Optional[str]) -> Optional["DegradationClassifier"]:
        if not path or not Path(path).exists():
            return None
        data = json.loads(Path(path).read_text())
        data = data.get("classifier", data)
        if not isinstance(data, dict) or "weights" not in data:
            return None
        return cls(**data)


def fit_degradation_classifier(
    feature_rows: Iterable[Dict[str, float]],
    labels: Iterable[str],
    l2: float = 1e-2,
    lr: float = 0.5,
    epochs: int = 3000,
) -> DegradationClassifier:
    """Fit softmax regression with full-batch gradient descent (numpy only)."""
    rows = list(feature_rows)
    labels = list(labels)
    classes = sorted(set(labels), key=lambda c: (c != "clean", c))
    X = np.stack([_feature_vector(r) for r in rows])
    mean, std = X.mean(0), X.std(0) + 1e-6
    X = np.hstack([(X - mean) / std, np.ones((len(X), 1))])
    y = np.array([classes.index(l) for l in labels])
    Y = np.eye(len(classes))[y]
    W = np.zeros((X.shape[1], len(classes)))
    for _ in range(epochs):
        z = X @ W
        z -= z.max(1, keepdims=True)
        p = np.exp(z)
        p /= p.sum(1, keepdims=True)
        grad = X.T @ (p - Y) / len(X) + l2 * W
        W -= lr * grad
    pred = (X @ W).argmax(1)
    confusion: Dict[str, Dict[str, int]] = {c: {d: 0 for d in classes} for c in classes}
    for t, p_ in zip(y, pred):
        confusion[classes[t]][classes[p_]] += 1
    return DegradationClassifier(
        classes=classes,
        mean=mean.tolist(),
        std=std.tolist(),
        weights=W.tolist(),
        train_accuracy=float((pred == y).mean()),
        confusion=confusion,
    )


# --------------------------------------------------------------------------- #
# Public API: assess one image
# --------------------------------------------------------------------------- #
@dataclass
class ImageAssessment:
    reliability: float          # in [0, 1]
    degradation: str            # "clean" or the dominant degradation type
    factors: Dict[str, float]   # per-degradation reliabilities (or class probabilities)
    features: Dict[str, float]


def assess_features(
    feats: Dict[str, float],
    th: QualityThresholds,
    classifier: Optional[DegradationClassifier] = None,
) -> ImageAssessment:
    if classifier is not None:
        proba = classifier.predict_proba(feats)
        degradation = max(proba, key=proba.get)
        reliability = proba.get("clean", 0.0)
        return ImageAssessment(reliability, degradation, proba, feats)

    factors = image_reliability(feats, th)
    # Blank or near-blank pages carry no evidence to corrupt.
    if feats["ink_ratio"] < 0.002:
        return ImageAssessment(1.0, "clean", factors, feats)
    reliability = float(np.prod(list(factors.values())))
    worst = min(factors, key=factors.get)
    degradation = worst if factors[worst] < 0.5 else "clean"
    return ImageAssessment(reliability, degradation, factors, feats)


def assess_image(
    img: Image.Image,
    th: QualityThresholds,
    classifier: Optional[DegradationClassifier] = None,
) -> ImageAssessment:
    return assess_features(image_features(img), th, classifier)
