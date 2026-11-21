import { arcPoints, type ParametricKind, type Primitive } from '@opencalque/core'
import { atLeast, clamp, count, HEAVY, HEIGHT, line, LOOSE_WALL, mirrorAcross, mirrorAlong, OTHER_SIDE, outline, pt, THIN, WIDTH } from './shared'

/* Doors and windows: openings that cut the wall they are placed on, drawn along +X, the wall's line, and told its thickness. */

/*
 * The kinds of door. Hinged: 'Single', 'Double'. Sliding: 'Sliding on wall', a leaf hung in front
 * of the wall's +Y face that slides along it; 'Double sliding on wall', two that part; 'Pocket', a
 * leaf that slides into the wall; and 'Sliding', the glazed door of an outside wall, its leaves on
 * rails in its frame (the only sliding door before 1.13, and what the value still means).
 */
const HINGED = ['Single', 'Double']
const ON_WALL = ['Sliding on wall', 'Double sliding on wall']
/** Those that slide one way, which `slide` says. */
const ONE_WAY = ['Sliding on wall', 'Pocket']
/** How many leaves a sliding glazed door can have. */
const LEAVES = { min: 2, max: 4 }

/** A rectangle, dashed when it shows where something goes rather than where it is. */
const box = (x0: number, y0: number, x1: number, y1: number, dash?: number[]): Primitive => ({
  kind: 'path',
  points: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)],
  closed: true,
  ...(dash ? { dash, ...THIN } : {}),
})
const OPEN = [40, 25]
/** An arrow along +X from `x0` to `x1`, at `y`. */
const arrow = (x0: number, x1: number, y: number): Primitive[] => {
  const head = Math.min(60, Math.abs(x1 - x0) / 3) * Math.sign(x1 - x0)
  return [line([pt(x0, y), pt(x1, y)], THIN), line([pt(x1 - head, y - Math.abs(head) / 2), pt(x1, y), pt(x1 - head, y + Math.abs(head) / 2)], THIN)]
}

