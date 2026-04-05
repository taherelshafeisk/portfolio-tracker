/**
 * lib/actions.ts
 *
 * Single source of truth for portfolio action computation.
 * computeActions() runs on every portfolio load — no AI call, no generate button.
 *
 * Rules:
 *   Concentration: position > concentrationLimit of sleeve NAV → amber
 *                  position > 2× concentrationLimit → red
 *   Leverage:      cash balance < 0 AND ratio > leverageCeiling → red; else amber
 *   Drawdown:      ≥1 position at or below DRAWDOWN_THRESHOLD_AMBER in a sleeve → amber (always amber)
 *
 * Deduplication: one Action per unique (type, accountId, symbol?) tuple.
 */

import type { Position, Account } from '@/context/PortfolioContext';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_CONCENTRATION_LIMIT = 0.20;
export const DEFAULT_LEVERAGE_CEILING = 1.50;
export const DRAWDOWN_THRESHOLD_AMBER = -0.10;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType = 'concentration' | 'drawdown' | 'leverage';

export interface Action {
  id: string;
  type: ActionType;
  severity: 'red' | 'amber';
  accountId: number;
  /** Set for position-level actions (concentration). */
  symbol?: string;
  positionId?: number;
  label: string;
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

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Pure function — derives a deduplicated, severity-ordered action list from portfolio state.
 * All thresholds read from the account record with null-safe fallback to global defaults.
 */
export function computeActions(
  accounts: Account[],
  positions: Position[],
  sleeveNavMap: Map<number, number>,
): Action[] {
  const actions: Action[] = [];

  // 1. Concentration per position
  for (const account of accounts) {
    const nav = sleeveNavMap.get(account.id) ?? 0;
    if (nav <= 0) continue;
    const limit = account.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
    const acctPositions = positions.filter(p => p.accountId === account.id);
    for (const p of acctPositions) {
      const fraction = p.marketValue / nav;
      if (fraction <= limit) continue;
      const severity: Action['severity'] = fraction > 2 * limit ? 'red' : 'amber';
      actions.push({
        id: `conc-${p.id}`,
        type: 'concentration',
        severity,
        accountId: account.id,
        symbol: p.symbol,
        positionId: p.id,
        label: `${p.symbol} is ${(fraction * 100).toFixed(1)}% of ${account.name} — limit is ${(limit * 100).toFixed(0)}%`,
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
    const severity: Action['severity'] = leverageRatio > ceiling ? 'red' : 'amber';
    actions.push({
      id: `lev-${account.id}`,
      type: 'leverage',
      severity,
      accountId: account.id,
      label: `${account.name} is using leverage — ${fmtCurrency(borrowed)} borrowed against a ${ceiling.toFixed(1)}x ceiling`,
      fingerprints: [`leverage:${account.id}`],
    });
  }

  // 3. Drawdown per account — aggregated into one action per sleeve, severity amber always
  for (const account of accounts) {
    const acctPositions = positions.filter(p => p.accountId === account.id);
    const drawdownPositions = acctPositions.filter(
      p => p.unrealizedPnlPct / 100 <= DRAWDOWN_THRESHOLD_AMBER,
    );
    if (drawdownPositions.length === 0) continue;

    const label =
      drawdownPositions.length === 1
        ? `${drawdownPositions[0].symbol} is down ${Math.abs(drawdownPositions[0].unrealizedPnlPct).toFixed(1)}% in ${account.name} — consider reviewing`
        : `${drawdownPositions.length} positions are in drawdown in ${account.name}`;

    actions.push({
      id: `drawdown-${account.id}`,
      type: 'drawdown',
      severity: 'amber',
      accountId: account.id,
      label,
      fingerprints: drawdownPositions.map(p => `drawdown:${account.id}:${p.id}`),
    });
  }

  // Sort: red first, then amber
  return actions.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'red' ? -1 : 1;
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
