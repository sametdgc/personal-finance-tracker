/**
 * Pusula — database schema.
 *
 * Invariants encoded here (see docs/03-domain-model.md):
 *   1. Every user-owned table carries userId.
 *   2. All money is bigint minor units. Never numeric, never float.
 *   3. Rates and CPI values are numeric, read as strings at this boundary.
 *   4. Percentages are integer basis points.
 */

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const unitCode = pgEnum('unit_code', ['TRY', 'USD', 'EUR', 'XAU_G'])

export const accountKind = pgEnum('account_kind', [
  'cash',
  'deposit',
  'brokerage',
  'physical',
])

export const txType = pgEnum('tx_type', [
  'income',
  'expense',
  'transfer',
  'adjustment',
])

export const txSource = pgEnum('tx_source', [
  'manual',
  'csv',
  'telegram',
  'reconciliation',
])

export const categoryKind = pgEnum('category_kind', ['income', 'expense'])

export const valuationStrategy = pgEnum('valuation_strategy', [
  'ledger_fold',
  'fx_converted',
  'manual_snapshot',
  'sum_of_holdings', // v2 extension point — not implemented in core/valuation.ts
])

export const jobStatus = pgEnum('job_status', ['running', 'succeeded', 'failed'])

// ---------------------------------------------------------------------------
// Auth — owned by Better Auth. Keep its generated tables in sync; do not
// hand-edit columns it manages. `users.id` is the FK target for everything below.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Policy — the user's stated rules. The only place the app has "opinions",
// and they are the user's opinions.
// ---------------------------------------------------------------------------

export const policy = pgTable('policy', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),

  baseCurrency: unitCode('base_currency').notNull().default('TRY'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  locale: text('locale').notNull().default('tr-TR'),
  cpiRegion: text('cpi_region').notNull().default('TR'),

  /** Day of month the financial period starts. 1..28. */
  monthStartDay: integer('month_start_day').notNull().default(1),

  /** Emergency floor expressed in months of essential expenses. */
  emergencyFloorMonths: numeric('emergency_floor_months', {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default('3'),

  /** Extra headroom held back from safe-to-spend, in base minor units. */
  spendingBufferMinor: bigint('spending_buffer_minor', { mode: 'bigint' })
    .notNull()
    .default(0n),

  /** Drift below this is considered on-target. 300 = 3%. */
  driftToleranceBps: integer('drift_tolerance_bps').notNull().default(300),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Buckets — the allocation unit. Valuation is a strategy field, NOT a
// hardcoded branch. This is what makes per-instrument tracking additive later.
// ---------------------------------------------------------------------------

export const buckets = pgTable(
  'buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    strategy: valuationStrategy('strategy').notNull(),

    /** Target share of net worth, basis points. Non-floor buckets should sum to 10000. */
    targetBps: integer('target_bps').notNull().default(0),

    /** Hard constraint, filled before any target allocation. At most one per user. */
    isEmergencyFloor: boolean('is_emergency_floor').notNull().default(false),

    /** Whether funds here count toward safe-to-spend. Gold and investments do not. */
    isLiquid: boolean('is_liquid').notNull().default(false),

    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('buckets_user_idx').on(t.userId)],
)

/**
 * Timestamped bucket value. User-asserted for manual_snapshot buckets;
 * computed and written by Month Close for the others so history is queryable
 * without replaying every rate.
 */
export const bucketValuations = pgTable(
  'bucket_valuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucketId: uuid('bucket_id')
      .notNull()
      .references(() => buckets.id, { onDelete: 'cascade' }),

    valuedOn: date('valued_on').notNull(),
    valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
    unit: unitCode('unit').notNull(),
    isManual: boolean('is_manual').notNull().default(true),
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bucket_valuations_unique').on(t.bucketId, t.valuedOn),
    index('bucket_valuations_user_idx').on(t.userId, t.valuedOn),
  ],
)

// ---------------------------------------------------------------------------
// Accounts — a container holding exactly one unit.
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucketId: uuid('bucket_id').references(() => buckets.id, {
      onDelete: 'set null',
    }),

    name: text('name').notNull(),
    kind: accountKind('kind').notNull(),
    unit: unitCode('unit').notNull(),

    /** Balance at openedOn, so we don't need every historical transaction. */
    openingBalanceMinor: bigint('opening_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(0n),
    openedOn: date('opened_on').notNull(),

    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),

    /** Soft delete. History must survive. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),

    /** Essential expenses define what the emergency floor is measured in. */
    isEssential: boolean('is_essential').notNull().default(false),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('categories_user_name').on(t.userId, t.name)],
)

// ---------------------------------------------------------------------------
// Transactions — append-only flow record.
//
// rateToBase / baseAmountMinor are the SNAPSHOT. Written on insert, never
// updated, never recomputed against today's rates.
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),

    type: txType('type').notNull(),

    /** Native amount. Signed: negative for outflow. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    unit: unitCode('unit').notNull(),

    /** Rate snapshot at occurredOn. 1 unit = rateToBase base units. */
    rateToBase: numeric('rate_to_base', { precision: 20, scale: 8 }).notNull(),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),

    occurredOn: date('occurred_on').notNull(),

    /** Both legs of a transfer share this. */
    transferGroupId: uuid('transfer_group_id'),

    source: txSource('source').notNull().default('manual'),

    /** Idempotent CSV import: hash of (account, date, amount, description). */
    dedupeHash: text('dedupe_hash'),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_user_date_idx').on(t.userId, t.occurredOn),
    index('transactions_account_date_idx').on(t.accountId, t.occurredOn),
    index('transactions_transfer_idx').on(t.transferGroupId),
    uniqueIndex('transactions_dedupe').on(t.userId, t.dedupeHash),
  ],
)

