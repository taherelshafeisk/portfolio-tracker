import { db } from "@workspace/db";
import { activitiesTable, positionsTable, accountsTable } from "@workspace/db";
import { eq, and, asc, isNotNull, inArray, sql } from "drizzle-orm";

// Derive the transaction type from db so helpers work both standalone and inside db.transaction().
type Tx = Parameters<typeof db.transaction>[0] extends (tx: infer T) => unknown ? T : never;
type DbOrTx = typeof db | Tx;

/**
 * Adjusts account.currentBalance for a single activity.
 * direction=1 applies the normal effect; direction=-1 reverses it (used on delete).
 *
 * Cash effects:
 *   buy / withdrawal  → debit  (balance decreases)
 *   sell / deposit / dividend → credit (balance increases)
 *
 * @deprecated Use recomputeCashBalance() inside a transaction instead.
 */
export async function adjustCashForActivity(
  accountId: number,
  activityType: string,
  quantity: number | null,
  price: number | null,
  totalAmount: number | null,
  direction: 1 | -1 = 1,
): Promise<void> {
  const absAmt =
    totalAmount != null
      ? Math.abs(totalAmount)
      : quantity != null && price != null
        ? Math.abs(quantity * price)
        : null;

  if (absAmt == null || absAmt === 0) return;

  const isDebit = activityType === "buy" || activityType === "withdrawal";
  const delta = direction * (isDebit ? -absAmt : absAmt);

  await db
    .update(accountsTable)
    .set({ currentBalance: sql`current_balance + ${delta}`, updatedAt: new Date() })
    .where(eq(accountsTable.id, accountId));
}

/**
 * Recomputes account.currentBalance from scratch: initialBalance + sum of all cash effects
 * across every activity row for the account.
 *
 * This is idempotent and safe to call inside a transaction (pass tx) or standalone.
 */
export async function recomputeCashBalance(accountId: number, dbx: DbOrTx = db): Promise<void> {
  const [account] = await dbx
    .select({ initialBalance: accountsTable.initialBalance })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account) return;

  const activities = await dbx
    .select({
      activityType: activitiesTable.activityType,
      quantity: activitiesTable.quantity,
      price: activitiesTable.price,
      totalAmount: activitiesTable.totalAmount,
    })
    .from(activitiesTable)
    .where(eq(activitiesTable.accountId, accountId));

  let cashDelta = 0;
  for (const a of activities) {
    const absAmt =
      a.totalAmount != null
        ? Math.abs(parseFloat(a.totalAmount))
        : a.quantity != null && a.price != null
          ? Math.abs(parseFloat(a.quantity) * parseFloat(a.price))
          : null;

    if (absAmt == null || absAmt === 0) continue;

    const isDebit = a.activityType === "buy" || a.activityType === "withdrawal";
    cashDelta += isDebit ? -absAmt : absAmt;
  }

  const newBalance = (parseFloat(account.initialBalance) + cashDelta).toFixed(4);

  await dbx
    .update(accountsTable)
    .set({ currentBalance: newBalance, updatedAt: new Date() })
    .where(eq(accountsTable.id, accountId));
}

/**
 * Recomputes qty and avgCost for a (accountId, symbol) pair from scratch
 * by walking all activity rows in chronological order.
 *
 * - buy:  adds qty, recalculates weighted avg cost
 * - sell: subtracts qty, avg cost stays the same
 * - other types: ignored for qty/cost purposes
 *
 * After computation:
 *   currentQty > 0  → upsert positionsTable
 *   currentQty <= 0 → keep a closed tombstone (qty=0) so activity history links remain valid
 */