export const door: ParametricKind = {
  kind: 'arch.door',
  category: 'architecture',
  label: 'Door',
  description: 'Place it on a wall: it cuts the opening and follows the wall. Off a wall it stands alone.',
  params: [
    WIDTH,
    HEIGHT(2040),
    // A door can start above the floor, as a window does: a raised threshold, room left under it for a floor's finish.
    { key: 'sillHeight', label: 'Sill height', type: 'number', default: 0, unit: 'length' },
    { key: 'type', label: 'Type', type: 'string', default: 'Single', options: ['Single', 'Double', ...ON_WALL, 'Pocket', 'Sliding', 'Opening only'] },
    { key: 'hinge', label: 'Hinge', type: 'string', default: 'Left', options: ['Left', 'Right'], shown: ({ type }) => type === 'Single' },
    { key: 'angle', label: 'Open angle', type: 'number', default: 90, unit: 'angle', shown: ({ type }) => HINGED.includes(type) },
    { key: 'slide', label: 'Slides to', type: 'string', default: 'Right', options: ['Left', 'Right'], shown: ({ type }) => ONE_WAY.includes(type) },
    { key: 'leaves', label: 'Leaves', type: 'number', default: 2, shown: ({ type }) => type === 'Sliding' },
    OTHER_SIDE,
  ],
  opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
  size: { x: 'width' },
  sill: 'sillHeight',
  build({ width, type, hinge, angle, slide, leaves, flip }, env) {
    const w = atLeast(1, width)
    const h = (env.wallThickness ?? LOOSE_WALL) / 2
    const open = clamp(angle, 5, 180)
    // A leaf hinged on the +Y face. `dir` is +1 when it closes towards +X, -1 towards -X.
    const leaf = (hingeX: number, length: number, dir: 1 | -1): Primitive[] => {
      const hingePoint = pt(hingeX, h)
      const closed = dir === 1 ? 0 : 180
      const opened = closed + dir * open
      const tip = arcPoints(hingePoint, length, opened, opened, 1)[0]
      return [line([hingePoint, tip], HEAVY), line(arcPoints(hingePoint, length, closed, opened), THIN)]
    }
    // A leaf hung in front of the +Y face over `x0`-`x1`, a little wider than what it closes, drawn
    // shut, then dashed where it slides to (by `by`), an arrow saying which way.
    const hung = (x0: number, x1: number, by: number): Primitive[] => {
      const over = Math.min(50, w / 10)
      const [a, b] = [x0 === 0 ? -over : x0, x1 === w ? w + over : x1]
      const [near, far] = [h + 10, h + 50]
      const mid = (a + b) / 2
      return [box(a, near, b, far), box(a + by, near, b + by, far, OPEN), ...arrow(mid, mid + by * 0.6, far + 60)]
    }
    let prims: Primitive[] = [line([pt(0, -h), pt(w, -h)], THIN), line([pt(0, h), pt(w, h)], THIN)]
    if (type === 'Single') prims.push(...leaf(0, w, 1))
    else if (type === 'Double') prims.push(...leaf(0, w / 2, 1), ...leaf(w, w / 2, -1))
    else if (type === 'Sliding on wall') prims.push(...hung(0, w, w))
    else if (type === 'Double sliding on wall') prims.push(...hung(0, w / 2, -w / 2), ...hung(w / 2, w, w / 2))
    else if (type === 'Pocket') {
      // In the middle of the wall: shut across the opening, and dashed in the wall where it goes.
      const t = Math.min(20, h / 2)
      prims.push(box(0, -t, w, t), box(w, -t, 2 * w, t, OPEN), ...arrow(w * 0.3, w * 0.7, h + 60))
    } else if (type === 'Sliding') {
      // Its frame at each side, and its leaves on two rails, each overlapping the next.
      const frame = Math.min(50, w / 8)
      const n = clamp(Math.round(Number(leaves) || LEAVES.min), LEAVES.min, LEAVES.max)
      const overlap = Math.min(50, (w - 2 * frame) / (2 * n))
      const length = (w - 2 * frame + (n - 1) * overlap) / n
      const rail = Math.min(h * 0.4, 30)
      const t = Math.min(rail * 0.8, 20)
      prims.push(line([pt(frame, -h), pt(frame, h)], THIN), line([pt(w - frame, -h), pt(w - frame, h)], THIN))
      for (let i = 0; i < n; i++) {
        const x = frame + i * (length - overlap)
        const y = i % 2 === 0 ? -rail : rail
        prims.push(box(x, y - t / 2, x + length, y + t / 2))
      }
    }
    if (type === 'Single' && hinge === 'Right') prims = mirrorAlong(prims, w)
    if (ONE_WAY.includes(type) && slide === 'Left') prims = mirrorAlong(prims, w)
    return flip ? mirrorAcross(prims) : prims
  },
  // Seen from in front: its frame from its sill (the floor, unless it is raised) to its height, the
  // leaves, and a handle on the side that opens, at the height of a handle above the sill.
  front({ width, height, type, hinge, slide, leaves, sillHeight }) {
    const w = atLeast(1, width)
    const bottom = -Math.max(0, Number(sillHeight) || 0) || 0
    const top = bottom - atLeast(1, height)
    let prims: Primitive[] = [outline([pt(0, bottom), pt(w, bottom), pt(w, top), pt(0, top)])]
    const handle = (x: number, toward: 1 | -1) => line([pt(x, bottom - 1000), pt(x + toward * 100, bottom - 1000)], HEAVY)
    // A sliding leaf is pulled by an upright grip.
    const grip = (x: number) => line([pt(x, bottom - 900), pt(x, bottom - 1150)], HEAVY)
    if (type === 'Single') prims.push(hinge === 'Right' ? handle(80, 1) : handle(w - 80, -1))
    else if (type === 'Double') prims.push(line([pt(w / 2, bottom), pt(w / 2, top)], THIN), handle(w / 2 - 80, -1), handle(w / 2 + 80, 1))
    else if (type === 'Double sliding on wall') prims.push(line([pt(w / 2, bottom), pt(w / 2, top)], THIN), grip(w / 2 - 80), grip(w / 2 + 80))
    else if (ONE_WAY.includes(type)) prims.push(grip(80))
    else if (type === 'Sliding') {
      const n = clamp(Math.round(Number(leaves) || LEAVES.min), LEAVES.min, LEAVES.max)
      for (let i = 1; i < n; i++) prims.push(line([pt((w * i) / n, bottom), pt((w * i) / n, top)], THIN))
    }
    if (ONE_WAY.includes(type) && slide === 'Left') prims = mirrorAlong(prims, w)
    return prims
  },
}

