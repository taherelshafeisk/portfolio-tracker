import { db } from "@workspace/db";
import { accountsTable, positionsTable, activitiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { fetchLivePrices } from "../lib/priceService";
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

export async function deleteAccount(id: number, userId: string): Promise<boolean> {
  const [account] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, id), eq(accountsTable.userId, userId)));
  if (!account) return false;

  await db.delete(positionsTable).where(eq(positionsTable.accountId, id));
  await db.delete(activitiesTable).where(eq(activitiesTable.accountId, id));
  await db.delete(accountsTable).where(eq(accountsTable.id, id));
  return true;
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

  const priceMap = activePositions.length > 0
    ? await fetchLivePrices(activePositions.map(p => p.symbol))
    : {};

  return [
    ...activePositions.map(p => formatPosition(p, priceMap[p.symbol] ?? null, { closed: false, extended: false })),
    ...closedPositions.map(p => formatPosition(p, null, { closed: true, extended: false })),
  ];
}
