# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trade-Navigator is a full-stack trading portfolio management app. It uses a **pnpm workspace monorepo** with:
- `artifacts/api-server` — Express 5 REST API backend
- `artifacts/portfolio-tracker` — Expo React Native mobile app (primary frontend)
- `artifacts/mockup-sandbox` — Vite + React web sandbox for UI prototyping
- `lib/db` — Drizzle ORM + PostgreSQL schema (shared)
- `lib/api-spec` — OpenAPI 3.1 spec (source of truth for types/hooks)
- `lib/api-zod` — Generated Zod schemas (do not edit manually)
- `lib/api-client-react` — Generated React Query hooks (do not edit manually)
- `lib/integrations-anthropic-ai` — Claude SDK wrapper

## Commands

All commands use `pnpm`. Use `--filter` to target a specific package.

```bash
# Install dependencies
pnpm install

# Run dev servers
pnpm --filter @workspace/api-server run dev          # Express API (tsx watch)
pnpm --filter @workspace/portfolio-tracker run dev   # Expo mobile app
pnpm --filter @workspace/mockup-sandbox run dev      # Vite sandbox

# Type checking
pnpm run typecheck                                    # All packages
pnpm --filter @workspace/api-server run typecheck    # Single package

# Build
pnpm run build                                        # All packages
pnpm --filter @workspace/api-server run build        # Single package (esbuild)

# Database
pnpm --filter @workspace/db run push                 # Push schema changes
pnpm --filter @workspace/db run push-force           # Push (force, drops data)

# Regenerate API client/schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen        # Runs Orval
```

There are no test commands — this project has no test suite.

## Architecture

### Type Safety Pipeline

The OpenAPI spec (`lib/api-spec/openapi.yaml`) is the **source of truth**. Changes to API contracts should be made there first, then regenerate with `pnpm --filter @workspace/api-spec run codegen`. This updates `lib/api-zod` (Zod schemas) and `lib/api-client-react` (React Query hooks) automatically. Never edit generated files directly.

### TypeScript Composite Projects

`tsconfig.base.json` defines shared compiler options. Each lib package uses `composite: true` with project references. The root `tsconfig.json` references all lib packages. Artifacts reference libs via `paths` in their own tsconfigs.

### API Server Structure

- Entry: `artifacts/api-server/src/index.ts` → `src/app.ts`
- Routes mounted at `/api` with sub-routers (accounts, positions, activities, market, portfolio, anthropic)
- All routes use Zod validation from `@workspace/api-zod`
- Yahoo Finance used for live price data (no API key required)
- Claude SSE streaming on `POST /api/anthropic/conversations/:id/messages`
- Screenshot parsing via Claude vision on `POST /api/anthropic/parse-screenshot`

### Mobile App Structure

- Expo Router (file-based), tab navigation: Portfolio / Accounts / Screener / Activity / AI
- `app/(tabs)/` contains the five main screens
- `app/account/[id].tsx`, `app/position/[id].tsx`, `app/chart/[symbol].tsx` for detail views
- React Query via `@workspace/api-client-react` generated hooks for all data fetching
- SSE streaming handled manually with `EventSource` for the AI chat tab

### Database Schema

Five tables managed by Drizzle (`lib/db/src/schema.ts`):
- `accounts` — broker accounts with balance tracking
- `positions` — stock holdings linked to accounts
- `activities` — trade history (buy/sell/dividend/deposit/withdrawal)
- `conversations` — AI chat threads
- `messages` — AI chat messages (cascade deletes with conversation)

Connection via `DATABASE_URL` env var (PostgreSQL).

### AI Integration

`lib/integrations-anthropic-ai` wraps the Anthropic SDK. The API server uses `claude-sonnet-4-6` for streaming financial advice.

`lib/integrations-openai` wraps the OpenAI SDK. The API server uses `gpt-4o` for vision-based screenshot parsing to extract trade/position data as JSON.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (required for api-server)
- `ANTHROPIC_API_KEY` — Required for AI chat features (Claude)
- `OPENAI_API_KEY` — Required for screenshot parsing features (GPT-4o Vision)
- `PORT` — API server port (defaults apply)
