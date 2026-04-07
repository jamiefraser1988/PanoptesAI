"""
Reddit Scam Sentry — Moderator Dashboard

FastAPI app that reads sentry.db and exposes:
  GET  /                             — HTML flagged-post queue
  GET  /decisions                    — paginated JSON list
  GET  /decisions/{post_id}          — single decision JSON
  GET  /stats                        — aggregate analytics JSON
  POST /decisions/{post_id}/feedback — mark true/false positive

Run with:
    uvicorn dashboard.main:app --reload --port 8001
or:
    python -m dashboard.main
"""

from __future__ import annotations

import json
import math
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from dashboard.db import open_db, close_db, get_db, _row_to_decision, DB_PATH
from dashboard.models import (
    DecisionOut,
    DecisionDetail,
    FeedbackRequest,
    StatsOut,
    SubredditStat,
    ReasonStat,
)
from dashboard.html_template import build_page, build_row, EMPTY_TABLE


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_db()
    yield
    await close_db()


app = FastAPI(
    title="Reddit Scam Sentry Dashboard",
    description="Moderator dashboard for reviewing flagged posts and providing feedback.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _format_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _score_class(score: int) -> str:
    if score >= 70:
        return "score-high"
    if score >= 40:
        return "score-mid"
    return "score-low"


def _feedback_classes(feedback: Optional[str]) -> tuple[str, str, str]:
    cls_tp = "active-tp" if feedback == "true_positive" else ""
    cls_fp = "active-fp" if feedback == "false_positive" else ""
    cls_un = "active-un" if feedback == "unclear" else ""
    return cls_tp, cls_fp, cls_un


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def html_queue(
    subreddit: str = Query(""),
    min_score: str = Query(""),
    page: int = Query(1, ge=1),
) -> HTMLResponse:
    db = await get_db()
    per_page = 50

    conditions = ["flagged = 1"]
    params: list = []
    if subreddit:
        conditions.append("subreddit = ?")
        params.append(subreddit)
    if min_score:
        try:
            conditions.append("score >= ?")
            params.append(int(min_score))
        except ValueError:
            pass

    where = " AND ".join(conditions)

    async with db.execute(f"SELECT COUNT(*) FROM decisions WHERE {where}", params) as cur:
        total_flagged = (await cur.fetchone())[0]

    total_pages = max(1, math.ceil(total_flagged / per_page))
    page = min(page, total_pages)
    offset = (page - 1) * per_page

    async with db.execute(
        f"SELECT * FROM decisions WHERE {where} ORDER BY decided_at DESC LIMIT ? OFFSET ?",
        [*params, per_page, offset],
    ) as cur:
        rows = await cur.fetchall()

    async with db.execute("SELECT COUNT(*) FROM decisions") as cur:
        total_posts = (await cur.fetchone())[0]
    async with db.execute("SELECT COUNT(*) FROM decisions WHERE flagged = 1") as cur:
        total_flag_count = (await cur.fetchone())[0]

    flag_rate = round(100 * total_flag_count / total_posts, 1) if total_posts else 0.0

    async with db.execute(
        "SELECT DISTINCT subreddit FROM decisions ORDER BY subreddit"
    ) as cur:
        subs = [r[0] for r in await cur.fetchall()]
    sub_options = "\n".join(
        f'<option value="{s}" {"selected" if s == subreddit else ""}>{s}</option>'
        for s in subs
    )

    sel50 = 'selected' if min_score == "50" else ""
    sel70 = 'selected' if min_score == "70" else ""
    sel90 = 'selected' if min_score == "90" else ""

    if not rows:
        table_html = EMPTY_TABLE
    else:
        rows_html = ""
        for row in rows:
            d = _row_to_decision(row)
            cls_tp, cls_fp, cls_un = _feedback_classes(d.get("feedback"))
            reasons_str = " &bull; ".join(d["reasons"]) if d["reasons"] else "&mdash;"
            rows_html += build_row(
                post_id=d["post_id"],
                title=d["title"][:120],
                subreddit=d["subreddit"],
                author=d["author"],
                score=d["score"],
                score_class=_score_class(d["score"]),
                decided_at=_format_ts(d["decided_at"]),
                reasons=reasons_str,
                cls_tp=cls_tp,
                cls_fp=cls_fp,
                cls_un=cls_un,
            )
        table_html = (
            "<table>"
            "<thead><tr>"
            "<th>Post</th><th>Subreddit</th><th>Author</th>"
            "<th>Score</th><th>Time</th><th>Feedback</th>"
            "</tr></thead>"
            "<tbody>" + rows_html + "</tbody>"
            "</table>"
        )

    qs_base = "?subreddit=" + subreddit + "&min_score=" + min_score
    prev_link = (
        '<a href="' + qs_base + '&page=' + str(page - 1) + '">&#8592; Prev</a>'
        if page > 1 else '<span>&#8592; Prev</span>'
    )
    next_link = (
        '<a href="' + qs_base + '&page=' + str(page + 1) + '">Next &#8594;</a>'
        if page < total_pages else '<span>Next &#8594;</span>'
    )

    html = build_page(
        total_posts=total_posts,
        flagged_posts=total_flag_count,
        flag_rate_pct=flag_rate,
        subreddit_options=sub_options,
        sel50=sel50,
        sel70=sel70,
        sel90=sel90,
        table_html=table_html,
        page=page,
        total_pages=total_pages,
        prev_link=prev_link,
        next_link=next_link,
    )
    return HTMLResponse(content=html)


@app.get("/decisions", response_model=list[DecisionOut])
async def list_decisions(
    flagged: Optional[bool] = Query(None),
    subreddit: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    db = await get_db()

    conditions: list[str] = []
    params: list = []
    if flagged is not None:
        conditions.append("flagged = ?")
        params.append(1 if flagged else 0)
    if subreddit:
        conditions.append("subreddit = ?")
        params.append(subreddit)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT * FROM decisions {where} ORDER BY decided_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    async with db.execute(query, params) as cur:
        rows = await cur.fetchall()

    return [_row_to_decision(r) for r in rows]


@app.get("/decisions/{post_id}", response_model=DecisionDetail)
async def get_decision(post_id: str) -> dict:
    db = await get_db()
    async with db.execute(
        "SELECT * FROM decisions WHERE post_id = ?", (post_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Decision for post '{post_id}' not found")
    return _row_to_decision(row)


@app.get("/stats", response_model=StatsOut)
async def get_stats() -> dict:
    db = await get_db()

    async with db.execute("SELECT COUNT(*) FROM decisions") as cur:
        total_posts = (await cur.fetchone())[0]
    async with db.execute("SELECT COUNT(*) FROM decisions WHERE flagged = 1") as cur:
        flagged_posts = (await cur.fetchone())[0]

    flag_rate = round(100 * flagged_posts / total_posts, 1) if total_posts else 0.0

    async with db.execute(
        """
        SELECT subreddit,
               COUNT(*) AS total,
               SUM(flagged) AS flagged
        FROM decisions
        GROUP BY subreddit
        ORDER BY total DESC
        """
    ) as cur:
        sub_rows = await cur.fetchall()

    by_subreddit = [
        SubredditStat(subreddit=r["subreddit"], total=r["total"], flagged=r["flagged"] or 0)
        for r in sub_rows
    ]

    async with db.execute(
        "SELECT reasons FROM decisions WHERE flagged = 1 AND reasons != '[]'"
    ) as cur:
        reason_rows = await cur.fetchall()

    reason_counter: Counter[str] = Counter()
    for row in reason_rows:
        try:
            for reason in json.loads(row[0]):
                reason_counter[reason] += 1
        except (json.JSONDecodeError, TypeError):
            pass

    top_reasons = [
        ReasonStat(reason=r, count=c)
        for r, c in reason_counter.most_common(10)
    ]

    return StatsOut(
        total_posts=total_posts,
        flagged_posts=flagged_posts,
        flag_rate_pct=flag_rate,
        by_subreddit=by_subreddit,
        top_reasons=top_reasons,
    )


@app.post("/decisions/{post_id}/feedback", response_model=DecisionDetail)
async def submit_feedback(post_id: str, body: FeedbackRequest) -> dict:
    db = await get_db()

    async with db.execute(
        "SELECT post_id FROM decisions WHERE post_id = ?", (post_id,)
    ) as cur:
        exists = await cur.fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Decision for post '{post_id}' not found")

    await db.execute(
        "UPDATE decisions SET feedback = ? WHERE post_id = ?",
        (body.verdict.value, post_id),
    )
    await db.commit()

    async with db.execute(
        "SELECT * FROM decisions WHERE post_id = ?", (post_id,)
    ) as cur:
        row = await cur.fetchone()

    return _row_to_decision(row)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DASHBOARD_PORT", "8001"))
    uvicorn.run("dashboard.main:app", host="0.0.0.0", port=port, reload=False)