export async function reconcilePosition(
  accountId: number,
  symbol: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<{ qty: number; avgCost: number; symbol: string; accountId: number }> {
  const activities = await dbx
    .select()
    .from(activitiesTable)
    .where(and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.symbol, symbol)))
    .orderBy(asc(activitiesTable.tradeDate));

  // If there are no buy activities, the position was seeded directly (imported without trade
  // history). Seed the opening balance from the existing position row so that sells applied
  // after import are treated as deltas against that balance rather than against zero.
  const hasBuys = activities.some((a) => a.activityType === "buy");

  let currentQty = 0;
  let avgCost = 0;

  if (!hasBuys) {
    const [existing] = await dbx
      .select()
      .from(positionsTable)
      .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, symbol)));
    if (existing) {
      currentQty = parseFloat(existing.quantity);
      avgCost = parseFloat(existing.avgCost);
    }
  }

  for (const activity of activities) {
    const qty = activity.quantity ? parseFloat(activity.quantity) : 0;
    const price = activity.price ? parseFloat(activity.price) : 0;

    if (activity.activityType === "buy" && qty > 0) {
      const newQty = currentQty + qty;
      avgCost = (currentQty * avgCost + qty * price) / newQty;
      currentQty = newQty;
    } else if (activity.activityType === "sell" && qty > 0) {
      currentQty = Math.max(0, currentQty - qty);
    }
  }

  // Find ALL rows for this (accountId, symbol) pair. More than one means a
  // duplicate crept in (e.g. screenshot import ran twice before the unique
  // constraint existed). Delete the extras, keeping only the canonical row.
  const allExisting = await dbx
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, symbol)));

  if (allExisting.length > 1) {
    const [, ...dupes] = allExisting; // keep first, delete the rest
    await dbx.delete(positionsTable).where(inArray(positionsTable.id, dupes.map(r => r.id)));
  }

  const existing = allExisting[0] ?? null;

  if (currentQty > 0) {
    if (existing) {
      await dbx
        .update(positionsTable)
        .set({ quantity: currentQty.toString(), avgCost: avgCost.toFixed(4), updatedAt: new Date() })
        .where(eq(positionsTable.id, existing.id));
    } else {
      // No position row yet — create one from activity data (symbol used as name fallback)
      await dbx.insert(positionsTable).values({
        accountId,
        symbol,
        name: symbol,
        quantity: currentQty.toString(),
        avgCost: avgCost.toFixed(4),
        currentPrice: "0",
        userId,
      });
    }
  } else {
    // Keep a closed tombstone (qty=0) so activity history links remain valid.
    if (existing) {
      await dbx
        .update(positionsTable)
        .set({ quantity: "0", updatedAt: new Date() })
        .where(eq(positionsTable.id, existing.id));
    } else {
      // No row existed (e.g. SELL imported without a prior position row) — create a tombstone.
      await dbx.insert(positionsTable).values({
        accountId,
        symbol,
        name: symbol,
        quantity: "0",
        avgCost: avgCost.toFixed(4),
        currentPrice: "0",
        userId,
      });
    }
  }

  return { qty: currentQty, avgCost, symbol, accountId };
}

/**
 * Reconciles every unique (accountId, symbol) pair found in activitiesTable,
 * then recomputes cash balances for every account that has activity rows.
 * Safe to run at any time — idempotent.
 *
 * Pass userId to scope reconciliation to a single user (used by the HTTP route).
 * Omit userId to reconcile all users (used by startup and internal jobs only).
 */
export async function reconcileAll(userId?: string): Promise<{
  reconciled: number;
  positionsUpdated: number;
  positionsDeleted: number;
  cashRecomputed: number;
}> {
  // When userId is provided, resolve that user's account IDs for scoping.
  let scopedAccountIds: number[] | null = null;
  if (userId) {
    const userAccounts = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.userId, userId));
    scopedAccountIds = userAccounts.map(a => a.id);
    if (scopedAccountIds.length === 0) {
      return { reconciled: 0, positionsUpdated: 0, positionsDeleted: 0, cashRecomputed: 0 };
    }
  }

  const pairs = scopedAccountIds
    ? await db
        .selectDistinct({ accountId: activitiesTable.accountId, symbol: activitiesTable.symbol })
        .from(activitiesTable)
        .where(and(isNotNull(activitiesTable.symbol), inArray(activitiesTable.accountId, scopedAccountIds)))
    : await db
        .selectDistinct({ accountId: activitiesTable.accountId, symbol: activitiesTable.symbol })
        .from(activitiesTable)
        .where(isNotNull(activitiesTable.symbol));

  // Build accountId → userId map for insert ownership (scoped when possible)
  const accountRows = scopedAccountIds
    ? await db.select({ id: accountsTable.id, userId: accountsTable.userId }).from(accountsTable)
        .where(inArray(accountsTable.id, scopedAccountIds))
    : await db.select({ id: accountsTable.id, userId: accountsTable.userId }).from(accountsTable);
  const accountUserMap = Object.fromEntries(accountRows.map(a => [a.id, a.userId]));

  let positionsUpdated = 0;
  let positionsDeleted = 0;

  for (const { accountId, symbol } of pairs) {
    if (!symbol) continue;
    const pairUserId = accountUserMap[accountId];
    if (!pairUserId) continue;
    const result = await reconcilePosition(accountId, symbol, pairUserId);
    if (result.qty > 0) positionsUpdated++;
    else positionsDeleted++;
  }

  // Recompute cash for every account that has ANY activity (including non-symbol types
  // such as deposit/withdrawal that are excluded from the symbol-keyed pairs above).
  const activityAccountRows = scopedAccountIds
    ? await db.selectDistinct({ accountId: activitiesTable.accountId }).from(activitiesTable)
        .where(inArray(activitiesTable.accountId, scopedAccountIds))
    : await db.selectDistinct({ accountId: activitiesTable.accountId }).from(activitiesTable);

  const uniqueAccountIds = activityAccountRows.map(r => r.accountId);
  for (const accountId of uniqueAccountIds) {
    await recomputeCashBalance(accountId);
  }

  return {
    reconciled: pairs.length,
    positionsUpdated,
    positionsDeleted,
    cashRecomputed: uniqueAccountIds.length,
  };
}
