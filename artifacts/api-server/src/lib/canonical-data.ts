import {
  and,
  asc,
  contentItemsTable,
  db,
  desc,
  eq,
  labelEventsTable,
  modActionsTable,
  pool,
  scoringRunsTable,
  sql,
} from "@workspace/db";
import { logger } from "./logger";

export const REVIEW_SCORE_THRESHOLD = 40;
const DEFAULT_PIPELINE_VERSION = "node-canonical-v1";
const DEFAULT_RULES_VERSION = "rules-v1";
const MAX_AUDIT_BODY_LENGTH = 500;

type DbExecutor = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export type CanonicalContentType = "post" | "comment";
export type LabelVerdict = "true_positive" | "false_positive" | "unclear";
export type ScoringMode = "rules_only" | "shadow_ml" | "blended_ml";
export type DecisionSortBy = "score" | "date";

export interface CanonicalContentInput {
  tenantId: number;
  redditId: string;
  contentType: CanonicalContentType;
  subreddit: string;
  author: string;
  title?: string;
  body?: string;
  permalink?: string;
  sourceCreatedAt?: Date | number | string | null;
  ingestedAt?: Date;
  rawMetadata?: Record<string, unknown>;
}

export interface CanonicalScoringInput {
  pipelineVersion?: string;
  rulesVersion?: string;
  modelVersion?: string | null;
  scoringMode?: ScoringMode;
  ruleScore: number;
  mlScore?: number | null;
  finalScore?: number;
  confidence?: number | null;
  reasons: string[];
  aiSummary?: string | null;
  aiSignals?: string[];
  categories?: string[];
  recommendedAction: string;
  configSnapshot?: Record<string, unknown>;
  featureSnapshot?: Record<string, unknown>;
  latencyMs?: number | null;
  createdAt?: Date;
}

export interface RecordScoredContentInput {
  content: CanonicalContentInput;
  scoring: CanonicalScoringInput;
  auditAction: string;
  actionMode: "monitor" | "active";
  auditDetails?: Record<string, unknown>;
}

export interface DecisionListOptions {
  tenantId: number;
  subreddit?: string;
  minScore?: number;
  contentType?: CanonicalContentType;
  page: number;
  limit: number;
  sortBy?: DecisionSortBy;
}

export interface DecisionItem {
  id: number;
  post_id: string;
  subreddit: string;
  author: string;
  title: string;
  score: number;
  reasons: string[];
  flagged: boolean;
  decided_at: number;
  feedback?: string | null;
  content_type?: CanonicalContentType;
}

export interface DecisionListResult {
  items: DecisionItem[];
  total: number;
  page: number;
  total_pages: number;
}

export interface StatsResult {
  total_posts: number;
  flagged_posts: number;
  flag_rate_pct: number;
  mean_score: number;
  false_positive_count: number;
  pending_review_count: number;
  by_subreddit: Array<{ subreddit: string; total: number; flagged: number }>;
  top_reasons: Array<{ reason: string; count: number }>;
  daily_activity: Array<{ date: string; subreddit: string; count: number }>;
}

export interface UserProfileResult {
  author: string;
  total_items: number;
  flagged_items: number;
  avg_score: number;
  subreddits: string[];
  recent_items: DecisionItem[];
  risk_level: "high" | "medium" | "low";
}

interface DecisionQueryRow {
  decision_id: number;
  content_item_id: number;
  reddit_id: string;
  subreddit: string;
  author: string;
  title: string;
  raw_body: string;
  final_score: number;
  reasons: unknown;
  verdict: string | null;
  content_type: CanonicalContentType;
  decided_at: Date | string;
  total_count: number | string;
}

interface StatsQueryRow {
  subreddit: string;
  final_score: number;
  reasons: unknown;
  verdict: string | null;
  decided_at: Date | string;
}

interface UserProfileQueryRow {
  decision_id: number;
  reddit_id: string;
  subreddit: string;
  author: string;
  title: string;
  raw_body: string;
  final_score: number;
  reasons: unknown;
  verdict: string | null;
  content_type: CanonicalContentType;
  decided_at: Date | string;
}

