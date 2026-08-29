# 01 — Product Specification

## Problem

Standard finance apps are backward-looking ledgers. They tell you what you spent.
They do not tell you what you can spend, where the next lira should go, or whether
any of it made you better off in an economy with meaningful inflation and currency
risk.

Pusula answers those three questions from one dataset.

## The core loop

Everything in the system is either a **position** (something held) or a **flow**
(money moving). The three features are three questions asked of that same data, and
they chain:

```
Safe to Spend  →  computes monthly surplus
       ↓
Compass        →  routes surplus to buckets to correct drift
       ↓
(you deploy it)→  positions change
       ↓
Real Terms     →  did purchasing power actually rise?
       ↓
Month Close    →  commit the record, repeat
```

That handoff is the spine of the product. It is why this is one app and not three.

## Platform

Mobile-first responsive web app, installable as a PWA. Not native: nothing here
needs camera, GPS, background location or biometrics, and app-store cycles would
slow iteration for no gain.

A **Telegram bot** is the second surface — outbound nudges and inbound quick
logging. Chosen over WhatsApp because WhatsApp Business API requires a verified
business, a solution provider, pre-approved templates and per-message billing;
Telegram requires a BotFather conversation.

## Surfaces

### ① Today — the daily check-in

The default route. One number in large type: **safe to spend today**.

Below it:
- 90-day forward balance line with the emergency floor drawn across it
- The exact date the projection crosses the floor, if it does
- Upcoming obligations with days-until
- Quick-add transaction

The number reconciles against reality as actual transactions land. It is expected to
drift; that is honest behaviour, not a bug.

### ② Position — real terms

Net worth as two lines on one chart: **nominal** and **inflation-adjusted**, rebased
to a user-chosen date. This is the view that reframes everything — a 40% nominal
gain in a 45% inflation year is a loss.

Below:
- Currency exposure as a percentage of total wealth, regardless of which account
  holds it
- Asset-class breakdown by bucket
- Real return per bucket since acquisition
- Per-account "last reconciled" freshness

### ③ Compass — where the next lira goes

- Target allocation vs actual, drift shown per bucket in both % and absolute
- Given a surplus of X, the split across buckets that moves closest to target
  **without selling anything**
- Emergency floor fills first — it is a hard constraint, not a bucket
- Interactive: drag the surplus amount, watch the split recompute

### ④ Month Close — the ritual

Once per month, a guided flow:

1. Projected vs actual income and expense for the closing month
2. Unaccounted drift for the month (sum of reconciliation adjustments)
3. The surplus
4. Compass's recommended deployment
5. Nominal and real net worth delta
6. Confirm → writes an immutable `month_closes` snapshot

This screen is the product. It is the reason the three features cohere.

### ⑤ Telegram bot

Outbound:
- Month-close reminder on the configured day
- Obligation landing in N days when projected balance would go below floor
- Account stale for >30 days → reconcile nudge

Inbound:
- `250 kahve` → logs a ₺250 expense, category inferred from a learned map
- `/safe` → today's safe-to-spend number
- `/net` → nominal and real net worth
- `/close` → link to the month-close flow

## Hybrid ledger: trust but reconcile

Balances are derived by folding transactions forward. But nobody logs every coffee,
so every account supports a **reconciliation**: assert the real balance, and the app
writes a timestamped balancing adjustment.

Two consequences worth building deliberately:

**Unaccounted drift is a first-class metric.** Adjustments are not errors to hide.
"You have ~₺2,100/month of spending you never log" is one of the most useful numbers
the app can show, and Safe to Spend must reserve for it rather than pretending it is
zero.

**Confidence decays with time.** An account reconciled yesterday is trustworthy; one
last touched six weeks ago is not. Surface `lastReconciledAt` per account and nudge
when stale.

## Buckets, not instruments

Allocation targets are set against **buckets**, each with a valuation strategy:

| Bucket | Asset kind | Valuation strategy |
|---|---|---|
| Emergency cash | TRY cash | `ledger_fold` |
| FX savings | USD / EUR cash | `fx_converted` |
| Gold | XAU grams | `fx_converted` |
| Other investments | mixed | `manual_snapshot` |

"Other investments" is not a special case — it is a bucket whose valuation strategy
is `manual_snapshot`. You periodically assert its value; contributions are ordinary
transfers; Compass routes surplus to it against its target percentage like any other
bucket.

**Extension point:** when per-instrument tracking is wanted, add a `holdings` table
under that bucket and flip its strategy to `sum_of_holdings`. Nothing else in the
schema moves — not transactions, not policy, not the solver.

## Scope

**In (v1):** manual + CSV transaction entry; multi-currency accounts with rate
snapshots; reconciliation; recurring rules; forward projection and safe-to-spend;
buckets, target allocation and surplus solver; nominal vs real net worth; month
close; single-user auth; scheduled market-data jobs; Telegram bot.

**Out (deliberately):** bank/Open Banking APIs, tax modelling, investment
recommendations, per-instrument holdings, households and sharing, receipt OCR,
budgeting-by-envelope (Compass replaces it).

## Default assumptions (config, not structure)

| Setting | Default | Where to change |
|---|---|---|
| Base currency | TRY | `policy.baseCurrency` |
| Tracked units | TRY, USD, EUR, XAU_G | `core/units.ts` |
| CPI region | TR (TÜİK TÜFE) | `policy.cpiRegion` |
| Month starts on | day 1 | `policy.monthStartDay` |
| Emergency floor | 3 months of essential expenses | `policy.emergencyFloorMonths` |
| Drift tolerance | 300 bps | `policy.driftToleranceBps` |
| Locale / timezone | tr-TR, Europe/Istanbul | `policy.timezone` |
