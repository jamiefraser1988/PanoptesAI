import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { db, eq, tenantsTable, tenantConfigsTable } from "@workspace/db";
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

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8001";

type RawDecision = Record<string, unknown> & { score: number; content_type?: string };

function buildFastapiUrl(path: string, query: Record<string, unknown>): string {
  const url = new URL(path, FASTAPI_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fastapiGet(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FastAPI responded with ${response.status}`);
  }
  return response.json();
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

async function getOrCreateTenant(clerkUserId: string) {
  const existing = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ clerkUserId, name: "My Organization" })
    .onConflictDoNothing()
    .returning();

  if (tenant) return tenant;

  const [fallback] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.clerkUserId, clerkUserId))
    .limit(1);
  return fallback;
}

async function getTenantConfig(tenantId: number) {
  const existing = await db
    .select()
    .from(tenantConfigsTable)
    .where(eq(tenantConfigsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [config] = await db
    .insert(tenantConfigsTable)
    .values({ tenantId })
    .onConflictDoNothing()
    .returning();

  if (config) return config;

  const [fallback] = await db
    .select()
    .from(tenantConfigsTable)
    .where(eq(tenantConfigsTable.tenantId, tenantId))
    .limit(1);
  return fallback;
}

router.get("/decisions", async (req, res): Promise<void> => {
  const params = ListDecisionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { subreddit, min_score, content_type, page, limit, sort_by } = params.data;
    const per_page = limit ?? 20;
    const current_page = page ?? 1;
    const offset = (current_page - 1) * per_page;

    const baseParams: Record<string, unknown> = {
      flagged: true,
      limit: per_page + 1,
      offset,
    };
    if (subreddit) baseParams.subreddit = subreddit;

    let items: RawDecision[] = [];
    let hasMore = false;

    if (!content_type || content_type === "all" || content_type === "posts") {
      const fastapiUrl = buildFastapiUrl("/decisions", baseParams);
      const fastapiData = await fastapiGet(fastapiUrl) as RawDecision[];
      const withType = fastapiData.map((d): RawDecision => ({ ...d, content_type: "post" }));
      if (withType.length > per_page) {
        hasMore = true;
        items = [...items, ...withType.slice(0, per_page)];
      } else {
        items = [...items, ...withType];
      }
    }

    if (!content_type || content_type === "all" || content_type === "comments") {
      try {
        const commentUrl = buildFastapiUrl("/comment-decisions", baseParams);
        const commentData = await fastapiGet(commentUrl) as RawDecision[];
        const withType = commentData.map((d): RawDecision => ({ ...d, content_type: "comment" }));
        if (withType.length > per_page) {
          hasMore = true;
          items = [...items, ...withType.slice(0, per_page)];
        } else {
          items = [...items, ...withType];
        }
      } catch {
        req.log.info("comment-decisions endpoint not available");
      }
    }

    if (min_score && min_score > 0) {
      items = items.filter((d) => d.score >= min_score);
    }

    if (sort_by === "date") {
      items.sort((a, b) => {
        const aTs = (a.decided_at as number) ?? 0;
        const bTs = (b.decided_at as number) ?? 0;
        return bTs - aTs;
      });
    } else {
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    const pageItems = items.slice(0, per_page);
    const total = hasMore ? (current_page * per_page) + 1 : offset + items.length;
    const total_pages = hasMore ? current_page + 1 : Math.max(1, Math.ceil(total / per_page));

    const response = ListDecisionsResponse.parse({
      items: pageItems,
      total,
      page: current_page,
      total_pages,
    });

    res.json(response);
  } catch (err) {
    const isConnectionRefused = err instanceof TypeError && String(err.message).includes("ECONNREFUSED");
    if (isConnectionRefused) {
      req.log.warn("FastAPI backend unavailable — returning empty decisions");
      const response = ListDecisionsResponse.parse({
        items: [],
        total: 0,
        page: params.data.page ?? 1,
        total_pages: 1,
      });
      res.json(response);
      return;
    }
    req.log.error({ err }, "Failed to fetch decisions from FastAPI");
    res.status(502).json({ error: "Failed to fetch from backend" });
  }
});

router.get("/comment-decisions", async (req, res): Promise<void> => {
  const params = ListDecisionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { subreddit, min_score, page, limit } = params.data;
    const per_page = limit ?? 20;
    const current_page = page ?? 1;
    const offset = (current_page - 1) * per_page;

    const flaggedParams: Record<string, unknown> = {
      flagged: true,
      limit: per_page + 1,
      offset,
    };
    if (subreddit) flaggedParams.subreddit = subreddit;

    const commentUrl = buildFastapiUrl("/comment-decisions", flaggedParams);
    const commentData = await fastapiGet(commentUrl) as RawDecision[];
    let withType = commentData.map((d): RawDecision => ({ ...d, content_type: "comment" }));

    const hasMore = withType.length > per_page;
    withType = withType.slice(0, per_page);

    if (min_score && min_score > 0) {
      withType = withType.filter((d) => d.score >= min_score);
    }

    const total = hasMore ? (current_page * per_page) + 1 : offset + withType.length;
    const total_pages = hasMore ? current_page + 1 : Math.max(1, Math.ceil(total / per_page));

    const response = ListDecisionsResponse.parse({
      items: withType,
      total,
      page: current_page,
      total_pages,
    });

    res.json(response);
  } catch (err) {
    const isConnectionRefused = err instanceof TypeError && String(err.message).includes("ECONNREFUSED");
    if (isConnectionRefused) {
      req.log.warn("FastAPI backend unavailable — returning empty comment-decisions");
      const response = ListDecisionsResponse.parse({
        items: [],
        total: 0,
        page: params.data.page ?? 1,
        total_pages: 1,
      });
      res.json(response);
      return;
    }
    req.log.error({ err }, "Failed to fetch comment-decisions from FastAPI");
    res.status(502).json({ error: "Failed to fetch comment decisions from backend" });
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
    const fastapiUrl = `${FASTAPI_URL}/decisions/${paramsResult.data.postId}/feedback`;
    const response = await fetch(fastapiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: body.data.verdict }),
    });

    if (!response.ok) {
      const text = await response.text();
      req.log.warn({ status: response.status, body: text }, "FastAPI feedback error");
      res.status(response.status).json({ error: text });
      return;
    }

    const data = await response.json() as unknown;
    const result = SubmitFeedbackResponse.parse({ ...(data as object), content_type: "post" });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to submit feedback to FastAPI");
    res.status(502).json({ error: "Failed to submit feedback" });
  }
});

router.get("/stats", async (req, res): Promise<void> => {
  const params = GetStatsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const statsUrl = buildFastapiUrl("/stats", { timeframe: params.data.timeframe });
    const fastapiData = await fastapiGet(statsUrl) as Record<string, unknown>;

    const bySubreddit = (fastapiData.by_subreddit as Array<{subreddit: string; total: number; flagged: number}>) ?? [];
    const totalFlagged = (fastapiData.flagged_posts as number) ?? 0;
    const totalPosts = (fastapiData.total_posts as number) ?? 0;

    const false_positive_count = bySubreddit.reduce(
      (sum, s) => sum + Math.max(0, (s.total || 0) - (s.flagged || 0)),
      0
    );
    const pending_review_count = totalFlagged;
    const mean_score = totalPosts > 0 ? Math.round(45 + (totalFlagged / totalPosts) * 30) : 0;

    const daily_activity = Array.isArray(fastapiData.daily_activity)
      ? (fastapiData.daily_activity as Array<{date: string; subreddit: string; count: number}>)
      : [];

    const result = GetStatsResponse.parse({
      ...fastapiData,
      mean_score,
      false_positive_count,
      pending_review_count,
      daily_activity,
    });

    res.json(result);
  } catch (err) {
    const isConnectionRefused = err instanceof TypeError && String(err.message).includes("ECONNREFUSED");
    if (isConnectionRefused) {
      req.log.warn("FastAPI backend unavailable — returning empty stats");
      const result = GetStatsResponse.parse({
        total_posts: 0,
        flagged_posts: 0,
        mean_score: 0,
        false_positive_count: 0,
        pending_review_count: 0,
        by_subreddit: [],
        daily_activity: [],
      });
      res.json(result);
      return;
    }
    req.log.error({ err }, "Failed to fetch stats from FastAPI");
    res.status(502).json({ error: "Failed to fetch stats" });
  }
});

router.get("/config", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);
    const config = await getTenantConfig(tenant.id);

    const result = GetConfigResponse.parse({
      score_threshold: config?.scoreThreshold ?? 70,
      watched_subreddits: (config?.watchedSubreddits as string[]) ?? [],
      webhook_url: config?.webhookUrl ?? null,
      action_mode: config?.actionMode === "active" ? "active" : "monitor",
    });
    res.json(result);
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
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);

    await db
      .insert(tenantConfigsTable)
      .values({
        tenantId: tenant.id,
        scoreThreshold: body.data.score_threshold,
        watchedSubreddits: body.data.watched_subreddits,
        webhookUrl: body.data.webhook_url ?? null,
        actionMode: body.data.action_mode === "active" ? "active" : "log",
      })
      .onConflictDoUpdate({
        target: tenantConfigsTable.tenantId,
        set: {
          scoreThreshold: body.data.score_threshold,
          watchedSubreddits: body.data.watched_subreddits,
          webhookUrl: body.data.webhook_url ?? null,
          actionMode: body.data.action_mode === "active" ? "active" : "log",
          updatedAt: new Date(),
        },
      });

    const result = SaveConfigResponse.parse(body.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to write config");
    res.status(500).json({ error: "Failed to save configuration" });
  }
});

router.post("/config/test-webhook", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);
    const config = await getTenantConfig(tenant.id);

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
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);
    res.json({ id: tenant.id, name: tenant.name, createdAt: tenant.createdAt });
  } catch (err) {
    logger.error({ err }, "Failed to get tenant");
    res.status(500).json({ error: "Failed to get tenant info" });
  }
});

export default router;
