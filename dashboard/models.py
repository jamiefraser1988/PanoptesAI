"""Pydantic models for request/response schemas."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class Verdict(str, Enum):
    true_positive = "true_positive"
    false_positive = "false_positive"
    unclear = "unclear"


class FeedbackRequest(BaseModel):
    verdict: Verdict


class DecisionOut(BaseModel):
    id: int
    post_id: str
    subreddit: str
    author: str
    title: str
    score: int
    reasons: list[str]
    flagged: bool
    decided_at: float
    feedback: Optional[str] = None

    @property
    def reddit_url(self) -> str:
        return f"https://www.reddit.com/comments/{self.post_id}"


class DecisionDetail(DecisionOut):
    pass


class SubredditStat(BaseModel):
    subreddit: str
    total: int
    flagged: int


class ReasonStat(BaseModel):
    reason: str
    count: int


class StatsOut(BaseModel):
    total_posts: int
    flagged_posts: int
    flag_rate_pct: float
    by_subreddit: list[SubredditStat]
    top_reasons: list[ReasonStat]
