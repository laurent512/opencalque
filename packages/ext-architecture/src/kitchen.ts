import type { ParamDef, ParametricKind, Primitive } from '@opencalque/core'
import { boxSide, door, frontsOf, FRONTS, MAX_FRONTS, microwave, oven, PLINTH, rect, unitFront, unitSide, WORKTOP } from './fronts'
import { atLeast, circle, clamp, count, DEPTH, HEIGHT, line, MAX_BOWLS, outline, pt, roundBox, sizedBox, THIN, WIDTH } from './shared'

// Kitchen pieces stand against the wall by their top edge, as the units of the kitchen library do,
// each in its stretch of worktop: placed side by side, they make a run of units.

/** The least a hob or a sink is made, either way, by pulling its sides, in mm. */
const MIN_COUNTER_UNIT = 300

/**
 * A hob in its stretch of worktop: its glass top and its cooking zones, each with its ring. Its
 * zones keep their size as it is made wider, made smaller only when it is too small to hold them:
 * two one behind the other on a narrow one, four from 450 mm, and from 750 mm a larger fifth in the
 * middle, as on hobs of 80 and 90 cm.
 */
export const hob: ParametricKind = {
  kind: 'arch.hob',
  label: 'Hob',
  category: 'kitchen',
  description: 'Pull its sides to make it wider, 80 or 90 cm: its zones keep their size, and from 75 cm it has a fifth in the middle.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(600), { key: 'below', label: 'Below', type: 'string', default: 'Oven', options: [...FRONTS, 'None'] }],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
  // Seen from in front, the unit it is set in, the glass standing on the worktop.
  front: ({ width, below }) => {
    const w = atLeast(1, width)
    return [...counterFront(w, below), rect(15, -COUNTER, w - 15, -COUNTER - 6)]
  },
  side: ({ depth, below }) => [...counterSide(atLeast(1, depth), below), rect(30, -COUNTER, atLeast(1, depth) - 50, -COUNTER - 6)],
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const zone = (cx: number, cy: number, r: number): Primitive[] => [circle(cx, cy, r), circle(cx, cy, r * 0.45, THIN)]
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), roundBox(25, 25, w - 25, d - 25, Math.min(20, w / 4, d / 4), THIN)]
    const back = Math.min(170, d * 0.283)
    const front = d - back
    if (w < 450) {
      // A large zone behind a small one, each kept inside the glass and clear of the other.
      const s = clamp(Math.min((w / 2 - 35) / 100, (front - back - 20) / 175, (back - 35) / 100), 0.1, 1)
      return [...prims, ...zone(w / 2, back, 100 * s), ...zone(w / 2, front, 75 * s)]
    }
    const left = Math.min(170, w * 0.283)
    const right = w - left
    const s = clamp(Math.min((Math.min(right - left, front - back) - 20) / 175, (Math.min(left, back) - 35) / 100), 0.1, 1)
    prims.push(...zone(left, back, 100 * s), ...zone(right, back, 75 * s), ...zone(left, front, 75 * s), ...zone(right, front, 100 * s))
    if (w >= 750) {
      const middle = Math.min(130, w / 2 - left - 100 * s - 20, d / 2 - 35)
      if (middle > 20) prims.push(...zone(w / 2, d / 2, middle))
    }
    return prims
  },
}

/**
 * A sink in its stretch of worktop: one bowl or more, each with its drain, the tap behind them,
 * and a ribbed draining board on one side or none. Its bowls keep their size as it is made wider,
 * each in the middle of its share of what the draining board leaves, made smaller only when that
 * share cannot hold them.
 */
