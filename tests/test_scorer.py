"""
Unit tests for reddit_scam_sentry/scorer.py

Each scoring rule is tested in isolation via the private rule functions,
and end-to-end via compute_score for integration cases.
"""

import time
import pytest

from reddit_scam_sentry.scorer import (
    _rule_keywords,
    _rule_suspicious_links,
    _rule_external_links,
    _rule_account_age,
    _rule_karma_shape,
    _rule_bot_username,
    compute_score,
)


LONG_AGO = time.time() - (365 * 86400)
NEW_7D = time.time() - (3 * 86400)
NEW_30D = time.time() - (15 * 86400)


class TestRuleKeywords:
    def test_no_keywords_scores_zero(self):
        pts, reason = _rule_keywords("My cat is fluffy", "I love Sundays")
        assert pts == 0
        assert reason is None

    def test_single_keyword_scores_ten(self):
        pts, reason = _rule_keywords("Send me a message on telegram", "")
        assert pts == 10
        assert reason is not None
        assert "telegram" in reason

    def test_multiple_keywords_cap_at_forty(self):
        title = "telegram crypto bitcoin usdt investment profit guaranteed 100% profit"
        pts, reason = _rule_keywords(title, "double your free money cashapp venmo western union")
        assert pts == 40

    def test_keyword_in_body(self):
        pts, reason = _rule_keywords("Normal title", "dm me for more info")
        assert pts == 10
        assert reason is not None

    def test_case_insensitive(self):
        pts, reason = _rule_keywords("TELEGRAM", "")
        assert pts == 10

    def test_reason_contains_keyword_name(self):
        pts, reason = _rule_keywords("flip money now", "")
        assert reason is not None
        assert "flip money" in reason


class TestRuleSuspiciousLinks:
    def test_no_links_scores_zero(self):
        pts, reason = _rule_suspicious_links("no links here")
        assert pts == 0
        assert reason is None

    def test_telegram_link_scores_fifteen(self):
        pts, reason = _rule_suspicious_links("join us at https://t.me/scamgroup")
        assert pts == 15
        assert reason is not None
        assert "t.me" in reason

    def test_bitly_link_scores_fifteen(self):
        pts, reason = _rule_suspicious_links("click https://bit.ly/abc123")
        assert pts == 15

    def test_two_suspicious_links_scores_thirty(self):
        pts, reason = _rule_suspicious_links(
            "https://bit.ly/a and https://t.me/b"
        )
        assert pts == 30

    def test_three_links_capped_at_thirty(self):
        pts, reason = _rule_suspicious_links(
            "https://bit.ly/a https://t.me/b https://tinyurl.com/c"
        )
        assert pts == 30

    def test_safe_link_scores_zero(self):
        pts, reason = _rule_suspicious_links("https://github.com/user/repo")
        assert pts == 0


class TestRuleExternalLinks:
    def test_zero_links_scores_zero(self):
        pts, reason = _rule_external_links("no links")
        assert pts == 0

    def test_two_links_scores_zero(self):
        pts, reason = _rule_external_links("https://a.com https://b.com")
        assert pts == 0

    def test_three_links_scores_five(self):
        pts, reason = _rule_external_links(
            "https://a.com https://b.com https://c.com"
        )
        assert pts == 5
        assert reason is not None
        assert "3" in reason

    def test_five_links_scores_five(self):
        pts, reason = _rule_external_links(
            "https://a.com https://b.com https://c.com https://d.com https://e.com"
        )
        assert pts == 5


class TestRuleAccountAge:
    def test_old_account_scores_zero(self):
        pts, reason = _rule_account_age(LONG_AGO)
        assert pts == 0
        assert reason is None

    def test_account_under_7_days_scores_thirty(self):
        pts, reason = _rule_account_age(NEW_7D)
        assert pts == 30
        assert reason is not None
        assert "new account" in reason.lower() or "very new" in reason.lower()

    def test_account_7_to_30_days_scores_fifteen(self):
        pts, reason = _rule_account_age(NEW_30D)
        assert pts == 15
        assert reason is not None

    @pytest.mark.parametrize("days_ago,expected_pts", [
        (1, 30),
        (6, 30),
        (8, 15),
        (29, 15),
        (31, 0),
        (365, 0),
    ])
    def test_age_boundary_cases(self, days_ago, expected_pts):
        created_utc = time.time() - (days_ago * 86400)
        pts, _ = _rule_account_age(created_utc)
        assert pts == expected_pts


