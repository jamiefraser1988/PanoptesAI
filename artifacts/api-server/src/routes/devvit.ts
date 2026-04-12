import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { db, eq, tenantsTable, tenantConfigsTable, modActionsTable } from "@workspace/db";

const router: IRouter = Router();

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8001";

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

async function tryFastapiScore(req: ScanRequest): Promise<ScoringResult | null> {
  try {
    const endpoint = req.type === "post" ? "/score-post" : "/score-comment";
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
  } catch {
    // FastAPI not available — fall back to local scoring
  }
  return null;
}

router.post("/devvit/scan", async (req, res): Promise<void> => {
  const scanReq = req.body as ScanRequest;

  if (!scanReq.reddit_id || !scanReq.subreddit || !scanReq.author) {
    res.status(400).json({ error: "Missing required fields: reddit_id, subreddit, author" });
    return;
  }

  try {
    const fastapiResult = await tryFastapiScore(scanReq);
    const result = fastapiResult ?? computeLocalScore(scanReq);

    let dbMode = "log";
    try {
      const configs = await db
        .select({ actionMode: tenantConfigsTable.actionMode })
        .from(tenantConfigsTable)
        .limit(1);
      if (configs.length > 0) {
        dbMode = configs[0].actionMode;
      }
    } catch {
      // default to monitor if DB unavailable
    }

    const isMonitor = dbMode !== "active";
    if (isMonitor) {
      result.action = "log";
    }
    result.action_mode = isMonitor ? "monitor" : "active";

    logger.info({
      reddit_id: scanReq.reddit_id,
      type: scanReq.type,
      subreddit: scanReq.subreddit,
      score: result.score,
      action: result.action,
      action_mode: result.action_mode,
    }, "Devvit scan completed");

    try {
      const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable).limit(1);
      if (tenants.length > 0) {
        await db.insert(modActionsTable).values({
          tenantId: tenants[0].id,
          action: result.action,
          targetId: scanReq.reddit_id,
          targetType: scanReq.type,
          author: scanReq.author,
          subreddit: scanReq.subreddit,
          details: {
            score: result.score,
            reasons: result.reasons,
            title: scanReq.title ?? "",
            body: scanReq.body.slice(0, 500),
            permalink: scanReq.permalink,
            action_mode: result.action_mode,
            ai_summary: result.ai_summary,
            ai_signals: result.ai_signals,
            flagged: result.score >= 40,
          },
        });
      }
    } catch (saveErr) {
      logger.warn({ saveErr }, "Failed to persist scan result to DB — continuing");
    }

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
