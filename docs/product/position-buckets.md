# Position Buckets

## Visible buckets
- long_term
- speculative
- crypto

Crypto must remain a separate visible group.

## Classification model
Each position can have:
- autoBucket
- userBucketOverride
- effectiveBucket

effectiveBucket = userBucketOverride ?? autoBucket

## v1 heuristic
- crypto assets → crypto (detected via symbol set; see `CRYPTO_SYMBOLS` in `app/account/[id].tsx`)
- designated core holdings / ETFs → long_term
- remaining tactical/high-volatility names → speculative

This is intentionally simple in v1.

## Current code state
The DB schema (`lib/db/src/schema/positions.ts`) has an `assetType` text field (e.g. `"crypto"`, `"stock"`, `"etf"`). This is the closest existing field to bucket classification and can seed the `autoBucket` logic.

There is no `bucket`, `autoBucket`, or `userBucketOverride` column yet. Implementing buckets requires:
1. Adding these fields to the positions schema
2. Running a migration
3. Populating `autoBucket` from existing `assetType` + symbol heuristics on backfill

Until then, bucket-grouped views on the account screen are blocked.

## Overrides
User override always wins.
Overrides should eventually be persisted to the DB.
In early versions, local-only storage is acceptable if needed.

## Goal
Support the way the portfolio is actually managed, not just the way broker data is structured.
