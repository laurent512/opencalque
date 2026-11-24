import { roundCorners, rowsOf, type KindSolid, type ParamDef, type ParametricKind, type ParamRow, type Primitive, type Vec2 } from '@opencalque/core'
import { boxSide, door, drawer, frontsOf, FRONTS, frontWindows, MAX_FRONTS, microwave, microwaveWindow, oven, ovenWindow, PLINTH, rect, unitFront, unitSide, WORKTOP, type FrontWindow } from './fronts'
import { atLeast, circle, clamp, count, DEPTH, HEIGHT, line, MAX_BOWLS, outline, pt, roundBox, sizedBox, THIN, WIDTH } from './shared'
import { bodyDepth, box, cabinetSolids, disc, glazedBox, unitSolids } from './solids'

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
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), roundBox(25, 25, w - 25, d - 25, Math.min(20, w / 4, d / 4), THIN)]
    for (const { x, y, r } of hobZones(w, d)) prims.push(circle(x, y, r), circle(x, y, r * 0.45, THIN))
    return prims
  },
  // In 3D, the unit and its worktop, the black glass on it, and each zone a lighter ring on the glass.
  solids: ({ width, depth, below }) => {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const glass = roundCorners(box(25, 25, w - 25, d - 25), Math.min(20, w / 4, d / 4))
    return [
      ...counterSolids(w, d, below),
      { outline: glass, bottom: COUNTER, top: COUNTER + GLASS, finish: 'dark' },
      ...hobZones(w, d).flatMap(({ x, y, r }): KindSolid[] => [
        { outline: disc(x, y, r), bottom: COUNTER + GLASS, top: COUNTER + GLASS + 1, finish: 'metal' },
        { outline: disc(x, y, r * 0.8), bottom: COUNTER + GLASS, top: COUNTER + GLASS + 2, finish: 'dark' },
      ]),
    ]
  },
}

/**
 * Where a hob's cooking zones are, and how large: they keep their size as it is made wider, made
 * smaller only when it is too small to hold them: two one behind the other on a narrow one, four
 * from 450 mm, and from 750 mm a larger fifth in the middle.
 */
function hobZones(w: number, d: number): { x: number; y: number; r: number }[] {
  const back = Math.min(170, d * 0.283)
  const front = d - back
  if (w < 450) {
    // A large zone behind a small one, each kept inside the glass and clear of the other.
    const s = clamp(Math.min((w / 2 - 35) / 100, (front - back - 20) / 175, (back - 35) / 100), 0.1, 1)
    return [
      { x: w / 2, y: back, r: 100 * s },
      { x: w / 2, y: front, r: 75 * s },
    ]
  }
  const left = Math.min(170, w * 0.283)
  const right = w - left
  const s = clamp(Math.min((Math.min(right - left, front - back) - 20) / 175, (Math.min(left, back) - 35) / 100), 0.1, 1)
  const zones = [
    { x: left, y: back, r: 100 * s },
    { x: right, y: back, r: 75 * s },
    { x: left, y: front, r: 75 * s },
    { x: right, y: front, r: 100 * s },
  ]
  if (w >= 750) {
    const middle = Math.min(130, w / 2 - left - 100 * s - 20, d / 2 - 35)
    if (middle > 20) zones.push({ x: w / 2, y: d / 2, r: middle })
  }
  return zones
}

/** How thick a hob's glass stands on the worktop, in mm. */
const GLASS = 6
/** How deep a sink's bowls go into its worktop, in mm, and how high its tap stands over it. */
const BOWL_DEEP = 180
const TAP_HIGH = 300

