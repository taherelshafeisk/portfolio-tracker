# Account Workbench

## Purpose
The account screen is not just a holdings list. It is the main operating surface for reviewing and acting on positions.

This matters most for accounts like WIO that can contain:
- many positions
- mixed time horizons
- both long-term and tactical behavior
- crypto positions

## What exists today
- Position list with filter (risers/losers/all), sort (value, P&L %, P&L $, name, symbol), and search
- Add / edit / delete positions manually (symbol search autocomplete via `/market/search`)
- CSV import — bulk-add positions from a spreadsheet export
- Screenshot import — Claude Vision parses a broker screenshot via `/api/anthropic/parse-screenshot`; duplicate detection before commit
- Account-level stats: total value, unrealized P&L, leverage ratio (shown only when cash is negative)
- Suggested orders preview — relevant `SuggestionCard` rows for this account
- Export as CSV via native share sheet

## Modes (planned)

### Overview
Used for calmer review. Richer cards, more detail per position. Default outside market hours.

### Intraday
Used for faster decision-making during market hours. Denser rows, grouped by bucket, sorted by actionability score. Default when US market is open.

What changes in Intraday vs Overview:
- Position cards compress to single-line rows
- Default sort switches to actionability (policy breaches + daily move magnitude)
- Actionable Now block is pinned at the top
- Grouping by position bucket is visible

**Not yet implemented.** Mode switching, market-hours detection, and density toggle are all planned.

## Position Groups (planned)
Visible groups in Intraday mode:
- Long Term
- Speculative
- Crypto

Crypto is always its own visible group.

Group membership is driven by position buckets (see `docs/product/position-buckets.md`). Buckets are not yet persisted — this requires a schema addition and the classification logic described there.

## Actionable Now (planned)
Each account screen should surface a short ranked list of items that deserve attention first, pinned above the position list.

Actionability includes:
- policy/risk issues (concentration, drawdown, leverage)
- big daily movers by % or by dollar impact
- position importance (market value weight)

The ranking logic will come from the Recommendation Engine (see `docs/product/recommendation-engine-v1.md`). Today, the home screen surfaces Action Needed and Suggested Orders globally — the account screen does not yet have its own actionability block.

## Design principle
The account screen should help answer:
- what matters now
- why it matters
- what I should review next
