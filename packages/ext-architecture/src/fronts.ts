import type { Primitive } from '@opencalque/core'
import { circle, count, line, outline, pt, roundBox, THIN } from './shared'

/*
 * What furniture and kitchen units look like in an elevation: their fronts, seen from in front, and
 * their sides. Coordinates are those of `front` and `side` (registry.ts): X along the object, Y down
 * from the floor, so that what is 900 mm high is at Y = -900.
 */

/** How high the plinth under a kitchen unit is, how thick a worktop, how far it reaches past the fronts, in mm. */
export const PLINTH = 100
export const WORKTOP = 38
export const OVERHANG = 20
/** How far a plinth stands back from the fronts, and how thick a front is, in mm. */
const SETBACK = 50
const FRONT = 19
/** The gap between two fronts, in mm. */
const GAP = 3
/** The most fronts a unit is drawn with: a value typed by mistake must not draw a thousand. */
export const MAX_FRONTS = 12

/** A rectangle from (x0, y0) to (x1, y1). */
export const rect = (x0: number, y0: number, x1: number, y1: number, style: { strokeWidth?: number; dash?: number[] } = {}): Primitive =>
  outline([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)], style)
/** A handle: a short bar, drawn heavier than the fronts. */
const bar = (x0: number, y0: number, x1: number, y1: number): Primitive => line([pt(x0, y0), pt(x1, y1)], { strokeWidth: 2 })

/** Which edge of a door its handle is by: the one it opens from. */
export type Handle = 'left' | 'right' | 'top' | 'bottom'

/** A door from x0 to x1 between y0 (its bottom) and y1 (its top, above: less), its handle by the edge it opens from. */
export function door(x0: number, x1: number, y0: number, y1: number, handle: Handle): Primitive[] {
  const [w, h] = [x1 - x0, y0 - y1]
  const reach = Math.min(80, h / 4, w / 4)
  const inset = Math.min(40, w / 6, h / 6)
  const middle = (y0 + y1) / 2
  const grip =
    handle === 'left'
      ? bar(x0 + inset, middle - reach, x0 + inset, middle + reach)
      : handle === 'right'
        ? bar(x1 - inset, middle - reach, x1 - inset, middle + reach)
        : handle === 'top'
          ? bar((x0 + x1) / 2 - reach, y1 + inset, (x0 + x1) / 2 + reach, y1 + inset)
          : bar((x0 + x1) / 2 - reach, y0 - inset, (x0 + x1) / 2 + reach, y0 - inset)
  return [rect(x0, y0, x1, y1, THIN), grip]
}

/** A drawer front from x0 to x1 between y0 and y1, its handle along the middle of its top. */
export function drawer(x0: number, x1: number, y0: number, y1: number): Primitive[] {
  const reach = Math.min(80, (x1 - x0) / 4)
  const below = Math.min(35, (y0 - y1) / 3)
  return [rect(x0, y0, x1, y1, THIN), bar((x0 + x1) / 2 - reach, y1 + below, (x0 + x1) / 2 + reach, y1 + below)]
}

/**
 * `n` doors side by side across x0 to x1: one hinged on its left, opening from its right (or the
 * other way, `hinge` 'Right'), two or more in pairs, from where they meet.
 */
export function doors(x0: number, x1: number, y0: number, y1: number, n: number, hinge = 'Left'): Primitive[] {
  const leaves = Math.min(MAX_FRONTS, count(n))
  const each = (x1 - x0) / leaves
  return Array.from({ length: leaves }, (_, i) => {
    const handle: Handle = leaves === 1 ? (hinge === 'Right' ? 'left' : 'right') : i % 2 === 0 ? (i === leaves - 1 ? 'left' : 'right') : 'left'
    return door(x0 + i * each + (i > 0 ? GAP / 2 : 0), x0 + (i + 1) * each - (i < leaves - 1 ? GAP / 2 : 0), y0, y1, handle)
  }).flat()
}

/** `n` drawers one above the other from y0 up to y1, each as high. */
export function drawers(x0: number, x1: number, y0: number, y1: number, n: number): Primitive[] {
  const rows = Math.min(MAX_FRONTS, count(n))
  const each = (y0 - y1) / rows
  return Array.from({ length: rows }, (_, i) => drawer(x0, x1, y0 - i * each - (i > 0 ? GAP / 2 : 0), y0 - (i + 1) * each + (i < rows - 1 ? GAP / 2 : 0))).flat()
}

