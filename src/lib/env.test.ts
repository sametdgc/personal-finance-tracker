import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.schema'

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@host/db?sslmode=require',
}

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    expect(parseEnv(valid).DATABASE_URL).toBe(valid.DATABASE_URL)
  })

  it('applies the documented default for FX_API_BASE', () => {
    expect(parseEnv(valid).FX_API_BASE).toBe('https://api.frankfurter.app')
  })

  it('fails loudly and names the missing variable', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/)
  })
})
