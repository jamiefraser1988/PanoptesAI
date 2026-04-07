"""
Comment stream handler for Reddit Scam Sentry.

Mirrors stream_subreddit from main.py but operates on comment streams.
Uses the same scoring engine with title="" and url="" so only body text,
link patterns inside the comment, account age, and karma shape apply.
"""

import asyncio
import logging
import time

import aiosqlite
import asyncpraw

from reddit_scam_sentry import config, notifier
from reddit_scam_sentry.scorer import compute_score
from reddit_scam_sentry.store import (
    get_cached_author,
    set_cached_author,
    save_comment_decision,
)
from reddit_scam_sentry.utils import exponential_backoff, truncate

logger = logging.getLogger("sentry.comments")

_BODY_SNIPPET_LEN = 200


async def _fetch_author_info(
    reddit: asyncpraw.Reddit,
    db: aiosqlite.Connection,
    username: str,
) -> dict:
    cached = await get_cached_author(db, username)
    if cached is not None:
        return cached

    try:
        redditor = await reddit.redditor(username)
        await redditor.load()
        data = {
            "name": username,
            "link_karma": getattr(redditor, "link_karma", 0),
            "comment_karma": getattr(redditor, "comment_karma", 0),
            "created_utc": getattr(redditor, "created_utc", time.time()),
            "is_suspended": getattr(redditor, "is_suspended", False),
        }
    except Exception as exc:
        logger.warning("Could not fetch author '%s': %s", username, exc)
        data = {
            "name": username,
            "link_karma": 0,
            "comment_karma": 0,
            "created_utc": time.time(),
            "is_suspended": False,
        }

    await set_cached_author(db, username, data)
    return data


async def process_comment(
    reddit: asyncpraw.Reddit,
    db: aiosqlite.Connection,
    comment: asyncpraw.models.Comment,
) -> None:
    author = comment.author
    if author is None:
        logger.debug("Skipping comment %s — deleted author", comment.id)
        return

    author_info = await _fetch_author_info(reddit, db, author.name)

    body = getattr(comment, "body", "") or ""

    score, reasons = compute_score(
        title="",
        body=body,
        url="",
        author_name=author.name,
        account_created_utc=author_info["created_utc"],
        link_karma=author_info["link_karma"],
        comment_karma=author_info["comment_karma"],
    )

    flagged = score >= config.RISK_THRESHOLD

    subreddit_name = (
        comment.subreddit.display_name if comment.subreddit else "unknown"
    )
    post_id = getattr(comment, "link_id", "") or ""
    if post_id.startswith("t3_"):
        post_id = post_id[3:]

    body_snippet = truncate(body, max_len=_BODY_SNIPPET_LEN)
    reasons_str = "; ".join(reasons) if reasons else "none"

    if flagged:
        logger.warning(
            "FLAGGED | r/%s | score=%d | comment=%s | author=%s | body=%s | reasons=%s",
            subreddit_name,
            score,
            comment.id,
            author.name,
            body_snippet,
            reasons_str,
        )
    else:
        logger.info(
            "OK      | r/%s | score=%d | comment=%s | author=%s | body=%s | reasons=%s",
            subreddit_name,
            score,
            comment.id,
            author.name,
            body_snippet,
            reasons_str,
        )

    await save_comment_decision(
        db,
        comment_id=comment.id,
        post_id=post_id,
        subreddit=subreddit_name,
        author=author.name,
        body_snippet=body_snippet,
        score=score,
        reasons=reasons,
        flagged=flagged,
    )

    if flagged:
        await notifier.notify_comment(comment, score, reasons)


async def stream_comments(
    reddit: asyncpraw.Reddit,
    db: aiosqlite.Connection,
    subreddit_name: str,
) -> None:
    attempt = 0
    while True:
        try:
            logger.info("Starting comment stream for r/%s …", subreddit_name)
            subreddit = await reddit.subreddit(subreddit_name)
            async for comment in subreddit.stream.comments(skip_existing=True):
                attempt = 0
                try:
                    await process_comment(reddit, db, comment)
                except Exception as exc:
                    logger.error(
                        "Error processing comment %s: %s",
                        comment.id,
                        exc,
                        exc_info=True,
                    )
        except asyncio.CancelledError:
            logger.info("Comment stream for r/%s cancelled.", subreddit_name)
            raise
        except Exception as exc:
            logger.error(
                "Comment stream for r/%s crashed (attempt %d): %s",
                subreddit_name,
                attempt,
                exc,
                exc_info=True,
            )
            await exponential_backoff(attempt)
            attempt += 1
