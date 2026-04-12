import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { db, tenantConfigsTable, modActionsTable } from "@workspace/db";

const router: IRouter = Router();

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8001";
const MAX_ERROR_BODY_LENGTH = 300;

interface ScanRequest {
  type: "post" | "comment";
  reddit_id: string;
  subreddit: string;
  author: string;
  title?: string;
  body: string;
  permalink: string;
  created_utc: number;
}

interface ScoringResult {
  score: number;
  reasons: string[];
  action: string;
  action_mode?: string;
  ai_summary?: string;
  ai_signals?: string[];
}

interface TenantRoute {
  tenantId: number;
  actionMode: string;
}

type TenantResolution =
  | { kind: "ok"; match: TenantRoute; normalizedSubreddit: string }
  | { kind: "not_found"; normalizedSubreddit: string }
  | { kind: "ambiguous"; normalizedSubreddit: string; tenantIds: number[] };

const SCAM_KEYWORDS = [
  "dm me", "telegram", "whatsapp", "signal app",
  "wallet recovery", "crypto recovery", "funds recovery",
  "limited time", "act now", "act fast", "urgent",
  "guaranteed returns", "guaranteed profit", "double your",
  "send me", "wire transfer", "western union",
  "tech support", "customer support", "helpdesk",
  "click here", "click the link", "verify your account",
  "free money", "free crypto", "free bitcoin",
  "investment opportunity", "passive income",
  "onlyfans", "🔥 link in bio",
];

const PHISHING_DOMAINS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl",
  "discord.gift", "steampowered.com.ru",
  "free-nitro", "claim-reward",
];

function trimString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cleanSubredditName(value: string | null | undefined): string {
  return trimString(value).replace(/^r\//i, "");
}

function normalizeSubredditName(value: string | null | undefined): string {
  return cleanSubredditName(value).toLowerCase();
}

function trimLogBody(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_ERROR_BODY_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function computeLocalScore(req: ScanRequest): ScoringResult {
  let score = 0;
  const reasons: string[] = [];
  const text = `${req.title ?? ""} ${req.body}`.toLowerCase();

  for (const kw of SCAM_KEYWORDS) {
    if (text.includes(kw)) {
      score += 15;
      reasons.push(`Scam keyword: "${kw}"`);
    }
  }

  const urlPattern = /https?:\/\/[^\s)]+/gi;
  const urls = text.match(urlPattern) ?? [];
  for (const url of urls) {
    for (const domain of PHISHING_DOMAINS) {
      if (url.includes(domain)) {
        score += 20;
        reasons.push(`Suspicious domain: ${domain}`);
      }
    }
  }

  if (urls.length > 3) {
    score += 10;
    reasons.push("Excessive links in content");
  }

  const urgencyPhrases = ["act now", "limited time", "don't miss", "last chance", "hurry"];
  for (const phrase of urgencyPhrases) {
    if (text.includes(phrase)) {
      score += 10;
      reasons.push(`Urgency language: "${phrase}"`);
      break;
    }
  }

  if (req.author.match(/\d{4,}$/)) {
    score += 5;
    reasons.push("Author name ends with many digits (bot pattern)");
  }

  score = Math.min(100, score);

  let action = "approve";
  if (score >= 70) action = "remove";
  else if (score >= 40) action = "review";

  if (reasons.length === 0) {
    reasons.push("No suspicious signals detected");
  }

  return { score, reasons, action };
}

async function resolveTenantRoute(subreddit: string): Promise<TenantResolution> {
  const normalizedSubreddit = normalizeSubredditName(subreddit);
  if (!normalizedSubreddit) {
    return { kind: "not_found", normalizedSubreddit };
  }

  const configs = await db
    .select({
      tenantId: tenantConfigsTable.tenantId,
      actionMode: tenantConfigsTable.actionMode,
      watchedSubreddits: tenantConfigsTable.watchedSubreddits,
    })
    .from(tenantConfigsTable);

  const matchesByTenant = new Map<number, TenantRoute>();
  for (const config of configs) {
    const watchedSubreddits = Array.isArray(config.watchedSubreddits) ? config.watchedSubreddits : [];
    const watchesSubreddit = watchedSubreddits.some(
      (watchedSubreddit) => normalizeSubredditName(watchedSubreddit) === normalizedSubreddit,
    );

    if (watchesSubreddit && !matchesByTenant.has(config.tenantId)) {
      matchesByTenant.set(config.tenantId, {
        tenantId: config.tenantId,
        actionMode: config.actionMode,
      });
    }
  }

  const matches = [...matchesByTenant.values()];
  if (matches.length === 0) {
    return { kind: "not_found", normalizedSubreddit };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      normalizedSubreddit,
      tenantIds: matches.map((match) => match.tenantId),
    };
  }

  return {
    kind: "ok",
    match: matches[0],
    normalizedSubreddit,
  };
}

