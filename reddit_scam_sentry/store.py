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
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS comment_decisions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            comment_id   TEXT NOT NULL UNIQUE,
            post_id      TEXT NOT NULL,
            subreddit    TEXT NOT NULL,
            author       TEXT NOT NULL,
            body_snippet TEXT NOT NULL,
            score        INTEGER NOT NULL,
            reasons      TEXT NOT NULL,
            flagged      INTEGER NOT NULL,
            decided_at   REAL NOT NULL
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


async def get_recent_flagged_bodies(
    db: aiosqlite.Connection,
    limit: int = 50,
) -> list[str]:
    """Return the body/title text of the most recent flagged decisions.

    Queries both the ``decisions`` (title) and ``comment_decisions`` (body_snippet)
    tables so the similarity engine has a broad picture of recent scam content.
    """
    rows: list[str] = []
    async with db.execute(
        """
        SELECT title FROM decisions
        WHERE flagged = 1
        ORDER BY decided_at DESC
        LIMIT ?
        """,
        (limit,),
    ) as cursor:
        async for row in cursor:
            if row[0]:
                rows.append(row[0])

    remaining = max(0, limit - len(rows))
    if remaining > 0:
        async with db.execute(
            """
            SELECT body_snippet FROM comment_decisions
            WHERE flagged = 1
            ORDER BY decided_at DESC
            LIMIT ?
            """,
            (remaining,),
        ) as cursor:
            async for row in cursor:
                if row[0]:
                    rows.append(row[0])

    return rows


async def save_comment_decision(
    db: aiosqlite.Connection,
    *,
    comment_id: str,
    post_id: str,
    subreddit: str,
    author: str,
    body_snippet: str,
    score: int,
    reasons: list[str],
    flagged: bool,
) -> None:
    now = time.time()
    await db.execute(
        """
        INSERT OR IGNORE INTO comment_decisions
            (comment_id, post_id, subreddit, author, body_snippet,
             score, reasons, flagged, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            comment_id,
            post_id,
            subreddit,
            author,
            body_snippet,
            score,
            json.dumps(reasons),
            int(flagged),
            now,
        ),
    )
    await db.commit()
