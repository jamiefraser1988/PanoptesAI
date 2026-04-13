import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const contentItemsTable = pgTable(
  "content_items",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .references(() => tenantsTable.id, { onDelete: "cascade" })
      .notNull(),
    redditId: text("reddit_id").notNull(),
    contentType: text("content_type").notNull(),
    subreddit: text("subreddit").notNull(),
    author: text("author").notNull(),
    title: text("title").notNull().default(""),
    rawBody: text("raw_body").notNull().default(""),
    normalizedBody: text("normalized_body").notNull().default(""),
    permalink: text("permalink").notNull().default(""),
    sourceCreatedAt: timestamp("source_created_at").notNull(),
    ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
    extractedUrls: jsonb("extracted_urls").$type<string[]>().notNull().default([]),
    extractedDomains: jsonb("extracted_domains").$type<string[]>().notNull().default([]),
    rawMetadata: jsonb("raw_metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("content_items_tenant_reddit_type_idx").on(
      table.tenantId,
      table.redditId,
      table.contentType,
    ),
    index("content_items_tenant_ingested_at_idx").on(table.tenantId, table.ingestedAt),
    index("content_items_tenant_subreddit_idx").on(table.tenantId, table.subreddit),
    index("content_items_tenant_author_idx").on(table.tenantId, table.author),
    index("content_items_tenant_reddit_idx").on(table.tenantId, table.redditId),
  ],
);

export type ContentItem = typeof contentItemsTable.$inferSelect;