/** The unit a hob or a sink is set in, in 3D: its plinth, its body (an oven's window let into it) and its worktop, or the worktop alone over nothing. */
const counterSolids = (w: number, d: number, below: string): KindSolid[] =>
  below === 'None' ? [{ outline: box(0, 0, w, d), bottom: COUNTER - WORKTOP, top: COUNTER }] : unitSolids(w, d, COUNTER, true, frontWindows(below, 0, w, -PLINTH, -(COUNTER - WORKTOP)))

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
    { key: 'doors', label: 'Doors', type: 'number', default: 2, shown: ({ below }) => below === 'Doors' },
    HINGE(({ below, doors }) => below === 'Doors' && count(doors) === 1),
  ],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
  // Seen from in front, the unit under it and its tap standing over the worktop where the plan has it.
  front: ({ width, drainer, below, doors, hinge }) => {
    const w = atLeast(1, width)
    const board = drainer === 'Left' || drainer === 'Right' ? Math.min(450, w * 0.4) : 0
    const from = drainer === 'Left' ? board : 0
    return [...counterFront(w, below, doors, hinge), ...tapFront(from + (w - board) / 2)]
  },
  side: ({ depth, below }) => {
    const d = atLeast(1, depth)
    // The tap behind the bowls, as on the plan, its spout reaching over them.
    const tap = Math.min(120, d / 4)
    return [...counterSide(d, below), line([pt(tap, -COUNTER), pt(tap, -COUNTER - 300), pt(tap + 180, -COUNTER - 300), pt(tap + 180, -COUNTER - 230)], { strokeWidth: 1.5 })]
  },
  build(props) {
    const { w, d, bowls, tap, board } = sinkLayout(props)
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    for (const bowl of bowls) {
      const cx = (bowl.x0 + bowl.x1) / 2
      const cy = (bowl.y0 + bowl.y1) / 2
      const drain = Math.min(35, (bowl.x1 - bowl.x0) / 6)
      prims.push(roundBox(bowl.x0, bowl.y0, bowl.x1, bowl.y1, bowl.radius), circle(cx, cy, drain, THIN), circle(cx, cy, drain / 2, THIN))
    }
    // One tap for all the bowls, its spout reaching over them.
    prims.push(circle(tap.x, tap.y, tap.r), line([pt(tap.x, tap.y + tap.r), pt(tap.x, tap.reach)], THIN))
    if (board) {
      prims.push(roundBox(board.x0, board.y0, board.x1, board.y1, board.radius, THIN))
      // Its ribs, every 70 mm, as many as it holds, in its middle.
      const ribs = Math.max(0, Math.floor((board.x1 - board.x0 - 80) / 70) + 1)
      const start = (board.x0 + board.x1 - (ribs - 1) * 70) / 2
      for (let k = 0; k < ribs; k++) prims.push(line([pt(start + k * 70, board.y0 + 40), pt(start + k * 70, board.y1 - 40)], THIN))
    }
    return prims
  },
  // In 3D, its bowls sunk into the worktop with steel bottoms, its draining board in steel on the
  // worktop, and its tap standing behind the bowls, its spout reaching over them.
  solids: (props) => {
    const { w, d, bowls, tap, board } = sinkLayout(props)
    const all = box(0, 0, w, d)
    const holes = bowls.map((bowl) => roundCorners(box(bowl.x0, bowl.y0, bowl.x1, bowl.y1), bowl.radius))
    const spout = Math.max(6, tap.r / 2)
    // The unit under it up to the bottom of its bowls, then cut through by them; over nothing, the worktop alone.
    const under = props.below !== 'None'
    const solids: KindSolid[] = [
      ...(under ? cabinetSolids(w, bodyDepth(d), COUNTER - BOWL_DEEP) : []),
      ...(under ? [{ outline: box(0, 0, w, bodyDepth(d)), holes, bottom: COUNTER - BOWL_DEEP, top: COUNTER - WORKTOP }] : []),
      { outline: all, holes, bottom: COUNTER - WORKTOP, top: COUNTER },
      ...holes.map((hole): KindSolid => ({ outline: hole, bottom: COUNTER - BOWL_DEEP, top: COUNTER - BOWL_DEEP + 2, finish: 'metal' })),
      { outline: disc(tap.x, tap.y, tap.r), bottom: COUNTER, top: COUNTER + TAP_HIGH, finish: 'metal' },
      { outline: box(tap.x - spout, tap.y, tap.x + spout, tap.reach), bottom: COUNTER + TAP_HIGH - 2 * spout, top: COUNTER + TAP_HIGH, finish: 'metal' },
    ]
    if (board) solids.push({ outline: roundCorners(box(board.x0, board.y0, board.x1, board.y1), board.radius), bottom: COUNTER, top: COUNTER + 2, finish: 'metal' })
    return solids
  },
}

