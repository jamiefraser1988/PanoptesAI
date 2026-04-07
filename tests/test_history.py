"""
Tests for reddit_scam_sentry/history.py

Covers:
- _text_overlap: identical, disjoint, partial, empty-string edge cases
- score_history: no-signal cases, detection, recency window, same-subreddit exclusion
- fetch_recent_posts: success path, API error fallback, returned structure
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from reddit_scam_sentry.history import (
    _text_overlap,
    fetch_recent_posts,
    score_history,
)


# ---------------------------------------------------------------------------
# _text_overlap
# ---------------------------------------------------------------------------

class TestTextOverlap:
    def test_identical_strings_return_one(self):
        assert _text_overlap("buy crypto now", "buy crypto now") == pytest.approx(1.0)

    def test_disjoint_strings_return_zero(self):
        assert _text_overlap("hello world", "foo bar baz") == pytest.approx(0.0)

    def test_partial_overlap(self):
        result = _text_overlap("buy crypto now", "buy bitcoin later")
        assert 0.0 < result < 1.0

    def test_empty_a_returns_zero(self):
        assert _text_overlap("", "hello world") == pytest.approx(0.0)

    def test_empty_b_returns_zero(self):
        assert _text_overlap("hello world", "") == pytest.approx(0.0)

    def test_both_empty_return_zero(self):
        assert _text_overlap("", "") == pytest.approx(0.0)

    def test_case_insensitive(self):
        assert _text_overlap("Buy Crypto Now", "buy crypto now") == pytest.approx(1.0)

    def test_single_word_match(self):
        result = _text_overlap("crypto", "buy crypto here")
        assert result > 0.0


# ---------------------------------------------------------------------------
# score_history
# ---------------------------------------------------------------------------

class TestScoreHistory:
    def _make_post(
        self,
        subreddit: str,
        title: str,
        body: str = "",
        days_ago: float = 0.0,
    ) -> dict:
        return {
            "kind": "post",
            "subreddit": subreddit,
            "title": title,
            "body": body,
            "created_utc": time.time() - days_ago * 86400,
        }

    def test_empty_recent_posts_returns_zero(self):
        pts, reason = score_history([], "testsubreddit", "Buy crypto now")
        assert pts == 0
        assert reason is None

    def test_empty_title_returns_zero(self):
        posts = [self._make_post("other", "Buy crypto now")]
        pts, reason = score_history(posts, "testsubreddit", "")
        assert pts == 0
        assert reason is None

    def test_one_match_does_not_trigger(self):
        posts = [self._make_post("other", "buy crypto fast dm me telegram")]
        pts, reason = score_history(posts, "testsubreddit", "buy crypto fast dm me telegram")
        assert pts == 0
        assert reason is None

    def test_two_matches_in_different_subs_triggers(self):
        posts = [
            self._make_post("sub1", "invest in crypto telegram dm"),
            self._make_post("sub2", "invest in crypto telegram dm"),
        ]
        pts, reason = score_history(posts, "testsubreddit", "invest in crypto telegram dm")
        assert pts == 25
        assert reason is not None
        assert "sub1" in reason or "sub2" in reason

    def test_same_subreddit_posts_ignored(self):
        posts = [
            self._make_post("testsubreddit", "invest in crypto telegram dm"),
            self._make_post("testsubreddit", "invest in crypto telegram dm"),
        ]
        pts, reason = score_history(posts, "testsubreddit", "invest in crypto telegram dm")
        assert pts == 0
        assert reason is None

    def test_old_posts_ignored(self):
        posts = [
            self._make_post("sub1", "invest in crypto telegram dm", days_ago=10.0),
            self._make_post("sub2", "invest in crypto telegram dm", days_ago=10.0),
        ]
        pts, reason = score_history(posts, "testsubreddit", "invest in crypto telegram dm")
        assert pts == 0
        assert reason is None

    def test_recent_posts_within_window_detected(self):
        posts = [
            self._make_post("sub1", "earn money fast guaranteed", days_ago=3.0),
            self._make_post("sub2", "earn money fast guaranteed", days_ago=5.0),
        ]
        pts, reason = score_history(posts, "testsubreddit", "earn money fast guaranteed")
        assert pts == 25
        assert reason is not None

    def test_short_text_posts_skipped(self):
        posts = [
            self._make_post("sub1", "hi"),
            self._make_post("sub2", "hi"),
        ]
        pts, reason = score_history(posts, "testsubreddit", "hi")
        assert pts == 0

    def test_case_insensitive_subreddit_comparison(self):
        posts = [
            self._make_post("TESTSUBREDDIT", "invest in crypto telegram dm"),
            self._make_post("TESTSUBREDDIT", "invest in crypto telegram dm"),
        ]
        pts, reason = score_history(posts, "testsubreddit", "invest in crypto telegram dm")
        assert pts == 0

    def test_reason_contains_subreddit_names(self):
        posts = [
            self._make_post("alphasub", "fast money guaranteed returns now"),
            self._make_post("betasub", "fast money guaranteed returns now"),
        ]
        pts, reason = score_history(posts, "current", "fast money guaranteed returns now")
        assert reason is not None
        assert "alphasub" in reason or "betasub" in reason


# ---------------------------------------------------------------------------
# fetch_recent_posts
# ---------------------------------------------------------------------------

class TestFetchRecentPosts:
    @pytest.mark.asyncio
    async def test_returns_list_of_dicts(self):
        mock_submission = MagicMock()
        mock_submission.title = "Test post"
        mock_submission.selftext = "body text"
        mock_submission.subreddit = MagicMock()
        mock_submission.subreddit.display_name = "testsubreddit"
        mock_submission.created_utc = 1700000000.0

        mock_comment = MagicMock()
        mock_comment.body = "comment text"
        mock_comment.subreddit = MagicMock()
        mock_comment.subreddit.display_name = "testsubreddit"
        mock_comment.created_utc = 1700000001.0

        mock_redditor = MagicMock()
        mock_redditor.submissions = MagicMock()
        mock_redditor.submissions.new = MagicMock(
            return_value=_async_iter([mock_submission])
        )
        mock_redditor.comments = MagicMock()
        mock_redditor.comments.new = MagicMock(
            return_value=_async_iter([mock_comment])
        )

        mock_reddit = AsyncMock()
        mock_reddit.redditor = AsyncMock(return_value=mock_redditor)

        result = await fetch_recent_posts(mock_reddit, "testuser", limit=10)

        assert len(result) == 2
        posts = [r for r in result if r["kind"] == "post"]
        comments = [r for r in result if r["kind"] == "comment"]
        assert len(posts) == 1
        assert posts[0]["title"] == "Test post"
        assert posts[0]["subreddit"] == "testsubreddit"
        assert len(comments) == 1
        assert comments[0]["body"] == "comment text"

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_api_error(self):
        mock_reddit = AsyncMock()
        mock_reddit.redditor = AsyncMock(side_effect=Exception("API down"))

        result = await fetch_recent_posts(mock_reddit, "testuser")
        assert result == []

    @pytest.mark.asyncio
    async def test_combined_limit_respected(self):
        """With limit=4, should fetch 2 submissions + 2 comments = 4 total max."""
        mock_submissions = [MagicMock() for _ in range(2)]
        for i, s in enumerate(mock_submissions):
            s.title = f"Post {i}"
            s.selftext = ""
            s.subreddit = MagicMock()
            s.subreddit.display_name = "sub"
            s.created_utc = float(i)

        mock_comments_list = [MagicMock() for _ in range(2)]
        for i, c in enumerate(mock_comments_list):
            c.body = f"Comment {i}"
            c.subreddit = MagicMock()
            c.subreddit.display_name = "sub"
            c.created_utc = float(i)

        mock_redditor = MagicMock()
        mock_redditor.submissions = MagicMock()
        mock_redditor.submissions.new = MagicMock(return_value=_async_iter(mock_submissions))
        mock_redditor.comments = MagicMock()
        mock_redditor.comments.new = MagicMock(return_value=_async_iter(mock_comments_list))

        mock_reddit = AsyncMock()
        mock_reddit.redditor = AsyncMock(return_value=mock_redditor)

        result = await fetch_recent_posts(mock_reddit, "testuser", limit=4)
        assert len(result) == 4
        mock_redditor.submissions.new.assert_called_once_with(limit=2)
        mock_redditor.comments.new.assert_called_once_with(limit=2)

    @pytest.mark.asyncio
    async def test_all_required_keys_present(self):
        mock_submission = MagicMock()
        mock_submission.title = "T"
        mock_submission.selftext = "B"
        mock_submission.subreddit = MagicMock()
        mock_submission.subreddit.display_name = "sub"
        mock_submission.created_utc = 1000.0

        mock_redditor = MagicMock()
        mock_redditor.submissions = MagicMock()
        mock_redditor.submissions.new = MagicMock(return_value=_async_iter([mock_submission]))
        mock_redditor.comments = MagicMock()
        mock_redditor.comments.new = MagicMock(return_value=_async_iter([]))

        mock_reddit = AsyncMock()
        mock_reddit.redditor = AsyncMock(return_value=mock_redditor)

        result = await fetch_recent_posts(mock_reddit, "u")
        assert len(result) == 1
        assert set(result[0].keys()) >= {"kind", "subreddit", "title", "body", "created_utc"}


def _async_iter(items):
    """Helper: wraps a list as an async iterator."""

    class _AsyncIter:
        def __init__(self, it):
            self._it = iter(it)

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration

    return _AsyncIter(items)
