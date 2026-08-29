/**
 * Money — exact arithmetic on integer minor units.
 *
 * PURE MODULE. No I/O, no framework imports.
 *
 * This is the foundation of the entire app. Rules:
 *   - Money is always { amount: bigint, unit: UnitCode }. Never a float.
 *   - add/sub THROW on unit mismatch. A silent currency mix is the worst
 *     possible failure mode in a finance app; fail loudly.
 *   - This is the ONLY module allowed to perform decimal multiplication.
 *   - Rounding is half-even (banker's). Unbiased over many operations,
 *     unlike half-up which drifts upward. See docs/08-decisions.md D10.
 *
 * See docs/04-financial-logic.md §1 for the required test cases.
 */

import { type UnitCode, unitDef, unitFactor } from './units'

export type Money = {
  readonly amount: bigint
  readonly unit: UnitCode
}

/** Wire form. bigint does not survive the RSC boundary or JSON. */
export type MoneyWire = {
  readonly amount: string
  readonly unit: UnitCode
}

/** Rates are stored with 8 decimal places. Fixed-point, never float. */
export const RATE_SCALE = 8
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE)

export class UnitMismatchError extends Error {
  constructor(a: UnitCode, b: UnitCode) {
    super(`Cannot combine ${a} with ${b}. Convert explicitly first.`)
    this.name = 'UnitMismatchError'
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function money(amount: bigint, unit: UnitCode): Money {
  return { amount, unit }
}

export function zero(unit: UnitCode): Money {
  return { amount: 0n, unit }
}

/**
 * Parse user input like "1.234,56" (tr-TR) or "1234.56" into minor units.
 * Rejects anything with more decimals than the unit's scale rather than
 * silently truncating the user's money.
 */
export function parseMoney(input: string, unit: UnitCode): Money {
  const scale = unitDef(unit).scale
  const cleaned = input.trim().replace(/\s/g, '')
  if (cleaned === '') throw new Error('Empty money input')

  // Treat the last separator as the decimal point; strip the rest as grouping.
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  const decimalPos = Math.max(lastComma, lastDot)

  let intPart: string
  let fracPart: string
  if (decimalPos === -1) {
    intPart = cleaned.replace(/[.,]/g, '')
    fracPart = ''
  } else {
    intPart = cleaned.slice(0, decimalPos).replace(/[.,]/g, '')
    fracPart = cleaned.slice(decimalPos + 1)
  }

  const negative = intPart.startsWith('-')
  if (negative) intPart = intPart.slice(1)

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`Invalid money input: ${input}`)
  }
  if (fracPart.length > scale) {
    throw new Error(`${unit} supports ${scale} decimal places, got ${fracPart.length}`)
  }

  const padded = fracPart.padEnd(scale, '0')
  const amount = BigInt((intPart || '0') + padded)
  return { amount: negative ? -amount : amount, unit }
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

function assertSameUnit(a: Money, b: Money): void {
  if (a.unit !== b.unit) throw new UnitMismatchError(a.unit, b.unit)
}

export function add(a: Money, b: Money): Money {
  assertSameUnit(a, b)
  return { amount: a.amount + b.amount, unit: a.unit }
}

export function sub(a: Money, b: Money): Money {
  assertSameUnit(a, b)
  return { amount: a.amount - b.amount, unit: a.unit }
}

export function sum(items: readonly Money[], unit: UnitCode): Money {
  let total = 0n
  for (const m of items) {
    if (m.unit !== unit) throw new UnitMismatchError(unit, m.unit)
    total += m.amount
  }
  return { amount: total, unit }
}

export function neg(m: Money): Money {
  return { amount: -m.amount, unit: m.unit }
}

export function abs(m: Money): Money {
  return { amount: m.amount < 0n ? -m.amount : m.amount, unit: m.unit }
}

/** -1 | 0 | 1 */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameUnit(a, b)
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
}

export function isZero(m: Money): boolean {
  return m.amount === 0n
}

export function isNegative(m: Money): boolean {
  return m.amount < 0n
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b
}

// ---------------------------------------------------------------------------
// Rounding — half-even, on a bigint quotient.
// ---------------------------------------------------------------------------

/**
 * Divide `numerator` by `denominator` with banker's rounding.
 * Both may be negative; rounding is symmetric about zero.
 */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero')

  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator

  const q = n / d
  const r = n % d
  const twice = r * 2n

  let result: bigint
  if (twice > d) result = q + 1n
  else if (twice < d) result = q
  else result = q % 2n === 0n ? q : q + 1n // exact .5 -> round to even

  return negative ? -result : result
}

// ---------------------------------------------------------------------------
// Rate conversion — the only decimal multiplication in the codebase.
// ---------------------------------------------------------------------------

/**
 * A rate as fixed-point integer with RATE_SCALE decimal places.
 * `fromRateString("32.15")` -> 3215000000n
 */
export function fromRateString(rate: string): bigint {
  const [intPart = '0', fracPart = ''] = rate.trim().split('.')
  if (fracPart.length > RATE_SCALE) {
    // Truncating a rate is acceptable; storing more precision than we declare
    // is not. Round rather than silently drop.
    const keep = fracPart.slice(0, RATE_SCALE)
    const nextDigit = Number(fracPart[RATE_SCALE])
    const base = BigInt(intPart + keep)
    return nextDigit >= 5 ? base + 1n : base
  }
  return BigInt(intPart + fracPart.padEnd(RATE_SCALE, '0'))
}