/**
 * Where a sink's bowls are, its tap and its draining board: its bowls keep their size as it is made
 * wider, each in the middle of its share of what the draining board leaves, a little nearer the
 * front than the back; the tap behind them, its spout reaching over them.
 */
function sinkLayout({ width, depth, bowls, drainer }: Record<string, any>) {
  const w = atLeast(1, width)
  const d = atLeast(1, depth)
  const n = Math.min(MAX_BOWLS, count(bowls))
  const boardWidth = drainer === 'Left' || drainer === 'Right' ? Math.min(450, w * 0.4) : 0
  const from = drainer === 'Left' ? boardWidth : 0
  const share = (w - boardWidth) / n
  const bowlWidth = clamp(share - 80, 40, 450)
  const bowlDepth = clamp(d - 190, 40, 400)
  const top = (d - bowlDepth) / 2 + 20
  const radius = Math.min(60, bowlWidth / 4, bowlDepth / 4)
  const placed = Array.from({ length: n }, (_, i) => {
    const cx = from + (i + 0.5) * share
    return { x0: cx - bowlWidth / 2, y0: top, x1: cx + bowlWidth / 2, y1: top + bowlDepth, radius }
  })
  const tapY = top / 2
  const tap = { x: from + (w - boardWidth) / 2, y: tapY, r: Math.min(22, tapY / 2), reach: top + Math.min(60, bowlDepth / 2) }
  let board: { x0: number; y0: number; x1: number; y1: number; radius: number } | null = null
  if (boardWidth > 0) {
    const x0 = drainer === 'Left' ? 20 : w - boardWidth + 10
    const x1 = drainer === 'Left' ? boardWidth - 10 : w - 20
    board = { x0, y0: top, x1, y1: top + bowlDepth, radius: Math.min(40, (x1 - x0) / 4, bowlDepth / 4) }
  }
  return { w, d, bowls: placed, tap, board }
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
/** Whether a wall cabinet goes up to the ceiling: as high as the wall behind it (`heightIn`). */
const CEILING: ParamDef = { key: 'ceiling', label: 'Up to the ceiling', type: 'boolean', default: false }

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
  description: 'Hung on the wall above the worktop, drawn dashed as what is above the cut is. Its height above the floor is that of its underside. Up to the ceiling, as high as the wall behind it.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(350), HEIGHT(700), { key: 'doors', label: 'Doors', type: 'number', default: 1 }, CEILING],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT, 200),
  mount: { on: 'wall', height: 1450, measured: 'bottom' },
  // Up to the ceiling, from its underside to the top of the wall; a height typed or dragged takes it down from there.
  heightIn: ({ ceiling }, room) => (ceiling === true ? room : null),
  heightSet: (_props, height) => ({ height, ceiling: false }),
  height: ({ height }) => atLeast(1, height),
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
function counterFront(w: number, below: string, leaves = w > 600 ? 2 : 1, hinge?: string): Primitive[] {
  if (below === 'None') return [rect(0, -COUNTER + WORKTOP, w, -COUNTER)]
  return unitFront(w, COUNTER, true, (y0, y1) => frontsOf(below, 0, w, y0, y1, leaves, 3, hinge))
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
/** Which side a single door is hinged on, opening from the other: shown only when there is one. */
function HINGE(shown: ParamDef['shown']): ParamDef {
  return { key: 'hinge', label: 'Hinge', type: 'string', default: 'Left', options: ['Left', 'Right'], shown }
}

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
  params: [
    { ...WIDTH, default: 600 },
    DEPTH(600),
    HEIGHT(COUNTER),
    FRONTS_PARAM,
    DOORS(1),
    DRAWERS(3),
    HINGE(({ fronts, doors }) => (fronts === 'Doors' || fronts === 'Door and drawer') && count(doors) === 1),
    WORKTOP_ON,
  ],
  box: sizedBox('width', 'depth', MIN_UNIT),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth, worktop }) => planBox(atLeast(1, width), atLeast(1, depth), worktop !== false ? 20 : 0),
  front: ({ width, height, fronts, doors, drawers, worktop, hinge }) => {
    const w = atLeast(1, width)
    return unitFront(w, atLeast(PLINTH + 50, height), worktop !== false, (y0, y1) => frontsOf(fronts, 0, w, y0, y1, doors, drawers, hinge))
  },
  side: ({ depth, height, worktop }) => unitSide(atLeast(1, depth), atLeast(PLINTH + 50, height), worktop !== false),
  // In 3D, an oven behind its fronts shows its window as glass.
  solids: ({ width, depth, height, worktop, fronts }) => {
    const [w, h, on] = [atLeast(1, width), atLeast(PLINTH + 50, height), worktop !== false]
    return unitSolids(w, atLeast(1, depth), h, on, frontWindows(fronts, 0, w, -PLINTH, -(h - (on ? WORKTOP : 0))))
  },
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
  // In 3D, only the slab: what is under it is drawn apart, or is nothing.
  solids: ({ width, depth, thickness, height }) => {
    const top = atLeast(1, height)
    return [{ outline: box(0, 0, atLeast(1, width), atLeast(1, depth)), bottom: Math.max(0, top - atLeast(1, thickness)), top }]
  },
}

