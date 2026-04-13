# PanoptesAI — Work Tracker

_Last updated: 12 April 2026_

---

## Completed Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Project setup — pnpm monorepo, TypeScript, Express API, React+Vite dashboard | DONE | Full stack scaffolded |
| 2 | Python scoring engine (FastAPI + asyncpraw) — 10+ rule-based scam/bot signals | DONE | Scores 0–100, SQLite persistence, 269 tests passing |
| 3 | Devvit Reddit app — PostSubmit/CommentSubmit triggers, sends to API for scoring | DONE | Per-subreddit settings, API key auth |
| 4 | Clerk authentication — sign-in/sign-up, protected routes, tenant auto-provisioning | DONE | Clerk React + Express middleware |
| 5 | Multi-tenant PostgreSQL config — Drizzle ORM, tenant_configs table | DONE | Score threshold, watched subreddits, webhook, action mode |
| 6 | Flagged Queue page (/dashboard) — review scored content, approve/flag actions | DONE | Sorting, filtering, pagination |
| 7 | Analytics page (/analytics) — trends, score distribution, daily activity charts | DONE | Recharts-based visualizations |
| 8 | Configuration page (/config) — threshold slider, subreddit management, webhook setup | DONE | DB-persisted per tenant |
| 9 | Bulk actions in queue — checkboxes, select all, bulk approve/flag | DONE | Floating action bar |
| 10 | Keyboard shortcuts — j/k navigate, a=safe, s=scam, x=select, Esc=clear, ?=help | DONE | Help modal included |
| 11 | User reputation side panel — click author for history, avg score, subreddits | DONE | Sheet panel with risk level |
| 12 | Allowlist/Blocklist — trusted/blocked user management in config | DONE | Persisted in DB as JSONB |
| 13 | Smart Rule Builder — custom automation rules (field+operator+value → action) | DONE | Saved to tenant_configs |
| 14 | Mod Action Log page (/mod-log) — audit trail of all moderation actions | DONE | Auto-logged on feedback, filterable |
| 15 | Notification bell — header bell showing recent high-risk (70+) detections | DONE | Auto-refresh every 30s |
| 16 | Threat Intelligence — cross-subreddit threat map + type distribution pie chart | DONE | Added to analytics page |
| 17 | Security hardening — mod action logging locked to server-only, error handling | DONE | Client POST returns 403, retry UI |
| 18 | Eyes of Panoptes mini-game — 5x5 grid defense game as Devvit interactive post | DONE | Waves, lives, leaderboard with Redis |
| 19 | Logo + color rebrand — new shield+eye logo, cyan/blue color scheme site-wide | DONE | CSS theme vars, hero logo, sidebar, headers |
| 20 | Canonical truth phase 1 — Node-only product routes on PostgreSQL with canonical content/scoring/label tables | DONE | Added `content_items`, `scoring_runs`, `label_events`; queue/stats/feedback/user profile no longer rely on FastAPI |

---

## In Progress

| # | Task | Status | Notes |
|---|------|--------|-------|
| 21 | Devvit app approval on Reddit Developer Portal | WAITING | Submitted, pending Reddit review — blocks live monitoring |
| 22 | ML shadow scoring integration | IN PROGRESS | Node remains the product backend; optional internal scorer can enrich scoring runs without owning product routes |

---

## Future / Planned

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23 | End-to-end live monitoring test — verify full pipeline once Devvit is approved | PLANNED | Devvit → Node API → PostgreSQL → dashboard |
| 24 | Discord/Slack webhook notifications — send alerts when high-risk content detected | PLANNED | Webhook URL/type already in config schema |
| 25 | Dataset export and offline evaluation jobs | PLANNED | Pull labeled data from PostgreSQL for repeatable ML evaluation |
| 26 | ML ranking rollout | PLANNED | Shadow scoring must beat rules-only before it changes queue order |
| 27 | Publish latest build to production | PLANNED | Deploy to workspace-jfwizkid.replit.app |
| 28 | GitHub repo sync — push latest changes | PLANNED | Repo: jamiefraser1988/PanoptesAI |

---

## Key Blockers

- **Devvit approval**: No live Reddit data until the Devvit app is approved and installed on subreddits
- **Schema push still required**: New canonical tables need to be pushed to PostgreSQL before the updated API can serve canonical routes in production

---

## Architecture Quick Reference

| Component | Location | Port | Status |
|-----------|----------|------|--------|
| React Dashboard | artifacts/modarchitect/ | Vite dev server | Running |
| Express API Server | artifacts/api-server/ | 8080 | Running |
| Internal Shadow Scoring (optional) | FASTAPI_URL target | 8001 or Cloud Run | Optional |
| Devvit Reddit App | devvit-app/ | — | Pending approval |
| PostgreSQL Database | lib/db/ | — | Connected |