export function toRateString(rate: bigint): string {
  const negative = rate < 0n
  const abs = negative ? -rate : rate
  const int = abs / RATE_FACTOR
  const frac = (abs % RATE_FACTOR).toString().padStart(RATE_SCALE, '0')
  return `${negative ? '-' : ''}${int}.${frac}`
}

/**
 * Convert money into `targetUnit` at `rate` (fixed-point, RATE_SCALE decimals),
 * where 1 source unit = rate target units.
 *
 * Handles differing scales between the two units, e.g. XAU_G (4dp) -> TRY (2dp).
 */
export function convert(m: Money, targetUnit: UnitCode, rate: bigint): Money {
  if (m.unit === targetUnit) return m

  const sourceFactor = unitFactor(m.unit)
  const targetFactor = unitFactor(targetUnit)

  // amount / sourceFactor * (rate / RATE_FACTOR) * targetFactor
  const numerator = m.amount * rate * targetFactor
  const denominator = sourceFactor * RATE_FACTOR

  return { amount: divRoundHalfEven(numerator, denominator), unit: targetUnit }
}

/** Multiply by a plain fixed-point ratio, keeping the same unit. */
export function mulRatio(m: Money, ratio: bigint): Money {
  return { amount: divRoundHalfEven(m.amount * ratio, RATE_FACTOR), unit: m.unit }
}

/** Multiply by integer basis points. 300 bps = 3%. */
export function mulBps(m: Money, bps: number): Money {
  return { amount: divRoundHalfEven(m.amount * BigInt(bps), 10000n), unit: m.unit }
}

// ---------------------------------------------------------------------------
// Allocation — largest remainder. Parts ALWAYS sum exactly to the whole.
// ---------------------------------------------------------------------------

/**
 * Split `m` across `weights` such that the parts sum exactly to `m`.
 *
 * Naive implementations lose or invent a kuruş here. This one does not:
 * floor-divide first, then distribute the remainder one minor unit at a time
 * to the largest fractional remainders.
 *
 * Used by the Compass solver, where sum-to-surplus is an invariant.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return []
  if (weights.some((w) => w < 0)) throw new Error('Negative weight in allocate()')

  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight === 0) {
    // No signal — put everything in the first slot rather than dropping it.
    return weights.map((_, i) =>
      i === 0 ? { amount: m.amount, unit: m.unit } : zero(m.unit),
    )
  }

  // Scale weights to integers to keep the division exact.
  const scaled = weights.map((w) => BigInt(Math.round((w / totalWeight) * 1e9)))
  const scaledTotal = scaled.reduce((a, b) => a + b, 0n)

  const parts: bigint[] = []
  const remainders: { index: number; rem: bigint }[] = []
  let distributed = 0n

  for (let i = 0; i < scaled.length; i++) {
    const numerator = m.amount * (scaled[i] ?? 0n)
    const q = numerator / scaledTotal
    const rem = numerator % scaledTotal
    parts.push(q)
    remainders.push({ index: i, rem: rem < 0n ? -rem : rem })
    distributed += q
  }

  let leftover = m.amount - distributed
  const step = leftover < 0n ? -1n : 1n
  remainders.sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.index - b.index))

  let i = 0
  while (leftover !== 0n) {
    const target = remainders[i % remainders.length]
    if (target) parts[target.index] = (parts[target.index] ?? 0n) + step
    leftover -= step
    i++
  }

  return parts.map((amount) => ({ amount, unit: m.unit }))
}

// ---------------------------------------------------------------------------
// Wire boundary — the ONLY place bigint <-> string conversion happens.
// ---------------------------------------------------------------------------

export function toWire(m: Money): MoneyWire {
  return { amount: m.amount.toString(), unit: m.unit }
}

export function fromWire(w: MoneyWire): Money {
  return { amount: BigInt(w.amount), unit: w.unit }
}

// ---------------------------------------------------------------------------
// Formatting
//
// NOTE: components/money/MoneyDisplay.tsx is the only place in the app that
// calls this. Do not format money anywhere else. See docs/06-conventions.md.
// ---------------------------------------------------------------------------

export function toDecimalString(m: Money): string {
  const def = unitDef(m.unit)
  const factor = unitFactor(m.unit)
  const negative = m.amount < 0n
  const abs = negative ? -m.amount : m.amount
  const int = abs / factor
  const frac = (abs % factor).toString().padStart(def.scale, '0')
  return `${negative ? '-' : ''}${int}${def.scale > 0 ? `.${frac}` : ''}`
}

export function format(
  m: Money,
  opts: { locale?: string; showSymbol?: boolean } = {},
): string {
  const { locale = 'tr-TR', showSymbol = true } = opts
  const def = unitDef(m.unit)
  const value = Number(toDecimalString(m))
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: def.scale,
    maximumFractionDigits: def.scale,
  }).format(value)
  return showSymbol ? `${formatted} ${def.symbol}` : formatted
}
