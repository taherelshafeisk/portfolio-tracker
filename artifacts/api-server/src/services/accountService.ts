import { db } from "@workspace/db";
import {
  accountsTable, positionsTable, activitiesTable,
  alertsTable, positionFlagsTable, orderSuggestionsTable,
  portfolioSnapshotsTable, priceAlertsTable,
} from "@workspace/db";
import { and, eq, min } from "drizzle-orm";
import { fetchLivePrices, type LivePriceData } from "../lib/priceService";
import { formatPosition } from "../lib/formatters/positionFormatter";

export function toAccountResponse(a: typeof accountsTable.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    broker: a.broker,
    accountType: a.accountType,
    currency: a.currency,
    initialBalance: parseFloat(a.initialBalance),
    currentBalance: parseFloat(a.currentBalance),
    sleeveKey: a.sleeveKey ?? null,
    maxLeverageRatio: a.maxLeverageRatio != null ? parseFloat(a.maxLeverageRatio) : null,
    ipsVersion: a.ipsVersion ?? null,
    concentrationLimit: a.concentrationLimit != null ? parseFloat(a.concentrationLimit) : null,
    leverageCeiling: a.leverageCeiling != null ? parseFloat(a.leverageCeiling) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function listAccounts(userId: string) {
  const accounts = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.userId, userId))
    .orderBy(accountsTable.createdAt);
  return accounts.map(toAccountResponse);
}

export async function getAccount(id: number, userId: string) {
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, id), eq(accountsTable.userId, userId)));
  return account ?? null;
}

export interface CreateAccountInput {
  name: string;
  broker: string;
  accountType: string;
  currency?: string;
  initialBalance: number;
  userId: string;
}

export async function createAccount(input: CreateAccountInput) {
  const [account] = await db
    .insert(accountsTable)
    .values({
      name: input.name,
      broker: input.broker,
      accountType: input.accountType,
      currency: input.currency || "USD",
      initialBalance: input.initialBalance.toString(),
      currentBalance: input.initialBalance.toString(),
      userId: input.userId,
    })
    .returning();
  return toAccountResponse(account);
}

export interface UpdateAccountInput {
  name?: string;
  broker?: string;
  accountType?: string;
  currentBalance?: number;
  sleeveKey?: string;
  maxLeverageRatio?: number | null;
  ipsVersion?: string;
  concentrationLimit?: number | null;
  leverageCeiling?: number | null;
}

export async function updateAccount(id: number, userId: string, input: UpdateAccountInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.broker !== undefined) updates.broker = input.broker;
  if (input.accountType !== undefined) updates.accountType = input.accountType;
  if (input.currentBalance !== undefined) updates.currentBalance = input.currentBalance.toString();
  if (input.sleeveKey !== undefined) updates.sleeveKey = input.sleeveKey || null;
  if (input.maxLeverageRatio !== undefined) updates.maxLeverageRatio = input.maxLeverageRatio != null ? input.maxLeverageRatio.toString() : null;
  if (input.ipsVersion !== undefined) updates.ipsVersion = input.ipsVersion || null;
  if (input.concentrationLimit !== undefined) updates.concentrationLimit = input.concentrationLimit != null ? input.concentrationLimit.toString() : null;
  if (input.leverageCeiling !== undefined) updates.leverageCeiling = input.leverageCeiling != null ? input.leverageCeiling.toString() : null;

  const [account] = await db
    .update(accountsTable)
    .set(updates)
    .where(and(eq(accountsTable.id, id), eq(accountsTable.userId, userId)))
    .returning();
  return account ? toAccountResponse(account) : null;
}

export interface PurgeResult {
  positionsDeleted: number;
  activitiesDeleted: number;
  alertsDeleted: number;
  positionFlagsDeleted: number;
  orderSuggestionsDeleted: number;
  portfolioSnapshotsDeleted: number;
  priceAlertsDeleted: number;
}

