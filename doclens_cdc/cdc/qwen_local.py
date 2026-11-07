"""
Run DocLens with Qwen3-VL-8B-Instruct served locally by vLLM (OpenAI-compatible API), e.g. on
Kaggle's 2x T4. The paper evaluates this backbone in Appendix C, Table 9.

DocLens already has a Qwen path (`call_qwen_with_retry_async`, written for a hosted endpoint).
This module replaces it with a call that fits a local, memory-limited server:
  * images are halved first, exactly as DocLens' Qwen path does;
  * if a prompt exceeds the server's context, images are halved again and the request retried
    (Appendix D.1: "we reduce the resolution by half and retry");
  * prompts with more images than the server accepts tile consecutive images 2x2;
  * the Page Navigator splits long documents into chunks of pages and merges the located pages
    (Sec. 3.1 / Appendix D.1, which uses 50-page chunks for Claude);
  * the answer-extraction step of the evaluation, which DocLens runs on Gemini-2.5-Flash, runs on
    the same local Qwen instead (no external quota).
"""

from __future__ import annotations

import asyncio
import base64
import io
import re
from typing import Any, Dict, List, Optional

from PIL import Image

SERVED_MODEL = "Qwen/Qwen3-VL-8B-Instruct"

_state: Dict[str, Any] = {"client": None, "max_tokens": 4096, "max_images": 64}


def _is_context_error(msg: str) -> bool:
    m = msg.lower()
    return ("maximum" in m and ("context" in m or "length" in m)) or "too long" in m or "longer than" in m


