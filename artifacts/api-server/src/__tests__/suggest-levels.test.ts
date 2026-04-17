import { describe, it, expect } from 'vitest';

// Inline copy of suggestLevels for pure-function testing in the api-server test runner.
// The canonical implementation lives in artifacts/portfolio-tracker/lib/suggestLevels.ts.
function suggestLevels(
  currentPrice: number,
  avgCost: number,
  low52w: number | null | undefined,
): { stop: number; target: number; basis: string } {
  const eightPctStop = currentPrice * 0.92;
  let rawStop = eightPctStop;
  let basis = 'Based on 8% rule';
  if (low52w != null && low52w > 0 && low52w >= currentPrice * 0.85 && low52w < eightPctStop) {
    rawStop = low52w;
    basis = 'Based on 52W low';
  }
  if (avgCost > 0 && avgCost < currentPrice && rawStop < avgCost) {
    rawStop = avgCost;
    basis = 'Locked to breakeven';
  }
  const stop = parseFloat(rawStop.toFixed(2));
  const target = parseFloat((currentPrice + 2 * (currentPrice - stop)).toFixed(2));
  return { stop, target, basis };
}

describe('suggestLevels', () => {
  it('losing position: uses 8% rule, target is 2:1 R/R from stop', () => {
    // avgCost > currentPrice → losing position, no floor needed
    const result = suggestLevels(100, 120, null);
    expect(result.stop).toBeCloseTo(92, 2);      // 100 * 0.92
    expect(result.target).toBeCloseTo(116, 2);   // 100 + 2*(100-92) = 116
    expect(result.basis).toBe('Based on 8% rule');
  });

  it('winning position above cost: stop floored at avg cost (breakeven lock)', () => {
    // currentPrice=100, avgCost=96, 8% stop=92 → 92 < 96 → floor at 96
    const result = suggestLevels(100, 96, null);
    expect(result.stop).toBeCloseTo(96, 2);
    expect(result.target).toBeCloseTo(108, 2);  // 100 + 2*(100-96) = 108
    expect(result.basis).toBe('Locked to breakeven');
  });

  it('position near 52W low: uses 52W low as stop when it is within 15% and below 8% stop', () => {
    // currentPrice=100, 8% stop=92, 52W low=88 (within 15%=85, and 88 < 92)
    const result = suggestLevels(100, 60, 88);
    expect(result.stop).toBeCloseTo(88, 2);
    expect(result.target).toBeCloseTo(124, 2);  // 100 + 2*(100-88) = 124
    expect(result.basis).toBe('Based on 52W low');
  });

  it('52W low outside 15% range: ignored, falls back to 8% rule', () => {
    // 52W low=80 < 85 (15% threshold) → ignored
    const result = suggestLevels(100, 60, 80);
    expect(result.stop).toBeCloseTo(92, 2);
    expect(result.basis).toBe('Based on 8% rule');
  });

  it('52W low higher than 8% stop: 8% stop used (already lower)', () => {
    // 52W low=95 > 92 → 8% stop is more conservative
    const result = suggestLevels(100, 60, 95);
    expect(result.stop).toBeCloseTo(92, 2);
    expect(result.basis).toBe('Based on 8% rule');
  });

  it('target is always 2x the stop distance above current price', () => {
    const result = suggestLevels(200, 150, null);
    const expectedStop = 200 * 0.92; // 184
    const expectedTarget = 200 + 2 * (200 - expectedStop); // 200 + 32 = 232
    expect(result.target).toBeCloseTo(expectedTarget, 2);
  });

  it('values are rounded to 2 decimal places', () => {
    const result = suggestLevels(33.33, 20, null);
    expect(result.stop.toString()).toMatch(/^\d+\.\d{1,2}$/);
    expect(result.target.toString()).toMatch(/^\d+\.\d{1,2}$/);
  });
});
