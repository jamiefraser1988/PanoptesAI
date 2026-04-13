import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { contentItemsTable } from "./content-items";
import { scoringRunsTable } from "./scoring-runs";

export const labelEventsTable = pgTable(
  "label_events",
  {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id")
      .references(() => contentItemsTable.id, { onDelete: "cascade" })
      .notNull(),
    scoringRunId: integer("scoring_run_id")
      .references(() => scoringRunsTable.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: integer("tenant_id")
      .references(() => tenantsTable.id, { onDelete: "cascade" })
      .notNull(),
    verdict: text("verdict").notNull(),
    labelSource: text("label_source").notNull().default("moderator_feedback"),
    note: text("note"),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("label_events_tenant_created_at_idx").on(table.tenantId, table.createdAt),
    index("label_events_tenant_verdict_idx").on(table.tenantId, table.verdict),
    index("label_events_content_item_idx").on(table.contentItemId, table.createdAt),
  ],
);

export type LabelEvent = typeof labelEventsTable.$inferSelect;
