import { roundCorners, transformPrimitive, type ParametricKind, type Primitive } from '@opencalque/core'
import { rect } from './fronts'
import { atLeast, circle, clamp, count, DEPTH, line, mirrorAlong, outline, pt, roundBox, sizedBox, THIN, WIDTH } from './shared'

/** What a corner sofa's frame takes behind its seats and at the end of each side, in mm. */
const SOFA_BACK = 170
const SOFA_ARM = 170
/** About how wide a seat of a corner sofa is: each side takes as many as its length holds. */
const SOFA_SEAT = 650

/** The sizes a corner sofa is drawn at: deep enough to sit on, each side long enough for a seat beyond the corner. */
function cornerSofaSize({ length, returnLength, depth }: Record<string, any>) {
  const d = clamp(depth, 2 * SOFA_BACK + 200, 1500)
  const least = d + SOFA_ARM + 300
  return { l: atLeast(least, length), r: atLeast(least, returnLength), d, least }
}

/**
 * A corner sofa, its backs along the top and down one side, the left or the right: a frame round
 * its backs and the arms at its two ends, back cushions along both backs, a seat in the corner and
 * along each side as many seats as it holds.
 */
export const cornerSofa: ParametricKind = {
  kind: 'arch.sofa.corner',
  label: 'Corner sofa',
  category: 'living',
  description: 'Its backs go against two walls. Pull its sides to make it longer: each side takes a seat for about every 65 cm.',
  params: [
    { key: 'length', label: 'Length', type: 'number', default: 2600, unit: 'length' },
    { key: 'returnLength', label: 'Return length', type: 'number', default: 1800, unit: 'length' },
    DEPTH(900),
    { key: 'corner', label: 'Corner', type: 'string', default: 'Left', options: ['Left', 'Right'] },
  ],
  box: {
    bounds: (props) => {
      const { l, r } = cornerSofaSize(props)
      return { left: 0, top: 0, right: l, bottom: r }
    },
    resize: (props, size) => {
      const { least } = cornerSofaSize(props)
      return {
        ...(size.width === undefined ? {} : { length: Math.round(atLeast(least, size.width)) }),
        ...(size.height === undefined ? {} : { returnLength: Math.round(atLeast(least, size.height)) }),
      }
    },
  },
  build(props) {
    const { l, r, d } = cornerSofaSize(props)
    const [back, arm] = [SOFA_BACK, SOFA_ARM]
    // Drawn with the corner on the left, and mirrored for one on the right.
    const frame = outline(
      roundCorners(
        [pt(0, 0), pt(l, 0), pt(l, d), pt(l - arm, d), pt(l - arm, back), pt(back, back), pt(back, r - arm), pt(d, r - arm), pt(d, r), pt(0, r)],
        [60, 60, 50, 50, 10, 10, 10, 50, 50, 60],
      ),
    )
    // Each cushion fills its cell but for a gap round it.
    const cushion = (x0: number, y0: number, x1: number, y1: number, radius: number) => roundBox(x0 + 6, y0 + 6, x1 - 6, y1 - 6, radius)
    const inner = back + 172
    const along = (from: number, to: number) => {
      const n = Math.max(1, Math.round((to - from) / SOFA_SEAT))
      return Array.from({ length: n }, (_, i) => [from + ((to - from) * i) / n, from + ((to - from) * (i + 1)) / n] as const)
    }
    const top = along(d, l - arm)
    const side = along(d, r - arm)
    const prims: Primitive[] = [
      frame,
      // The backs: down the side from the corner, and along the top beyond it.
      cushion(back, back, inner, d, 40),
      ...side.map(([y0, y1]) => cushion(back, y0, inner, y1, 40)),
      cushion(inner, back, d, inner, 40),
      ...top.map(([x0, x1]) => cushion(x0, back, x1, inner, 40)),
      // The seats: in the corner, then along each side.
      cushion(inner, inner, d, d, 45),
      ...top.map(([x0, x1]) => cushion(x0, inner, x1, d, 45)),
      ...side.map(([y0, y1]) => cushion(inner, y0, d, y1, 45)),
    ]
    return props.corner === 'Right' ? mirrorAlong(prims, l) : prims
  },
  front: (props) => cornerSofaFront(props),
  side: (props) => cornerSofaSide(props),
}

