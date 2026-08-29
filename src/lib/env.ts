/**
 * The one place in the codebase that reads `process.env`.
 *
 * Parsing happens at module load, so an app that boots is an app whose
 * environment is valid. Anything importing this gets a fully typed object.
 */

import { type Env, parseEnv } from './env.schema'

export type { Env } from './env.schema'

export const env: Env = parseEnv(process.env)
