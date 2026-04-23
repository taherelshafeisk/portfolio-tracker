import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, alertsTable, positionFlagsTable } from "@workspace/db";
import { and, eq, gte, lt, isNull, isNotNull, or } from "drizzle-orm";
import { getCachedPrices } from "./positions";

const router: IRouter = Router();

router.get("/summary", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable);
    const allPositions = await db.select().from(positionsTable);

    let totalNav = 0;
    let totalCost = 0;
    let totalDayChange = 0;

    const allSymbols = [...new Set(allPositions.map(p => p.symbol))];
    // Read-only: use in-memory cache populated by /accounts/:id/positions or POST /positions/refresh-prices.
    // No live HTTP calls and no DB writes on the summary path.
    const priceMap = getCachedPrices(allSymbols);

    const accountSummaries = await Promise.all(accounts.map(async (account) => {
      const positions = allPositions.filter(p => p.accountId === account.id);
      let accountNav = parseFloat(account.currentBalance);
      let accountCost = 0;
      let accountUnrealizedPnl = 0;
      let accountDayChange = 0;

      const positionMovers: { symbol: string; dayChange: number; dayChangePct: number }[] = [];

      positions.forEach(p => {
        const qty = parseFloat(p.quantity);
        const avg = parseFloat(p.avgCost);
        const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
        const prev = priceMap[p.symbol]?.previousClose ?? cur;
        const marketValue = qty * cur;
        const cost = qty * avg;
        accountNav += marketValue;
        accountCost += cost;
        accountUnrealizedPnl += marketValue - cost;
        const pct = priceMap[p.symbol]?.changePercent ?? (prev > 0 ? ((cur - prev) / prev) * 100 : 0);
        // Derive dollar day change from the authoritative % so both are consistent
        const prevPrice = pct !== 0 ? cur / (1 + pct / 100) : cur;
        const posDayChange = qty * (cur - prevPrice);
        accountDayChange += posDayChange;
        const posDayChangePct = pct;
        positionMovers.push({ symbol: p.symbol, dayChange: posDayChange, dayChangePct: posDayChangePct });
      });

      totalNav += accountNav;
      totalCost += accountCost + parseFloat(account.currentBalance);
      totalDayChange += accountDayChange;

      const unrealizedPnlPct = accountCost > 0 ? (accountUnrealizedPnl / accountCost) * 100 : 0;
      const prevAccountNav = accountNav - accountDayChange;
      const accountDayChangePct = prevAccountNav > 0 ? (accountDayChange / prevAccountNav) * 100 : 0;

      const topMovers = positionMovers
        .filter(m => m.dayChange !== 0)
        .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
        .slice(0, 3);

      return {
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        nav: accountNav,
        unrealizedPnl: accountUnrealizedPnl,
        unrealizedPnlPct,
        dayChange: accountDayChange,
        dayChangePct: accountDayChangePct,
        positionCount: positions.length,
        topMovers,
      };
    }));

    const totalUnrealizedPnl = totalNav - totalCost;
    const totalUnrealizedPnlPct = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0;
    const prevTotalNav = totalNav - totalDayChange;
    const totalDayChangePct = prevTotalNav > 0 ? (totalDayChange / prevTotalNav) * 100 : 0;

    // Top 5 positions by total market value — aggregate same symbol across accounts
    const symbolMap = new Map<string, { name: string; currentPrice: number; marketValue: number; dayChangePct: number }>();
    for (const p of allPositions) {
      const qty = parseFloat(p.quantity);
      const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
      const prev = priceMap[p.symbol]?.previousClose ?? cur;
      const marketValue = qty * cur;
      const dayChangePct = priceMap[p.symbol]?.changePercent ?? (prev > 0 ? ((cur - prev) / prev) * 100 : 0);
      const existing = symbolMap.get(p.symbol);
      if (existing) {
        existing.marketValue += marketValue;
      } else {
        symbolMap.set(p.symbol, { name: p.name, currentPrice: cur, marketValue, dayChangePct });
      }
    }
    const topPositions = Array.from(symbolMap.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 5);

    // Aggregate all movers across accounts, merging same symbol across accounts
    const globalMoverMap = new Map<string, { dayChange: number; dayChangePct: number }>();
    accountSummaries.forEach(acc => {
      acc.topMovers.forEach(m => {
        const existing = globalMoverMap.get(m.symbol);
        if (existing) {
          existing.dayChange += m.dayChange;
        } else {
          globalMoverMap.set(m.symbol, { dayChange: m.dayChange, dayChangePct: m.dayChangePct });
        }
      });
    });
    const globalTopMovers = Array.from(globalMoverMap.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
      .slice(0, 3);

    res.json({
      totalNav,
      totalCost,
      totalUnrealizedPnl,
      totalUnrealizedPnlPct,
      dayChange: totalDayChange,
      dayChangePct: totalDayChangePct,
      accountCount: accounts.length,
      positionCount: allPositions.length,
      topMovers: globalTopMovers,
      topPositions,
      accounts: accountSummaries,
    });
  } catch (error) {
    console.error("[portfolio/summary] Error:", error);
    res.status(500).json({ error: "Failed to fetch portfolio summary" });
  }
});

