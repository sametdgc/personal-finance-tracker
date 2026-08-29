/**
 * CI guard: src/core/ must stay pure.
 *
 * An accidental I/O import here is the one architectural mistake in this project
 * that would be genuinely painful to undo later, so it fails the build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN = [
  'next',
  'next/',
  'react',
  'react-dom',
  'drizzle-orm',
  'postgres',
  'better-auth',
  '@/db',
  '@/server',
  '@/app',
  '@/components',
  'node:fs',
  'node:http',
]

const CORE = 'src/core'
const violations = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue

    const src = readFileSync(full, 'utf8')
    const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRe.exec(src)) !== null) {
      const spec = match[1]
      if (FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) {
        violations.push(`${full}: imports "${spec}"`)
      }
    }
  }
}

walk(CORE)

if (violations.length > 0) {
  console.error('\nsrc/core/ must be pure. See CLAUDE.md rule 3.\n')
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error('')
  process.exit(1)
}

console.log('✓ src/core/ is pure')