def _decode(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _encode(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _tile(b64s: List[str]) -> str:
    """Tile up to 4 images 2x2 into one image of the size of a single input image."""
    imgs = [_decode(b) for b in b64s]
    w = max(i.width for i in imgs) // 2
    h = max(i.height for i in imgs) // 2
    canvas = Image.new("RGB", (2 * w, 2 * h), "white")
    for k, img in enumerate(imgs):
        img = img.copy()
        img.thumbnail((w, h))
        canvas.paste(img, ((k % 2) * w, (k // 2) * h))
    return _encode(canvas)


def tile_images(contents: List[dict], max_images: int) -> List[dict]:
    """Keep the prompt under the server's per-request image limit by tiling consecutive images."""
    idx = [i for i, c in enumerate(contents) if c.get("type") == "image"]
    if len(idx) <= max_images:
        return contents
    group = 4
    keep, drop = {}, set()
    for g in range(0, len(idx), group):
        members = idx[g : g + group]
        keep[members[0]] = _tile([contents[i]["source"]["data"] for i in members])
        drop.update(members[1:])
    out = []
    for i, c in enumerate(contents):
        if i in drop:
            continue
        if i in keep:
            c = {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": keep[i]}}
        out.append(c)
    return tile_images(out, max_images)


def _to_openai_parts(contents: List[dict]) -> List[dict]:
    parts = []
    for item in contents:
        if item.get("type") == "text":
            parts.append({"type": "text", "text": item["text"]})
        elif item.get("type") == "image":
            src = item["source"]
            parts.append({"type": "image_url",
                          "image_url": {"url": f"data:{src.get('media_type', 'image/jpeg')};base64,{src['data']}"}})
    return parts


async def call_qwen(model_name, contents, config, max_attempts=6, retry_delay=10, error_context=""):
    """Drop-in replacement for DocLens' call_qwen_with_retry_async: returns (texts, total_tokens)."""
    from utils import generation_utils

    client = _state["client"]
    n = config["candidate_num"]
    current = await generation_utils.resize_contents_images(contents, scale_factor=0.5)  # as DocLens
    current = tile_images(current, _state["max_images"])
    texts: List[str] = []
    tokens = 0
    for attempt in range(max_attempts):
        try:
            resp = await client.chat.completions.create(
                model=SERVED_MODEL,
                messages=[{"role": "system", "content": config["system_prompt"]},
                          {"role": "user", "content": _to_openai_parts(current)}],
                max_tokens=min(int(config["max_output_tokens"]), _state["max_tokens"]),
                temperature=config["temperature"],
                n=n - len(texts),
            )
            texts += [c.message.content for c in resp.choices if (c.message.content or "").strip()]
            tokens += resp.usage.total_tokens if resp.usage else 0
            if len(texts) >= n:
                return texts[:n], tokens
        except Exception as e:
            msg = str(e)
            print(f"Qwen attempt {attempt + 1} failed{(' for ' + error_context) if error_context else ''}: {msg[:300]}")
            if _is_context_error(msg):
                current = await generation_utils.resize_contents_images(current, scale_factor=0.5)
                continue
            await asyncio.sleep(retry_delay)
    return texts + ["Error"] * (n - len(texts)), tokens


async def eval_with_qwen(model_name, contents, config, *args, **kwargs):
    """DocLens' evaluation calls Gemini for answer extraction; answer it with the local Qwen."""
    system = config.system_instruction or ""
    texts, tokens = await call_qwen(SERVED_MODEL, contents, {
        "system_prompt": system, "temperature": 0, "candidate_num": 1, "max_output_tokens": 1024,
    })
    text = texts[0]
    # MMLongBench-Doc's extractor parses "Extracted answer: ... Answer format: ..."; keep that shape.
    if "Extracted answer:" in system and text != "Error" and "Extracted answer:" not in text:
        text = f"Extracted answer: {text.strip()}\nAnswer format: String"
    return [text], tokens


def chunked_navigator(chunk_pages: int):
    """PageNavigator.process that splits documents longer than `chunk_pages` pages."""
    from utils import generation_utils

    async def process(self, data):
        question = data.get("preprocessed_question", data.get("question", ""))
        user = {"type": "text", "text": f"\n\n**Question**: {question}\n\n**Your Output**:"}
        content = await generation_utils.get_doc_content_list_async(
            data=data, input_pages="all", input_mode=self.exp_config.phase1_input_mode,
            exp_config=self.exp_config,
        )
        pages: List[List[dict]] = []
        for part in content:
            if part.get("type") == "text" and part["text"].startswith("---- Screenshot of page"):
                pages.append([part])
            elif pages:
                pages[-1].append(part)
        chunks = [pages[i : i + chunk_pages] for i in range(0, len(pages), chunk_pages)] or [[]]
        k = self.exp_config.phase1_candidate_num
        results = await asyncio.gather(*[
            self.call_llm_with_retry_async(
                content_list=[p for pg in ch for p in pg] + [user], system_prompt=self.system_prompt,
                temperature=self.exp_config.temperature, candidate_num=k)
            for ch in chunks
        ])
        total = 0
        located = [set() for _ in range(k)]
        for c, (texts, tok) in enumerate(results):
            total += tok
            for i in range(k):
                parsed = self._parse_response(texts[i], ["analysis", "located_pages", "prediction"], f"pgnav_cand{i + 1}")
                located[i].update(int(x) for x in re.findall(r"\d+", parsed[f"pgnav_cand{i + 1}_located_pages"]))
                if c == 0:  # like DocLens' _merge_chunk_results: keep the first chunk's analysis/prediction
                    data.update(parsed)
        for i in range(k):
            data[f"pgnav_cand{i + 1}_located_pages"] = str(sorted(located[i]))
        data = self.union_located_pages(data)
        return data, total

    return process


def configure_qwen(base_url: str, max_tokens: int = 4096, max_images: int = 64, nav_chunk_pages: int = 30,
                   timeout: float = 0):
    import openai
    from agents import page_navigator_agent
    from utils import eval_toolkits, generation_utils

    _state["client"] = openai.AsyncOpenAI(base_url=base_url, api_key="EMPTY", max_retries=0,
                                             timeout=timeout or None)  # 0: no client timeout (time in the server queue counts)
    _state["max_tokens"] = max_tokens
    _state["max_images"] = max_images
    generation_utils.call_qwen_with_retry_async = call_qwen
    eval_toolkits.call_gemini_with_retry_async = eval_with_qwen
    if nav_chunk_pages and nav_chunk_pages > 0:
        page_navigator_agent.PageNavigator.process = chunked_navigator(nav_chunk_pages)
    return _state["client"]
