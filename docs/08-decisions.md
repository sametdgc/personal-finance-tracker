# 08 — Decision Log

Append-only. New decisions go at the bottom. When a decision is reversed, add a new
entry that supersedes rather than editing the old one.

Format: **what was decided**, **why**, **what was rejected**, **when to revisit**.

---

## D1 — Money as `bigint` minor units

Floats cannot represent 0.1 exactly and errors compound over a ledger fold. Integer
minor units with an explicit scale per unit make every operation exact.

*Rejected:* `decimal.js` (adds a dependency and still needs discipline about where
conversion happens); Postgres `numeric` all the way to the UI (loses type safety in
JS, and `numeric` arrives as a string anyway).

*Revisit:* never.

---

## D2 — Hybrid ledger with reconciliation adjustments

A strict ledger drifts from reality the first time the user forgets to log a coffee,
and then becomes useless. A pure snapshot model loses the transaction detail that
makes projection possible. The hybrid keeps the ledger as the model and treats
reality-divergence as data.

*Rejected:* strict double-entry (too demanding for a personal app); snapshot-only
(no projection possible).

*Consequence:* unaccounted drift becomes a first-class, useful metric.

---

## D3 — Buckets with per-bucket valuation strategies

Allocation targets are set against buckets, not instruments. Valuation is a strategy
field on the bucket. "Other investments" is a bucket with `manual_snapshot`.

*Rejected:* hardcoding an "investments" special case (would require schema surgery
to extend); full instrument tracking in v1 (doubles the domain for v1).

*Revisit:* when per-instrument tracking is wanted. Add `holdings`, implement
`sum_of_holdings`, flip the field. Nothing else moves.

---

## D4 — Single-user scope, multi-tenant shape

Every table has `userId`, every query is scoped, but no invites, sharing or roles.

*Rejected:* true single-tenant (would require auditing every query later);
full multi-user now (scaffolding before the interesting parts).

*Revisit:* when a second person wants an account. Should be a signup flow, not a
migration.

---

## D5 — Vercel Cron + own idempotency, not a job platform

Under ten jobs a day. A unique constraint on `(jobName, periodKey)` gives
idempotency by construction with zero infrastructure.

*Rejected:* Inngest / Trigger.dev (real value at higher complexity, unnecessary
here); pg-boss (a queue for a workload with no queueing); `setTimeout` in a route
handler (not a thing).

*Revisit:* if durable multi-step workflows with per-step retries appear. Inngest is
the upgrade path.

---

## D6 — Better Auth over Auth.js

Auth.js is in maintenance mode with no new feature development and its maintainers
recommend Better Auth for new projects. Users live in our own database with no
per-user cost.

*Rejected:* Clerk (fastest to ship, but hosted user data is the wrong trade for a
personal-finance app); Auth.js (legacy choice for greenfield in 2026).

---

## D7 — Drizzle over Prisma

SQL-shaped queries with full type inference and no codegen step. For an app where
understanding the exact query matters, the thinner abstraction is the point.

*Rejected:* Prisma (more polished DX and better for teams less comfortable with SQL;
genuinely a close call, and a defensible alternative choice).

---

## D8 — Telegram over WhatsApp

WhatsApp Business API requires a verified business, a solution provider,
pre-approved templates and per-message billing. Telegram requires a BotFather
conversation. Telegram also makes two-way interaction trivial, which turns the bot
from a notifier into an input surface.

*Rejected:* WhatsApp (bureaucratic cost with no functional gain); push notifications
alone (iOS PWA push is workable but only post-install and less reliable; these
nudges are not time-critical).

---

## D9 — Fisher relation for real returns

`real = (1 + nominal) / (1 + inflation) − 1`, not `nominal − inflation`.

At high inflation the two diverge enough to change conclusions, and this app exists
specifically to be correct about that.

---

## D10 — Half-even rounding

Banker's rounding for all money conversion. Unbiased over many operations, unlike
half-up which drifts upward.

*Consequence:* documented and tested at exact `.5` boundaries in both directions.

---

## D11 — Greedy allocation solver, no LP

Minimising total drift subject to no-selling and sum-to-surplus is separable over a
simplex, so greedy fill with proportional-to-need tiebreak is optimal. An LP solver
would be a dependency and a black box for no gain.

*Revisit:* if constraints stop being separable — e.g. transaction costs, minimum lot
sizes, or tax-lot optimisation.

---

## D12 — PWA, not native

Nothing in the product needs camera, GPS, background location or biometrics. Native
would cost a second codebase or React Native's rough edges plus store review cycles.

*Revisit:* if notification reliability becomes critical. That is the one honest
argument for a native shell.

---

## Open decisions

**Gold price basis.** Pure-metal spot converted from troy ounces, or the Turkish
"gram altın" dealer price including spread? They differ by a few percent. Decide
before Phase 4 and record it here.

**CPI gap handling.** Interpolate between published points, or step-carry the last
value? Step-carry is more honest about what is known; interpolation gives smoother
charts. Decide before Phase 6.

**Closed-month reopening.** Currently specified as void-and-recreate. Confirm this
survives contact with the first real correction.
