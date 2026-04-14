# PanoptesAI Architecture

## Overview

PanoptesAI ships as a pnpm workspace monorepo with one public frontend and one public backend:

- `panoptesai.net` serves the dashboard from Firebase Hosting
- `panoptes-api-909111042785.us-east5.run.app` runs the public API on Google Cloud Run
- Clerk is configured directly for PanoptesAI domains
- Replit is not part of the production runtime or deployment path

## Production Components

### React Dashboard (`artifacts/modarchitect/`)
- Vite + React + Tailwind CSS + shadcn/ui
- Built to `artifacts/modarchitect/dist/public`
- Deployed to Firebase Hosting for `panoptesai.net`
- Production build uses:
  - `VITE_API_BASE_URL=https://panoptes-api-909111042785.us-east5.run.app`
  - `VITE_CLERK_PUBLISHABLE_KEY` for the PanoptesAI Clerk instance

### API Server (`artifacts/api-server/`)
- Express 5 + Clerk middleware
- Deployed to Google Cloud Run
- Serves `/api/healthz`, `/api/devvit/*`, and authenticated product routes under `/api`
- Replit-specific Clerk proxying is not part of the API architecture

### Devvit App (`devvit-app/`)
- Runs on Reddit's platform
- Sends scans to the fixed production API path at `https://panoptesai.net/api/devvit/scan`
- Links users back to the hosted PanoptesAI product domain

### Data Layer
- PostgreSQL is the system of record for content, scoring runs, labels, tenant config, analytics, and audit history
- Optional internal scoring services may exist behind the API, but they are not public product backends

## Deployment

### Dashboard
```bash
pnpm run build:dashboard
firebase deploy --only hosting --project panoptesaimod
```

### API
```bash
gcloud builds submit --config cloudbuild.api.yaml .
gcloud run deploy panoptes-api \
  --image us-east5-docker.pkg.dev/panoptesaimod/panoptes-api/panoptes-api:latest \
  --region us-east5 \
  --project panoptesaimod
```

## Notes

- The legacy Python bot and FastAPI dashboard remain in the repo as historical/internal tooling, not as the production runtime.
- If production auth breaks, inspect the deployed frontend bundle and Clerk environment directly before changing code. The failure mode is usually stale deploy-time configuration, not a React routing bug.
