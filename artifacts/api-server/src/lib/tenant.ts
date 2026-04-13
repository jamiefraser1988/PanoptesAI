import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { db, eq, tenantConfigsTable, tenantsTable, type Tenant, type TenantConfig } from "@workspace/db";
import type { RequestWithUserId } from "../middlewares/requireAuth";

export function getClerkUserId(req: Request): string | null {
  const requestUserId = (req as RequestWithUserId).userId;
  if (requestUserId) {
    return requestUserId;
  }

  const auth = getAuth(req);
  return auth?.sessionClaims?.userId || auth?.userId || null;
}

export async function getOrCreateTenant(clerkUserId: string): Promise<Tenant> {
  const existing = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ clerkUserId, name: "My Organization" })
    .onConflictDoNothing()
    .returning();

  if (tenant) {
    return tenant;
  }

  const [fallback] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.clerkUserId, clerkUserId))
    .limit(1);

  if (fallback) {
    return fallback;
  }

  throw new Error(`Failed to resolve tenant for Clerk user ${clerkUserId}`);
}

export async function getTenantConfig(tenantId: number): Promise<TenantConfig> {
  const existing = await db
    .select()
    .from(tenantConfigsTable)
    .where(eq(tenantConfigsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [config] = await db
    .insert(tenantConfigsTable)
    .values({ tenantId })
    .onConflictDoNothing()
    .returning();

  if (config) {
    return config;
  }

  const [fallback] = await db
    .select()
    .from(tenantConfigsTable)
    .where(eq(tenantConfigsTable.tenantId, tenantId))
    .limit(1);

  if (fallback) {
    return fallback;
  }

  throw new Error(`Failed to resolve tenant config for tenant ${tenantId}`);
}