/** How high a seat is, the top of an arm, the top of a back, and the legs under a sofa, in mm. */
const SEAT = 420
const ARM_TOP = 600
const BACK_TOP = 850
const LEGS = 60

/** Small feet under a sofa from x0 to x1, at its two ends. */
const feet = (x0: number, x1: number): Primitive[] => [rect(x0 + 30, 0, x0 + 80, -LEGS, THIN), rect(x1 - 80, 0, x1 - 30, -LEGS, THIN)]

/** The front of a sofa from x0 to x1 with an arm at each end it is asked for: arms to their top, seats between with a line between cushions, its back over them. */
function sofaFront(x0: number, x1: number, armLeft: number, armRight: number, seats: number): Primitive[] {
  const [a, b] = [x0 + armLeft, x1 - armRight]
  const n = Math.min(12, count(seats))
  const prims: Primitive[] = [
    outline([pt(x0, -LEGS), pt(x1, -LEGS), pt(x1, -ARM_TOP), pt(b, -ARM_TOP), pt(b, -SEAT), pt(a, -SEAT), pt(a, -ARM_TOP), pt(x0, -ARM_TOP)]),
    // The back, over the arms and the seats.
    line([pt(x0, -ARM_TOP), pt(x0, -BACK_TOP), pt(x1, -BACK_TOP), pt(x1, -ARM_TOP)]),
    ...feet(x0, x1),
  ]
  for (let i = 1; i < n; i++) prims.push(line([pt(a + ((b - a) * i) / n, -SEAT), pt(a + ((b - a) * i) / n, -LEGS - 60)], THIN), line([pt(a + ((b - a) * i) / n, -SEAT - 20), pt(a + ((b - a) * i) / n, -BACK_TOP + 30)], THIN))
  return prims
}

/** A sofa or an armchair seen from its side, its back against the wall (X = 0): the arm in front, the back rising behind it. */
function sofaSide(d: number, back: number): Primitive[] {
  return [
    outline([pt(0, -LEGS), pt(d, -LEGS), pt(d, -ARM_TOP + 40), pt(d - 40, -ARM_TOP), pt(0, -ARM_TOP)]),
    line([pt(0, -ARM_TOP), pt(0, -BACK_TOP), pt(back * 0.6, -BACK_TOP), pt(back, -ARM_TOP)]),
    ...feet(0, d),
  ]
}

/** A sofa of `seats` seats, or an armchair of one, its back at the top: a frame round its back and arms, a back cushion and a seat cushion for each seat. */
export const sofa = (kind: string, label: string, width: number, seats: number): ParametricKind => ({
  kind,
  label,
  category: 'living',
  description: 'Its back goes against the wall. Pull its sides to make it wider or deeper.',
  params: [{ key: 'width', label: 'Width', type: 'number', default: width, unit: 'length' }, DEPTH(850), { key: 'seats', label: 'Seats', type: 'number', default: seats }],
  box: sizedBox('width', 'depth', 2 * SOFA_ARM + 200, 2 * SOFA_BACK + 200),
  mount: { on: 'floor' },
  height: () => BACK_TOP,
  build({ width, depth, seats }) {
    const w = atLeast(2 * SOFA_ARM + 200, width)
    const d = atLeast(2 * SOFA_BACK + 200, depth)
    const [arm, back] = [SOFA_ARM, SOFA_BACK]
    const n = Math.min(12, count(seats))
    const seat = (w - 2 * arm) / n
    const frame = outline(roundCorners([pt(0, 0), pt(w, 0), pt(w, d), pt(w - arm, d), pt(w - arm, back), pt(arm, back), pt(arm, d), pt(0, d)], [60, 60, 50, 50, 10, 10, 50, 50]))
    return [
      frame,
      ...Array.from({ length: n }, (_, k) => [
        roundBox(arm + k * seat + 6, back + 6, arm + (k + 1) * seat - 6, back + 166, 40),
        roundBox(arm + k * seat + 6, back + 178, arm + (k + 1) * seat - 6, d - 8, 45),
      ]).flat(),
    ]
  },
  front: ({ width, seats }) => sofaFront(0, atLeast(2 * SOFA_ARM + 200, width), SOFA_ARM, SOFA_ARM, seats),
  side: ({ depth }) => sofaSide(atLeast(2 * SOFA_BACK + 200, depth), SOFA_BACK),
})