class TestRuleKarmaShape:
    def test_zero_total_karma_scores_ten(self):
        pts, reason = _rule_karma_shape(0, 0)
        assert pts == 10
        assert reason is not None
        assert "zero" in reason.lower()

    def test_zero_comment_nonzero_link_scores_twenty(self):
        pts, reason = _rule_karma_shape(100, 0)
        assert pts == 20
        assert reason is not None

    def test_healthy_karma_scores_zero(self):
        pts, reason = _rule_karma_shape(500, 1000)
        assert pts == 0
        assert reason is None

    def test_extreme_ratio_high_link_karma_scores_ten(self):
        pts, reason = _rule_karma_shape(600, 50)
        assert pts == 10
        assert reason is not None

    def test_high_link_karma_but_ratio_below_threshold_scores_zero(self):
        pts, reason = _rule_karma_shape(200, 100)
        assert pts == 0

    def test_small_link_karma_with_no_comments_scores_twenty(self):
        pts, reason = _rule_karma_shape(5, 0)
        assert pts == 20


class TestRuleBotUsername:
    @pytest.mark.parametrize("username", [
        "User12345",
        "Bot9999",
        "ab1234",
        "RandomBot56789",
    ])
    def test_bot_like_usernames_score_fifteen(self, username):
        pts, reason = _rule_bot_username(username)
        assert pts == 15
        assert reason is not None
        assert username in reason

    @pytest.mark.parametrize("username", [
        "normal_user",
        "TheLongUsernameWithWords",
        "reddit_mod_2024",
        "user",
        "x1",
    ])
    def test_normal_usernames_score_zero(self, username):
        pts, reason = _rule_bot_username(username)
        assert pts == 0
        assert reason is None


class TestComputeScore:
    def _base_kwargs(self, **overrides):
        defaults = dict(
            title="Normal post title",
            body="This is a regular post with no suspicious content.",
            url="https://reddit.com/r/test/comments/abc",
            author_name="regular_user",
            account_created_utc=LONG_AGO,
            link_karma=500,
            comment_karma=1000,
        )
        defaults.update(overrides)
        return defaults

    def test_clean_post_scores_low(self):
        score, reasons = compute_score(**self._base_kwargs())
        assert score < 30
        assert reasons == []

    def test_scam_post_scores_high(self):
        score, reasons = compute_score(**self._base_kwargs(
            title="Make money with crypto and telegram",
            body="dm me for investment tips https://t.me/scam",
            author_name="Bot12345",
            account_created_utc=NEW_7D,
            link_karma=0,
            comment_karma=0,
        ))
        assert score >= 70
        assert len(reasons) >= 3

    def test_score_capped_at_100(self):
        score, reasons = compute_score(**self._base_kwargs(
            title=" ".join(["telegram crypto bitcoin usdt investment"] * 5),
            body="dm me https://t.me/a https://bit.ly/b https://tinyurl.com/c https://goo.gl/d",
            url="https://t.me/joinscam",
            author_name="Bot99999",
            account_created_utc=NEW_7D,
            link_karma=0,
            comment_karma=0,
        ))
        assert score <= 100

    def test_score_never_negative(self):
        score, reasons = compute_score(**self._base_kwargs())
        assert score >= 0

    def test_suspicious_url_in_url_field_detected(self):
        score, reasons = compute_score(**self._base_kwargs(
            body="",
            url="https://t.me/scamgroup",
        ))
        assert score > 0
        assert any("t.me" in r for r in reasons)

    def test_reasons_list_matches_triggered_rules(self):
        score, reasons = compute_score(**self._base_kwargs(
            title="Buy crypto now",
            body="",
            url="",
            author_name="Bot54321",
        ))
        assert len(reasons) >= 2
        assert all(isinstance(r, str) for r in reasons)