async function tryFastapiScore(req: ScanRequest): Promise<ScoringResult | null> {
  const endpoint = req.type === "post" ? "/score-post" : "/score-comment";
  try {
    const response = await fetch(`${FASTAPI_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: req.title ?? "",
        body: req.body,
        author: req.author,
        subreddit: req.subreddit,
        permalink: req.permalink,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      return (await response.json()) as ScoringResult;
    }
    logger.warn({
      endpoint,
      subreddit: req.subreddit,
      author: req.author,
      status: response.status,
      body: trimLogBody(await response.text()),
    }, "FastAPI scoring returned a non-2xx response; falling back to local scoring");
  } catch (err) {
    logger.warn({
      err,
      endpoint,
      subreddit: req.subreddit,
      author: req.author,
    }, "FastAPI scoring failed; falling back to local scoring");
  }
  return null;
}

router.post("/devvit/scan", async (req, res): Promise<void> => {
  const scanReq = req.body as ScanRequest;
  const cleanSubreddit = cleanSubredditName(scanReq.subreddit);
  const cleanAuthor = trimString(scanReq.author);

  if (!scanReq.reddit_id || !cleanSubreddit || !cleanAuthor) {
    res.status(400).json({ error: "Missing required fields: reddit_id, subreddit, author" });
    return;
  }

  try {
    const routing = await resolveTenantRoute(cleanSubreddit);
    if (routing.kind === "not_found") {
      logger.warn({
        reddit_id: scanReq.reddit_id,
        type: scanReq.type,
        subreddit: cleanSubreddit,
      }, "No tenant matched Devvit scan subreddit");
      res.status(404).json({ error: `No tenant watches subreddit "${cleanSubreddit}"` });
      return;
    }

    if (routing.kind === "ambiguous") {
      logger.error({
        reddit_id: scanReq.reddit_id,
        type: scanReq.type,
        subreddit: cleanSubreddit,
        tenantIds: routing.tenantIds,
      }, "Multiple tenants matched Devvit scan subreddit");
      res.status(409).json({ error: `Multiple tenants watch subreddit "${cleanSubreddit}"` });
      return;
    }

    const cleanScanReq: ScanRequest = {
      ...scanReq,
      subreddit: cleanSubreddit,
      author: cleanAuthor,
    };

    const fastapiResult = await tryFastapiScore(cleanScanReq);
    const result = fastapiResult ?? computeLocalScore(cleanScanReq);

    const isMonitor = routing.match.actionMode !== "active";
    if (isMonitor) {
      result.action = "log";
    }
    result.action_mode = isMonitor ? "monitor" : "active";

    try {
      await db.insert(modActionsTable).values({
        tenantId: routing.match.tenantId,
        action: result.action,
        targetId: cleanScanReq.reddit_id,
        targetType: cleanScanReq.type,
        author: cleanScanReq.author,
        subreddit: cleanScanReq.subreddit,
        details: {
          score: result.score,
          reasons: result.reasons,
          title: cleanScanReq.title ?? "",
          body: cleanScanReq.body.slice(0, 500),
          permalink: cleanScanReq.permalink,
          action_mode: result.action_mode,
          ai_summary: result.ai_summary,
          ai_signals: result.ai_signals,
          flagged: result.score >= 40,
        },
      });
    } catch (saveErr) {
      logger.error({
        saveErr,
        reddit_id: cleanScanReq.reddit_id,
        type: cleanScanReq.type,
        subreddit: cleanScanReq.subreddit,
        tenantId: routing.match.tenantId,
      }, "Failed to persist Devvit scan result");
      res.status(500).json({ error: "Failed to persist scan result" });
      return;
    }

    logger.info({
      reddit_id: cleanScanReq.reddit_id,
      type: cleanScanReq.type,
      subreddit: cleanScanReq.subreddit,
      score: result.score,
      action: result.action,
      action_mode: result.action_mode,
      tenantId: routing.match.tenantId,
    }, "Devvit scan completed");

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Devvit scan failed");
    res.status(500).json({ error: "Scan failed" });
  }
});

router.get("/devvit/health", (_req, res): void => {
  res.json({ status: "ok", service: "panoptesaimod" });
});

export default router;
