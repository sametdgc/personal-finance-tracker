/**
 * Unit registry.
 *
 * A "unit" is what an amount is denominated in. Not all units are currencies —
 * gold is tracked in grams and behaves identically everywhere else in the system.
 *
 * PURE MODULE. No I/O, no framework imports. See CLAUDE.md rule 3.
 */

export const UNIT_CODES = ['TRY', 'USD', 'EUR', 'XAU_G'] as const
export type UnitCode = (typeof UNIT_CODES)[number]

export type UnitKind = 'currency' | 'commodity'

export type UnitDef = {
  readonly code: UnitCode
  readonly kind: UnitKind
  /** Decimal places in the minor-unit representation. */
  readonly scale: number
  readonly symbol: string
  readonly label: string
}

export const UNITS: Readonly<Record<UnitCode, UnitDef>> = {
  TRY: { code: 'TRY', kind: 'currency', scale: 2, symbol: '₺', label: 'Türk Lirası' },
  USD: { code: 'USD', kind: 'currency', scale: 2, symbol: '$', label: 'US Dollar' },
  EUR: { code: 'EUR', kind: 'currency', scale: 2, symbol: '€', label: 'Euro' },
  XAU_G: {
    code: 'XAU_G',
    kind: 'commodity',
    scale: 4,
    symbol: 'g',
    label: 'Gold (gram)',
  },
} as const

/**
 * Troy ounce to gram. Market sources quote gold per troy ounce; we store grams.
 * This constant lives here rather than inline in a fetcher so there is exactly
 * one of it. See docs/07-integrations.md.
 */
export const GRAMS_PER_TROY_OUNCE = 31.1034768

export function isUnitCode(value: string): value is UnitCode {
  return (UNIT_CODES as readonly string[]).includes(value)
}

export function unitDef(code: UnitCode): UnitDef {
  return UNITS[code]
}

/** 10 ** scale, as a bigint. Used by every conversion in money.ts. */
export function unitFactor(code: UnitCode): bigint {
  return 10n ** BigInt(UNITS[code].scale)
}
