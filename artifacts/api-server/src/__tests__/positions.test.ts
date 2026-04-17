import { describe, it, expect } from 'vitest';
import { computePositionAggregation } from '../lib/positionAggregation';

// Minimal ActivityRow shape needed for the pure computation
function makeActivity(overrides: {
  id?: number;
  activityType: string;
  quantity: string | null;
  price: string | null;
  totalAmount?: string | null;
  tradeDate?: Date;
}) {
  return {
    id: overrides.id ?? 1,
    activityType: overrides.activityType,
    quantity: overrides.quantity,
    price: overrides.price,
    totalAmount: overrides.totalAmount ?? null,
    tradeDate: overrides.tradeDate ?? new Date('2024-01-01'),
    notes: null,
  };
}

describe('computePositionAggregation — seeded position P&L bootstrap', () => {
  it('seeded position with 1 sell: realizedPnL = (sellPrice - seedAvgCost) * sellQty', () => {
    const seedQty = 100;
    const seedAvgCost = 50;
    const sellQty = 20;
    const sellPrice = 60;

    const activities = [
      makeActivity({ activityType: 'sell', quantity: String(sellQty), price: String(sellPrice) }),
    ];

    // After sell, position.quantity in DB = seedQty - sellQty = 80
    const currentQty = seedQty - sellQty;

    const result = computePositionAggregation(
      1, 'TEST', 1, activities, new Date(), currentQty, seedAvgCost,
    );

    const expectedRealizedPnl = (sellPrice - seedAvgCost) * sellQty; // 200
    expect(result.realizedPnl).toBeCloseTo(expectedRealizedPnl, 4);
  });

  it('seeded position with no sells: realizedPnL = 0', () => {
    const result = computePositionAggregation(
      1, 'TEST', 1, [], new Date(), 50, 100,
    );
    expect(result.realizedPnl).toBe(0);
  });

  it('seeded position with multiple sells: accumulated realized P&L uses seed avg cost', () => {
    const seedQty = 200;
    const seedAvgCost = 40;

    const activities = [
      makeActivity({ id: 1, activityType: 'sell', quantity: '50', price: '55', tradeDate: new Date('2024-01-01') }),
      makeActivity({ id: 2, activityType: 'sell', quantity: '30', price: '45', tradeDate: new Date('2024-02-01') }),
    ];

    const currentQty = seedQty - 50 - 30; // 120
    const result = computePositionAggregation(
      1, 'TEST', 1, activities, new Date(), currentQty, seedAvgCost,
    );

    const expected = (55 - 40) * 50 + (45 - 40) * 30; // 750 + 150 = 900
    expect(result.realizedPnl).toBeCloseTo(expected, 4);
  });

  it('normal position with buy activities: NOT bootstrapped from position record', () => {
    const activities = [
      makeActivity({ id: 1, activityType: 'buy',  quantity: '100', price: '50', tradeDate: new Date('2024-01-01') }),
      makeActivity({ id: 2, activityType: 'sell', quantity: '20',  price: '60', tradeDate: new Date('2024-06-01') }),
    ];

    // seededAvgCost passed as wrong value to verify it's ignored when buys exist
    const result = computePositionAggregation(
      1, 'TEST', 1, activities, new Date(), 80, 999,
    );

    const expected = (60 - 50) * 20; // 200
    expect(result.realizedPnl).toBeCloseTo(expected, 4);
  });
});
