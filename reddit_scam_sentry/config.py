import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(f"Required environment variable '{key}' is not set. See .env.example.")
    return value


def _optional(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


REDDIT_CLIENT_ID: str = _require("REDDIT_CLIENT_ID")
REDDIT_CLIENT_SECRET: str = _require("REDDIT_CLIENT_SECRET")
REDDIT_USERNAME: str = _require("REDDIT_USERNAME")
REDDIT_PASSWORD: str = _require("REDDIT_PASSWORD")
REDDIT_USER_AGENT: str = _optional("REDDIT_USER_AGENT", "ScamSentry/0.1")

SUBREDDITS: list[str] = [
    s.strip() for s in _optional("SUBREDDITS", "test").split(",") if s.strip()
]

RISK_THRESHOLD: int = int(_optional("RISK_THRESHOLD", "70"))

ACTION_MODE: str = _optional("ACTION_MODE", "none")

FLAG_FLAIR_TEXT: str = _optional("FLAG_FLAIR_TEXT", "⚠️ Possible Scam")
FLAG_FLAIR_CSS: str = _optional("FLAG_FLAIR_CSS", "possible-scam")

DB_PATH: str = _optional("DB_PATH", "./sentry.db")

USER_CACHE_TTL_SECONDS: int = int(_optional("USER_CACHE_TTL_SECONDS", str(6 * 3600)))
