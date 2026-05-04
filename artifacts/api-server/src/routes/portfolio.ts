import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, alertsTable, positionFlagsTable } from "@workspace/db";
import { and, eq, gte, isNull, isNotNull, or } from "drizzle-orm";
import { getCachedPrices } from "../lib/priceService";
import { logger } from "../lib/logger";
import { getPortfolioSummary } from "../services/portfolioService";

const router: IRouter = Router();

router.get("/summary", async (req, res) => {
  try {
    const summary = await getPortfolioSummary(req.userId);
    res.json(summary);
  } catch (error) {
    logger.error(error, "[portfolio/summary] Error");
    res.status(500).json({ error: "Failed to fetch portfolio summary" });
  }
});

// GET /api/portfolio/pulse — per-position day contribution for the Pulse tab
router.get("/pulse", async (req, res) => {
  try {
    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.userId, req.userId));
    const allPositions = await db.select().from(positionsTable).where(eq(positionsTable.userId, req.userId));
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
        positionBucket: p.positionBucket ?? null,
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
    logger.error(error, "[portfolio/pulse] Error");
    res.status(500).json({ error: "Failed to fetch pulse data" });
  }
});

// GET /api/portfolio/daily-review — EOD review artifact
router.get("/daily-review", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [accounts, allPositions] = await Promise.all([
      db.select().from(accountsTable).where(eq(accountsTable.userId, req.userId)),
      db.select().from(positionsTable).where(eq(positionsTable.userId, req.userId)),
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
      .where(and(gte(alertsTable.generatedAt, startOfToday), eq(alertsTable.userId, req.userId)));

    const actedOnAlertsRaw = await db.select().from(alertsTable)
      .where(and(
        eq(alertsTable.userId, req.userId),
        or(gte(alertsTable.acknowledgedAt, startOfToday), gte(alertsTable.resolvedAt, startOfToday)),
      ));

    const actedOnFlagsRaw = await db.select().from(positionFlagsTable)
      .where(and(gte(positionFlagsTable.resolvedAt, startOfToday), eq(positionFlagsTable.userId, req.userId)));

    const stillOpenRaw = await db.select().from(alertsTable)
      .where(and(eq(alertsTable.status, "active"), eq(alertsTable.userId, req.userId)));

    const carryForwardRaw = await db.select().from(positionFlagsTable)
      .where(and(
        isNull(positionFlagsTable.resolvedAt),
        isNotNull(positionFlagsTable.dueAt),
        eq(positionFlagsTable.userId, req.userId),
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
    logger.error(err, "[portfolio/daily-review]");
    res.status(500).json({ error: "Failed to fetch daily review" });
  }
});

export default router;
