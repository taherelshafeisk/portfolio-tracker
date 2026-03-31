/**
 * lib/portfolio-policy/src/portfolioPolicy.ts
 *
 * v1 Portfolio Policy Model — single source of truth for all risk/alert thresholds.
 *
 * Design intent:
 *   - Shared between api-server and portfolio-tracker via @workspace/portfolio-policy.
 *   - No runtime dependencies — pure TypeScript types and functions.
 *   - All thresholds live here, not scattered across compute functions.
 *   - Structured for future IPS-upload / strategy switching:
 *       compute functions accept a StrategyProfile argument, so switching profiles
 *       is a one-line change at the call site.
 *   - Overrides allow per-account / per-ticker exceptions without redesigning the model.
 *
 * All percentage thresholds are expressed as decimals (0.20 = 20%).
 * Drawdown thresholds are negative (−0.15 = −15%).
 *
 * Future: if policy changes over time, historical evaluations may eventually need
 * policy versioning (e.g. "which thresholds were active at trade date?"). This would
 * plug in at the StrategyProfile level — add a `version` field and a policyHistory
 * store keyed by effectiveFrom date. Not implemented now.
 */

// ─── Core types ───────────────────────────────────────────────────────────────

export type PolicyScope = 'portfolio' | 'sleeve' | 'account' | 'position';

export type Severity = 'info' | 'warning' | 'critical';

/**
 * Canonical set of suggested actions that rules can recommend.
 * Maps to CTA labels and routing in computeActionItems.
 */
export type RecommendedAction =
  | 'monitor'
  | 'review'
  | 'trim'
  | 'rebalance'
  | 'raiseCash'
  | 'reduceLeverage';

// ─── Strategy metadata ────────────────────────────────────────────────────────

export type StrategyMetadata = {
  id: string;
  name: string;
  description?: string;
  /** ISO date string. When this profile became active. */
  effectiveFrom?: string;
  /** ISO date string. When this profile stops being active. */
  effectiveTo?: string;
  /** Origin of this profile. Enables future IPS-upload-derived profiles. */
  source?: 'manual' | 'template' | 'ips_upload';
};

// ─── Rule types ───────────────────────────────────────────────────────────────

/** Triggers when a position's market value exceeds a fraction of total NAV. */
export type ConcentrationRule = {
  type: 'concentration';
  scope: PolicyScope;
  /** Market value / total NAV ≥ this → warning. Decimal, e.g. 0.20. */
  warningPct: number;
  /** Market value / total NAV ≥ this → critical. Decimal, e.g. 0.30. */
  criticalPct: number;
  recommendedAction?: RecommendedAction;
};

/**
 * Triggers when a position's unrealized PnL falls below a threshold.
 * Both thresholds must be negative; criticalPct must be more negative than warningPct.
 */
export type DrawdownRule = {
  type: 'drawdown';
  scope: PolicyScope;
  /** Unrealized PnL fraction ≤ this → warning. Negative decimal, e.g. −0.15. */
  warningPct: number;
  /** Unrealized PnL fraction ≤ this → critical. Negative decimal, e.g. −0.25. */
  criticalPct: number;
  recommendedAction?: RecommendedAction;
};

/** Triggers when an account carries a negative cash balance (i.e. is leveraged). */
export type LeverageRule = {
  type: 'leverage';
  scope: PolicyScope;
  /** Negative cash balance triggers a warning. Default: true. */
  negativeCashIsWarning?: boolean;
  /** Negative cash balance triggers critical instead of warning. Default: false. */
  negativeCashIsCritical?: boolean;
  recommendedAction?: RecommendedAction;
};

/**
 * Allocation target / band rule for IPS-style sleeve or asset-class constraints.
 * Not yet wired to the home screen UI — include allocation entries in defaultPolicy
 * when allocation drift tracking is ready.
 *
 * key: identifies the allocation dimension (asset class, sleeve key, sector, ticker).
 */
export type AllocationRule = {
  type: 'allocation';
  scope: PolicyScope;
  key: string;
  /** Target allocation as a decimal fraction. */
  targetPct?: number;
  /** Floor — triggers rebalance if allocation falls below this. */
  minPct?: number;
  /** Ceiling — triggers rebalance if allocation exceeds this. */
  maxPct?: number;
  /** Distance from target before rebalancing is triggered. */
  rebalanceBandPct?: number;
  recommendedAction?: RecommendedAction;
};

