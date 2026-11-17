import { roundCorners, type ParametricKind, type Primitive, type Vec2 } from '@opencalque/core'
import { frontsOf, rect } from './fronts'
import { atLeast, circle, clamp, count, DEPTH, line, MAX_BOWLS, outline, pt, roundBox, sizedBox, THIN, WIDTH } from './shared'

/** How high a washbasin's counter stands, how thick it is, and how low a vanity unit under it reaches, hung or on feet, in mm. */
const COUNTER_TOP = 850
const COUNTER = 30
const VANITY_FOOT = 300
const VANITY_LEGS = 150
/** Where a vanity unit's body starts above the floor: hung on the wall, or on its feet. */
const vanityFoot = (feet: boolean) => (feet ? VANITY_LEGS : VANITY_FOOT)
/** The feet of a vanity unit `w` long, seen from in front or from its side: one near each end. */
const vanityLegs = (w: number): Primitive[] => {
  const leg = Math.min(40, w / 8)
  const inset = Math.min(30, w / 10)
  return [rect(inset, 0, inset + leg, -VANITY_LEGS), rect(w - inset - leg, 0, w - inset, -VANITY_LEGS)]
}

/** A washbasin's counter and what is under it seen from in front: its bowls under the counter, dashed, a tap over each, a vanity unit hung or on feet, or none. */
function washbasinFront(w: number, bowls: number, below: string, feet: boolean): Primitive[] {
  const n = Math.min(MAX_BOWLS, count(bowls))
  const share = w / n
  const prims: Primitive[] = [rect(0, -COUNTER_TOP + COUNTER, w, -COUNTER_TOP)]
  if (below === 'Drawers' || below === 'Doors') {
    prims.push(rect(0, -vanityFoot(feet), w, -COUNTER_TOP + COUNTER, THIN), ...frontsOf(below, 0, w, -vanityFoot(feet), -COUNTER_TOP + COUNTER, w > 900 ? 2 : 1, 2))
    if (feet) prims.push(...vanityLegs(w))
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
function washbasinSide(d: number, below: string, feet: boolean): Primitive[] {
  const prims: Primitive[] = [rect(0, -COUNTER_TOP + COUNTER, d, -COUNTER_TOP), line([pt(60, -COUNTER_TOP), pt(60, -COUNTER_TOP - 180), pt(160, -COUNTER_TOP - 180), pt(160, -COUNTER_TOP - 140)], { strokeWidth: 1.5 })]
  if (below === 'Drawers' || below === 'Doors') {
    prims.push(rect(0, -vanityFoot(feet), Math.max(40, d - 20), -COUNTER_TOP + COUNTER, THIN))
    if (feet) prims.push(...vanityLegs(Math.max(40, d - 20)))
  }
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
  description: 'A counter with its bowls, and under it a vanity unit with drawers or doors, hung or on feet, or none. Pull its sides to make it longer or deeper: the bowls and taps keep their size.',
  params: [
    { ...WIDTH, default: width },
    { key: 'depth', label: 'Depth', type: 'number', default: depth, unit: 'length' },
    { key: 'bowls', label: 'Bowls', type: 'number', default: bowls },
    { key: 'below', label: 'Below', type: 'string', default: 'None', options: ['None', 'Drawers', 'Doors'] },
    // The vanity unit under it, hung on the wall (as most are) or standing on feet.
    { key: 'feet', label: 'On feet', type: 'boolean', default: false },
  ],
  front: ({ width, bowls, below, feet }) => washbasinFront(atLeast(1, width), bowls, below, feet === true),
  side: ({ depth, below, feet }) => washbasinSide(atLeast(1, depth), below, feet === true),
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

/**
 * A bowl seen from above, its back toward the wall at the top: nearly square at the back (the
 * higher `square`, the squarer) and round at the front, `back` and `front` deep from (cx, cy).
 */
function bowl(cx: number, cy: number, halfWidth: number, back: number, front: number, square = 5): Vec2[] {
  return Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * 2 * Math.PI
    const [c, s] = [Math.cos(t), Math.sin(t)]
    const power = (v: number, n: number) => Math.sign(v) * Math.abs(v) ** (2 / n)
    const n = s < 0 ? square : 2.2
    return pt(cx + halfWidth * power(c, n), cy + (s < 0 ? back : front) * power(s, n))
  })
}
/** Where a level line at `y` crosses a closed outline: its leftmost and rightmost points there. */
function across(outline: Vec2[], y: number): [number, number] {
  const xs = outline.flatMap((p, i) => {
    const q = outline[(i + 1) % outline.length]
    return (p.y - y) * (q.y - y) <= 0 && p.y !== q.y ? [p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y)] : []
  })
  return xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : [0, 0]
}

