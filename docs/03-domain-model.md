# 03 — Domain Model

## Units

A **unit** is what an amount is denominated in. Not all units are currencies.

| Code | Kind | Scale | Notes |
|---|---|---|---|
| `TRY` | currency | 2 | base currency by default |
| `USD` | currency | 2 | |
| `EUR` | currency | 2 | |
| `XAU_G` | commodity | 4 | gold, grams — not troy ounces |

Scale = decimal places in the minor-unit representation. ₺1,234.56 is
`123456n` with unit `TRY`. 12.5 grams of gold is `125000n` with unit `XAU_G`.

Adding a unit means adding a row to the registry in `core/units.ts` and a rate
source in `server/market/`. Nothing else changes.

## Entities

### `accounts`
A container that holds exactly one unit. Cash in a bank, a foreign-currency
account, physical gold, a brokerage account.

Belongs to a bucket. Has `lastReconciledAt` for freshness.

### `transactions`
The append-only flow record. Types: `income`, `expense`, `transfer`, `adjustment`.

Every row stores:
- `amountMinor` + `unit` — the native amount, exactly as it happened
- `rateToBase` (numeric) and `baseAmountMinor` — **the snapshot**, captured at
  `occurredAt`, never recomputed
- `source` — `manual` | `csv` | `telegram` | `reconciliation`
- `dedupeHash` — for idempotent CSV import

Transfers are two rows sharing a `transferGroupId`. This keeps the ledger fold a
simple per-account sum with no special cases, and makes cross-currency transfers
(where the two legs have different units and both carry their own rate snapshot)
fall out naturally.

**Transactions are never updated or deleted after a month is closed.** Corrections
are new compensating rows. Before close, editing is allowed.

### `reconciliations`
"My account actually has X." Records `assertedBalanceMinor`, the
`ledgerBalanceMinor` at that moment, and the `deltaMinor` between them. Writing a
reconciliation also writes an `adjustment` transaction for the delta, linked back.

The sum of adjustments over a period **is** the unaccounted-drift metric. It feeds
Safe to Spend.

### `categories`
User-defined, with `kind` (income/expense) and an `isEssential` flag. Essential
expenses are what the emergency floor is measured in months of.

### `recurring_rules`
Salary, rent, subscriptions. An RRULE string plus amount, unit, account, category,
and an optional end date. Expanded forward by `core/recurrence.ts` — never
materialised into the transactions table ahead of time. Projected obligations are
computed, actual transactions are recorded; reconciling the two is the Month Close.

### `buckets`
The allocation unit. Name, `assetKind`, `targetPct`, `valuationStrategy`, and an
`isEmergencyFloor` flag.

Valuation strategies:
- `ledger_fold` — sum the accounts' ledger balances (base-currency accounts)
- `fx_converted` — ledger fold × current rate (FX and gold)
- `manual_snapshot` — read the latest `bucket_valuations` row (Other investments)
- `sum_of_holdings` — **not implemented in v1.** The extension point.

`targetPct` across non-floor buckets should sum to 100. Validate, warn, don't block.

### `bucket_valuations`
Timestamped asserted or computed value of a bucket. For `manual_snapshot` buckets
these are user-entered. For others the Month Close writes a computed snapshot so
history is queryable without replaying every rate.

### `policy`
One row per user. Base currency, timezone, CPI region, `monthStartDay`,
`emergencyFloorMonths`, `spendingBufferMinor`, `driftToleranceBps`.

This is the only place the app's "opinions" live, and they are the user's.

### `market_rates`
`(base, quote, asOf) → rate`. Unique on that triple. Daily granularity.
Gold is stored as a rate from `XAU_G` to `TRY`.

### `cpi_series`
`(region, period) → indexValue`. Monthly. Unique on the pair. Used for rebasing.

### `month_closes`
Immutable snapshot per period: projected vs actual income and expense, drift,
surplus, the allocation that was recommended, and nominal + real net worth.

Once written, it is the historical record. Reopening a close is an explicit,
logged action that voids the row rather than editing it.

### `job_runs`
`(jobName, periodKey)` unique. Status, attempt, timings, error payload.
Idempotency by constraint.

### `telegram_links`
Maps a Telegram `chatId` to a `userId`, established via a one-time link code.

## Relationships

```
users ──┬── policy (1:1)
        ├── accounts ──── transactions ──── categories
        │        │              │
        │        │              └── reconciliations
        │        └── buckets ──── bucket_valuations
        ├── recurring_rules
        ├── month_closes
        └── telegram_links

market_rates, cpi_series, job_runs  ← global, not user-scoped
```

## Invariants

1. **Every user-owned table carries `userId` and every query filters on it.**
2. **`amountMinor` is `bigint`.** In Drizzle: `bigint({ mode: 'bigint' })`.
3. **`rateToBase` and `baseAmountMinor` are written on insert and never updated.**
4. **A transfer is exactly two rows with the same `transferGroupId`,** and their
   `baseAmountMinor` values sum to the FX spread, not to zero. Cross-currency
   spread is real and should be visible.
5. **A closed month's transactions are immutable.**
6. **Deleting an account is a soft delete.** History must survive.
7. **`bucket.targetPct` is stored in basis points as an integer**, not a float.

## The v2 extension point

Per-instrument tracking, when it comes:

```sql
CREATE TABLE holdings (
  id, user_id, bucket_id, symbol, quantity numeric,
  cost_basis_minor bigint, cost_basis_unit, acquired_at
);
CREATE TABLE instrument_prices (symbol, as_of, price, unit);
```

Then flip that bucket's `valuationStrategy` to `sum_of_holdings` and implement the
branch in `core/valuation.ts`. **No change to transactions, policy, allocation, or
month close.** That is the whole reason valuation is a per-bucket strategy field
rather than a hardcoded conditional.
