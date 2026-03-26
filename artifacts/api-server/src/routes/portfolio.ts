import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchLivePrices } from "./positions";

const router: IRouter = Router();

router.get("/summary", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable);
    const allPositions = await db.select().from(positionsTable);

    let totalNav = 0;
    let totalCost = 0;
    let totalDayChange = 0;

    const allSymbols = [...new Set(allPositions.map(p => p.symbol))];
    const priceMap = allSymbols.length > 0 ? await fetchLivePrices(allSymbols) : {};

    // Persist fresh prices to DB
    await Promise.allSettled(
      allPositions
        .filter(p => priceMap[p.symbol] !== undefined)
        .map(p =>
          db.update(positionsTable)
            .set({ currentPrice: priceMap[p.symbol].price.toString(), updatedAt: new Date() })
            .where(eq(positionsTable.id, p.id))
        )
    );

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
    res.status(500).json({ error: "Failed to fetch portfolio summary" });
  }
});

export default router;
