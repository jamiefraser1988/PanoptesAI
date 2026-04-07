FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
COPY reddit_scam_sentry/ ./reddit_scam_sentry/
COPY dashboard/ ./dashboard/
COPY README.md ./

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

RUN useradd --create-home --shell /bin/bash sentry \
    && chown -R sentry:sentry /app

USER sentry

CMD ["scam-sentry"]
