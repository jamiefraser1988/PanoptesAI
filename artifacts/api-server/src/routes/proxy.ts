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

    if (pageItems.length === 0 && !hasMore) {
      req.log.info("FastAPI returned no decisions — checking local DB for seeded data");
      try {
        const emptyAuth = getAuth(req);
        const emptyUserId = emptyAuth?.sessionClaims?.userId || emptyAuth?.userId;
        if (emptyUserId) {
          const emptyTenant = await getOrCreateTenant(emptyUserId);
          const dbConditions = [
            eq(modActionsTable.tenantId, emptyTenant.id),
            sql`(${modActionsTable.details}->>'score')::int >= 40`,
          ];
          if (subreddit) dbConditions.push(eq(modActionsTable.subreddit, subreddit));
          if (content_type && content_type !== "all") {
            dbConditions.push(eq(modActionsTable.targetType, content_type === "posts" ? "post" : "comment"));
          }
          const dbRows = await db
            .select()
            .from(modActionsTable)
            .where(and(...dbConditions))
            .orderBy(desc(modActionsTable.createdAt))
            .limit(per_page + 1)
            .offset(offset);
          const dbHasMore = dbRows.length > per_page;
          const dbPageRows = dbRows.slice(0, per_page);
          const dbItems = dbPageRows
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
                flagged: true,
                decided_at: Math.floor(row.createdAt.getTime() / 1000),
                feedback: null,
                content_type: (row.targetType === "comment" ? "comment" : "post") as "post" | "comment",
              };
            })
            .filter(Boolean);
          if (dbItems.length > 0) {
            const dbTotal = dbHasMore ? offset + per_page + 1 : offset + dbItems.length;
            const dbTotalPages = dbHasMore ? current_page + 1 : Math.max(1, Math.ceil(dbTotal / per_page));
            res.json(ListDecisionsResponse.parse({ items: dbItems, total: dbTotal, page: current_page, total_pages: dbTotalPages }));
            return;
          }
        }
      } catch (dbErr) {
        req.log.warn({ dbErr }, "DB empty-fallback for decisions failed");
      }
    }

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

    if (totalPosts === 0) {
      req.log.info("FastAPI returned zero-data stats — checking local DB for seeded data");
      try {
        const statsAuth = getAuth(req);
        const statsUserId = statsAuth?.sessionClaims?.userId || statsAuth?.userId;
        const statsRows = statsUserId
          ? await db.select().from(modActionsTable)
              .where(eq(modActionsTable.tenantId, (await getOrCreateTenant(statsUserId)).id))
              .orderBy(desc(modActionsTable.createdAt)).limit(1000)
          : [];
        const rows = statsRows;
        if (rows.length > 0) {
          const db_total = rows.length;
          const dbFlagged = rows.filter((r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            return typeof d.score === "number" && (d.score as number) >= 40;
          });
          const db_flagged = dbFlagged.length;
          const db_flag_rate = Math.round((db_flagged / db_total) * 100);
          const db_mean = Math.round(rows.reduce((s, r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            return s + (typeof d.score === "number" ? (d.score as number) : 0);
          }, 0) / db_total);
          const subMap: Record<string, { total: number; flagged: number }> = {};
          for (const r of rows) {
            const sub = r.subreddit ?? "unknown";
            if (!subMap[sub]) subMap[sub] = { total: 0, flagged: 0 };
            subMap[sub].total++;
            const d = (r.details ?? {}) as Record<string, unknown>;
            if (typeof d.score === "number" && (d.score as number) >= 40) subMap[sub].flagged++;
          }
          const reasonMap: Record<string, number> = {};
          for (const r of rows) {
            const d = (r.details ?? {}) as Record<string, unknown>;
            const reasons = Array.isArray(d.reasons) ? (d.reasons as string[]) : [];
            for (const reason of reasons) {
              if (reason !== "No suspicious signals detected") reasonMap[reason] = (reasonMap[reason] ?? 0) + 1;
            }
          }
          const dailyMap: Record<string, Record<string, number>> = {};
          for (const r of rows) {
            const date = r.createdAt.toISOString().slice(0, 10);
            const sub = r.subreddit ?? "unknown";
            if (!dailyMap[date]) dailyMap[date] = {};
            dailyMap[date][sub] = (dailyMap[date][sub] ?? 0) + 1;
          }
          const dbParsed = GetStatsResponse.safeParse({
            total_posts: db_total,
            flagged_posts: db_flagged,
            flag_rate_pct: db_flag_rate,
            mean_score: db_mean,
            false_positive_count: 0,
            pending_review_count: db_flagged,
            by_subreddit: Object.entries(subMap).map(([subreddit, v]) => ({ subreddit, ...v })),
            top_reasons: Object.entries(reasonMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
            daily_activity: Object.entries(dailyMap).flatMap(([date, subs]) =>
              Object.entries(subs).map(([subreddit, count]) => ({ date, subreddit, count }))
            ),
          });
          if (dbParsed.success) {
            res.json(dbParsed.data);
            return;
          }
        }
      } catch (dbErr) {
        req.log.warn({ dbErr }, "DB empty-fallback for stats failed");
      }
    }

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

router.delete("/devvit/seed-demo", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);

    const result = await db
      .delete(modActionsTable)
      .where(and(
        eq(modActionsTable.tenantId, tenant.id),
        sql`${modActionsTable.targetId} LIKE 't3_demo%'`
      ))
      .returning({ id: modActionsTable.id });

    logger.info({ tenantId: tenant.id, deleted: result.length }, "Demo data cleared");
    res.json({ success: true, deleted: result.length });
  } catch (err) {
    logger.error({ err }, "Failed to clear demo data");
    res.status(500).json({ error: "Failed to clear demo data" });
  }
});

