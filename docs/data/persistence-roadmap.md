# Persistence Roadmap

## Principle
Build locally first until product behavior is proven.
Persist only what has demonstrated value and stable shape.

---

## What is already persisted (DB)

The PostgreSQL schema (`lib/db/src/schema/`) currently has:
- `accounts` — broker accounts with cash balance
- `positions` — holdings with quantity, avg cost, asset type, sector, notes
- `activities` — trade history (buy/sell/dividend/deposit/withdrawal)
- `conversations` + `messages` — AI chat threads
- `order_suggestions` — generated suggested orders with status (pending/dismissed/executed), urgency, rationale, expiry

---

## Local / client-side first

These can start locally and do not need immediate DB persistence:
- active account mode (overview/intraday)
- actionability scoring / recommendation ranking
- current strategy profile selection
- temporary bucket overrides
- recommendation generation logic

---

## Good candidates for persistence soon

These are likely to move to the DB once the UX is proven:
- position bucket overrides (`autoBucket`, `userBucketOverride`, `effectiveBucket` — currently no DB columns)
- active strategy profile selection (which `StrategyProfile` is active)
- custom strategy profiles (user-defined IPS thresholds)
- accepted/rejected recommendation history
- watchlists
- notes on positions/accounts (positions table has `notes` field, accounts do not yet)

---

## Good candidates for backend / data services

These likely require backend or centralized ingestion:
- market/news feed normalization
- technical/fundamental data caching
- Minervini-style screeners at scale
- alert history
- cross-device sync
- user-specific settings and overrides

---

## Good candidates for later backend workflows

- execution tracking (linking order suggestions to actual fills)
- audit trail of decisions made
- historical policy versioning (which thresholds were active at a given date)
