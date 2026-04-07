import time
import json
import aiosqlite
from reddit_scam_sentry import config


async def init_db(db: aiosqlite.Connection) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS user_cache (
            username    TEXT PRIMARY KEY,
            data_json   TEXT NOT NULL,
            cached_at   REAL NOT NULL
        )
        """
    )
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
    await db.commit()


async def get_cached_author(db: aiosqlite.Connection, username: str) -> dict | None:
    now = time.time()
    async with db.execute(
        "SELECT data_json, cached_at FROM user_cache WHERE username = ?", (username,)
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None
    data_json, cached_at = row
    age = now - cached_at
    if age > config.USER_CACHE_TTL_SECONDS:
        return None
    return json.loads(data_json)


async def set_cached_author(db: aiosqlite.Connection, username: str, data: dict) -> None:
    now = time.time()
    await db.execute(
        """
        INSERT INTO user_cache (username, data_json, cached_at)
        VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET data_json = excluded.data_json, cached_at = excluded.cached_at
        """,
        (username, json.dumps(data), now),
    )
    await db.commit()


async def save_decision(
    db: aiosqlite.Connection,
    *,
    post_id: str,
    subreddit: str,
    author: str,
    title: str,
    score: int,
    reasons: list[str],
    flagged: bool,
) -> None:
    now = time.time()
    await db.execute(
        """
        INSERT OR IGNORE INTO decisions
            (post_id, subreddit, author, title, score, reasons, flagged, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            post_id,
            subreddit,
            author,
            title,
            score,
            json.dumps(reasons),
            int(flagged),
            now,
        ),
    )
    await db.commit()
