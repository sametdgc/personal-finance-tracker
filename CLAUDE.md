# CLAUDE.md — Pusula

Read this before writing any code. These rules are not suggestions; they are the
invariants that keep a personal-finance app from quietly lying to its user.

## What this project is

Pusula is a single-user (multi-tenant-shaped) personal finance app that answers three
questions from one dataset:

1. **Safe to Spend** — what can I spend today without breaking anything?
2. **Compass** — where should the surplus go?
3. **Real Terms** — did any of it actually increase my purchasing power?

Full product spec: `docs/01-product-spec.md`.
Architecture: `docs/02-architecture.md`.
Build order: `docs/05-build-plan.md`.

## The four hard rules

### 1. Money is `bigint` minor units. Always.

Never `number`. Never floats. Never `parseFloat`. Money is
`{ amount: bigint, unit: Unit }` and arithmetic goes through `src/core/money.ts`,
which refuses to add mismatched units.

Rates, percentages and CPI index values are Postgres `numeric` and are handled as
strings at the DB boundary, converted through the helpers in `core/money.ts`.
There is exactly one place in the codebase allowed to do decimal multiplication,
and it is `core/money.ts`.

### 2. History is immutable. Rate snapshots are stored, never recomputed.

Every transaction stores `rateToBase` and `baseAmountMinor` captured at the moment
it occurred. When you display a 2024 transaction you use the 2024 rate. Never join
to today's `market_rates` to value a past event.

### 3. All financial logic lives in `src/core/`, which is pure.

`src/core/` must not import from `next`, `react`, `drizzle-orm`, `@/db`, or any I/O.
It takes plain data in and returns plain data out. Every exported function is
unit-tested in the same folder. If you find yourself needing a DB call inside
`core/`, the data should have been passed in as an argument.

Consequence: the entire financial engine is testable in milliseconds with no
database. Keep it that way.

### 4. Every table has `userId`. Every query is scoped.

Queries live in `src/db/queries/` and every exported function takes a `userId` as
its first argument. Never write an ad-hoc query in a route, action, or component.
There is only one user today; the shape is multi-tenant so that stays true later.

## Working agreements

- **One phase per branch, one PR per phase.** Phases are in `docs/05-build-plan.md`
  and each has explicit acceptance criteria. Do not start a phase before the
  previous one's criteria pass.
- **Tests before implementation in `core/`.** The tests define what "correct" means
  for money; the human owns those. Ask before changing an existing assertion in
  `core/**/*.test.ts` — a failing test there means the implementation is wrong, not
  the test.
- **Migrations are generated and committed.** `pnpm db:generate` after any schema
  change. Never edit a migration that has been applied.
- **No new dependencies without asking.** The stack in `docs/02-architecture.md` is
  deliberate and closed. Especially: no date library other than the chosen one, no
  second charting library, no state manager.
- **Server Actions validate their input with Zod at the boundary.** No exceptions.
  Wrap them with the `authedAction` helper so auth and scoping cannot be forgotten.
- **`any` is banned.** `unknown` plus narrowing, or fix the type.

## What this app deliberately does not do

- It does not predict markets, recommend investments, or model tax.
- It does not connect to bank APIs. CSV import only.
- It does not have households, sharing, invites, or roles.
- It does not do per-instrument holdings in v1 (see `docs/03-domain-model.md` for the
  extension point that makes this a later addition rather than a rewrite).

Pusula is a deterministic calculator over rules the user authors. If a feature
requires the app to have an opinion about the future, it is out of scope.

## Commands

```
pnpm dev              # dev server
pnpm test             # vitest, core domain
pnpm test:e2e         # playwright
pnpm check            # biome lint + format check
pnpm typecheck        # tsc --noEmit
pnpm db:generate      # generate migration from schema.ts
pnpm db:migrate       # apply migrations
pnpm db:studio        # drizzle studio
```

`pnpm check && pnpm typecheck && pnpm test` must pass before any commit.
