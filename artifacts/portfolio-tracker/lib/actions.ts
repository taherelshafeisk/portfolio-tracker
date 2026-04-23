/**
 * lib/actions.ts
 *
 * Single source of truth for portfolio action computation.
 * computeActions() runs on every portfolio load — no AI call, no generate button.
 *
 * Category hierarchy (determines sort order and visual treatment):
 *   hard_rule   — IPS rules actively breached (leverage above ceiling, concentration above cap)
 *   commitment  — overdue or due-today flags; user-created deadlines
 *   threshold   — approaching limits, informational crossings
 *   informational — drawdown notes, FYI observations
 *
 * Ranking within each category:
 *   priority_score = categoryWeight × breachDepth × (dollarScope / 1000)
 *
 * Concentration cause detection:
 *   winner_drift          — position appreciated >15% unrealised; it grew into overweight
 *   added_into_overweight — position near cost basis (<5% unrealised); user bought in
 *   unknown               — insufficient signal to determine
 */

import type { Position, Account } from '@/context/PortfolioContext';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_CONCENTRATION_LIMIT = 0.20;
export const DEFAULT_LEVERAGE_CEILING = 1.50;
export const DRAWDOWN_THRESHOLD_AMBER = -0.10;

const CATEGORY_WEIGHT: Record<ActionCategory, number> = {
  hard_rule: 100,
  commitment: 75,
  threshold: 50,
  informational: 10,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType = 'concentration' | 'drawdown' | 'leverage';

export type ActionCategory = 'hard_rule' | 'commitment' | 'threshold' | 'informational';

export type ConcentrationCause =
  | 'winner_drift'
  | 'added_into_overweight'
  | 'sleeve_shrank'
  | 'unknown';

export interface Action {
  id: string;
  type: ActionType;
  category: ActionCategory;
  severity: 'red' | 'amber';
  accountId: number;
  /** Set for position-level actions (concentration). */
  symbol?: string;
  positionId?: number;
  label: string;
  /** One-sentence explanation of *why* this issue exists. */
  explanation: string;
  /** For concentration actions: root cause of overweight status. */
  cause?: ConcentrationCause;
  /** Composite ranking score — higher = more urgent within category. */
  priorityScore: number;
  /** DB fingerprints used to match and dismiss alerts. */
  fingerprints: string[];
  /** Populated after reconcileActions() cross-references DB alerts. */
  dbIds?: number[];
}

interface ApiAlert {
  id: number;
  fingerprint: string;
  status: string;
  dismissReason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const withCommas = (n: number, dec = 2): string => {
    const [int, frac] = n.toFixed(dec).split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? '.' + frac : '');
  };
  if (abs >= 1_000_000) return `${sign}$${withCommas(abs / 1_000_000, 2)}M`;
  return `${sign}$${withCommas(abs, 2)}`;
}

function computePriorityScore(
  category: ActionCategory,
  breachDepth: number,
  dollarScope: number,
  sleeveNav: number,
  totalNav: number,
): number {
  const clamped = Math.min(Math.max(breachDepth, 0), 3);
  const sleeveWeight = totalNav > 0 ? sleeveNav / totalNav : 1;
  return CATEGORY_WEIGHT[category] * (1 + clamped) * (dollarScope / 1000) * sleeveWeight;
}

function detectConcentrationCause(unrealizedPnlPct: number): ConcentrationCause {
  if (unrealizedPnlPct > 15) return 'winner_drift';
  if (unrealizedPnlPct < -5) return 'sleeve_shrank';
  if (unrealizedPnlPct < 5) return 'added_into_overweight';
  return 'winner_drift';
}

function concentrationExplanation(
  cause: ConcentrationCause,
  symbol: string,
  unrealizedPnlPct: number,
): string {
  switch (cause) {
    case 'winner_drift':
      return `${symbol} became overweight because it outperformed the sleeve — not because you added.`;
    case 'added_into_overweight':
      return `${symbol} is overweight because you added while it was already near the limit.`;
    case 'sleeve_shrank':
      return `${symbol} is down ${Math.abs(unrealizedPnlPct).toFixed(1)}% from cost. Concentration rose because the sleeve shrank around it — not because this position grew.`;
    default:
      return `${symbol} has exceeded its concentration limit.`;
  }
}

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Pure function — derives a deduplicated, category-then-priority-ordered action list.
 * All thresholds read from the account record with null-safe fallback to global defaults.
 */