// ---------------------------------------------------------------------------
// Reconciliations — "my account actually has X".
// Writing one also writes an `adjustment` transaction for the delta.
// The sum of those adjustments IS the unaccounted-drift metric.
// ---------------------------------------------------------------------------

export const reconciliations = pgTable(
  'reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),

    assertedBalanceMinor: bigint('asserted_balance_minor', {
      mode: 'bigint',
    }).notNull(),
    ledgerBalanceMinor: bigint('ledger_balance_minor', { mode: 'bigint' }).notNull(),
    deltaMinor: bigint('delta_minor', { mode: 'bigint' }).notNull(),
    unit: unitCode('unit').notNull(),

    /** The adjustment transaction this produced. */
    adjustmentTxId: uuid('adjustment_tx_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),

    occurredOn: date('occurred_on').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reconciliations_account_idx').on(t.accountId, t.occurredOn)],
)

// ---------------------------------------------------------------------------
// Recurring rules — expanded forward at read time, never materialised early.
// ---------------------------------------------------------------------------

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),

    name: text('name').notNull(),
    type: txType('type').notNull(),

    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    unit: unitCode('unit').notNull(),

    /** RFC 5545 RRULE, e.g. FREQ=MONTHLY;BYMONTHDAY=15 */
    rrule: text('rrule').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recurring_rules_user_idx').on(t.userId, t.isActive)],
)

// ---------------------------------------------------------------------------
// Month closes — immutable period snapshots.
// ---------------------------------------------------------------------------

export const monthCloses = pgTable(
  'month_closes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Always the first day of the period. */
    period: date('period').notNull(),

    projectedIncomeMinor: bigint('projected_income_minor', { mode: 'bigint' }).notNull(),
    actualIncomeMinor: bigint('actual_income_minor', { mode: 'bigint' }).notNull(),
    projectedExpenseMinor: bigint('projected_expense_minor', {
      mode: 'bigint',
    }).notNull(),
    actualExpenseMinor: bigint('actual_expense_minor', { mode: 'bigint' }).notNull(),
    unaccountedDriftMinor: bigint('unaccounted_drift_minor', {
      mode: 'bigint',
    }).notNull(),

    /** May be negative. Say so plainly; do not clamp. */
    surplusMinor: bigint('surplus_minor', { mode: 'bigint' }).notNull(),

    netWorthNominalMinor: bigint('net_worth_nominal_minor', {
      mode: 'bigint',
    }).notNull(),
    netWorthRealMinor: bigint('net_worth_real_minor', { mode: 'bigint' }).notNull(),
    cpiIndexUsed: numeric('cpi_index_used', { precision: 12, scale: 4 }),

    /** The Compass recommendation at close time, for the historical record. */
    allocation: jsonb('allocation').notNull(),

    /** Reopening voids rather than edits. */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('month_closes_user_period').on(t.userId, t.period)],
)

// ---------------------------------------------------------------------------
// Market data — global, not user-scoped.
// ---------------------------------------------------------------------------

export const marketRates = pgTable(
  'market_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    base: unitCode('base').notNull(),
    quote: unitCode('quote').notNull(),
    asOf: date('as_of').notNull(),
    /** 1 quote = rate base. Pick one direction and keep it. */
    rate: numeric('rate', { precision: 20, scale: 8 }).notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('market_rates_unique').on(t.base, t.quote, t.asOf)],
)

export const cpiSeries = pgTable(
  'cpi_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    region: text('region').notNull(),
    /** Always the first day of the month. */
    period: date('period').notNull(),
    indexValue: numeric('index_value', { precision: 12, scale: 4 }).notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cpi_series_unique').on(t.region, t.period)],
)

// ---------------------------------------------------------------------------
// Jobs — idempotency by unique constraint, not by convention.
// ---------------------------------------------------------------------------

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    /** e.g. "2026-08-30" for daily, "2026-08" for monthly. */
    periodKey: text('period_key').notNull(),

    status: jobStatus('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    error: jsonb('error'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('job_runs_unique').on(t.jobName, t.periodKey)],
)

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull().unique(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('telegram_links_user_idx').on(t.userId)],
)

/** Telegram sends retries. Dedupe on update_id so we never double-log. */
export const telegramUpdates = pgTable('telegram_updates', {
  updateId: bigint('update_id', { mode: 'bigint' }).primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Learned phrase -> category map for Telegram quick-logging. No ML needed. */
export const categoryHints = pgTable(
  'category_hints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phrase: text('phrase').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    hitCount: integer('hit_count').notNull().default(1),
  },
  (t) => [uniqueIndex('category_hints_unique').on(t.userId, t.phrase)],
)

/** Cooldown tracking so a persistent condition doesn't nudge daily. */
export const nudgeLog = pgTable(
  'nudge_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('nudge_log_user_kind').on(t.userId, t.kind, t.sentAt)],
)
