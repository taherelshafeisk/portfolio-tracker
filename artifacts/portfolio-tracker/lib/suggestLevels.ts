/**
 * Suggests stop and target price levels based on price action and position context.
 * Pure function — no side effects, no API calls.
 */
export function suggestLevels(
  currentPrice: number,
  avgCost: number,
  low52w: number | null | undefined,
): { stop: number; target: number; basis: string } {
  // Option A: 8% below current price
  const eightPctStop = currentPrice * 0.92;

  // Option B: 52W low if it's within 15% of current price (not too far down)
  let rawStop = eightPctStop;
  let basis = 'Based on 8% rule';

  if (low52w != null && low52w > 0 && low52w >= currentPrice * 0.85 && low52w < eightPctStop) {
    rawStop = low52w;
    basis = 'Based on 52W low';
  }

  // Floor stop at avg cost if position is green (protect breakeven)
  if (avgCost > 0 && avgCost < currentPrice && rawStop < avgCost) {
    rawStop = avgCost;
    basis = 'Locked to breakeven';
  }

  const stop = parseFloat(rawStop.toFixed(2));
  const target = parseFloat((currentPrice + 2 * (currentPrice - stop)).toFixed(2));

  return { stop, target, basis };
}