/** A ring's stretch between two angles, `thickness` thick inside radius `r` about (cx, cy), as a closed shape: the curved back of a chair. */
function band(cx: number, cy: number, r: number, thickness: number, from: number, to: number): Primitive {
  const steps = 16
  const at = (radius: number, i: number) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    return pt(cx + radius * Math.cos(a), cy + radius * Math.sin(a))
  }
  return outline([...Array.from({ length: steps + 1 }, (_, i) => at(r, i)), ...Array.from({ length: steps + 1 }, (_, i) => at(r - thickness, steps - i))])
}

/** How high a chair's seat is, and the top of its back, in mm. */
const CHAIR_SEAT = 450
const CHAIR_BACK = 880

/** A dining chair, its back at the top: a seat rounder at the front, and a curved backrest behind it. */
export const chair: ParametricKind = {
  kind: 'arch.chair',
  label: 'Chair',
  category: 'dining',
  description: 'Its back at the top. Turn it to face the table.',
  params: [{ ...WIDTH, default: 450 }, DEPTH(480)],
  box: sizedBox('width', 'depth', 300),
  height: () => CHAIR_BACK,
  build({ width, depth }) {
    const [w, d] = [atLeast(300, width), atLeast(300, depth)]
    // The backrest, an arc across the width; the seat in front of it.
    const half = w / 2
    const r = Math.max(half * 1.5, 640 * (w / 450))
    const reach = (Math.asin(Math.min(1, (half - 4) / r)) * 180) / Math.PI
    return [band(half, r + 22, r, 44, 270 - reach, 270 + reach), roundBox(0, 76, w, d, [30, 30, 75, 75])]
  },
  front: ({ width }) => chairFront(atLeast(300, width)),
  back: ({ width }) => chairFront(atLeast(300, width)),
  side: ({ depth }) => {
    const d = atLeast(300, depth)
    return [rect(0, -CHAIR_SEAT + 20, d, -CHAIR_SEAT - 20), rect(25, 0, 50, -CHAIR_SEAT + 20, THIN), rect(d - 50, 0, d - 25, -CHAIR_SEAT + 20, THIN), outline([pt(22, -CHAIR_SEAT - 20), pt(0, -CHAIR_BACK), pt(44, -CHAIR_BACK), pt(66, -CHAIR_SEAT - 20)])]
  },
}
/** A chair seen from in front or behind: its legs, its seat, its back over the seat. */
const chairFront = (w: number): Primitive[] => [rect(0, -CHAIR_SEAT + 20, w, -CHAIR_SEAT - 20), rect(20, 0, 45, -CHAIR_SEAT + 20, THIN), rect(w - 45, 0, w - 20, -CHAIR_SEAT + 20, THIN), roundBox(10, -CHAIR_SEAT - 60, w - 10, -CHAIR_BACK, [20, 20, 0, 0])]

/** An office chair seen from above, its back at the top and its seat towards +Y: its curved back, its seat, its armrests, and the casters of its base where they show. */
function officeChairPlan(): Primitive[] {
  const [cx, cy, reach] = [330, 370, 330]
  const base = [270, 342, 54, 126, 198].flatMap((angle) => {
    const [dx, dy] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]
    return [line([pt(cx + 250 * dx, cy + 250 * dy), pt(cx + (reach - 28) * dx, cy + (reach - 28) * dy)], THIN), circle(cx + reach * dx, cy + reach * dy, 28, THIN)]
  })
  return [band(330, 900, 820, 70, 253, 287), roundBox(92, 150, 568, 590, [60, 60, 110, 110]), roundBox(46, 215, 88, 505, 21), roundBox(572, 215, 614, 505, 21), ...base.slice(2)]
}
/** How wide and deep the office chair is on the plan, from its back to the front of its base. */
const OFFICE = { width: 660, depth: 730 }
/** How high a desk's top is, in mm. */
const DESK_TOP = 750

/**
 * A desk against the wall with a screen, a keyboard and a mouse on it, and its office chair pulled
 * up to it, or none. In elevations, its top on its two sides, the screen, and the chair's back in front.
 */