export const sink: ParametricKind = {
  kind: 'arch.sink',
  label: 'Sink',
  category: 'kitchen',
  description: 'A sink in its stretch of worktop, with a draining board on one side or none. Pull its sides to make it wider, 80 or 90 cm: its bowls keep their size.',
  params: [
    { ...WIDTH, default: 800 },
    DEPTH(600),
    // Named apart from a washbasin's bowls, which some languages call otherwise.
    { key: 'bowls', label: 'Basins', type: 'number', default: 1 },
    { key: 'drainer', label: 'Draining board', type: 'string', default: 'None', options: ['None', 'Left', 'Right'] },
    { key: 'below', label: 'Below', type: 'string', default: 'Doors', options: ['Doors', 'Drawers', 'None'] },
  ],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
  // Seen from in front, the unit under it and its tap standing over the worktop where the plan has it.
  front: ({ width, drainer, below }) => {
    const w = atLeast(1, width)
    const board = drainer === 'Left' || drainer === 'Right' ? Math.min(450, w * 0.4) : 0
    const from = drainer === 'Left' ? board : 0
    return [...counterFront(w, below, 2), ...tapFront(from + (w - board) / 2)]
  },
  side: ({ depth, below }) => {
    const d = atLeast(1, depth)
    // The tap behind the bowls, as on the plan, its spout reaching over them.
    const tap = Math.min(120, d / 4)
    return [...counterSide(d, below), line([pt(tap, -COUNTER), pt(tap, -COUNTER - 300), pt(tap + 180, -COUNTER - 300), pt(tap + 180, -COUNTER - 230)], { strokeWidth: 1.5 })]
  },
  build({ width, depth, bowls, drainer }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const n = Math.min(MAX_BOWLS, count(bowls))
    const board = drainer === 'Left' || drainer === 'Right' ? Math.min(450, w * 0.4) : 0
    const from = drainer === 'Left' ? board : 0
    const share = (w - board) / n
    const bowlWidth = clamp(share - 80, 40, 450)
    const bowlDepth = clamp(d - 190, 40, 400)
    // The tap behind the bowls, the bowls a little nearer the front than the back.
    const top = (d - bowlDepth) / 2 + 20
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    for (let i = 0; i < n; i++) {
      const cx = from + (i + 0.5) * share
      const drain = Math.min(35, bowlWidth / 6)
      prims.push(
        roundBox(cx - bowlWidth / 2, top, cx + bowlWidth / 2, top + bowlDepth, Math.min(60, bowlWidth / 4, bowlDepth / 4)),
        circle(cx, top + bowlDepth / 2, drain, THIN),
        circle(cx, top + bowlDepth / 2, drain / 2, THIN),
      )
    }
    // One tap for all the bowls, its spout reaching over them.
    const tap = from + (w - board) / 2
    const tapY = top / 2
    prims.push(circle(tap, tapY, Math.min(22, tapY / 2)), line([pt(tap, tapY + Math.min(22, tapY / 2)), pt(tap, top + Math.min(60, bowlDepth / 2))], THIN))
    if (board > 0) {
      const x0 = drainer === 'Left' ? 20 : w - board + 10
      const x1 = drainer === 'Left' ? board - 10 : w - 20
      prims.push(roundBox(x0, top, x1, top + bowlDepth, Math.min(40, (x1 - x0) / 4, bowlDepth / 4), THIN))
      // Its ribs, every 70 mm, as many as it holds, in its middle.
      const ribs = Math.max(0, Math.floor((x1 - x0 - 80) / 70) + 1)
      const start = (x0 + x1 - (ribs - 1) * 70) / 2
      for (let k = 0; k < ribs; k++) prims.push(line([pt(start + k * 70, top + 40), pt(start + k * 70, top + bowlDepth - 40)], THIN))
    }
    return prims
  },
}

/** The least a fridge is made, either way, by pulling its sides, in mm. */
const MIN_FRIDGE = 400

/**
 * A fridge: its body against the wall and its doors at the front, one, or two side by side as on
 * an American fridge, each with its handle by the edge it opens from.
 */
