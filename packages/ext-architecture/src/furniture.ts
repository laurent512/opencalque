import { roundCorners, transformPrimitive, type ParametricKind, type Primitive } from '@opencalque/core'
import { drawer, rect } from './fronts'
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
/** How wide the office chair is on the plan. */
const OFFICE = { width: 660 }
/** How high a desk's top is, in mm. */
const DESK_TOP = 750

/**
 * A desk against the wall with a screen, a keyboard and a mouse on it. In elevations, its top on its
 * two sides and the screen. Its office chair is an object of its own (`officeChair`): until 1.12 the
 * desk drew one pulled up to it, which drawings of then hold as a chair of their own since (format 5).
 */
export const desk: ParametricKind = {
  kind: 'arch.desk',
  label: 'Desk',
  category: 'office',
  description: 'Against the wall. Pull its sides to make it wider or deeper. Its office chair is an object of its own.',
  params: [{ ...WIDTH, default: 1400 }, DEPTH(700)],
  box: sizedBox('width', 'depth', 600, 400),
  mount: { on: 'floor' },
  height: () => DESK_TOP,
  build({ width, depth }) {
    const [w, d] = [atLeast(600, width), atLeast(400, depth)]
    const mid = w / 2
    return [
      rect(0, 0, w, d),
      roundBox(mid - 70, 100, mid + 70, 180, 20, THIN),
      roundBox(mid - 280, 180, mid + 280, 212, 12, THIN),
      roundBox(mid - 220, d - 320, mid + 220, d - 170, 16, THIN),
      { kind: 'ellipse', cx: mid + 310, cy: d - 245, rx: 30, ry: 48, strokeWidth: 0.5 },
    ]
  },
  front: ({ width }) => {
    const w = atLeast(600, width)
    const mid = w / 2
    return [rect(0, -DESK_TOP + 30, w, -DESK_TOP), rect(0, 0, 30, -DESK_TOP + 30, THIN), rect(w - 30, 0, w, -DESK_TOP + 30, THIN), rect(mid - 280, -DESK_TOP - 60, mid + 280, -DESK_TOP - 380), line([pt(mid, -DESK_TOP), pt(mid, -DESK_TOP - 60)])]
  },
  side: ({ depth }) => {
    const d = atLeast(400, depth)
    return [rect(0, -DESK_TOP + 30, d, -DESK_TOP), rect(0, 0, d, -DESK_TOP + 30, THIN), rect(120, -DESK_TOP, 140, -DESK_TOP - 380, THIN)]
  },
}

/** How high an office chair's seat and the top of its back are, in mm. */
const OFFICE_SEAT = 470
const OFFICE_BACK = 1050
/** An office chair seen from in front or from behind: its back over its seat, its armrests, its column and its base on two of its casters. */
const officeChairFront = (): Primitive[] => {
  const mid = OFFICE.width / 2
  return [
    roundBox(mid - 240, -OFFICE_SEAT - 50, mid + 240, -OFFICE_BACK, 40),
    rect(92, -OFFICE_SEAT, 568, -OFFICE_SEAT - 50),
    roundBox(46, -OFFICE_SEAT - 180, 88, -OFFICE_SEAT - 220, 15, THIN),
    roundBox(572, -OFFICE_SEAT - 180, 614, -OFFICE_SEAT - 220, 15, THIN),
    line([pt(67, -OFFICE_SEAT - 180), pt(67, -OFFICE_SEAT - 50)], THIN),
    line([pt(593, -OFFICE_SEAT - 180), pt(593, -OFFICE_SEAT - 50)], THIN),
    line([pt(mid, -OFFICE_SEAT), pt(mid, -90)], { strokeWidth: 1.5 }),
    line([pt(mid - 300, -40), pt(mid + 300, -40)], THIN),
    circle(mid - 300, -20, 20, THIN),
    circle(mid + 300, -20, 20, THIN),
  ]
}

/**
 * An office chair on its five casters, its back at the top: a seat, armrests, a curved back. It
 * stands in the room, turned to face its desk, as the dining chair does.
 */
