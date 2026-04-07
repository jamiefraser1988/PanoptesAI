"""
Tests for comment_handler.py and the store extensions for comment decisions.

Uses in-memory SQLite + AsyncMock asyncpraw objects — no network calls.
"""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest

from reddit_scam_sentry.store import init_db, save_comment_decision


@pytest.fixture()
async def db(tmp_path):
    db_path = str(tmp_path / "test.db")
    async with aiosqlite.connect(db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await init_db(conn)
        yield conn


def _make_comment(
    *,
    comment_id: str = "abc123",
    author_name: str = "testuser",
    body: str = "Hello world",
    subreddit_name: str = "test",
    link_id: str = "t3_postid",
) -> MagicMock:
    comment = MagicMock()
    comment.id = comment_id
    comment.body = body
    comment.link_id = link_id

    author = MagicMock()
    author.name = author_name
    comment.author = author

    subreddit = MagicMock()
    subreddit.display_name = subreddit_name
    comment.subreddit = subreddit

    return comment


def _make_reddit(
    *,
    link_karma: int = 100,
    comment_karma: int = 500,
    created_utc: float | None = None,
) -> AsyncMock:
    if created_utc is None:
        created_utc = time.time() - 365 * 24 * 3600
    redditor = AsyncMock()
    redditor.link_karma = link_karma
    redditor.comment_karma = comment_karma
    redditor.created_utc = created_utc
    redditor.is_suspended = False

    reddit = AsyncMock()
    reddit.redditor = AsyncMock(return_value=redditor)
    return reddit


class TestSaveCommentDecision:
    async def test_saves_basic_record(self, db):
        await save_comment_decision(
            db,
            comment_id="c1",
            post_id="p1",
            subreddit="test",
            author="user1",
            body_snippet="Hello there",
            score=30,
            reasons=["Scam keywords: crypto"],
            flagged=False,
        )
        async with db.execute("SELECT * FROM comment_decisions WHERE comment_id = 'c1'") as cur:
            row = await cur.fetchone()
        assert row is not None
        assert row["post_id"] == "p1"
        assert row["author"] == "user1"
        assert row["score"] == 30
        assert row["flagged"] == 0
        assert json.loads(row["reasons"]) == ["Scam keywords: crypto"]

    async def test_saves_flagged_record(self, db):
        await save_comment_decision(
            db,
            comment_id="c2",
            post_id="p2",
            subreddit="scams",
            author="spammer",
            body_snippet="Buy crypto now",
            score=85,
            reasons=["Scam keywords: crypto", "Suspicious link"],
            flagged=True,
        )
        async with db.execute("SELECT flagged FROM comment_decisions WHERE comment_id = 'c2'") as cur:
            row = await cur.fetchone()
        assert row["flagged"] == 1

    async def test_duplicate_comment_id_ignored(self, db):
        kwargs = dict(
            comment_id="c3",
            post_id="p3",
            subreddit="test",
            author="user",
            body_snippet="text",
            score=10,
            reasons=[],
            flagged=False,
        )
        await save_comment_decision(db, **kwargs)
        await save_comment_decision(db, **kwargs)
        async with db.execute("SELECT COUNT(*) FROM comment_decisions WHERE comment_id = 'c3'") as cur:
            count = (await cur.fetchone())[0]
        assert count == 1

    async def test_reasons_stored_as_json(self, db):
        reasons = ["reason A", "reason B", "reason C"]
        await save_comment_decision(
            db,
            comment_id="c4",
            post_id="p4",
            subreddit="test",
            author="u",
            body_snippet="text",
            score=50,
            reasons=reasons,
            flagged=True,
        )
        async with db.execute("SELECT reasons FROM comment_decisions WHERE comment_id = 'c4'") as cur:
            row = await cur.fetchone()
        assert json.loads(row["reasons"]) == reasons

    async def test_body_snippet_stored(self, db):
        await save_comment_decision(
            db,
            comment_id="c5",
            post_id="p5",
            subreddit="test",
            author="u",
            body_snippet="This is the snippet text",
            score=0,
            reasons=[],
            flagged=False,
        )
        async with db.execute("SELECT body_snippet FROM comment_decisions WHERE comment_id = 'c5'") as cur:
            row = await cur.fetchone()
        assert row["body_snippet"] == "This is the snippet text"

    async def test_multiple_decisions_stored_independently(self, db):
        for i in range(3):
            await save_comment_decision(
                db,
                comment_id=f"multi_{i}",
                post_id="p0",
                subreddit="test",
                author="user",
                body_snippet="text",
                score=i * 10,
                reasons=[],
                flagged=False,
            )
        async with db.execute("SELECT COUNT(*) FROM comment_decisions") as cur:
            count = (await cur.fetchone())[0]
        assert count == 3


class TestInitDbCreatesCommentTable:
    async def test_comment_decisions_table_exists(self, db):
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='comment_decisions'"
        ) as cur:
            row = await cur.fetchone()
        assert row is not None

    async def test_comment_decisions_has_expected_columns(self, db):
        async with db.execute("PRAGMA table_info(comment_decisions)") as cur:
            rows = await cur.fetchall()
        col_names = {r["name"] for r in rows}
        required = {
            "id", "comment_id", "post_id", "subreddit", "author",
            "body_snippet", "score", "reasons", "flagged", "decided_at",
        }
        assert required <= col_names

    async def test_init_db_idempotent_for_comment_table(self, db):
        await init_db(db)
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='comment_decisions'"
        ) as cur:
            row = await cur.fetchone()
        assert row is not None


