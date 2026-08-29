# 06 — Conventions

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `any` is banned. Use `unknown` and narrow.
- Prefer `type` over `interface` unless declaration merging is needed.
- Branded types for identifiers: `type UserId = string & { __brand: 'UserId' }`.
  Cheap, and it prevents the classic "passed accountId where bucketId was expected".
- Exhaustive switches with a `never` default:

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`)
}
```

Use it in the valuation-strategy dispatch. When `sum_of_holdings` is added, the
compiler will point at every place that needs updating.

## Naming

- Money-typed variables end in nothing special, but **raw minor-unit numbers end in
  `Minor`** (`amountMinor`). If a variable holds a bigint of minor units and is not
  named `*Minor`, rename it.
- Percentages are `*Bps` (integer basis points) or `*Pct` (decimal fraction). Never
  ambiguous.
- Dates: `*At` for instants (timestamptz), `*On` / `*Date` for calendar dates.
- Query functions: `getX`, `listX`, `createX`, `updateX`, `deleteX`. All take
  `userId` first.

## Server Actions

Every action goes through `authedAction`:

```ts
export const addTransaction = authedAction
  .input(addTransactionSchema)
  .handler(async ({ input, userId }) => { ... })
```

The wrapper handles: session check, Zod parse, `userId` injection, error mapping to
a typed result, and structured logging. **An action that does not
use the wrapper is a bug.**

Actions are thin. They call a query, call `core/`, call a query, return. Business
logic in an action file means it belongs in `core/` or `server/services/`.

## Error handling

Actions return a discriminated result rather than throwing:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; field?: string } }
```

Expected failures (validation, conflict, stale data) are `ok: false`. Unexpected
failures throw, are logged, and surface a generic message. Never leak an
internal error message to the UI.

## Testing

**`core/` — exhaustive.** This is where the tests matter. Target 100% branch
coverage. Fast, no I/O, no mocks. Property-based tests via `fast-check` for the
things that must hold universally:
- `Money.allocate` parts always sum to the whole
- `solve()` allocations always sum to the surplus
- `toWire`/`fromWire` round-trip

**`db/queries/` — integration, against a real Postgres.** Use a Neon branch or a
throwaway container. Test the scoping: a query with user A's id must never return
user B's row. Write that test even though there is one user.

**Actions — a few smoke tests.** They are thin; do not over-test glue.

**E2E — exactly three flows.** Sign-in → today renders. Quick-add → safe-to-spend
changes. Month close end-to-end. E2E is expensive and brittle; spend it on the
paths whose breakage would ruin your day.

**No mocking of `core/`.** If a test needs to mock the financial engine, the
boundary is wrong.

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- One phase per branch: `phase/05-today`.
- PR description states which acceptance criteria from `docs/05-build-plan.md` are
  met.
- `main` is always deployable.

## CI (GitHub Actions)

On every PR:
1. `pnpm install --frozen-lockfile`
2. `pnpm check` (Biome)
3. `pnpm typecheck`
4. `pnpm test` (Vitest)
5. Migration drift check — `drizzle-kit check` fails if `schema.ts` has changes with
   no generated migration
6. Purity check — fail if anything under `src/core/` imports from `next`, `react`,
   `drizzle-orm`, or `@/db`
7. Playwright on a Neon preview branch (from Phase 10)

On merge to `main`: run migrations, then deploy.

## Formatting money in the UI

Exactly one component formats money: `components/money/MoneyDisplay.tsx`. It takes a
`MoneyWire` and handles locale, symbol placement, sign, and colour. Nothing else in
the codebase calls `Intl.NumberFormat` on a monetary value.

This matters because financial UI has a hundred small conventions (negative in
parentheses or with a minus, symbol before or after, kuruş shown or hidden at scale)
and you want to change them in one place.

## Comments

Comment the *why*, especially for financial decisions: why half-even rounding, why
the Fisher relation, why greedy is optimal here. The `what` is in the type
signatures.

Do not leave commented-out code. Git remembers.