/** How high a toilet's seat and the top of its cistern stand, in mm. */
const SEAT = 420
const CISTERN_TOP = 800
/** How high a wall-hung toilet's seat stands, and the middle of the flush plate over it, in mm. */
const HUNG_SEAT = 400
const FLUSH_PLATE = 1100
/** How long a toilet's lid is, from its hinge to its front, and how thick, in mm. */
const LID = 430
const LID_THICK = 30
/** The least a toilet is made, wide and deep, by pulling its sides, in mm. */
const MIN_TOILET_WIDTH = 300
const MIN_TOILET_DEPTH = 450

/**
 * A toilet standing on the floor, its cistern against the wall (its top edge) with a dual flush
 * button, the bowl, and the opening of its seat: those of a 380 × 700 toilet, made to its size.
 */
export const toilet: ParametricKind = {
  kind: 'arch.toilet',
  label: 'Toilet',
  category: 'bathroom',
  description: 'Its cistern goes against the wall. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: 380 }, DEPTH(700)],
  box: sizedBox('width', 'depth', MIN_TOILET_WIDTH, MIN_TOILET_DEPTH),
  mount: { on: 'floor' },
  height: () => CISTERN_TOP,
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const c = Math.min(170, d / 4)
    const rest = d - c
    const cy = c + rest * (130 / 530)
    return [
      roundBox(0, 0, w, c, [8, 8, Math.min(30, c / 3), Math.min(30, c / 3)]),
      circle(w / 2, c / 2, Math.min(32, c / 3), THIN),
      line([pt(w / 2 - Math.min(32, c / 3), c / 2), pt(w / 2 + Math.min(32, c / 3), c / 2)], THIN),
      outline(bowl(w / 2, cy, w / 2 - 10 * (w / 380), cy - c, d - cy)),
      { kind: 'ellipse', cx: w / 2, cy: c + rest * (275 / 530), rx: w * (118 / 380), ry: rest * (205 / 530) },
    ]
  },
  // Seen from in front, its foot, its seat, its lid closed over it and, behind, its cistern with the
  // flush button on top; from its side, the cistern against the wall and the bowl reaching out from
  // it under its lid.
  front: ({ width }) => {
    const w = atLeast(1, width)
    return [
      outline([pt(w * 0.3, 0), pt(w * 0.7, 0), pt(w * 0.8, -SEAT + 60), pt(w * 0.2, -SEAT + 60)]),
      roundBox(w * 0.03, -SEAT, w * 0.97, -SEAT + 60, 20),
      roundBox(w * 0.04, -SEAT - LID_THICK, w * 0.96, -SEAT, LID_THICK / 2),
      rect(0, -SEAT - LID_THICK, w, -CISTERN_TOP),
      rect(w / 2 - 30, -CISTERN_TOP, w / 2 + 30, -CISTERN_TOP - 12, THIN),
    ]
  },
  side: ({ depth }) => {
    const d = atLeast(1, depth)
    const c = Math.min(170, d / 4)
    return [
      rect(0, -SEAT, c, -CISTERN_TOP),
      outline([pt(c, 0), pt(c + (d - c) * 0.55, 0), pt(d, -SEAT + 80), pt(d, -SEAT), pt(c, -SEAT)]),
      outline(roundCorners([pt(c, -SEAT), pt(c, -SEAT - LID_THICK), pt(d - 5, -SEAT - LID_THICK), pt(d - 5, -SEAT)], [0, 0, LID_THICK / 2, 0])),
    ]
  },
}

/**
 * A toilet hung on the wall, its cistern in the wall: the bowl, its straight back against the wall
 * (its top edge), the opening of its seat and the line of its hinge, those of a 360 × 540 toilet
 * made to its size. Seen from in front, the bowl off the floor and the flush plate on the wall.
 */
