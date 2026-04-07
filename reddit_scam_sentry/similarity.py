"""
Pure-Python TF-IDF cosine similarity for Reddit Scam Sentry.

Compares an incoming post body against recent flagged decisions stored in the
DB.  A high cosine similarity to a known-flagged post is a strong indicator
that the author is running a copy-paste scam campaign.

No external ML libraries are used — only the standard library (math,
collections, re).

Public API
----------
score_similarity(body, flagged_bodies, threshold) -> (int, str | None)
    Returns (points, reason) when the highest cosine similarity to any
    previously-flagged body meets or exceeds ``threshold``.
    Returns (0, None) when no match is found or inputs are too short.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Sequence

_POINTS: int = 20
_MIN_TEXT_LENGTH: int = 20
_STOP_WORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to",
        "for", "of", "with", "by", "from", "is", "are", "was", "were",
        "be", "been", "being", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "may", "might", "shall",
        "that", "this", "it", "i", "you", "he", "she", "we", "they",
        "me", "him", "her", "us", "them", "my", "your", "his", "its",
        "our", "their", "what", "which", "who", "whom", "how", "when",
        "where", "why", "not", "no", "so", "if", "as",
    }
)
_TOKEN_RE = re.compile(r"[a-zA-Z0-9]+")


def _tokenise(text: str) -> list[str]:
    return [
        tok.lower()
        for tok in _TOKEN_RE.findall(text)
        if tok.lower() not in _STOP_WORDS and len(tok) > 1
    ]


def _tf(tokens: list[str]) -> dict[str, float]:
    if not tokens:
        return {}
    counts = Counter(tokens)
    total = len(tokens)
    return {term: count / total for term, count in counts.items()}


def _idf(term: str, corpus: list[list[str]]) -> float:
    """Log-smoothed IDF: log((1 + N) / (1 + df)) + 1."""
    n = len(corpus)
    df = sum(1 for doc in corpus if term in doc)
    return math.log((1 + n) / (1 + df)) + 1


def _tfidf_vector(tokens: list[str], corpus: list[list[str]]) -> dict[str, float]:
    tf = _tf(tokens)
    return {term: tf_val * _idf(term, corpus) for term, tf_val in tf.items()}


def _cosine(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    dot = sum(vec_a.get(t, 0.0) * vec_b.get(t, 0.0) for t in vec_b)
    norm_a = math.sqrt(sum(v * v for v in vec_a.values()))
    norm_b = math.sqrt(sum(v * v for v in vec_b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def score_similarity(
    body: str,
    flagged_bodies: Sequence[str],
    threshold: float = 0.6,
) -> tuple[int, str | None]:
    """Return (points, reason) if ``body`` is very similar to any flagged body.

    Parameters
    ----------
    body:
        Text of the incoming post or comment body to compare.
    flagged_bodies:
        Recent bodies from previously-flagged decisions (up to 50).
    threshold:
        Cosine similarity threshold [0.0, 1.0] above which the signal fires.

    Returns
    -------
    (points, reason) when similarity >= threshold, otherwise (0, None).
    """
    if not body or len(body.strip()) < _MIN_TEXT_LENGTH:
        return 0, None
    if not flagged_bodies:
        return 0, None

    query_tokens = _tokenise(body)
    if not query_tokens:
        return 0, None

    corpus_tokens: list[list[str]] = [_tokenise(fb) for fb in flagged_bodies]
    non_empty = [t for t in corpus_tokens if t]
    if not non_empty:
        return 0, None

    all_tokens = [query_tokens] + corpus_tokens
    query_vec = _tfidf_vector(query_tokens, all_tokens)

    best_sim = 0.0
    for tokens in corpus_tokens:
        if not tokens:
            continue
        vec = _tfidf_vector(tokens, all_tokens)
        sim = _cosine(query_vec, vec)
        if sim > best_sim:
            best_sim = sim

    if best_sim >= threshold:
        return _POINTS, f"High text similarity to flagged content ({best_sim:.0%} match)"

    return 0, None
