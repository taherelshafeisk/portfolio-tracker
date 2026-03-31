# Recommendation Engine v1

## Purpose
The app should not stop at detecting issues. It should convert portfolio and market context into ranked, concrete next steps.

The Recommendation Engine sits between policy/portfolio analysis and user action. Its job is to answer:
- what deserves attention now
- why it matters
- what the user should do next

This is the layer that turns the app from a risk dashboard into a decision-support tool.

---

## What exists today

**Policy evaluators** (`lib/portfolioPolicy.ts`, `lib/defaultPolicy.ts`) — pure client-side functions that evaluate concentration, drawdown, and leverage against the active strategy profile. These are the foundation.

**Home screen derivation** (`app/(tabs)/index.tsx`) — `computeActionItems` derives Action Needed items from live policy alerts. This is a partial recommendation layer: it groups alerts by type and routes taps to the relevant account or position screen. It is client-side only and does not persist.

**Suggestion engine** (`artifacts/api-server/src/lib/suggestion-engine.ts`) — generates structured order suggestions from accounts and positions. Persisted to the `order_suggestions` DB table. Currently uses hardcoded thresholds separate from the policy model (see contradiction note below).

**Suggested Orders UI** — home screen and account/position detail screens display pending order suggestions. Users can dismiss or mark as executed.

What does not exist yet: a unified Recommendation Engine that combines policy results, market signals, and position context into a ranked, typed list of recommendations.

---

## Policy Engine vs Recommendation Engine

### Policy Engine (exists)
Evaluates the portfolio against the active strategy profile.
- Is a position above the concentration threshold?
- Is drawdown at warning or critical level?
- Is leverage active?

Answers: is there a breach, and how severe?

### Recommendation Engine (planned)
Uses policy results plus portfolio and market context to decide:
- what should be surfaced first
- what type of action is suggested
- whether the item is actionable now, review-only, or monitor-only

Answers: what should the user look at first, and what kind of action is appropriate?

---

## Inputs

### Portfolio
- positions: market value, quantity, cost basis, unrealized P&L %, daily P&L %, daily P&L $
- accounts: cash balance, leverage state
- position bucket when available (long_term / speculative / crypto)

### Policy
From the active strategy profile (`StrategyProfile`):
- concentration severity per position
- drawdown severity per position
- leverage severity per account
- any overrides in effect

### Market / actionability (v1 scope)
- daily % move magnitude
- daily $ move magnitude
- position size / importance (weight in account)

Later phases may add: unusual volume, technical setup, news/sentiment, sector/market regime. Not required in v1.

---

## Recommendation types in v1

### reduce_leverage
When an account has negative cash. Account-level. Actionable now.

### trim_concentration
When a position exceeds concentration thresholds. Position-level. Actionable now. Suitable for order generation.

### review_drawdown
When a position breaches drawdown thresholds. Position-level. Usually review-only.

> **Note on drawdown and sell orders:** The current `suggestion-engine.ts` generates a stop-sell order for any position with ≥ −15% unrealized loss. This contradicts the intended design where drawdown alone should not auto-generate sells. This needs to be resolved — either the engine should suppress drawdown-triggered sells by default, or the doc should acknowledge that drawdown can trigger stop suggestions at critical severity only.

### monitor_big_mover
When a position has a significant daily move (by % or dollar impact). Drives Intraday ranking on the account screen.

---

## Actionability model

**Actionable now** — user likely needs to make or review a decision soon.
Examples: leverage active, oversized concentrated position, large daily move in an important position.

**Review** — attention needed, but not necessarily immediate trade action.
Examples: critical drawdown requiring thesis review, concentrated long-term holding needing a plan.

**Monitor** — worth surfacing but may not require action now.
Examples: notable daily move in a small position, warning-level policy issue without urgency.

---

## Ranking / priority

v1 should use a simple, deterministic priority score based on:
- policy severity (critical > warning)
- daily $ move magnitude
- daily % move magnitude
- position market value / account weight
- leverage context

The score drives Actionable Now ranking, Intraday sort order, and which items surface first on the home screen.

---

## Where recommendations surface

| Surface | Today | Planned |
|---|---|---|
| Home screen Action Needed | Derived client-side from policy alerts | Driven by Recommendation Engine |
| Home screen Suggested Orders | Backend-persisted, shown as preview | Same |
| Account screen Actionable Now | Not yet built | Ranked recommendation block |
| Position/account detail | Not yet built | Rationale + related policy breaches |

---

## What v1 should not do

- Automatic trade execution
- AI-generated discretionary investment advice
- Auto-sell decisions based on drawdown alone (see note above)
- Full news/web sentiment integration
- Technical/fundamental analysis engine
- Backend-dependent recommendation workflows (keep v1 client-side or lightweight backend)
- Recommendation history persistence (add later)

---

## Relationship to Suggested Orders

The Recommendation Engine decides what to surface and what action type is appropriate. Suggested Orders convert selected recommendations into candidate orders.

- `reduce_leverage` → may produce sell suggestions
- `trim_concentration` → produces trim/sell suggestions (already implemented in suggestion engine)
- `review_drawdown` → should not auto-produce sells in v1 (currently does — see note above)

---

## Design principles

- Explainable: the user can see why something was surfaced
- Deterministic: same inputs always produce the same outputs
- Safe: does not push aggressive sell decisions without clear policy reason
- Easy to extend: adding a new recommendation type should not require redesigning the model
