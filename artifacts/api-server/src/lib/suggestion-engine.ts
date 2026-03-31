/**
 * Pure suggestion engine — no DB, no HTTP. Derives order suggestions from
 * a snapshot of accounts and positions with live prices attached.
 *
 * Thresholds come from the shared policy model (@workspace/portfolio-policy).
 * Pass a custom StrategyProfile to override defaults.
 *
 * v1 scope:
 *   - Concentration breach → laddered limit sell to trim below warning threshold
 *   - Drawdown breach → NO automatic sell suggestion (review-only; surfaced by
 *     client-side policy evaluators on the home screen Action Needed section)
 *   - Leverage (negative cash) → future phase
 */

import {
  evaluateConcentration,
  defaultStrategyProfile,
  type StrategyProfile,
} from '@workspace/portfolio-policy';

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

/**
 * Trim target: reduce to this fraction of NAV after a concentration breach.
 * Kept as a local constant because the policy model defines alert thresholds,
 * not trim targets. Set to 5 percentage points below the warning threshold.
 */
function trimTarget(policy: StrategyProfile): number {
  return Math.max(0, policy.concentrationRule.warningPct - 0.05);
}

export function generateSuggestions(
  accounts: EngineAccount[],
  positions: EnginePosition[],
  targetAccountId?: number,
  policy: StrategyProfile = defaultStrategyProfile,
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
      const concentrationFraction = marketValue / nav;

      // Concentration breach → laddered limit sell to trim to below warning threshold
      const concentrationSeverity = evaluateConcentration(
        concentrationFraction,
        policy.concentrationRule,
      );

      if (concentrationSeverity) {
        const target = trimTarget(policy);
        const targetValue = nav * target;
        const trimValue = marketValue - targetValue;
        const trimQty = trimValue / pos.currentPrice;
        const trimPct = (concentrationFraction * 100).toFixed(1);

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
          urgency: concentrationSeverity === 'critical' ? "high" : "medium",
          rationale: `${pos.symbol} is ${trimPct}% of account NAV — above ${(policy.concentrationRule.warningPct * 100).toFixed(0)}% concentration limit. Trim to ~${(target * 100).toFixed(0)}%.`,
          trigger: "concentration_limit",
          executionNotes: "Use laddered limits to avoid market impact.",
        });
      }

      // Drawdown: no automatic sell suggestion in v1.
      // Drawdown breaches are surfaced as review items by the client-side policy
      // evaluators (Action Needed on the home screen). Automatically generating
      // stop-sell orders from drawdown alone is out of scope for v1.
    }
  }

  return suggestions;
}
