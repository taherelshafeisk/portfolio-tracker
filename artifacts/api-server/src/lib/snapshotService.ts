import { db } from "@workspace/db";
import { accountsTable, positionsTable, portfolioSnapshotsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { fetchLivePrices } from "./priceService";

const YAHOO_BASE = "https://query1.finance.yahoo.com";

async function fetchAedUsdRate(): Promise<number> {
  try {
    const res = await fetch(`${YAHOO_BASE}/v8/finance/chart/AEDUSD=X?interval=1d&range=5d`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!res.ok) return 3.6725;
    const json = await res.json() as any;
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && price > 0 ? price : 3.6725;
  } catch {
    return 3.6725;
  }
}

export interface SnapshotResult {
  date: string;
  rowsInserted: number;
  accounts: number;
}

export async function captureSnapshot(userId: string): Promise<SnapshotResult> {
  const snapshotAt = new Date();
  const snapshotDate = snapshotAt.toISOString().slice(0, 10);

  const [accounts, allPositions, aedUsdRate] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.userId, userId)),
    db.select().from(positionsTable).where(eq(positionsTable.userId, userId)),
    fetchAedUsdRate(),
  ]);

  const symbols = [...new Set(allPositions.map(p => p.symbol))];
  const priceMap = symbols.length > 0 ? await fetchLivePrices(symbols) : {};

  async function getPrevSnapshot(accountId: number | null) {
    if (accountId === null) {
      const rows = await db.select().from(portfolioSnapshotsTable)
        .where(and(isNull(portfolioSnapshotsTable.accountId), eq(portfolioSnapshotsTable.userId, userId)));
      return rows.filter(r => r.snapshotDate < snapshotDate)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;
    } else {
      const rows = await db.select().from(portfolioSnapshotsTable)
        .where(and(eq(portfolioSnapshotsTable.accountId, accountId), eq(portfolioSnapshotsTable.userId, userId)));
      return rows.filter(r => r.snapshotDate < snapshotDate)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;
    }
  }

  type RowData = { accountId: number | null; navUsd: number; cashUsd: number; investedUsd: number; positionCount: number };

  const accountRows: RowData[] = accounts.map(account => {
    const positions = allPositions.filter(p => p.accountId === account.id);
    const activePositions = positions.filter(p => parseFloat(p.quantity) > 0);
    const cashUsd = parseFloat(account.currentBalance);
    let investedUsd = 0; let marketValueUsd = 0;
    for (const p of activePositions) {
      const qty = parseFloat(p.quantity);
      const avg = parseFloat(p.avgCost);
      const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
      investedUsd += qty * avg;
      marketValueUsd += qty * cur;
    }
    return { accountId: account.id, navUsd: cashUsd + marketValueUsd, cashUsd, investedUsd, positionCount: activePositions.length };
  });

  const rollup: RowData = {
    accountId: null,
    navUsd: accountRows.reduce((s, r) => s + r.navUsd, 0),
    cashUsd: accountRows.reduce((s, r) => s + r.cashUsd, 0),
    investedUsd: accountRows.reduce((s, r) => s + r.investedUsd, 0),
    positionCount: accountRows.reduce((s, r) => s + r.positionCount, 0),
  };

  const allRows = [...accountRows, rollup];
  let rowsInserted = 0;

  for (const row of allRows) {
    const prev = await getPrevSnapshot(row.accountId);
    const prevNav = prev ? parseFloat(prev.navUsd) : null;
    const dayChangeUsd = prevNav !== null ? row.navUsd - prevNav : 0;
    const dayChangePct = prevNav !== null && prevNav > 0 ? (dayChangeUsd / prevNav) * 100 : 0;

    const values = {
      snapshotDate, snapshotAt, accountId: row.accountId,
      navUsd: row.navUsd.toFixed(4), cashUsd: row.cashUsd.toFixed(4),
      investedUsd: row.investedUsd.toFixed(4), dayChangeUsd: dayChangeUsd.toFixed(4),
      dayChangePct: dayChangePct.toFixed(6), aedUsdRate: aedUsdRate.toFixed(6),
      positionCount: row.positionCount, userId,
    };

    if (row.accountId === null) {
      await db.delete(portfolioSnapshotsTable)
        .where(and(eq(portfolioSnapshotsTable.snapshotDate, snapshotDate), isNull(portfolioSnapshotsTable.accountId), eq(portfolioSnapshotsTable.userId, userId)));
    } else {
      await db.delete(portfolioSnapshotsTable)
        .where(and(eq(portfolioSnapshotsTable.snapshotDate, snapshotDate), eq(portfolioSnapshotsTable.accountId, row.accountId), eq(portfolioSnapshotsTable.userId, userId)));
    }
    await db.insert(portfolioSnapshotsTable).values(values);
    rowsInserted++;
  }

  return { date: snapshotDate, rowsInserted, accounts: accounts.length };
}