/** Doors across x0 to x1 from y0 up to y1, when there is room for them: one opens from its right, two from where they meet. */
function doorsIn(x0: number, x1: number, y0: number, y1: number, leaves: number): Primitive[] {
  if (y0 - y1 < 60) return []
  const n = Math.min(MAX_FRONTS, count(leaves))
  const each = (x1 - x0) / n
  return Array.from({ length: n }, (_, i) => door(x0 + i * each + (i > 0 ? 1.5 : 0), x0 + (i + 1) * each - (i < n - 1 ? 1.5 : 0), y0, y1, n === 1 || i % 2 === 0 ? 'right' : 'left')).flat()
}

/**
 * What a section of a tall unit is, from the floor up: a door, a drawer (several are stacked, a
 * section each), an appliance behind its own front, an open niche, or a filler: a plain panel as
 * high as what the others leave.
 */
const SECTIONS = ['Door', 'Drawer', 'Oven', 'Microwave', 'Fridge', 'Freezer', 'Open', 'Filler']
/** How wide a tall unit is when the door of a section is two leaves meeting in the middle, as wide units are made, in mm. */
const TWO_LEAVES = 800
/** The most sections a tall unit is drawn with. */
const MAX_SECTIONS = 12
/**
 * How high each section usually is, in mm, which it is made when it is chosen: a door, a drawer of
 * three to the height of a base unit, the niches built-in appliances are made for, a fridge over a
 * freezer. A filler's is worked out.
 */
const USUAL: Record<string, number> = { Door: 720, Drawer: 240, Oven: 595, Microwave: 390, Fridge: 1220, Freezer: 720, Open: 380 }
/** The gap under each front of a tall unit, and over the last, in mm. */
const SECTION_GAP = 3
/** How thick the sides of an open niche are, and how deep its back, in mm. */
const NICHE_SIDE = 18
const NICHE_BACK = 30
/** The least a section is made by dragging the line between two in an elevation, in mm. */
const MIN_SECTION = 50