export const fridge = (kind: string, label: string, width: number, depth: number, doors: number, height: number): ParametricKind => ({
  kind,
  label,
  category: 'kitchen',
  description: 'Its doors are at the front, away from the wall. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: width }, DEPTH(depth), { key: 'doors', label: 'Doors', type: 'number', default: doors }],
  box: sizedBox('width', 'depth', MIN_FRIDGE),
  // Seen from in front: one door over the freezer's, or two side by side with a dispenser on the
  // left one; the handles by the edges they open from, as on the plan.
  front({ width, doors }) {
    const w = atLeast(1, width)
    const base = Math.min(60, height / 20)
    const body = rect(0, 0, w, -height)
    if (Math.min(2, count(doors)) === 1) {
      const split = -base - (height - base) * 0.36
      return [body, line([pt(0, -base), pt(w, -base)], THIN), ...door(0, w, -base - 3, split, 'left'), ...door(0, w, split - 3, -height + 3, 'left')]
    }
    const dispenser = Math.min(180, w / 5)
    return [
      body,
      line([pt(0, -base), pt(w, -base)], THIN),
      ...door(0, w / 2 - 2, -base - 3, -height + 3, 'right'),
      ...door(w / 2 + 2, w, -base - 3, -height + 3, 'left'),
      roundBox(w / 4 - dispenser / 2, -height * 0.52, w / 4 + dispenser / 2, -height * 0.52 - dispenser * 1.5, 12, THIN),
    ]
  },
  side: ({ depth }) => boxSide(atLeast(1, depth), height, Math.min(60, atLeast(1, depth) / 5)),
  build({ width, depth, doors }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const door = Math.min(60, d / 5)
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d - door), pt(0, d - door)])]
    const handle = (from: number, to: number) => line([pt(from, d - door / 2), pt(to, d - door / 2)], THIN)
    if (Math.min(2, count(doors)) === 1) {
      prims.push(roundBox(0, d - door, w, d, [0, 0, 12, 12]), handle(40, Math.min(200, w / 3)))
    } else {
      const reach = Math.min(150, w / 4 - 40)
      prims.push(roundBox(0, d - door, w / 2, d, [0, 0, 0, 12]), roundBox(w / 2, d - door, w, d, [0, 0, 12, 0]), handle(w / 2 - 30 - reach, w / 2 - 30), handle(w / 2 + 30, w / 2 + 30 + reach))
    }
    return prims
  },
})

/** The most doors a wall cabinet is drawn with: a value typed by mistake must not draw a thousand. */
const MAX_DOORS = 8
/** What is above the plane a plan is cut at is drawn dashed. */
const ABOVE = [6, 4]

/**
 * A wall cabinet ("meuble haut"): hung on the wall above the worktop, its back against the face
 * (its own Y = 0), at a height that is that of its underside, as a fitter measures it. On the plan,
 * as what is above the cut, dashed, crossed corner to corner; seen from in front, its doors, each
 * with its handle near the bottom.
 */
export const wallCabinet: ParametricKind = {
  kind: 'arch.wallcabinet',
  label: 'Wall cabinet',
  category: 'kitchen',
  description: 'Hung on the wall above the worktop, drawn dashed as what is above the cut is. Its height above the floor is that of its underside.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(350), HEIGHT(700), { key: 'doors', label: 'Doors', type: 'number', default: 1 }],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT, 200),
  mount: { on: 'wall', height: 1450, measured: 'bottom' },
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    return [
      { kind: 'path', points: [pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)], closed: true, dash: ABOVE },
      line([pt(0, 0), pt(w, d)], { strokeWidth: 0.5, dash: ABOVE }),
      line([pt(w, 0), pt(0, d)], { strokeWidth: 0.5, dash: ABOVE }),
    ]
  },
  front({ width, height, doors }) {
    const w = atLeast(1, width)
    const h = atLeast(1, height)
    const n = Math.min(MAX_DOORS, count(doors))
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, -h), pt(0, -h)])]
    for (let i = 1; i < n; i++) prims.push(line([pt((w * i) / n, 0), pt((w * i) / n, -h)], THIN))
    // A handle along the bottom of each door, in its middle, where it is reached from below.
    for (let i = 0; i < n; i++) {
      const middle = (w * (i + 0.5)) / n
      const reach = Math.min(50, w / n / 4)
      prims.push(line([pt(middle - reach, -45), pt(middle + reach, -45)], { strokeWidth: 2 }))
    }
    return prims
  },
  side: ({ depth, height }) => boxSide(atLeast(1, depth), atLeast(1, height)),
}


/** How high the top of a kitchen worktop stands, in mm: that of the hob's and the sink's. */
const COUNTER = 900

/** The unit a hob or a sink is set in, seen from in front: its worktop, and what it holds below, or the worktop alone over nothing. */
function counterFront(w: number, below: string, leaves = w > 600 ? 2 : 1): Primitive[] {
  if (below === 'None') return [rect(0, -COUNTER + WORKTOP, w, -COUNTER)]
  return unitFront(w, COUNTER, true, (y0, y1) => frontsOf(below, 0, w, y0, y1, leaves, 3))
}
/** The same seen from its side. */
const counterSide = (d: number, below: string): Primitive[] => (below === 'None' ? [rect(0, -COUNTER + WORKTOP, d, -COUNTER)] : unitSide(d, COUNTER, true))

