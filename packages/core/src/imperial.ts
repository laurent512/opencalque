/**
 * Lengths the way they are written on American plans: feet and inches, with the part of an inch
 * as a fraction (7' 6 1/2"). Everything is stored in millimetres; this is only how a length is
 * read and typed.
 */

const MM_PER_INCH = 25.4

/** The fractions of an inch a length can be rounded to: halves down to thirty-seconds. */
export const INCH_FRACTIONS = [2, 4, 8, 16, 32] as const

/**
 * A length in millimetres as feet and inches, rounded to the nearest 1/`denominator` of an inch:
 * 7' 6 1/2", 7' 0", 6 1/2" (under a foot, the feet are left out), -3' 2".
 */
export function formatFeetInches(mm: number, denominator = 16): string {
  // A length typed as 3 5/8" is stored in millimetres and comes back a hair off (3.4999999999999996
  // quarters), so ties would round either way by luck. Snapping off that error first makes every
  // length exactly half-way round up, as a drafter does.
  const units = (Math.abs(mm) / MM_PER_INCH) * denominator
  const parts = Math.round(Math.round(units * 1e6) / 1e6)
  if (parts === 0) return '0"'
  const feet = Math.floor(parts / (12 * denominator))
  const rest = parts - feet * 12 * denominator
  const inches = Math.floor(rest / denominator)
  let over = rest - inches * denominator
  // The fraction in its lowest terms: 8/16 is 1/2.
  let under = denominator
  while (over > 0 && over % 2 === 0) {
    over /= 2
    under /= 2
  }
  const fraction = over > 0 ? `${over}/${under}` : ''
  const whole = fraction ? (inches > 0 || feet > 0 ? `${inches} ${fraction}` : fraction) : String(inches)
  const sign = mm < 0 ? '-' : ''
  return `${sign}${feet > 0 ? `${feet}' ` : ''}${whole}"`
}

/**
 * Reads a length written in feet and inches, in millimetres, or null when it is not one. It is
 * forgiving about how: 7'6", 7' 6 1/2", 7 ft 6 in, 7'-6", 7', 6", 6 1/2", 1/2". Without marks
 * (`unmarked`), 7-6 and "7 6" are feet then inches as well; that is for when the user's unit is
 * feet and inches, where a bare 7.5 means feet and is not read here.
 */
export function parseFeetInches(text: string, unmarked = false): number | null {
  const trimmed = text.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/,/g, '.')
  const number = String.raw`\d+(?:\.\d+)?`
  const fraction = String.raw`(\d+)\s*/\s*(\d+)`
  const inches = String.raw`(?:(${number})(?:\s+${fraction})?|${fraction})\s*(?:"|in\b|inch(?:es)?\b)?`
  const marked = new RegExp(String.raw`^(-)?\s*(?:(${number})\s*(?:'|ft\b|feet\b|foot\b)\s*-?\s*)?(?:${inches})?$`, 'i').exec(trimmed)
  // With marks, at least one of them has to be there: a bare number is not feet and inches.
  if (marked && /['"]|ft|feet|foot|in\b|inch|\//i.test(trimmed)) {
    const [, minus, feet, whole, over, under, loneOver, loneUnder] = marked
    if (feet === undefined && whole === undefined && loneOver === undefined) return null
    const top = Number(over ?? loneOver ?? 0)
    const bottom = Number(under ?? loneUnder ?? 1)
    if (bottom === 0) return null
    const total = Number(feet ?? 0) * 12 + Number(whole ?? 0) + top / bottom
    return (minus ? -1 : 1) * total * MM_PER_INCH
  }
  if (unmarked) {
    const pair = new RegExp(String.raw`^(-)?\s*(\d+)\s*[-\s]\s*(${number})(?:\s+${fraction})?$`).exec(trimmed)
    if (pair) {
      const [, minus, feet, whole, over, under] = pair
      if (under !== undefined && Number(under) === 0) return null
      const total = Number(feet) * 12 + Number(whole) + (over ? Number(over) / Number(under) : 0)
      return (minus ? -1 : 1) * total * MM_PER_INCH
    }
  }
  return null
}
