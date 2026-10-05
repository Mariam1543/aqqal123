"""
Synthetic 200-DPI document pages, used for unit tests and as a no-data sanity
check of the quality scorer. Real experiments use real benchmark pages.
"""

from __future__ import annotations

import random

from PIL import Image, ImageDraw, ImageFont

_WORDS = (
    "the revenue increased significantly during fiscal year compared with previous "
    "quarter operating margin improved because of lower costs while international "
    "sales grew strongly in emerging markets and the board approved a dividend of "
    "per share total assets liabilities equity cash flow statement analysis report "
    "figure table shows percentage respondents survey population growth rate index"
).split()


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans.ttf", "Arial.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def make_page(seed: int = 0, width: int = 1700, height: int = 2200) -> Image.Image:
    """A page with a title, paragraphs, a numeric table and a bar chart."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    title, body, small = _font(56), _font(30), _font(26)
    y = 120
    d.text((150, y), f"Annual Report {2010 + seed % 15}", fill="black", font=title)
    y += 120
    for _ in range(4):
        for _ in range(rnd.randint(4, 7)):
            line = " ".join(rnd.choice(_WORDS) for _ in range(rnd.randint(9, 12)))
            d.text((150, y), line.capitalize(), fill=(20, 20, 20), font=body)
            y += 44
        y += 30
    # table
    x0, y0 = 150, y + 10
    for r in range(6):
        for c in range(4):
            x = x0 + c * 340
            d.rectangle([x, y0 + r * 50, x + 340, y0 + (r + 1) * 50], outline="black", width=2)
            txt = f"Item {r}" if c == 0 else f"{rnd.randint(10, 9999):,}.{rnd.randint(0, 9)}"
            d.text((x + 15, y0 + r * 50 + 10), txt, fill="black", font=small)
    # bar chart
    by = y0 + 6 * 50 + 80
    for i in range(8):
        h = rnd.randint(60, 380)
        bx = 200 + i * 160
        d.rectangle([bx, by + 400 - h, bx + 100, by + 400], fill=(40, 90, 160))
        d.text((bx + 10, by + 410), f"{rnd.randint(1, 99)}%", fill="black", font=small)
    return img


def corrupt_text(text: str, rate: float, seed: int = 0) -> str:
    """Simulate OCR character confusions, used to test the text scorer."""
    rnd = random.Random(seed)
    confusions = {"l": "1", "o": "0", "e": "c", "m": "rn", "i": "!", "s": "$", "a": "@", "t": "+"}
    out = []
    for ch in text:
        r = rnd.random()
        if r < rate * 0.6 and ch.lower() in confusions:
            out.append(confusions[ch.lower()])
        elif r < rate * 0.8 and ch.isalpha():
            out.append(rnd.choice("~^|\\{}#"))
        elif r < rate and ch == " ":
            continue
        else:
            out.append(ch)
    return "".join(out)
