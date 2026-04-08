"""
Rule-based risk scorer.

Each rule function returns (points: int, reason: str | None).
If reason is None the rule did not trigger.
Final score is clamped to 0–100.
"""

import re
import time
from typing import Any

from reddit_scam_sentry.history import score_history
from reddit_scam_sentry.similarity import score_similarity
from reddit_scam_sentry import config as _config

SCAM_KEYWORDS: list[str] = [
    "telegram",
    "whatsapp",
    "dm me",
    "message me",
    "send dm",
    "crypto",
    "bitcoin",
    "ethereum",
    "usdt",
    "investment",
    "profit guaranteed",
    "100% profit",
    "double your",
    "free money",
    "paypal",
    "cashapp",
    "venmo",
    "western union",
    "wire transfer",
    "gift card",
    "recover funds",
    "account hacked",
    "limited offer",
    "act now",
    "click here",
    "cashout",
    "flip money",
]

SUSPICIOUS_DOMAINS: list[str] = [
    "t.me",
    "bit.ly",
    "tinyurl.com",
    "goo.gl",
    "ow.ly",
    "buff.ly",
    "rebrand.ly",
    "cutt.ly",
    "is.gd",
    "bc.vc",
    "linktr.ee",
]

BOT_USERNAME_PATTERN = re.compile(r"^[A-Za-z]{2,12}\d{4,}$")

URL_PATTERN = re.compile(
    r"https?://([A-Za-z0-9\-\.]+)",
    re.IGNORECASE,
)


def _rule_keywords(title: str, body: str) -> tuple[int, str | None]:
    combined = (title + " " + body).lower()
    hits = [kw for kw in SCAM_KEYWORDS if kw in combined]
    if not hits:
        return 0, None
    pts = min(len(hits) * 10, 40)
    return pts, f"Scam keywords: {', '.join(hits[:5])}"


def _rule_suspicious_links(body: str) -> tuple[int, str | None]:
    domains_found = URL_PATTERN.findall(body)
    hits = [d for d in domains_found if any(d.endswith(sd) for sd in SUSPICIOUS_DOMAINS)]
    if not hits:
        return 0, None
    pts = min(len(hits) * 15, 30)
    return pts, f"Suspicious link domains: {', '.join(set(hits))}"


def _rule_external_links(body: str) -> tuple[int, str | None]:
    urls = URL_PATTERN.findall(body)
    if len(urls) >= 3:
        return 5, f"High external link count: {len(urls)} links"
    return 0, None


def _rule_account_age(account_created_utc: float) -> tuple[int, str | None]:
    age_days = (time.time() - account_created_utc) / 86400
    if age_days < 7:
        return 30, f"Very new account: {age_days:.0f} days old"
    if age_days < 30:
        return 15, f"New account: {age_days:.0f} days old"
    return 0, None


def _rule_karma_shape(
    link_karma: int, comment_karma: int
) -> tuple[int, str | None]:
    total = link_karma + comment_karma
    if total == 0:
        return 10, "Zero total karma"
    if comment_karma == 0 and link_karma > 0:
        return 20, f"Zero comment karma with {link_karma} link karma (no engagement history)"
    if total > 0 and comment_karma == 0:
        return 15, "No comment karma — link-only posting pattern"
    ratio = link_karma / max(comment_karma, 1)
    if ratio > 10 and link_karma > 500:
        return 10, f"Unusual karma ratio (link:{link_karma} / comment:{comment_karma})"
    return 0, None


def _rule_bot_username(username: str) -> tuple[int, str | None]:
    if BOT_USERNAME_PATTERN.match(username):
        return 15, f"Bot-like username pattern: {username}"
    return 0, None


def _feedback_adjustment(
    author_feedback: dict[str, int] | None,
) -> tuple[int, str | None]:
    """Adjust score based on moderator feedback history for the author.

    - If most feedback is false_positive → reduce score (negative points).
    - If most feedback is true_positive → add points.
    """
    if not author_feedback or author_feedback.get("total", 0) == 0:
        return 0, None

    fp = author_feedback.get("false_positive", 0)
    tp = author_feedback.get("true_positive", 0)
    total = author_feedback["total"]

    if fp > tp and fp >= 2:
        reduction = min(fp * 5, 20)
        return -reduction, f"Author has {fp}/{total} false-positive verdicts (-{reduction}pts)"
    if tp > fp and tp >= 2:
        boost = min(tp * 3, 15)
        return boost, f"Author has {tp}/{total} confirmed-scam verdicts (+{boost}pts)"
    return 0, None


def compute_score(
    *,
    title: str,
    body: str,
    url: str,
    author_name: str,
    account_created_utc: float,
    link_karma: int,
    comment_karma: int,
    author_recent_posts: list[dict[str, Any]] | None = None,
    recent_flagged_bodies: list[str] | None = None,
    current_subreddit: str = "",
    author_feedback: dict[str, int] | None = None,
    ai_result: dict | None = None,
) -> tuple[int, list[str]]:
    combined_links = body + " " + url
    rules: list[tuple[int, str | None]] = [
        _rule_keywords(title, body),
        _rule_suspicious_links(combined_links),
        _rule_external_links(combined_links),
        _rule_account_age(account_created_utc),
        _rule_karma_shape(link_karma, comment_karma),
        _rule_bot_username(author_name),
    ]

    if author_recent_posts is not None:
        rules.append(score_history(author_recent_posts, current_subreddit, title or body))

    if recent_flagged_bodies is not None:
        rules.append(
            score_similarity(
                body or title,
                recent_flagged_bodies,
                threshold=_config.SIMILARITY_THRESHOLD,
            )
        )

    rules.append(_feedback_adjustment(author_feedback))

    total = 0
    reasons: list[str] = []
    for pts, reason in rules:
        if reason:
            total += pts
            reasons.append(reason)

    rule_score = max(0, min(100, total))

    if ai_result is not None:
        ai_weight = _config.AI_WEIGHT
        rule_weight = 1.0 - ai_weight

        ai_raw = max(ai_result.get("scam_probability", 0.0), ai_result.get("bot_probability", 0.0))
        ai_score_pts = int(round(ai_raw * 100))

        final = int(round(rule_weight * rule_score + ai_weight * ai_score_pts))
        final = max(0, min(100, final))

        for signal in ai_result.get("signals", []):
            if signal:
                reasons.append(f"AI: {signal}")

        action = ai_result.get("action", "")
        if action == "remove":
            reasons.append("AI: Recommended removal")
        elif action == "review":
            reasons.append("AI: Flagged for review")
    else:
        final = rule_score

    return final, reasons
