import { roundCorners, type KindSolid, type Vec2 } from '@opencalque/core'
import { OVERHANG, PLINTH, WORKTOP } from './fronts'
import { pt } from './shared'

/*
 * What objects are made of in 3D (`ParametricKind.solids`), for a viewpoint's view: slabs from a
 * bottom to a top, in the object's own coordinates, its back at Y = 0. What makes an object what it
 * is shows as shape (a worktop over a plinth set back, a chair on its legs), since the lines of a
 * shape stay sharp at any distance where lines painted on its faces fade.
 */

/** A rectangle as the ring of its corners. */
export const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]

/** A circle as a ring of `n` points. */
export const disc = (cx: number, cy: number, r: number, n = 24): Vec2[] => Array.from({ length: n }, (_, i) => pt(cx + r * Math.cos((2 * i * Math.PI) / n), cy + r * Math.sin((2 * i * Math.PI) / n)))

/** How far a kitchen unit's plinth stands back from its fronts, in mm. */
const SETBACK = 50

/**
 * A kitchen unit `w` by `d`, `height` to the top of its worktop (or of itself, without one): its
 * plinth set back from the fronts, its body, and its worktop over it reaching past the fronts.
 */
export function unitSolids(w: number, d: number, height: number, worktop: boolean): KindSolid[] {
  const top = worktop ? height - WORKTOP : height
  return [...cabinetSolids(w, worktop ? bodyDepth(d) : d, top), ...(worktop ? [{ outline: box(0, 0, w, d), bottom: top, top: height }] : [])]
}

/** The body of a unit, `body` deep from its back up to `top`, over its plinth set back from its fronts. */
export function cabinetSolids(w: number, body: number, top: number): KindSolid[] {
  const plinth = Math.min(PLINTH, top / 2)
  return [
    { outline: box(0, 0, w, Math.max(20, body - SETBACK)), bottom: 0, top: plinth },
    { outline: box(0, 0, w, body), bottom: plinth, top },
  ]
}

/** How deep the body of a unit `d` deep is under its worktop, which reaches past its fronts. */
export const bodyDepth = (d: number) => Math.max(40, d - OVERHANG)

/** Four legs `size` square, from the floor to `top`, in the corners of x0, y0 to x1, y1 (their outer faces on its edges). */
export function legs(x0: number, y0: number, x1: number, y1: number, size: number, top: number): KindSolid[] {
  return [
    [x0, y0],
    [x1 - size, y0],
    [x0, y1 - size],
    [x1 - size, y1 - size],
  ].map(([x, y]) => ({ outline: box(x, y, x + size, y + size), bottom: 0, top }))
}

/**
 * A chair `w` wide and `d` deep, its back at Y = 0: its four legs, its seat from `seatFrom` to its
 * front up to `seat`, and its back from the seat up to `back`, as the ring `backrest` gives it on
 * the plan. A footrest, for a high chair, as a bar between its front legs and one between its back
 * legs at `footrest`.
 */
export function chairSolids(w: number, d: number, seatFrom: number, seat: number, back: number | null, backrest: Vec2[], footrest?: number): KindSolid[] {
  const leg = 30
  const thick = 40
  const solids: KindSolid[] = [...legs(25, 30, w - 25, d - 20, leg, seat - thick), { outline: seatOutline(w, d, seatFrom), bottom: seat - thick, top: seat }]
  if (back !== null && back > seat && backrest.length >= 3) solids.push({ outline: backrest, bottom: seat, top: back })
  if (footrest !== undefined && footrest < seat - thick) {
    for (const y of [30, d - 20 - leg]) solids.push({ outline: box(25 + leg, y + 5, w - 25 - leg, y + leg - 5), bottom: footrest - 10, top: footrest + 10 })
  }
  return solids
}

/** A seat from `from` to the front, rounder at the front. */
const seatOutline = (w: number, d: number, from: number): Vec2[] => roundCorners(box(0, from, w, d), [30, 30, 75, 75])
