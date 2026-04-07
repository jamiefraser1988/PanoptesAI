import logging
import asyncpraw.models
from reddit_scam_sentry import config

logger = logging.getLogger("sentry.actions")


async def apply_flair(submission: asyncpraw.models.Submission, score: int) -> None:
    if config.ACTION_MODE != "flair":
        return
    if score < config.RISK_THRESHOLD:
        return

    flair_template_id = config.FLAG_FLAIR_TEMPLATE_ID

    try:
        if flair_template_id:
            await submission.flair.select(
                flair_template_id=flair_template_id,
                text=config.FLAG_FLAIR_TEXT,
            )
        else:
            await submission.mod.flair(
                text=config.FLAG_FLAIR_TEXT,
                css_class=config.FLAG_FLAIR_CSS,
            )
        logger.info(
            "Flair applied to post %s (score=%d): %s",
            submission.id,
            score,
            config.FLAG_FLAIR_TEXT,
        )
    except Exception as exc:
        logger.warning(
            "Failed to apply flair to post %s: %s",
            submission.id,
            exc,
        )
