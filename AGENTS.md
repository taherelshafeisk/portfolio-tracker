# AGENTS.md

This repository is the target codebase for AI-assisted development.

## Working directory

Work only inside this repository:

~/projects/portfolio-tracker

Do not modify files outside this repository.

## Git rules

- Use branch `hermes-working` unless Taher explicitly approves another branch.
- Before making changes, run:
  - `git status`
  - `git branch --show-current`
  - `git pull --ff-only`
- Before committing, show:
  - `git status`
  - `git diff --stat`
  - `git diff --name-only`
- Commits are allowed only after showing the diff summary.
- Do not push unless Taher explicitly approves.
- Never force push.
- Never push directly to `main`.

## Safety rules

Never modify, create, delete, print, or expose:
- `.env` files
- secrets
- API keys
- tokens
- SSH keys
- Keychain items
- deployment credentials
- GitHub repo settings
- GitHub Actions/workflows

Do not run destructive commands without explicit approval.

Forbidden unless Taher explicitly approves:
- `pnpm --filter @workspace/db run push-force`
- commands that drop, reset, truncate, or overwrite database data
- deployment commands
- package manager commands that change lockfiles, unless dependency changes are explicitly required

## Project rules

- Follow `CLAUDE.md` for architecture and project-specific guidance.
- OpenAPI is the source of truth for API contracts.
- Do not manually edit generated packages:
  - `lib/api-zod`
  - `lib/api-client-react`
- Use `formatCurrency()` for money rendering.
- `computeActions()` is the single source of truth for action items.
- Prefer deterministic logic over AI-generated trading suggestions.
