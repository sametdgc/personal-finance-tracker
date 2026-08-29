# Pusula

A personal finance app that answers three questions from one dataset:

1. **Safe to Spend** — what can I spend today without breaking anything?
2. **Compass** — where should the surplus go?
3. **Real Terms** — did any of it actually increase my purchasing power?

Built mobile-first as an installable PWA, with a Telegram bot as a second surface.

## Read these first

| Doc | What's in it |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | The four hard rules. Read before writing any code. |
| [`docs/01-product-spec.md`](./docs/01-product-spec.md) | What we're building and why |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | Stack, folder structure, boundaries |
| [`docs/03-domain-model.md`](./docs/03-domain-model.md) | Entities, invariants, extension points |
| [`docs/04-financial-logic.md`](./docs/04-financial-logic.md) | Every algorithm, with test cases |
| [`docs/05-build-plan.md`](./docs/05-build-plan.md) | Phases 0–10 with acceptance criteria |
| [`docs/06-conventions.md`](./docs/06-conventions.md) | Code style, testing, git, CI |
| [`docs/07-integrations.md`](./docs/07-integrations.md) | Market data sources, Telegram bot |
| [`docs/08-decisions.md`](./docs/08-decisions.md) | Decision log — why things are the way they are |

## Setup

```bash
pnpm install
cp .env.example .env.local     # fill in DATABASE_URL and secrets
pnpm db:migrate
pnpm dev
```

## Commands

```bash
pnpm dev           # dev server
pnpm test          # vitest — core domain, fast, no I/O
pnpm test:e2e      # playwright
pnpm check         # biome lint + format
pnpm typecheck     # tsc --noEmit
pnpm db:generate   # generate migration from schema.ts
pnpm db:migrate    # apply migrations
pnpm db:studio     # drizzle studio
```

`pnpm check && pnpm typecheck && pnpm test` must pass before any commit.

## The one thing to remember

All financial logic lives in `src/core/` and that folder is **pure** — no database,
no React, no Next. It takes plain data in, returns plain data out, and is tested
exhaustively in milliseconds. Everything else is plumbing.
