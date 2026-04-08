"""Database helpers for the dashboard."""

from __future__ import annotations

import json
import os
from typing import Optional

import aiosqlite
from dotenv import load_dotenv

load_dotenv()

DB_PATH: str = os.environ.get("DB_PATH", "./sentry.db")

_db: Optional[aiosqlite.Connection] = None


async def get_db() -> aiosqlite.Connection:
    if _db is None:
        raise RuntimeError(
            "Database connection is not open. "
            "Ensure the app lifespan has started before calling get_db()."
        )
    return _db


async def open_db() -> None:
    global _db
    _db = await aiosqlite.connect(DB_PATH)
    _db.row_factory = aiosqlite.Row
    await _migrate(_db)


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def _migrate(db: aiosqlite.Connection) -> None:
    """Apply schema migrations gracefully."""
    await db.execute(
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
            decided_at  REAL NOT NULL
        )
        """
    )
    existing_cols = await _get_columns(db, "decisions")
    optional_cols = {
        "feedback": "ALTER TABLE decisions ADD COLUMN feedback TEXT",
        "body": "ALTER TABLE decisions ADD COLUMN body TEXT NOT NULL DEFAULT ''",
        "ai_score": "ALTER TABLE decisions ADD COLUMN ai_score INTEGER",
        "ai_summary": "ALTER TABLE decisions ADD COLUMN ai_summary TEXT",
        "ai_signals": "ALTER TABLE decisions ADD COLUMN ai_signals TEXT",
        "ai_action": "ALTER TABLE decisions ADD COLUMN ai_action TEXT",
    }
    for col, stmt in optional_cols.items():
        if col not in existing_cols:
            try:
                await db.execute(stmt)
            except Exception:
                pass
    await db.commit()


async def _get_columns(db: aiosqlite.Connection, table: str) -> set[str]:
    async with db.execute(f"PRAGMA table_info({table})") as cur:
        rows = await cur.fetchall()
    return {row["name"] for row in rows}


def _row_to_decision(row: aiosqlite.Row) -> dict:
    d = dict(row)
    d["reasons"] = json.loads(d["reasons"]) if d["reasons"] else []
    d["flagged"] = bool(d["flagged"])
    if "ai_signals" in d and d["ai_signals"]:
        try:
            d["ai_signals"] = json.loads(d["ai_signals"])
        except (json.JSONDecodeError, TypeError):
            d["ai_signals"] = []
    elif "ai_signals" in d:
        d["ai_signals"] = None
    return d