/** Whether a section is a filler, as high as what the others leave rather than as it says. */
const isFiller = (row: ParamRow) => row.type === 'Filler'

/**
 * The sections a tall unit `h` high has when it says none of its own: those its Contents says, at
 * the heights the hand reaches, the doors at the top as high as what the others leave.
 */
function presetSections(contents: string, h: number): ParamRow[] {
  const below: ParamRow[] =
    contents === 'Doors' ? [] : contents === 'Fridge' ? [{ type: 'Freezer', height: 750 }] : contents === 'Oven' ? [{ type: 'Door', height: 750 }, { type: 'Oven', height: 595 }] : [{ type: 'Door', height: 750 }, { type: 'Oven', height: 595 }, { type: 'Microwave', height: 390 }]
  const left = Math.max(0, h - PLINTH - below.reduce((sum, row) => sum + Number(row.height), 0))
  return [...below, { type: contents === 'Fridge' ? 'Fridge' : 'Door', height: Math.round(left * 1000) / 1000 }]
}

/**
 * One section of a tall unit as it is laid out: its row, which of them it is (-1 for the panel that
 * fills the top when no filler does), and from and to how high above the floor it is.
 */
interface Laid {
  row: ParamRow
  index: number
  from: number
  to: number
}

/** How high a section says it is. */
const ownHeight = (row: ParamRow) => Math.max(0, Number(row.height) || 0)

/**
 * The sections of a tall unit `h` high from its plinth up, each as high as it says, but fillers,
 * which share what the others leave; with none, what they leave is a plain panel at the top. What
 * does not fit is cut at the top, and what is left with no room is left out.
 */
export function laidSections(rows: ParamRow[], h: number): Laid[] {
  const room = Math.max(0, h - PLINTH)
  const fillers = rows.filter(isFiller).length
  const left = Math.max(0, room - rows.reduce((sum, row) => sum + (isFiller(row) ? 0 : ownHeight(row)), 0))
  const laid: Laid[] = []
  let at = PLINTH
  const lay = (row: ParamRow, index: number, high: number) => {
    const to = Math.min(h, at + high)
    if (to > at) laid.push({ row, index, from: at, to })
    at = to
  }
  rows.forEach((row, index) => lay(row, index, isFiller(row) ? left / fillers : ownHeight(row)))
  if (fillers === 0 && left > 0) lay({ type: 'Filler' }, -1, left)
  return laid
}

/** Where a section's front goes, from `y0` (its bottom, in front coordinates: up is negative) to `y1`: each just over the one under it, the last short of the top. */
const sectionSpan = (laid: Laid[], i: number): [number, number] => [-laid[i].from - SECTION_GAP, i === laid.length - 1 ? -laid[i].to + SECTION_GAP : -laid[i].to]

/** The windows of the appliances among a tall unit's sections, `w` wide, where `sectionFront` draws them: an oven's, a microwave's. */
function sectionWindows(laid: Laid[], w: number): FrontWindow[] {
  return laid.flatMap(({ row }, i) => {
    const [y0, y1] = sectionSpan(laid, i)
    if (y0 - y1 <= 60) return []
    return row.type === 'Oven' ? [ovenWindow(0, w, y0, y1)] : row.type === 'Microwave' ? [microwaveWindow(0, w, y0, y1)] : []
  })
}

/** The fronts of a section from `y0` (its bottom, in front coordinates: up is negative) to `y1`, `w` wide. */
function sectionFront(row: ParamRow, w: number, y0: number, y1: number): Primitive[] {
  if (y0 - y1 <= 60) return []
  switch (row.type) {
    case 'Drawer':
      return drawer(0, w, y0, y1)
    case 'Oven':
      return oven(0, w, y0, y1)
    case 'Microwave':
      return microwave(0, w, y0, y1)
    case 'Fridge':
    case 'Freezer':
      return doorsIn(0, w, y0, y1, 1)
    case 'Open':
      // No front: the opening between its sides.
      return [rect(Math.min(NICHE_SIDE, w / 4), y0, w - Math.min(NICHE_SIDE, w / 4), y1, THIN)]
    case 'Filler':
      // A plain panel: no handle.
      return [rect(0, y0, w, y1, THIN)]
    default:
      return doorsIn(0, w, y0, y1, w >= TWO_LEAVES ? 2 : 1)
  }
}

