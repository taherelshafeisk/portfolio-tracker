/**
 * Pure alert engine — no DB, no HTTP. Derives risk alerts from a snapshot of
 * accounts and positions with live prices attached.
 *
 * Thresholds come from the shared policy model (@workspace/portfolio-policy).
 * Pass a custom StrategyProfile to override defaults.
 *
 * v1 alert types:
 *   - Concentration breach: position market value / account NAV ≥ warning/critical threshold
 *   - Drawdown breach:      unrealized PnL fraction ≤ warning/critical threshold (negative)
 *   - Leverage:             account cash balance < 0
 *
 * Fingerprint format:
 *   concentration: `concentration:{accountId}:{positionId}`
 *   drawdown:      `drawdown:{accountId}:{positionId}`
 *   leverage:      `leverage:{accountId}`
 *
 * Fingerprints are stable across runs — same condition always produces the same fingerprint.
 * The route handler uses them to upsert (not duplicate) alerts on repeated generate calls.
 */

import {
  evaluateConcentration,
  evaluateDrawdown,
  evaluateLeverage,
  defaultStrategyProfile,
  type StrategyProfile,
} from "@workspace/portfolio-policy";

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

export interface AlertInput {
  accountId: number;
  positionId?: number;
  symbol?: string;
  alertType: "concentration" | "drawdown" | "leverage";
  severity: "warning" | "critical";
  title: string;
  message: string;
  /** The actual metric value, e.g. 0.2340 for 23.4% concentration */
  metricValue: number;
  /** The policy threshold that was crossed, e.g. 0.2000 */
  thresholdValue: number;
  fingerprint: string;
}

export function generateAlerts(
  accounts: EngineAccount[],
  positions: EnginePosition[],
  policy: StrategyProfile = defaultStrategyProfile,
): AlertInput[] {
  const alerts: AlertInput[] = [];

  for (const account of accounts) {
    const acctPositions = positions.filter((p) => p.accountId === account.id);

    const equityValue = acctPositions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );
    const nav = equityValue + account.currentBalance;

    // ── Concentration and drawdown — per position ─────────────────────────────
    if (nav > 0) {
      for (const pos of acctPositions) {
        const marketValue = pos.quantity * pos.currentPrice;
        const concentrationFraction = marketValue / nav;

        const concentrationSeverity = evaluateConcentration(
          concentrationFraction,
          policy.concentrationRule,
        ) as "warning" | "critical" | null;
        if (concentrationSeverity) {
          const pct = (concentrationFraction * 100).toFixed(1);
          const threshold =
            concentrationSeverity === "critical"
              ? policy.concentrationRule.criticalPct
              : policy.concentrationRule.warningPct;
          alerts.push({
            accountId: account.id,
            positionId: pos.id,
            symbol: pos.symbol,
            alertType: "concentration",
            severity: concentrationSeverity,
            title: `${pos.symbol} over-concentrated`,
            message: `${pos.symbol} is ${pct}% of ${account.name} NAV — above the ${(threshold * 100).toFixed(0)}% ${concentrationSeverity} threshold.`,
            metricValue: concentrationFraction,
            thresholdValue: threshold,
            fingerprint: `concentration:${account.id}:${pos.id}`,
          });
        }

        // Drawdown: computed from avgCost and currentPrice (not stored in DB)
        const drawdownFraction =
          pos.avgCost > 0 ? (pos.currentPrice - pos.avgCost) / pos.avgCost : 0;

        const drawdownSeverity = evaluateDrawdown(
          drawdownFraction,
          policy.drawdownRule,
        ) as "warning" | "critical" | null;
        if (drawdownSeverity) {
          const pct = (drawdownFraction * 100).toFixed(1);
          const threshold =
            drawdownSeverity === "critical"
              ? policy.drawdownRule.criticalPct
              : policy.drawdownRule.warningPct;
          alerts.push({
            accountId: account.id,
            positionId: pos.id,
            symbol: pos.symbol,
            alertType: "drawdown",
            severity: drawdownSeverity,
            title: `${pos.symbol} drawdown`,
            message: `${pos.symbol} is down ${Math.abs(parseFloat(pct))}% — below the ${(Math.abs(threshold) * 100).toFixed(0)}% ${drawdownSeverity} threshold.`,
            metricValue: drawdownFraction,
            thresholdValue: threshold,
            fingerprint: `drawdown:${account.id}:${pos.id}`,
          });
        }
      }
    }

    // ── Leverage — per account ────────────────────────────────────────────────
    const leverageSeverity = evaluateLeverage(
      account.currentBalance,
      policy.leverageRule,
    ) as "warning" | "critical" | null;
    if (leverageSeverity) {
      const borrowed = Math.abs(account.currentBalance).toFixed(2);
      alerts.push({
        accountId: account.id,
        alertType: "leverage",
        severity: leverageSeverity,
        title: `Leverage active · ${account.name}`,
        message: `${account.name} has a negative cash balance of $${borrowed}.`,
        metricValue: account.currentBalance,
        thresholdValue: 0,
        fingerprint: `leverage:${account.id}`,
      });
    }
  }

  return alerts;
}
