import { Router, type IRouter } from "express";
import { db, tenantConfigsTable } from "@workspace/db";
import {
  REVIEW_SCORE_THRESHOLD,
  cleanSubredditName,
  normalizeSubredditName,
  recordScoredContent,
} from "../lib/canonical-data";
import { logger } from "../lib/logger";

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

interface ScanResponse {
  score: number;
  reasons: string[];
  action: string;
  action_mode?: string;
  ai_summary?: string;
  ai_signals?: string[];
}

interface RuleScoringResult {
  score: number;
  reasons: string[];
  action: "approve" | "review" | "remove";
}

interface ShadowAnalysisResult {
  mlScore: number | null;
  confidence: number | null;
  aiSummary: string | null;
  aiSignals: string[];
  categories: string[];
  modelVersion: string | null;
  latencyMs: number | null;
}

interface TenantRoute {
  tenantId: number;
  actionMode: "monitor" | "active";
  configSnapshot: Record<string, unknown>;
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
  "onlyfans", "link in bio",
];

const PHISHING_DOMAINS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl",
  "discord.gift", "steampowered.com.ru",
  "free-nitro", "claim-reward",
];

function trimString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function trimLogBody(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_ERROR_BODY_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function toDate(value: number | null | undefined): Date {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(milliseconds);
  }
  return new Date();
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function computeLocalRuleScore(req: ScanRequest): RuleScoringResult {
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

  let action: RuleScoringResult["action"] = "approve";
  if (score >= 70) {
    action = "remove";
  } else if (score >= REVIEW_SCORE_THRESHOLD) {
    action = "review";
  }

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
      scoreThreshold: tenantConfigsTable.scoreThreshold,
      actionMode: tenantConfigsTable.actionMode,
      watchedSubreddits: tenantConfigsTable.watchedSubreddits,
      allowedUsers: tenantConfigsTable.allowedUsers,
      blockedUsers: tenantConfigsTable.blockedUsers,
      customRules: tenantConfigsTable.customRules,
    })
    .from(tenantConfigsTable);

  const matchesByTenant = new Map<number, TenantRoute>();
  for (const config of configs) {
    const watchedSubreddits = Array.isArray(config.watchedSubreddits) ? config.watchedSubreddits : [];
    const watchesSubreddit = watchedSubreddits.some(
      (watchedSubreddit) => normalizeSubredditName(watchedSubreddit) === normalizedSubreddit,
    );

    if (!watchesSubreddit || matchesByTenant.has(config.tenantId)) {
      continue;
    }

    matchesByTenant.set(config.tenantId, {
      tenantId: config.tenantId,
      actionMode: config.actionMode === "active" ? "active" : "monitor",
      configSnapshot: {
        score_threshold: config.scoreThreshold,
        action_mode: config.actionMode === "active" ? "active" : "monitor",
        watched_subreddits: watchedSubreddits,
        allowed_users: Array.isArray(config.allowedUsers) ? config.allowedUsers : [],
        blocked_users: Array.isArray(config.blockedUsers) ? config.blockedUsers : [],
        custom_rules: Array.isArray(config.customRules) ? config.customRules : [],
      },
    });
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

async function tryShadowAnalysis(req: ScanRequest): Promise<ShadowAnalysisResult | null> {
  const endpoint = req.type === "post" ? "/score-post" : "/score-comment";
  const startedAt = Date.now();

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

    if (!response.ok) {
      logger.warn({
        endpoint,
        subreddit: req.subreddit,
        author: req.author,
        status: response.status,
        body: trimLogBody(await response.text()),
      }, "Internal shadow scoring returned a non-2xx response; continuing with rules-only actioning");
      return null;
    }

    const payload = await response.json() as Record<string, unknown>;
    const mlScore = typeof payload.score === "number" ? payload.score : null;
    const confidence = typeof payload.confidence === "number" ? payload.confidence : null;
    const aiSummary = typeof payload.ai_summary === "string" ? payload.ai_summary : null;
    const modelVersion = typeof payload.model_version === "string"
      ? payload.model_version
      : "fastapi-shadow-v1";

    return {
      mlScore,
      confidence,
      aiSummary,
      aiSignals: sanitizeStringArray(payload.ai_signals),
      categories: sanitizeStringArray(payload.categories),
      modelVersion,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    logger.warn({
      err,
      endpoint,
      subreddit: req.subreddit,
      author: req.author,
    }, "Internal shadow scoring failed; continuing with rules-only actioning");
    return null;
  }
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

    const ruleResult = computeLocalRuleScore(cleanScanReq);
    const shadowAnalysis = await tryShadowAnalysis(cleanScanReq);
    const actionMode = routing.match.actionMode;
    const actualAction = actionMode === "monitor" ? "log" : ruleResult.action;

    await recordScoredContent({
      content: {
        tenantId: routing.match.tenantId,
        redditId: cleanScanReq.reddit_id,
        contentType: cleanScanReq.type,
        subreddit: cleanScanReq.subreddit,
        author: cleanScanReq.author,
        title: cleanScanReq.title ?? "",
        body: cleanScanReq.body ?? "",
        permalink: cleanScanReq.permalink ?? "",
        sourceCreatedAt: cleanScanReq.created_utc,
        rawMetadata: {
          source: "devvit",
          created_utc: cleanScanReq.created_utc,
          tenant_route_subreddit: routing.normalizedSubreddit,
        },
      },
      scoring: {
        ruleScore: ruleResult.score,
        mlScore: shadowAnalysis?.mlScore ?? null,
        finalScore: ruleResult.score,
        confidence: shadowAnalysis?.confidence ?? null,
        reasons: ruleResult.reasons,
        aiSummary: shadowAnalysis?.aiSummary ?? null,
        aiSignals: shadowAnalysis?.aiSignals ?? [],
        categories: shadowAnalysis?.categories ?? [],
        recommendedAction: ruleResult.action,
        scoringMode: shadowAnalysis ? "shadow_ml" : "rules_only",
        modelVersion: shadowAnalysis?.modelVersion ?? null,
        configSnapshot: routing.match.configSnapshot,
        featureSnapshot: {
          content_length: `${cleanScanReq.title ?? ""} ${cleanScanReq.body ?? ""}`.length,
          shadow_ml_available: Boolean(shadowAnalysis),
          shadow_ml_score: shadowAnalysis?.mlScore ?? null,
        },
        latencyMs: shadowAnalysis?.latencyMs ?? null,
      },
      auditAction: actualAction,
      actionMode,
    });

    logger.info({
      reddit_id: cleanScanReq.reddit_id,
      type: cleanScanReq.type,
      subreddit: cleanScanReq.subreddit,
      score: ruleResult.score,
      recommendedAction: ruleResult.action,
      actualAction,
      actionMode,
      tenantId: routing.match.tenantId,
      shadowMlScore: shadowAnalysis?.mlScore ?? null,
    }, "Devvit scan completed");

    const response: ScanResponse = {
      score: ruleResult.score,
      reasons: ruleResult.reasons,
      action: actualAction,
      action_mode: actionMode,
      ai_summary: shadowAnalysis?.aiSummary ?? undefined,
      ai_signals: shadowAnalysis?.aiSignals.length ? shadowAnalysis.aiSignals : undefined,
    };

    res.json(response);
  } catch (err) {
    logger.error({ err }, "Devvit scan failed");
    res.status(500).json({ error: "Scan failed" });
  }
});

router.get("/devvit/health", (_req, res): void => {
  res.json({ status: "ok", service: "panoptesaimod" });
});

export default router;
