"""
AI-powered scam classifier (Layer 2).

Uses OpenAI via the Replit AI Integrations proxy to analyse post/comment
content for scam intent, bot-like language, and suspicious patterns.

Requires the following environment variables (set automatically by the
Replit AI Integrations setup):
    AI_INTEGRATIONS_OPENAI_BASE_URL
    AI_INTEGRATIONS_OPENAI_API_KEY
"""

from __future__ import annotations

import json
import logging
import os
from typing import TypedDict

logger = logging.getLogger("sentry.ai_classifier")

_SYSTEM_PROMPT = """You are a scam and bot detection expert for Reddit.
Analyse the provided post or comment content and return a JSON object with exactly these fields:

{
  "scam_probability": <float 0.0–1.0>,
  "bot_probability": <float 0.0–1.0>,
  "action": <"remove" | "review" | "approve">,
  "summary": <short string, max 120 chars, describing why this is or is not suspicious>,
  "signals": <list of short strings describing specific suspicious indicators found>
}

Guidelines:
- scam_probability: likelihood (0–1) that this is a scam or fraudulent content
- bot_probability: likelihood (0–1) that this was posted by a bot or automated account
- action: "remove" if clearly harmful, "review" if uncertain, "approve" if clearly safe
- summary: concise human-readable explanation for moderators
- signals: empty list [] if nothing suspicious; otherwise list each red flag as a short phrase

Return ONLY valid JSON with no markdown fences or extra text."""


class AIResult(TypedDict):
    scam_probability: float
    bot_probability: float
    action: str
    summary: str
    signals: list[str]


def _make_client():
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY", "dummy")
    if not base_url:
        raise RuntimeError(
            "AI_INTEGRATIONS_OPENAI_BASE_URL is not set. "
            "Provision the OpenAI AI Integration via Replit first."
        )
    from openai import AsyncOpenAI
    return AsyncOpenAI(base_url=base_url, api_key=api_key)


async def classify(
    *,
    title: str = "",
    body: str = "",
    author_name: str = "",
) -> AIResult | None:
    """Call OpenAI to classify content for scam/bot risk.

    Returns an AIResult dict on success, or None if the call fails.
    Never raises — failures are logged and None is returned so the
    caller can fall back to rule-only scoring.
    """
    content_parts: list[str] = []
    if title:
        content_parts.append(f"Title: {title}")
    if body:
        content_parts.append(f"Body: {body[:3000]}")
    if author_name:
        content_parts.append(f"Author username: {author_name}")

    if not content_parts:
        return None

    content = "\n".join(content_parts)

    try:
        client = _make_client()
        response = await client.responses.create(
            model="gpt-5.2",
            instructions=_SYSTEM_PROMPT,
            input=content,
            max_output_tokens=512,
        )

        raw_text = response.output_text.strip()

        if raw_text.startswith("```"):
            lines = raw_text.splitlines()
            raw_text = "\n".join(
                line for line in lines
                if not line.startswith("```")
            ).strip()

        parsed = json.loads(raw_text)

        _VALID_ACTIONS = {"remove", "review", "approve"}

        raw_scam = float(parsed.get("scam_probability", 0.0))
        raw_bot = float(parsed.get("bot_probability", 0.0))
        raw_action = str(parsed.get("action", "review")).strip().lower()
        raw_signals = parsed.get("signals", [])

        result: AIResult = {
            "scam_probability": max(0.0, min(1.0, raw_scam)),
            "bot_probability": max(0.0, min(1.0, raw_bot)),
            "action": raw_action if raw_action in _VALID_ACTIONS else "review",
            "summary": str(parsed.get("summary", ""))[:120],
            "signals": [str(s) for s in raw_signals if s] if isinstance(raw_signals, list) else [],
        }
        return result

    except Exception as exc:
        logger.warning("AI classification failed: %s", exc)
        return None
