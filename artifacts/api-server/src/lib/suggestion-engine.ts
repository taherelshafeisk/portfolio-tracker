/**
 * Pure suggestion engine — no DB, no HTTP. Derives order suggestions from
 * a snapshot of accounts and positions with live prices attached.
 */

export interface EnginePosition {
  id: number;
  accountId: number;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
}

export interface EngineAccount {
  id: number;
  name: string;
  currentBalance: number;
}

export interface SuggestionInput {
  symbol: string;
  side: "buy" | "sell";
  quantity?: number;
  quantityMin?: number;
  quantityMax?: number;
  orderType: "market" | "limit" | "stop" | "stop_limit" | "laddered_limit";
  limitPrice?: number;
  stopPrice?: number;
  priceLogic?: string;
  timeInForce: "day" | "gtc" | "ioc";
  urgency: "low" | "medium" | "high" | "critical";
  rationale: string;
  trigger: string;
  executionNotes?: string;
  accountId: number;
}

const CONCENTRATION_THRESHOLD_PCT = 0.20; // 20% of NAV
const DRAWDOWN_THRESHOLD_PCT = -0.15;     // -15% unrealised P&L

export function generateSuggestions(
  accounts: EngineAccount[],
  positions: EnginePosition[],
  targetAccountId?: number,
): SuggestionInput[] {
  const filteredAccounts = targetAccountId
    ? accounts.filter(a => a.id === targetAccountId)
    : accounts;

  const suggestions: SuggestionInput[] = [];

  for (const account of filteredAccounts) {
    const acctPositions = positions.filter(p => p.accountId === account.id);

    // NAV = sum of market values + cash balance
    const equityValue = acctPositions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );
    const nav = equityValue + Number(account.currentBalance);
    if (nav <= 0) continue;

    for (const pos of acctPositions) {
      const marketValue = pos.quantity * pos.currentPrice;
      const costBasis = pos.quantity * pos.avgCost;
      const unrealisedPct = costBasis > 0 ? (marketValue - costBasis) / costBasis : 0;
      const concentrationPct = marketValue / nav;

      // Concentration alert → laddered limit sell to trim to 15%
      if (concentrationPct >= CONCENTRATION_THRESHOLD_PCT) {
        const targetValue = nav * 0.15;
        const trimValue = marketValue - targetValue;
        const trimQty = trimValue / pos.currentPrice;
        const trimPct = (concentrationPct * 100).toFixed(1);

        suggestions.push({
          accountId: account.id,
          symbol: pos.symbol,
          side: "sell",
          quantityMin: parseFloat((trimQty * 0.8).toFixed(4)),
          quantityMax: parseFloat((trimQty * 1.2).toFixed(4)),
          quantity: parseFloat(trimQty.toFixed(4)),
          orderType: "laddered_limit",
          limitPrice: parseFloat((pos.currentPrice * 0.99).toFixed(4)),
          priceLogic: "Split into 3 tranches: market, -1%, -2%",
          timeInForce: "gtc",
          urgency: concentrationPct >= 0.30 ? "high" : "medium",
          rationale: `${pos.symbol} is ${trimPct}% of sleeve NAV — above 20% concentration limit. Trim to ~15%.`,
          trigger: "concentration_limit",
          executionNotes: "Use laddered limits to avoid market impact.",
        });
      }

      // Drawdown alert → stop-loss to cut position
      if (unrealisedPct <= DRAWDOWN_THRESHOLD_PCT) {
        const drawdownPct = (unrealisedPct * 100).toFixed(1);

        suggestions.push({
          accountId: account.id,
          symbol: pos.symbol,
          side: "sell",
          quantity: parseFloat(pos.quantity.toFixed(4)),
          orderType: "stop",
          stopPrice: parseFloat((pos.currentPrice * 0.98).toFixed(4)),
          timeInForce: "gtc",
          urgency: unrealisedPct <= -0.25 ? "critical" : "high",
          rationale: `${pos.symbol} is down ${drawdownPct}% unrealised — exceeds -15% drawdown threshold.`,
          trigger: "drawdown_threshold",
          executionNotes: "Stop order placed 2% below current price to allow minor recovery.",
        });
      }
    }
  }

  return suggestions;
}
