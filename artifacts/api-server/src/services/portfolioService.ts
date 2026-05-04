import { db } from "@workspace/db";
import { accountsTable, positionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCachedPrices } from "../lib/priceService";

interface PositionMover {
  symbol: string;
  dayChange: number;
  dayChangePct: number;
}

interface AccountSummary {
  id: number;
  name: string;
  accountType: string;
  nav: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  positionCount: number;
  topMovers: PositionMover[];
}

export interface PortfolioSummary {
  totalNav: number;
  totalCost: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  accountCount: number;
  positionCount: number;
  topMovers: PositionMover[];
  topPositions: { symbol: string; name: string; currentPrice: number; marketValue: number; dayChangePct: number }[];
  accounts: AccountSummary[];
}

export async function getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.userId, userId));
  const allPositions = await db.select().from(positionsTable).where(eq(positionsTable.userId, userId));

  let totalNav = 0;
  let totalCost = 0;
  let totalDayChange = 0;

  const allSymbols = [...new Set(allPositions.map(p => p.symbol))];
  // Read-only: use in-memory cache populated by /accounts/:id/positions or POST /positions/refresh-prices.
  // No live HTTP calls and no DB writes on the summary path.
  const priceMap = getCachedPrices(allSymbols);

  const accountSummaries: AccountSummary[] = await Promise.all(accounts.map(async (account) => {
    const positions = allPositions.filter(p => p.accountId === account.id);
    let accountNav = parseFloat(account.currentBalance);
    let accountCost = 0;
    let accountUnrealizedPnl = 0;
    let accountDayChange = 0;

    const positionMovers: PositionMover[] = [];

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
      positionMovers.push({ symbol: p.symbol, dayChange: posDayChange, dayChangePct: pct });
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
  const topMovers = Array.from(globalMoverMap.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
    .slice(0, 3);

  return {
    totalNav,
    totalCost,
    totalUnrealizedPnl,
    totalUnrealizedPnlPct,
    dayChange: totalDayChange,
    dayChangePct: totalDayChangePct,
    accountCount: accounts.length,
    positionCount: allPositions.length,
    topMovers,
    topPositions,
    accounts: accountSummaries,
  };
}
