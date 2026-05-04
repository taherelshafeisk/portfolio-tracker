import { db } from "@workspace/db";
import { positionsTable, activitiesTable, accountsTable } from "@workspace/db";
import { eq, and, desc, asc, inArray, or } from "drizzle-orm";
import { getCachedPrices, fetchLivePrice, fetchLivePrices } from "../lib/priceService";
import type { LivePriceData } from "../lib/priceService";
import { formatPosition } from "../lib/formatters/positionFormatter";
import { computePositionAggregation } from "../lib/positionAggregation";
import type { ActivityRow } from "../lib/positionAggregation";

// ── Input types ───────────────────────────────────────────────────────────────

interface CreatePositionInput {
  accountId: number;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  assetType?: string;
  sector?: string;
  notes?: string;
  positionBucket?: string;
  ipsAction?: string;
  stopPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  cutListAddedAt?: Date | null;
  policyNote?: string;
  ipsVersion?: string;
}

interface UpdatePositionInput {
  quantity?: number;
  avgCost?: number;
  currentPrice?: number;
  assetType?: string;
  notes?: string;
  positionBucket?: string;
  ipsAction?: string;
  stopPrice?: number | null;
  targetPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  cutListAddedAt?: Date | null;
  policyNote?: string;
  ipsVersion?: string;
  exitReason?: string | null;
}

// ── History endpoints ─────────────────────────────────────────────────────────

/**
 * Sleeve-level aggregation across all positions owned by userId.
 * Returns [] when the user has no accounts or no positions.
 */
export async function getPositionHistorySleeves(
  userId: string,
  accountId: number | null,
  statusFilter: string,
) {
  const today = new Date();

  const accounts = accountId
    ? await db.select().from(accountsTable)
        .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)))
    : await db.select().from(accountsTable)
        .where(eq(accountsTable.userId, userId));

  const accountIds = accounts.map(a => a.id);
  if (accountIds.length === 0) return [];

  const positions = accountIds.length === 1
    ? await db.select().from(positionsTable).where(eq(positionsTable.accountId, accountIds[0]))
    : await db.select().from(positionsTable).where(inArray(positionsTable.accountId, accountIds));

  if (positions.length === 0) return [];

  const buyOrSell = or(eq(activitiesTable.activityType, 'buy'), eq(activitiesTable.activityType, 'sell'));
  const activities = accountIds.length === 1
    ? await db.select().from(activitiesTable)
        .where(and(eq(activitiesTable.accountId, accountIds[0]), buyOrSell))
        .orderBy(asc(activitiesTable.tradeDate))
    : await db.select().from(activitiesTable)
        .where(and(inArray(activitiesTable.accountId, accountIds), buyOrSell))
        .orderBy(asc(activitiesTable.tradeDate));

  const actMap = new Map<string, ActivityRow[]>();
  for (const act of activities) {
    if (!act.symbol) continue;
    const key = `${act.accountId}:${act.symbol.toUpperCase()}`;
    if (!actMap.has(key)) actMap.set(key, []);
    actMap.get(key)!.push(act as ActivityRow);
  }

  return accounts.map(account => {
    const acctPositions = positions.filter(p => p.accountId === account.id);
    const positionAggs = acctPositions.map(p => {
      const key = `${account.id}:${p.symbol.toUpperCase()}`;
      const acts = actMap.get(key) ?? [];
      return computePositionAggregation(
        p.id, p.symbol, account.id, acts as ActivityRow[],
        today, parseFloat(p.quantity), parseFloat(p.avgCost),
      );
    });

    const filtered = statusFilter === 'all'
      ? positionAggs
      : positionAggs.filter(p => p.status === statusFilter);

    const closedWithPnl = positionAggs.filter(p => p.status === 'closed');
    const winningClosed = closedWithPnl.filter(p => p.realizedPnl > 0);
    const winRate = closedWithPnl.length > 0
      ? (winningClosed.length / closedWithPnl.length) * 100
      : 0;

    return {
      accountId: account.id,
      accountName: account.name,
      sleeve: account.sleeveKey ?? account.name,
      totalRealizedPnl: closedWithPnl.reduce((s, p) => s + p.realizedPnl, 0),
      totalPositions: positionAggs.length,
      closedPositions: positionAggs.filter(p => p.status === 'closed').length,
      openPositions: positionAggs.filter(p => p.status === 'open').length,
      winRate,
      positions: filtered.map(p => ({
        positionId: p.positionId,
        ticker: p.ticker,
        status: p.status,
        totalShares: p.totalShares,
        avgCostBasis: p.avgCostBasis,
        totalInvested: p.totalInvested,
        realizedPnl: p.realizedPnl,
        firstEntryDate: p.firstEntryDate,
        lastActivityDate: p.lastActivityDate,
        holdDurationDays: p.holdDurationDays,
      })),
    };
  });
}

