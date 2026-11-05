import { formatFeetInches, INCH_FRACTIONS, parseFeetInches } from '@opencalque/core'
import { language, msg } from './i18n'
import { usePrefs } from './prefs'

/**
 * Lengths are stored in millimetres everywhere. This module is the only place that turns them
 * into what the user reads and types, in the unit chosen in Preferences.
 */
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in'

export const UNITS: [unit: Unit, name: string][] = [
  ['mm', msg('Millimetres (mm)')],
  ['cm', msg('Centimetres (cm)')],
  ['m', msg('Metres (m)')],
  ['in', msg('Inches (in)')],
  ['ft', msg('Feet (ft)')],
  ['ft-in', msg('Feet and inches (7\' 6")')],
]

/** The fractions of an inch feet and inches can be rounded to, as their lower number. */
export const FRACTIONS = INCH_FRACTIONS

/** Whether lengths are in feet or inches of any kind, as against metric. */
export const imperialUnit = (of: Unit = unit()) => of === 'in' || of === 'ft' || of === 'ft-in'

// A bare number typed in feet and inches is feet.
const MM_PER: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, 'ft-in': 304.8 }
/** Decimal places shown for each unit: about a millimetre's worth of precision. */
const DECIMALS: Record<Unit, number> = { mm: 0, cm: 1, m: 3, in: 2, ft: 3, 'ft-in': 3 }

export const unit = (): Unit => usePrefs.getState().unit

export const fromMm = (mm: number, to: Unit = unit()) => mm / MM_PER[to]
export const toMm = (value: number, from: Unit = unit()) => value * MM_PER[from]

/** The decimal mark numbers are written with: the one of the preferences, or the language's. */
export function decimalMark(): '.' | ',' {
  const chosen = usePrefs.getState().decimal
  if (chosen !== 'auto') return chosen
  return new Intl.NumberFormat(language()).format(1.5).includes(',') ? ',' : '.'
}

/**
 * A number with at most `decimals` places, written with the decimal mark in use and no digit
 * grouping: the result is also shown in fields, and must read back as a number.
 */
export function formatDecimal(value: number, decimals: number, minimum = 0): string {
  const text = new Intl.NumberFormat('en', { maximumFractionDigits: decimals, minimumFractionDigits: minimum, useGrouping: false }).format(value)
  return decimalMark() === ',' ? text.replace('.', ',') : text
}

/** A length as a number in the current unit, written with the decimal mark in use, without the unit. */
export function formatNumber(mm: number, decimals = DECIMALS[unit()]): string {
  // Feet and inches are not a number with a unit after it: they are written whole, marks included,
  // and read back by `parseLength`.
  if (unit() === 'ft-in') return formatFeetInches(mm, usePrefs.getState().fraction)
  return formatDecimal(fromMm(mm), decimals)
}

/** An angle in degrees, to a hundredth (or to `decimals` places), with the decimal mark in use: never a length, whatever the unit. */
export const formatAngle = (degrees: number, decimals = 2): string => formatDecimal(degrees, decimals)

/** An area in mm², in square metres, or in square feet when lengths are in feet or inches, with its unit and two decimals at most. */
export const formatArea = (mm2: number): string => (imperialUnit() ? `${formatDecimal(mm2 / 92903.04, 2)} ft²` : `${formatDecimal(mm2 / 1e6, 2)} m²`)

/**
 * How a new drawing writes its numbers, as the user reads them: in feet, with a decimal comma, each
 * only when so. What is placed in it then follows the drawing (File › Drawing settings).
 */
export const newDrawingSettings = (): { system?: 'imperial'; decimal?: ',' } => ({ ...(imperialUnit() ? { system: 'imperial' } : {}), ...(decimalMark() === ',' ? { decimal: ',' } : {}) })

/** A length with its unit, e.g. "5.02 m". */
export const formatLength = (mm: number) => (unit() === 'ft-in' ? formatNumber(mm) : `${formatNumber(mm)} ${unit()}`)

/** What is written after a length typed on its own in the current unit: nothing for feet and inches, which carry their marks. */
export const unitSuffix = () => (unit() === 'ft-in' ? '' : unit())

/** Reads a number typed by the user, accepting a comma or a point as the decimal mark. */
export function parseNumber(text: string): number {
  const trimmed = text.trim().replace(',', '.')
  return trimmed === '' ? NaN : Number(trimmed)
}

const SUFFIX: Record<string, Unit> = { mm: 'mm', cm: 'cm', m: 'm', in: 'in', '"': 'in', ft: 'ft', "'": 'ft' }

/**
 * A length typed by the user, in millimetres, or null when it is not one. A bare number is in the
 * current unit; a unit can be written after it to override that ("350 cm", "3.5m", "12 ft"), and
 * feet and inches are read however they are written (7'6", 7' 6 1/2").
 */
export function parseLength(text: string): number | null {
  // Feet and inches in any of the ways they are written, whatever the unit in use; when that unit
  // is feet and inches, "7 6" and "7-6" too. A bare number falls through, and is in the unit in use.
  const imperial = parseFeetInches(text, unit() === 'ft-in')
  if (imperial !== null && !/^\s*-?\d+(?:[.,]\d+)?\s*(?:in|ft|"|')?\s*$/i.test(text)) return imperial
  const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|ft|"|')?\s*$/i.exec(text)
  if (!match) return null
  const value = toMm(Number(match[1].replace(',', '.')), match[2] ? SUFFIX[match[2].toLowerCase()] : unit())
  return Number.isFinite(value) ? value : null
}