// ─── Overrides ────────────────────────────────────────────────────────────────

/**
 * Per-account, per-sleeve, or per-ticker exception to the strategy defaults.
 * Only the provided fields are overridden; unspecified fields fall back to the
 * strategy-level rule.
 *
 * Limitation: matching is exact (no wildcard or range matching). Fine for v1.
 */
export type PolicyOverride = {
  id: string;
  match: {
    accountId?: number;
    sleeveKey?: string;
    ticker?: string;
  };
  overrides: Partial<{
    concentration: Omit<ConcentrationRule, 'type' | 'scope'>;
    drawdown: Omit<DrawdownRule, 'type' | 'scope'>;
    leverage: Omit<LeverageRule, 'type' | 'scope'>;
  }>;
  /** Human-readable reason for the exception (e.g. "Long-term core holding"). */
  rationale?: string;
};

// ─── Strategy profile ─────────────────────────────────────────────────────────

export type StrategyProfile = {
  metadata: StrategyMetadata;
  concentrationRule: ConcentrationRule;
  drawdownRule: DrawdownRule;
  leverageRule: LeverageRule;
  /**
   * Allocation target rules (IPS-style). Not yet consumed by the home screen.
   * Add entries here when allocation drift tracking is implemented.
   */
  allocationRules?: AllocationRule[];
  /** Per-account or per-ticker overrides to the strategy defaults. */
  overrides?: PolicyOverride[];
};

// ─── Override resolution ──────────────────────────────────────────────────────

export type MatchContext = {
  accountId?: number;
  ticker?: string;
  sleeveKey?: string;
};

/**
 * Returns the first PolicyOverride whose match fields are all satisfied by ctx,
 * or undefined if no override applies.
 */
export function resolveOverride(
  profile: StrategyProfile,
  ctx: MatchContext,
): PolicyOverride | undefined {
  if (!profile.overrides?.length) return undefined;
  return profile.overrides.find(o => {
    const m = o.match;
    if (m.accountId != null && m.accountId !== ctx.accountId) return false;
    if (m.ticker     != null && m.ticker     !== ctx.ticker)     return false;
    if (m.sleeveKey  != null && m.sleeveKey  !== ctx.sleeveKey)  return false;
    return true;
  });
}

// ─── Pure evaluators ──────────────────────────────────────────────────────────
//
// Each evaluator:
//   - receives the computed metric and the effective rule (with any override applied)
//   - returns the triggered Severity, or null if no breach
//   - is a pure function with no side effects

/**
 * Evaluates a position's concentration against the policy.
 *
 * @param concentrationFraction - marketValue / totalNav, range 0.0–1.0
 */
export function evaluateConcentration(
  concentrationFraction: number,
  rule: ConcentrationRule,
  override?: PolicyOverride,
): Severity | null {
  const eff = override?.overrides.concentration
    ? { ...rule, ...override.overrides.concentration }
    : rule;
  if (concentrationFraction >= eff.criticalPct) return 'critical';
  if (concentrationFraction >= eff.warningPct)  return 'warning';
  return null;
}

/**
 * Evaluates a position's drawdown against the policy.
 *
 * @param drawdownFraction - unrealizedPnlPct / 100, e.g. −0.18 for a −18% loss.
 *   Must be negative to trigger; positive values (gains) always return null.
 */
export function evaluateDrawdown(
  drawdownFraction: number,
  rule: DrawdownRule,
  override?: PolicyOverride,
): Severity | null {
  const eff = override?.overrides.drawdown
    ? { ...rule, ...override.overrides.drawdown }
    : rule;
  if (drawdownFraction <= eff.criticalPct) return 'critical';
  if (drawdownFraction <= eff.warningPct)  return 'warning';
  return null;
}

/**
 * Evaluates an account's leverage state against the policy.
 *
 * @param currentBalance - account cash balance; negative = leveraged.
 */
export function evaluateLeverage(
  currentBalance: number,
  rule: LeverageRule,
  override?: PolicyOverride,
): Severity | null {
  const eff = override?.overrides.leverage
    ? { ...rule, ...override.overrides.leverage }
    : rule;
  if (currentBalance < 0) {
    if (eff.negativeCashIsCritical)         return 'critical';
    if (eff.negativeCashIsWarning !== false) return 'warning';
  }
  return null;
}