/**
 * Full detail for a single ticker+account combination.
 * Returns null when the account doesn't exist (or doesn't belong to userId),
 * or when the position doesn't exist — the caller maps null to 404.
 */
export async function getPositionHistoryByTicker(
  userId: string,
  accountId: number,
  ticker: string,
) {
  const today = new Date();

  const [account] = await db.select().from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)));
  if (!account) return null;

  const [position] = await db.select().from(positionsTable)
    .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, ticker)));
  if (!position) return null;

  const activities = await db.select().from(activitiesTable)
    .where(and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.symbol, ticker)))
    .orderBy(asc(activitiesTable.tradeDate));

  const agg = computePositionAggregation(
    position.id, ticker, accountId, activities as ActivityRow[],
    today, parseFloat(position.quantity), parseFloat(position.avgCost),
  );

  let unrealizedPnl: number | null = null;
  let currentPrice: number | null = null;
  if (agg.status === 'open' && agg.totalShares > 0) {
    const livePrice = getCachedPrices([ticker])[ticker]?.price ?? null;
    currentPrice = livePrice ?? parseFloat(position.currentPrice);
    unrealizedPnl = (currentPrice - agg.avgCostBasis) * agg.totalShares;
  }

  return {
    positionId: position.id,
    ticker,
    accountId,
    accountName: account.name ?? null,
    sleeve: account.sleeveKey ?? account.name ?? null,
    status: agg.status,
    totalShares: agg.totalShares,
    avgCostBasis: agg.avgCostBasis,
    totalInvested: agg.totalInvested,
    realizedPnl: agg.realizedPnl,
    unrealizedPnl,
    currentPrice,
    firstEntryDate: agg.firstEntryDate,
    lastActivityDate: agg.lastActivityDate,
    holdDurationDays: agg.holdDurationDays,
    exitReason: position.exitReason ?? null,
    transactions: agg.transactions,
  };
}

/**
 * Trade history (activities) for a single position row, newest first.
 * Returns null when the position doesn't exist or doesn't belong to userId —
 * the caller maps null to 404.
 */
export async function getPositionTradeHistory(userId: string, positionId: number) {
  const [position] = await db.select().from(positionsTable)
    .where(and(eq(positionsTable.id, positionId), eq(positionsTable.userId, userId)));
  if (!position) return null;

  const activities = await db.select().from(activitiesTable)
    .where(and(
      eq(activitiesTable.accountId, position.accountId),
      eq(activitiesTable.symbol, position.symbol),
      eq(activitiesTable.userId, userId),
    ))
    .orderBy(desc(activitiesTable.tradeDate));

  return activities.map(a => ({
    id: a.id,
    accountId: a.accountId,
    symbol: a.symbol || undefined,
    activityType: a.activityType,
    quantity: a.quantity ? parseFloat(a.quantity) : undefined,
    price: a.price ? parseFloat(a.price) : undefined,
    totalAmount: a.totalAmount ? parseFloat(a.totalAmount) : undefined,
    notes: a.notes || undefined,
    tradeDate: a.tradeDate instanceof Date ? a.tradeDate.toISOString() : String(a.tradeDate),
  }));
}

// ── CRUD endpoints ────────────────────────────────────────────────────────────

/**
 * Upsert a position: fetches a live price, then inserts or updates the row
 * (check-then-write, safe before and after any unique constraint is in place).
 * Returns the formatted position response.
 */
