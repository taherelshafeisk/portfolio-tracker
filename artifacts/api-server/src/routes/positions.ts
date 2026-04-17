import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { positionsTable, activitiesTable, accountsTable } from "@workspace/db";
import { eq, and, desc, asc, inArray, or } from "drizzle-orm";
import { validate } from "../middlewares/validate";
import { CreatePositionBody, UpdatePositionBody } from "@workspace/api-zod/schemas";

const router: IRouter = Router();

const YAHOO_BASE = "https://query1.finance.yahoo.com";

// Crypto base symbols that collide with stock tickers on Yahoo Finance.
// Must be fetched as {symbol}-USD to get crypto prices.
const CRYPTO_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "AVAX", "DOT", "MATIC",
  "LINK", "UNI", "ATOM", "LTC", "BCH", "XLM", "ALGO", "VET", "FIL",
  "TRX", "SHIB", "BNB", "NEAR", "FTM", "SAND", "MANA", "THETA", "HBAR",
  "ICP", "ETC", "FLOW", "CHZ", "APE", "CRO", "GRT", "ENJ", "BAT",
  "ZEC", "DASH", "NEO", "EOS", "PEPE", "WIF", "BONK", "ARB", "OP",
  "SUI", "APT", "INJ", "TIA", "SEI", "RUNE", "CRV", "AAVE", "COMP",
  "MKR", "SNX", "YFI", "SUSHI", "ZRX",
]);

// Explicit overrides for symbols that don't match Yahoo Finance tickers directly.
const SYMBOL_OVERRIDES: Record<string, string> = {
  "GOLD": "GC=F",
  "XAU": "GC=F",
  "SILVER": "SI=F",
  "XAG": "SI=F",
};

/** Map a user-facing symbol to the Yahoo Finance ticker (e.g. BTC → BTC-USD, GOLD → XAUUSD=X). */
function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (SYMBOL_OVERRIDES[upper]) return SYMBOL_OVERRIDES[upper];
  if (!upper.includes("-") && !upper.includes(".") && CRYPTO_SYMBOLS.has(upper)) {
    return `${upper}-USD`;
  }
  return symbol;
}

export interface LivePriceData {
  price: number;
  previousClose: number | null;
  changePercent: number | null; // Yahoo's pre-computed daily % change (handles open & closed market)
}

// In-memory price cache with 60-second TTL
const _priceCache = new Map<string, { data: LivePriceData; ts: number }>();
const CACHE_TTL_MS = 60_000;

