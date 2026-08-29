/**
 * The environment schema and its parser.
 *
 * Deliberately side-effect free so it can be unit-tested. `env.ts` is the module
 * that actually reads `process.env`, and it is the only one in the codebase
 * allowed to (docs/02-architecture.md §Environment & config).
 *
 * Phase 0 requires only DATABASE_URL. Later phases move their variables out of
 * the optional block as they start depending on them.
 */

import { z } from 'zod'

/**
 * An unset variable does not always arrive as `undefined`. Vercel and GitHub
 * Actions both hand a declared-but-empty variable to the process as `''`, which
 * would otherwise sail past `.optional()` and then fail the inner check. Treat
 * blank as absent so defaults and optionality behave the way the schema reads.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema)

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, 'required — copy .env.example to .env and fill it in')
    .url('must be a postgres connection URL'),

  // --- Not yet required; see docs/05-build-plan.md -------------------------
  BETTER_AUTH_SECRET: blankAsUndefined(z.string().optional()),
  BETTER_AUTH_URL: blankAsUndefined(z.string().url().optional()),
  CRON_SECRET: blankAsUndefined(z.string().optional()),
  TELEGRAM_BOT_TOKEN: blankAsUndefined(z.string().optional()),
  TELEGRAM_WEBHOOK_SECRET: blankAsUndefined(z.string().optional()),
  FX_API_BASE: blankAsUndefined(z.string().url().default('https://api.frankfurter.app')),
  GOLD_API_KEY: blankAsUndefined(z.string().optional()),
})

export type Env = z.infer<typeof envSchema>

/**
 * Throws with every problem listed at once, named. A boot failure should tell you
 * what to fix, not that something somewhere was undefined.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source)

  if (parsed.success) return parsed.data

  const lines = parsed.error.issues.map(
    (issue) => `  ✗ ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  )

  throw new Error(
    ['Invalid environment configuration:', ...lines, '', 'See .env.example.'].join('\n'),
  )
}
