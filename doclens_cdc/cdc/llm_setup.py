"""
Run DocLens with a Gemini API key (Google AI Studio) instead of Vertex AI.

DocLens creates its Gemini client lazily from a module-level global in
`utils.generation_utils`; we inject a key-based client there, so no upstream
file has to be edited. We also add an optional requests-per-minute limiter
(important for free/low-tier keys) and allow overriding the model DocLens
hard-codes for answer extraction / judging during evaluation.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional


def get_secret(name: str) -> Optional[str]:
    """Environment variable first, then Kaggle's secret store."""
    value = os.environ.get(name)
    if value:
        return value
    try:
        from kaggle_secrets import UserSecretsClient  # type: ignore

        return UserSecretsClient().get_secret(name)
    except Exception:
        return None


class RateLimiter:
    """Spaces out requests to at most `rpm` per minute across all coroutines."""

    def __init__(self, rpm: float):
        self.interval = 60.0 / rpm
        self._next = 0.0
        self._lock: Optional[asyncio.Lock] = None

    async def wait(self) -> None:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            now = time.monotonic()
            if self._next > now:
                await asyncio.sleep(self._next - now)
            self._next = max(now, self._next) + self.interval


def configure_gemini(
    api_key: Optional[str] = None,
    rpm: float = 0,
    eval_model: Optional[str] = None,
    vertex_project: Optional[str] = None,
    vertex_location: str = "us-east1",
):
    """Install the Gemini client DocLens will use: an API key, or Vertex AI (DocLens' original setup)."""
    from google import genai
    from utils import eval_toolkits, generation_utils

    if vertex_project:
        client = genai.Client(vertexai=True, project=vertex_project, location=vertex_location)
    else:
        client = genai.Client(api_key=api_key)
    if rpm and rpm > 0:
        limiter = RateLimiter(rpm)
        original = client.aio.models.generate_content

        async def limited_generate_content(*args, **kwargs):
            await limiter.wait()
            return await original(*args, **kwargs)

        client.aio.models.generate_content = limited_generate_content
    generation_utils.gemini_client = client

    if eval_model:
        original_call = eval_toolkits.call_gemini_with_retry_async

        async def call_with_eval_model(model_name, *args, **kwargs):
            return await original_call(eval_model, *args, **kwargs)

        eval_toolkits.call_gemini_with_retry_async = call_with_eval_model
    return client