/** A tap seen from in front, standing on the worktop at `x`: its base, its stem, its lever. */
const tapFront = (x: number): Primitive[] => [
  rect(x - 25, -COUNTER, x + 25, -COUNTER - 40),
  line([pt(x, -COUNTER - 40), pt(x, -COUNTER - 300)], { strokeWidth: 1.5 }),
  line([pt(x - 18, -COUNTER - 300), pt(x + 18, -COUNTER - 300)], { strokeWidth: 1.5 }),
  line([pt(x, -COUNTER - 90), pt(x + 70, -COUNTER - 120)], { strokeWidth: 1.5 }),
]

/** The least a unit is made, either way, by pulling its sides, in mm. */
const MIN_UNIT = 150
const WORKTOP_ON: ParamDef = { key: 'worktop', label: 'Worktop', type: 'boolean', default: true }
const FRONTS_PARAM: ParamDef = { key: 'fronts', label: 'Fronts', type: 'string', default: 'Doors', options: FRONTS }
const DOORS = (n: number): ParamDef => ({ key: 'doors', label: 'Doors', type: 'number', default: n })
const DRAWERS = (n: number): ParamDef => ({ key: 'drawers', label: 'Drawers', type: 'number', default: n })

/** A plan as a rectangle `w` by `d`, and the line of its fronts `inset` from its front edge, thin, when there is one. */
const planBox = (w: number, d: number, inset = 0): Primitive[] => [
  outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]),
  ...(inset > 0 && inset < d ? [line([pt(0, d - inset), pt(w, d - inset)], THIN)] : []),
]

/**
 * A base unit ("meuble bas"): a kitchen unit standing against the wall, its worktop on it (or none,
 * under a worktop of its own), and behind its fronts doors, drawers, a drawer over a door, or an
 * oven. On the plan, its worktop and the line of its fronts under it; in elevations, its fronts.
 */
export const baseUnit: ParametricKind = {
  kind: 'arch.baseunit',
  label: 'Base unit',
  category: 'kitchen',
  description: 'A kitchen unit with its worktop, against the wall: doors, drawers or an oven, as elevations show it. Pull its sides to make it wider.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(600), HEIGHT(COUNTER), FRONTS_PARAM, DOORS(1), DRAWERS(3), WORKTOP_ON],
  box: sizedBox('width', 'depth', MIN_UNIT),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth, worktop }) => planBox(atLeast(1, width), atLeast(1, depth), worktop !== false ? 20 : 0),
  front: ({ width, height, fronts, doors, drawers, worktop }) => {
    const w = atLeast(1, width)
    return unitFront(w, atLeast(PLINTH + 50, height), worktop !== false, (y0, y1) => frontsOf(fronts, 0, w, y0, y1, doors, drawers))
  },
  side: ({ depth, height, worktop }) => unitSide(atLeast(1, depth), atLeast(PLINTH + 50, height), worktop !== false),
}

/** A length of worktop on its own: over appliances or a gap between units, or the top of an island. Its height is that of its top. */
export const worktop: ParametricKind = {
  kind: 'arch.worktop',
  label: 'Worktop',
  category: 'kitchen',
  description: 'A length of worktop on its own, over appliances or between units, or the top of an island. Its height is that of its top.',
  params: [{ ...WIDTH, default: 1200 }, DEPTH(650), { key: 'thickness', label: 'Thickness', type: 'number', default: WORKTOP, unit: 'length' }, HEIGHT(COUNTER)],
  box: sizedBox('width', 'depth', MIN_UNIT, 100),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => planBox(atLeast(1, width), atLeast(1, depth)),
  front: ({ width, thickness, height }) => [rect(0, -Math.max(0, height - atLeast(1, thickness)), atLeast(1, width), -atLeast(1, height))],
  side: ({ depth, thickness, height }) => [rect(0, -Math.max(0, height - atLeast(1, thickness)), atLeast(1, depth), -atLeast(1, height))],
}