// GET /api/portfolio/pulse — per-position day contribution for the Pulse tab
router.get("/pulse", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable);
    const allPositions = await db.select().from(positionsTable);
    const allSymbols = [...new Set(allPositions.map(p => p.symbol))];
    const priceMap = getCachedPrices(allSymbols);

    const contributions = allPositions.map(p => {
      const qty = parseFloat(p.quantity);
      const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
      const pct = priceMap[p.symbol]?.changePercent ?? 0;
      const prevPrice = pct !== 0 ? cur / (1 + pct / 100) : cur;
      const dayChangeDollars = qty * (cur - prevPrice);
      const dayChangePct = pct;
      const marketValue = qty * cur;
      const avg = parseFloat(p.avgCost);
      const unrealizedPnlPct = avg > 0 ? ((cur - avg) / avg) * 100 : 0;
      const account = accounts.find(a => a.id === p.accountId);

      return {
        id: p.id,
        ticker: p.symbol,
        name: p.name,
        accountId: p.accountId,
        accountName: account?.name ?? '',
        qty,
        avgCost: avg,
        currentPrice: cur,
        marketValue,
        dayChangeDollars,
        dayChangePct,
        unrealizedPnlPct,
      };
    });

    const totalDayChange = contributions.reduce((s, c) => s + c.dayChangeDollars, 0);
    const sorted = [...contributions].sort((a, b) => b.dayChangeDollars - a.dayChangeDollars);
    const leaders = sorted.filter(c => c.dayChangeDollars > 0);
    const laggards = sorted.filter(c => c.dayChangeDollars < 0).reverse();

    res.json({
      totalDayChange,
      contributions,
      leaders,
      laggards,
    });
  } catch (error) {
    console.error("[portfolio/pulse] Error:", error);
    res.status(500).json({ error: "Failed to fetch pulse data" });
  }
});

