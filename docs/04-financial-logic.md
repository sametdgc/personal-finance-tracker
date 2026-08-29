# 04 — Financial Logic

Every algorithm here lives in `src/core/`, is pure, and is unit tested. This is the
product; everything else is plumbing.

---

## 1. Money arithmetic (`core/money.ts`)

```ts
type Money = { readonly amount: bigint; readonly unit: UnitCode }
```

Operations: `add`, `sub`, `neg`, `abs`, `compare`, `isZero`, `mulRate`,
`allocate`, `convert`, `format`, `toWire`, `fromWire`.

**`add`/`sub` throw on unit mismatch.** Loudly. A silent currency mix is the worst
possible failure mode in this app.

**`mulRate(money, rate: Decimal, targetUnit)`** — the only place decimal
multiplication happens. Uses a fixed-point integer approach: rates are stored with
8 decimal places, so multiply by `rate * 10^8` and divide by `10^8` with explicit
rounding. Rounding mode is **half-even** (banker's rounding) and it is a documented,
tested choice.

**`allocate(money, ratios: number[]): Money[]`** — splits an amount by ratios such
that the parts sum *exactly* to the whole. Largest-remainder method. This is used by
the Compass solver and it is where naive implementations lose or invent a kuruş.

Test cases that must exist:
- `add` with mismatched units throws
- ₺0.01 split three ways sums back to ₺0.01
- ₺100 split 33/33/34 sums back to ₺100
- `mulRate` rounding at exact `.5` boundaries in both directions
- Negative amounts round symmetrically
- `toWire(fromWire(x)) === x` for a range of values including `0n` and large values

---

## 2. Ledger fold (`core/ledger.ts`)

```ts
balance(account, transactions, asOf: Date): Money
```

Sum of `amountMinor` for the account where `occurredAt <= asOf`, in the account's
native unit. Adjustments participate exactly like any other transaction — that is
the whole trick of the hybrid model.

```ts
unaccountedDrift(transactions, period): Money
```

Sum of `adjustment`-type transactions in a period. Negative means spending that was
never logged. **This number feeds the projection.**

```ts
freshness(account, now): { lastReconciledAt, daysStale, confidence }
```

`confidence` is a simple decay: `fresh` (<7d), `aging` (<30d), `stale` (≥30d).
Do not over-model this; it is a UI hint, not a calculation input.

---

## 3. Recurrence expansion (`core/recurrence.ts`)

```ts
expand(rules, from: Date, to: Date, tz: string): Obligation[]
```

RRULE expansion into dated obligations. Each `Obligation` is
`{ date, amount: Money, categoryId, accountId, ruleId, direction }`.

**Timezone traps to handle and test:**
- "The 1st of every month" means the 1st in `Europe/Istanbul`, not UTC.
- A rule for day 31 in a 30-day month: clamp to the last day, do not skip.
- DST transitions must not shift a monthly rule by a day.

**Matching obligations to actuals:** an obligation is "met" when a transaction
exists in the same period, same account, same category, within a tolerance window
(±5 days, ±10% amount). Unmatched obligations remain projected. This matching is
what Month Close reports on.

---

## 4. Forward projection & Safe to Spend (`core/projection.ts`)

```ts
project(input: {
  openingBalances: Money[],       // per account, in base
  obligations: Obligation[],      // expanded, from now to horizon
  driftPerDay: Money,             // from unaccountedDrift, smoothed
  policy: Policy,
  now: Date,
  horizonDays: number,            // default 90
}): {
  daily: Array<{ date, projectedBalance: Money }>,
  floorBreachDate: Date | null,
  safeToSpendToday: Money,
  safeToSpendRemainingPeriod: Money,
}
```

### Algorithm

1. Start from the sum of base-currency liquid account balances. **Only liquid
   accounts count** — gold and Other investments are not spendable today and must be
   excluded. Liquidity is a property of the bucket.
2. Walk forward day by day. Apply each obligation on its date. Apply `driftPerDay`
   every day.
3. Record the daily series. The first day where balance < floor is
   `floorBreachDate`.

### Safe to Spend

```
floor           = essentialMonthlyExpenses × policy.emergencyFloorMonths
reserved        = Σ obligations from now until next income event
buffer          = policy.spendingBufferMinor
available       = currentLiquid − floor − reserved − buffer
daysRemaining   = days until next income event (min 1)
safeToSpendToday = max(0, available / daysRemaining)
```

`safeToSpendRemainingPeriod` is `max(0, available)` — the whole envelope, for when
the user wants to make a larger purchase decision.

**`driftPerDay`** is the trailing 3-month median of daily unaccounted drift, not the
mean — one bad month should not distort it. If there is under a month of history,
use zero and surface a "still learning" state rather than a confident wrong number.

### Test cases
- Zero obligations, zero drift → linear flat line
- Income mid-horizon lifts the line on exactly the right day in the right tz
- Floor breach detected on the correct day, boundary-inclusive
- `available` negative → safe-to-spend is 0, never negative
- Next income event is today → `daysRemaining` is 1, not 0

---

## 5. Valuation (`core/valuation.ts`)

```ts
valueBucket(bucket, accounts, transactions, rates, snapshots, asOf): Money  // in base
```

Dispatch on `bucket.valuationStrategy`:

- `ledger_fold` — sum account balances; already in base unit
- `fx_converted` — sum in native unit, then `mulRate` with the rate `asOf`
- `manual_snapshot` — most recent `bucket_valuations` row at or before `asOf`;
  if none, zero with a `stale: true` flag
- `sum_of_holdings` — **throws `NotImplemented` in v1.** Deliberate: it makes the
  extension point visible in the type system.

```ts
netWorth(buckets, ..., asOf): { total: Money, byBucket, byUnit, staleBuckets }
```

`byUnit` is currency exposure — this is what powers the "you are 78% TRY-exposed"
insight, and it must aggregate across accounts regardless of which bucket holds them.

**Rate selection rule:** use the most recent rate at or before `asOf`. Never a
future rate. If the gap exceeds 7 days, flag it — a stale rate silently valuing a
portfolio is a quiet lie.

---

## 6. Inflation & real terms (`core/inflation.ts`)

```ts
rebase(series: CpiPoint[], baseDate: Date): (date: Date) => Decimal
realValue(nominal: Money, at: Date, baseDate: Date, cpi: CpiPoint[]): Money
```

```
realValue = nominal × (CPI_base / CPI_at)
```

Interpretation: "this amount, expressed in the purchasing power of `baseDate`."

```ts
realReturn(nominalReturnPct, inflationPct): Decimal
```

Use the **Fisher relation**, not subtraction:

```
real = (1 + nominal) / (1 + inflation) − 1
```

At Turkish inflation levels the difference between this and naive subtraction is
large enough to change conclusions. Subtraction is wrong; do not use it.

**CPI is monthly and published with a lag.** For a date inside the current month,
carry the last published value forward and mark the point `provisional`. Show that
state in the UI — never silently extrapolate.

### Test cases
- Nominal +40% with inflation +45% yields a *negative* real return
- Rebasing to a date equal to the series start is identity
- A gap in the CPI series interpolates or flags, per an explicit documented choice
- Real value at `baseDate` equals nominal value at `baseDate`

---

## 7. Allocation & the surplus solver (`core/allocation.ts`)

```ts
drift(buckets, values, total): Array<{
  bucketId, targetBps, actualBps, driftBps, driftAmount: Money
}>
```

```ts
solve(input: {
  surplus: Money,
  buckets: BucketState[],
  floorRequirement: Money,
  currentFloorValue: Money,
}): Allocation[]
```

### Algorithm — greedy, no selling

1. **Emergency floor first.** If `currentFloorValue < floorRequirement`, allocate
   `min(surplus, deficit)` to the floor bucket before anything else. It is a hard
   constraint, not a target percentage.
2. With the remainder `R`: compute each bucket's target value at the *post-deployment*
   total, i.e. `targetValue_i = targetBps_i × (currentTotal + R) / 10000`.
3. `need_i = max(0, targetValue_i − currentValue_i)`. Buckets already over target
   get zero — **we never recommend selling.**
4. If `Σ need_i <= R`: allocate each `need_i`, then distribute the leftover by
   target weights.
5. If `Σ need_i > R`: allocate `R` proportionally to `need_i` using
   `Money.allocate` so the parts sum exactly to `R`.

### Properties that must hold (test these as invariants)

- `Σ allocations == surplus`, exactly, always. No lost kuruş.
- No allocation is negative.
- Post-allocation drift is ≤ pre-allocation drift for every bucket that received
  funds.
- With `surplus == 0`, all allocations are zero.
- With a floor deficit ≥ surplus, everything goes to the floor.
- Deterministic: same input, same output, no ordering dependence on map iteration.

### Why greedy is enough

The optimal solution to "minimise total drift subject to no-sell and sum-to-surplus"
is exactly this greedy fill under a proportional-to-need tiebreak, because the
objective is separable and the constraint set is a simplex. Reaching for an LP
solver here would be overengineering.

---

## 8. Month Close (`core/monthClose.ts`)

```ts
close(input: {
  period: { start, end },
  obligations, actuals, reconciliations,
  netWorthAtStart, netWorthAtEnd,   // both nominal
  cpi, policy,
}): MonthCloseResult
```

Produces:
- Projected vs actual income and expense, and the variance
- Matched / unmatched / unexpected obligations
- Unaccounted drift for the period
- `surplus = actualIncome − actualExpense − drift`
- Nominal net worth delta
- **Real** net worth delta (both endpoints rebased to the period start)
- The Compass allocation for the surplus

`surplus` can be negative. Say so plainly; do not clamp to zero and pretend.

---

## Cross-cutting rules

1. **No `new Date()` inside `core/`.** Time is an argument.
2. **No floats for money.** Ever.
3. **Every function is total** — no thrown exceptions for expected states. Missing
   CPI, stale rates and empty history return flagged results, not throws. Throws are
   reserved for programmer error (unit mismatch, unimplemented strategy).
4. **Every result that depends on stale or missing data carries a flag** and the UI
   must surface it. An app that displays a confident number derived from a
   three-week-old exchange rate is worse than one that says it does not know.
