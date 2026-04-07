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

### Python Bot (reddit_scam_sentry/)
- Real-time Reddit streaming via asyncpraw
- Scam/bot risk scoring (0-100) with 10+ rule-based signals
- SQLite persistence for decisions and feedback
- FastAPI dashboard backend on port 8001
- Feedback loop: mod verdicts adjust future scores via `_feedback_adjustment()` in `scorer.py`

### TypeScript API Server (artifacts/api-server/)
- Express 5 on port 8080
- Clerk middleware protects all `/api` routes (except `/api/healthz`)
- Proxies to Python FastAPI backend for decisions/stats/feedback
- Multi-tenant config: per-user tenant with DB-backed config (score threshold, subreddits, webhook)
- Tenant auto-provisioning via `getOrCreateTenant()` on first authenticated request

### React Dashboard (artifacts/modarchitect/)
- Vite + React + Tailwind CSS + shadcn/ui
- Clerk auth with landing page, sign-in/sign-up
- Pages: Flagged Queue (/dashboard), Analytics (/analytics), Configuration (/config)
- Dark theme with sidebar navigation

### Database Schema (lib/db/)
- `tenants` table: id, clerk_user_id (unique), name, created_at
- `tenant_configs` table: id, tenant_id (FK unique), score_threshold, watched_subreddits (jsonb), webhook_url, webhook_type, action_mode, updated_at
- Drizzle ORM re-exports: `eq`, `and`, `or`, `desc`, `asc`, `sql` from `@workspace/db`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- Python tests: `PYTHONPATH=... python -m pytest tests/ -x -q` (269 tests)

## Environment Variables

- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `DATABASE_URL` — PostgreSQL connection string
- `FASTAPI_URL` — Python backend URL (default: http://localhost:8001)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