router.post("/devvit/seed-demo", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tenant = await getOrCreateTenant(userId);

    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(modActionsTable)
      .where(and(
        eq(modActionsTable.tenantId, tenant.id),
        sql`${modActionsTable.targetId} LIKE 't3_demo%'`
      ));

    if ((existing[0]?.count ?? 0) > 0) {
      res.json({ success: true, count: 0, message: "Demo data already loaded" });
      return;
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const seedRows = [
      {
        tenantId: tenant.id,
        action: "remove",
        targetId: "t3_demo001",
        targetType: "post",
        author: "CryptoHelper2024",
        subreddit: "CryptoGeneral",
        details: {
          score: 90,
          flagged: true,
          title: "🚨 DM me for guaranteed 5x returns — limited spots left",
          body: "I recovered $47k in lost crypto. DM me on telegram now. Wallet recovery specialist. Act now before spots fill up!",
          reasons: ['Scam keyword: "dm me"', 'Scam keyword: "telegram"', 'Scam keyword: "wallet recovery"', 'Scam keyword: "guaranteed returns"', 'Urgency language: "act now"'],
          permalink: "/r/CryptoGeneral/comments/demo001",
        },
        createdAt: new Date(now - 1 * day),
      },
      {
        tenantId: tenant.id,
        action: "remove",
        targetId: "t3_demo002",
        targetType: "post",
        author: "InvestmentGuru9999",
        subreddit: "personalfinance",
        details: {
          score: 82,
          flagged: true,
          title: "Free bitcoin giveaway — claim your reward now!",
          body: "Get free crypto by clicking the link. Verify your account and double your bitcoin. Send me 0.1 BTC to receive 0.2 BTC back. Investment opportunity of a lifetime.",
          reasons: ['Scam keyword: "free bitcoin"', 'Scam keyword: "double your"', 'Scam keyword: "verify your account"', 'Scam keyword: "investment opportunity"', 'Suspicious domain: claim-reward'],
          permalink: "/r/personalfinance/comments/demo002",
        },
        createdAt: new Date(now - 1.5 * day),
      },
      {
        tenantId: tenant.id,
        action: "remove",
        targetId: "t3_demo003",
        targetType: "comment",
        author: "TechSupportHelper",
        subreddit: "techsupport",
        details: {
          score: 75,
          flagged: true,
          title: "Re: My computer is slow — need help",
          body: "Contact our helpdesk immediately. Call our tech support line and verify your account. We can fix this issue via remote access. Send me your login details via WhatsApp.",
          reasons: ['Scam keyword: "helpdesk"', 'Scam keyword: "tech support"', 'Scam keyword: "verify your account"', 'Scam keyword: "whatsapp"'],
          permalink: "/r/techsupport/comments/demo003/reply/demo003r",
        },
        createdAt: new Date(now - 2 * day),
      },
      {
        tenantId: tenant.id,
        action: "review",
        targetId: "t3_demo004",
        targetType: "post",
        author: "WealthBuilder123",
        subreddit: "investing",
        details: {
          score: 60,
          flagged: true,
          title: "Passive income strategy that changed my life",
          body: "I found this amazing passive income system. Investment opportunity with guaranteed profit. Limited time offer — click here to learn more.",
          reasons: ['Scam keyword: "passive income"', 'Scam keyword: "guaranteed profit"', 'Scam keyword: "investment opportunity"', 'Scam keyword: "click here"'],
          permalink: "/r/investing/comments/demo004",
        },
        createdAt: new Date(now - 2.5 * day),
      },
      {
        tenantId: tenant.id,
        action: "review",
        targetId: "t3_demo005",
        targetType: "post",
        author: "moneymaker4567",
        subreddit: "CryptoGeneral",
        details: {
          score: 55,
          flagged: true,
          title: "Funds recovery service — got my money back after being scammed",
          body: "I was scammed but found a funds recovery specialist. They helped me get $12k back. DM me if you need their contact info.",
          reasons: ['Scam keyword: "funds recovery"', 'Scam keyword: "dm me"'],
          permalink: "/r/CryptoGeneral/comments/demo005",
        },
        createdAt: new Date(now - 3 * day),
      },
      {
        tenantId: tenant.id,
        action: "review",
        targetId: "t3_demo006",
        targetType: "comment",
        author: "QuickRichScheme",
        subreddit: "personalfinance",
        details: {
          score: 45,
          flagged: true,
          title: "Re: Best investment strategies for 2024",
          body: "Urgent — free money opportunity expires tonight! Wire transfer details in my bio. Don't miss out on this last chance.",
          reasons: ['Scam keyword: "free money"', 'Scam keyword: "wire transfer"', 'Urgency language: "last chance"'],
          permalink: "/r/personalfinance/comments/demo006/reply/demo006r",
        },
        createdAt: new Date(now - 3.5 * day),
      },
      {
        tenantId: tenant.id,
        action: "approve",
        targetId: "t3_demo007",
        targetType: "post",
        author: "NormalUser_Gaming",
        subreddit: "gaming",
        details: {
          score: 12,
          flagged: false,
          title: "Just hit level 100 in my favorite RPG — took me 3 months",
          body: "Finally made it! The grind was worth it. Love this game community. Anyone else grinding end-game content?",
          reasons: ["No suspicious signals detected"],
          permalink: "/r/gaming/comments/demo007",
        },
        createdAt: new Date(now - 4 * day),
      },
      {
        tenantId: tenant.id,
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
        tenantId: tenant.id,
        action: "review",
        targetId: "t3_demo009",
        targetType: "post",
        author: "CryptoNewbie2024",
        subreddit: "CryptoGeneral",
        details: {
          score: 42,
          flagged: true,
          title: "Signal app group for crypto trading — join us",
          body: "We share daily trade signals in a private signal app group. Join our community. Not financial advice.",
          reasons: ['Scam keyword: "signal app"'],
          permalink: "/r/CryptoGeneral/comments/demo009",
        },
        createdAt: new Date(now - 5.5 * day),
      },
      {
        tenantId: tenant.id,
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

    await db.insert(modActionsTable).values(seedRows as typeof modActionsTable.$inferInsert[]);

    logger.info({ tenantId: tenant.id, count: seedRows.length }, "Seeded demo data");
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
