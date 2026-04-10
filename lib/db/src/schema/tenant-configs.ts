import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const tenantConfigsTable = pgTable(
  "tenant_configs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .references(() => tenantsTable.id, { onDelete: "cascade" })
      .notNull(),
    scoreThreshold: integer("score_threshold").notNull().default(70),
    watchedSubreddits: jsonb("watched_subreddits").$type<string[]>().notNull().default([]),
    webhookUrl: text("webhook_url"),
    webhookType: text("webhook_type").notNull().default("generic"),
    actionMode: text("action_mode").notNull().default("log"),
    allowedUsers: jsonb("allowed_users").$type<string[]>().notNull().default([]),
    blockedUsers: jsonb("blocked_users").$type<string[]>().notNull().default([]),
    customRules: jsonb("custom_rules").$type<Array<{ id: string; name: string; field: string; operator: string; value: string; action: string; enabled: boolean }>>().notNull().default([]),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tenant_configs_tenant_id_idx").on(table.tenantId)],
);

export const insertTenantConfigSchema = createInsertSchema(tenantConfigsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertTenantConfig = z.infer<typeof insertTenantConfigSchema>;
export type TenantConfig = typeof tenantConfigsTable.$inferSelect;
