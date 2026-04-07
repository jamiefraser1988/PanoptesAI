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
    save_comment_decision,
    get_recent_flagged_bodies,
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
        fixed_now = 1_700_000_000.0
        cached_at = fixed_now - (7 * 3600)
        async with db.execute(
            "INSERT INTO user_cache (username, data_json, cached_at) VALUES (?, ?, ?)",
            ("olduser", json.dumps(data), cached_at),
        ):
            pass
        await db.commit()

        with patch("reddit_scam_sentry.store.time.time", return_value=fixed_now):
            result = await get_cached_author(db, "olduser")
        assert result is None

    async def test_returns_data_just_within_ttl(self, db):
        data = {"name": "freshuser", "link_karma": 50}
        fixed_now = 1_700_000_000.0
        cached_at = fixed_now - (6 * 3600 - 60)
        async with db.execute(
            "INSERT INTO user_cache (username, data_json, cached_at) VALUES (?, ?, ?)",
            ("freshuser", json.dumps(data), cached_at),
        ):
            pass
        await db.commit()

        with patch("reddit_scam_sentry.store.time.time", return_value=fixed_now):
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


class TestGetRecentFlaggedBodies:
    async def test_returns_empty_when_no_flagged_decisions(self, db):
        bodies = await get_recent_flagged_bodies(db)
        assert bodies == []

    async def test_returns_only_flagged_post_titles(self, db):
        await save_decision(
            db,
            post_id="flagged1",
            subreddit="test",
            author="spammer",
            title="Buy crypto now dm me telegram",
            score=85,
            reasons=["Scam keywords"],
            flagged=True,
        )
        await save_decision(
            db,
            post_id="clean1",
            subreddit="test",
            author="cleanuser",
            title="My cat photo",
            score=5,
            reasons=[],
            flagged=False,
        )

        bodies = await get_recent_flagged_bodies(db)
        assert "Buy crypto now dm me telegram" in bodies
        assert "My cat photo" not in bodies

    async def test_uses_body_over_title_when_available(self, db):
        await save_decision(
            db,
            post_id="bodypost",
            subreddit="test",
            author="spammer",
            title="Short title",
            body="This is the full post body with scam content",
            score=85,
            reasons=["Scam keywords"],
            flagged=True,
        )
        bodies = await get_recent_flagged_bodies(db)
        assert "This is the full post body with scam content" in bodies
        assert "Short title" not in bodies

    async def test_falls_back_to_title_when_body_empty(self, db):
        await save_decision(
            db,
            post_id="titleonly",
            subreddit="test",
            author="spammer",
            title="Title only scam post",
            body="",
            score=85,
            reasons=["Scam keywords"],
            flagged=True,
        )
        bodies = await get_recent_flagged_bodies(db)
        assert "Title only scam post" in bodies

    async def test_returns_flagged_comment_bodies(self, db):
        await save_comment_decision(
            db,
            comment_id="cmt1",
            post_id="post1",
            subreddit="test",
            author="spammer",
            body_snippet="DM me for easy crypto profits",
            score=80,
            reasons=["Scam keywords"],
            flagged=True,
        )

        bodies = await get_recent_flagged_bodies(db)
        assert "DM me for easy crypto profits" in bodies

    async def test_combines_posts_and_comments_up_to_limit(self, db):
        for i in range(3):
            await save_decision(
                db,
                post_id=f"fp{i}",
                subreddit="test",
                author="sp",
                title=f"Flagged post {i}",
                score=80,
                reasons=[],
                flagged=True,
            )
        for i in range(3):
            await save_comment_decision(
                db,
                comment_id=f"fc{i}",
                post_id=f"p{i}",
                subreddit="test",
                author="sp",
                body_snippet=f"Flagged comment {i}",
                score=80,
                reasons=[],
                flagged=True,
            )

        bodies = await get_recent_flagged_bodies(db, limit=6)
        assert len(bodies) == 6

    async def test_respects_limit(self, db):
        for i in range(10):
            await save_decision(
                db,
                post_id=f"fp{i}",
                subreddit="test",
                author="sp",
                title=f"Flagged post {i}",
                score=80,
                reasons=[],
                flagged=True,
            )

        bodies = await get_recent_flagged_bodies(db, limit=5)
        assert len(bodies) == 5

    async def test_posts_fill_limit_before_comments(self, db):
        for i in range(3):
            await save_decision(
                db,
                post_id=f"fp{i}",
                subreddit="test",
                author="sp",
                title=f"Post {i}",
                score=80,
                reasons=[],
                flagged=True,
            )
            await save_comment_decision(
                db,
                comment_id=f"fc{i}",
                post_id=f"p{i}",
                subreddit="test",
                author="sp",
                body_snippet=f"Comment {i}",
                score=80,
                reasons=[],
                flagged=True,
            )

        bodies = await get_recent_flagged_bodies(db, limit=3)
        assert len(bodies) == 3
        assert all(b.startswith("Post") for b in bodies)
