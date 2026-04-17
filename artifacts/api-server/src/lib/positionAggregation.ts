// Pure position aggregation logic — no DB dependencies.
// Extracted for testability.

export interface ActivityRow {
  id: number;
  activityType: string;
  quantity: string | null;
  price: string | null;
  totalAmount: string | null;
  tradeDate: Date;
  notes: string | null;
}

export interface PositionAggregation {
  positionId: number;
  ticker: string;
  accountId: number;
  status: 'open' | 'closed';
  totalShares: number;
  avgCostBasis: number;
  totalInvested: number;
  realizedPnl: number;
  firstEntryDate: string | null;
  lastActivityDate: string | null;
  holdDurationDays: number;
  transactions: Array<{
    id: number;
    activityType: string;
    quantity: number | null;
    price: number | null;
    totalAmount: number | null;
    tradeDate: string;
    notes: string | null;
  }>;
}

export function computePositionAggregation(
  posId: number,
  ticker: string,
  acctId: number,
  activities: ActivityRow[],
  today: Date,
  positionQty: number = 0,
  seededAvgCost: number = 0,
): PositionAggregation {
  const sorted = [...activities].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());

  let runningQty = 0;
  let runningAvgCost = 0;
  let totalInvested = 0;
  let realizedPnl = 0;
  let firstEntryDate: Date | null = null;
  let lastActivityDate: Date | null = null;

  // Bootstrap from position record when no BUY activities exist.
  const hasBuyActivities = sorted.some(
    a => a.activityType === 'buy' && (a.quantity ? parseFloat(a.quantity) : 0) > 0,
  );
  if (!hasBuyActivities && positionQty > 0.0001 && seededAvgCost > 0) {
    const totalSellQty = sorted
      .filter(a => a.activityType === 'sell')
      .reduce((s, a) => s + (a.quantity ? parseFloat(a.quantity) : 0), 0);
    runningQty = positionQty + totalSellQty;
    runningAvgCost = seededAvgCost;
    totalInvested = runningQty * seededAvgCost;
  }

  for (const act of sorted) {
    const qty = act.quantity ? parseFloat(act.quantity) : 0;
    const price = act.price ? parseFloat(act.price) : 0;
    const total = act.totalAmount ? Math.abs(parseFloat(act.totalAmount)) : 0;

    if (act.activityType === 'buy' && qty > 0) {
      const effectivePrice = price > 0 ? price : (qty > 0 ? total / qty : 0);
      runningAvgCost = (runningAvgCost * runningQty + effectivePrice * qty) / (runningQty + qty);
      runningQty += qty;
      totalInvested += effectivePrice * qty;
      if (!firstEntryDate) firstEntryDate = act.tradeDate;
    } else if (act.activityType === 'sell' && qty > 0) {
      const effectivePrice = price > 0 ? price : (qty > 0 ? total / qty : 0);
      realizedPnl += (effectivePrice - runningAvgCost) * qty;
      runningQty = Math.max(0, runningQty - qty);
    }

    if (act.activityType === 'buy' || act.activityType === 'sell') {
      lastActivityDate = act.tradeDate;
    }
  }

  const noActivityData = Math.abs(runningQty) < 0.0001 && positionQty > 0.0001;
  const effectiveQty = noActivityData ? positionQty : runningQty;
  const effectiveAvgCost = noActivityData ? seededAvgCost : runningAvgCost;
  const effectiveTotalInvested = noActivityData ? positionQty * seededAvgCost : totalInvested;
  const status: 'open' | 'closed' = Math.abs(effectiveQty) < 0.0001 ? 'closed' : 'open';

  const endDate = status === 'closed' ? (lastActivityDate ?? today) : today;
  const holdDurationDays = firstEntryDate
    ? Math.max(0, Math.floor((endDate.getTime() - firstEntryDate.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const transactions = [...activities]
    .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime())
    .map(a => ({
      id: a.id,
      activityType: a.activityType,
      quantity: a.quantity ? parseFloat(a.quantity) : null,
      price: a.price ? parseFloat(a.price) : null,
      totalAmount: a.totalAmount ? parseFloat(a.totalAmount) : null,
      tradeDate: a.tradeDate instanceof Date ? a.tradeDate.toISOString() : String(a.tradeDate),
      notes: a.notes ?? null,
    }));

  return {
    positionId: posId,
    ticker,
    accountId: acctId,
    status,
    totalShares: effectiveQty,
    avgCostBasis: effectiveAvgCost,
    totalInvested: effectiveTotalInvested,
    realizedPnl,
    firstEntryDate: firstEntryDate ? firstEntryDate.toISOString() : null,
    lastActivityDate: lastActivityDate ? lastActivityDate.toISOString() : null,
    holdDurationDays,
    transactions,
  };
}
