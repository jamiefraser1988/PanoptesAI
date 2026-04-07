"""
smoke_test.py — Quick connectivity check for Reddit Scam Sentry.

Usage:
    python smoke_test.py

Requires a valid .env file with Reddit credentials.
"""

import asyncio
import os

import asyncpraw
from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    required = [
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USERNAME",
        "REDDIT_PASSWORD",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: Missing required env vars: {', '.join(missing)}")
        print("Copy .env.example to .env and fill in your credentials.")
        return

    reddit = asyncpraw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        username=os.environ["REDDIT_USERNAME"],
        password=os.environ["REDDIT_PASSWORD"],
        user_agent=os.environ.get("REDDIT_USER_AGENT", "ScamSentry/0.1 smoke-test"),
    )

    try:
        me = await reddit.user.me()
        print(f"✓ Logged in as: u/{me}")

        sub_names = os.environ.get("SUBREDDITS", "test").split(",")
        for name in sub_names:
            name = name.strip()
            subreddit = await reddit.subreddit(name)
            await subreddit.load()
            print(f"✓ Subreddit accessible: r/{subreddit.display_name} ({subreddit.subscribers:,} subscribers)")

        print("\nSmoke test PASSED — credentials and subreddit access OK.")
    except Exception as exc:
        print(f"\nSmoke test FAILED: {exc}")
        print("\nCommon causes:")
        print("  - Wrong client_id / client_secret")
        print("  - Wrong username / password")
        print("  - 2FA enabled (use OAuth refresh-token flow instead)")
        print("  - Reddit API app not set to 'script' type")
    finally:
        await reddit.close()


if __name__ == "__main__":
    asyncio.run(main())
