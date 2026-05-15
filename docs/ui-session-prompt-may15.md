# UI/UX Session Prompt — May 15, 2026

**Scope:** Pure frontend/UI changes to `artifacts/portfolio-tracker`. No changes to `artifacts/api-server`, no DB schema migrations, no new API endpoints. If a change requires backend work, note it and skip.

**Working directory:** `artifacts/portfolio-tracker`

---

## Context

This is a React Native app (Expo Router) for a personal portfolio tracker. It connects IBKR Main ($39.6K, 14 positions), WIO Main ($59.4K, 28 positions), and IBKR Swing ($989, 3 positions). The user is a long-term investor — not a day trader. They need signal over noise.

A full UI review was done on May 15. Changes are grouped into priority tiers. **Do not start implementation until I approve the plan for each tier.**

---

## P0 — Quick wins (do these first, show plan first)

### P0-A: Replace text position tags with inline emojis

**Problem:** Position rows in `IntradayPositionRow.tsx` (lines 51–67) show "Long Term" and "Over limit" as full-text pill badges stacked on a second row. This takes up twice the space per position.

**Change:**
- Remove the second tag row entirely from the position card
- Add inline emoji indicators to the right of the ticker symbol on the same row:
  - Strategy tag "Long Term" → 📈 — show if tag is "Long Term" or "Core" type
  - Strategy tag "Speculative" → 🎯
  - Strategy tag "Crypto" → ₿
  - "Over limit" concentration breach → ⚠️ (yellow, always shown if concentration exceeds limit)
  - Leverage active on this position → 🚨 (red)
- Result: `MSFT 📈⚠️  $17.2K  -12%` on one line
- Full tag names should still appear on the Position Detail screen (`position/[ticker].tsx`)

**Files:**
- `components/account/IntradayPositionRow.tsx` — remove badge rows, add emoji after ticker
- `app/account/[id].tsx` — the overview mode position rows also use inline tags (around line 971 filter area and the row rendering below it); apply same emoji treatment there

---

### P0-B: Filter terminology — "Risers" → "Leaders", "Losers" → "Laggards"

**Problem:** `app/account/[id].tsx` line ~971 renders `'↑ Risers'` and `'↓ Losers'`. Inconsistent with the rest of the app.

**Change:**
- `'↑ Risers'` → `'↑ Leaders'`
- `'↓ Losers'` → `'↓ Laggards'`
- Search entire `portfolio-tracker` for any other occurrence of "Risers" or "Losers" and replace consistently

---

### P0-C: Suppress "Trim ~0 shares" when trim rounds to zero

**Problem:** `app/position/[ticker].tsx` lines ~597–613 shows a "Concentration Trim" card with the message "Trim ~0 shares to reach 20% limit" when the position is exactly at the limit. This is noise — no action is needed.

**Change:**
- In the concentration action rendering logic, check if the calculated trim quantity is 0 (or rounds to 0)
- If trim = 0: either hide the trim card entirely, or replace its body with "Within tolerance — no action needed" in a neutral (not warning) style
- The card header ("Concentration Trim") can remain but the CTA should not suggest selling 0 shares

---

### P0-D: "NEEDS ATTENTION" → "Insights" everywhere, with severity tiers

**Problem:** All alerts look identical. "NEEDS ATTENTION" as a section header is alarmist even on good days.

**Rename everywhere:**
- `"NEEDS ATTENTION"` → `"INSIGHTS"` (or `"Insights"`)
- `"RULE BROKEN"` label on individual alert rows → remove the sub-label; the icon communicates severity

**Add severity tiers to alert rows.** Each action item displayed should render with a severity icon and matching left-border color:

| Severity | Icon | Left border | When to use |
|----------|------|-------------|-------------|
| Info     | ℹ️   | blue/gray   | Pending setup items, review candidates, IBKR Swing balance reminder |
| Warning  | ⚠️   | amber/yellow | Concentration breaches (over limit) |
| Alert    | 🚨   | red         | Leverage active (account is borrowing real money) |

**Files:**
- `app/(tabs)/index.tsx` — "NEEDS ATTENTION" section (~line 1369), "RULE BROKEN" labels
- `app/account/[id].tsx` — "NEEDS ATTENTION" section header and alert rows
- Create a shared `AlertRow` component if there isn't one, accepting `severity: 'info' | 'warning' | 'alert'`, `title`, `subtitle`, and `onPress`

---

### P0-E: Link alert severity icons to position cards

**Problem:** MSFT has a concentration warning in the Insights section, but the MSFT card in the positions list shows no indicator. You have to scroll up to find out which positions are flagged.

**Change:**
- After rendering the Insights section, build a map: `{ [ticker]: maxSeverity }` from the current `allActions`
- Pass this map into the position row renderer
- Each position row that appears in `allActions` shows its severity emoji (⚠️ or 🚨) inline next to the ticker (same line as P0-A emojis — merge both indicators)
- Positions with no alerts show no badge

**Files:**
- `app/account/[id].tsx` — build the alert map, pass to rows
- `components/account/IntradayPositionRow.tsx` — accept optional `alertSeverity` prop

---

## P1 — High impact UI changes (show plan, await approval)

### P1-A: Move chart badge strip above the chart

**Problem:** `app/position/[ticker].tsx` lines ~547–567 shows "Conc 20.0% · over limit" and "+16.7% vs cost" pills below the volume bars on the x-axis area. They look like x-axis labels.

**Change:**
- Move the `ipsStrip` view (the two pill badges) to sit **above** the chart container, not below it
- Pill style: rounded chips with colored background — green for positive, amber for warnings
- Tapping a pill does nothing for now (no extra functionality needed)

