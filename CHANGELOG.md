# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-07

### Added

#### Core Bot
- Real-time post streaming from one or more subreddits via `asyncpraw`
- Rule-based risk scoring engine (0–100) with human-readable reason strings
- SQLite audit log persisting every decision with post ID, author, score, reasons, and timestamp
- Author profile caching (6-hour TTL) to stay within Reddit API rate limits
- Optional mod action: automatically apply post flair to flagged content
- Exponential backoff reconnect on stream failure

#### Scoring Signals
- Scam keyword detection in title and body (up to 40 pts)
- Suspicious link shortener detection (t.me, bit.ly, etc.) (up to 30 pts)
- High external link count heuristic (5 pts)
- New account age signals: <7 days (30 pts), <30 days (15 pts)
- Zero comment karma + non-zero link karma (15–20 pts)
- Bot-like username pattern (digits suffix) (15 pts)
- Cross-subreddit repost detection via Jaccard similarity (25 pts)
- TF-IDF cosine similarity to previously-flagged posts (20 pts)

#### Comment Scanning
- Stream comments in parallel alongside posts
- Per-comment scam scoring and SQLite audit log

#### FastAPI Dashboard
- `GET /decisions` — paginated list of recent post decisions
- `GET /comment_decisions` — paginated list of recent comment decisions
- `GET /stats` — aggregate counts, top subreddits, top flagged authors

#### Alerting & Webhooks
- Discord, Slack, and generic webhook notifications for flagged content
- Fire-and-forget async delivery; configurable threshold and webhook URL

#### Production Packaging
- `pyproject.toml` with setuptools backend, full metadata, and `[dev]` extras
- `Dockerfile` using `python:3.12-slim`, non-root `sentry` user
- `docker-compose.yml` with bot + dashboard services, `.env` file, and DB volume mount
- `deploy/sentry.service` systemd unit for bare-metal Linux deployments
- `.github/workflows/ci.yml` GitHub Actions CI across Python 3.10, 3.11, 3.12
- `scam-sentry` console script entry point

### Configuration

All configuration is via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `REDDIT_CLIENT_ID` | required | Reddit app client ID |
| `REDDIT_CLIENT_SECRET` | required | Reddit app client secret |
| `REDDIT_USERNAME` | required | Bot account username |
| `REDDIT_PASSWORD` | required | Bot account password |
| `REDDIT_USER_AGENT` | required | HTTP user agent string |
| `SUBREDDITS` | required | Comma-separated list of subreddits |
| `RISK_THRESHOLD` | `70` | Minimum score to flag a post |
| `ACTION_MODE` | `log` | `log`, `flair`, or `remove` |
| `SCAN_COMMENTS` | `false` | Enable comment scanning |
| `WEBHOOK_URL` | — | Webhook URL for alerts |
| `WEBHOOK_TYPE` | `generic` | `discord`, `slack`, or `generic` |
| `NOTIFY_THRESHOLD` | `80` | Minimum score to fire a webhook alert |
| `HISTORY_POSTS_LIMIT` | `10` | Posts fetched per author for history check |
| `SIMILARITY_THRESHOLD` | `0.6` | Cosine similarity threshold for flagging |