export const wallHungToilet: ParametricKind = {
  kind: 'arch.toilet.wallhung',
  label: 'Toilet, wall-hung',
  category: 'bathroom',
  description: 'Its back goes against the wall, its cistern in the wall. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: 360 }, DEPTH(540)],
  box: sizedBox('width', 'depth', MIN_TOILET_WIDTH, MIN_TOILET_DEPTH - 100),
  mount: { on: 'floor' },
  height: () => HUNG_SEAT,
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const cy = d * (150 / 540)
    const edge = bowl(w / 2, cy, w / 2, cy, d - cy, 6)
    const hinge = d * (100 / 540)
    const [left, right] = across(edge, hinge)
    return [
      outline(edge),
      { kind: 'ellipse', cx: w / 2, cy: d * (330 / 540), rx: w * (112 / 360), ry: d * (180 / 540) },
      line([pt(left, hinge), pt(right, hinge)], THIN),
    ]
  },
  // Seen from in front, its seat, its lid raised against the wall behind it, the bowl under them,
  // and the flush plate on the wall over it; from its side, the same, the lid leaning to the wall.
  front: ({ width }) => {
    const w = atLeast(1, width)
    const round = w * 0.35
    return [
      outline(roundCorners([pt(w * 0.07, -HUNG_SEAT), pt(w * 0.07, -HUNG_SEAT - LID), pt(w * 0.93, -HUNG_SEAT - LID), pt(w * 0.93, -HUNG_SEAT)], [0, round, round, 0])),
      roundBox(w * 0.03, -HUNG_SEAT, w * 0.97, -HUNG_SEAT + 40, 15),
      outline([pt(w * 0.05, -HUNG_SEAT + 40), pt(w * 0.95, -HUNG_SEAT + 40), pt(w * 0.75, -HUNG_SEAT + 180), pt(w * 0.25, -HUNG_SEAT + 180)]),
      // The flush plate, on the wall over it, with its two buttons.
      rect(w / 2 - 120, -FLUSH_PLATE + 80, w / 2 + 120, -FLUSH_PLATE - 80, THIN),
      line([pt(w / 2, -FLUSH_PLATE + 50), pt(w / 2, -FLUSH_PLATE - 50)], THIN),
    ]
  },
  side: ({ depth }) => {
    const d = atLeast(1, depth)
    const hinge = d * (100 / 540)
    const top = -HUNG_SEAT - 30
    return [
      outline([pt(0, top), pt(d, top), pt(d, -HUNG_SEAT + 30), pt(d * 0.7, -HUNG_SEAT + 170), pt(0, -HUNG_SEAT + 200)]),
      outline([pt(hinge - LID_THICK, top), pt(hinge, top), pt(hinge - 35, top - LID), pt(hinge - 35 - LID_THICK, top - LID + 5)]),
    ]
  },
}

/** How high a shower tray's rim stands, and the least it is made either way, in mm. */
const TRAY = 100
const MIN_TRAY = 600
/**
 * A shower tray: its rim, the slopes from its inner corners to the drain in its middle, and the
 * drain's grating. Its rim and drain keep their size as it is made larger.
 */
export const showerTray: ParametricKind = {
  kind: 'arch.showertray',
  label: 'Shower tray',
  category: 'bathroom',
  description: 'Against the wall by one side. Pull its sides to make it larger: its rim and drain keep their size.',
  params: [{ ...WIDTH, default: 900 }, DEPTH(900)],
  box: sizedBox('width', 'depth', MIN_TRAY),
  mount: { on: 'floor' },
  height: () => TRAY,
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const rim = Math.min(40, w / 6, d / 6)
    const [cx, cy] = [w / 2, d / 2]
    const drain = Math.min(50, w / 6, d / 6)
    // From the middle of each rounded inner corner to the edge of the drain.
    const corner = rim + 30 * (1 - Math.SQRT1_2)
    const slopes = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ].map(([sx, sy]) => {
      const from = pt(cx - sx * (cx - corner), cy - sy * (cy - corner))
      const toward = Math.hypot(from.x - cx, from.y - cy)
      return line([from, pt(cx + ((from.x - cx) * drain) / toward, cy + ((from.y - cy) * drain) / toward)], THIN)
    })
    return [roundBox(0, 0, w, d, 10), roundBox(rim, rim, w - rim, d - rim, 30, THIN), ...slopes, circle(cx, cy, drain), circle(cx, cy, drain * 0.56, THIN)]
  },
  front: ({ width }) => [rect(0, 0, atLeast(1, width), -TRAY)],
  side: ({ depth }) => [rect(0, 0, atLeast(1, depth), -TRAY)],
}

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

/** A curve from `a` to `c` drawn towards `b`, as a few short lines: a hose hanging. */
const curve = (a: Vec2, b: Vec2, c: Vec2): Vec2[] =>
  Array.from({ length: 13 }, (_, i) => {
    const t = i / 12
    return pt((1 - t) ** 2 * a.x + 2 * t * (1 - t) * b.x + t * t * c.x, (1 - t) ** 2 * a.y + 2 * t * (1 - t) * b.y + t * t * c.y)
  })

