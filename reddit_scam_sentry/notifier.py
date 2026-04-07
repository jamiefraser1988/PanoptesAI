"""
Webhook notifier for Reddit Scam Sentry.

Sends fire-and-forget alerts when posts or comments breach the notify threshold.
Supported webhook types: discord | slack | generic

Usage:
    await notify(submission, score, reasons)
    await notify_comment(comment, score, reasons)

Both functions are no-ops when WEBHOOK_URL is not configured.
Failures are logged as WARNING and never propagate to the caller.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import aiohttp

from reddit_scam_sentry import config

logger = logging.getLogger("sentry.notifier")

_REDDIT_POST_BASE = "https://www.reddit.com/comments/{post_id}"
_REDDIT_COMMENT_BASE = "https://www.reddit.com/comments/{post_id}/_/{comment_id}"


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _build_discord_post(
    *,
    post_id: str,
    subreddit: str,
    author: str,
    title: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    url = _REDDIT_POST_BASE.format(post_id=post_id)
    color = 0xDA3633 if score >= 90 else 0xD29922 if score >= 70 else 0x238636
    embed = {
        "title": f"⚠️ Flagged post in r/{subreddit}",
        "url": url,
        "color": color,
        "fields": [
            {"name": "Post", "value": f"[{title[:200]}]({url})", "inline": False},
            {"name": "Author", "value": f"u/{author}", "inline": True},
            {"name": "Risk score", "value": str(score), "inline": True},
            {
                "name": "Reasons",
                "value": "\n".join(f"• {r}" for r in reasons) if reasons else "—",
                "inline": False,
            },
        ],
        "timestamp": flagged_at,
        "footer": {"text": "Reddit Scam Sentry"},
    }
    return {"embeds": [embed]}


def _build_discord_comment(
    *,
    comment_id: str,
    post_id: str,
    subreddit: str,
    author: str,
    body_snippet: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    url = _REDDIT_COMMENT_BASE.format(post_id=post_id, comment_id=comment_id)
    color = 0xDA3633 if score >= 90 else 0xD29922 if score >= 70 else 0x238636
    embed = {
        "title": f"⚠️ Flagged comment in r/{subreddit}",
        "url": url,
        "color": color,
        "fields": [
            {"name": "Comment", "value": f"[{body_snippet[:200]}]({url})", "inline": False},
            {"name": "Author", "value": f"u/{author}", "inline": True},
            {"name": "Risk score", "value": str(score), "inline": True},
            {
                "name": "Reasons",
                "value": "\n".join(f"• {r}" for r in reasons) if reasons else "—",
                "inline": False,
            },
        ],
        "timestamp": flagged_at,
        "footer": {"text": "Reddit Scam Sentry"},
    }
    return {"embeds": [embed]}


def _build_slack_post(
    *,
    post_id: str,
    subreddit: str,
    author: str,
    title: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    url = _REDDIT_POST_BASE.format(post_id=post_id)
    reasons_text = "\n".join(f"• {r}" for r in reasons) if reasons else "—"
    return {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"⚠️ Flagged post in r/{subreddit}"},
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Post*\n<{url}|{title[:200]}>"},
                    {"type": "mrkdwn", "text": f"*Author*\nu/{author}"},
                    {"type": "mrkdwn", "text": f"*Risk score*\n{score}"},
                    {"type": "mrkdwn", "text": f"*Reasons*\n{reasons_text}"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"Reddit Scam Sentry | {flagged_at}"},
                ],
            },
            {"type": "divider"},
        ]
    }


def _build_slack_comment(
    *,
    comment_id: str,
    post_id: str,
    subreddit: str,
    author: str,
    body_snippet: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    url = _REDDIT_COMMENT_BASE.format(post_id=post_id, comment_id=comment_id)
    reasons_text = "\n".join(f"• {r}" for r in reasons) if reasons else "—"
    return {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"⚠️ Flagged comment in r/{subreddit}"},
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Comment*\n<{url}|{body_snippet[:200]}>"},
                    {"type": "mrkdwn", "text": f"*Author*\nu/{author}"},
                    {"type": "mrkdwn", "text": f"*Risk score*\n{score}"},
                    {"type": "mrkdwn", "text": f"*Reasons*\n{reasons_text}"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"Reddit Scam Sentry | {flagged_at}"},
                ],
            },
            {"type": "divider"},
        ]
    }


def _build_generic_post(
    *,
    post_id: str,
    subreddit: str,
    author: str,
    title: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    return {
        "post_id": post_id,
        "subreddit": subreddit,
        "author": author,
        "title": title,
        "score": score,
        "reasons": reasons,
        "url": _REDDIT_POST_BASE.format(post_id=post_id),
        "flagged_at": flagged_at,
    }


def _build_generic_comment(
    *,
    comment_id: str,
    post_id: str,
    subreddit: str,
    author: str,
    body_snippet: str,
    score: int,
    reasons: list[str],
    flagged_at: str,
) -> dict[str, Any]:
    return {
        "comment_id": comment_id,
        "post_id": post_id,
        "subreddit": subreddit,
        "author": author,
        "body_snippet": body_snippet,
        "score": score,
        "reasons": reasons,
        "url": _REDDIT_COMMENT_BASE.format(post_id=post_id, comment_id=comment_id),
        "flagged_at": flagged_at,
    }


async def _fire(payload: dict[str, Any]) -> None:
    """POST payload to WEBHOOK_URL; logs WARNING on failure, never raises."""
    url = config.WEBHOOK_URL
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    logger.warning(
                        "Webhook returned HTTP %d: %s", resp.status, body[:200]
                    )
                else:
                    logger.debug("Webhook delivered (HTTP %d)", resp.status)
    except Exception as exc:
        logger.warning("Webhook delivery failed: %s", exc)


def _above_notify_threshold(score: int) -> bool:
    return score >= config.NOTIFY_THRESHOLD


async def notify(submission: Any, score: int, reasons: list[str]) -> None:
    """Fire-and-forget webhook for a flagged submission.

    No-op when WEBHOOK_URL is not configured or score < NOTIFY_THRESHOLD.
    Never raises.
    """
    if not config.WEBHOOK_URL:
        return
    if not _above_notify_threshold(score):
        return

    flagged_at = _iso_now()
    post_id = getattr(submission, "id", "") or ""
    author = getattr(submission.author, "name", "unknown") if submission.author else "unknown"
    subreddit = (
        submission.subreddit.display_name if submission.subreddit else "unknown"
    )
    title = getattr(submission, "title", "") or ""

    wtype = config.WEBHOOK_TYPE
    if wtype == "discord":
        payload = _build_discord_post(
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            title=title,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )
    elif wtype == "slack":
        payload = _build_slack_post(
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            title=title,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )
    else:
        payload = _build_generic_post(
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            title=title,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )

    asyncio.ensure_future(_fire(payload))


async def notify_comment(comment: Any, score: int, reasons: list[str]) -> None:
    """Fire-and-forget webhook for a flagged comment.

    No-op when WEBHOOK_URL is not configured or score < NOTIFY_THRESHOLD.
    Never raises.
    """
    if not config.WEBHOOK_URL:
        return
    if not _above_notify_threshold(score):
        return

    flagged_at = _iso_now()
    comment_id = getattr(comment, "id", "") or ""
    author = getattr(comment.author, "name", "unknown") if comment.author else "unknown"
    subreddit = comment.subreddit.display_name if comment.subreddit else "unknown"
    body = getattr(comment, "body", "") or ""
    body_snippet = body[:200]

    raw_post_id = getattr(comment, "link_id", "") or ""
    post_id = raw_post_id[3:] if raw_post_id.startswith("t3_") else raw_post_id

    wtype = config.WEBHOOK_TYPE
    if wtype == "discord":
        payload = _build_discord_comment(
            comment_id=comment_id,
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            body_snippet=body_snippet,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )
    elif wtype == "slack":
        payload = _build_slack_comment(
            comment_id=comment_id,
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            body_snippet=body_snippet,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )
    else:
        payload = _build_generic_comment(
            comment_id=comment_id,
            post_id=post_id,
            subreddit=subreddit,
            author=author,
            body_snippet=body_snippet,
            score=score,
            reasons=reasons,
            flagged_at=flagged_at,
        )

    asyncio.ensure_future(_fire(payload))
