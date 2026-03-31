/**
 * lib/portfolio-policy/src/defaultPolicy.ts
 *
 * Canonical v1 strategy profile — the single source of truth for all risk/alert
 * thresholds used across the app (api-server and portfolio-tracker).
 *
 * Thresholds chosen (most conservative of previously duplicated values):
 *   Concentration warning:  20%  (0.20)
 *   Concentration critical: 30%  (0.30)
 *   Drawdown warning:      −15%  (−0.15)
 *   Drawdown critical:     −25%  (−0.25)
 *   Leverage:               negative cash balance = warning
 *
 * To switch strategy profiles in the future, create a new StrategyProfile object
 * and pass it to the compute functions. No compute logic needs to change.
 *
 * To add per-account or per-ticker exceptions, add entries to the `overrides` array.
 */

import type { StrategyProfile } from './portfolioPolicy';

export const defaultStrategyProfile: StrategyProfile = {
  metadata: {
    id: 'default-v1',
    name: 'Default',
    description: 'Conservative baseline policy. Derived from original app thresholds; inconsistencies resolved in favour of the more conservative value.',
    effectiveFrom: '2024-01-01',
    source: 'template',
  },

  concentrationRule: {
    type: 'concentration',
    scope: 'position',
    warningPct:  0.20,  // ≥ 20% of portfolio NAV
    criticalPct: 0.30,  // ≥ 30% of portfolio NAV
    recommendedAction: 'trim',
  },

  drawdownRule: {
    type: 'drawdown',
    scope: 'position',
    warningPct:  -0.15,  // ≤ −15% unrealized loss
    criticalPct: -0.25,  // ≤ −25% unrealized loss
    recommendedAction: 'review',
  },

  leverageRule: {
    type: 'leverage',
    scope: 'account',
    negativeCashIsWarning:  true,
    negativeCashIsCritical: false,
    recommendedAction: 'reduceLeverage',
  },

  allocationRules: [],
  overrides: [],
};
