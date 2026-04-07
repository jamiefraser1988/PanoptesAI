# Reddit Scam Sentry

A server-side moderator bot that monitors subreddit posts in real time, scores each one for scam/bot risk using rule-based signals, and optionally applies post flair to flag suspicious content.

## Features

- **Real-time post streaming** from one or more subreddits
- **Rule-based risk scoring** (0–100) with human-readable reasons
- **SQLite audit log** — every decision persisted with score and reasons
- **Author caching** — user profile stats cached for 6 hours to stay within API rate limits
- **Optional mod action** — automatically flair flagged posts (requires moderator access)
- **Reconnect/backoff** — streams restart with exponential backoff on failure

## Scoring Signals

| Signal | Points |
|--------|--------|
| Scam keywords in title/body (telegram, crypto, DM me, etc.) | up to 40 |
| Suspicious link shorteners (t.me, bit.ly, etc.) | up to 30 |
| High external link count (≥3 links) | 5 |
| Account age < 7 days | 30 |
| Account age < 30 days | 15 |
| Zero comment karma + non-zero link karma | 15–20 |
| Bot-like username pattern (letters + many digits) | 15 |

## Prerequisites

- Python 3.10+
- A Reddit account for the bot
- A Reddit API app (type: **script**) created at https://www.reddit.com/prefs/apps
- If using flair: the bot account must be a **moderator** with flair permissions in the target subreddit

## Setup

### 1. Create a Reddit API App

1. Go to https://www.reddit.com/prefs/apps
2. Click **"create another app…"**
3. Choose type: **script**
4. Set redirect URI to: `http://localhost:8080` (required by the form, not used for script apps)
5. Note down the **client_id** (shown under the app name) and **client_secret**

### 2. Install Dependencies

```bash
python -m venv .venv

# Linux / macOS:
source .venv/bin/activate

# Windows PowerShell:
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Key settings in `.env`:

```env
REDDIT_CLIENT_ID=xxx
REDDIT_CLIENT_SECRET=xxx
REDDIT_USERNAME=your_bot_username
REDDIT_PASSWORD=your_bot_password
REDDIT_USER_AGENT=ScamSentry/0.1 by u/your_username

SUBREDDITS=your_test_sub          # comma-separated list
RISK_THRESHOLD=70                  # 0–100; posts at or above this are flagged
ACTION_MODE=none                   # none | flair
```

### 4. Smoke Test (verify connectivity)

```bash
python smoke_test.py
```

Expected output:
```
✓ Logged in as: u/your_bot_username
✓ Subreddit accessible: r/your_test_sub (12,345 subscribers)

Smoke test PASSED — credentials and subreddit access OK.
```

### 5. Run the Bot

```bash
python reddit_scam_sentry/main.py
```

The bot will stream new posts and print a line for each:

```
2026-01-01T12:00:00 [WARNING] sentry.main — FLAGGED | r/test | score=85 | post=abc123 | author=user123456 | Buy crypto now! | reasons=Scam keywords: crypto, telegram; Very new account: 3 days old
2026-01-01T12:00:01 [INFO] sentry.main — OK      | r/test | score=10 | post=def456 | author=longtime_user | Look at my cat
```

## Enabling Flair

1. Ensure your bot account is a moderator with flair permissions in the target subreddit
2. Set `ACTION_MODE=flair` in `.env`
3. Optionally customise `FLAG_FLAIR_TEXT` and `FLAG_FLAIR_CSS`

The bot will try `flair.select()` first (for subreddits with a flair template), then fall back to `mod.flair()` (direct CSS flair).

## Inspecting the Database

Decisions are stored in `sentry.db` (SQLite). You can inspect them with any SQLite browser or the CLI:

```bash
sqlite3 sentry.db "SELECT post_id, author, score, reasons, flagged FROM decisions ORDER BY decided_at DESC LIMIT 20;"
```

## Known Gotchas

### 2FA / Two-Factor Authentication

If your bot account has 2FA enabled, username/password authentication will fail with a `403 INVALID_GRANT` error. Solutions:

- **Recommended**: Disable 2FA on the bot account (use a dedicated bot account, not your personal one)
- **Alternative**: Implement an OAuth refresh-token flow (beyond MVP scope)

### Flair Requires Moderator Access

The bot must be a moderator with at least "Flair" permissions. You can verify this in your subreddit's mod settings. Without the right permissions, flair calls will silently fail (the error is logged but the bot continues running).

### Reddit Rate Limits

Reddit allows ~100 API calls per minute for script apps. The bot caches author data for 6 hours (`USER_CACHE_TTL_SECONDS`) to reduce calls. If you monitor high-traffic subreddits, you may need to increase the TTL or reduce the number of subreddits.

### Infinite Streams

The asyncpraw stream is long-lived. If Reddit's connection drops, the bot retries with exponential backoff (2s, 4s, 8s … up to 300s). This is logged so you can see reconnections happening.

## Project Structure

```
reddit_scam_sentry/
├── __init__.py
├── config.py          — reads .env and exposes typed settings
├── logging_setup.py   — configures structured console logging
├── reddit_client.py   — creates authenticated asyncpraw.Reddit instance
├── scorer.py          — rule-based risk scoring engine
├── actions.py         — applies mod actions (flair) to flagged posts
├── store.py           — SQLite persistence (user_cache + decisions tables)
├── utils.py           — helpers: exponential backoff, text truncation
└── main.py            — main loop: stream → score → log → store → act
smoke_test.py          — connectivity / credential verification script
.env.example           — environment variable template
requirements.txt       — Python dependencies
```

## Phase 2 Roadmap

- Comment scanning (many scams happen in replies)
- Recent-history checks (author's last N posts/comments)
- Text similarity detection (reused scam pitches across subs)
- Discord / Slack / webhook alerting for high-risk posts
- Mod feedback loop (true/false positive) to tune scoring
- FastAPI dashboard for flagged queue + analytics
- Multi-subreddit SaaS management + advanced scoring tiers
