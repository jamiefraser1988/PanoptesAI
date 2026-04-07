# Reddit Scam Sentry — Moderator Dashboard

A lightweight FastAPI web app that gives moderators a real-time view of the bot's decisions — flagged post queue, score breakdowns, analytics, and a feedback loop for marking true/false positives.

## Features

- **Flagged queue** — HTML table of recent flagged posts with score, reasons, author, and direct Reddit links
- **Feedback buttons** — one-click True positive / False positive / Unclear verdicts stored in the DB
- **Analytics** — per-subreddit stats, top triggered reasons, overall flag rate
- **JSON API** — full REST API for scripted access or future integrations
- **Auto-migration** — adds the `feedback` column to existing `sentry.db` on first run, non-destructively

## Prerequisites

- Python 3.10+
- The same `sentry.db` file that the bot writes to (can be on the same machine or mounted)
- The bot has run at least once to create the `decisions` table

## Setup

```bash
# From the repo root — activate the same venv or create a new one
pip install -r dashboard/requirements.txt
```

## Running

The dashboard reads `DB_PATH` from the environment (same as the bot). It defaults to `./sentry.db`.

```bash
# Simple start (from repo root):
uvicorn dashboard.main:app --port 8001

# With auto-reload during development:
uvicorn dashboard.main:app --reload --port 8001

# Or via the module entrypoint:
python -m dashboard.main
```

Set `DASHBOARD_PORT` to override the default port when using the module entrypoint:

```env
DASHBOARD_PORT=8001
DB_PATH=./sentry.db
```

Open http://localhost:8001 in your browser.

## Running alongside the bot

Run both in separate terminals (or as separate systemd services):

**Terminal 1 — bot:**
```bash
python reddit_scam_sentry/main.py
```

**Terminal 2 — dashboard:**
```bash
uvicorn dashboard.main:app --port 8001
```

Both processes share `sentry.db` safely — the dashboard only reads and writes the `feedback` column; the bot only writes new rows.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML flagged queue (filterable by subreddit & min score) |
| `GET` | `/decisions` | Paginated JSON list of all decisions |
| `GET` | `/decisions/{post_id}` | Single decision detail |
| `GET` | `/stats` | Aggregate analytics |
| `POST` | `/decisions/{post_id}/feedback` | Submit mod feedback verdict |
| `GET` | `/docs` | Interactive Swagger UI |

### GET /decisions

Query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `flagged` | bool | — | Filter by flagged status |
| `subreddit` | string | — | Filter by subreddit name |
| `limit` | int | 50 | Results per page (max 500) |
| `offset` | int | 0 | Pagination offset |

### POST /decisions/{post_id}/feedback

Request body:
```json
{ "verdict": "true_positive" }
```

Valid verdicts: `true_positive`, `false_positive`, `unclear`

Returns the updated decision record.

### GET /stats

```json
{
  "total_posts": 1234,
  "flagged_posts": 89,
  "flag_rate_pct": 7.2,
  "by_subreddit": [
    { "subreddit": "test", "total": 800, "flagged": 60 }
  ],
  "top_reasons": [
    { "reason": "Scam keywords: telegram, crypto", "count": 45 }
  ]
}
```

## Database Schema

The dashboard adds one optional column to the existing `decisions` table:

```sql
ALTER TABLE decisions ADD COLUMN feedback TEXT;
-- values: 'true_positive' | 'false_positive' | 'unclear' | NULL
```

This migration runs automatically on startup and is safe to run against a DB that already has the column.
