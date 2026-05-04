import { db, positionFlagsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull } from "drizzle-orm";

export interface ListFlagsFilters {
  accountId?: number;
  positionId?: number;
  resolved?: boolean;
}

export async function listFlags(userId: string, filters: ListFlagsFilters) {
  const conditions: ReturnType<typeof eq>[] = [eq(positionFlagsTable.userId, userId)];
  if (filters.accountId != null) conditions.push(eq(positionFlagsTable.accountId, filters.accountId));
  if (filters.positionId != null) conditions.push(eq(positionFlagsTable.positionId, filters.positionId));
  if (filters.resolved === false) conditions.push(isNull(positionFlagsTable.resolvedAt) as ReturnType<typeof eq>);
  else if (filters.resolved === true) conditions.push(isNotNull(positionFlagsTable.resolvedAt) as ReturnType<typeof eq>);
  return db.select().from(positionFlagsTable).where(and(...conditions));
}

export interface CreateFlagInput {
  positionId?: number | null;
  accountId: number;
  flagType: "cut" | "trim" | "review" | "stop" | "reduce_leverage";
  source: "user" | "system";
  dueAt?: Date | null;
  appGeneratedReasonSnapshot?: string | null;
  userConfirmed: boolean;
}

export async function createFlag(userId: string, input: CreateFlagInput) {
  const [flag] = await db
    .insert(positionFlagsTable)
    .values({
      positionId: input.positionId ?? null,
      accountId: input.accountId,
      flagType: input.flagType,
      source: input.source,
      dueAt: input.dueAt ?? null,
      appGeneratedReasonSnapshot: input.appGeneratedReasonSnapshot ?? null,
      userConfirmed: input.userConfirmed,
      userId,
    })
    .returning();
  return flag;
}

export interface ResolveFlagInput {
  resolutionType: "sold" | "trimmed" | "dismissed" | "expired" | "manual_complete";
  resolutionNote?: string | null;
}

export async function resolveFlag(id: number, userId: string, input: ResolveFlagInput) {
  const [updated] = await db
    .update(positionFlagsTable)
    .set({ resolvedAt: new Date(), resolutionType: input.resolutionType, resolutionNote: input.resolutionNote ?? null })
    .where(and(eq(positionFlagsTable.id, id), eq(positionFlagsTable.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteFlag(id: number, userId: string) {
  await db
    .delete(positionFlagsTable)
    .where(and(eq(positionFlagsTable.id, id), eq(positionFlagsTable.userId, userId)));
}