---

### P1-B: Accounts screen — replace empty space with allocation donut

**Problem:** `app/(tabs)/accounts.tsx` lines 327–337 has an "Import activity" link then empty space filling the rest of the screen.

**Change:**
- Below the account list (after the three account rows), add a **portfolio allocation donut chart**:
  - Segments: one per account, color-coded to match account dot colors (red for IBKR Main, gray for WIO Main, dark for IBKR Swing)
  - Center label: total NLV (`$100K`)
  - Legend below: IBKR Main 39.6% · WIO Main 59.4% · IBKR Swing 1.0%
- Use `react-native-svg` or whatever charting library is already in the project — check `package.json` first and use what's there
- "Import activity" link moves into the ⋮ menu (see P1-C)

---

### P1-C: ⋮ three-dot menu on Accounts screen — consolidate all utility actions

**Problem:** Export button (top-right ↓), Import activity (bottom link), Sign Out (top-right of Today screen) are scattered. None of these are daily actions.

**Change:**
- Add a `⋮` (three-dot) icon button to the top-right of the Accounts screen header
- Inside the menu (ActionSheet or Modal, use whatever pattern already exists in the app):
  - "Export" (was the ↓ button)
  - "Import Activity" (was the bottom link)
  - "Sign Out" (was top-right of Today/index.tsx)
- Remove the standalone ↓ Export button from the header
- Remove "Import activity" from the bottom of the accounts list
- On `app/(tabs)/index.tsx` (Today screen): remove the "SIGN OUT" / "EXIT DEMO" pressable entirely — it now lives in the Accounts ⋮ menu

**Files:**
- `app/(tabs)/accounts.tsx`
- `app/(tabs)/index.tsx` (remove Sign Out from hero section, ~line 1330–1340)

---

### P1-D: Swing account — suppress concentration alerts + surface hold duration

**Problem:** IBKR Swing has 3 intentional positions (META, AAPL, MSFT, each ~30%). The app fires 3 concentration alerts on an account where concentration is the whole point.

**Change:**
- In `app/account/[id].tsx`, before rendering Insights alerts, check if `account.accountType === 'swing'` (or whatever field flags this account as swing)
- If swing: filter out all `concentration` type actions from the displayed list. The "INSIGHTS" section should show no concentration rows for swing accounts, or show a single ℹ️ Info row: "Concentration alerts suppressed for swing accounts."
- In the position rows for swing accounts: show hold duration prominently. If a `holdDays` or `purchasedAt` field is available on the position, render `⏱ Xd` in small gray text below the ticker. If the data isn't available in the current API response, add a TODO comment and skip.

---

## P2 — Data quality + thesis redesign (show plan, await approval)

### P2-A: Thesis section — structured template with JSON storage

**Problem:** `app/position/[ticker].tsx` lines 643–676 shows the `thesis` field as raw text. Due to a bug, it currently contains an AED calculation string instead of user notes.

**Change:**
- The thesis field is stored as a plain text string in the DB. Store structured data as a JSON string in the same column — no DB migration needed.
- Schema for the JSON blob:
  ```json
  {
    "why": "",
    "strategy": "core | swing | earnings | value | other",
    "targetAllocation": "",
    "exitTrigger": "",
    "notes": ""
  }
  ```
- On read: try `JSON.parse(thesis)`. If it succeeds and has any of the above keys, render structured form. If it fails (old plain text), show the raw string in the `notes` field and render structured form around it.
- On write: always write the full JSON blob back
- UI: Replace the textarea with a sectioned form:
  - **Why I own this** — short free text input
  - **Strategy** — picker: Core holding / Swing trade / Earnings play / Value dip / Other
  - **Target allocation %** — numeric input
  - **Exit trigger** — free text ("Sell if thesis breaks, price < $X, or earnings miss")
  - **Notes** — free text (multi-line)
- Each field has a placeholder that guides input
- "Save" saves the full JSON string to the thesis column via the existing PATCH endpoint

---

### P2-B: Fix VOO Catalysts section — hide broken data gracefully

**Problem:** `app/position/[ticker].tsx` shows "Earnings: Not found" and "Ex-dividend: None" for VOO. Both are wrong — VOO pays quarterly dividends and doesn't have earnings in the traditional sense.

**Change (frontend only — no backend changes):**
- If `earnings` is "Not found" and the position's ticker is a known ETF (check if symbol is VOO, SPY, QQQ, GLD, etc., or if `assetClass` is "ETF"), hide the Earnings row entirely rather than showing "Not found"
- If `exDividend` is "None" for an ETF, show "See fund prospectus" or hide the row
- This is a display fix only — do not attempt to fetch better data from the frontend
- Add a TODO comment: "// TODO: backend should return correct ex-div dates from Yahoo Finance calendarEvents"

---

## What NOT to do in this session

- No changes to `artifacts/api-server`
- No DB schema changes (new columns, new tables)
- No new OpenAPI spec changes or codegen
- No new React Query hooks
- Do not implement the conviction engine (backend feature)
- Do not implement NLV history time-series chart (no data)
- Do not add real-time data freshness indicators (requires API polling logic redesign)

---

## Approval gates

Work in this order:
1. Show the full plan for P0 changes before touching any file
2. Implement P0 (A–E), then pause for review
3. Show plan for P1, implement P1 (A–D), pause for review
4. Show plan for P2, implement P2 (A–B), pause for review

Run `pnpm --filter @workspace/portfolio-tracker run typecheck` after each tier. Fix any type errors before moving on.
