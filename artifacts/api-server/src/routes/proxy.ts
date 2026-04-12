import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { db, eq, desc, and, sql, tenantsTable, tenantConfigsTable, modActionsTable } from "@workspace/db";
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

function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? "";
  if (msg.includes("ECONNREFUSED")) return true;
  const cause = (err as { cause?: Error }).cause;
  if (cause instanceof Error && cause.message?.includes("ECONNREFUSED")) return true;
  return false;
}

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

async function logModAction(tenantId: number, action: string, targetId: string, targetType: string, author?: string, subreddit?: string, details?: Record<string, unknown>) {
  try {
    await db.insert(modActionsTable).values({
      tenantId,
      action,
      targetId,
      targetType,
      author: author ?? null,
      subreddit: subreddit ?? null,
      details: details ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to log mod action");
  }
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
    if (isConnectionRefused(err)) {
      req.log.info("FastAPI backend unavailable — reading decisions from local DB");
      try {
        const { subreddit, min_score, content_type, page, limit } = params.data;
        const per_page = limit ?? 20;
        const current_page = page ?? 1;
        const offset = (current_page - 1) * per_page;

        const conditions = [];
        if (subreddit) conditions.push(eq(modActionsTable.subreddit, subreddit));
        if (content_type && content_type !== "all") {
          conditions.push(eq(modActionsTable.targetType, content_type === "posts" ? "post" : "comment"));
        }

        const rows = await db
          .select()
          .from(modActionsTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(modActionsTable.createdAt))
          .limit(per_page + 1)
          .offset(offset);

        const hasMore = rows.length > per_page;
        const pageRows = rows.slice(0, per_page);

        const items = pageRows
          .map((row) => {
            const d = (row.details ?? {}) as Record<string, unknown>;
            const score = typeof d.score === "number" ? d.score : 0;
            if (min_score && score < min_score) return null;
            return {
              id: row.id,
              post_id: row.targetId,
              subreddit: row.subreddit ?? "",
              author: row.author ?? "",
              title: typeof d.title === "string" ? d.title : "",
              score,
              reasons: Array.isArray(d.reasons) ? (d.reasons as string[]) : [],
              flagged: score >= 40,
              decided_at: Math.floor(row.createdAt.getTime() / 1000),
              feedback: null,
              content_type: (row.targetType === "comment" ? "comment" : "post") as "post" | "comment",
            };
          })
          .filter(Boolean);

        const total = hasMore ? offset + per_page + 1 : offset + items.length;
        const total_pages = hasMore ? current_page + 1 : Math.max(1, Math.ceil(total / per_page));

        const response = ListDecisionsResponse.parse({ items, total, page: current_page, total_pages });
        res.json(response);
      } catch (dbErr) {
        req.log.error({ dbErr }, "DB fallback for decisions also failed");
        res.json(ListDecisionsResponse.parse({ items: [], total: 0, page: params.data.page ?? 1, total_pages: 1 }));
      }
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
    if (isConnectionRefused(err)) {
      req.log.info("FastAPI backend unavailable — returning empty comment-decisions");
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

    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (userId) {
      try {
        const tenant = await getOrCreateTenant(userId);
        await logModAction(
          tenant.id,
          body.data.verdict === "true_positive" ? "confirm_scam" : body.data.verdict === "false_positive" ? "mark_safe" : "mark_unclear",
          paramsResult.data.postId,
          "post",
          undefined,
          undefined,
          { verdict: body.data.verdict }
        );
      } catch {
      }
    }

    res.json(result);
  } catch (err) {
    if (isConnectionRefused(err)) {
      req.log.info("FastAPI backend unavailable — cannot submit feedback");
      res.status(503).json({ error: "Scoring backend is not currently running. Feedback cannot be submitted." });
      return;
    }
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

    const flag_rate_pct = totalPosts > 0 ? Math.round((totalFlagged / totalPosts) * 100) : 0;
    const top_reasons = Array.isArray(fastapiData.top_reasons)
      ? (fastapiData.top_reasons as Array<{reason: string; count: number}>)
      : [];

    const result = GetStatsResponse.parse({
      ...fastapiData,
      mean_score,
      false_positive_count,
      pending_review_count,
      daily_activity,
      flag_rate_pct,
      top_reasons,
    });

    res.json(result);
  } catch (err) {
    if (isConnectionRefused(err)) {
      req.log.info("FastAPI backend unavailable — computing stats from local DB");
      try {
        const rows = await db.select().from(modActionsTable).orderBy(desc(modActionsTable.createdAt)).limit(1000);

        const total_posts = rows.length;
        const flaggedRows = rows.filter((r) => {
          const d = (r.details ?? {}) as Record<string, unknown>;
          return typeof d.score === "number" && (d.score as number) >= 40;
        });
        const flagged_posts = flaggedRows.length;
        const flag_rate_pct = total_posts > 0 ? Math.round((flagged_posts / total_posts) * 100) : 0;

        const scoreSum = rows.reduce((sum, r) => {
          const d = (r.details ?? {}) as Record<string, unknown>;
          return sum + (typeof d.score === "number" ? (d.score as number) : 0);
        }, 0);
        const mean_score = total_posts > 0 ? Math.round(scoreSum / total_posts) : 0;

        const subredditMap: Record<string, { total: number; flagged: number }> = {};
        for (const r of rows) {
          const sub = r.subreddit ?? "unknown";
          if (!subredditMap[sub]) subredditMap[sub] = { total: 0, flagged: 0 };
          subredditMap[sub].total++;
          const d = (r.details ?? {}) as Record<string, unknown>;
          if (typeof d.score === "number" && (d.score as number) >= 40) subredditMap[sub].flagged++;
        }
        const by_subreddit = Object.entries(subredditMap).map(([subreddit, v]) => ({ subreddit, ...v }));

        const reasonMap: Record<string, number> = {};
        for (const r of rows) {
          const d = (r.details ?? {}) as Record<string, unknown>;
          const reasons = Array.isArray(d.reasons) ? (d.reasons as string[]) : [];
          for (const reason of reasons) {
            if (reason !== "No suspicious signals detected") {
              reasonMap[reason] = (reasonMap[reason] ?? 0) + 1;
            }
          }
        }
        const top_reasons = Object.entries(reasonMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([reason, count]) => ({ reason, count }));

        const dailyMap: Record<string, Record<string, number>> = {};
        for (const r of rows) {
          const date = r.createdAt.toISOString().slice(0, 10);
          const sub = r.subreddit ?? "unknown";
          if (!dailyMap[date]) dailyMap[date] = {};
          dailyMap[date][sub] = (dailyMap[date][sub] ?? 0) + 1;
        }
        const daily_activity = Object.entries(dailyMap).flatMap(([date, subs]) =>
          Object.entries(subs).map(([subreddit, count]) => ({ date, subreddit, count }))
        );

        const parsed = GetStatsResponse.safeParse({
          total_posts,
          flagged_posts,
          flag_rate_pct,
          mean_score,
          false_positive_count: 0,
          pending_review_count: flagged_posts,
          by_subreddit,
          top_reasons,
          daily_activity,
        });
        res.json(parsed.success ? parsed.data : {
          total_posts, flagged_posts, flag_rate_pct, mean_score,
          false_positive_count: 0, pending_review_count: flagged_posts,
          by_subreddit, top_reasons, daily_activity,
        });
      } catch (dbErr) {
        req.log.error({ dbErr }, "DB fallback for stats also failed");
        res.json({
          total_posts: 0, flagged_posts: 0, flag_rate_pct: 0, mean_score: 0,
          false_positive_count: 0, pending_review_count: 0, by_subreddit: [], top_reasons: [], daily_activity: [],
        });
      }
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
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);

    const rawBody = req.body as Record<string, unknown>;
    const allowedUsers = Array.isArray(rawBody.allowed_users) ? rawBody.allowed_users as string[] : [];
    const blockedUsers = Array.isArray(rawBody.blocked_users) ? rawBody.blocked_users as string[] : [];
    const customRules = Array.isArray(rawBody.custom_rules) ? rawBody.custom_rules as Array<Record<string, unknown>> : [];

    await db
      .insert(tenantConfigsTable)
      .values({
        tenantId: tenant.id,
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

router.get("/mod-actions", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const actionFilter = req.query.action as string | undefined;

    const conditions = [eq(modActionsTable.tenantId, tenant.id)];
    if (actionFilter && actionFilter !== "all") {
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

router.get("/user-profile/:author", async (req, res): Promise<void> => {
  try {
    const author = req.params.author;
    if (!author) {
      res.status(400).json({ error: "author is required" });
      return;
    }

    let postDecisions: RawDecision[] = [];
    let commentDecisions: RawDecision[] = [];

    try {
      const postsUrl = buildFastapiUrl("/decisions", { author, limit: 50 });
      postDecisions = await fastapiGet(postsUrl) as RawDecision[];
    } catch {}

    try {
      const commentsUrl = buildFastapiUrl("/comment-decisions", { author, limit: 50 });
      commentDecisions = await fastapiGet(commentsUrl) as RawDecision[];
    } catch {}

    const allDecisions = [...postDecisions, ...commentDecisions];
    const totalItems = allDecisions.length;
    const flaggedItems = allDecisions.filter((d) => d.score >= 50).length;
    const avgScore = totalItems > 0
      ? Math.round(allDecisions.reduce((sum, d) => sum + (d.score ?? 0), 0) / totalItems)
      : 0;
    const subreddits = [...new Set(allDecisions.map((d) => d.subreddit as string).filter(Boolean))];
    const recentItems = allDecisions
      .sort((a, b) => ((b.decided_at as number) ?? 0) - ((a.decided_at as number) ?? 0))
      .slice(0, 10);

    res.json({
      author,
      total_items: totalItems,
      flagged_items: flaggedItems,
      avg_score: avgScore,
      subreddits,
      recent_items: recentItems,
      risk_level: avgScore >= 70 ? "high" : avgScore >= 40 ? "medium" : "low",
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch user profile");
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

export default router;