/** Doors across x0 to x1 from y0 up to y1, when there is room for them: one opens from its right, two from where they meet. */
function doorsIn(x0: number, x1: number, y0: number, y1: number, leaves: number): Primitive[] {
  if (y0 - y1 < 60) return []
  const n = Math.min(MAX_FRONTS, count(leaves))
  const each = (x1 - x0) / n
  return Array.from({ length: n }, (_, i) => door(x0 + i * each + (i > 0 ? 1.5 : 0), x0 + (i + 1) * each - (i < n - 1 ? 1.5 : 0), y0, y1, n === 1 || i % 2 === 0 ? 'right' : 'left')).flat()
}

/**
 * A tall unit ("colonne"): from the floor to the height of the wall cabinets, holding an oven and a
 * microwave one over the other, an oven, a built-in fridge, or shelves behind doors. On the plan,
 * crossed from corner to corner, as what goes up past the cut.
 */
export const tallUnit: ParametricKind = {
  kind: 'arch.tallunit',
  label: 'Tall unit',
  category: 'kitchen',
  description: 'A unit from the floor to the top of the wall cabinets: an oven and a microwave, an oven, a built-in fridge, or shelves behind doors.',
  params: [
    { ...WIDTH, default: 600 },
    DEPTH(600),
    HEIGHT(2150),
    { key: 'contents', label: 'Contents', type: 'string', default: 'Oven and microwave', options: ['Oven and microwave', 'Oven', 'Fridge', 'Doors'] },
  ],
  box: sizedBox('width', 'depth', MIN_UNIT),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    return [...planBox(w, d, 20), line([pt(0, 0), pt(w, Math.max(0, d - 20))], THIN)]
  },
  front: ({ width, height, contents }) => {
    const w = atLeast(1, width)
    const h = atLeast(PLINTH + 100, height)
    const leaves = w >= 800 ? 2 : 1
    const top = -h + 3
    // Each part up to a height above the floor, as far as the unit is high; left out where it has no room.
    const level = (mm: number) => Math.max(top, -mm)
    const prims: Primitive[] = [rect(0, 0, w, -h), line([pt(0, -PLINTH), pt(w, -PLINTH)], THIN)]
    const floor = -PLINTH - 3
    if (contents === 'Doors') return [...prims, ...doorsIn(0, w, floor, top, leaves)]
    if (contents === 'Fridge') return [...prims, ...doorsIn(0, w, floor, level(850), 1), ...doorsIn(0, w, level(853), top, 1)]
    const [ovenAt, ovenTop] = [level(850), level(1445)]
    prims.push(...doorsIn(0, w, floor, ovenAt, leaves))
    if (ovenAt - 3 - ovenTop > 60) prims.push(...oven(0, w, ovenAt - 3, ovenTop))
    let above = ovenTop - 3
    if (contents === 'Oven and microwave' && above - level(1835) > 60) {
      prims.push(...microwave(0, w, above, level(1835)))
      above = level(1835) - 3
    }
    return [...prims, ...doorsIn(0, w, above, top, leaves)]
  },
  side: ({ depth, height }) => unitSide(atLeast(1, depth), atLeast(PLINTH + 100, height), false),
}

/** A dishwasher under the worktop: its door from the plinth up, its controls along the top of it. On the plan, its racks inside it. */
export const dishwasher: ParametricKind = {
  kind: 'arch.dishwasher',
  label: 'Dishwasher',
  category: 'kitchen',
  description: 'Under the worktop, 60 or 45 cm wide: pull its sides.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(600), HEIGHT(COUNTER), WORKTOP_ON],
  box: sizedBox('width', 'depth', MIN_UNIT),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth, worktop }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    const inset = Math.min(60, w / 6, d / 6)
    return [...planBox(w, d, worktop !== false ? 20 : 0), roundBox(inset, inset, w - inset, d - inset - 20, Math.min(30, inset), THIN)]
  },
  front: ({ width, height, worktop }) => {
    const w = atLeast(1, width)
    return unitFront(w, atLeast(PLINTH + 100, height), worktop !== false, (y0, y1) => {
      const [a, b] = [y0 - 3, y1 + 3]
      const strip = Math.min(70, (a - b) / 6)
      const reach = Math.min(90, w / 4)
      return [rect(0, a, w, b, THIN), line([pt(0, b + strip), pt(w, b + strip)], THIN), line([pt(w / 2 - reach, b + strip + 30), pt(w / 2 + reach, b + strip + 30)], { strokeWidth: 2 })]
    })
  },
  side: ({ depth, height, worktop }) => unitSide(atLeast(1, depth), atLeast(PLINTH + 100, height), worktop !== false),
}

