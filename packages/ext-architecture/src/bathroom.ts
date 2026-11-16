import { roundCorners, type ParametricKind, type Primitive } from '@opencalque/core'
import { frontsOf, rect } from './fronts'
import { atLeast, circle, clamp, count, line, MAX_BOWLS, outline, pt, THIN, WIDTH } from './shared'

/** How high a washbasin's counter stands, how thick it is, and how low a vanity unit under it reaches, in mm. */
const COUNTER_TOP = 850
const COUNTER = 30
const VANITY_FOOT = 300

/** A washbasin's counter and what hangs under it seen from in front: its bowls under the counter, dashed, a tap over each, a vanity unit or none. */
function washbasinFront(w: number, bowls: number, below: string): Primitive[] {
  const n = Math.min(MAX_BOWLS, count(bowls))
  const share = w / n
  const prims: Primitive[] = [rect(0, -COUNTER_TOP + COUNTER, w, -COUNTER_TOP)]
  if (below === 'Drawers' || below === 'Doors') {
    prims.push(rect(0, -VANITY_FOOT, w, -COUNTER_TOP + COUNTER, THIN), ...frontsOf(below, 0, w, -VANITY_FOOT, -COUNTER_TOP + COUNTER, w > 900 ? 2 : 1, 2))
  }
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * share
    const rx = clamp(share / 2 - 40, 20, 210)
    // The bowl under the counter, hidden behind what is in front of it.
    if (below !== 'Drawers' && below !== 'Doors') prims.push({ kind: 'path', points: [pt(cx - rx, -COUNTER_TOP + COUNTER), pt(cx - rx * 0.8, -COUNTER_TOP + 150), pt(cx + rx * 0.8, -COUNTER_TOP + 150), pt(cx + rx, -COUNTER_TOP + COUNTER)], dash: [8, 6], strokeWidth: 0.5 })
    prims.push(rect(cx - 20, -COUNTER_TOP, cx + 20, -COUNTER_TOP - 30), line([pt(cx, -COUNTER_TOP - 30), pt(cx, -COUNTER_TOP - 180)], { strokeWidth: 1.5 }), line([pt(cx, -COUNTER_TOP - 80), pt(cx + 50, -COUNTER_TOP - 100)], { strokeWidth: 1.5 }))
  }
  return prims
}
/** The same from its side, its back against the wall: the tap at the back, its spout over the bowl. */
function washbasinSide(d: number, below: string): Primitive[] {
  const prims: Primitive[] = [rect(0, -COUNTER_TOP + COUNTER, d, -COUNTER_TOP), line([pt(60, -COUNTER_TOP), pt(60, -COUNTER_TOP - 180), pt(160, -COUNTER_TOP - 180), pt(160, -COUNTER_TOP - 140)], { strokeWidth: 1.5 })]
  if (below === 'Drawers' || below === 'Doors') prims.push(rect(0, -VANITY_FOOT, Math.max(40, d - 20), -COUNTER_TOP + COUNTER, THIN))
  return prims
}

/** The least a washbasin's counter is made, either way, by pulling its sides, in mm. */
const MIN_COUNTER = 300

/**
 * A washbasin: a counter along the wall (its top edge) with one bowl or more, each with its tap at
 * the back. Its counter is resized by pulling its sides; its bowls and taps keep their size, that
 * of the bowl of a 600 × 450 washbasin, each in the middle of its share of the counter, and are
 * made smaller only when their share cannot hold them.
 */
