"""
Unit tests for reddit_scam_sentry/utils.py
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from reddit_scam_sentry.utils import truncate, exponential_backoff


class TestTruncate:
    def test_short_string_unchanged(self):
        text = "Hello"
        assert truncate(text) == text

    def test_exactly_max_len_unchanged(self):
        text = "x" * 120
        assert truncate(text, max_len=120) == text
        assert len(truncate(text, max_len=120)) == 120

    def test_one_over_max_len_is_truncated(self):
        text = "x" * 121
        result = truncate(text, max_len=120)
        assert result.endswith("…")
        assert len(result) == 121

    def test_long_string_truncated_with_ellipsis(self):
        text = "a" * 200
        result = truncate(text)
        assert result == "a" * 120 + "…"
        assert len(result) == 121

    def test_empty_string_unchanged(self):
        assert truncate("") == ""

    def test_custom_max_len_respected(self):
        text = "hello world"
        result = truncate(text, max_len=5)
        assert result == "hello…"

    def test_unicode_content_truncated_correctly(self):
        text = "日本語テスト" * 30
        result = truncate(text, max_len=10)
        assert result.endswith("…")
        assert len(result) == 11

    def test_default_max_len_is_120(self):
        text = "y" * 130
        result = truncate(text)
        assert result == "y" * 120 + "…"


class TestExponentialBackoff:
    async def test_attempt_0_sleeps_base(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(0, base=2.0, cap=300.0)
            mock_sleep.assert_awaited_once_with(1.0)

    async def test_attempt_1_sleeps_base_squared(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(1, base=2.0, cap=300.0)
            mock_sleep.assert_awaited_once_with(2.0)

    async def test_attempt_2_sleeps_base_cubed(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(2, base=2.0, cap=300.0)
            mock_sleep.assert_awaited_once_with(4.0)

    async def test_delay_capped_at_cap(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(100, base=2.0, cap=300.0)
            mock_sleep.assert_awaited_once_with(300.0)

    async def test_custom_base_and_cap(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(3, base=3.0, cap=50.0)
            mock_sleep.assert_awaited_once_with(27.0)

    async def test_cap_not_exceeded_with_custom_cap(self):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(10, base=3.0, cap=50.0)
            mock_sleep.assert_awaited_once_with(50.0)

    @pytest.mark.parametrize("attempt,expected_delay", [
        (0, 1.0),
        (1, 2.0),
        (2, 4.0),
        (3, 8.0),
        (4, 16.0),
        (5, 32.0),
        (6, 64.0),
        (7, 128.0),
        (8, 256.0),
        (9, 300.0),
    ])
    async def test_parametrised_delays(self, attempt, expected_delay):
        with patch("reddit_scam_sentry.utils.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await exponential_backoff(attempt, base=2.0, cap=300.0)
            mock_sleep.assert_awaited_once_with(expected_delay)
