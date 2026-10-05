"""
Synthetic document degradations used to build degraded copies of a benchmark.

Every degradation is deterministic given (image, kind, severity, seed) so that
experiments are reproducible across Kaggle sessions.

Severity levels are calibrated for page images rendered at 200 DPI, which is
what DocLens' `pdf_to_images.py` produces.
"""

from __future__ import annotations

import io
import zlib
from typing import Callable, Dict

import numpy as np
from PIL import Image, ImageFilter

# kind -> severity (1..3) -> parameter
BLUR_SIGMA = {1: 1.0, 2: 1.8, 3: 2.6}
NOISE_STD = {1: 12.0, 2: 25.0, 3: 40.0}
JPEG_QUALITY = {1: 30, 2: 15, 3: 7}
LOWRES_SCALE = {1: 0.5, 2: 0.35, 3: 0.25}
CONTRAST_KEEP = {1: 0.6, 2: 0.4, 3: 0.25}

DEGRADATION_KINDS = ("blur", "noise", "jpeg", "lowres", "fade", "mixed")


def _rng(seed: int, salt: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(f"{seed}:{salt}".encode()))


def gaussian_blur(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA[severity]))


def gaussian_noise(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    noise = _rng(seed, "noise").normal(0.0, NOISE_STD[severity], size=arr.shape[:2])
    # Scanner noise is mostly luminance noise, so add the same value to all channels.
    arr = arr + noise[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def jpeg_compression(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=JPEG_QUALITY[severity])
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def low_resolution(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    w, h = img.size
    s = LOWRES_SCALE[severity]
    small = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.BILINEAR)
    return small.resize((w, h), Image.Resampling.BILINEAR)


def fade(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    """Low-contrast, washed-out print (toner running out / over-exposed scan)."""
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    keep = CONTRAST_KEEP[severity]
    arr = 255.0 - (255.0 - arr) * keep
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def mixed(img: Image.Image, severity: int, seed: int = 0) -> Image.Image:
    """A realistic scan/fax chain: slight blur -> sensor noise -> lossy compression."""
    lighter = max(1, severity - 1)
    out = gaussian_blur(img, lighter, seed)
    out = gaussian_noise(out, lighter, seed)
    return jpeg_compression(out, severity, seed)


DEGRADATIONS: Dict[str, Callable[[Image.Image, int, int], Image.Image]] = {
    "blur": gaussian_blur,
    "noise": gaussian_noise,
    "jpeg": jpeg_compression,
    "lowres": low_resolution,
    "fade": fade,
    "mixed": mixed,
}


def degrade(img: Image.Image, kind: str, severity: int, seed: int = 0) -> Image.Image:
    """Apply one degradation. `kind == "clean"` returns an RGB copy."""
    img = img.convert("RGB")
    if kind == "clean":
        return img.copy()
    if kind not in DEGRADATIONS:
        raise ValueError(f"Unknown degradation '{kind}'. Use one of {DEGRADATION_KINDS}.")
    if severity not in (1, 2, 3):
        raise ValueError("severity must be 1, 2 or 3")
    return DEGRADATIONS[kind](img, severity, seed)


def variant_name(kind: str, severity: int) -> str:
    return "clean" if kind == "clean" else f"{kind}_s{severity}"


def parse_variant(name: str) -> tuple[str, int]:
    if name == "clean":
        return "clean", 0
    kind, sev = name.rsplit("_s", 1)
    return kind, int(sev)
