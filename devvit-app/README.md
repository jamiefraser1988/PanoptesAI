# PanoptesAI — Devvit Reddit App

A Reddit Developer Platform (Devvit) app that connects your subreddit to PanoptesAI for real-time scam and bot detection.

## How It Works

1. Install this app on your subreddit via Reddit
2. Configure it with your PanoptesAI API URL and key
3. The app automatically scans every new post and comment
4. Posts/comments above the risk threshold are reported or removed based on your settings

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

### Configure

In the app settings on your subreddit, set:

- **PanoptesAI API URL**: Your deployed PanoptesAI server URL
- **PanoptesAI API Key**: API key from your dashboard
- **Risk Score Threshold**: Score (0-100) above which actions are taken
- **Action Mode**: Log only, report to mod queue, or auto-remove

## App Settings

| Setting | Description | Default |
|---------|-------------|---------|
| PanoptesAI API URL | Your PanoptesAI backend URL | (required) |
| PanoptesAI API Key | Authentication key | (optional) |
| Risk Threshold | Minimum score to trigger action | 70 |
| Action Mode | log / report / remove | log |

## Architecture

```
Reddit Post/Comment
    ↓ (Devvit trigger)
PanoptesAI Devvit App
    ↓ (HTTP POST)
PanoptesAI API Server
    ↓ (scoring pipeline)
Rule-based + AI scoring
    ↓
Decision stored + action returned
    ↓
Devvit takes mod action (if configured)
```
