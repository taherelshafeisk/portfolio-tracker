import { db } from "@workspace/db";
import { accountsTable, positionsTable, portfolioSnapshotsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { fetchLivePrices } from "../routes/positions";

const YAHOO_BASE = "https://query1.finance.yahoo.com";

async function fetchAedUsdRate(): Promise<number> {
  try {
    const res = await fetch(`${YAHOO_BASE}/v8/finance/chart/AEDUSD=X?interval=1d&range=5d`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!res.ok) return 3.6725; // AED is pegged to USD at ~3.6725
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

export async function captureSnapshot(): Promise<SnapshotResult> {
  const snapshotAt = new Date();
  // Format YYYY-MM-DD in UTC so the date is consistent regardless of server TZ
  const snapshotDate = snapshotAt.toISOString().slice(0, 10);

  const [accounts, allPositions, aedUsdRate] = await Promise.all([
    db.select().from(accountsTable),
    db.select().from(positionsTable),
    fetchAedUsdRate(),
  ]);

  const symbols = [...new Set(allPositions.map(p => p.symbol))];
  const priceMap = symbols.length > 0 ? await fetchLivePrices(symbols) : {};

  // Fetch previous snapshot date for each account so we can compute day delta
  // Query: most recent snapshot before today per account
  async function getPrevSnapshot(accountId: number | null) {
    if (accountId === null) {
      const rows = await db
        .select()
        .from(portfolioSnapshotsTable)
        .where(and(isNull(portfolioSnapshotsTable.accountId)));
      // find the row with max snapshotDate < today
      return rows
        .filter(r => r.snapshotDate < snapshotDate)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;
    } else {
      const rows = await db
        .select()
        .from(portfolioSnapshotsTable)
        .where(eq(portfolioSnapshotsTable.accountId, accountId));
      return rows
        .filter(r => r.snapshotDate < snapshotDate)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;
    }
  }

  type RowData = {
    accountId: number | null;
    navUsd: number;
    cashUsd: number;
    investedUsd: number;
    positionCount: number;
  };

  // Compute per-account rows
  const accountRows: RowData[] = accounts.map(account => {
    const positions = allPositions.filter(p => p.accountId === account.id);
    const activePositions = positions.filter(p => parseFloat(p.quantity) > 0);
    const cashUsd = parseFloat(account.currentBalance);
    let investedUsd = 0;
    let marketValueUsd = 0;
    for (const p of activePositions) {
      const qty = parseFloat(p.quantity);
      const avg = parseFloat(p.avgCost);
      const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
      investedUsd += qty * avg;
      marketValueUsd += qty * cur;
    }
    return {
      accountId: account.id,
      navUsd: cashUsd + marketValueUsd,
      cashUsd,
      investedUsd,
      positionCount: activePositions.length,
    };
  });

  // Rollup row
  const rollup: RowData = {
    accountId: null,
    navUsd: accountRows.reduce((s, r) => s + r.navUsd, 0),
    cashUsd: accountRows.reduce((s, r) => s + r.cashUsd, 0),
    investedUsd: accountRows.reduce((s, r) => s + r.investedUsd, 0),
    positionCount: accountRows.reduce((s, r) => s + r.positionCount, 0),
  };

  const allRows = [...accountRows, rollup];

  // Fetch previous snapshots and upsert
  let rowsInserted = 0;
  for (const row of allRows) {
    const prev = await getPrevSnapshot(row.accountId);
    const prevNav = prev ? parseFloat(prev.navUsd) : null;
    const dayChangeUsd = prevNav !== null ? row.navUsd - prevNav : 0;
    const dayChangePct = prevNav !== null && prevNav > 0 ? (dayChangeUsd / prevNav) * 100 : 0;

    const values = {
      snapshotDate,
      snapshotAt,
      accountId: row.accountId,
      navUsd: row.navUsd.toFixed(4),
      cashUsd: row.cashUsd.toFixed(4),
      investedUsd: row.investedUsd.toFixed(4),
      dayChangeUsd: dayChangeUsd.toFixed(4),
      dayChangePct: dayChangePct.toFixed(6),
      aedUsdRate: aedUsdRate.toFixed(6),
      positionCount: row.positionCount,
    };

    // Upsert: delete existing row for this date+account then insert fresh
    if (row.accountId === null) {
      await db
        .delete(portfolioSnapshotsTable)
        .where(and(
          eq(portfolioSnapshotsTable.snapshotDate, snapshotDate),
          isNull(portfolioSnapshotsTable.accountId),
        ));
    } else {
      await db
        .delete(portfolioSnapshotsTable)
        .where(and(
          eq(portfolioSnapshotsTable.snapshotDate, snapshotDate),
          eq(portfolioSnapshotsTable.accountId, row.accountId),
        ));
    }
    await db.insert(portfolioSnapshotsTable).values(values);
    rowsInserted++;
  }

  return { date: snapshotDate, rowsInserted, accounts: accounts.length };
}
