import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  and,
  db,
  desc,
  eq,
  modActionsTable,
  sql,
  tenantConfigsTable,
} from "@workspace/db";
import {
  clearDemoContentForTenant,
  getStatsForTenant,
  getUserProfileForTenant,
  listDecisionItems,
  recordFeedbackLabel,
  recordScoredContent,
  type CanonicalContentType,
  type DecisionSortBy,
  type LabelVerdict,
} from "../lib/canonical-data";
import { getClerkUserId, getOrCreateTenant, getTenantConfig } from "../lib/tenant";
import {
  ListDecisionsQueryParams,
  ListDecisionsResponse,
  SubmitFeedbackParams,
  SubmitFeedbackBody,
  SubmitFeedbackResponse,
  GetStatsQueryParams,
  GetStatsResponse,
  GetConfigResponse,
  SaveConfigBody,
  SaveConfigResponse,
  TestWebhookResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type ActionFilter = "all" | "confirm_scam" | "mark_safe" | "mark_unclear";

interface DemoSeedRow {
  action: "remove" | "review" | "approve";
  targetId: string;
  targetType: CanonicalContentType;
  author: string;
  subreddit: string;
  details: {
    score: number;
    flagged: boolean;
    title: string;
    body: string;
    reasons: string[];
    permalink: string;
  };
  createdAt: Date;
}

function isPrivateOrInternalIp(hostname: string): boolean {
  const ip4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip4Regex.exec(hostname);
  if (match) {
    const [, a, b] = match.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 127) return true;
    if (a === 0) return true;
  }
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  return false;
}

function isWebhookUrlSafe(rawUrl: string): { safe: boolean; reason?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { safe: false, reason: "Webhook URL must use http or https" };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    return { safe: false, reason: "Webhook URL must not target internal addresses" };
  }

  if (isPrivateOrInternalIp(hostname)) {
    return { safe: false, reason: "Webhook URL must not target private/internal IP ranges" };
  }

  return { safe: true };
}

async function requireTenant(req: Request, res: Response) {
  const userId = getClerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const tenant = await getOrCreateTenant(userId);
  if (!tenant) {
    logger.error({ userId }, "Failed to resolve tenant for authenticated request");
    res.status(500).json({ error: "Failed to resolve tenant" });
    return null;
  }

  return { userId, tenant };
}

function getRequestedContentType(value: "posts" | "comments" | "all"): CanonicalContentType | undefined {
  if (value === "posts") {
    return "post";
  }
  if (value === "comments") {
    return "comment";
  }
  return undefined;
}

function getRequestedSortBy(req: Request): DecisionSortBy {
  return req.query.sort_by === "date" ? "date" : "score";
}

