"""
reddit_scam_sentry — main entry point.

Streams new submissions from configured subreddits, scores them for
scam/bot risk, stores decisions in SQLite, and optionally applies mod flair.
"""

import asyncio
import logging
import time

import aiosqlite
import asyncpraw

from reddit_scam_sentry import config
from reddit_scam_sentry.logging_setup import setup_logging
from reddit_scam_sentry.reddit_client import make_reddit
from reddit_scam_sentry.scorer import compute_score
from reddit_scam_sentry.actions import apply_flair
from reddit_scam_sentry.store import init_db, get_cached_author, set_cached_author, save_decision
from reddit_scam_sentry.utils import exponential_backoff, truncate
from reddit_scam_sentry.comment_handler import stream_comments
from reddit_scam_sentry import notifier

logger = logging.getLogger("sentry.main")


async def fetch_author_info(
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


async def process_submission(
    reddit: asyncpraw.Reddit,
    db: aiosqlite.Connection,
    submission: asyncpraw.models.Submission,
) -> None:
    author = submission.author
    if author is None:
        logger.debug("Skipping post %s — deleted author", submission.id)
        return

    author_info = await fetch_author_info(reddit, db, author.name)

    post_url = getattr(submission, "url", "") or ""

    score, reasons = compute_score(
        title=submission.title or "",
        body=getattr(submission, "selftext", "") or "",
        url=post_url,
        author_name=author.name,
        account_created_utc=author_info["created_utc"],
        link_karma=author_info["link_karma"],
        comment_karma=author_info["comment_karma"],
    )

    flagged = score >= config.RISK_THRESHOLD

    subreddit_name = submission.subreddit.display_name if submission.subreddit else "unknown"
    reasons_str = "; ".join(reasons) if reasons else "none"

    if flagged:
        logger.warning(
            "FLAGGED | r/%s | score=%d | post=%s | author=%s | %s | reasons=%s",
            subreddit_name,
            score,
            submission.id,
            author.name,
            truncate(submission.title),
            reasons_str,
        )
    else:
        logger.info(
            "OK      | r/%s | score=%d | post=%s | author=%s | %s | reasons=%s",
            subreddit_name,
            score,
            submission.id,
            author.name,
            truncate(submission.title),
            reasons_str,
        )

    await save_decision(
        db,
        post_id=submission.id,
        subreddit=subreddit_name,
        author=author.name,
        title=submission.title or "",
        score=score,
        reasons=reasons,
        flagged=flagged,
    )

    if flagged:
        await apply_flair(submission, score)
        await notifier.notify(submission, score, reasons)


async def stream_subreddit(
    reddit: asyncpraw.Reddit,
    db: aiosqlite.Connection,
    subreddit_name: str,
) -> None:
    attempt = 0
    while True:
        try:
            logger.info("Starting stream for r/%s …", subreddit_name)
            subreddit = await reddit.subreddit(subreddit_name)
            async for submission in subreddit.stream.submissions(skip_existing=True):
                attempt = 0
                try:
                    await process_submission(reddit, db, submission)
                except Exception as exc:
                    logger.error(
                        "Error processing post %s: %s", submission.id, exc, exc_info=True
                    )
        except asyncio.CancelledError:
            logger.info("Stream for r/%s cancelled.", subreddit_name)
            raise
        except Exception as exc:
            logger.error(
                "Stream for r/%s crashed (attempt %d): %s",
                subreddit_name,
                attempt,
                exc,
                exc_info=True,
            )
            await exponential_backoff(attempt)
            attempt += 1


async def main() -> None:
    setup_logging()
    logger.info("Starting Reddit Scam Sentry")
    logger.info(
        "Monitoring subreddits: %s | threshold=%d | action=%s | scan_comments=%s",
        ", ".join(config.SUBREDDITS),
        config.RISK_THRESHOLD,
        config.ACTION_MODE,
        config.SCAN_COMMENTS,
    )

    async with aiosqlite.connect(config.DB_PATH) as db:
        await init_db(db)

        reddit = make_reddit()
        try:
            tasks = [
                asyncio.create_task(stream_subreddit(reddit, db, sub))
                for sub in config.SUBREDDITS
            ]
            if config.SCAN_COMMENTS:
                tasks += [
                    asyncio.create_task(stream_comments(reddit, db, sub))
                    for sub in config.SUBREDDITS
                ]
            await asyncio.gather(*tasks)
        finally:
            await reddit.close()


if __name__ == "__main__":
    asyncio.run(main())
