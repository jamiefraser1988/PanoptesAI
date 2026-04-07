"""
Set dummy env vars before any module-level import so that config.py's
_require() calls succeed without real Reddit credentials.
"""
import os

os.environ.setdefault("REDDIT_CLIENT_ID", "test_client_id")
os.environ.setdefault("REDDIT_CLIENT_SECRET", "test_client_secret")
os.environ.setdefault("REDDIT_USERNAME", "test_user")
os.environ.setdefault("REDDIT_PASSWORD", "test_password")