function buildDemoSeedRows(now: number): DemoSeedRow[] {
  const day = 24 * 60 * 60 * 1000;

  return [
    {
      action: "remove",
      targetId: "t3_demo001",
      targetType: "post",
      author: "CryptoHelper2024",
      subreddit: "CryptoGeneral",
      details: {
        score: 90,
        flagged: true,
        title: "DM me for guaranteed 5x returns - limited spots left",
        body: "I recovered $47k in lost crypto. DM me on telegram now. Wallet recovery specialist. Act now before spots fill up!",
        reasons: [
          'Scam keyword: "dm me"',
          'Scam keyword: "telegram"',
          'Scam keyword: "wallet recovery"',
          'Scam keyword: "guaranteed returns"',
          'Urgency language: "act now"',
        ],
        permalink: "/r/CryptoGeneral/comments/demo001",
      },
      createdAt: new Date(now - 1 * day),
    },
    {
      action: "remove",
      targetId: "t3_demo002",
      targetType: "post",
      author: "InvestmentGuru9999",
      subreddit: "personalfinance",
      details: {
        score: 82,
        flagged: true,
        title: "Free bitcoin giveaway - claim your reward now!",
        body: "Get free crypto by clicking the link. Verify your account and double your bitcoin. Send me 0.1 BTC to receive 0.2 BTC back. Investment opportunity of a lifetime.",
        reasons: [
          'Scam keyword: "free bitcoin"',
          'Scam keyword: "double your"',
          'Scam keyword: "verify your account"',
          'Scam keyword: "investment opportunity"',
          "Suspicious domain: claim-reward",
        ],
        permalink: "/r/personalfinance/comments/demo002",
      },
      createdAt: new Date(now - 1.5 * day),
    },
    {
      action: "remove",
      targetId: "t3_demo003",
      targetType: "comment",
      author: "TechSupportHelper",
      subreddit: "techsupport",
      details: {
        score: 75,
        flagged: true,
        title: "Re: My computer is slow - need help",
        body: "Contact our helpdesk immediately. Call our tech support line and verify your account. We can fix this issue via remote access. Send me your login details via WhatsApp.",
        reasons: [
          'Scam keyword: "helpdesk"',
          'Scam keyword: "tech support"',
          'Scam keyword: "verify your account"',
          'Scam keyword: "whatsapp"',
        ],
        permalink: "/r/techsupport/comments/demo003/reply/demo003r",
      },
      createdAt: new Date(now - 2 * day),
    },
    {
      action: "review",
      targetId: "t3_demo004",
      targetType: "post",
      author: "WealthBuilder123",
      subreddit: "investing",
      details: {
        score: 60,
        flagged: true,
        title: "Passive income strategy that changed my life",
        body: "I found this amazing passive income system. Investment opportunity with guaranteed profit. Limited time offer - click here to learn more.",
        reasons: [
          'Scam keyword: "passive income"',
          'Scam keyword: "guaranteed profit"',
          'Scam keyword: "investment opportunity"',
          'Scam keyword: "click here"',
        ],
        permalink: "/r/investing/comments/demo004",
      },
      createdAt: new Date(now - 2.5 * day),
    },
    {
      action: "review",
      targetId: "t3_demo005",
      targetType: "post",
      author: "moneymaker4567",
      subreddit: "CryptoGeneral",
      details: {
        score: 55,
        flagged: true,
        title: "Funds recovery service - got my money back after being scammed",
        body: "I was scammed but found a funds recovery specialist. They helped me get $12k back. DM me if you need their contact info.",
        reasons: ['Scam keyword: "funds recovery"', 'Scam keyword: "dm me"'],
        permalink: "/r/CryptoGeneral/comments/demo005",
      },
      createdAt: new Date(now - 3 * day),
    },
    {
      action: "review",
      targetId: "t3_demo006",
      targetType: "comment",
      author: "QuickRichScheme",
      subreddit: "personalfinance",
      details: {
        score: 45,
        flagged: true,
        title: "Re: Best investment strategies for 2024",
        body: "Urgent - free money opportunity expires tonight! Wire transfer details in my bio. Don't miss out on this last chance.",
        reasons: [
          'Scam keyword: "free money"',
          'Scam keyword: "wire transfer"',
          'Urgency language: "last chance"',
        ],
        permalink: "/r/personalfinance/comments/demo006/reply/demo006r",
      },
      createdAt: new Date(now - 3.5 * day),
    },
    {
      action: "approve",
      targetId: "t3_demo007",
      targetType: "post",
      author: "NormalUser_Gaming",
      subreddit: "gaming",
      details: {
        score: 12,
        flagged: false,
        title: "Just hit level 100 in my favorite RPG - took me 3 months",
        body: "Finally made it! The grind was worth it. Love this game community. Anyone else grinding end-game content?",
        reasons: ["No suspicious signals detected"],
        permalink: "/r/gaming/comments/demo007",
      },
      createdAt: new Date(now - 4 * day),
    },
    {
      action: "approve",
      targetId: "t3_demo008",
      targetType: "post",
      author: "everyday_reddit",
      subreddit: "AskReddit",
      details: {
        score: 5,
        flagged: false,
        title: "What's the most useful skill you've learned in the last year?",
        body: "I've been learning to code and it's opened so many doors. What about you?",
        reasons: ["No suspicious signals detected"],
        permalink: "/r/AskReddit/comments/demo008",
      },
      createdAt: new Date(now - 5 * day),
    },
    {
      action: "review",
      targetId: "t3_demo009",
      targetType: "post",
      author: "CryptoNewbie2024",
      subreddit: "CryptoGeneral",
      details: {
        score: 42,
        flagged: true,
        title: "Signal app group for crypto trading - join us",
        body: "We share daily trade signals in a private signal app group. Join our community. Not financial advice.",
        reasons: ['Scam keyword: "signal app"'],
        permalink: "/r/CryptoGeneral/comments/demo009",
      },
      createdAt: new Date(now - 5.5 * day),
    },
    {
      action: "approve",
      targetId: "t3_demo010",
      targetType: "post",
      author: "TechEnthusiast",
      subreddit: "techsupport",
      details: {
        score: 0,
        flagged: false,
        title: "How do I increase my RAM speed without overclocking?",
        body: "I have 16GB DDR4 3200MHz. Is there a way to get better performance without overclocking? Thanks",
        reasons: ["No suspicious signals detected"],
        permalink: "/r/techsupport/comments/demo010",
      },
      createdAt: new Date(now - 6 * day),
    },
  ];
}

