"""
Integration tests for the FastAPI moderator dashboard.
Uses httpx.AsyncClient with ASGITransport against an in-memory SQLite DB.
"""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock, patch

import aiosqlite
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
async def override_db(tmp_path):
    """
    Replace the global dashboard DB connection with a fresh in-memory DB
    (backed by a temp file so aiosqlite.connect works without special args).
    """
    db_path = str(tmp_path / "test_sentry.db")
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS decisions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id     TEXT NOT NULL UNIQUE,
            subreddit   TEXT NOT NULL,
            author      TEXT NOT NULL,
            title       TEXT NOT NULL,
            score       INTEGER NOT NULL,
            reasons     TEXT NOT NULL,
            flagged     INTEGER NOT NULL,
            decided_at  REAL NOT NULL,
            feedback    TEXT
        )
        """
    )
    await conn.commit()

    import dashboard.db as db_module
    original = db_module._db
    db_module._db = conn
    yield conn
    db_module._db = original
    await conn.close()


async def _insert(db: aiosqlite.Connection, **kwargs) -> None:
    defaults = dict(
        post_id="abc123",
        subreddit="test",
        author="user1",
        title="Test post",
        score=80,
        reasons=json.dumps(["Scam keywords: crypto"]),
        flagged=1,
        decided_at=time.time(),
        feedback=None,
    )
    defaults.update(kwargs)
    await db.execute(
        """
        INSERT INTO decisions (post_id, subreddit, author, title, score, reasons, flagged, decided_at, feedback)
        VALUES (:post_id, :subreddit, :author, :title, :score, :reasons, :flagged, :decided_at, :feedback)
        """,
        defaults,
    )
    await db.commit()


@pytest.fixture()
async def client(override_db):
    from dashboard.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestDecisionsEndpoint:
    async def test_empty_returns_empty_list(self, client):
        resp = await client.get("/decisions")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_inserted_decision(self, client, override_db):
        await _insert(override_db)
        resp = await client.get("/decisions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["post_id"] == "abc123"
        assert data[0]["score"] == 80
        assert data[0]["flagged"] is True
        assert isinstance(data[0]["reasons"], list)
        assert "Scam keywords: crypto" in data[0]["reasons"]

    async def test_filter_by_flagged_true(self, client, override_db):
        await _insert(override_db, post_id="p1", flagged=1)
        await _insert(override_db, post_id="p2", flagged=0)
        resp = await client.get("/decisions?flagged=true")
        assert resp.status_code == 200
        ids = [d["post_id"] for d in resp.json()]
        assert "p1" in ids
        assert "p2" not in ids

    async def test_filter_by_flagged_false(self, client, override_db):
        await _insert(override_db, post_id="p1", flagged=1)
        await _insert(override_db, post_id="p2", flagged=0)
        resp = await client.get("/decisions?flagged=false")
        assert resp.status_code == 200
        ids = [d["post_id"] for d in resp.json()]
        assert "p2" in ids
        assert "p1" not in ids

    async def test_filter_by_subreddit(self, client, override_db):
        await _insert(override_db, post_id="p1", subreddit="scams")
        await _insert(override_db, post_id="p2", subreddit="gaming")
        resp = await client.get("/decisions?subreddit=scams")
        assert resp.status_code == 200
        data = resp.json()
        assert all(d["subreddit"] == "scams" for d in data)
        assert len(data) == 1

    async def test_pagination_limit(self, client, override_db):
        for i in range(5):
            await _insert(override_db, post_id=f"post_{i}")
        resp = await client.get("/decisions?limit=2&offset=0")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_pagination_offset(self, client, override_db):
        for i in range(5):
            await _insert(override_db, post_id=f"post_{i}")
        resp_all = await client.get("/decisions?limit=5&offset=0")
        resp_offset = await client.get("/decisions?limit=5&offset=3")
        all_ids = [d["post_id"] for d in resp_all.json()]
        offset_ids = [d["post_id"] for d in resp_offset.json()]
        assert len(offset_ids) == 2
        assert offset_ids == all_ids[3:]


class TestDecisionDetailEndpoint:
    async def test_returns_decision(self, client, override_db):
        await _insert(override_db, post_id="detail1")
        resp = await client.get("/decisions/detail1")
        assert resp.status_code == 200
        assert resp.json()["post_id"] == "detail1"

    async def test_returns_404_for_missing(self, client):
        resp = await client.get("/decisions/nonexistent")
        assert resp.status_code == 404

    async def test_reasons_is_list(self, client, override_db):
        await _insert(override_db, post_id="r1", reasons=json.dumps(["a", "b"]))
        resp = await client.get("/decisions/r1")
        assert resp.json()["reasons"] == ["a", "b"]


class TestStatsEndpoint:
    async def test_empty_db_stats(self, client):
        resp = await client.get("/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_posts"] == 0
        assert data["flagged_posts"] == 0
        assert data["flag_rate_pct"] == 0.0
        assert data["by_subreddit"] == []
        assert data["top_reasons"] == []

    async def test_counts_correctly(self, client, override_db):
        await _insert(override_db, post_id="p1", flagged=1, subreddit="a")
        await _insert(override_db, post_id="p2", flagged=1, subreddit="a")
        await _insert(override_db, post_id="p3", flagged=0, subreddit="b")
        resp = await client.get("/stats")
        data = resp.json()
        assert data["total_posts"] == 3
        assert data["flagged_posts"] == 2
        assert data["flag_rate_pct"] == pytest.approx(66.7, abs=0.1)

    async def test_per_subreddit_breakdown(self, client, override_db):
        await _insert(override_db, post_id="p1", flagged=1, subreddit="alpha")
        await _insert(override_db, post_id="p2", flagged=0, subreddit="beta")
        resp = await client.get("/stats")
        subs = {s["subreddit"]: s for s in resp.json()["by_subreddit"]}
        assert "alpha" in subs
        assert subs["alpha"]["total"] == 1
        assert subs["alpha"]["flagged"] == 1
        assert subs["beta"]["flagged"] == 0

    async def test_top_reasons(self, client, override_db):
        reasons = json.dumps(["Keyword hit: scam", "Suspicious link"])
        await _insert(override_db, post_id="p1", flagged=1, reasons=reasons)
        await _insert(override_db, post_id="p2", flagged=1, reasons=reasons)
        resp = await client.get("/stats")
        top = {r["reason"]: r["count"] for r in resp.json()["top_reasons"]}
        assert top.get("Keyword hit: scam") == 2
        assert top.get("Suspicious link") == 2


class TestFeedbackEndpoint:
    async def test_submit_true_positive(self, client, override_db):
        await _insert(override_db, post_id="fb1")
        resp = await client.post(
            "/decisions/fb1/feedback", json={"verdict": "true_positive"}
        )
        assert resp.status_code == 200
        assert resp.json()["feedback"] == "true_positive"

    async def test_submit_false_positive(self, client, override_db):
        await _insert(override_db, post_id="fb2")
        resp = await client.post(
            "/decisions/fb2/feedback", json={"verdict": "false_positive"}
        )
        assert resp.status_code == 200
        assert resp.json()["feedback"] == "false_positive"

    async def test_submit_unclear(self, client, override_db):
        await _insert(override_db, post_id="fb3")
        resp = await client.post(
            "/decisions/fb3/feedback", json={"verdict": "unclear"}
        )
        assert resp.status_code == 200
        assert resp.json()["feedback"] == "unclear"

    async def test_returns_404_for_missing(self, client):
        resp = await client.post(
            "/decisions/nope/feedback", json={"verdict": "unclear"}
        )
        assert resp.status_code == 404

    async def test_invalid_verdict_returns_422(self, client, override_db):
        await _insert(override_db, post_id="fb4")
        resp = await client.post(
            "/decisions/fb4/feedback", json={"verdict": "invalid_value"}
        )
        assert resp.status_code == 422

    async def test_verdict_persisted_to_db(self, client, override_db):
        await _insert(override_db, post_id="fb5")
        await client.post(
            "/decisions/fb5/feedback", json={"verdict": "true_positive"}
        )
        resp = await client.get("/decisions/fb5")
        assert resp.json()["feedback"] == "true_positive"


class TestHTMLPage:
    async def test_returns_html(self, client):
        resp = await client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert "Scam Sentry" in resp.text

    async def test_shows_flagged_post(self, client, override_db):
        await _insert(override_db, post_id="html1", title="Buy crypto now", flagged=1)
        resp = await client.get("/")
        assert "Buy crypto now" in resp.text
        assert "html1" in resp.text

    async def test_shows_stats(self, client, override_db):
        await _insert(override_db, post_id="s1", flagged=1)
        resp = await client.get("/")
        assert "1" in resp.text

    async def test_filter_by_subreddit_param(self, client, override_db):
        await _insert(override_db, post_id="sub1", subreddit="memes", title="Meme post")
        await _insert(override_db, post_id="sub2", subreddit="other", title="Other post")
        resp = await client.get("/?subreddit=memes")
        assert "Meme post" in resp.text
        assert "Other post" not in resp.text
