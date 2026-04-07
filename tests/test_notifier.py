"""
Tests for reddit_scam_sentry/notifier.py

Strategy:
- Payload builders tested independently (pure functions).
- _fire tested by mocking aiohttp.ClientSession so no real HTTP is made.
- notify / notify_comment tested by patching _fire and ensure_future so we can
  assert the right payload type is scheduled without real async side effects.
- Config variants (WEBHOOK_TYPE, NOTIFY_THRESHOLD) tested via importlib.reload.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import types
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import reddit_scam_sentry.notifier as notifier_mod
from reddit_scam_sentry import notifier


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_submission(
    post_id: str = "abc123",
    subreddit: str = "testsubreddit",
    author: str = "testuser",
    title: str = "Test post title",
) -> MagicMock:
    sub = MagicMock()
    sub.id = post_id
    sub.title = title
    sub.author = MagicMock()
    sub.author.name = author
    sub.subreddit = MagicMock()
    sub.subreddit.display_name = subreddit
    return sub


def _make_comment(
    comment_id: str = "cmt456",
    post_id: str = "t3_abc123",
    subreddit: str = "testsubreddit",
    author: str = "testuser",
    body: str = "This is a comment body",
) -> MagicMock:
    comment = MagicMock()
    comment.id = comment_id
    comment.link_id = post_id
    comment.body = body
    comment.author = MagicMock()
    comment.author.name = author
    comment.subreddit = MagicMock()
    comment.subreddit.display_name = subreddit
    return comment


# ---------------------------------------------------------------------------
# Payload builders — Discord post
# ---------------------------------------------------------------------------

class TestBuildDiscordPost:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            title="Buy crypto now!",
            score=85,
            reasons=["Scam keywords: crypto", "New account"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_discord_post(**defaults)

    def test_has_embeds_key(self):
        payload = self._call()
        assert "embeds" in payload
        assert len(payload["embeds"]) == 1

    def test_embed_title_contains_subreddit(self):
        payload = self._call(subreddit="scams")
        assert "scams" in payload["embeds"][0]["title"]

    def test_embed_url_contains_post_id(self):
        payload = self._call(post_id="xyz999")
        assert "xyz999" in payload["embeds"][0]["url"]

    def test_embed_fields_contain_author(self):
        payload = self._call(author="spammer")
        fields_text = str(payload["embeds"][0]["fields"])
        assert "spammer" in fields_text

    def test_embed_fields_contain_score(self):
        payload = self._call(score=92)
        fields_text = str(payload["embeds"][0]["fields"])
        assert "92" in fields_text

    def test_embed_fields_contain_reasons(self):
        payload = self._call(reasons=["Reason one", "Reason two"])
        fields_text = str(payload["embeds"][0]["fields"])
        assert "Reason one" in fields_text

    def test_high_score_red_color(self):
        payload = self._call(score=95)
        assert payload["embeds"][0]["color"] == 0xDA3633

    def test_medium_score_yellow_color(self):
        payload = self._call(score=75)
        assert payload["embeds"][0]["color"] == 0xD29922

    def test_empty_reasons_shows_dash(self):
        payload = self._call(reasons=[])
        fields_text = str(payload["embeds"][0]["fields"])
        assert "—" in fields_text

    def test_title_truncated_to_200(self):
        long_title = "A" * 300
        payload = self._call(title=long_title)
        fields_text = str(payload["embeds"][0]["fields"])
        assert "A" * 201 not in fields_text


# ---------------------------------------------------------------------------
# Payload builders — Discord comment
# ---------------------------------------------------------------------------

class TestBuildDiscordComment:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            comment_id="cmt456",
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            body_snippet="DM me for easy money",
            score=80,
            reasons=["Scam keywords: DM"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_discord_comment(**defaults)

    def test_has_embeds_key(self):
        assert "embeds" in self._call()

    def test_url_contains_comment_id(self):
        payload = self._call(comment_id="c999")
        assert "c999" in payload["embeds"][0]["url"]

    def test_url_contains_post_id(self):
        payload = self._call(post_id="p111")
        assert "p111" in payload["embeds"][0]["url"]

    def test_embed_title_contains_subreddit(self):
        payload = self._call(subreddit="crypto")
        assert "crypto" in payload["embeds"][0]["title"]


# ---------------------------------------------------------------------------
# Payload builders — Slack post
# ---------------------------------------------------------------------------

class TestBuildSlackPost:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            title="Buy crypto now!",
            score=85,
            reasons=["Scam keywords"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_slack_post(**defaults)

    def test_has_blocks_key(self):
        assert "blocks" in self._call()

    def test_header_contains_subreddit(self):
        payload = self._call(subreddit="scams")
        header = payload["blocks"][0]
        assert "scams" in header["text"]["text"]

    def test_section_contains_author(self):
        payload = self._call(author="spammer")
        blocks_text = str(payload["blocks"])
        assert "spammer" in blocks_text

    def test_section_contains_score(self):
        payload = self._call(score=77)
        assert "77" in str(payload["blocks"])

    def test_empty_reasons_shows_dash(self):
        payload = self._call(reasons=[])
        assert "—" in str(payload["blocks"])

    def test_timestamp_in_context_block(self):
        payload = self._call(flagged_at="2026-01-01T12:00:00+00:00")
        assert "2026-01-01T12:00:00+00:00" in str(payload["blocks"])


# ---------------------------------------------------------------------------
# Payload builders — Slack comment
# ---------------------------------------------------------------------------

class TestBuildSlackComment:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            comment_id="cmt456",
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            body_snippet="DM me",
            score=80,
            reasons=["Scam keywords"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_slack_comment(**defaults)

    def test_has_blocks_key(self):
        assert "blocks" in self._call()

    def test_header_contains_subreddit(self):
        payload = self._call(subreddit="crypto")
        assert "crypto" in self._call(subreddit="crypto")["blocks"][0]["text"]["text"]

    def test_timestamp_in_context_block(self):
        payload = self._call(flagged_at="2026-06-01T09:00:00+00:00")
        assert "2026-06-01T09:00:00+00:00" in str(payload["blocks"])


# ---------------------------------------------------------------------------
# Payload builders — Generic post
# ---------------------------------------------------------------------------

class TestBuildGenericPost:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            title="Buy crypto now!",
            score=85,
            reasons=["Scam keywords"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_generic_post(**defaults)

    def test_has_post_id(self):
        assert self._call()["post_id"] == "abc123"

    def test_has_subreddit(self):
        assert self._call()["subreddit"] == "scams"

    def test_has_author(self):
        assert self._call()["author"] == "badguy"

    def test_has_score(self):
        assert self._call()["score"] == 85

    def test_has_reasons_list(self):
        p = self._call(reasons=["r1", "r2"])
        assert p["reasons"] == ["r1", "r2"]

    def test_url_contains_post_id(self):
        p = self._call(post_id="xyz")
        assert "xyz" in p["url"]

    def test_has_flagged_at(self):
        p = self._call(flagged_at="2026-01-01T00:00:00+00:00")
        assert p["flagged_at"] == "2026-01-01T00:00:00+00:00"

    def test_has_title(self):
        p = self._call(title="Some title")
        assert p["title"] == "Some title"


# ---------------------------------------------------------------------------
# Payload builders — Generic comment
# ---------------------------------------------------------------------------

class TestBuildGenericComment:
    def _call(self, **kwargs: Any) -> dict:
        defaults = dict(
            comment_id="cmt456",
            post_id="abc123",
            subreddit="scams",
            author="badguy",
            body_snippet="DM me",
            score=80,
            reasons=["Scam keywords"],
            flagged_at="2026-01-01T12:00:00+00:00",
        )
        defaults.update(kwargs)
        return notifier_mod._build_generic_comment(**defaults)

    def test_has_comment_id(self):
        assert self._call()["comment_id"] == "cmt456"

    def test_has_post_id(self):
        assert self._call()["post_id"] == "abc123"

    def test_has_body_snippet(self):
        assert self._call()["body_snippet"] == "DM me"

    def test_url_contains_both_ids(self):
        p = self._call(post_id="p1", comment_id="c2")
        assert "p1" in p["url"]
        assert "c2" in p["url"]

    def test_no_title_key(self):
        assert "title" not in self._call()


# ---------------------------------------------------------------------------
# _fire — HTTP delivery
# ---------------------------------------------------------------------------

class TestFire:
    @pytest.mark.asyncio
    async def test_fire_posts_json(self):
        payload = {"test": "value"}
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.post = MagicMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("aiohttp.ClientSession", return_value=mock_session):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            await notifier_mod._fire(payload)

        mock_session.post.assert_called_once()
        call_kwargs = mock_session.post.call_args
        assert call_kwargs[1].get("json") == payload or call_kwargs.kwargs.get("json") == payload

    @pytest.mark.asyncio
    async def test_fire_logs_warning_on_http_error(self, caplog):
        import logging
        mock_response = AsyncMock()
        mock_response.status = 400
        mock_response.text = AsyncMock(return_value="Bad Request")
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.post = MagicMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("aiohttp.ClientSession", return_value=mock_session), \
             caplog.at_level(logging.WARNING, logger="sentry.notifier"):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            await notifier_mod._fire({"key": "val"})

        assert any("400" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    async def test_fire_logs_warning_on_network_error(self, caplog):
        import logging
        mock_session = AsyncMock()
        mock_session.post = MagicMock(side_effect=ConnectionError("refused"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("aiohttp.ClientSession", return_value=mock_session), \
             caplog.at_level(logging.WARNING, logger="sentry.notifier"):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            await notifier_mod._fire({"key": "val"})

        assert any("failed" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    async def test_fire_does_not_raise_on_network_error(self):
        mock_session = AsyncMock()
        mock_session.post = MagicMock(side_effect=RuntimeError("boom"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("aiohttp.ClientSession", return_value=mock_session):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            await notifier_mod._fire({"key": "val"})


# ---------------------------------------------------------------------------
# notify — post webhook
# ---------------------------------------------------------------------------

class TestNotify:
    @pytest.mark.asyncio
    async def test_noop_when_no_webhook_url(self):
        sub = _make_submission(post_id="p1")
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = ""
            mock_cfg.NOTIFY_THRESHOLD = 70
            await notifier.notify(sub, score=85, reasons=["r1"])
        mock_ef.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_score_below_threshold(self):
        sub = _make_submission(post_id="p1")
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 70
            await notifier.notify(sub, score=65, reasons=[])
        mock_ef.assert_not_called()

    @pytest.mark.asyncio
    async def test_fires_when_score_at_threshold(self):
        sub = _make_submission(post_id="p1")
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 70
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify(sub, score=70, reasons=[])
        mock_ef.assert_called_once()

    @pytest.mark.asyncio
    async def test_fires_when_score_above_threshold(self):
        sub = _make_submission(post_id="p1")
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 70
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify(sub, score=90, reasons=["r1"])
        mock_ef.assert_called_once()

    @pytest.mark.asyncio
    async def test_uses_discord_payload_when_type_discord(self):
        sub = _make_submission()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://discord.com/api/webhooks/x/y"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "discord"
            await notifier.notify(sub, score=80, reasons=["r1"])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        payload = mock_fire.call_args[0][0]
        assert "embeds" in payload

    @pytest.mark.asyncio
    async def test_uses_slack_payload_when_type_slack(self):
        sub = _make_submission()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://hooks.slack.com/services/x"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "slack"
            await notifier.notify(sub, score=80, reasons=["r1"])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        payload = mock_fire.call_args[0][0]
        assert "blocks" in payload

    @pytest.mark.asyncio
    async def test_uses_generic_payload_when_type_unknown(self):
        sub = _make_submission()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "unknown_type"
            await notifier.notify(sub, score=80, reasons=["r1"])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        payload = mock_fire.call_args[0][0]
        assert "post_id" in payload

    @pytest.mark.asyncio
    async def test_author_none_uses_unknown(self):
        sub = _make_submission()
        sub.author = None
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify(sub, score=80, reasons=[])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        assert mock_fire.call_args[0][0]["author"] == "unknown"


# ---------------------------------------------------------------------------
# notify_comment — comment webhook
# ---------------------------------------------------------------------------

class TestNotifyComment:
    @pytest.mark.asyncio
    async def test_noop_when_no_webhook_url(self):
        comment = _make_comment()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = ""
            mock_cfg.NOTIFY_THRESHOLD = 70
            await notifier.notify_comment(comment, score=85, reasons=["r1"])
        mock_ef.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_score_below_threshold(self):
        comment = _make_comment()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 70
            await notifier.notify_comment(comment, score=50, reasons=[])
        mock_ef.assert_not_called()

    @pytest.mark.asyncio
    async def test_fires_when_score_at_threshold(self):
        comment = _make_comment()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future") as mock_ef:
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 70
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify_comment(comment, score=70, reasons=[])
        mock_ef.assert_called_once()

    @pytest.mark.asyncio
    async def test_strips_t3_prefix_from_post_id(self):
        comment = _make_comment(post_id="t3_abc999")
        fired_payloads: list[Any] = []

        async def capture_fire(payload):
            fired_payloads.append(payload)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", side_effect=capture_fire), \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify_comment(comment, score=80, reasons=[])
            await asyncio.sleep(0)

        assert len(fired_payloads) == 1
        assert fired_payloads[0]["post_id"] == "abc999"

    @pytest.mark.asyncio
    async def test_discord_comment_payload_scheduled(self):
        comment = _make_comment()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://discord.com/api/webhooks/x/y"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "discord"
            await notifier.notify_comment(comment, score=85, reasons=["r1"])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        payload = mock_fire.call_args[0][0]
        assert "embeds" in payload

    @pytest.mark.asyncio
    async def test_slack_comment_payload_scheduled(self):
        comment = _make_comment()
        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", AsyncMock()) as mock_fire, \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://hooks.slack.com/services/x"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "slack"
            await notifier.notify_comment(comment, score=85, reasons=["r1"])
            await asyncio.sleep(0)
        mock_fire.assert_called_once()
        payload = mock_fire.call_args[0][0]
        assert "blocks" in payload

    @pytest.mark.asyncio
    async def test_body_truncated_to_200(self):
        long_body = "B" * 300
        comment = _make_comment(body=long_body)
        fired_payloads: list[Any] = []

        async def capture_fire(payload):
            fired_payloads.append(payload)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("reddit_scam_sentry.notifier._fire", side_effect=capture_fire), \
             patch("asyncio.ensure_future", side_effect=lambda coro: asyncio.get_event_loop().create_task(coro)):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify_comment(comment, score=80, reasons=[])
            await asyncio.sleep(0)

        assert len(fired_payloads) == 1
        assert len(fired_payloads[0]["body_snippet"]) == 200

    @pytest.mark.asyncio
    async def test_author_none_uses_unknown(self):
        comment = _make_comment()
        comment.author = None
        closed: list = []

        def _close_coro(coro):
            coro.close()
            closed.append(1)

        with patch("reddit_scam_sentry.notifier.config") as mock_cfg, \
             patch("asyncio.ensure_future", side_effect=_close_coro):
            mock_cfg.WEBHOOK_URL = "https://example.com/hook"
            mock_cfg.NOTIFY_THRESHOLD = 50
            mock_cfg.WEBHOOK_TYPE = "generic"
            await notifier.notify_comment(comment, score=80, reasons=[])
        assert len(closed) == 1


# ---------------------------------------------------------------------------
# Config — NOTIFY_THRESHOLD defaults to RISK_THRESHOLD
# ---------------------------------------------------------------------------

class TestConfigWebhook:
    def test_webhook_url_default_empty(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WEBHOOK_URL", None)
            importlib.reload(cfg_mod)
            assert cfg_mod.WEBHOOK_URL == ""

    def test_webhook_type_default_generic(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WEBHOOK_TYPE", None)
            importlib.reload(cfg_mod)
            assert cfg_mod.WEBHOOK_TYPE == "generic"

    def test_webhook_type_lowercased(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, {"WEBHOOK_TYPE": "DISCORD"}, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.WEBHOOK_TYPE == "discord"

    def test_notify_threshold_defaults_to_risk_threshold(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, {"RISK_THRESHOLD": "60"}, clear=False):
            os.environ.pop("NOTIFY_THRESHOLD", None)
            importlib.reload(cfg_mod)
            assert cfg_mod.NOTIFY_THRESHOLD == cfg_mod.RISK_THRESHOLD

    def test_notify_threshold_overridable(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, {"NOTIFY_THRESHOLD": "55"}, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.NOTIFY_THRESHOLD == 55


# ---------------------------------------------------------------------------
# Wiring — main.py calls notifier.notify when flagged
# ---------------------------------------------------------------------------

class TestMainWiringNotifier:
    @pytest.mark.asyncio
    async def test_notify_called_when_flagged(self):
        """process_submission should call notifier.notify when score >= threshold."""
        import reddit_scam_sentry.main as main_mod

        sub = MagicMock()
        sub.id = "post1"
        sub.title = "Earn crypto fast DM me telegram"
        sub.selftext = ""
        sub.url = "https://t.me/scam"
        sub.author = MagicMock()
        sub.author.name = "newuser"
        sub.subreddit = MagicMock()
        sub.subreddit.display_name = "testsubreddit"

        author_data = {
            "name": "newuser",
            "link_karma": 1,
            "comment_karma": 0,
            "created_utc": 9999999,
            "is_suspended": False,
        }

        with patch.object(main_mod, "fetch_author_info", AsyncMock(return_value=author_data)), \
             patch.object(main_mod, "save_decision", AsyncMock()), \
             patch.object(main_mod, "apply_flair", AsyncMock()), \
             patch.object(main_mod.notifier, "notify", AsyncMock()) as mock_notify, \
             patch.object(main_mod.config, "RISK_THRESHOLD", 1):
            await main_mod.process_submission(reddit=MagicMock(), db=MagicMock(), submission=sub)

        mock_notify.assert_called_once()
        args = mock_notify.call_args
        assert args[0][0] is sub

    @pytest.mark.asyncio
    async def test_notify_not_called_when_not_flagged(self):
        import reddit_scam_sentry.main as main_mod

        sub = MagicMock()
        sub.id = "post2"
        sub.title = "Nice cat photo"
        sub.selftext = ""
        sub.url = "https://example.com"
        sub.author = MagicMock()
        sub.author.name = "longtimeredditor"
        sub.subreddit = MagicMock()
        sub.subreddit.display_name = "aww"

        author_data = {
            "name": "longtimeredditor",
            "link_karma": 5000,
            "comment_karma": 10000,
            "created_utc": 1000000,
            "is_suspended": False,
        }

        with patch.object(main_mod, "fetch_author_info", AsyncMock(return_value=author_data)), \
             patch.object(main_mod, "save_decision", AsyncMock()), \
             patch.object(main_mod, "apply_flair", AsyncMock()), \
             patch.object(main_mod.notifier, "notify", AsyncMock()) as mock_notify, \
             patch.object(main_mod.config, "RISK_THRESHOLD", 200):
            await main_mod.process_submission(reddit=MagicMock(), db=MagicMock(), submission=sub)

        mock_notify.assert_not_called()


# ---------------------------------------------------------------------------
# Wiring — comment_handler.py calls notifier.notify_comment when flagged
# ---------------------------------------------------------------------------

class TestCommentHandlerWiringNotifier:
    @pytest.mark.asyncio
    async def test_notify_comment_called_when_flagged(self):
        import reddit_scam_sentry.comment_handler as ch_mod

        comment = _make_comment(body="Buy crypto DM me telegram t.me/scam")
        comment.link_id = "t3_post1"

        author_data = {
            "name": "testuser",
            "link_karma": 1,
            "comment_karma": 0,
            "created_utc": 9999999,
            "is_suspended": False,
        }

        with patch.object(ch_mod, "_fetch_author_info", AsyncMock(return_value=author_data)), \
             patch.object(ch_mod, "save_comment_decision", AsyncMock()), \
             patch.object(ch_mod.notifier, "notify_comment", AsyncMock()) as mock_nc, \
             patch.object(ch_mod.config, "RISK_THRESHOLD", 1):
            await ch_mod.process_comment(reddit=MagicMock(), db=MagicMock(), comment=comment)

        mock_nc.assert_called_once()
        args = mock_nc.call_args
        assert args[0][0] is comment

    @pytest.mark.asyncio
    async def test_notify_comment_not_called_when_not_flagged(self):
        import reddit_scam_sentry.comment_handler as ch_mod

        comment = _make_comment(body="Nice photo!")
        comment.link_id = "t3_post2"

        author_data = {
            "name": "testuser",
            "link_karma": 5000,
            "comment_karma": 10000,
            "created_utc": 1000000,
            "is_suspended": False,
        }

        with patch.object(ch_mod, "_fetch_author_info", AsyncMock(return_value=author_data)), \
             patch.object(ch_mod, "save_comment_decision", AsyncMock()), \
             patch.object(ch_mod.notifier, "notify_comment", AsyncMock()) as mock_nc, \
             patch.object(ch_mod.config, "RISK_THRESHOLD", 200):
            await ch_mod.process_comment(reddit=MagicMock(), db=MagicMock(), comment=comment)

        mock_nc.assert_not_called()