router.get("/decisions", async (req, res): Promise<void> => {
  const params = ListDecisionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const result = await listDecisionItems({
      tenantId: authContext.tenant.id,
      subreddit: params.data.subreddit,
      minScore: params.data.min_score,
      contentType: getRequestedContentType(params.data.content_type),
      page: params.data.page ?? 1,
      limit: params.data.limit ?? 20,
      sortBy: getRequestedSortBy(req),
    });

    res.json(ListDecisionsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch decisions from canonical store");
    res.status(500).json({ error: "Failed to fetch decisions" });
  }
});

router.get("/comment-decisions", async (req, res): Promise<void> => {
  const params = ListDecisionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const result = await listDecisionItems({
      tenantId: authContext.tenant.id,
      subreddit: params.data.subreddit,
      minScore: params.data.min_score,
      contentType: "comment",
      page: params.data.page ?? 1,
      limit: params.data.limit ?? 20,
      sortBy: getRequestedSortBy(req),
    });

    res.json(ListDecisionsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch comment decisions from canonical store");
    res.status(500).json({ error: "Failed to fetch comment decisions" });
  }
});

router.post("/decisions/:postId/feedback", async (req, res): Promise<void> => {
  const rawPostId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const paramsResult = SubmitFeedbackParams.safeParse({ postId: rawPostId });
  if (!paramsResult.success) {
    res.status(400).json({ error: paramsResult.error.message });
    return;
  }

  const body = SubmitFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const decision = await recordFeedbackLabel({
      tenantId: authContext.tenant.id,
      redditId: paramsResult.data.postId,
      verdict: body.data.verdict as LabelVerdict,
      actorId: authContext.userId,
    });

    if (!decision) {
      res.status(404).json({ error: "Decision not found" });
      return;
    }

    res.json(SubmitFeedbackResponse.parse(decision));
  } catch (err) {
    req.log.error({ err }, "Failed to submit feedback to canonical store");
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

router.get("/stats", async (req, res): Promise<void> => {
  const params = GetStatsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const stats = await getStatsForTenant(authContext.tenant.id, params.data.timeframe);
    res.json(GetStatsResponse.parse(stats));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch stats from canonical store");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/config", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const config = await getTenantConfig(authContext.tenant.id);

    const result = GetConfigResponse.parse({
      score_threshold: config?.scoreThreshold ?? 70,
      watched_subreddits: (config?.watchedSubreddits as string[]) ?? [],
      webhook_url: config?.webhookUrl ?? null,
      action_mode: config?.actionMode === "active" ? "active" : "monitor",
    });

    const extended = {
      ...result,
      allowed_users: (config?.allowedUsers as string[]) ?? [],
      blocked_users: (config?.blockedUsers as string[]) ?? [],
      custom_rules: (config?.customRules as Array<Record<string, unknown>>) ?? [],
    };

    res.json(extended);
  } catch (err) {
    logger.error({ err }, "Failed to read config");
    res.status(500).json({ error: "Failed to read configuration" });
  }
});

router.post("/config", async (req, res): Promise<void> => {
  const body = SaveConfigBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const rawBody = req.body as Record<string, unknown>;
    const allowedUsers = Array.isArray(rawBody.allowed_users) ? rawBody.allowed_users as string[] : [];
    const blockedUsers = Array.isArray(rawBody.blocked_users) ? rawBody.blocked_users as string[] : [];
    const customRules = Array.isArray(rawBody.custom_rules) ? rawBody.custom_rules as Array<Record<string, unknown>> : [];

    await db
      .insert(tenantConfigsTable)
      .values({
        tenantId: authContext.tenant.id,
        scoreThreshold: body.data.score_threshold,
        watchedSubreddits: body.data.watched_subreddits,
        webhookUrl: body.data.webhook_url ?? null,
        actionMode: body.data.action_mode === "active" ? "active" : "log",
        allowedUsers,
        blockedUsers,
        customRules: customRules as typeof tenantConfigsTable.$inferInsert["customRules"],
      })
      .onConflictDoUpdate({
        target: tenantConfigsTable.tenantId,
        set: {
          scoreThreshold: body.data.score_threshold,
          watchedSubreddits: body.data.watched_subreddits,
          webhookUrl: body.data.webhook_url ?? null,
          actionMode: body.data.action_mode === "active" ? "active" : "log",
          allowedUsers,
          blockedUsers,
          customRules: customRules as typeof tenantConfigsTable.$inferInsert["customRules"],
          updatedAt: new Date(),
        },
      });

    const result = SaveConfigResponse.parse(body.data);
    res.json({ ...result, allowed_users: allowedUsers, blocked_users: blockedUsers, custom_rules: customRules });
  } catch (err) {
    logger.error({ err }, "Failed to write config");
    res.status(500).json({ error: "Failed to save configuration" });
  }
});

