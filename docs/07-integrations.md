# 07 — Integrations

Every external dependency is wrapped in an adapter under `src/server/market/` or
`src/server/telegram/` with a narrow interface, a Zod schema for the response, and a
fixture-based test. Swapping a provider must touch one file.

---

## FX rates

**Interface:**

```ts
interface RateSource {
  name: string
  fetchDaily(date: Date, pairs: Pair[]): Promise<RateQuote[]>
  fetchRange(from: Date, to: Date, pair: Pair): Promise<RateQuote[]>
}
```

**Candidates** (verify current terms before wiring — free-tier policies change):
- **Frankfurter** (`frankfurter.app`) — ECB data, no key, historical range endpoint.
  Good default. ECB publishes once per working day, so weekends carry forward.
- **exchangerate.host** — no key, broader coverage.
- **TCMB** (Turkish central bank) XML — authoritative for TRY, but weekday-only and
  a fiddlier format. Worth adding as a second source later if ECB cross-rates prove
  insufficient.

**Rules:**
- Store as `(base=TRY, quote=USD, asOf, rate)`. Pick one direction and keep it.
  Inverting at read time is fine; storing both directions is not.
- Weekends and holidays have no publication. Carry the last value forward at *read*
  time (`most recent rate at or before asOf`), do not write phantom rows.
- Flag when the carried-forward gap exceeds 7 days.

## Gold

`XAU_G → TRY`. Sources publish troy ounces; **convert: 1 troy oz = 31.1034768 g.**
Put that constant in `core/units.ts` with a comment, not inline in a fetcher.

Turkish "gram altın" market price includes a dealer spread over the pure-metal
calculation. Decide explicitly which you are tracking and write it in
`docs/08-decisions.md` — they differ by a few percent and it will confuse you later.

## CPI / inflation

**TÜİK TÜFE**, monthly, published around the 3rd of the following month.

- Store `(region='TR', period='2026-07-01', indexValue)`. Period is always the first
  of the month as a `date`.
- Publication lag is real: for the current month there is no value. Carry forward and
  mark `provisional`. Surface that state in the UI.
- A manual-entry fallback in settings is worth having — if the scraper breaks, you
  type one number a month rather than losing the feature.
- If a programmatic source proves unreliable, monthly manual entry is an acceptable
  v1: it is twelve numbers a year.

## Job wiring

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/fx",       "schedule": "0 6 * * *" },
    { "path": "/api/cron/gold",     "schedule": "0 6 * * *" },
    { "path": "/api/cron/cpi",      "schedule": "0 7 3 * *" },
    { "path": "/api/cron/nudges",   "schedule": "0 9 * * *" }
  ]
}
```

Every handler:

```ts
1. verify CRON_SECRET (constant-time compare) else 401
2. compute periodKey
3. INSERT INTO job_runs (jobName, periodKey, status='running')
   ON CONFLICT DO NOTHING  -- returns 0 rows if already run
4. if 0 rows affected -> return { skipped: true }
5. do the work
6. UPDATE job_runs status, finishedAt
7. on error: UPDATE status='failed', error; log it; return 500
```

**Backfill:** each job also exposes a range mode so a gap is recoverable without a
one-off script. Missing periods are detected by comparing `job_runs` against the
expected calendar.

---

## Telegram

### Setup
1. BotFather → `/newbot` → token into `TELEGRAM_BOT_TOKEN`
2. Generate a random `TELEGRAM_WEBHOOK_SECRET`
3. `setWebhook` with `secret_token` set to that value

### Webhook security
- Verify the `X-Telegram-Bot-Api-Secret-Token` header **before parsing the body**.
  Wrong or missing → 401, no work done.
- Deduplicate on Telegram's `update_id` — retries are normal and must not double-log
  a transaction.
- Rate-limit per `chat_id`.
- Always return 200 quickly on handled updates; a non-200 causes Telegram to retry.

### Linking
Settings page generates a one-time code with a short TTL. User sends
`/link ABC123`. Handler resolves the code to a `userId`, writes `telegram_links`,
burns the code. **Messages from unlinked chats are rejected**, not queued.

### Commands

| Input | Behaviour |
|---|---|
| `250 kahve` | Expense, ₺250, category inferred from `kahve`. Reply with what was logged and an undo button. |
| `250 usd kahve` | Same, unit parsed |
| `+15000 maaş` | Income |
| `/safe` | Today's safe-to-spend, plus days until next income |
| `/net` | Nominal and real net worth |
| `/close` | Deep link to the month-close flow |
| `/link CODE` | Account linking |
| `/help` | Command list |

### Category inference
A simple learned map: `phrase → categoryId`, updated whenever the user confirms or
corrects. On low confidence, reply with inline buttons offering the top three
categories. No ML; a dictionary that learns from corrections is sufficient and
debuggable.

### Outbound nudges
Sent from the `nudges` cron job, not inline from user requests:
- Month-close reminder on `policy.monthStartDay`
- Floor-breach warning when the projection crosses the floor within 14 days
- Stale-account reminder at 30 days since last reconciliation

Each nudge type has a cooldown so a persistent condition does not send daily.
Store `last_sent_at` per nudge type per user.

### Never send
Amounts to an unlinked chat. Full account details. Anything on webhook parse
failure. When in doubt, send less.
