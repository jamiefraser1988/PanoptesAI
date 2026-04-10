import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const modActionsTable = pgTable("mod_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .references(() => tenantsTable.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  targetType: text("target_type").notNull().default("post"),
  author: text("author"),
  subreddit: text("subreddit"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ModAction = typeof modActionsTable.$inferSelect;