export function computeActions(
  accounts: Account[],
  positions: Position[],
  sleeveNavMap: Map<number, number>,
): Action[] {
  const actions: Action[] = [];
  const totalNav = Array.from(sleeveNavMap.values()).reduce((s, v) => s + v, 0);

  // 1. Concentration per position
  for (const account of accounts) {
    const nav = sleeveNavMap.get(account.id) ?? 0;
    if (nav <= 0) continue;
    const limit = account.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
    const acctPositions = positions.filter(p => p.accountId === account.id);

    for (const p of acctPositions) {
      const fraction = p.marketValue / nav;
      if (fraction <= limit) continue;

      const breachDepth = fraction / limit - 1;
      const severity: Action['severity'] = fraction > 2 * limit ? 'red' : 'amber';
      const category: ActionCategory = 'hard_rule';
      const cause = detectConcentrationCause(p.unrealizedPnlPct);

      actions.push({
        id: `conc-${p.id}`,
        type: 'concentration',
        category,
        severity,
        accountId: account.id,
        symbol: p.symbol,
        positionId: p.id,
        label: `${p.symbol} is ${(fraction * 100).toFixed(1)}% of ${account.name} — limit is ${(limit * 100).toFixed(0)}%`,
        explanation: concentrationExplanation(cause, p.symbol, p.unrealizedPnlPct),
        cause,
        priorityScore: computePriorityScore(category, breachDepth, p.marketValue, nav, totalNav),
        fingerprints: [`concentration:${account.id}:${p.id}`],
      });
    }
  }

  // 2. Leverage per account
  for (const account of accounts) {
    if (account.currentBalance >= 0) continue;
    const nav = sleeveNavMap.get(account.id) ?? 0;
    const ceiling = account.leverageCeiling ?? DEFAULT_LEVERAGE_CEILING;
    const borrowed = Math.abs(account.currentBalance);
    const leverageRatio = nav > 0 ? (nav + borrowed) / nav : 99;
    const aboveCeiling = leverageRatio > ceiling;
    const severity: Action['severity'] = aboveCeiling ? 'red' : 'amber';
    const category: ActionCategory = aboveCeiling ? 'hard_rule' : 'threshold';
    const breachDepth = aboveCeiling ? (leverageRatio / ceiling - 1) : 0;

    const explanation = aboveCeiling
      ? `${account.name} is ${leverageRatio.toFixed(2)}x leveraged — ${((leverageRatio - ceiling) * 100).toFixed(0)}% above the ${ceiling.toFixed(1)}x ceiling.`
      : `${account.name} is using ${fmtCurrency(borrowed)} of borrowed capital against a ${ceiling.toFixed(1)}x ceiling.`;

    actions.push({
      id: `lev-${account.id}`,
      type: 'leverage',
      category,
      severity,
      accountId: account.id,
      label: aboveCeiling
        ? `${account.name} leverage at ${leverageRatio.toFixed(2)}x — above ${ceiling.toFixed(1)}x ceiling`
        : `${account.name} is using leverage — ${fmtCurrency(borrowed)} borrowed`,
      explanation,
      priorityScore: computePriorityScore(category, breachDepth, borrowed, nav, totalNav),
      fingerprints: [`leverage:${account.id}`],
    });
  }

  // Sort: category first (hard_rule → commitment → threshold → informational),
  // then priorityScore descending within each category.
  const categoryOrder: Record<ActionCategory, number> = {
    hard_rule: 0,
    commitment: 1,
    threshold: 2,
    informational: 3,
  };

  return actions.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    return b.priorityScore - a.priorityScore;
  });
}

/**
 * Cross-reference computed actions with DB alerts: attach dbIds, filter out fully acknowledged.
 */
export function reconcileActions(
  computed: Action[],
  dbAlerts: ApiAlert[],
): Action[] {
  const byFingerprint = new Map(dbAlerts.map(a => [a.fingerprint, a]));
  return computed
    .map(action => {
      const matchedDbAlerts = action.fingerprints
        .map(fp => byFingerprint.get(fp))
        .filter((a): a is ApiAlert => a != null);
      return {
        ...action,
        dbIds: matchedDbAlerts.map(a => a.id),
      };
    })
    .filter(action => {
      if (action.dbIds && action.dbIds.length > 0) {
        const allAcknowledged = action.fingerprints.every(fp => {
          const a = byFingerprint.get(fp);
          return a && (a.status === 'acknowledged' || a.status === 'resolved');
        });
        if (allAcknowledged) return false;
      }
      return true;
    });
}
