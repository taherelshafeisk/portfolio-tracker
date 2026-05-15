# Backend Backlog — May 15, 2026
## Prioritized for a long-term macro investor who also does 3–5 swing trades/month

Persona context: doesn't think in IPS terms but understands risk management intuitively. Wants to know "am I exposed too much to one thing?" not "am I in breach of my IPS?" Makes 3–5 swing trades per month — timing and position age matter. Not checking the app every hour.

Priority = utility × ease ÷ regression risk.

---

### 🥇 Tier 1 — Highest utility, low regression risk

**1. Daily NLV snapshot job**
Store `(account_id, date, nlv)` once per day. A simple cron on the API server that runs at market close and inserts a row for each account.
- **Utility:** Unlocks the portfolio value-over-time chart (a major visual gap right now). Without it the Accounts screen can never show "how am I doing over time."
- **Complexity:** ~30 lines of code. New table (`account_snapshots`), one cron job, one GET endpoint.
- **Regression risk:** Zero — purely additive.

---

**2. Suppress concentration alerts on Swing accounts in `computeActions()`**
`computeActions()` in `accountService.ts` fires concentration alerts for all accounts. Swing accounts by design hold 2–4 concentrated positions. These alerts are noise.
- **Utility:** Immediately cleans up the Swing account view. 3 false alarms disappear.
- **Complexity:** 2-line change — check `account.accountType === 'swing'` before adding concentration actions.
- **Regression risk:** Very low. Only affects accounts tagged as Swing. Add a unit test.

---

**3. VOO / ETF ex-dividend date from Yahoo Finance**
`quoteSummary` with the `calendarEvents` module returns `exDividendDate` and `dividendDate` for ETFs. VOO currently shows "None." This is a wrong answer, not missing data.
- **Utility:** ETFs are core holdings (VOO, QQQ etc). Seeing the next dividend date is useful for a long-term investor tracking income.
- **Complexity:** Small fix in the market data service — add `calendarEvents` to the Yahoo Finance modules list and map `exDividendDate` to the response.
- **Regression risk:** Low. Additive data enrichment.

---

**4. Hold duration on positions (first buy from activities table)**
Currently `holdDays` is either missing or based on position creation date (which resets on import). The `activities` table has the first buy date. A query like `SELECT MIN(date) FROM activities WHERE account_id = ? AND symbol = ? AND type = 'buy'` gives the true hold start.
- **Utility:** Swing traders need to know "I've held this for 4 days." Long-term investors can see "I've held MSFT for 2 years." Both personas benefit.
- **Complexity:** One SQL query change in `accountService.ts`. Expose as `firstBoughtAt` and `holdDays` on the position response.
- **Regression risk:** Low. Additive field on position response.

---

### 🥈 Tier 2 — High utility, moderate complexity

**5. Conviction type per position (core | swing | earnings | value)**
Add a `convictionType` column to the `positions` table. This is the semantic tag that tells the app _why_ you own something. Different from the existing display `tag` (Long Term, Speculative, Crypto).
- **Utility:** Once set, the app can tailor alerts: "MSFT -12% but conviction = core → thesis intact, no alert." Currently the app nags about everything regardless of intent.
- **Complexity:** DB migration (one column), API PATCH endpoint to update it, frontend form field. Medium scope but clean.
- **Regression risk:** Low — additive column with nullable default. Existing alerts unchanged until conviction is explicitly set.

---

**6. Per-position target allocation (% of account)**
Add `targetAllocation` (nullable float) to positions. Distinct from `concentrationLimit` on the account — this is per-position intent. "I want VOO to be 20% of WIO Main."
- **Utility:** Enables "you're 2% below your VOO target" messaging rather than just "you're over limit." Reframing from punishment to guidance. More useful for long-term portfolio building.
- **Complexity:** DB migration + API change. Medium scope.
- **Regression risk:** Low — additive. `computeActions()` can use this as the basis for concentration checks instead of the global `concentrationLimit`.

---

**7. Today-change for non-US-listed assets (BTC, GOLD, WIO positions)**
Currently `~` prefix appears for assets where Yahoo Finance doesn't return today's change (crypto, some international). These show as estimated P&L, not actual market move.
- **Utility:** BTC and GOLD are real holdings. The `~` is confusing — it suggests the number is unreliable.
- **Complexity:** Medium. Use Yahoo Finance for crypto tickers (BTC-USD, GC=F for gold futures). May need ticker alias mapping for non-standard symbols.
- **Regression risk:** Medium. Changing the price source could affect existing calculations. Test carefully.

---

### 🥉 Tier 3 — Lower urgency or higher risk

**8. Portfolio-level allocation target (sleeve allocation)**
Let the user define target allocations at the account level: "IBKR Main = 40% of total portfolio, WIO Main = 55%, Swing = 5%." App then shows drift from target at the portfolio level, not just intra-account concentration.
- **Utility:** High for long-term portfolio construction. Tells you when the overall portfolio is drifting.
- **Complexity:** High — new data model, new frontend settings flow, new alert type.
- **Regression risk:** Medium — new computations on top of existing ones.

---

**9. Swing trade journal — open/close P&L by trade**
When a swing position is closed (sell activity recorded against a previously bought position), calculate and store the realized gain/loss, hold duration, and % return for that specific trade. Expose as a trade log.
- **Utility:** Lets you track "am I actually good at swing trading?" over time. Essential for the swing persona.
- **Complexity:** Medium-high. Needs activity matching logic (FIFO or LIFO) to pair buys with sells.
- **Regression risk:** Medium — new logic but doesn't change existing activity or position records.

---

**10. Intraday P&L breakdown by position**
Aggregate `today's change ($)` across all positions and return a ranked list: "NVDA +$446, MSFT +$177, GOOGL -$27…" Available on the dashboard as "what made/lost money today."
- **Utility:** Satisfying at end of day. Good for spotting concentration in daily moves.
- **Complexity:** Low — data already exists per position, just needs aggregation and sorting endpoint or client-side derived state.
- **Regression risk:** Low — additive.

---

## Implementation order recommendation

For tomorrow's session, tackle in this order:
1. #2 (swing alert suppression) — 30 min, zero risk
2. #4 (hold duration from activities) — 1 hr, low risk
3. #3 (ETF dividend date) — 1 hr, low risk
4. #1 (NLV snapshot job) — 2 hrs, zero regression risk, unlocks chart
5. #5 (conviction type) — 2 hrs, enables future alert intelligence
