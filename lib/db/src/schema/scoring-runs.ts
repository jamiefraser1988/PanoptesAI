import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { contentItemsTable } from "./content-items";
import { modActionsTable } from "./mod-actions";

export const scoringRunsTable = pgTable(
  "scoring_runs",
  {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id")
      .references(() => contentItemsTable.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: integer("tenant_id")
      .references(() => tenantsTable.id, { onDelete: "cascade" })
      .notNull(),
    pipelineVersion: text("pipeline_version").notNull().default("node-canonical-v1"),
    rulesVersion: text("rules_version").notNull().default("rules-v1"),
    modelVersion: text("model_version"),
    scoringMode: text("scoring_mode").notNull().default("rules_only"),
    ruleScore: integer("rule_score").notNull(),
    mlScore: integer("ml_score"),
    finalScore: integer("final_score").notNull(),
    confidence: integer("confidence"),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    aiSummary: text("ai_summary"),
    aiSignals: jsonb("ai_signals").$type<string[]>().notNull().default([]),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    recommendedAction: text("recommended_action").notNull(),
    configSnapshot: jsonb("config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    featureSnapshot: jsonb("feature_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    latencyMs: integer("latency_ms"),
    sourceModActionId: integer("source_mod_action_id").references(() => modActionsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scoring_runs_source_mod_action_id_idx").on(table.sourceModActionId),
    index("scoring_runs_tenant_created_at_idx").on(table.tenantId, table.createdAt),
    index("scoring_runs_content_item_created_at_idx").on(table.contentItemId, table.createdAt),
    index("scoring_runs_tenant_final_score_idx").on(table.tenantId, table.finalScore),
    index("scoring_runs_tenant_scoring_mode_idx").on(table.tenantId, table.scoringMode),
  ],
);

export type ScoringRun = typeof scoringRunsTable.$inferSelect;