export const desk: ParametricKind = {
  kind: 'arch.desk',
  label: 'Desk',
  category: 'office',
  description: 'Against the wall, with its office chair pulled up to it, or without. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: 1400 }, DEPTH(700), { key: 'chair', label: 'Office chair', type: 'boolean', default: true }],
  box: sizedBox('width', 'depth', 600, 400),
  mount: { on: 'floor' },
  height: () => DESK_TOP,
  build({ width, depth, chair }) {
    const [w, d] = [atLeast(600, width), atLeast(400, depth)]
    const mid = w / 2
    const prims: Primitive[] = [
      rect(0, 0, w, d),
      roundBox(mid - 70, 100, mid + 70, 180, 20, THIN),
      roundBox(mid - 280, 180, mid + 280, 212, 12, THIN),
      roundBox(mid - 220, d - 320, mid + 220, d - 170, 16, THIN),
      { kind: 'ellipse', cx: mid + 310, cy: d - 245, rx: 30, ry: 48, strokeWidth: 0.5 },
    ]
    // The chair turned to face the desk, its back away from it.
    if (chair !== false) prims.push(...officeChairPlan().map((p) => transformPrimitive(p, { x: mid + OFFICE.width / 2, y: d + 20 + OFFICE.depth, rotation: 180 })))
    return prims
  },
  front: ({ width, chair }) => {
    const w = atLeast(600, width)
    const mid = w / 2
    const prims: Primitive[] = [rect(0, -DESK_TOP + 30, w, -DESK_TOP), rect(0, 0, 30, -DESK_TOP + 30, THIN), rect(w - 30, 0, w, -DESK_TOP + 30, THIN), rect(mid - 280, -DESK_TOP - 60, mid + 280, -DESK_TOP - 380), line([pt(mid, -DESK_TOP), pt(mid, -DESK_TOP - 60)])]
    // The chair in front of it, seen from behind: its back over its seat, its column and its base.
    if (chair !== false) prims.push(roundBox(mid - 240, -520, mid + 240, -1050, 40, THIN), line([pt(mid, -470), pt(mid, -90)], { strokeWidth: 1.5 }), line([pt(mid - 300, -40), pt(mid + 300, -40)], THIN), circle(mid - 300, -20, 20, THIN), circle(mid + 300, -20, 20, THIN))
    return prims
  },
  side: ({ depth, chair }) => {
    const d = atLeast(400, depth)
    const prims: Primitive[] = [rect(0, -DESK_TOP + 30, d, -DESK_TOP), rect(0, 0, d, -DESK_TOP + 30, THIN), rect(120, -DESK_TOP, 140, -DESK_TOP - 380, THIN)]
    if (chair !== false) {
      const at = d + 20
      prims.push(
        rect(at + 60, -470, at + OFFICE.depth - 200, -520, THIN),
        outline([pt(at + OFFICE.depth - 200, -520), pt(at + OFFICE.depth - 160, -1050), pt(at + OFFICE.depth - 110, -1050), pt(at + OFFICE.depth - 150, -520)]),
        line([pt(at + 300, -470), pt(at + 300, -90)], { strokeWidth: 1.5 }),
        line([pt(at, -40), pt(at + OFFICE.depth - 100, -40)], THIN),
      )
    }
    return prims
  },
}

/**
 * The corner sofa from in front: the arm of its return at the corner end, its seats along, the arm at
 * the other end, its back over them; mirrored for one whose corner is on the right.
 */
function cornerSofaFront(props: Record<string, any>): Primitive[] {
  const { l, d } = cornerSofaSize(props)
  const prims = [...sofaFront(0, l, d, SOFA_ARM, Math.max(1, Math.round((l - SOFA_ARM - d) / SOFA_SEAT))), line([pt(d, -LEGS), pt(d, -ARM_TOP)], THIN)]
  return props.corner === 'Right' ? mirrorAlong(prims, l) : prims
}
/** The corner sofa from the end of its long side: that arm in front, and its return, seen from in front, behind it. */
function cornerSofaSide(props: Record<string, any>): Primitive[] {
  const { r, d } = cornerSofaSize(props)
  return [rect(0, -LEGS, d, -ARM_TOP), line([pt(d, -SEAT), pt(r - SOFA_ARM, -SEAT), pt(r - SOFA_ARM, -ARM_TOP), pt(r, -ARM_TOP), pt(r, -LEGS), pt(d, -LEGS)]), line([pt(0, -ARM_TOP), pt(0, -BACK_TOP), pt(r, -BACK_TOP), pt(r, -ARM_TOP)]), ...feet(0, r)]
}
