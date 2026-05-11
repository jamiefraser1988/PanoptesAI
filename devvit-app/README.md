# PanoptesAI — Devvit Reddit App

A Reddit Developer Platform (Devvit) app that connects your subreddit to PanoptesAI for real-time scam and bot detection.

## How It Works

1. Install this app on your subreddit via Reddit
2. Add your subreddit to **Watched Subreddits** in the PanoptesAI dashboard
3. The app automatically sends every new post and comment to the fixed production backend at `https://us-central1-panoptesaimod.cloudfunctions.net`
4. The API routes the scan to the matching tenant by `watched_subreddits`, stores the decision, and returns the moderation action

## Setup

### Prerequisites

- Node.js 18+
- A Reddit account
- Devvit CLI: `npm install -g devvit`

### Install & Deploy

```bash
cd devvit-app
npm install
devvit login
devvit upload
```

### Install on a Subreddit

After uploading, go to your subreddit > Mod Tools > Community Apps, find "panoptes-ai" and install it.

### Connect Your Subreddit

In the PanoptesAI dashboard configuration:

- Add the subreddit name to **Watched Subreddits**
- Choose **Monitor** or **Active** mode for that tenant

This Devvit build does not expose per-install API URL or API key settings. Routing is resolved server-side by matching the subreddit against `watched_subreddits`.

## Routing Behavior

- The Devvit app always sends scans to the production API at `https://us-central1-panoptesaimod.cloudfunctions.net`
- `/api/devvit/scan` resolves the destination tenant by matching the scanned subreddit against dashboard `watched_subreddits`
- If no tenant matches, the API returns `404`
- If more than one tenant matches the same subreddit, the API returns `409`

## Fetch Domains

The app makes outbound HTTP fetches to a single host:

| Domain | Why it is needed |
|---|---|
| `us-central1-panoptesaimod.cloudfunctions.net` | PanoptesAI scoring entry point, hosted on Firebase Cloud Functions (Google Cloud). The Devvit app POSTs each new post/comment to `/devvitScan` so the scoring engine can compute a scam/bot risk score and return a moderation action. The function is a thin proxy that forwards the request into the internal Cloud Run scoring API, which stores scoring history, manages per-tenant configuration, and serves the dashboard at `www.panoptesai.net`. A Firebase Function is used because the scoring pipeline depends on a managed PostgreSQL database (Cloud SQL) and tenant-aware request routing — neither of which Devvit's runtime supports. Only public Reddit content (post/comment ID, subreddit, author username, title, body, permalink, created_utc) is sent; no private moderator data leaves Reddit. |

## Architecture

```
Reddit Post/Comment
    ↓ (Devvit trigger)
PanoptesAI Devvit App
    ↓ (HTTP POST)
PanoptesAI API Server
    ↓ (tenant resolved by watched_subreddits)
Matched tenant config
    ↓ (scoring pipeline)
Rule-based + AI scoring
    ↓
Decision stored + action returned
    ↓
Devvit takes mod action (if configured)
```
