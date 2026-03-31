/**
 * lib/portfolioPolicy.validate.ts
 *
 * Dev-only safety net for the policy evaluators in portfolioPolicy.ts.
 *
 * No test framework required. Run with:
 *   npx tsx lib/portfolioPolicy.validate.ts
 * (from the portfolio-tracker directory, using a tsx binary on PATH)
 *
 * Or via the api-server's tsx:
 *   ../api-server/node_modules/.bin/tsx lib/portfolioPolicy.validate.ts
 *
 * Covers the evaluation boundary cases that are easiest to get wrong
 * (off-by-one on >=  vs  >, rounding, sign conventions, overrides).
 */

import {
  evaluateConcentration,
  evaluateDrawdown,
  evaluateLeverage,
  type ConcentrationRule,
  type DrawdownRule,
  type LeverageRule,
  type PolicyOverride,
} from '@workspace/portfolio-policy';

// ─── Tiny inline assertion helper ────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(
  label: string,
  actual: string | null,
  expected: string | null,
): void {
  if (actual === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected: ${expected}`);
    console.error(`       received: ${actual}`);
    failed++;
  }
}

// ─── Shared rule fixtures ─────────────────────────────────────────────────────

const concRule: ConcentrationRule = {
  type: 'concentration',
  scope: 'position',
  warningPct:  0.20,
  criticalPct: 0.30,
};

const ddRule: DrawdownRule = {
  type: 'drawdown',
  scope: 'position',
  warningPct:  -0.15,
  criticalPct: -0.25,
};

const levRule: LeverageRule = {
  type: 'leverage',
  scope: 'account',
  negativeCashIsWarning:  true,
  negativeCashIsCritical: false,
};

// ─── Concentration ────────────────────────────────────────────────────────────

console.log('\nConcentration:');

// 1. Below warning — 19.9% should produce no breach
expect(
  'just below warning (0.199)',
  evaluateConcentration(0.199, concRule),
  null,
);

// 2. At warning boundary — 20.0% is exactly the threshold (inclusive >=)
expect(
  'at warning boundary (0.20)',
  evaluateConcentration(0.20, concRule),
  'warning',
);

// 3. Above warning but below critical — 29.9%
expect(
  'just below critical (0.299)',
  evaluateConcentration(0.299, concRule),
  'warning',
);

// 4. At critical boundary — 30.0% exactly
expect(
  'at critical boundary (0.30)',
  evaluateConcentration(0.30, concRule),
  'critical',
);

// ─── Drawdown ─────────────────────────────────────────────────────────────────

console.log('\nDrawdown:');

// 5. Above warning threshold (less negative) — -14.9% should produce no breach
expect(
  'just above warning threshold (−0.149)',
  evaluateDrawdown(-0.149, ddRule),
  null,
);

// 6. At warning threshold exactly — -15.0%
expect(
  'at warning threshold (−0.15)',
  evaluateDrawdown(-0.15, ddRule),
  'warning',
);

// 7. Below warning but above critical — -24.9%
expect(
  'just above critical threshold (−0.249)',
  evaluateDrawdown(-0.249, ddRule),
  'warning',
);

// 8. At critical threshold exactly — -25.0%
expect(
  'at critical threshold (−0.25)',
  evaluateDrawdown(-0.25, ddRule),
  'critical',
);

// ─── Leverage ─────────────────────────────────────────────────────────────────

console.log('\nLeverage:');

// 9. Non-negative balance — no breach
expect(
  'zero cash balance',
  evaluateLeverage(0, levRule),
  null,
);

expect(
  'positive cash balance',
  evaluateLeverage(10_000, levRule),
  null,
);

// 10. Negative balance — warning (default policy)
expect(
  'negative cash balance (leveraged)',
  evaluateLeverage(-1, levRule),
  'warning',
);

// ─── Override ─────────────────────────────────────────────────────────────────

console.log('\nOverrides:');

// 11. An override raises the concentration critical threshold for a specific ticker.
//     Without override: 0.35 → critical (above 0.30 critical).
//     With override: critical raised to 0.50, so 0.35 → warning only.

const coreHoldingOverride: PolicyOverride = {
  id: 'brk-b-override',
  match: { ticker: 'BRK-B' },
  overrides: {
    concentration: {
      warningPct:  0.30,
      criticalPct: 0.50,
      recommendedAction: 'monitor',
    },
  },
  rationale: 'Long-term core holding; higher concentration acceptable',
};

expect(
  'without override: 0.35 → critical',
  evaluateConcentration(0.35, concRule, undefined),
  'critical',
);

expect(
  'with override raising critical to 0.50: 0.35 → warning',
  evaluateConcentration(0.35, concRule, coreHoldingOverride),
  'warning',
);

expect(
  'with override: 0.50 → critical (new boundary)',
  evaluateConcentration(0.50, concRule, coreHoldingOverride),
  'critical',
);

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