export async function createPosition(userId: string, input: CreatePositionInput) {
  const upperSymbol = input.symbol.toUpperCase();

  const livePriceData = await fetchLivePrice(upperSymbol);
  const livePrice = livePriceData?.price ?? null;
  const priceToStore = livePrice ?? input.avgCost;

  const values = {
    accountId: input.accountId,
    symbol: upperSymbol,
    name: input.name,
    quantity: input.quantity.toString(),
    avgCost: input.avgCost.toString(),
    currentPrice: priceToStore.toString(),
    assetType: input.assetType || null,
    sector: input.sector || null,
    notes: input.notes || null,
    notesUpdatedAt: input.notes ? new Date() : null,
    positionBucket: input.positionBucket || null,
    ipsAction: input.ipsAction || null,
    stopPrice: input.stopPrice != null ? input.stopPrice.toString() : null,
    addZoneLow: input.addZoneLow != null ? input.addZoneLow.toString() : null,
    addZoneHigh: input.addZoneHigh != null ? input.addZoneHigh.toString() : null,
    cutListAddedAt: input.cutListAddedAt ?? null,
    policyNote: input.policyNote || null,
    ipsVersion: input.ipsVersion || null,
    userId,
  };

  // Check-then-update/insert so this works before the unique constraint is
  // applied via db push, and also safely after.
  const [existing] = await db
    .select({ id: positionsTable.id })
    .from(positionsTable)
    .where(and(eq(positionsTable.accountId, input.accountId), eq(positionsTable.symbol, upperSymbol)));

  let position;
  if (existing) {
    [position] = await db
      .update(positionsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(positionsTable.id, existing.id))
      .returning();
  } else {
    [position] = await db.insert(positionsTable).values(values).returning();
  }

  return formatPosition(position, livePriceData);
}

/**
 * Partial update for a position row. Only fields present in `input` are written.
 * Returns the formatted position, or null when the row doesn't exist / isn't owned by userId.
 */
export async function updatePosition(userId: string, id: number, input: UpdatePositionInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.quantity !== undefined) updates.quantity = input.quantity.toString();
  if (input.avgCost !== undefined) updates.avgCost = input.avgCost.toString();
  if (input.currentPrice !== undefined) updates.currentPrice = input.currentPrice.toString();
  if (input.assetType !== undefined) updates.assetType = input.assetType || null;
  if (input.notes !== undefined) { updates.notes = input.notes; updates.notesUpdatedAt = new Date(); }
  if (input.positionBucket !== undefined) updates.positionBucket = input.positionBucket || null;
  if (input.ipsAction !== undefined) updates.ipsAction = input.ipsAction || null;
  if (input.stopPrice !== undefined) updates.stopPrice = input.stopPrice != null ? input.stopPrice.toString() : null;
  if (input.targetPrice !== undefined) updates.targetPrice = input.targetPrice != null ? input.targetPrice.toString() : null;
  if (input.addZoneLow !== undefined) updates.addZoneLow = input.addZoneLow != null ? input.addZoneLow.toString() : null;
  if (input.addZoneHigh !== undefined) updates.addZoneHigh = input.addZoneHigh != null ? input.addZoneHigh.toString() : null;
  if (input.cutListAddedAt !== undefined) updates.cutListAddedAt = input.cutListAddedAt ?? null;
  if (input.policyNote !== undefined) updates.policyNote = input.policyNote || null;
  if (input.ipsVersion !== undefined) updates.ipsVersion = input.ipsVersion || null;
  if (input.exitReason !== undefined) updates.exitReason = input.exitReason || null;

  const [position] = await db.update(positionsTable).set(updates)
    .where(and(eq(positionsTable.id, id), eq(positionsTable.userId, userId)))
    .returning();
  if (!position) return null;

  return formatPosition(position);
}

/**
 * Deletes a position owned by userId. No-ops silently if the row doesn't exist.
 */
export async function deletePosition(userId: string, id: number): Promise<void> {
  await db.delete(positionsTable)
    .where(and(eq(positionsTable.id, id), eq(positionsTable.userId, userId)));
}

/**
 * Fetches live prices for all positions owned by userId (optionally filtered by accountId),
 * writes updated currentPrice to each row, and returns the count and price map.
 *
 * Returns null when there are no positions (caller should respond { updated: 0 }).
 * The caller is responsible for calling checkPriceAlerts(priceMap) — kept in the
 * route to avoid the service importing from routes/.
 */
export async function refreshPositionPrices(
  userId: string,
  accountId?: number,
): Promise<{ updated: number; priceMap: Record<string, LivePriceData> } | null> {
  const positions = accountId
    ? await db.select().from(positionsTable)
        .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.userId, userId)))
    : await db.select().from(positionsTable).where(eq(positionsTable.userId, userId));

  if (positions.length === 0) return null;

  const symbols = positions.map(p => p.symbol);
  const priceMap = await fetchLivePrices(symbols);

  const results = await Promise.allSettled(
    positions
      .filter(p => priceMap[p.symbol] !== undefined)
      .map(p =>
        db.update(positionsTable)
          .set({ currentPrice: priceMap[p.symbol].price.toString(), updatedAt: new Date() })
          .where(eq(positionsTable.id, p.id))
      )
  );
  const updated = results.filter(r => r.status === "fulfilled").length;

  return { updated, priceMap };
}