/** A built-in oven from y0 up to y1: its control strip along the top, its window, its handle across below the strip. */
export function oven(x0: number, x1: number, y0: number, y1: number): Primitive[] {
  const strip = Math.min(70, (y0 - y1) / 6)
  const inset = Math.min(70, (x1 - x0) / 6)
  return [
    rect(x0, y0, x1, y1),
    line([pt(x0, y1 + strip), pt(x1, y1 + strip)], THIN),
    circle(x1 - inset, y1 + strip / 2, Math.min(14, strip / 3), THIN),
    roundBox(x0 + inset, y0 - inset, x1 - inset, y1 + strip + inset * 1.4, Math.min(30, inset / 2), THIN),
    bar(x0 + inset, y1 + strip + inset * 0.6, x1 - inset, y1 + strip + inset * 0.6),
  ]
}

/** A built-in microwave from y0 up to y1: its window on the left, its controls on the right. */
export function microwave(x0: number, x1: number, y0: number, y1: number): Primitive[] {
  const w = x1 - x0
  const controls = Math.min(140, w / 4)
  const inset = Math.min(40, w / 10, (y0 - y1) / 6)
  return [
    rect(x0, y0, x1, y1),
    roundBox(x0 + inset, y0 - inset, x1 - controls - inset / 2, y1 + inset, Math.min(20, inset / 2), THIN),
    line([pt(x1 - controls, y0), pt(x1 - controls, y1)], THIN),
    circle(x1 - controls / 2, (y0 + y1) / 2, Math.min(18, controls / 4), THIN),
  ]
}

/** What a kitchen unit holds behind its fronts, from the plinth up to the worktop. */
export type Fronts = 'Doors' | 'Drawers' | 'Door and drawer' | 'Oven' | 'None'
export const FRONTS: Fronts[] = ['Doors', 'Drawers', 'Door and drawer', 'Oven']

/** The fronts of a unit from x0 to x1 between y0 (the top of its plinth) and y1 (under its worktop). */
export function frontsOf(layout: string, x0: number, x1: number, y0: number, y1: number, leaves: number, rows: number, hinge?: string): Primitive[] {
  const [a, b] = [y0 - GAP, y1 + GAP]
  if (b >= a) return []
  if (layout === 'None') return []
  if (layout === 'Drawers') return drawers(x0, x1, a, b, rows)
  // A drawer of 150 mm along the top, the doors under it.
  if (layout === 'Door and drawer') return [...drawer(x0, x1, b + Math.min(150, (a - b) / 3), b), ...doors(x0, x1, a, b + Math.min(150, (a - b) / 3) + GAP, leaves, hinge)]
  // An oven of 595 mm under the worktop, a drawer under it.
  if (layout === 'Oven') {
    const top = b + Math.min(595, (a - b) * 0.8)
    return [...oven(x0, x1, top, b), ...(a - top > GAP * 4 ? drawer(x0, x1, a, top + GAP) : [])]
  }
  return doors(x0, x1, a, b, leaves, hinge)
}

/**
 * A kitchen unit seen from in front, `height` up to the top of its worktop (or of itself, without
 * one): its outline, the worktop along its top, its plinth, and its fronts between.
 */
export function unitFront(width: number, height: number, worktop: boolean, fronts: (y0: number, y1: number) => Primitive[]): Primitive[] {
  const top = -(height - (worktop ? WORKTOP : 0))
  return [
    rect(0, 0, width, -height),
    ...(worktop ? [line([pt(0, top), pt(width, top)])] : []),
    line([pt(0, -PLINTH), pt(width, -PLINTH)], THIN),
    ...fronts(-PLINTH, top),
  ]
}

/**
 * A kitchen unit seen from its side, its back (X = 0) against the wall: the worktop reaching past
 * the fronts, the body, the thickness of its fronts, and the plinth set back under them.
 */
export function unitSide(depth: number, height: number, worktop: boolean): Primitive[] {
  const body = worktop ? Math.max(FRONT * 2, depth - OVERHANG) : depth
  const top = -(height - (worktop ? WORKTOP : 0))
  const foot = Math.max(0, body - SETBACK)
  return [
    outline([pt(0, 0), pt(foot, 0), pt(foot, -PLINTH), pt(body, -PLINTH), pt(body, top), pt(depth, top), pt(depth, -height), pt(0, -height)]),
    ...(worktop ? [line([pt(0, top), pt(body, top)])] : []),
    line([pt(body - FRONT, -PLINTH), pt(body - FRONT, top)], THIN),
  ]
}

/** Something that stands on the floor seen from its side as a plain box, `depth` deep and `height` high, the thickness of its front (or door) marked. */
export function boxSide(depth: number, height: number, front = FRONT): Primitive[] {
  return [rect(0, 0, depth, -height), line([pt(Math.max(0, depth - front), 0), pt(Math.max(0, depth - front), -height)], THIN)]
}
