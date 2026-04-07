"""
Unit tests for reddit_scam_sentry/store.py

Uses an in-memory aiosqlite database — no file I/O.
"""

import json
import time
from unittest.mock import patch

import aiosqlite
import pytest

from reddit_scam_sentry.store import (
    init_db,
    get_cached_author,
    set_cached_author,
    save_decision,
)


@pytest.fixture
async def db():
    async with aiosqlite.connect(":memory:") as conn:
        await init_db(conn)
        yield conn


class TestInitDb:
    async def test_creates_user_cache_table(self, db):
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='user_cache'"
        ) as cur:
            row = await cur.fetchone()
        assert row is not None

    async def test_creates_decisions_table(self, db):
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='decisions'"
        ) as cur:
            row = await cur.fetchone()
        assert row is not None

    async def test_idempotent_on_second_call(self, db):
        await init_db(db)
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ) as cur:
            rows = await cur.fetchall()
        table_names = {r[0] for r in rows}
        assert "user_cache" in table_names
        assert "decisions" in table_names


class TestGetCachedAuthor:
    async def test_returns_none_when_not_cached(self, db):
        result = await get_cached_author(db, "nonexistent_user")
        assert result is None

    async def test_returns_data_when_fresh(self, db):
        data = {"name": "testuser", "link_karma": 100, "comment_karma": 200}
        await set_cached_author(db, "testuser", data)
        result = await get_cached_author(db, "testuser")
        assert result is not None
        assert result["link_karma"] == 100
        assert result["comment_karma"] == 200

    async def test_returns_none_when_expired(self, db):
        data = {"name": "olduser", "link_karma": 10}
        past_time = time.time() - (7 * 3600)
        async with db.execute(
            "INSERT INTO user_cache (username, data_json, cached_at) VALUES (?, ?, ?)",
            ("olduser", json.dumps(data), past_time),
        ):
            pass
        await db.commit()

        result = await get_cached_author(db, "olduser")
        assert result is None

    async def test_returns_data_just_within_ttl(self, db):
        data = {"name": "freshuser", "link_karma": 50}
        just_fresh = time.time() - (6 * 3600 - 60)
        async with db.execute(
            "INSERT INTO user_cache (username, data_json, cached_at) VALUES (?, ?, ?)",
            ("freshuser", json.dumps(data), just_fresh),
        ):
            pass
        await db.commit()

        result = await get_cached_author(db, "freshuser")
        assert result is not None
        assert result["link_karma"] == 50


class TestSetCachedAuthor:
    async def test_inserts_new_entry(self, db):
        data = {"name": "newuser", "link_karma": 0}
        await set_cached_author(db, "newuser", data)
        result = await get_cached_author(db, "newuser")
        assert result is not None
        assert result["name"] == "newuser"

    async def test_updates_existing_entry(self, db):
        data_v1 = {"name": "user", "link_karma": 10}
        await set_cached_author(db, "user", data_v1)

        data_v2 = {"name": "user", "link_karma": 99}
        await set_cached_author(db, "user", data_v2)

        result = await get_cached_author(db, "user")
        assert result is not None
        assert result["link_karma"] == 99

    async def test_stored_data_roundtrips_json(self, db):
        data = {
            "name": "complex_user",
            "link_karma": 42,
            "comment_karma": 1337,
            "created_utc": 1700000000.0,
            "is_suspended": False,
        }
        await set_cached_author(db, "complex_user", data)
        result = await get_cached_author(db, "complex_user")
        assert result == data


class TestSaveDecision:
    async def test_saves_decision_record(self, db):
        await save_decision(
            db,
            post_id="abc123",
            subreddit="test",
            author="spammer",
            title="Buy crypto",
            score=85,
            reasons=["Scam keywords: crypto"],
            flagged=True,
        )
        async with db.execute(
            "SELECT post_id, score, flagged FROM decisions WHERE post_id = 'abc123'"
        ) as cur:
            row = await cur.fetchone()

        assert row is not None
        post_id, score, flagged = row
        assert post_id == "abc123"
        assert score == 85
        assert flagged == 1

    async def test_saves_unflagged_decision(self, db):
        await save_decision(
            db,
            post_id="def456",
            subreddit="test",
            author="normal_person",
            title="My cat",
            score=5,
            reasons=[],
            flagged=False,
        )
        async with db.execute(
            "SELECT flagged FROM decisions WHERE post_id = 'def456'"
        ) as cur:
            row = await cur.fetchone()

        assert row is not None
        assert row[0] == 0

    async def test_reasons_stored_as_json(self, db):
        reasons = ["Scam keywords: telegram", "New account: 3 days old"]
        await save_decision(
            db,
            post_id="xyz789",
            subreddit="test",
            author="scammer",
            title="Title",
            score=60,
            reasons=reasons,
            flagged=False,
        )
        async with db.execute(
            "SELECT reasons FROM decisions WHERE post_id = 'xyz789'"
        ) as cur:
            row = await cur.fetchone()

        assert row is not None
        stored_reasons = json.loads(row[0])
        assert stored_reasons == reasons

    async def test_duplicate_post_id_ignored(self, db):
        kwargs = dict(
            post_id="dup001",
            subreddit="test",
            author="user",
            title="Title",
            score=10,
            reasons=[],
            flagged=False,
        )
        await save_decision(db, **kwargs)
        await save_decision(db, **kwargs)

        async with db.execute(
            "SELECT COUNT(*) FROM decisions WHERE post_id = 'dup001'"
        ) as cur:
            row = await cur.fetchone()

        assert row[0] == 1

    async def test_multiple_decisions_stored_independently(self, db):
        for i in range(5):
            await save_decision(
                db,
                post_id=f"post_{i}",
                subreddit="test",
                author=f"user_{i}",
                title=f"Title {i}",
                score=i * 10,
                reasons=[],
                flagged=False,
            )

        async with db.execute("SELECT COUNT(*) FROM decisions") as cur:
            row = await cur.fetchone()

        assert row[0] == 5