/**
 * A front-loading washing machine. Seen from above, as every symbol is, its back at the top: its
 * top, the drum under it in dashed lines as what is hidden is drawn, and what stands out of its
 * front, the porthole door in the middle and the programme knob at the right. Seen from in front,
 * its control panel, its drawer for the powder and its porthole.
 */
export const washingMachine: ParametricKind = {
  kind: 'arch.washer',
  label: 'Washing machine',
  category: 'kitchen',
  description: 'Free-standing, or under the worktop: its door is at the front.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(600), HEIGHT(850)],
  box: sizedBox('width', 'depth', 300),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    // The door bulges 40 mm out of the front: part of a circle through its two edges on the front and its middle.
    const front = Math.max(d / 2, d - 40)
    const [chord, bulge] = [Math.min(200, w / 3), Math.max(1, d - front)]
    const r = (chord ** 2 + bulge ** 2) / (2 * bulge)
    const centre = pt(w / 2, front + bulge - r)
    const sweep = Math.asin(Math.min(1, chord / r))
    const arc = Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI / 2 - sweep + (i / 12) * 2 * sweep
      return pt(centre.x + r * Math.cos(a), centre.y + r * Math.sin(a))
    })
    const drum = Math.min(210, w * 0.35, d * 0.35)
    return [
      roundBox(0, 0, w, front, [20, 20, 6, 6]),
      { kind: 'ellipse', cx: w / 2, cy: d / 2, rx: drum, ry: drum, strokeWidth: 0.5, dash: [12, 8] },
      outline(arc),
      roundBox(w - Math.min(150, w / 4), front, w - Math.min(80, w / 8), front + 22, [0, 0, 8, 8], THIN),
    ]
  },
  front: ({ width, height }) => {
    const w = atLeast(1, width)
    const h = atLeast(300, height)
    const panel = Math.min(110, h / 6)
    const r = Math.min(210, w * 0.35, (h - panel) / 2 - 40)
    const cy = -(h - panel) / 2 - 20
    return [
      roundBox(0, 0, w, -h, [0, 0, 12, 12]),
      line([pt(0, -h + panel), pt(w, -h + panel)], THIN),
      rect(25, -h + panel - 15, Math.min(220, w * 0.37), -h + 25, THIN),
      roundBox(w / 2 - 50, -h + panel - 35, w / 2 + 50, -h + 35, 6, THIN),
      circle(w - 80, -h + panel / 2, Math.min(26, panel / 3), THIN),
      circle(w / 2, cy, r),
      circle(w / 2, cy, r * 0.74, THIN),
      line([pt(0, -40), pt(w, -40)], THIN),
    ]
  },
  side: ({ depth, height }) => {
    const d = atLeast(1, depth)
    const h = atLeast(300, height)
    const panel = Math.min(110, h / 6)
    const body = Math.max(d / 2, d - 40)
    const r = Math.min(210, (h - panel) / 2 - 40)
    const cy = -(h - panel) / 2 - 20
    return [rect(0, 0, body, -h), roundBox(body, cy + r * 0.8, d, cy - r * 0.8, [0, 12, 12, 0], THIN)]
  },
}

/** What is above the plane a plan is cut at is drawn dashed. */
const HIGH = [6, 4]

/**
 * A range hood ("hotte") over the hob, fixed on the wall at the height of its underside, 65 cm
 * above the worktop: with a chimney up to the ceiling, or flat under a wall cabinet. On the plan,
 * dashed, as what is above the cut, with its chimney and its filter.
 */