async function purgeAccountData(
  accountId: number,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<PurgeResult> {
  const [
    priceAlertsRes,
    alertsRes,
    positionFlagsRes,
    orderSuggestionsRes,
    snapshotsRes,
    activitiesRes,
    positionsRes,
  ] = await Promise.all([
    tx.delete(priceAlertsTable).where(eq(priceAlertsTable.accountId, accountId)).returning({ id: priceAlertsTable.id }),
    tx.delete(alertsTable).where(eq(alertsTable.accountId, accountId)).returning({ id: alertsTable.id }),
    tx.delete(positionFlagsTable).where(eq(positionFlagsTable.accountId, accountId)).returning({ id: positionFlagsTable.id }),
    tx.delete(orderSuggestionsTable).where(eq(orderSuggestionsTable.accountId, accountId)).returning({ id: orderSuggestionsTable.id }),
    tx.delete(portfolioSnapshotsTable).where(eq(portfolioSnapshotsTable.accountId, accountId)).returning({ id: portfolioSnapshotsTable.id }),
    tx.delete(activitiesTable).where(eq(activitiesTable.accountId, accountId)).returning({ id: activitiesTable.id }),
    tx.delete(positionsTable).where(eq(positionsTable.accountId, accountId)).returning({ id: positionsTable.id }),
  ]);

  return {
    positionsDeleted: positionsRes.length,
    activitiesDeleted: activitiesRes.length,
    alertsDeleted: alertsRes.length,
    positionFlagsDeleted: positionFlagsRes.length,
    orderSuggestionsDeleted: orderSuggestionsRes.length,
    portfolioSnapshotsDeleted: snapshotsRes.length,
    priceAlertsDeleted: priceAlertsRes.length,
  };
}

export async function deleteAccount(id: number, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.userId, userId)));
    if (!account) return false;

    await purgeAccountData(id, tx);
    await tx.delete(accountsTable).where(eq(accountsTable.id, id));
    return true;
  });
}

export interface ResetAccountResult extends PurgeResult {
  mode: "delete-account" | "reset-data";
  accountDeleted: boolean;
}

export async function resetAccount(
  id: number,
  userId: string,
  mode: "delete-account" | "reset-data",
  accountNameConfirmation: string,
): Promise<ResetAccountResult | null> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.userId, userId)));
    if (!account) return null;

    if (account.name.trim() !== accountNameConfirmation.trim()) return null;

    const purged = await purgeAccountData(id, tx);

    if (mode === "delete-account") {
      await tx.delete(accountsTable).where(eq(accountsTable.id, id));
      return { ...purged, mode, accountDeleted: true };
    }

    // reset-data: keep the shell, zero out the imported cash balance
    await tx
      .update(accountsTable)
      .set({ currentBalance: "0", updatedAt: new Date() })
      .where(eq(accountsTable.id, id));

    return { ...purged, mode, accountDeleted: false };
  });
}

export async function listAccountPositions(accountId: number, userId: string) {
  // Verify account ownership
  const [account] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)));
  if (!account) return null;

  const positions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.accountId, accountId))
    .orderBy(positionsTable.symbol);

  if (positions.length === 0) return [];

  const activePositions = positions.filter(p => parseFloat(p.quantity) > 0);
  const closedPositions = positions.filter(p => parseFloat(p.quantity) <= 0);

  const [priceMap, firstBuyRows] = await Promise.all([
    activePositions.length > 0 ? fetchLivePrices(activePositions.map(p => p.symbol)) : Promise.resolve({} as Record<string, LivePriceData>),
    db.select({
      symbol: activitiesTable.symbol,
      firstBought: min(activitiesTable.tradeDate),
    })
      .from(activitiesTable)
      .where(and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.activityType, 'buy')))
      .groupBy(activitiesTable.symbol),
  ]);

  const firstBuyMap: Record<string, Date> = {};
  for (const row of firstBuyRows) {
    if (row.symbol && row.firstBought) firstBuyMap[row.symbol] = new Date(row.firstBought);
  }

  return [
    ...activePositions.map(p => formatPosition(p, priceMap[p.symbol] ?? null, { closed: false, extended: false, firstBoughtAt: firstBuyMap[p.symbol] ?? null })),
    ...closedPositions.map(p => formatPosition(p, null, { closed: true, extended: false, firstBoughtAt: firstBuyMap[p.symbol] ?? null })),
  ];
}