class TestProcessComment:
    async def test_clean_comment_scores_low_and_stored(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        comment = _make_comment(body="Nice post, thanks!")
        reddit = _make_reddit()

        with patch("reddit_scam_sentry.comment_handler.get_cached_author", return_value=None), \
             patch("reddit_scam_sentry.comment_handler.set_cached_author", new_callable=AsyncMock):
            await process_comment(reddit, db, comment)

        async with db.execute("SELECT * FROM comment_decisions WHERE comment_id = 'abc123'") as cur:
            row = await cur.fetchone()
        assert row is not None
        assert row["flagged"] == 0

    async def test_scam_comment_flagged(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        body = "Send crypto to my telegram for guaranteed returns! bit.ly/scam"
        comment = _make_comment(body=body, comment_id="scam1")
        reddit = _make_reddit(
            link_karma=1,
            comment_karma=0,
            created_utc=time.time() - 2 * 24 * 3600,
        )

        with patch("reddit_scam_sentry.comment_handler.get_cached_author", return_value=None), \
             patch("reddit_scam_sentry.comment_handler.set_cached_author", new_callable=AsyncMock):
            await process_comment(reddit, db, comment)

        async with db.execute("SELECT flagged, score FROM comment_decisions WHERE comment_id = 'scam1'") as cur:
            row = await cur.fetchone()
        assert row is not None
        assert row["flagged"] == 1
        assert row["score"] >= 70

    async def test_deleted_author_skipped(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        comment = _make_comment()
        comment.author = None
        reddit = _make_reddit()

        await process_comment(reddit, db, comment)

        async with db.execute("SELECT COUNT(*) FROM comment_decisions") as cur:
            count = (await cur.fetchone())[0]
        assert count == 0

    async def test_cached_author_used(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        cached_data = {
            "name": "testuser",
            "link_karma": 1000,
            "comment_karma": 2000,
            "created_utc": time.time() - 500 * 24 * 3600,
            "is_suspended": False,
        }
        comment = _make_comment(comment_id="cached1")
        reddit = _make_reddit()

        with patch(
            "reddit_scam_sentry.comment_handler.get_cached_author",
            return_value=cached_data,
        ):
            await process_comment(reddit, db, comment)

        reddit.redditor.assert_not_called()

    async def test_post_id_stripped_of_t3_prefix(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        comment = _make_comment(comment_id="strip1", link_id="t3_xyz789")
        redis = _make_reddit()

        with patch("reddit_scam_sentry.comment_handler.get_cached_author", return_value=None), \
             patch("reddit_scam_sentry.comment_handler.set_cached_author", new_callable=AsyncMock):
            await process_comment(redis, db, comment)

        async with db.execute("SELECT post_id FROM comment_decisions WHERE comment_id = 'strip1'") as cur:
            row = await cur.fetchone()
        assert row["post_id"] == "xyz789"

    async def test_body_snippet_truncated_to_200_chars(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        long_body = "a" * 300
        comment = _make_comment(comment_id="trunc1", body=long_body)
        reddit = _make_reddit()

        with patch("reddit_scam_sentry.comment_handler.get_cached_author", return_value=None), \
             patch("reddit_scam_sentry.comment_handler.set_cached_author", new_callable=AsyncMock):
            await process_comment(reddit, db, comment)

        async with db.execute("SELECT body_snippet FROM comment_decisions WHERE comment_id = 'trunc1'") as cur:
            row = await cur.fetchone()
        assert len(row["body_snippet"]) <= 203

    async def test_api_failure_uses_fallback_author(self, db):
        from reddit_scam_sentry.comment_handler import process_comment

        comment = _make_comment(comment_id="fallback1")
        reddit = AsyncMock()
        reddit.redditor = AsyncMock(side_effect=Exception("API down"))

        with patch("reddit_scam_sentry.comment_handler.get_cached_author", return_value=None), \
             patch("reddit_scam_sentry.comment_handler.set_cached_author", new_callable=AsyncMock):
            await process_comment(reddit, db, comment)

        async with db.execute("SELECT * FROM comment_decisions WHERE comment_id = 'fallback1'") as cur:
            row = await cur.fetchone()
        assert row is not None


class TestConfigScanComments:
    def _reload_config(self, env: dict) -> "types.ModuleType":
        import importlib
        import os
        import types
        import reddit_scam_sentry.config as cfg_mod
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(cfg_mod)
            return cfg_mod

    def test_scan_comments_default_is_true(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        env = {
            "REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "x",
            "REDDIT_USERNAME": "x", "REDDIT_PASSWORD": "x",
        }
        env.pop("SCAN_COMMENTS", None)
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("SCAN_COMMENTS", None)
            importlib.reload(cfg_mod)
            assert cfg_mod.SCAN_COMMENTS is True

    def test_scan_comments_false_string(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        env = {
            "REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "x",
            "REDDIT_USERNAME": "x", "REDDIT_PASSWORD": "x",
            "SCAN_COMMENTS": "false",
        }
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.SCAN_COMMENTS is False

    def test_scan_comments_zero_string(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        env = {
            "REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "x",
            "REDDIT_USERNAME": "x", "REDDIT_PASSWORD": "x",
            "SCAN_COMMENTS": "0",
        }
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.SCAN_COMMENTS is False

    def test_scan_comments_no_string(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        env = {
            "REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "x",
            "REDDIT_USERNAME": "x", "REDDIT_PASSWORD": "x",
            "SCAN_COMMENTS": "no",
        }
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.SCAN_COMMENTS is False

    def test_scan_comments_true_string(self):
        import os
        import importlib
        import reddit_scam_sentry.config as cfg_mod
        env = {
            "REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "x",
            "REDDIT_USERNAME": "x", "REDDIT_PASSWORD": "x",
            "SCAN_COMMENTS": "true",
        }
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(cfg_mod)
            assert cfg_mod.SCAN_COMMENTS is True


class TestMainWiring:
    """Verify main() creates the right set of asyncio tasks based on SCAN_COMMENTS."""

    def _make_db_context(self):
        """Returns a fake aiosqlite context manager yielding a mock DB."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(return_value=db)
        cm.__aexit__ = AsyncMock(return_value=False)
        return cm

    def _collecting_create_task(self, captured: list):
        """Return a create_task side-effect that closes coroutines to avoid warnings."""
        def _create_task(coro):
            captured.append(getattr(coro, "__qualname__", type(coro).__name__))
            coro.close()
            return AsyncMock()
        return _create_task

    async def test_scan_comments_enabled_creates_both_task_types(self):
        import reddit_scam_sentry.main as main_mod
        import reddit_scam_sentry.config as cfg_mod

        captured: list = []
        db_cm = self._make_db_context()

        with patch.object(cfg_mod, "SCAN_COMMENTS", True), \
             patch.object(cfg_mod, "SUBREDDITS", ["testA"]), \
             patch("aiosqlite.connect", return_value=db_cm), \
             patch("reddit_scam_sentry.main.init_db", new_callable=AsyncMock), \
             patch("reddit_scam_sentry.main.make_reddit") as mock_reddit, \
             patch("asyncio.create_task", side_effect=self._collecting_create_task(captured)), \
             patch("asyncio.gather", new_callable=AsyncMock):
            reddit_inst = AsyncMock()
            reddit_inst.close = AsyncMock()
            mock_reddit.return_value = reddit_inst

            await main_mod.main()

        assert len(captured) == 2

    async def test_scan_comments_disabled_creates_only_post_tasks(self):
        import reddit_scam_sentry.main as main_mod
        import reddit_scam_sentry.config as cfg_mod

        captured: list = []
        db_cm = self._make_db_context()

        with patch.object(cfg_mod, "SCAN_COMMENTS", False), \
             patch.object(cfg_mod, "SUBREDDITS", ["testA"]), \
             patch("aiosqlite.connect", return_value=db_cm), \
             patch("reddit_scam_sentry.main.init_db", new_callable=AsyncMock), \
             patch("reddit_scam_sentry.main.make_reddit") as mock_reddit, \
             patch("asyncio.create_task", side_effect=self._collecting_create_task(captured)), \
             patch("asyncio.gather", new_callable=AsyncMock):
            reddit_inst = AsyncMock()
            reddit_inst.close = AsyncMock()
            mock_reddit.return_value = reddit_inst

            await main_mod.main()

        assert len(captured) == 1

    async def test_two_subreddits_with_comments_creates_four_tasks(self):
        import reddit_scam_sentry.main as main_mod
        import reddit_scam_sentry.config as cfg_mod

        captured: list = []
        db_cm = self._make_db_context()

        with patch.object(cfg_mod, "SCAN_COMMENTS", True), \
             patch.object(cfg_mod, "SUBREDDITS", ["sub1", "sub2"]), \
             patch("aiosqlite.connect", return_value=db_cm), \
             patch("reddit_scam_sentry.main.init_db", new_callable=AsyncMock), \
             patch("reddit_scam_sentry.main.make_reddit") as mock_reddit, \
             patch("asyncio.create_task", side_effect=self._collecting_create_task(captured)), \
             patch("asyncio.gather", new_callable=AsyncMock):
            reddit_inst = AsyncMock()
            reddit_inst.close = AsyncMock()
            mock_reddit.return_value = reddit_inst

            await main_mod.main()

        assert len(captured) == 4