router.post("/config/test-webhook", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const config = await getTenantConfig(authContext.tenant.id);
    if (!config?.webhookUrl) {
      res.json(TestWebhookResponse.parse({ success: false, message: "No webhook URL configured" }));
      return;
    }

    const safetyCheck = isWebhookUrlSafe(config.webhookUrl);
    if (!safetyCheck.safe) {
      res.json(TestWebhookResponse.parse({ success: false, message: safetyCheck.reason ?? "Unsafe webhook URL" }));
      return;
    }

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test", message: "PanoptesAI webhook test" }),
    });

    if (response.ok) {
      res.json(TestWebhookResponse.parse({ success: true, message: "Webhook test successful" }));
    } else {
      res.json(TestWebhookResponse.parse({ success: false, message: `Webhook returned ${response.status}` }));
    }
  } catch (err) {
    req.log.error({ err }, "Webhook test failed");
    res.json(TestWebhookResponse.parse({ success: false, message: String(err) }));
  }
});

router.get("/tenant", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    res.json({
      id: authContext.tenant.id,
      name: authContext.tenant.name,
      createdAt: authContext.tenant.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get tenant");
    res.status(500).json({ error: "Failed to get tenant info" });
  }
});

router.get("/mod-actions", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const actionFilter = (req.query.action as ActionFilter | undefined) ?? "all";

    const conditions = [eq(modActionsTable.tenantId, authContext.tenant.id)];
    if (actionFilter !== "all") {
      conditions.push(eq(modActionsTable.action, actionFilter));
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [actions, countResult] = await Promise.all([
      db
        .select()
        .from(modActionsTable)
        .where(whereClause)
        .orderBy(desc(modActionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(modActionsTable)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;
    res.json({
      items: actions,
      total,
      page,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch mod actions");
    res.status(500).json({ error: "Failed to fetch mod actions" });
  }
});

router.post("/mod-actions", async (_req, res): Promise<void> => {
  res.status(403).json({ error: "Mod actions are recorded automatically by the system. Direct creation is not allowed." });
});

router.delete("/devvit/seed-demo", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const deleted = await clearDemoContentForTenant(authContext.tenant.id);
    logger.info({ tenantId: authContext.tenant.id, deleted }, "Demo data cleared");
    res.json({ success: true, deleted });
  } catch (err) {
    logger.error({ err }, "Failed to clear demo data");
    res.status(500).json({ error: "Failed to clear demo data" });
  }
});

router.post("/devvit/seed-demo", async (req, res): Promise<void> => {
  try {
    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(modActionsTable)
      .where(and(
        eq(modActionsTable.tenantId, authContext.tenant.id),
        sql`${modActionsTable.targetId} LIKE 't3_demo%'`,
      ));

    if ((existing[0]?.count ?? 0) > 0) {
      res.json({ success: true, count: 0, message: "Demo data already loaded" });
      return;
    }

    const seedRows = buildDemoSeedRows(Date.now());
    for (const row of seedRows) {
      await recordScoredContent({
        content: {
          tenantId: authContext.tenant.id,
          redditId: row.targetId,
          contentType: row.targetType,
          subreddit: row.subreddit,
          author: row.author,
          title: row.details.title,
          body: row.details.body,
          permalink: row.details.permalink,
          sourceCreatedAt: row.createdAt,
          ingestedAt: row.createdAt,
          rawMetadata: {
            source: "demo_seed",
            seeded: true,
          },
        },
        scoring: {
          ruleScore: row.details.score,
          finalScore: row.details.score,
          reasons: row.details.reasons,
          recommendedAction: row.action,
          scoringMode: "rules_only",
          configSnapshot: {
            seeded: true,
          },
          featureSnapshot: {
            seeded: true,
            flagged: row.details.flagged,
          },
          createdAt: row.createdAt,
        },
        auditAction: row.action,
        actionMode: "active",
        auditDetails: {
          source: "demo_seed",
          seeded: true,
        },
      });
    }

    logger.info({ tenantId: authContext.tenant.id, count: seedRows.length }, "Seeded demo data");
    res.json({ success: true, count: seedRows.length, message: `Inserted ${seedRows.length} demo scan results` });
  } catch (err) {
    logger.error({ err }, "Failed to seed demo data");
    res.status(500).json({ error: "Failed to seed demo data" });
  }
});

router.get("/user-profile/:author", async (req, res): Promise<void> => {
  try {
    const author = req.params.author;
    if (!author) {
      res.status(400).json({ error: "author is required" });
      return;
    }

    const authContext = await requireTenant(req, res);
    if (!authContext) {
      return;
    }

    const profile = await getUserProfileForTenant(authContext.tenant.id, author);
    res.json(profile);
  } catch (err) {
    logger.error({ err }, "Failed to fetch user profile");
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

export default router;
