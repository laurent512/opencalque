import type { ParametricKind, Primitive } from '@opencalque/core'
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
  params: [{ ...WIDTH, default: 600 }, DEPTH(600)],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
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
  ],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
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
export const fridge = (kind: string, label: string, width: number, depth: number, doors: number): ParametricKind => ({
  kind,
  label,
  category: 'kitchen',
  description: 'Its doors are at the front, away from the wall. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: width }, DEPTH(depth), { key: 'doors', label: 'Doors', type: 'number', default: doors }],
  box: sizedBox('width', 'depth', MIN_FRIDGE),
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
}