// GET /api/portfolio/daily-review — EOD review artifact
router.get("/daily-review", async (_req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [accounts, allPositions] = await Promise.all([
      db.select().from(accountsTable),
      db.select().from(positionsTable),
    ]);

    const accountMap = new Map(accounts.map(a => [a.id, a.name]));
    const positionMap = new Map(allPositions.map(p => [p.id, p.symbol]));

    // Portfolio NAV snapshot (from cache — same as summary)
    const allSymbols = [...new Set(allPositions.map(p => p.symbol))];
    const priceMap = getCachedPrices(allSymbols);

    let totalNav = 0;
    let totalDayChange = 0;
    accounts.forEach(account => {
      let accountNav = parseFloat(account.currentBalance);
      let accountDayChange = 0;
      allPositions.filter(p => p.accountId === account.id).forEach(p => {
        const qty = parseFloat(p.quantity);
        const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
        const pct = priceMap[p.symbol]?.changePercent ?? 0;
        const prevPrice = pct !== 0 ? cur / (1 + pct / 100) : cur;
        accountNav += qty * cur;
        accountDayChange += qty * (cur - prevPrice);
      });
      totalNav += accountNav;
      totalDayChange += accountDayChange;
    });
    const prevNav = totalNav - totalDayChange;
    const dayChangePct = prevNav > 0 ? (totalDayChange / prevNav) * 100 : 0;

    // New today: alerts first generated today (any status)
    const newTodayRaw = await db.select().from(alertsTable)
      .where(gte(alertsTable.generatedAt, startOfToday));

    // Acted on today: alerts acknowledged or resolved today
    const actedOnAlertsRaw = await db.select().from(alertsTable)
      .where(or(
        gte(alertsTable.acknowledgedAt, startOfToday),
        gte(alertsTable.resolvedAt, startOfToday),
      ));

    // Flags resolved today
    const actedOnFlagsRaw = await db.select().from(positionFlagsTable)
      .where(gte(positionFlagsTable.resolvedAt, startOfToday));

    // Still open: ALL currently active alerts (not filtered by date — regeneration resets generatedAt)
    const stillOpenRaw = await db.select().from(alertsTable)
      .where(eq(alertsTable.status, "active"));

    // Carry forward: open flags with a dueAt
    const carryForwardRaw = await db.select().from(positionFlagsTable)
      .where(and(
        isNull(positionFlagsTable.resolvedAt),
        isNotNull(positionFlagsTable.dueAt),
      ));

    const HARD_RULE_TYPES = new Set(["concentration", "leverage"]);

    function enrichAlert(a: typeof alertsTable.$inferSelect) {
      return {
        id: a.id,
        symbol: a.symbol,
        alertType: a.alertType,
        severity: a.severity,
        title: a.title,
        message: a.message,
        category: HARD_RULE_TYPES.has(a.alertType) ? "hard_rule" : "informational",
        accountName: accountMap.get(a.accountId) ?? `Account ${a.accountId}`,
        status: a.status,
        dismissReason: a.dismissReason,
        generatedAt: a.generatedAt,
        acknowledgedAt: a.acknowledgedAt,
        resolvedAt: a.resolvedAt,
      };
    }

    function enrichFlag(f: typeof positionFlagsTable.$inferSelect) {
      const symbol = f.positionId != null ? positionMap.get(f.positionId) ?? null : null;
      return {
        id: f.id,
        symbol,
        flagType: f.flagType,
        accountName: accountMap.get(f.accountId) ?? `Account ${f.accountId}`,
        dueAt: f.dueAt,
        resolvedAt: f.resolvedAt,
        resolutionType: f.resolutionType,
        resolutionNote: f.resolutionNote,
        appGeneratedReasonSnapshot: f.appGeneratedReasonSnapshot,
      };
    }

    const localDate = [
      startOfToday.getFullYear(),
      String(startOfToday.getMonth() + 1).padStart(2, '0'),
      String(startOfToday.getDate()).padStart(2, '0'),
    ].join('-');

    res.json({
      date: localDate,
      nav: {
        total: totalNav,
        dayChange: totalDayChange,
        dayChangePct,
      },
      newToday: newTodayRaw.map(enrichAlert),
      actedOn: {
        alerts: actedOnAlertsRaw.map(enrichAlert),
        flags: actedOnFlagsRaw.map(enrichFlag),
      },
      stillOpen: stillOpenRaw.map(enrichAlert),
      carryForward: carryForwardRaw.map(enrichFlag),
    });
  } catch (err) {
    console.error("[portfolio/daily-review]", err);
    res.status(500).json({ error: "Failed to fetch daily review" });
  }
});

export default router;
