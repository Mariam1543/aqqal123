"""
Access to the evidence DocLens' Lens Module localizes for a question.

The on-disk layout is the one produced by DocLens' preprocessing:

    <work_dir>/data/<dataset>/documents/<doc_stem>/<page>.jpeg
    <work_dir>/data/<dataset>/documents/<doc_stem>/MinerU_Page<page>/<page>.md
    <work_dir>/data/<dataset>/documents/<doc_stem>/MinerU_Page<page>/<page>_middle.json
    <work_dir>/data/<dataset>/documents/<doc_stem>/MinerU_Page<page>/images/*.jpg

`render_content` reproduces the exact content-list format of DocLens'
`generation_utils.get_doc_content_list_async`, with optional per-page
corrections spliced in.
"""

from __future__ import annotations

import base64
from ast import literal_eval
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class PageEvidence:
    page: int
    image_path: Path
    markdown_path: Path
    middle_json_path: Path
    crop_paths: List[Path] = field(default_factory=list)

    @property
    def markdown(self) -> str:
        try:
            return self.markdown_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""


@dataclass
class PageCorrection:
    """What the Reasoning Module receives for an unreliable page."""

    note: str
    restored_image_b64: Optional[str] = None
    restored_crops_b64: Dict[str, str] = field(default_factory=dict)  # crop file name -> b64
    replace_original: bool = False  # show only the restored screenshot instead of both


def doc_image_dir(work_dir: Path, dataset_name: str, doc_id: str) -> Path:
    doc_file_path = Path(work_dir) / "data" / dataset_name / "documents" / doc_id
    return doc_file_path.parent / doc_file_path.stem


def all_pages(image_dir: Path) -> List[int]:
    return sorted(int(p.stem) for p in image_dir.glob("*.jpeg") if p.stem.isdigit())


def resolve_target_pages(data: dict, input_pages: str, image_dir: Path) -> List[int]:
    """Same semantics as DocLens: unparsable or empty page lists fall back to all pages."""
    pages = all_pages(image_dir)
    if input_pages == "all":
        return pages
    try:
        target = literal_eval(str(data.get(input_pages, "[]")))
        target = [p for p in target if p in pages]
    except Exception:
        target = []
    return target or pages


def load_page(image_dir: Path, page: int) -> PageEvidence:
    mineru_dir = image_dir / f"MinerU_Page{page}"
    crops = sorted((mineru_dir / "images").glob("*.jpg")) if (mineru_dir / "images").exists() else []
    return PageEvidence(
        page=page,
        image_path=image_dir / f"{page}.jpeg",
        markdown_path=mineru_dir / f"{page}.md",
        middle_json_path=mineru_dir / f"{page}_middle.json",
        crop_paths=crops,
    )


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def _image(b64: str) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}}


def _text(text: str) -> dict:
    return {"type": "text", "text": text}


def render_content(
    pages: List[PageEvidence],
    input_mode: str,
    corrections: Optional[Dict[int, PageCorrection]] = None,
) -> List[dict]:
    corrections = corrections or {}
    content: List[dict] = []
    for pe in pages:
        corr = corrections.get(pe.page)
        restored = corr.restored_image_b64 if corr is not None else None
        if restored and corr.replace_original:
            content.append(_text(f"---- Screenshot of page {pe.page} (restored) ----\n"))
            content.append(_image(restored))
        else:
            content.append(_text(f"---- Screenshot of page {pe.page} ----\n"))
            content.append(_image(_b64(pe.image_path)))
        if restored and not corr.replace_original:
            content.append(_text(f"---- Restored screenshot of page {pe.page} (enhanced copy of the image above) ----\n"))
            content.append(_image(corr.restored_image_b64))

        if input_mode == "use_ocr":
            content.append(_text(f"---- OCR of page {pe.page} ----\n"))
        elif input_mode == "use_element_localizer":
            content.append(_text(f"---- Markdown of page {pe.page} ----\n"))
        elif input_mode == "vanilla":
            continue
        else:
            raise ValueError(f"Invalid input mode: {input_mode}")
        markdown = pe.markdown
        if corr is not None:
            markdown = f"[EVIDENCE RELIABILITY NOTE] {corr.note}\n\n{markdown}"
        content.append(_text(markdown))

        if input_mode == "use_element_localizer":
            content.append(_text("---- Zoomed-in Figures and Charts of this page ----\n"))
            for crop in pe.crop_paths:
                restored = corr.restored_crops_b64.get(crop.name) if corr else None
                content.append(_image(restored or _b64(crop)))
    return content