export const hood: ParametricKind = {
  kind: 'arch.hood',
  label: 'Range hood',
  category: 'kitchen',
  description: 'Fixed on the wall over the hob, drawn dashed as what is above the cut is. Its height above the floor is that of its underside, 65 cm over the worktop.',
  params: [
    { ...WIDTH, default: 600 },
    DEPTH(500),
    { key: 'style', label: 'Style', type: 'string', default: 'Chimney', options: ['Chimney', 'Flat'] },
    { key: 'chimney', label: 'Chimney height', type: 'number', default: 700, unit: 'length' },
  ],
  box: sizedBox('width', 'depth', 300, 200),
  mount: { on: 'wall', height: COUNTER + 650, measured: 'bottom' },
  build: ({ width, depth, style }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    const half = Math.min(140, w / 4)
    const filter = Math.min(90, w / 6, d / 5)
    const prims: Primitive[] = [{ kind: 'path', points: [pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)], closed: true, dash: HIGH }]
    if (style !== 'Flat') prims.push({ kind: 'path', points: [pt(w / 2 - half, 0), pt(w / 2 + half, 0), pt(w / 2 + half, Math.min(250, d / 2)), pt(w / 2 - half, Math.min(250, d / 2))], closed: true, dash: HIGH, strokeWidth: 0.5 })
    prims.push({ kind: 'ellipse', cx: w / 2, cy: d * 0.6, rx: filter, ry: filter, dash: HIGH, strokeWidth: 0.5 })
    return prims
  },
  front: ({ width, style, chimney }) => {
    const w = atLeast(1, width)
    const buttons = [0, 1, 2].map((i) => circle(w - 50 - i * 30, -30, 7, THIN))
    if (style === 'Flat') return [rect(0, 0, w, -150), line([pt(0, -60), pt(w, -60)], THIN), ...buttons]
    const half = Math.min(140, w / 4)
    return [rect(0, 0, w, -60), outline([pt(0, -60), pt(w, -60), pt(w / 2 + half, -350), pt(w / 2 - half, -350)]), rect(w / 2 - half, -350, w / 2 + half, -350 - Math.max(0, chimney)), ...buttons]
  },
  side: ({ depth, style, chimney }) => {
    const d = atLeast(1, depth)
    if (style === 'Flat') return [rect(0, 0, d, -150)]
    const back = Math.min(250, d / 2)
    return [rect(0, 0, d, -60), outline([pt(0, -60), pt(d, -60), pt(back, -350), pt(0, -350)]), rect(0, -350, back, -350 - Math.max(0, chimney))]
  },
}

/** The most rows of tiles, and joints in a row, a splashback draws. */
const MAX_TILES = 60

/**
 * A splashback ("crédence"): the band of tiles or panel on the wall between the worktop and the
 * wall cabinets, fixed at the height of its underside, that of the worktop. In elevations, its
 * joints for tiles of 15 by 7.5 cm laid in a running bond, or none.
 */
export const splashback: ParametricKind = {
  kind: 'arch.splashback',
  label: 'Splashback',
  category: 'kitchen',
  description: 'The band on the wall between the worktop and the wall cabinets, fixed at the height of the worktop.',
  params: [
    { ...WIDTH, default: 1200 },
    HEIGHT(600),
    { key: 'thickness', label: 'Thickness', type: 'number', default: 10, unit: 'length' },
    { key: 'finish', label: 'Finish', type: 'string', default: 'Tiles', options: ['Tiles', 'Plain'] },
  ],
  box: sizedBox('width', 'thickness', 100, 2),
  mount: { on: 'wall', height: COUNTER, measured: 'bottom' },
  build: ({ width, thickness }) => planBox(atLeast(1, width), atLeast(1, thickness)),
  front: ({ width, height, finish }) => {
    const w = atLeast(1, width)
    const h = atLeast(1, height)
    const prims: Primitive[] = [rect(0, 0, w, -h)]
    if (finish === 'Plain') return prims
    const [tw, th] = [150, 75]
    const rows = Math.min(MAX_TILES, Math.ceil(h / th))
    for (let r = 0; r < rows; r++) {
      const y = -r * th
      if (r > 0) prims.push(line([pt(0, y), pt(w, y)], { strokeWidth: 0.3 }))
      for (let k = 0, x = r % 2 === 0 ? tw : tw / 2; k < MAX_TILES && x < w; k++, x += tw) prims.push(line([pt(x, y), pt(x, Math.max(-h, y - th))], { strokeWidth: 0.3 }))
    }
    return prims
  },
  side: ({ thickness, height }) => [rect(0, 0, atLeast(1, thickness), -atLeast(1, height))],
}
