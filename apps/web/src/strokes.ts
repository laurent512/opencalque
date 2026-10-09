import { PRINT_MM_PER_PIXEL } from '@opencalque/core'
import { msg } from './i18n'

/**
 * Line weights are stored in screen pixels, but chosen here as what they print at: the standard
 * pen sizes of technical drawing, in millimetres.
 */
export const PENS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4]

/** The printed width in mm of a weight in pixels, and back. */
export const penOf = (pixels: number) => Math.round(pixels * PRINT_MM_PER_PIXEL * 100) / 100
export const pixelsOf = (mm: number) => mm / PRINT_MM_PER_PIXEL

/** The kinds of line: each a name and its pattern of dashes and gaps, in pixels. A solid line has none. */
export const DASHES: [name: string, pattern: number[] | null][] = [
  [msg('Solid'), null],
  [msg('Dashed'), [6, 4]],
  [msg('Long dashes'), [12, 5]],
  [msg('Dotted'), [1.5, 3.5]],
  [msg('Dash and dot'), [9, 3, 1.5, 3]],
]

/** Which of the kinds of line a stored pattern is: its position in `DASHES`, or -1 for one of its own. */
export const dashIndex = (pattern: unknown) => DASHES.findIndex(([, known]) => JSON.stringify(known) === JSON.stringify(pattern ?? null))
