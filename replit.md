# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Clerk (`@clerk/react`, `@clerk/express`)

## Architecture

### Canonical Truth
- **Node/Express** is the only public backend for the product.
- **PostgreSQL** is the system of record for content, scoring runs, labels, tenant config, analytics, and audit history.
- **Moderator feedback** is stored as first-class label events and is the canonical human truth.
- **FastAPI/Python is optional internal-only scoring infrastructure**. Product routes must continue to work when `FASTAPI_URL` is unset.

### Devvit Reddit App (devvit-app/)
- Reddit Developer Platform (Devvit) app — runs on Reddit's servers
- Triggers on PostSubmit and CommentSubmit events
- Sends content to the fixed production PanoptesAI API for scoring via HTTP
- Takes mod actions (report/remove) based on score and the matched tenant action mode
- Tenant routing is resolved server-side by matching the subreddit against dashboard `watched_subreddits`
- Deploy: `cd devvit-app && npm install && devvit login && devvit upload`

### Python Bot — Legacy (reddit_scam_sentry/)
- Real-time Reddit streaming via asyncpraw (requires pre-Nov 2025 OAuth credentials)
- Scam/bot risk scoring (0-100) with 10+ rule-based signals
- SQLite persistence for decisions and feedback
- FastAPI dashboard backend on port 8001
- Feedback loop: mod verdicts adjust future scores via `_feedback_adjustment()` in `scorer.py`
- This stack is legacy and is no longer the product system of record

### TypeScript API Server (artifacts/api-server/)
- Express 5 on port 8080
- Clerk middleware protects all `/api` routes (except `/api/healthz` and `/api/devvit/*`)
- `/api/devvit/scan` — scoring endpoint for Devvit app (no Clerk; resolves tenant by `watched_subreddits`)
- `/api/devvit/health` — health check for Devvit app
- Product reads and writes are PostgreSQL-native
- Devvit ingestion writes canonical `content_items`, `scoring_runs`, then `mod_actions`
- Dashboard feedback writes `label_events` and a matching audit log row
- Multi-tenant config: per-user tenant with DB-backed config (score threshold, subreddits, webhook)
- Tenant auto-provisioning via `getOrCreateTenant()` on first authenticated request

### React Dashboard — PanoptesAI (artifacts/modarchitect/)
- Vite + React + Tailwind CSS + shadcn/ui
- Clerk auth with landing page, sign-in/sign-up
- Pages: Flagged Queue (/dashboard), Analytics (/analytics), Mod Action Log (/mod-log), Configuration (/config)
- Dark theme with sidebar navigation
- Brand: PanoptesAI with blue eye-in-circle logo (public/logo.png)
- QoL Features:
  - **Bulk Actions**: Checkbox selection, select all, bulk approve/flag in queue
  - **Keyboard Shortcuts**: j/k navigate, a=safe, s=scam, x=select, Esc=clear, ?=help
  - **User Reputation Panel**: Click author name → side panel with history, avg score, active subreddits
  - **Allowlist/Blocklist**: Trusted/blocked user management in config (persisted in DB)
  - **Smart Rule Builder**: Custom automation rules (field + operator + value → action) in config
  - **Mod Action Log**: Audit trail page showing all moderation actions (auto-logged on feedback)
  - **Notification Bell**: Header bell icon showing recent high-risk (70+) detections
  - **Threat Intelligence**: Cross-subreddit threat map + threat type distribution in analytics

### Database Schema (lib/db/)
- `tenants` table: id, clerk_user_id (unique), name, created_at
- `tenant_configs` table: id, tenant_id (FK unique), score_threshold, watched_subreddits (jsonb), webhook_url, webhook_type, action_mode, allowed_users (jsonb), blocked_users (jsonb), custom_rules (jsonb), updated_at
- `content_items` table: canonical Reddit content rows keyed by `(tenant_id, reddit_id, content_type)` with full raw text, normalized text, extracted URLs/domains, permalink, and source timestamps
- `scoring_runs` table: one row per scoring attempt with rule score, optional shadow ML score, final score, reasons, action recommendation, version metadata, and config/feature snapshots
- `label_events` table: one row per moderator verdict linked to the exact content item and scoring run
- `mod_actions` table: audit trail only — records scan outcomes and moderator actions, but is no longer the canonical training dataset
- Drizzle ORM re-exports: `eq`, `and`, `or`, `desc`, `asc`, `sql` from `@workspace/db`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- Python tests: `PYTHONPATH=... python -m pytest tests/ -x -q` (269 tests)

## GitHub Repository

https://github.com/jamiefraser1988/PanoptesAI

## Environment Variables

- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `DATABASE_URL` — PostgreSQL connection string
- `FASTAPI_URL` — optional internal scoring service URL used only for shadow/internal scoring on `/api/devvit/scan`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
