# 02 — Architecture & Tech Stack

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16, App Router | Server Components + Server Actions: one codebase, no separate API surface, money math runs server-side by default. |
| Language | TypeScript, `strict: true` | Non-negotiable for this many invariants. |
| Database | PostgreSQL (Neon) | Serverless; DB branching gives real per-PR preview environments. |
| ORM | Drizzle + Drizzle Kit | SQL-shaped queries, TypeScript-native schema, no codegen step. For a finance app you want to see the SQL you generate. |
| Auth | Better Auth | Auth.js is in maintenance mode with no new feature development; its maintainers recommend Better Auth for new projects. Users live in our own DB; multi-user later is config, not migration. |
| Validation | Zod | One schema for forms, action boundaries, and external API responses. |
| Jobs | Vercel Cron → idempotent route handlers + `job_runs` table | See "Jobs" below. |
| Styling | Tailwind v4 | |
| Components | shadcn/ui | We own the source; no fighting a library on a custom dashboard. |
| Charts | Recharts | Sufficient for line / area / stacked bar. |
| Dates | date-fns + date-fns-tz | Timezone correctness matters here; see "Time". |
| Recurrence | rrule | RFC 5545 expansion for recurring rules. |
| Unit tests | Vitest | |
| E2E | Playwright | Three flows only, see `docs/06-conventions.md`. |
| Lint + format | Biome | One tool, one config. Replaces ESLint + Prettier. |
| Errors | Sentry | |
| Logs | pino, structured JSON | |
| CI/CD | GitHub Actions → Vercel | |
| Package manager | pnpm | |

**The dependency list above is closed.** Adding to it requires a decision entry in
`docs/08-decisions.md`.

## Folder structure

```
src/
  core/                 PURE. No I/O, no framework imports. The whole product.
    money.ts            Money type, minor units, safe arithmetic
    units.ts            Unit registry: code, scale, kind
    ledger.ts           fold(transactions) -> balance, with adjustments
    recurrence.ts       rrule expansion into dated obligations
    projection.ts       forward daily balance, safe-to-spend
    valuation.ts        bucket valuation strategies, FX conversion
    inflation.ts        CPI rebasing, nominal -> real
    allocation.ts       drift computation + surplus solver
    *.test.ts           colocated

  db/
    schema.ts           Drizzle schema (single file until it hurts)
    client.ts           connection
    queries/            ALL data access. Every fn takes userId first.
    migrations/         generated, committed

  server/
    auth.ts             Better Auth config
    actions/            Server Actions, thin. Validate -> query -> core -> return
    action-client.ts    authedAction wrapper (auth + zod + error mapping)
    services/           orchestration that spans several queries
    market/             external market-data clients
    telegram/           bot client, webhook handler, command parser

  app/
    (auth)/             sign-in, sign-up
    (app)/              today, position, compass, close, settings
    api/
      cron/[job]/       cron entrypoints
      telegram/         webhook
      auth/[...all]/    Better Auth handler

  components/
    ui/                 shadcn primitives
    charts/
    money/              MoneyDisplay, MoneyInput — the only formatting surface

  lib/                  cross-cutting: env parsing, logger, formatting
```

## The critical boundary

`src/core/` may import: nothing but other `core/` modules and `type`-only utilities.

Nothing in `core/` may import from `next`, `react`, `drizzle-orm`, `@/db`,
`@/server`, or any package that performs I/O. Enforce this with a Biome rule or a
dependency-cruiser check in CI — an accidental import here is the one architectural
mistake that would be genuinely painful to undo later.

Data flows: **route → action → query (I/O) → core (math) → serialised result → RSC**.

## Rendering strategy

- Default to **Server Components**. Every page fetches its own data server-side.
- **Server Actions** for all mutations, wrapped in `authedAction`.
- Client Components only where interaction demands it: the Compass surplus slider,
  chart tooltips, quick-add form, the month-close wizard.
- No client-side data-fetching library in v1. If a Client Component needs data, pass
  it down as props from the server. Add TanStack Query only if a genuinely
  interactive surface demands it, and record the decision.

### Serialisation warning

`bigint` does not survive the RSC boundary and does not JSON-serialise. Every
`Money` crossing server→client is converted to a wire type by a single function in
`core/money.ts`:

```ts
type MoneyWire = { amount: string; unit: UnitCode }
```

Never hand-roll this conversion. One function in, one out.

## Jobs

The workload is small: daily FX and gold, monthly CPI, a handful of Telegram
nudges — under ten jobs a day. Postgres-based queues eliminate an infrastructure
dependency for volumes well under 1,000 jobs/hour, and a full queue system here
would be overengineering.

So: **Vercel Cron hits a protected route handler; we write the idempotency
ourselves.**

- Each job has a `jobName` and computes a `periodKey` (e.g. `fx:2026-08-30`).
- `job_runs` has a unique constraint on `(jobName, periodKey)`. A double-fire is a
  no-op by construction, not by convention.
- Handler records `started`, `succeeded` or `failed` with an error payload and
  attempt count.
- Cron routes are protected by a shared secret header (`CRON_SECRET`), checked
  before any work.
- Retries: the job records failure and the next scheduled run picks up any gap by
  backfilling missing periods. No exponential-backoff machinery needed.

Writing this yourself is the point. If durable multi-step workflows are ever needed,
Inngest is the clean upgrade path — but not now.

## Time

Get this right once, at the boundary.

- Store all instants as `timestamptz` in UTC.
- Store calendar-anchored things (a CPI period, a month-close period, a transaction's
  business date) as `date`, not a timestamp.
- All user-facing day boundaries resolve in `policy.timezone` (default
  `Europe/Istanbul`).
- `core/` functions never call `new Date()`. The current time is always an argument.
  This makes projection and month-close logic deterministically testable.

## Environment & config

`src/lib/env.ts` parses `process.env` through a Zod schema at module load and
exports a typed object. The app must fail to boot on a missing variable rather than
fail mysteriously at 3am. No `process.env` access anywhere else.

## Security posture

- Better Auth sessions, httpOnly cookies, CSRF handled by Server Actions.
- Every query scoped by `userId` at the query-module level — access control is
  structural, not a `WHERE` clause someone remembers to write.
- Cron routes: constant-time secret comparison.
- Telegram webhook: verify `X-Telegram-Bot-Api-Secret-Token` before parsing.
- CSV upload: size cap, parse in a worker-safe way, never `eval`, never trust
  headers.
- Rate-limit the auth routes and the Telegram webhook.
- No financial data in logs. Log identifiers and shapes, never amounts.

## Deployment

- Vercel, `main` = production.
- Neon: one production branch, one branch per PR for previews.
- Migrations run in CI on merge, before the deploy promotes.
- Sentry release tagged per deploy.