export const washbasin = (kind: string, label: string, width: number, depth: number, bowls: number): ParametricKind => ({
  kind,
  label,
  category: 'bathroom',
  description: 'A counter with its bowls. Pull its sides to make it longer or deeper: the bowls and taps keep their size.',
  params: [
    { ...WIDTH, default: width },
    { key: 'depth', label: 'Depth', type: 'number', default: depth, unit: 'length' },
    { key: 'bowls', label: 'Bowls', type: 'number', default: bowls },
    { key: 'below', label: 'Below', type: 'string', default: 'None', options: ['None', 'Drawers', 'Doors'] },
  ],
  front: ({ width, bowls, below }) => washbasinFront(atLeast(1, width), bowls, below),
  side: ({ depth, below }) => washbasinSide(atLeast(1, depth), below),
  box: {
    bounds: ({ width, depth }) => ({ left: 0, top: 0, right: atLeast(1, width), bottom: atLeast(1, depth) }),
    resize: (_, size) => ({
      ...(size.width === undefined ? {} : { width: Math.round(atLeast(MIN_COUNTER, size.width)) }),
      ...(size.height === undefined ? {} : { depth: Math.round(atLeast(MIN_COUNTER, size.height)) }),
    }),
  },
  build({ width, depth, bowls }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const n = Math.min(MAX_BOWLS, count(bowls))
    const share = w / n
    const rx = clamp(share / 2 - 40, 20, 210)
    const ry = clamp((d - 130) / 2, 20, 150)
    // Between the taps at the back and a lip at the front.
    const cy = Math.max(100 + ry, (100 + d - 30) / 2)
    // Its front corners a little rounded; the back is against the wall.
    const prims: Primitive[] = [outline(roundCorners([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)], [0, 0, 20, 20]))]
    // The slope of the bowl inside its rim, as far in as the bowl's size allows.
    const inset = Math.min(25, rx / 3, ry / 3)
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * share
      prims.push(
        { kind: 'ellipse', cx, cy, rx, ry },
        { kind: 'ellipse', cx, cy, rx: rx - inset, ry: ry - inset, ...THIN },
        { kind: 'ellipse', cx, cy, rx: Math.min(15, rx / 4), ry: Math.min(15, ry / 4), ...THIN },
        { kind: 'ellipse', cx, cy: 60, rx: 20, ry: 20 },
        // The spout, reaching over the rim of the bowl.
        line([pt(cx, 80), pt(cx, Math.min(cy, cy - ry + 50))], THIN),
      )
    }
    return prims
  },
})

/** How high a bathtub's rim stands, in mm. */
const TUB = 580
/** The least a bathtub is made, either way, by pulling its sides, in mm. */
const MIN_TUB = 500

/**
 * A bathtub: a rim round its basin, and the drain at its left end. It is resized by pulling its
 * sides; its rim keeps its thickness, and its drain its size and its distance from the end, made
 * smaller only when the bathtub is too small to hold them.
 */
export const bathtub: ParametricKind = {
  kind: 'arch.bathtub',
  label: 'Bathtub',
  category: 'bathroom',
  description: 'Pull its sides to make it longer or wider: its rim and its drain keep their size.',
  params: [
    { key: 'length', label: 'Length', type: 'number', default: 1700, unit: 'length' },
    { key: 'width', label: 'Width', type: 'number', default: 750, unit: 'length' },
    { key: 'rim', label: 'Rim', type: 'number', default: 60, unit: 'length' },
  ],
  box: {
    bounds: ({ length, width }) => ({ left: 0, top: 0, right: atLeast(1, length), bottom: atLeast(1, width) }),
    resize: (_, size) => ({
      ...(size.width === undefined ? {} : { length: Math.round(atLeast(MIN_TUB, size.width)) }),
      ...(size.height === undefined ? {} : { width: Math.round(atLeast(MIN_TUB, size.height)) }),
    }),
  },
  // Seen from in front, its panel and the rim along its top, its mixer on the wall at the drain end;
  // from its side, the same across its width.
  front: ({ length, rim }) => {
    const l = atLeast(1, length)
    const x = Math.min(clamp(rim, 1, l / 2) + 140, l / 2)
    return [rect(0, 0, l, -TUB), line([pt(0, -TUB + 40), pt(l, -TUB + 40)], THIN), rect(x - 60, -TUB - 150, x + 60, -TUB - 190), line([pt(x, -TUB - 150), pt(x, -TUB - 100)], { strokeWidth: 1.5 })]
  },
  side: ({ width }) => {
    const w = atLeast(1, width)
    return [rect(0, 0, w, -TUB), line([pt(0, -TUB + 40), pt(w, -TUB + 40)], THIN)]
  },
  build({ length, width, rim }) {
    const l = atLeast(1, length)
    const w = atLeast(1, width)
    // The rim leaves a basin at least 50 mm across.
    const r = clamp(rim, 1, atLeast(1, Math.min(l, w) / 2 - 25))
    // The basin is rounder at the head, away from the drain, where one lies back.
    const basin = [pt(r, r), pt(l - r, r), pt(l - r, w - r), pt(r, w - r)]
    return [
      outline([pt(0, 0), pt(l, 0), pt(l, w), pt(0, w)]),
      outline(roundCorners(basin, [100, 250, 250, 100])),
      { kind: 'ellipse', cx: Math.min(r + 140, l / 2), cy: w / 2, rx: 25, ry: 25 },
      { kind: 'ellipse', cx: Math.min(r + 140, l / 2), cy: w / 2, rx: 12, ry: 12, ...THIN },
    ]
  },
}
