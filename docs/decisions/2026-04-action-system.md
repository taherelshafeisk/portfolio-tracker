# Decision: Action System Redesign
Date: 2026-04-06
Session: Apr 5-6 2026

---

## Context

The app had four overlapping sections on the home screen (Action Needed, Risk, Alerts, Suggested Orders) and three overlapping concepts on the sleeve/position screens (Actionable Now, Issues, Suggested Orders). The same signal was being expressed three or four times across different surfaces with no connection between them. Tapping action items did nothing or navigated incorrectly.

---

## Decisions made

### 1. Single Action object — one source of truth
computeActions(accounts, positions) is the only source of action data. It runs on every portfolio load. No AI call, no generate button, no persisted suggestion rows driving UI.

Action shape:
- id, type (concentration | drawdown | leverage), severity (red | amber)
- accountId, symbol? (position-level only), positionId? (position-level only)
- label (plain English), dismissedAt?, dismissReason?

Deduplication rule: one Action per unique (type, accountId, symbol) tuple.

### 2. Get Suggestions removed entirely
Originally existed for two reasons:
- Suggest resolution for violations → now handled by deterministic math in computeActions
- Highlight interesting positions to consider today → this is the Screener's job (IPS-aware screener, next build)

No Get Suggestions button anywhere in the app.

### 3. Home screen collapses to 3 sections
- Portfolio header (unchanged)
- Sleeves grid — value, daily change, position count. No flag badges on cards.
- Actions — single unified list, severity-ordered (red first). Replaces Action Needed + Risk + Alerts + Suggested Orders.

### 4. Actionable Now = violations only
Concentration breach, drawdown, leverage. Never movers, risers, or neutral items. RKLB-style "+3.4% today" entries are not violations and must not appear here.

### 5. Context-aware navigation from action items
- Position-level action (has symbol) → ActionDetailScreen
- Sleeve-level action (no symbol) → sleeve detail screen for that accountId
- Dismiss X → dismiss only, never navigate
- Drawdown action → navigates to sleeve with most drawdown positions, not hardcoded

### 6. ActionDetailScreen replaces SuggestedOrderDetailScreen
Single resolution point for all actionable items regardless of where triggered from.

Layout:
- Header: symbol + BUY/SELL badge or severity dot
- Section 1: The Issue — plain English + trigger levels visual
- Section 2: Position Context — qty, avg cost, current price, unrealized P&L, % of sleeve, cross-account exposure (grouped by accountId, not by row — fixes duplicate WIO Main bug)
- Section 3: Resolution (concentration breach only):
  - Math: "To reach 15%, sell X shares (est. $Y)"
  - Trim % slider — default at concentrationLimit, updates qty/est. value/sleeve % live
  - Three tranches at current price / -3% / -6%, equal split (33/33/33), update live with slider
  - Exit fully button sets slider to 0%
  - Each tranche has individual Mark Executed
- Section 4: IPS Context — bucket, IPS action, stop price if set
- Sticky bottom: Dismiss with reason (red items require picker: "Reviewed and accepted / Will act within 5 days / No longer relevant")

### 7. Suggested Orders removed from sleeve detail screen
Absorbed into ActionDetailScreen. Sleeve detail Actionable Now taps navigate to ActionDetailScreen.

### 8. Position detail screen cleanup
- Remove inline SELL suggestion cards (Issues section)
- Cross-account exposure: group by accountId and sum, no duplicate rows per account
- Keep: Trigger Levels, position stats grid, sector, notes, View Chart

### 9. Thousands comma everywhere
formatCurrency() helper required for all number rendering ≥ 1000. No raw number display anywhere in the app.

---

## Rationale

The core insight: Action Needed, Risk, and Alerts were the same signals expressed three times. Suggested Orders auto-generated on load and duplicated what Alerts already said. The user saw concentration flagged in four different places with no clear resolution path.

The fix is not a UI polish — it is a data model decision. One Action object, one source of truth, one resolution screen.

---

## What this is not

- Not AI-generated. Deterministic math only.
- Not persisted suggestion rows. computeActions() runs fresh on load.
- Not a trading execution system. Mark Executed is a manual confirmation, not a broker instruction.

---

## Open items at time of decision

- Tranche pricing logic (current / -3% / -6%) is a sensible default but should eventually be informed by volatility and liquidity. Parked for strategy engine phase.
- Drawdown resolution in ActionDetailScreen is informational only (list of positions + dismiss). No order suggestion for drawdown — auto-sell on drawdown was identified as a contradiction in recommendation-engine-v1.md and is explicitly not implemented here.
- Leverage resolution is informational only. No order suggestion for leverage reduction in v1.
