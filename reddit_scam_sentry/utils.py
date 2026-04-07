import asyncio
import logging

logger = logging.getLogger("sentry.utils")


async def exponential_backoff(attempt: int, base: float = 2.0, cap: float = 300.0) -> None:
    delay = min(base ** attempt, cap)
    logger.info("Backoff: waiting %.0f seconds (attempt %d)…", delay, attempt)
    await asyncio.sleep(delay)


def truncate(text: str, max_len: int = 120) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + "…"
