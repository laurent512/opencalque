import { language, msg } from './i18n'
import { usePrefs } from './prefs'

/**
 * Lengths are stored in millimetres everywhere. This module is the only place that turns them
 * into what the user reads and types, in the unit chosen in Preferences.
 */
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export const UNITS: [unit: Unit, name: string][] = [
  ['mm', msg('Millimetres (mm)')],
  ['cm', msg('Centimetres (cm)')],
  ['m', msg('Metres (m)')],
  ['in', msg('Inches (in)')],
  ['ft', msg('Feet (ft)')],
]

const MM_PER: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }
/** Decimal places shown for each unit: about a millimetre's worth of precision. */
const DECIMALS: Record<Unit, number> = { mm: 0, cm: 1, m: 3, in: 2, ft: 3 }

export const unit = (): Unit => usePrefs.getState().unit

export const fromMm = (mm: number, to: Unit = unit()) => mm / MM_PER[to]
export const toMm = (value: number, from: Unit = unit()) => value * MM_PER[from]

/** A length as a number in the current unit, written the way the user's language writes numbers, without the unit. */
export function formatNumber(mm: number, decimals = DECIMALS[unit()]): string {
  // No digit grouping: the result is also shown in fields, and must read back as a number.
  return new Intl.NumberFormat(language(), { maximumFractionDigits: decimals, useGrouping: false }).format(fromMm(mm))
}

/** A length with its unit, e.g. "5.02 m". */
export const formatLength = (mm: number) => `${formatNumber(mm)} ${unit()}`

/** Reads a number typed by the user, accepting a comma or a point as the decimal sign. */
export function parseNumber(text: string): number {
  const trimmed = text.trim().replace(',', '.')
  return trimmed === '' ? NaN : Number(trimmed)
}

const SUFFIX: Record<string, Unit> = { mm: 'mm', cm: 'cm', m: 'm', in: 'in', '"': 'in', ft: 'ft', "'": 'ft' }

/**
 * A length typed by the user, in millimetres, or null when it is not one. A bare number is in the
 * current unit; a unit can be written after it to override that ("350 cm", "3.5m", "12 ft").
 */
export function parseLength(text: string): number | null {
  const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|ft|"|')?\s*$/i.exec(text)
  if (!match) return null
  const value = toMm(Number(match[1].replace(',', '.')), match[2] ? SUFFIX[match[2].toLowerCase()] : unit())
  return Number.isFinite(value) ? value : null
}
