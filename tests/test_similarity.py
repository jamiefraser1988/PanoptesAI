"""
Tests for reddit_scam_sentry/similarity.py

Covers:
- _tokenise: lowercasing, stop-word removal, short token filtering
- score_similarity: no signal cases, detection at threshold, below threshold,
  empty inputs, short body guard, threshold edge cases
"""

from __future__ import annotations

import pytest

from reddit_scam_sentry.similarity import (
    _cosine,
    _idf,
    _tf,
    _tfidf_vector,
    _tokenise,
    score_similarity,
)


# ---------------------------------------------------------------------------
# _tokenise
# ---------------------------------------------------------------------------

class TestTokenise:
    def test_lowercases_output(self):
        tokens = _tokenise("Hello WORLD")
        assert all(t == t.lower() for t in tokens)

    def test_removes_stop_words(self):
        tokens = _tokenise("the and or but for")
        assert tokens == []

    def test_removes_single_char_tokens(self):
        tokens = _tokenise("a i")
        assert tokens == []

    def test_keeps_meaningful_words(self):
        tokens = _tokenise("buy crypto telegram invest")
        assert "buy" in tokens
        assert "crypto" in tokens

    def test_handles_empty_string(self):
        assert _tokenise("") == []

    def test_handles_digits(self):
        tokens = _tokenise("earn 500 per day")
        assert "500" in tokens

    def test_strips_punctuation_implicitly(self):
        tokens = _tokenise("buy! crypto, now.")
        assert "buy" in tokens
        assert "crypto" in tokens
        assert "now" in tokens


# ---------------------------------------------------------------------------
# _tf
# ---------------------------------------------------------------------------

class TestTf:
    def test_single_term_tf_is_one(self):
        tf = _tf(["crypto"])
        assert tf["crypto"] == pytest.approx(1.0)

    def test_two_equal_terms(self):
        tf = _tf(["crypto", "crypto"])
        assert tf["crypto"] == pytest.approx(1.0)

    def test_mixed_terms(self):
        tf = _tf(["a", "a", "b"])
        assert tf["a"] == pytest.approx(2 / 3)
        assert tf["b"] == pytest.approx(1 / 3)

    def test_empty_returns_empty_dict(self):
        assert _tf([]) == {}


# ---------------------------------------------------------------------------
# _idf
# ---------------------------------------------------------------------------

class TestIdf:
    def test_term_in_all_docs_has_low_idf(self):
        corpus = [["crypto"], ["crypto"], ["crypto"]]
        idf = _idf("crypto", corpus)
        assert idf < 1.5

    def test_term_in_one_doc_has_higher_idf(self):
        corpus = [["crypto", "invest"], ["invest"], ["invest"]]
        idf_crypto = _idf("crypto", corpus)
        idf_invest = _idf("invest", corpus)
        assert idf_crypto > idf_invest

    def test_absent_term_has_max_idf(self):
        corpus = [["invest"], ["invest"]]
        idf = _idf("telegram", corpus)
        assert idf > 1.0


# ---------------------------------------------------------------------------
# _cosine
# ---------------------------------------------------------------------------

class TestCosine:
    def test_identical_vectors_return_one(self):
        vec = {"a": 0.5, "b": 0.5}
        assert _cosine(vec, vec) == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_vectors_return_zero(self):
        assert _cosine({"a": 1.0}, {"b": 1.0}) == pytest.approx(0.0)

    def test_empty_vector_returns_zero(self):
        assert _cosine({}, {"a": 1.0}) == pytest.approx(0.0)

    def test_both_empty_return_zero(self):
        assert _cosine({}, {}) == pytest.approx(0.0)

    def test_partial_overlap(self):
        sim = _cosine({"a": 1.0, "b": 1.0}, {"a": 1.0, "c": 1.0})
        assert 0.0 < sim < 1.0


# ---------------------------------------------------------------------------
# score_similarity
# ---------------------------------------------------------------------------