/**
 * A tall unit ("colonne"): sections one over the other from its plinth up (`sections`): a door (two
 * leaves on a unit 80 cm wide or more), a drawer (several stacked), an oven, a microwave, a built-in
 * fridge or freezer, an open niche. It is as high as they are; with a filler it goes up to the
 * ceiling, the filler as high as what the others leave (`heightIn`). Without sections of its own it
 * is as high as it says, from the floor to the top of the wall cabinets, and has those its Contents says. On the plan, crossed from corner to corner, as what goes up past the cut.
 */
export const tallUnit: ParametricKind = {
  kind: 'arch.tallunit',
  label: 'Tall unit',
  category: 'kitchen',
  description: 'A unit from the floor to the top of the wall cabinets: an oven and a microwave, an oven, a built-in fridge, or shelves behind doors. Its sections go from the floor up; with a Filler it goes up to the ceiling, the filler taking what the others leave.',
  params: [
    { ...WIDTH, default: 600 },
    DEPTH(600),
    HEIGHT(2150),
    { key: 'contents', label: 'Contents', type: 'string', default: 'Oven and microwave', options: ['Oven and microwave', 'Oven', 'Fridge', 'Doors'], shown: ({ sections }) => !(sections?.length > 0) },
    {
      key: 'sections',
      label: 'Sections',
      type: 'list',
      default: [],
      most: MAX_SECTIONS,
      items: [
        { key: 'type', label: 'Section', type: 'string', default: 'Door', options: SECTIONS, sets: (type): ParamRow => (type in USUAL ? { height: USUAL[type] } : {}) },
        { key: 'height', label: 'Height', type: 'number', default: USUAL.Door, unit: 'length', auto: isFiller },
      ],
      emptyAs: ({ contents, height }) => presetSections(contents, atLeast(PLINTH + 100, height)),
      laid: (props) => {
        const rows = sectionsOf(props)
        const laid = laidSections(rows, atLeast(PLINTH + 100, props.height))
        // A filler with no room is as high as nothing.
        return rows.map((row, i) => {
          const found = laid.find((section) => section.index === i)
          return { ...row, height: Math.round((found ? found.to - found.from : 0) * 1000) / 1000 }
        })
      },
      adding: 'Add a section',
      upward: true,
      toggle: { row: { type: 'Filler' }, label: 'Add a full-height filler' },
    },
  ],
  box: sizedBox('width', 'depth', MIN_UNIT),
  mount: { on: 'floor' },
  // With sections of its own, as high as they are on its plinth, or with a filler up to the ceiling;
  // with none, as high as it says (Contents gives it its sections then).
  heightIn: ({ sections }, room) => {
    const own: ParamRow[] = Array.isArray(sections) ? sections : []
    if (own.length === 0) return null
    return own.some(isFiller) ? room : PLINTH + own.reduce((sum, row) => sum + (isFiller(row) ? 0 : ownHeight(row)), 0)
  },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    return [...planBox(w, d, 20), line([pt(0, 0), pt(w, Math.max(0, d - 20))], THIN)]
  },
  front: (props) => {
    const w = atLeast(1, props.width)
    const h = atLeast(PLINTH + 100, props.height)
    const laid = laidSections(sectionsOf(props), h)
    const prims: Primitive[] = [rect(0, 0, w, -h), line([pt(0, -PLINTH), pt(w, -PLINTH)], THIN)]
    // Each front from just over the one under it up to the next, the last short of the top.
    laid.forEach(({ row }, i) => prims.push(...sectionFront(row, w, ...sectionSpan(laid, i))))
    return prims
  },
  side: ({ depth, height }) => unitSide(atLeast(1, depth), atLeast(PLINTH + 100, height), false),
  // In 3D, its body over its plinth, an open niche set into it between its sides.
  solids: (props) => {
    const [w, d] = [atLeast(1, props.width), atLeast(1, props.depth)]
    const h = atLeast(PLINTH + 100, props.height)
    const [plinth] = cabinetSolids(w, d, h)
    const solids: KindSolid[] = [plinth]
    const side = Math.min(NICHE_SIDE, w / 4)
    const back = Math.min(NICHE_BACK, d / 3)
    let from = PLINTH
    const laid = laidSections(sectionsOf(props), h)
    const windows = sectionWindows(laid, w)
    const body = (to: number) => {
      if (to > from) solids.push(...glazedBox(w, d, from, to, windows))
    }
    for (const section of laid) {
      if (section.row.type !== 'Open') continue
      body(section.from)
      solids.push(
        { outline: box(0, 0, w, back), bottom: section.from, top: section.to },
        { outline: box(0, back, side, d), bottom: section.from, top: section.to },
        { outline: box(w - side, back, w, d), bottom: section.from, top: section.to },
      )
      from = section.to
    }
    body(h)
    return solids
  },
  // The lines between its sections, dragged up and down in an elevation.
  splits: (props) => {
    const laid = laidSections(sectionsOf(props), atLeast(PLINTH + 100, props.height))
    return laid.slice(0, -1).map((section) => section.to)
  },
  moveSplit: (props, i, at) => moveSectionLine(sectionsOf(props), atLeast(PLINTH + 100, props.height), i, at),
}

