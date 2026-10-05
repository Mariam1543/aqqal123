"""
Degradation-specific evidence correction.

Applied ONLY to evidence the CDC stage scored as unreliable; reliable evidence
is passed through untouched (the abstention principle). Restoration filters are
deliberately simple and deterministic (median / unsharp / autocontrast), in the
spirit of PreP-OCR's restoration step, but gated instead of static.
"""

from __future__ import annotations

import base64
import io

from PIL import Image, ImageFilter, ImageOps

MAX_RESTORED_SIDE = 3000


def restore(img: Image.Image, degradation: str) -> Image.Image:
    img = img.convert("RGB")
    if degradation == "noise":
        out = img.filter(ImageFilter.MedianFilter(3))
        return ImageOps.autocontrast(out, cutoff=0.5)
    if degradation in ("blur", "lowres"):
        w, h = img.size
        scale = min(1.5, MAX_RESTORED_SIDE / max(w, h))
        if scale > 1.05:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        return img.filter(ImageFilter.UnsharpMask(radius=2, percent=160, threshold=2))
    if degradation in ("jpeg", "mixed"):
        out = img.filter(ImageFilter.MedianFilter(3))
        return out.filter(ImageFilter.UnsharpMask(radius=1.5, percent=80, threshold=2))
    if degradation == "fade":
        return ImageOps.autocontrast(img, cutoff=1)
    return ImageOps.autocontrast(img, cutoff=0.5)


def to_base64_jpeg(img: Image.Image, quality: int = 92) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("utf-8")