class TestScoreSimilarity:
    def test_empty_body_returns_zero(self):
        pts, reason = score_similarity("", ["some flagged content here today"])
        assert pts == 0
        assert reason is None

    def test_short_body_returns_zero(self):
        pts, reason = score_similarity("hi", ["some flagged content here today"])
        assert pts == 0
        assert reason is None

    def test_empty_flagged_bodies_returns_zero(self):
        pts, reason = score_similarity("buy crypto now send dm telegram invest profit", [])
        assert pts == 0
        assert reason is None

    def test_identical_body_triggers_signal(self):
        body = "buy crypto now send dm telegram invest guaranteed profit returns"
        pts, reason = score_similarity(body, [body], threshold=0.5)
        assert pts == 20
        assert reason is not None
        assert "%" in reason

    def test_dissimilar_body_returns_zero(self):
        body = "I love hiking in the mountains on weekends"
        flagged = "buy crypto now send dm telegram invest guaranteed profit returns"
        pts, reason = score_similarity(body, [flagged], threshold=0.6)
        assert pts == 0
        assert reason is None

    def test_below_threshold_returns_zero(self):
        body = "earn money fast dm me telegram crypto invest now"
        similar = "earn money fast dm me telegram crypto invest profit"
        pts, reason = score_similarity(body, [similar], threshold=0.999)
        assert pts == 0

    def test_at_threshold_triggers(self):
        body = "earn money fast dm me telegram crypto invest now profit guaranteed"
        pts, reason = score_similarity(body, [body], threshold=0.9)
        assert pts == 20

    def test_returns_highest_match(self):
        body = "buy crypto telegram invest profit guaranteed returns dm me"
        close = "buy crypto telegram invest profit guaranteed returns dm me"
        far = "completely unrelated content about cats and dogs"
        pts, reason = score_similarity(body, [far, close], threshold=0.5)
        assert pts == 20
        assert reason is not None

    def test_reason_contains_percentage(self):
        body = "buy crypto now dm me telegram invest guaranteed profit"
        pts, reason = score_similarity(body, [body], threshold=0.1)
        if pts > 0:
            assert "%" in reason

    def test_all_stopword_body_returns_zero(self):
        pts, reason = score_similarity("the and or but for in on at", ["the and or but"])
        assert pts == 0

    def test_whitespace_only_body_returns_zero(self):
        pts, reason = score_similarity("     ", ["some content"])
        assert pts == 0

    def test_multiple_flagged_bodies(self):
        body = "earn easy money telegram dm invest crypto profit"
        flagged_bodies = [
            "unrelated topic about cooking",
            "earn easy money telegram dm invest crypto profit guaranteed",
            "another unrelated post about sports",
        ]
        pts, reason = score_similarity(body, flagged_bodies, threshold=0.5)
        assert pts == 20


# ---------------------------------------------------------------------------
# scorer.py integration — new kwargs wire through
# ---------------------------------------------------------------------------

class TestScorerIntegration:
    def test_history_signal_adds_points(self):
        import time
        from reddit_scam_sentry.scorer import compute_score

        recent = [
            {
                "kind": "post",
                "subreddit": "sub1",
                "title": "earn money fast guaranteed returns",
                "body": "",
                "created_utc": time.time() - 86400,
            },
            {
                "kind": "post",
                "subreddit": "sub2",
                "title": "earn money fast guaranteed returns",
                "body": "",
                "created_utc": time.time() - 86400,
            },
        ]

        score_without, _ = compute_score(
            title="earn money fast guaranteed returns",
            body="",
            url="",
            author_name="testuser",
            account_created_utc=1000000.0,
            link_karma=500,
            comment_karma=500,
            author_recent_posts=None,
        )
        score_with, reasons_with = compute_score(
            title="earn money fast guaranteed returns",
            body="",
            url="",
            author_name="testuser",
            account_created_utc=1000000.0,
            link_karma=500,
            comment_karma=500,
            author_recent_posts=recent,
        )

        assert score_with >= score_without
        assert any("repost" in r.lower() for r in reasons_with)

    def test_similarity_signal_adds_points(self):
        from reddit_scam_sentry.scorer import compute_score

        body = "buy crypto now dm me telegram invest guaranteed profit returns send"
        flagged_bodies = [body]

        score_without, _ = compute_score(
            title="",
            body=body,
            url="",
            author_name="testuser",
            account_created_utc=1000000.0,
            link_karma=500,
            comment_karma=500,
            recent_flagged_bodies=None,
        )
        score_with, reasons_with = compute_score(
            title="",
            body=body,
            url="",
            author_name="testuser",
            account_created_utc=1000000.0,
            link_karma=500,
            comment_karma=500,
            recent_flagged_bodies=flagged_bodies,
        )

        assert score_with >= score_without
        assert any("similar" in r.lower() for r in reasons_with)

    def test_no_new_args_gives_same_result_as_before(self):
        from reddit_scam_sentry.scorer import compute_score

        score1, _ = compute_score(
            title="hello",
            body="just a normal post",
            url="",
            author_name="niceperson",
            account_created_utc=1000000.0,
            link_karma=1000,
            comment_karma=2000,
        )
        score2, _ = compute_score(
            title="hello",
            body="just a normal post",
            url="",
            author_name="niceperson",
            account_created_utc=1000000.0,
            link_karma=1000,
            comment_karma=2000,
            author_recent_posts=None,
            recent_flagged_bodies=None,
        )
        assert score1 == score2

    def test_score_clamped_at_100(self):
        import time
        from reddit_scam_sentry.scorer import compute_score

        body = "telegram crypto dm me invest profit guaranteed free money cashapp western union paypal"
        recent = [
            {
                "kind": "post",
                "subreddit": "sub1",
                "title": body,
                "body": "",
                "created_utc": time.time() - 86400,
            },
            {
                "kind": "post",
                "subreddit": "sub2",
                "title": body,
                "body": "",
                "created_utc": time.time() - 86400,
            },
        ]

        score, _ = compute_score(
            title=body,
            body=body,
            url="https://t.me/scam",
            author_name="user12345678",
            account_created_utc=time.time() - 1000,
            link_karma=1,
            comment_karma=0,
            author_recent_posts=recent,
            recent_flagged_bodies=[body],
        )
        assert score <= 100
