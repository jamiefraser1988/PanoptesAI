/**
 * Firebase Functions — Devvit-facing scoring entrypoint.
 *
 * Background: Reddit's Devvit http-fetch policy rejects custom backend
 * domains (we hit this with both `api.panoptesai.net` and the raw Cloud
 * Run subdomain). Firebase domains ARE on the policy's approved list, so
 * the Devvit app calls this Cloud Function, which proxies the request
 * into the Cloud Run scoring API. Everything else (dashboard, queue,
 * analytics, config) keeps talking to Cloud Run directly with no proxy.
 */

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

/**
 * Mounted from Google Secret Manager (project `panoptesaimod`,
 * secret name `scan-proxy-secret`). Cloud Run validates this header.
 */
const scanProxySecret = defineSecret("scan-proxy-secret");

const UPSTREAM_DEFAULT =
  "https://panoptes-api-909111042785.us-central1.run.app/api/devvit/scan";

/**
 * Override the upstream Cloud Run URL via env var when redeploying to a
 * different region or behind a custom domain. Set with:
 *   firebase functions:config:set scoring.upstream_url="<url>"
 * Or via Cloud Run env in the deploy command.
 */
const UPSTREAM_URL = process.env.SCORING_UPSTREAM_URL ?? UPSTREAM_DEFAULT;

export const devvitScan = onRequest(
  {
    region: "us-central1",
    cors: false,
    timeoutSeconds: 30,
    memory: "256MiB",
    concurrency: 80,
    minInstances: 0,
    maxInstances: 10,
    secrets: [scanProxySecret],
  },
  async (req, res) => {
    const PROXY_SECRET = scanProxySecret.value();
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (PROXY_SECRET) {
      headers["X-Scan-Proxy-Secret"] = PROXY_SECRET;
    }

    try {
      const upstream = await fetch(UPSTREAM_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body ?? {}),
      });

      const responseBody = await upstream.text();
      const contentType =
        upstream.headers.get("content-type") ?? "application/json";

      res
        .status(upstream.status)
        .type(contentType)
        .send(responseBody);
    } catch (err) {
      logger.error("devvitScan proxy error", { err: String(err) });
      res
        .status(502)
        .json({ error: "Upstream scoring service unavailable" });
    }
  },
);