export const officeChair: ParametricKind = {
  kind: 'arch.officechair',
  label: 'Office chair',
  category: 'office',
  description: 'On five casters, its back at the top. Turn it to face the desk.',
  params: [],
  height: () => OFFICE_BACK,
  build: () => officeChairPlan(),
  front: () => officeChairFront(),
  back: () => officeChairFront(),
  // From its side, its own Y from its back: the back leaning over the seat, the column, the base.
  side: () => [
    rect(60, -OFFICE_SEAT, 530, -OFFICE_SEAT - 50, THIN),
    outline([pt(200, -OFFICE_SEAT - 50), pt(160, -OFFICE_BACK), pt(110, -OFFICE_BACK), pt(150, -OFFICE_SEAT - 50)]),
    line([pt(370, -OFFICE_SEAT), pt(370, -90)], { strokeWidth: 1.5 }),
    line([pt(70, -40), pt(670, -40)], THIN),
    circle(70, -20, 20, THIN),
    circle(670, -20, 20, THIN),
  ],
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

/** How high a banquette's base is, the top of its seat, its plinth and an end panel, in mm. */
const BANQUETTE_BASE = 370
const BANQUETTE_SEAT = 450
const BANQUETTE_PLINTH = 80
const BANQUETTE_END_TOP = 650
/** About how wide a seat of a banquette is: it takes as many as its length holds. */
const BANQUETTE_PLACE = 600
/** How thick its back is, of cushions or of a panel, and an end panel, in mm. */
const BANQUETTE_BACK = { Cushions: 150, Panel: 60 } as Record<string, number>
const BANQUETTE_END = 40
/** The least it is made long and deep, in mm. */
const MIN_BANQUETTE = 600
const MIN_BANQUETTE_DEPTH = 350
/** The most places drawn: a length typed by mistake must not draw a thousand cushions. */
const MAX_PLACES = 30

/** A banquette's sizes and parts, from its parameters: what its ends and its back take, and the stretches of its places. */
function banquetteParts({ width, depth, height, back, ends }: Record<string, any>) {
  const w = atLeast(MIN_BANQUETTE, width)
  const d = atLeast(MIN_BANQUETTE_DEPTH, depth)
  const left = ends === 'Left' || ends === 'Both' ? BANQUETTE_END : 0
  const right = ends === 'Right' || ends === 'Both' ? BANQUETTE_END : 0
  const [a, b] = [left, w - right]
  const n = Math.min(MAX_PLACES, Math.max(1, Math.round((b - a) / BANQUETTE_PLACE)))
  const places = Array.from({ length: n }, (_, i) => [a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n] as const)
  const thick = BANQUETTE_BACK[back] ?? 0
  const top = thick > 0 ? Math.max(BANQUETTE_SEAT + 100, Number(height) || 0) : BANQUETTE_SEAT
  return { w, d, left, right, a, b, places, thick, top }
}

/**
 * A banquette: a bench built along a wall, its back against it, as long as it is made, with a seat
 * cushion for about every 60 cm and, behind them, back cushions, a panel or nothing. Its base is
 * closed, holds a drawer under each place, or stands on legs; a panel may close either end. Seen
 * from in front and from its side, it shows all of it.
 */
export const banquette: ParametricKind = {
  kind: 'arch.banquette',
  label: 'Banquette',
  category: 'dining',
  description: 'A bench built along the wall, its back against it. Pull its sides to make it longer: it takes a seat for about every 60 cm.',
  params: [
    { ...WIDTH, label: 'Length', default: 1800 },
    DEPTH(500),
    { key: 'height', label: 'Height', type: 'number', default: 900, unit: 'length', shown: ({ back }) => back !== 'None' },
    { key: 'back', label: 'Back', type: 'string', default: 'Cushions', options: ['Cushions', 'Panel', 'None'] },
    { key: 'base', label: 'Base', type: 'string', default: 'Closed', options: ['Closed', 'Drawers', 'Legs'] },
    { key: 'ends', label: 'End panels', type: 'string', default: 'None', options: ['None', 'Left', 'Right', 'Both'] },
  ],
  box: sizedBox('width', 'depth', MIN_BANQUETTE, MIN_BANQUETTE_DEPTH),
  mount: { on: 'floor' },
  height: (props) => banquetteParts(props).top,
  build(props) {
    const { w, d, left, right, places, thick, back } = { ...banquetteParts(props), back: props.back }
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    if (left) prims.push(line([pt(left, 0), pt(left, d)]))
    if (right) prims.push(line([pt(w - right, 0), pt(w - right, d)]))
    for (const [x0, x1] of places) {
      if (back === 'Cushions') prims.push(roundBox(x0 + 6, 6, x1 - 6, thick - 6, 40))
      prims.push(roundBox(x0 + 6, thick + 6, x1 - 6, d - 8, 40))
    }
    if (back === 'Panel') prims.push(line([pt(left, thick), pt(w - right, thick)], THIN))
    return prims
  },
  front(props) {
    const { w, a, b, places, top, left, right } = banquetteParts(props)
    const prims: Primitive[] = []
    // The base, under the seat.
    if (props.base === 'Legs') {
      const rail = BANQUETTE_BASE - 70
      prims.push(rect(a, -rail, b, -BANQUETTE_BASE))
      // A leg at each end, and one about every 1.2 m between.
      const between = Math.max(0, Math.round((b - a) / 1200) - 1)
      const legs = [a + 30, ...Array.from({ length: between }, (_, i) => a + ((b - a) * (i + 1)) / (between + 1) - 20), b - 70]
      for (const x of legs) prims.push(rect(x, 0, x + 40, -rail, THIN))
    } else {
      prims.push(outline([pt(a + 50, 0), pt(b - 50, 0), pt(b - 50, -BANQUETTE_PLINTH), pt(b, -BANQUETTE_PLINTH), pt(b, -BANQUETTE_BASE), pt(a, -BANQUETTE_BASE), pt(a, -BANQUETTE_PLINTH), pt(a + 50, -BANQUETTE_PLINTH)]))
      // The plinth set back under it.
      prims.push(line([pt(a + 50, -BANQUETTE_PLINTH), pt(b - 50, -BANQUETTE_PLINTH)], THIN))
      if (props.base === 'Drawers') for (const [x0, x1] of places) prims.push(...drawer(x0 + 20, x1 - 20, -BANQUETTE_PLINTH - 30, -BANQUETTE_BASE + 30))
    }
    // The seat cushions on it, and the back over them.
    for (const [x0, x1] of places) {
      prims.push(roundBox(x0 + 4, -BANQUETTE_BASE, x1 - 4, -BANQUETTE_SEAT, 15))
      if (props.back === 'Cushions') prims.push(roundBox(x0 + 4, -BANQUETTE_SEAT - 10, x1 - 4, -top, 30))
    }
    if (props.back === 'Panel') prims.push(rect(a, -BANQUETTE_SEAT, b, -top), line([pt(a, -top + 40), pt(b, -top + 40)], THIN))
    // The end panels, from the floor.
    const end = Math.min(top, BANQUETTE_END_TOP)
    if (left) prims.push(rect(0, 0, left, -end))
    if (right) prims.push(rect(w - right, 0, w, -end))
    return prims
  },
  side(props) {
    const { d, thick, top, left, right } = banquetteParts(props)
    const prims: Primitive[] = []
    if (props.base === 'Legs') {
      const rail = BANQUETTE_BASE - 70
      prims.push(rect(0, -rail, d, -BANQUETTE_BASE), rect(30, 0, 70, -rail, THIN), rect(d - 70, 0, d - 30, -rail, THIN))
    } else prims.push(outline([pt(0, 0), pt(d - 50, 0), pt(d - 50, -BANQUETTE_PLINTH), pt(d, -BANQUETTE_PLINTH), pt(d, -BANQUETTE_BASE), pt(0, -BANQUETTE_BASE)]))
    prims.push(roundBox(thick, -BANQUETTE_BASE, d, -BANQUETTE_SEAT, 15))
    // Back cushions lean back against the wall; a panel stands upright.
    if (props.back === 'Cushions') prims.push(outline([pt(0, -BANQUETTE_SEAT), pt(thick, -BANQUETTE_SEAT), pt(thick * 0.55, -top), pt(0, -top)]))
    else if (props.back === 'Panel') prims.push(rect(0, -BANQUETTE_SEAT, thick, -top))
    // An end panel is what is seen of it from that end.
    if (left || right) prims.push(rect(0, 0, d, -Math.min(top, BANQUETTE_END_TOP), THIN))
    return prims
  },
}