export const windowKind: ParametricKind = {
  kind: 'arch.window',
  category: 'architecture',
  label: 'Window',
  description: 'Place it on a wall: it cuts the opening and follows the wall. The sill marks the outside.',
  params: [
    { ...WIDTH, default: 1200 },
    { key: 'panes', label: 'Panes', type: 'number', default: 2 },
    { key: 'glazing', label: 'Glazing', type: 'string', default: 'Double', options: ['Single', 'Double', 'Triple'] },
    HEIGHT(1250),
    { key: 'sill', label: 'Sill depth', type: 'number', default: 50, unit: 'length' },
    { key: 'sillHeight', label: 'Sill height', type: 'number', default: 900, unit: 'length' },
    OTHER_SIDE,
  ],
  opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
  size: { x: 'width' },
  sill: 'sillHeight',
  build({ width, panes, glazing, sill, flip }, env) {
    const w = atLeast(1, width)
    const h = (env.wallThickness ?? LOOSE_WALL) / 2
    const frame = Math.min(50, w / 4)
    // A line for each pane of glass, evenly across the middle of the wall.
    const gap = Math.min(h * 0.3, 25)
    const glass = glazing === 'Triple' ? [-gap, 0, gap] : glazing === 'Double' ? [-gap, gap] : [0]
    const n = count(panes)
    const prims: Primitive[] = [
      line([pt(0, -h), pt(w, -h)]),
      line([pt(0, h), pt(w, h)]),
      line([pt(frame, -h), pt(frame, h)], THIN),
      line([pt(w - frame, -h), pt(w - frame, h)], THIN),
      ...glass.map((y) => line([pt(frame, y), pt(w - frame, y)], THIN)),
    ]
    for (let i = 1; i < n; i++) {
      const x = frame + ((w - 2 * frame) * i) / n
      prims.push(line([pt(x, -h), pt(x, h)], THIN))
    }
    if (sill > 0) prims.push(outline([pt(-30, -h), pt(w + 30, -h), pt(w + 30, -h - sill), pt(-30, -h - sill)], THIN))
    return flip ? mirrorAcross(prims) : prims
  },
  // Seen from in front: from its sill height up, its frame, and a line between each pane.
  front({ width, height, panes, sillHeight }) {
    const w = atLeast(1, width)
    const bottom = -Math.max(0, Number(sillHeight) || 0) || 0
    const top = bottom - atLeast(1, height)
    const frame = Math.min(50, w / 4)
    const prims: Primitive[] = [outline([pt(0, bottom), pt(w, bottom), pt(w, top), pt(0, top)]), outline([pt(frame, bottom - frame), pt(w - frame, bottom - frame), pt(w - frame, top + frame), pt(frame, top + frame)], THIN)]
    const n = count(panes)
    for (let i = 1; i < n; i++) {
      const x = frame + ((w - 2 * frame) * i) / n
      prims.push(line([pt(x, bottom - frame), pt(x, top + frame)], THIN))
    }
    return prims
  },
}