/** A tall unit's sections: its own, else those its Contents says. */
const sectionsOf = (props: Record<string, any>): ParamRow[] => rowsOf(tallUnit.params.find((p) => p.key === 'sections')!, props)

/**
 * The sections of a tall unit `h` high with the line over the `i`-th laid out moved to `at` above
 * the floor: the section under it and the one over it give and take between them, each made as high
 * as it then is, but a filler (or the panel at the top), which takes what is left; neither made less
 * than `MIN_SECTION`. Null when there is no such line, or fillers on both sides of it. Its sections
 * are then its own.
 */
export function moveSectionLine(rows: ParamRow[], h: number, i: number, at: number): { sections: ParamRow[] } | null {
  const laid = laidSections(rows, h)
  const [under, over] = [laid[i], laid[i + 1]]
  if (!under || !over) return null
  const fixed = (section: Laid) => section.index >= 0 && !isFiller(section.row)
  if (!fixed(under) && !fixed(over)) return null
  const to = Math.min(over.to - MIN_SECTION, Math.max(under.from + MIN_SECTION, at))
  const next = rows.map((row) => ({ ...row }))
  const tidy = (n: number) => Math.round(n * 1000) / 1000
  if (fixed(under)) next[under.index].height = tidy(to - under.from)
  if (fixed(over)) next[over.index].height = tidy(over.to - to)
  return { sections: next }
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
  solids: ({ width, depth, height, worktop }) => unitSolids(atLeast(1, width), atLeast(1, depth), atLeast(PLINTH + 100, height), worktop !== false),
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
 * above the worktop: with a chimney up to the ceiling, flat under a wall cabinet, or boxed in, its
 * box as wide and deep as it is up to the ceiling. On the plan, dashed, as what is above the cut,
 * with its chimney and its filter.
 */
export const hood: ParametricKind = {
  kind: 'arch.hood',
  label: 'Range hood',
  category: 'kitchen',
  description: 'Fixed on the wall over the hob, drawn dashed as what is above the cut is. Its height above the floor is that of its underside, 65 cm over the worktop.',
  params: [
    { ...WIDTH, default: 600 },
    DEPTH(500),
    { key: 'style', label: 'Style', type: 'string', default: 'Chimney', options: ['Chimney', 'Flat', 'Boxed'] },
    // How far its chimney or its box goes up over the canopy in elevations; in a view, up to the ceiling.
    { key: 'chimney', label: 'Chimney height', type: 'number', default: 700, unit: 'length', shown: ({ style }) => style !== 'Flat' },
  ],
  box: sizedBox('width', 'depth', 300, 200),
  mount: { on: 'wall', height: COUNTER + 650, measured: 'bottom' },
  build: ({ width, depth, style }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    const half = Math.min(140, w / 4)
    const filter = Math.min(90, w / 6, d / 5)
    const prims: Primitive[] = [{ kind: 'path', points: [pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)], closed: true, dash: HIGH }]
    if (style === 'Chimney') prims.push({ kind: 'path', points: [pt(w / 2 - half, 0), pt(w / 2 + half, 0), pt(w / 2 + half, Math.min(250, d / 2)), pt(w / 2 - half, Math.min(250, d / 2))], closed: true, dash: HIGH, strokeWidth: 0.5 })
    prims.push({ kind: 'ellipse', cx: w / 2, cy: d * 0.6, rx: filter, ry: filter, dash: HIGH, strokeWidth: 0.5 })
    return prims
  },
  front: ({ width, style, chimney }) => {
    const w = atLeast(1, width)
    const buttons = [0, 1, 2].map((i) => circle(w - 50 - i * 30, -30, 7, THIN))
    if (style === 'Flat') return [rect(0, 0, w, -150), line([pt(0, -60), pt(w, -60)], THIN), ...buttons]
    if (style === 'Boxed') return [rect(0, 0, w, -HOOD_SLOPE - Math.max(0, chimney)), line([pt(0, -60), pt(w, -60)], THIN), ...buttons]
    const half = Math.min(140, w / 4)
    return [rect(0, 0, w, -60), outline([pt(0, -60), pt(w, -60), pt(w / 2 + half, -350), pt(w / 2 - half, -350)]), rect(w / 2 - half, -350, w / 2 + half, -350 - Math.max(0, chimney)), ...buttons]
  },
  side: ({ depth, style, chimney }) => {
    const d = atLeast(1, depth)
    if (style === 'Flat') return [rect(0, 0, d, -150)]
    if (style === 'Boxed') return [rect(0, 0, d, -HOOD_SLOPE - Math.max(0, chimney)), line([pt(0, -60), pt(d, -60)], THIN)]
    const back = Math.min(250, d / 2)
    return [rect(0, 0, d, -60), outline([pt(0, -60), pt(d, -60), pt(back, -350), pt(0, -350)]), rect(0, -350, back, -350 - Math.max(0, chimney))]
  },
  // In 3D, from its underside: its filter in steel under it; chimney, its canopy narrowing up to its
  // chimney, which goes up to the ceiling; flat, a slab; boxed, its box up to the ceiling.
  solids: ({ width, depth, style, chimney }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    const filter: KindSolid = { outline: box(20, 20, w - 20, d - 20), bottom: -2, top: 0, finish: 'metal' }
    if (style === 'Flat') return [filter, { outline: box(0, 0, w, d), bottom: 0, top: 150 }]
    const up = HOOD_SLOPE + Math.max(0, chimney)
    if (style === 'Boxed') return [filter, { outline: box(0, 0, w, d), bottom: 0, top: up, toCeiling: true }]
    const half = Math.min(140, w / 4)
    const back = Math.min(250, d / 2)
    const stack = box(w / 2 - half, 0, w / 2 + half, back)
    return [
      filter,
      { outline: box(0, 0, w, d), bottom: 0, top: 60 },
      { outline: box(0, 0, w, d), upper: stack, bottom: 60, top: HOOD_SLOPE },
      { outline: stack, bottom: HOOD_SLOPE, top: up, toCeiling: true },
    ]
  },
}

/** How high a hood's canopy rises from its underside to its chimney, in mm. */
const HOOD_SLOPE = 350

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