interface FeedbackTargetRow {
  content_item_id: number;
  scoring_run_id: number;
  decision_id: number;
  reddit_id: string;
  subreddit: string;
  author: string;
  title: string;
  raw_body: string;
  final_score: number;
  reasons: unknown;
  verdict: string | null;
  content_type: CanonicalContentType;
  decided_at: Date | string;
}

const backfilledTenants = new Set<number>();
const inflightBackfills = new Map<number, Promise<void>>();

function trimString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function cleanSubredditName(value: string | null | undefined): string {
  return trimString(value).replace(/^r\//i, "");
}

export function normalizeSubredditName(value: string | null | undefined): string {
  return cleanSubredditName(value).toLowerCase();
}

export function normalizeBody(value: string | null | undefined): string {
  return trimString(value).replace(/\s+/g, " ");
}

export function extractUrls(...parts: Array<string | null | undefined>): string[] {
  const text = parts.filter(Boolean).join(" ");
  const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return [...new Set(matches.map((match) => match.trim()))];
}

export function extractDomains(urls: string[]): string[] {
  const domains = urls
    .map((url) => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return [...new Set(domains)];
}

function truncateForAudit(value: string): string {
  const compact = normalizeBody(value);
  if (compact.length <= MAX_AUDIT_BODY_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_AUDIT_BODY_LENGTH)}...`;
}

function toDate(value: Date | number | string | null | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(milliseconds);
  }

  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function toUnixSeconds(value: Date | string): number {
  return Math.floor(toDate(value).getTime() / 1000);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildDecisionTitle(title: string, rawBody: string): string {
  const cleanTitle = trimString(title);
  if (cleanTitle) {
    return cleanTitle;
  }

  const fallback = normalizeBody(rawBody);
  if (!fallback) {
    return "[no title]";
  }

  if (fallback.length <= 140) {
    return fallback;
  }

  return `${fallback.slice(0, 140)}...`;
}

function mapVerdictToAction(verdict: LabelVerdict): string {
  if (verdict === "true_positive") {
    return "confirm_scam";
  }
  if (verdict === "false_positive") {
    return "mark_safe";
  }
  return "mark_unclear";
}

function mapDecisionRow(row: DecisionQueryRow | FeedbackTargetRow | UserProfileQueryRow, feedbackOverride?: string | null): DecisionItem {
  return {
    id: row.decision_id,
    post_id: row.reddit_id,
    subreddit: row.subreddit,
    author: row.author,
    title: buildDecisionTitle(row.title, row.raw_body),
    score: row.final_score,
    reasons: sanitizeStringArray(row.reasons),
    flagged: row.final_score >= REVIEW_SCORE_THRESHOLD,
    decided_at: toUnixSeconds(row.decided_at),
    feedback: feedbackOverride ?? row.verdict,
    content_type: row.content_type,
  };
}

async function upsertContentItem(executor: DbExecutor, input: CanonicalContentInput) {
  const title = trimString(input.title);
  const body = input.body ?? "";
  const permalink = trimString(input.permalink);
  const urls = extractUrls(title, body, permalink);
  const domains = extractDomains(urls);
  const sourceCreatedAt = toDate(input.sourceCreatedAt);
  const ingestedAt = input.ingestedAt ?? new Date();

  const [contentItem] = await executor
    .insert(contentItemsTable)
    .values({
      tenantId: input.tenantId,
      redditId: trimString(input.redditId),
      contentType: input.contentType,
      subreddit: cleanSubredditName(input.subreddit),
      author: trimString(input.author),
      title,
      rawBody: body,
      normalizedBody: normalizeBody(body),
      permalink,
      sourceCreatedAt,
      ingestedAt,
      extractedUrls: urls,
      extractedDomains: domains,
      rawMetadata: input.rawMetadata ?? {},
    })
    .onConflictDoUpdate({
      target: [
        contentItemsTable.tenantId,
        contentItemsTable.redditId,
        contentItemsTable.contentType,
      ],
      set: {
        subreddit: cleanSubredditName(input.subreddit),
        author: trimString(input.author),
        title,
        rawBody: body,
        normalizedBody: normalizeBody(body),
        permalink,
        sourceCreatedAt,
        ingestedAt,
        extractedUrls: urls,
        extractedDomains: domains,
        rawMetadata: input.rawMetadata ?? {},
      },
    })
    .returning();

  return contentItem;
}

async function insertScoringRun(
  executor: DbExecutor,
  contentItemId: number,
  tenantId: number,
  input: CanonicalScoringInput,
  sourceModActionId?: number,
) {
  const insertQuery = executor
    .insert(scoringRunsTable)
    .values({
      contentItemId,
      tenantId,
      pipelineVersion: input.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
      rulesVersion: input.rulesVersion ?? DEFAULT_RULES_VERSION,
      modelVersion: input.modelVersion ?? null,
      scoringMode: input.scoringMode ?? "rules_only",
      ruleScore: input.ruleScore,
      mlScore: input.mlScore ?? null,
      finalScore: input.finalScore ?? input.ruleScore,
      confidence: input.confidence ?? null,
      reasons: input.reasons,
      aiSummary: input.aiSummary ?? null,
      aiSignals: input.aiSignals ?? [],
      categories: input.categories ?? [],
      recommendedAction: input.recommendedAction,
      configSnapshot: input.configSnapshot ?? {},
      featureSnapshot: input.featureSnapshot ?? {},
      latencyMs: input.latencyMs ?? null,
      sourceModActionId: sourceModActionId ?? null,
      createdAt: input.createdAt ?? new Date(),
    });

  const [scoringRun] = sourceModActionId
    ? await insertQuery
        .onConflictDoNothing({ target: scoringRunsTable.sourceModActionId })
        .returning()
    : await insertQuery.returning();

  if (scoringRun) {
    return scoringRun;
  }

  if (sourceModActionId == null) {
    throw new Error("Failed to insert scoring run");
  }

  const [existing] = await executor
    .select()
    .from(scoringRunsTable)
    .where(eq(scoringRunsTable.sourceModActionId, sourceModActionId))
    .limit(1);

  if (!existing) {
    throw new Error("Failed to resolve existing scoring run");
  }

  return existing;
}

function buildAuditDetails(
  content: CanonicalContentInput,
  scoringRunId: number,
  contentItemId: number,
  scoring: CanonicalScoringInput,
  actionMode: "monitor" | "active",
  extraDetails?: Record<string, unknown>,
): Record<string, unknown> {
  const score = scoring.finalScore ?? scoring.ruleScore;
  return {
    score,
    reasons: scoring.reasons,
    title: trimString(content.title),
    body: truncateForAudit(content.body ?? ""),
    permalink: trimString(content.permalink),
    action_mode: actionMode,
    ai_summary: scoring.aiSummary ?? null,
    ai_signals: scoring.aiSignals ?? [],
    ml_score: scoring.mlScore ?? null,
    confidence: scoring.confidence ?? null,
    scoring_mode: scoring.scoringMode ?? "rules_only",
    model_version: scoring.modelVersion ?? null,
    flagged: score >= REVIEW_SCORE_THRESHOLD,
    content_item_id: contentItemId,
    scoring_run_id: scoringRunId,
    ...extraDetails,
  };
}

export async function recordScoredContent(input: RecordScoredContentInput) {
  return db.transaction(async (tx) => {
    const contentItem = await upsertContentItem(tx, input.content);
    const scoringRun = await insertScoringRun(tx, contentItem.id, input.content.tenantId, input.scoring);

    const [modAction] = await tx
      .insert(modActionsTable)
      .values({
        tenantId: input.content.tenantId,
        action: input.auditAction,
        targetId: trimString(input.content.redditId),
        targetType: input.content.contentType,
        author: trimString(input.content.author),
        subreddit: cleanSubredditName(input.content.subreddit),
        details: buildAuditDetails(
          input.content,
          scoringRun.id,
          contentItem.id,
          input.scoring,
          input.actionMode,
          input.auditDetails,
        ),
      })
      .returning({ id: modActionsTable.id });

    const [linkedScoringRun] = await tx
      .update(scoringRunsTable)
      .set({ sourceModActionId: modAction.id })
      .where(eq(scoringRunsTable.id, scoringRun.id))
      .returning();

    return {
      contentItem,
      scoringRun: linkedScoringRun ?? scoringRun,
      modActionId: modAction.id,
    };
  });
}

export async function ensureCanonicalBackfillForTenant(tenantId: number): Promise<void> {
  if (backfilledTenants.has(tenantId)) {
    return;
  }

  const existing = inflightBackfills.get(tenantId);
  if (existing) {
    return existing;
  }

  const backfillPromise = (async () => {
    const legacyRows = await db
      .select()
      .from(modActionsTable)
      .where(eq(modActionsTable.tenantId, tenantId))
      .orderBy(asc(modActionsTable.createdAt), asc(modActionsTable.id));

    if (legacyRows.length === 0) {
      backfilledTenants.add(tenantId);
      return;
    }

    await db.transaction(async (tx) => {
      for (const row of legacyRows) {
        const details = sanitizeRecord(row.details);
        const score = toNumber(details.score);
        if (score == null) {
          continue;
        }

        const title = typeof details.title === "string" ? details.title : "";
        const body = typeof details.body === "string" ? details.body : "";
        const permalink = typeof details.permalink === "string" ? details.permalink : "";
        const reasons = sanitizeStringArray(details.reasons);
        const aiSignals = sanitizeStringArray(details.ai_signals);
        const aiSummary = typeof details.ai_summary === "string" ? details.ai_summary : null;
        const mlScore = toNumber(details.ml_score);
        const confidence = toNumber(details.confidence);
        const contentType: CanonicalContentType = row.targetType === "comment" ? "comment" : "post";
        const actionMode =
          typeof details.action_mode === "string" && details.action_mode === "active"
            ? "active"
            : "monitor";
        const scoringMode: ScoringMode =
          typeof details.scoring_mode === "string" &&
          (details.scoring_mode === "rules_only" ||
            details.scoring_mode === "shadow_ml" ||
            details.scoring_mode === "blended_ml")
            ? details.scoring_mode
            : mlScore != null
              ? "shadow_ml"
              : "rules_only";

        const contentItem = await upsertContentItem(tx, {
          tenantId,
          redditId: row.targetId,
          contentType,
          subreddit: row.subreddit ?? "unknown",
          author: row.author ?? "unknown",
          title,
          body,
          permalink,
          sourceCreatedAt: row.createdAt,
          ingestedAt: row.createdAt,
          rawMetadata: {
            migrated_from_mod_action_id: row.id,
            legacy_details: details,
          },
        });

        await insertScoringRun(
          tx,
          contentItem.id,
          tenantId,
          {
            ruleScore: score,
            mlScore,
            finalScore: score,
            confidence,
            reasons,
            aiSummary,
            aiSignals,
            recommendedAction: row.action,
            scoringMode,
            configSnapshot: {
              backfilled: true,
              legacy_action_mode: actionMode,
            },
            featureSnapshot: {
              backfilled: true,
              migrated_from_mod_action_id: row.id,
            },
            createdAt: row.createdAt,
          },
          row.id,
        );
      }
    });

    backfilledTenants.add(tenantId);
    logger.info({ tenantId }, "Canonical content backfill complete");
  })()
    .catch((err) => {
      logger.error({ err, tenantId }, "Canonical content backfill failed");
      throw err;
    })
    .finally(() => {
      inflightBackfills.delete(tenantId);
    });

  inflightBackfills.set(tenantId, backfillPromise);
  return backfillPromise;
}

function buildDecisionWhereClause(options: {
  tenantId: number;
  subreddit?: string;
  minScore?: number;
  contentType?: CanonicalContentType;
}) {
  const values: Array<string | number> = [options.tenantId, REVIEW_SCORE_THRESHOLD];
  const conditions = ["ci.tenant_id = $1", "lr.final_score >= $2"];

  if (options.subreddit) {
    values.push(normalizeSubredditName(options.subreddit));
    conditions.push(`lower(ci.subreddit) = $${values.length}`);
  }

  if (options.contentType) {
    values.push(options.contentType);
    conditions.push(`ci.content_type = $${values.length}`);
  }

  if (typeof options.minScore === "number" && Number.isFinite(options.minScore) && options.minScore > 0) {
    values.push(options.minScore);
    conditions.push(`lr.final_score >= $${values.length}`);
  }

  return { values, whereSql: conditions.join(" AND ") };
}

export async function listDecisionItems(options: DecisionListOptions): Promise<DecisionListResult> {
  await ensureCanonicalBackfillForTenant(options.tenantId);

  const page = Math.max(1, options.page);
  const limit = Math.min(100, Math.max(1, options.limit));
  const offset = (page - 1) * limit;
  const sortBy = options.sortBy === "date" ? "date" : "score";
  const orderBy =
    sortBy === "date"
      ? "lr.created_at DESC, lr.id DESC"
      : "lr.final_score DESC, lr.created_at DESC, lr.id DESC";

  const { values, whereSql } = buildDecisionWhereClause(options);
  values.push(limit, offset);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;

  const query = `
    WITH latest_runs AS (
      SELECT DISTINCT ON (content_item_id)
        id,
        content_item_id,
        final_score,
        reasons,
        created_at
      FROM scoring_runs
      WHERE tenant_id = $1
      ORDER BY content_item_id, created_at DESC, id DESC
    ),
    latest_labels AS (
      SELECT DISTINCT ON (content_item_id)
        content_item_id,
        verdict
      FROM label_events
      WHERE tenant_id = $1
      ORDER BY content_item_id, created_at DESC, id DESC
    )
    SELECT
      lr.id AS decision_id,
      ci.id AS content_item_id,
      ci.reddit_id,
      ci.subreddit,
      ci.author,
      ci.title,
      ci.raw_body,
      lr.final_score,
      lr.reasons,
      ll.verdict,
      ci.content_type,
      lr.created_at AS decided_at,
      count(*) OVER()::int AS total_count
    FROM content_items ci
    JOIN latest_runs lr ON lr.content_item_id = ci.id
    LEFT JOIN latest_labels ll ON ll.content_item_id = ci.id
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
  `;

  const result = await pool.query<DecisionQueryRow>(query, values);
  const items = result.rows.map((row) => mapDecisionRow(row));
  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

  return {
    items,
    total,
    page,
    total_pages: totalPages,
  };
}

export async function getDecisionForFeedback(tenantId: number, redditId: string): Promise<FeedbackTargetRow | null> {
  await ensureCanonicalBackfillForTenant(tenantId);

  const result = await pool.query<FeedbackTargetRow>(
    `
      WITH latest_runs AS (
        SELECT DISTINCT ON (content_item_id)
          id,
          content_item_id,
          final_score,
          reasons,
          created_at
        FROM scoring_runs
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      ),
      latest_labels AS (
        SELECT DISTINCT ON (content_item_id)
          content_item_id,
          verdict
        FROM label_events
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      )
      SELECT
        lr.id AS decision_id,
        ci.id AS content_item_id,
        lr.id AS scoring_run_id,
        ci.reddit_id,
        ci.subreddit,
        ci.author,
        ci.title,
        ci.raw_body,
        lr.final_score,
        lr.reasons,
        ll.verdict,
        ci.content_type,
        lr.created_at AS decided_at
      FROM content_items ci
      JOIN latest_runs lr ON lr.content_item_id = ci.id
      LEFT JOIN latest_labels ll ON ll.content_item_id = ci.id
      WHERE ci.tenant_id = $1
        AND ci.reddit_id = $2
      ORDER BY lr.created_at DESC, lr.id DESC
      LIMIT 1
    `,
    [tenantId, trimString(redditId)],
  );

  return result.rows[0] ?? null;
}

export async function recordFeedbackLabel(input: {
  tenantId: number;
  redditId: string;
  verdict: LabelVerdict;
  actorId?: string | null;
  note?: string | null;
}) {
  const target = await getDecisionForFeedback(input.tenantId, input.redditId);
  if (!target) {
    return null;
  }

  await db.transaction(async (tx) => {
    await tx.insert(labelEventsTable).values({
      tenantId: input.tenantId,
      contentItemId: target.content_item_id,
      scoringRunId: target.scoring_run_id,
      verdict: input.verdict,
      labelSource: "moderator_feedback",
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    });

    await tx.insert(modActionsTable).values({
      tenantId: input.tenantId,
      action: mapVerdictToAction(input.verdict),
      targetId: target.reddit_id,
      targetType: target.content_type,
      author: target.author,
      subreddit: target.subreddit,
      details: {
        verdict: input.verdict,
        content_item_id: target.content_item_id,
        scoring_run_id: target.scoring_run_id,
        note: input.note ?? null,
      },
    });
  });

  return mapDecisionRow(target, input.verdict);
}

export async function getStatsForTenant(tenantId: number, timeframe: "24h" | "7d" | "30d"): Promise<StatsResult> {
  await ensureCanonicalBackfillForTenant(tenantId);

  const now = new Date();
  const cutoff = new Date(now);
  if (timeframe === "24h") {
    cutoff.setHours(cutoff.getHours() - 24);
  } else if (timeframe === "30d") {
    cutoff.setDate(cutoff.getDate() - 30);
  } else {
    cutoff.setDate(cutoff.getDate() - 7);
  }

  const result = await pool.query<StatsQueryRow>(
    `
      WITH latest_runs AS (
        SELECT DISTINCT ON (content_item_id)
          id,
          content_item_id,
          final_score,
          reasons,
          created_at
        FROM scoring_runs
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      ),
      latest_labels AS (
        SELECT DISTINCT ON (content_item_id)
          content_item_id,
          verdict
        FROM label_events
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      )
      SELECT
        ci.subreddit,
        lr.final_score,
        lr.reasons,
        ll.verdict,
        lr.created_at AS decided_at
      FROM content_items ci
      JOIN latest_runs lr ON lr.content_item_id = ci.id
      LEFT JOIN latest_labels ll ON ll.content_item_id = ci.id
      WHERE ci.tenant_id = $1
        AND lr.created_at >= $2
    `,
    [tenantId, cutoff],
  );

  const rows = result.rows;
  const totalPosts = rows.length;
  const flaggedPosts = rows.filter((row) => row.final_score >= REVIEW_SCORE_THRESHOLD).length;
  const falsePositiveCount = rows.filter((row) => row.verdict === "false_positive").length;
  const pendingReviewCount = rows.filter(
    (row) => row.final_score >= REVIEW_SCORE_THRESHOLD && (!row.verdict || row.verdict === "unclear"),
  ).length;
  const meanScore = totalPosts > 0
    ? Math.round(rows.reduce((sum, row) => sum + row.final_score, 0) / totalPosts)
    : 0;
  const flagRatePct = totalPosts > 0 ? Math.round((flaggedPosts / totalPosts) * 100) : 0;

  const subredditMap = new Map<string, { subreddit: string; total: number; flagged: number }>();
  const reasonMap = new Map<string, number>();
  const dailyMap = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const subreddit = row.subreddit || "unknown";
    const subredditEntry = subredditMap.get(subreddit) ?? { subreddit, total: 0, flagged: 0 };
    subredditEntry.total += 1;
    if (row.final_score >= REVIEW_SCORE_THRESHOLD) {
      subredditEntry.flagged += 1;
    }
    subredditMap.set(subreddit, subredditEntry);

    if (row.final_score >= REVIEW_SCORE_THRESHOLD) {
      for (const reason of sanitizeStringArray(row.reasons)) {
        if (reason === "No suspicious signals detected") {
          continue;
        }
        reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
      }
    }

    const date = toDate(row.decided_at).toISOString().slice(0, 10);
    const dateMap = dailyMap.get(date) ?? new Map<string, number>();
    dateMap.set(subreddit, (dateMap.get(subreddit) ?? 0) + 1);
    dailyMap.set(date, dateMap);
  }

  const bySubreddit = [...subredditMap.values()].sort((a, b) => b.total - a.total);
  const topReasons = [...reasonMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));
  const dailyActivity = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([date, subredditCounts]) =>
      [...subredditCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([subreddit, count]) => ({ date, subreddit, count })),
    );

  return {
    total_posts: totalPosts,
    flagged_posts: flaggedPosts,
    flag_rate_pct: flagRatePct,
    mean_score: meanScore,
    false_positive_count: falsePositiveCount,
    pending_review_count: pendingReviewCount,
    by_subreddit: bySubreddit,
    top_reasons: topReasons,
    daily_activity: dailyActivity,
  };
}

export async function getUserProfileForTenant(tenantId: number, author: string): Promise<UserProfileResult> {
  await ensureCanonicalBackfillForTenant(tenantId);

  const result = await pool.query<UserProfileQueryRow>(
    `
      WITH latest_runs AS (
        SELECT DISTINCT ON (content_item_id)
          id,
          content_item_id,
          final_score,
          reasons,
          created_at
        FROM scoring_runs
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      ),
      latest_labels AS (
        SELECT DISTINCT ON (content_item_id)
          content_item_id,
          verdict
        FROM label_events
        WHERE tenant_id = $1
        ORDER BY content_item_id, created_at DESC, id DESC
      )
      SELECT
        lr.id AS decision_id,
        ci.reddit_id,
        ci.subreddit,
        ci.author,
        ci.title,
        ci.raw_body,
        lr.final_score,
        lr.reasons,
        ll.verdict,
        ci.content_type,
        lr.created_at AS decided_at
      FROM content_items ci
      JOIN latest_runs lr ON lr.content_item_id = ci.id
      LEFT JOIN latest_labels ll ON ll.content_item_id = ci.id
      WHERE ci.tenant_id = $1
        AND lower(ci.author) = lower($2)
      ORDER BY lr.created_at DESC, lr.id DESC
    `,
    [tenantId, trimString(author)],
  );

  const rows = result.rows;
  const totalItems = rows.length;
  const flaggedItems = rows.filter((row) => row.final_score >= REVIEW_SCORE_THRESHOLD).length;
  const avgScore = totalItems > 0
    ? Math.round(rows.reduce((sum, row) => sum + row.final_score, 0) / totalItems)
    : 0;
  const subreddits = [...new Set(rows.map((row) => row.subreddit).filter(Boolean))];
  const recentItems = rows.slice(0, 10).map((row) => mapDecisionRow(row));
  const riskLevel: UserProfileResult["risk_level"] =
    avgScore >= 70 ? "high" : avgScore >= REVIEW_SCORE_THRESHOLD ? "medium" : "low";

  return {
    author: trimString(author),
    total_items: totalItems,
    flagged_items: flaggedItems,
    avg_score: avgScore,
    subreddits,
    recent_items: recentItems,
    risk_level: riskLevel,
  };
}

export async function clearDemoContentForTenant(tenantId: number): Promise<number> {
  await ensureCanonicalBackfillForTenant(tenantId);

  return db.transaction(async (tx) => {
    const contentRows = await tx
      .select({ id: contentItemsTable.id })
      .from(contentItemsTable)
      .where(and(
        eq(contentItemsTable.tenantId, tenantId),
        sql`${contentItemsTable.redditId} LIKE 't3_demo%'`,
      ));

    if (contentRows.length > 0) {
      await tx
        .delete(contentItemsTable)
        .where(and(
          eq(contentItemsTable.tenantId, tenantId),
          sql`${contentItemsTable.redditId} LIKE 't3_demo%'`,
        ));
    }

    const modActionRows = await tx
      .delete(modActionsTable)
      .where(and(
        eq(modActionsTable.tenantId, tenantId),
        sql`${modActionsTable.targetId} LIKE 't3_demo%'`,
      ))
      .returning({ id: modActionsTable.id });

    return modActionRows.length;
  });
}
