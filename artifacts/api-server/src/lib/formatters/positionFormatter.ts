import type { positionsTable } from "@workspace/db";
import type { LivePriceData } from "../priceService";

type PositionRow = typeof positionsTable.$inferSelect;

export interface FormatPositionOptions {
  /**
   * When defined, a `closed` boolean is included in the response at this value.
   * Only the accounts/:id/positions endpoint emits this field (to distinguish active vs.
   * closed positions returned in the same array). Positions endpoints omit it entirely.
   */
  closed?: boolean;
  /**
   * When false, omits notesUpdatedAt, targetPrice, and exitReason.
   * The accounts/:id/positions endpoint currently omits these three fields; all other
   * position endpoints include them. Defaults to true.
   */
  extended?: boolean;
}

/**
 * Maps a DB position row to the standard API response shape.
 *
 * Call without opts for the positions endpoints (full fields, no `closed` field).
 * Call with { closed, extended: false } for the accounts/:id/positions endpoint.
 */
export function formatPosition(
  p: PositionRow,
  livePriceData?: LivePriceData | null,
  opts?: FormatPositionOptions,
) {
  const qty = parseFloat(p.quantity);
  const avg = parseFloat(p.avgCost);
  const cur = livePriceData?.price ?? parseFloat(p.currentPrice);
  const marketValue = qty * cur;
  const unrealizedPnl = marketValue - qty * avg;
  const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
  const prevPrice = livePriceData?.previousClose ?? cur;
  const dayChange = qty * (cur - prevPrice);
  const dayChangePct = livePriceData?.changePercent ?? 0;
  const extended = opts?.extended !== false;

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
    // `closed` is only emitted when the caller explicitly sets opts.closed
    // (accounts/:id/positions endpoint). Positions endpoints omit this field.
    ...(opts?.closed !== undefined ? { closed: opts.closed } : {}),
    assetType: p.assetType ?? undefined,
    sector: p.sector ?? undefined,
    notes: p.notes ?? undefined,
    ...(extended ? { notesUpdatedAt: p.notesUpdatedAt ? p.notesUpdatedAt.toISOString() : null } : {}),
    positionBucket: p.positionBucket ?? null,
    ipsAction: p.ipsAction ?? null,
    stopPrice: p.stopPrice != null ? parseFloat(p.stopPrice) : null,
    ...(extended ? { targetPrice: p.targetPrice != null ? parseFloat(p.targetPrice) : null } : {}),
    addZoneLow: p.addZoneLow != null ? parseFloat(p.addZoneLow) : null,
    addZoneHigh: p.addZoneHigh != null ? parseFloat(p.addZoneHigh) : null,
    cutListAddedAt: p.cutListAddedAt ? p.cutListAddedAt.toISOString() : null,
    policyNote: p.policyNote ?? null,
    ipsVersion: p.ipsVersion ?? null,
    ...(extended ? { exitReason: p.exitReason ?? null } : {}),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
