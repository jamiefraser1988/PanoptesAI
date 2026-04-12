# PanoptesAI — Devvit Reddit App

A Reddit Developer Platform (Devvit) app that connects your subreddit to PanoptesAI for real-time scam and bot detection.

## How It Works

1. Install this app on your subreddit via Reddit
2. Add your subreddit to **Watched Subreddits** in the PanoptesAI dashboard
3. The app automatically sends every new post and comment to the fixed production backend at `https://panoptesai.net`
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

- The Devvit app always sends scans to the production API at `https://panoptesai.net`
- `/api/devvit/scan` resolves the destination tenant by matching the scanned subreddit against dashboard `watched_subreddits`
- If no tenant matches, the API returns `404`
- If more than one tenant matches the same subreddit, the API returns `409`

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
