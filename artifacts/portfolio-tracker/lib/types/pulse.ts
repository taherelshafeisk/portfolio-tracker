/**
 * Canonical types for the /api/portfolio/pulse response.
 * Matches the shape returned by routes/portfolio.ts.
 */

export interface PulseContribution {
  id: number;
  ticker: string;
  name: string;
  accountId: number;
  accountName: string;
  positionBucket: string | null;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  dayChangeDollars: number;
  dayChangePct: number;
  unrealizedPnlPct: number;
}

export interface PulseData {
  totalDayChange: number;
  contributions: PulseContribution[];
  leaders: PulseContribution[];
  laggards: PulseContribution[];
}
