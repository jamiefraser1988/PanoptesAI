"""
Author recent-history signal for Reddit Scam Sentry.

Fetches the author's last N posts/comments via asyncpraw and detects
cross-subreddit copy-paste behaviour (same or very similar text posted
across multiple subreddits in a short window).

Public API
----------
fetch_recent_posts(reddit, username, limit) -> list[dict]
    Returns a list of lightweight post/comment dicts for the author.
    Falls back to an empty list on any API error.

score_history(recent_posts, current_subreddit, current_title) -> (int, str | None)
    Returns (points, reason) if cross-subreddit reposting is detected,
    otherwise (0, None).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import asyncpraw

logger = logging.getLogger("sentry.history")

_RECENCY_WINDOW_DAYS: float = 7.0
_MIN_TEXT_LENGTH: int = 20
_MIN_CROSS_SUB_HITS: int = 2
_POINTS: int = 25


async def fetch_recent_posts(
    reddit: asyncpraw.Reddit,
    username: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch the author's last ``limit`` submissions and comments.

    Returns a list of dicts with keys: ``kind``, ``subreddit``, ``title``,
    ``body``, ``created_utc``.  Returns an empty list on any API error so the
    caller can always treat the result as a plain list.
    """
    results: list[dict[str, Any]] = []
    try:
        redditor = await reddit.redditor(username)
        async for submission in redditor.submissions.new(limit=limit):
            results.append(
                {
                    "kind": "post",
                    "subreddit": getattr(submission.subreddit, "display_name", "unknown"),
                    "title": getattr(submission, "title", "") or "",
                    "body": getattr(submission, "selftext", "") or "",
                    "created_utc": getattr(submission, "created_utc", 0.0),
                }
            )
        async for comment in redditor.comments.new(limit=limit):
            results.append(
                {
                    "kind": "comment",
                    "subreddit": getattr(comment.subreddit, "display_name", "unknown"),
                    "title": "",
                    "body": getattr(comment, "body", "") or "",
                    "created_utc": getattr(comment, "created_utc", 0.0),
                }
            )
    except Exception as exc:
        logger.warning("Could not fetch recent posts for '%s': %s", username, exc)
    return results


def _normalise(text: str) -> str:
    return text.lower().strip()


def _text_overlap(a: str, b: str) -> float:
    """Simple word-level Jaccard overlap between two strings."""
    words_a = set(_normalise(a).split())
    words_b = set(_normalise(b).split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


def score_history(
    recent_posts: list[dict[str, Any]],
    current_subreddit: str,
    current_title: str,
) -> tuple[int, str | None]:
    """Detect cross-subreddit copy-paste reposting.

    Compares ``current_title`` (case-insensitive, Jaccard ≥ 0.6 overlap) against
    recent posts from OTHER subreddits within the recency window.  If two or more
    matches are found across different subreddits the signal fires.

    Returns (points, reason) or (0, None).
    """
    if not recent_posts or not current_title.strip():
        return 0, None

    cutoff = time.time() - _RECENCY_WINDOW_DAYS * 86400
    current_sub_lower = current_subreddit.lower()
    matching_subreddits: set[str] = set()

    for post in recent_posts:
        if post.get("created_utc", 0.0) < cutoff:
            continue
        post_sub = (post.get("subreddit") or "").lower()
        if post_sub == current_sub_lower:
            continue
        text = (post.get("title") or "") + " " + (post.get("body") or "")
        if len(text.strip()) < _MIN_TEXT_LENGTH:
            continue
        if _text_overlap(current_title, text) >= 0.6:
            matching_subreddits.add(post_sub)

    if len(matching_subreddits) >= _MIN_CROSS_SUB_HITS:
        subs = ", ".join(sorted(matching_subreddits)[:3])
        return _POINTS, f"Cross-subreddit reposting detected in: r/{subs}"

    return 0, None