async function fetchLivePrice(symbol: string): Promise<LivePriceData | null> {
  try {
    const yahooSymbol = toYahooSymbol(symbol);
    const res = await fetch(
      `${YAHOO_BASE}/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number") return null;

    // Use OHLCV close array for reliable day-change in both open & closed market
    const closes: (number | null)[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c): c is number => typeof c === "number" && c > 0);
    const marketState: string = meta?.marketState ?? "CLOSED";

    // Yahoo duplicates the last close when market is closed — strip trailing dupes
    let tail = validCloses.length;
    while (tail > 1 && validCloses[tail - 1] === validCloses[tail - 2]) tail--;
    const dedupedCloses = validCloses.slice(0, tail);

    let changePercent: number | null = null;
    let previousClose: number | null = null;

    if (marketState === "REGULAR" && dedupedCloses.length >= 1) {
      // Market open: live price vs last session's close
      previousClose = dedupedCloses[dedupedCloses.length - 1];
      changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;
    } else if (dedupedCloses.length >= 2) {
      // Market closed/pre/post: last session close vs session before it
      previousClose = dedupedCloses[dedupedCloses.length - 2];
      const lastClose = dedupedCloses[dedupedCloses.length - 1];
      changePercent = previousClose > 0 ? ((lastClose - previousClose) / previousClose) * 100 : null;
    }

    return { price, previousClose, changePercent };
  } catch {
    return null;
  }
}

async function fetchLivePrices(symbols: string[]): Promise<Record<string, LivePriceData>> {
  const now = Date.now();
  const result: Record<string, LivePriceData> = {};
  const toFetch: string[] = [];

  for (const sym of [...new Set(symbols)]) {
    const cached = _priceCache.get(sym);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result[sym] = cached.data;
    } else {
      toFetch.push(sym);
    }
  }

  if (toFetch.length > 0) {
    const results = await Promise.allSettled(
      toFetch.map(async (sym) => ({ sym, data: await fetchLivePrice(sym) }))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.data !== null) {
        _priceCache.set(r.value.sym, { data: r.value.data, ts: now });
        result[r.value.sym] = r.value.data;
      }
    }
  }

  return result;
}

function toPositionResponse(p: typeof positionsTable.$inferSelect, livePrice?: number, livePriceData?: LivePriceData | null) {
  const qty = parseFloat(p.quantity);
  const avg = parseFloat(p.avgCost);
  const cur = livePrice ?? parseFloat(p.currentPrice);
  const marketValue = qty * cur;
  const unrealizedPnl = marketValue - qty * avg;
  const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
  const prevPrice = livePriceData?.previousClose ?? cur;
  const dayChange = qty * (cur - prevPrice);
  const dayChangePct = livePriceData?.changePercent ?? 0;
  return {
    id: p.id,
    accountId: p.accountId,
    symbol: p.symbol,
    name: p.name,
    quantity: qty,
    avgCost: avg,
    currentPrice: cur,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct,
    dayChange,
    dayChangePct,
    assetType: p.assetType ?? undefined,
    sector: p.sector ?? undefined,
    notes: p.notes ?? undefined,
    positionBucket: p.positionBucket ?? null,
    ipsAction: p.ipsAction ?? null,
    stopPrice: p.stopPrice != null ? parseFloat(p.stopPrice) : null,
    targetPrice: p.targetPrice != null ? parseFloat(p.targetPrice) : null,
    addZoneLow: p.addZoneLow != null ? parseFloat(p.addZoneLow) : null,
    addZoneHigh: p.addZoneHigh != null ? parseFloat(p.addZoneHigh) : null,
    cutListAddedAt: p.cutListAddedAt ? p.cutListAddedAt.toISOString() : null,
    policyNote: p.policyNote ?? null,
    ipsVersion: p.ipsVersion ?? null,
    exitReason: p.exitReason ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── Helpers for position history aggregation ─────────────────────────────────

import { computePositionAggregation } from '../lib/positionAggregation';
import type { ActivityRow } from '../lib/positionAggregation';

// ─── GET /history — sleeve-level aggregation (literal, must precede /:id) ─────
router.get("/history", async (req, res) => {
  try {
    const accountIdFilter = req.query.accountId ? parseInt(req.query.accountId as string) : null;
    const statusFilter = (req.query.status as string) || 'all';
    const today = new Date();

    // Load accounts (for names)
    const accounts = accountIdFilter
      ? await db.select().from(accountsTable).where(eq(accountsTable.id, accountIdFilter))
      : await db.select().from(accountsTable);

    const accountIds = accounts.map(a => a.id);
    if (accountIds.length === 0) return res.json([]);

    // Load all positions for these accounts
    const positions = accountIds.length === 1
      ? await db.select().from(positionsTable).where(eq(positionsTable.accountId, accountIds[0]))
      : await db.select().from(positionsTable).where(inArray(positionsTable.accountId, accountIds));

    if (positions.length === 0) return res.json([]);

    // Load all relevant activities (buy/sell only for aggregation)
    const buyOrSell = or(eq(activitiesTable.activityType, 'buy'), eq(activitiesTable.activityType, 'sell'));
    const activities = accountIds.length === 1
      ? await db.select().from(activitiesTable)
          .where(and(eq(activitiesTable.accountId, accountIds[0]), buyOrSell))
          .orderBy(asc(activitiesTable.tradeDate))
      : await db.select().from(activitiesTable)
          .where(and(inArray(activitiesTable.accountId, accountIds), buyOrSell))
          .orderBy(asc(activitiesTable.tradeDate));

    // Group activities by accountId+symbol
    const actMap = new Map<string, ActivityRow[]>();
    for (const act of activities) {
      if (!act.symbol) continue;
      const key = `${act.accountId}:${act.symbol.toUpperCase()}`;
      if (!actMap.has(key)) actMap.set(key, []);
      actMap.get(key)!.push(act as ActivityRow);
    }

    // Aggregate per account
    const sleeves = accounts.map(account => {
      const acctPositions = positions.filter(p => p.accountId === account.id);
      const positionAggs = acctPositions.map(p => {
        const key = `${account.id}:${p.symbol.toUpperCase()}`;
        const acts = actMap.get(key) ?? [];
        return computePositionAggregation(p.id, p.symbol, account.id, acts as ActivityRow[], today, parseFloat(p.quantity), parseFloat(p.avgCost));
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

    res.json(sleeves);
  } catch (error) {
    console.error("[positions GET /history] Error:", error);
    res.status(500).json({ error: "Failed to fetch position history" });
  }
});

// ─── GET /history/:ticker — position-level detail (literal prefix, before /:id) ─
router.get("/history/:ticker", async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : null;
    if (!accountId) return res.status(400).json({ error: "accountId query param is required" });

    const today = new Date();

    // Find the position record
    const [position] = await db
      .select()
      .from(positionsTable)
      .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, ticker)));
    if (!position) return res.status(404).json({ error: "Position not found" });

    // Load account info
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));

    // Load all activities for this ticker+account
    const activities = await db
      .select()
      .from(activitiesTable)
      .where(and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.symbol, ticker)))
      .orderBy(asc(activitiesTable.tradeDate));

    const agg = computePositionAggregation(position.id, ticker, accountId, activities as ActivityRow[], today, parseFloat(position.quantity), parseFloat(position.avgCost));

    // Unrealized P&L: use cached live price if open
    let unrealizedPnl: number | null = null;
    let currentPrice: number | null = null;
    if (agg.status === 'open' && agg.totalShares > 0) {
      const cached = _priceCache.get(ticker);
      const livePrice = cached && (Date.now() - cached.ts < CACHE_TTL_MS) ? cached.data.price : null;
      currentPrice = livePrice ?? parseFloat(position.currentPrice);
      unrealizedPnl = (currentPrice - agg.avgCostBasis) * agg.totalShares;
    }

    res.json({
      positionId: position.id,
      ticker,
      accountId,
      accountName: account?.name ?? null,
      sleeve: account?.sleeveKey ?? account?.name ?? null,
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
    });
  } catch (error) {
    console.error("[positions GET /history/:ticker] Error:", error);
    res.status(500).json({ error: "Failed to fetch position detail" });
  }
});

router.post("/", validate(CreatePositionBody), async (req, res) => {
  try {
    const { accountId, symbol, name, quantity, avgCost, assetType, sector, notes,
            positionBucket, ipsAction, stopPrice, addZoneLow, addZoneHigh,
            cutListAddedAt, policyNote, ipsVersion } = req.body;
    const upperSymbol = symbol.toUpperCase();

    const livePriceData = await fetchLivePrice(upperSymbol);
    const livePrice = livePriceData?.price ?? null;
    const priceToStore = livePrice ?? parseFloat(avgCost);

    const values = {
      accountId,
      symbol: upperSymbol,
      name,
      quantity: quantity.toString(),
      avgCost: avgCost.toString(),
      currentPrice: priceToStore.toString(),
      assetType: assetType || null,
      sector: sector || null,
      notes: notes || null,
      positionBucket: positionBucket || null,
      ipsAction: ipsAction || null,
      stopPrice: stopPrice != null ? stopPrice.toString() : null,
      addZoneLow: addZoneLow != null ? addZoneLow.toString() : null,
      addZoneHigh: addZoneHigh != null ? addZoneHigh.toString() : null,
      cutListAddedAt: cutListAddedAt ? new Date(cutListAddedAt) : null,
      policyNote: policyNote || null,
      ipsVersion: ipsVersion || null,
    };

    // Check-then-update/insert so this works before the unique constraint is
    // applied via db push, and also safely after.
    const [existing] = await db
      .select({ id: positionsTable.id })
      .from(positionsTable)
      .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, upperSymbol)));

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

    res.status(201).json(toPositionResponse(position, livePrice ?? undefined, livePriceData));
  } catch (error) {
    console.error("Failed to create position:", error);
    res.status(500).json({ error: "Failed to create position" });
  }
});

router.put("/:id", validate(UpdatePositionBody), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { quantity, avgCost, currentPrice, assetType, notes,
            positionBucket, ipsAction, stopPrice, targetPrice, addZoneLow, addZoneHigh,
            cutListAddedAt, policyNote, ipsVersion, exitReason } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (quantity !== undefined) updates.quantity = quantity.toString();
    if (avgCost !== undefined) updates.avgCost = avgCost.toString();
    if (currentPrice !== undefined) updates.currentPrice = currentPrice.toString();
    if (assetType !== undefined) updates.assetType = assetType || null;
    if (notes !== undefined) updates.notes = notes;
    if (positionBucket !== undefined) updates.positionBucket = positionBucket || null;
    if (ipsAction !== undefined) updates.ipsAction = ipsAction || null;
    if (stopPrice !== undefined) updates.stopPrice = stopPrice != null ? stopPrice.toString() : null;
    if (targetPrice !== undefined) updates.targetPrice = targetPrice != null ? targetPrice.toString() : null;
    if (addZoneLow !== undefined) updates.addZoneLow = addZoneLow != null ? addZoneLow.toString() : null;
    if (addZoneHigh !== undefined) updates.addZoneHigh = addZoneHigh != null ? addZoneHigh.toString() : null;
    if (cutListAddedAt !== undefined) updates.cutListAddedAt = cutListAddedAt ? new Date(cutListAddedAt) : null;
    if (policyNote !== undefined) updates.policyNote = policyNote || null;
    if (ipsVersion !== undefined) updates.ipsVersion = ipsVersion || null;
    if (exitReason !== undefined) updates.exitReason = exitReason || null;
    const [position] = await db.update(positionsTable).set(updates).where(eq(positionsTable.id, id)).returning();
    if (!position) return res.status(404).json({ error: "Position not found" });
    res.json(toPositionResponse(position));
  } catch (error) {
    res.status(500).json({ error: "Failed to update position" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(positionsTable).where(eq(positionsTable.id, id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete position" });
  }
});

router.post("/refresh-prices", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: number };
    let positions;
    if (accountId) {
      positions = await db.select().from(positionsTable).where(eq(positionsTable.accountId, accountId));
    } else {
      positions = await db.select().from(positionsTable);
    }
    if (positions.length === 0) return res.json({ updated: 0 });

    const symbols = positions.map(p => p.symbol);
    const priceMap = await fetchLivePrices(symbols);

    const updates = await Promise.allSettled(
      positions
        .filter(p => priceMap[p.symbol] !== undefined)
        .map(p =>
          db.update(positionsTable)
            .set({ currentPrice: priceMap[p.symbol].price.toString(), updatedAt: new Date() })
            .where(eq(positionsTable.id, p.id))
        )
    );
    res.json({ updated: updates.filter(r => r.status === "fulfilled").length });
  } catch (error) {
    res.status(500).json({ error: "Failed to refresh prices" });
  }
});

/** Returns trade history (activities) for a position, newest first. */
router.get("/:id/history", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [position] = await db.select().from(positionsTable).where(eq(positionsTable.id, id));
    if (!position) return res.status(404).json({ error: "Position not found" });

    const activities = await db
      .select()
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.accountId, position.accountId),
          eq(activitiesTable.symbol, position.symbol),
        )
      )
      .orderBy(desc(activitiesTable.tradeDate));

    res.json(activities.map(a => ({
      id: a.id,
      accountId: a.accountId,
      symbol: a.symbol || undefined,
      activityType: a.activityType,
      quantity: a.quantity ? parseFloat(a.quantity) : undefined,
      price: a.price ? parseFloat(a.price) : undefined,
      totalAmount: a.totalAmount ? parseFloat(a.totalAmount) : undefined,
      notes: a.notes || undefined,
      tradeDate: a.tradeDate instanceof Date ? a.tradeDate.toISOString() : String(a.tradeDate),
    })));
  } catch (error) {
    console.error("[positions GET /:id/history] Error:", error);
    res.status(500).json({ error: "Failed to fetch position history" });
  }
});

/** Returns only prices already in the 60s in-memory cache. No HTTP calls, no side effects. */
export function getCachedPrices(symbols: string[]): Record<string, LivePriceData> {
  const now = Date.now();
  const result: Record<string, LivePriceData> = {};
  for (const sym of [...new Set(symbols)]) {
    const cached = _priceCache.get(sym);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result[sym] = cached.data;
    }
  }
  return result;
}

export { fetchLivePrices };
export default router;