/** How high a shower's mixer is, to its middle, and its head over it, in mm. */
const MIXER = 1100
const HEAD = 2100
/** What a shower's fittings are drawn with when above the cut: dashed, as a wall cabinet is. */
const HIGH = { dash: [30, 20] }
const high = (cx: number, cy: number, r: number, style: { strokeWidth?: number } = {}): Primitive => ({ kind: 'ellipse', cx, cy, rx: r, ry: r, ...style, ...HIGH })

/**
 * A shower's fittings, fixed on the wall at the height of its mixer (to its middle): the mixer and,
 * by `type`, a column rising to an overhead shower with a hand shower on it, a slide rail with its
 * hand shower, or a head fixed on its arm out of the wall. On the plan, the mixer against the wall
 * and, dashed as what is above the cut is, the head over the tray; in elevations, all of it. Its
 * own X along the wall, its middle at 0; it stands out of the wall towards its own +Y.
 */
export const showerHead: ParametricKind = {
  kind: 'arch.shower',
  label: 'Shower head',
  category: 'bathroom',
  description: 'Fixed on the wall at the height of its mixer: a column with an overhead shower, a slide rail with its hand shower, or a head on its arm. Over a shower tray or a bathtub.',
  params: [{ key: 'type', label: 'Type', type: 'string', default: 'Column', options: ['Column', 'Slide rail', 'Fixed head'] }],
  mount: { on: 'wall', height: MIXER },
  build({ type }) {
    const prims: Primitive[] = [rect(-80, 0, 80, 60), circle(-55, 75, 15, THIN), circle(55, 75, 15, THIN)]
    if (type === 'Slide rail') prims.push(line([pt(0, 0), pt(0, 30)], THIN), high(0, 60, 30, THIN))
    else if (type === 'Fixed head') prims.push(line([pt(0, 0), pt(0, 200)], { ...THIN, ...HIGH }), high(0, 250, 60))
    else prims.push(line([pt(0, 0), pt(0, 175)], { ...THIN, ...HIGH }), high(0, 300, 125), high(0, 300, 85, THIN))
    return prims
  },
  // Seen from in front, Y up from the middle of its mixer: the mixer and its two handles, then what rises over it.
  front: ({ type }) => {
    const top = MIXER - HEAD
    const prims: Primitive[] = [rect(-80, 30, 80, -30), circle(-55, 0, 15, THIN), circle(55, 0, 15, THIN)]
    if (type === 'Slide rail') {
      prims.push(
        line([pt(110, -150), pt(110, -850)], { strokeWidth: 1.5 }),
        rect(95, -140, 125, -160, THIN),
        rect(95, -840, 125, -860, THIN),
        // The hand shower on its holder, its hose hanging down to the mixer.
        roundBox(95, -900, 125, -660, 12),
        { kind: 'ellipse', cx: 110, cy: -930, rx: 40, ry: 30 },
        line(curve(pt(110, -660), pt(200, -250), pt(60, 30)), THIN),
      )
    } else if (type === 'Fixed head') {
      prims.push(line([pt(0, top + 100), pt(0, top + 60)], { strokeWidth: 1.5 }), { kind: 'ellipse', cx: 0, cy: top + 40, rx: 60, ry: 25 })
    } else {
      prims.push(
        line([pt(0, -30), pt(0, top)], { strokeWidth: 1.5 }),
        // The overhead shower, flat, at the end of its arm towards the viewer.
        rect(-125, top - 5, 125, top + 12),
        // The hand shower hung on the column.
        roundBox(15, -650, 45, -400, 12),
        { kind: 'ellipse', cx: 30, cy: -680, rx: 35, ry: 28 },
      )
    }
    return prims
  },
  // Seen from its side, X out from the wall: the mixer, and the arm reaching out to the head.
  side: ({ type }) => {
    const top = MIXER - HEAD
    const prims: Primitive[] = [rect(0, 30, 70, -30), line([pt(70, 0), pt(110, 0)], { strokeWidth: 1.5 })]
    if (type === 'Slide rail') prims.push(line([pt(30, -150), pt(30, -850)], { strokeWidth: 1.5 }), roundBox(30, -900, 70, -660, 12), { kind: 'ellipse', cx: 60, cy: -930, rx: 30, ry: 40 })
    else if (type === 'Fixed head') prims.push(line([pt(0, top + 100), pt(250, top + 60)], { strokeWidth: 1.5 }), rect(190, top + 40, 310, top + 70))
    else prims.push(line([pt(40, -30), pt(40, top), pt(300, top)], { strokeWidth: 1.5 }), rect(175, top, 425, top + 17), roundBox(40, -650, 70, -400, 12))
    return prims
  },
}
