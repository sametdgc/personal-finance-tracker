# 05 — Build Plan

One branch and one PR per phase. Do not start a phase until the previous phase's
acceptance criteria pass. If a session is running out of time, stop **between**
phases, never inside one.

---

## Phase 0 — Skeleton, deployed

Ship to production in the first hour. Everything after is incremental and you never
face a big-bang deploy at 3am.

- `create-next-app` (App Router, TypeScript, Tailwind v4), pnpm
- Biome configured; `pnpm check` clean
- Vitest configured with one trivial passing test
- Neon project, `DATABASE_URL` set
- Drizzle Kit configured, empty schema, `pnpm db:generate` works
- `src/lib/env.ts` Zod-validated env, app fails loudly on missing vars
- GitHub Actions: typecheck, lint, test on PR
- Vercel project linked, `main` deploys
- `docs/` and `CLAUDE.md` committed

**Acceptance:** a live URL renders a page; CI is green on a PR; a deliberate env
var removal fails the build with a readable message.

---

## Phase 1 — Auth + schema

- Better Auth: email + password, session cookies
- `/sign-in`, `/sign-up`, sign-out
- Route group `(app)` protected; unauthenticated redirects to sign-in
- Full Drizzle schema from `docs/03-domain-model.md`, migration generated and applied
- `src/db/queries/` established with the `userId`-first convention and one real query
- Seed script: one user, a policy row, default buckets and categories

**Acceptance:** sign up, sign in, see your own email on a protected page, sign out.
Migration applies to a clean database. Every table has `user_id` where the model says
it should.

---

## Phase 2 — The money core

**Write the tests first.** This phase has no UI.

- `core/units.ts` — unit registry
- `core/money.ts` — full implementation per `docs/04-financial-logic.md §1`
- `core/ledger.ts` — fold, drift, freshness
- Wire-type conversion for the RSC boundary
- CI enforces the purity boundary (no I/O imports from `core/`)

**Acceptance:** every test case listed in §1 and §2 of the financial-logic doc exists
and passes. Coverage of `core/money.ts` and `core/ledger.ts` at 100% of branches.
`pnpm test` runs in under two seconds.

---

## Phase 3 — Data in

Now you can enter your real financial situation, which makes every later phase
testable against reality rather than fixtures.

- Account CRUD (create, rename, soft-delete, assign bucket)
- Category CRUD with the `isEssential` flag
- Quick-add transaction form (amount, unit, account, category, date, note)
- Transfer entry, including cross-currency with both rate snapshots
- Reconciliation flow: assert balance → show computed delta → confirm → writes
  adjustment
- CSV import: upload, column mapping UI, preview, `dedupeHash` so re-import is a
  no-op
- Transaction list with filters

**Acceptance:** import the same CSV twice, row count is unchanged. Reconcile an
account and the ledger balance now matches the asserted value. Cross-currency
transfer produces two rows with the same `transferGroupId` and correct snapshots.

---

## Phase 4 — Market data + jobs

- `job_runs` table with the unique `(jobName, periodKey)` constraint
- Cron route handler pattern with `CRON_SECRET` verification
- FX job: daily TRY/USD/EUR (see `docs/07-integrations.md`)
- Gold job: daily XAU_G → TRY
- CPI job: monthly TÜİK TÜFE
- Backfill script for historical FX (2 years) and CPI (5 years)
- Structured logging on every job run; Sentry capture on failure
- `vercel.json` cron schedules

**Acceptance:** invoke the same cron endpoint twice in a period — the second is a
no-op and says so. Calling without the secret returns 401 and does no work.
Backfill populates a queryable series. A deliberately failing job records the error
and the next run backfills the gap.

---

## Phase 5 — Today

- `core/recurrence.ts` + tests (timezone cases included)
- `core/projection.ts` + tests
- Recurring-rule CRUD UI
- `/today`: the big number, 90-day projection chart with the floor line, breach date,
  upcoming obligations, quick-add
- Empty and "still learning" states when there is under a month of history

**Acceptance:** all §3 and §4 test cases pass. Adding a recurring salary visibly
shifts the projection on the correct day. Logging a large expense reduces
safe-to-spend immediately. With no history, the UI says so instead of showing a
confident zero.

---

## Phase 6 — Position

- `core/valuation.ts` + tests, all three v1 strategies
- `core/inflation.ts` + tests, Fisher relation
- Bucket CRUD with target percentages in basis points
- Manual snapshot entry for Other investments
- `/position`: nominal vs real net worth chart with rebase-date picker, currency
  exposure breakdown, per-bucket real return, account freshness list
- Stale-rate and provisional-CPI flags surfaced in the UI

**Acceptance:** all §5 and §6 test cases pass. A period with nominal gain below
inflation renders the real line below the nominal line and reports a negative real
return. Removing recent rates causes a visible staleness warning rather than a wrong
number.

---

## Phase 7 — Compass

- `core/allocation.ts` + tests, including every invariant listed in §7
- `/compass`: target vs actual per bucket with drift, surplus input with a slider,
  recommended split, "deploy this" action that creates the transfers
- Floor-deficit state rendered distinctly from normal allocation

**Acceptance:** every property test in §7 passes, especially exact sum-to-surplus
across randomised inputs (use fast-check for this one). Setting surplus to zero
yields all zeros. A floor deficit larger than the surplus routes 100% to the floor.

---

## Phase 8 — Month Close

- `core/monthClose.ts` + tests
- Multi-step wizard: review variance → drift → surplus → allocation → net worth
  delta → confirm
- Writes the immutable `month_closes` snapshot plus computed `bucket_valuations`
- History view of past closes
- Reopen as an explicit, logged, void-and-recreate action

**Acceptance:** closing a month writes exactly one snapshot; a second attempt at the
same period is rejected. Transactions in a closed month reject edits. The real
net-worth delta uses the period-start rebase.

---

## Phase 9 — Telegram

- BotFather bot, secrets in env
- `/api/telegram` webhook with `X-Telegram-Bot-Api-Secret-Token` verification
- Account linking via one-time code generated in settings
- Command parser: `250 kahve`, `/safe`, `/net`, `/close`, `/help`
- Category inference from a learned phrase→category map, with confirmation on low
  confidence
- Outbound nudges wired into the cron jobs: month-close reminder, floor-breach
  warning, stale-account reminder
- Rate limiting on the webhook

**Acceptance:** a message from an unlinked chat is rejected. `250 kahve` creates a
correctly-typed transaction. A webhook request with a wrong secret token does no
work. Replayed identical updates do not double-log (Telegram `update_id`
deduplication).

---

## Phase 10 — Make it real

- PWA manifest, icons, installable, offline shell
- Sentry with release tagging and source maps
- Playwright over three flows: sign-in → today, quick-add → safe-to-spend changes,
  month close end-to-end
- Loading skeletons, error boundaries, empty states everywhere
- Accessibility pass: focus order, labels, contrast, the big number readable by a
  screen reader
- Number formatting with `tr-TR` locale throughout, via the `MoneyDisplay` component
  only
- README with setup instructions

**Acceptance:** installs to a phone home screen. Playwright passes in CI. Every route
has a defined loading and empty state. Lighthouse PWA check passes.

---

## After v1

In rough priority order — each is a self-contained addition, not a rewrite:

1. Per-instrument holdings (`sum_of_holdings`) — the designed extension point
2. Multi-user: signup flow, invites. The isolation is already structural.
3. Scenario planner: "what if I save 5% more" Monte Carlo over the projection
4. Decision journal: pre-commitment log with scheduled retrospective follow-ups
5. Leak finder: periodicity detection over transaction history
