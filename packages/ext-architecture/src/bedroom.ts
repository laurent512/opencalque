import type { ParametricKind, Primitive } from '@opencalque/core'
import { door, drawer, MAX_FRONTS, rect } from './fronts'
import { atLeast, count, DEPTH, HEIGHT, line, outline, pt, sizedBox, THIN, WIDTH } from './shared'

// Bedroom furniture stands against the wall by its top edge (its own Y = 0), as the kitchen units
// do: its front is towards +Y. Seen in elevations, from in front its drawers or its doors, and from
// the side its profile.

/** How thick a top is, how high the feet under a piece of furniture stand, in mm. */
const TOP = 25
const FEET = 100
/** The gap between two fronts, in mm. */
const GAP = 3

/** A plan as its outline and the line of its fronts, thin, a little in from its front edge. */
const planOf = (w: number, d: number): Primitive[] => [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), line([pt(0, Math.max(0, d - 20)), pt(w, Math.max(0, d - 20))], THIN)]

/** A piece of furniture on feet, seen from in front: its top, its body, its feet at the corners, and what `inside` puts in its body (from y0 up to y1). */
function onFeet(w: number, h: number, inside: (y0: number, y1: number) => Primitive[]): Primitive[] {
  const feet = Math.min(FEET, h / 4)
  const foot = Math.min(40, w / 8)
  const body: [number, number] = [-feet, -h + TOP]
  return [
    rect(0, -h + TOP, w, -h),
    rect(8, body[0], w - 8, body[1]),
    rect(16, 0, 16 + foot, -feet),
    rect(w - 16 - foot, 0, w - 16, -feet),
    ...inside(body[0] - GAP, body[1] + GAP),
  ]
}
/** The same seen from its side: its top over the front, its body, the foot at each end. */
function onFeetSide(d: number, h: number): Primitive[] {
  const feet = Math.min(FEET, h / 4)
  const foot = Math.min(40, d / 8)
  return [rect(0, -h + TOP, d, -h), rect(0, -feet, d - 10, -h + TOP), line([pt(d - 30, -feet), pt(d - 30, -h + TOP)], THIN), rect(16, 0, 16 + foot, -feet), rect(d - 26 - foot, 0, d - 26, -feet)]
}

/** `rows` drawers one over the other from y0 up to y1, in `columns` side by side from x0 to x1. */
function drawerGrid(x0: number, x1: number, y0: number, y1: number, rows: number, columns: number): Primitive[] {
  const [r, c] = [Math.min(MAX_FRONTS, count(rows)), Math.min(4, count(columns))]
  const [each, high] = [(x1 - x0) / c, (y0 - y1) / r]
  const prims: Primitive[] = []
  for (let i = 0; i < c; i++) {
    for (let k = 0; k < r; k++) {
      prims.push(...drawer(x0 + i * each + (i > 0 ? GAP / 2 : 0), x0 + (i + 1) * each - (i < c - 1 ? GAP / 2 : 0), y0 - k * high - (k > 0 ? GAP / 2 : 0), y0 - (k + 1) * high + (k < r - 1 ? GAP / 2 : 0)))
    }
  }
  return prims
}

/** A bedside table: its drawers at the top, an open shelf under them when it has few. */
export const bedsideTable: ParametricKind = {
  kind: 'arch.bedside',
  label: 'Bedside table',
  category: 'bedroom',
  description: 'Beside the bed, against the wall: its drawers show in elevations.',
  params: [{ ...WIDTH, default: 450 }, DEPTH(400), HEIGHT(550), { key: 'drawers', label: 'Drawers', type: 'number', default: 1 }],
  box: sizedBox('width', 'depth', 200),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => planOf(atLeast(1, width), atLeast(1, depth)),
  front: ({ width, height, drawers }) => {
    const [w, h] = [atLeast(100, width), atLeast(200, height)]
    return onFeet(w, h, (y0, y1) => {
      const n = Math.min(MAX_FRONTS, count(drawers))
      // A drawer takes 150 mm or its share; under few, the shelf left open.
      const each = Math.min(150, (y0 - y1) / n)
      return [...drawerGrid(14, w - 14, y1 + n * each, y1, n, 1), ...(y0 - (y1 + n * each) > 60 ? [line([pt(14, y1 + n * each + 60), pt(w - 14, y1 + n * each + 60)], THIN)] : [])]
    })
  },
  side: ({ depth, height }) => onFeetSide(atLeast(100, depth), atLeast(200, height)),
}

/** A chest of drawers ("commode"): its drawers in rows, in two columns when it is wide. */
export const chestOfDrawers: ParametricKind = {
  kind: 'arch.chest',
  label: 'Chest of drawers',
  category: 'bedroom',
  description: 'Against the wall, its drawers in rows, in two columns from 1.2 m wide.',
  params: [{ ...WIDTH, default: 800 }, DEPTH(450), HEIGHT(850), { key: 'drawers', label: 'Drawers', type: 'number', default: 4 }],
  box: sizedBox('width', 'depth', 300),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth }) => planOf(atLeast(1, width), atLeast(1, depth)),
  front: ({ width, height, drawers }) => {
    const [w, h] = [atLeast(100, width), atLeast(200, height)]
    return onFeet(w, h, (y0, y1) => drawerGrid(14, w - 14, y0, y1, drawers, w >= 1200 ? 2 : 1))
  },
  side: ({ depth, height }) => onFeetSide(atLeast(100, depth), atLeast(200, height)),
}

/** The most hangers a wardrobe draws on one half of its rail. */
const MAX_HANGERS = 40

/**
 * A wardrobe ("armoire"): its doors hinged or sliding, its rail along its middle with the hangers
 * on it, as the plan of a wardrobe is drawn; in elevations, its doors and their handles, a plinth
 * under them.
 */
export const wardrobe: ParametricKind = {
  kind: 'arch.wardrobe',
  label: 'Wardrobe',
  category: 'bedroom',
  description: 'Against the wall, its doors hinged or sliding. Pull its sides to make it wider.',
  params: [
    { ...WIDTH, default: 1200 },
    DEPTH(600),
    HEIGHT(2200),
    { key: 'doors', label: 'Doors', type: 'number', default: 2 },
    { key: 'opening', label: 'Doors open', type: 'string', default: 'Hinged', options: ['Hinged', 'Sliding'] },
  ],
  box: sizedBox('width', 'depth', 400, 300),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build: ({ width, depth, doors, opening }) => {
    const [w, d] = [atLeast(1, width), atLeast(1, depth)]
    const n = Math.min(MAX_FRONTS, count(doors))
    const front = Math.max(0, d - 25)
    const rail = front / 2
    // Hangers lean a little this way and that, as they do on a rail.
    const lean = [12, -8, 4, -14, 9, -5, 13, -10, 6]
    const hangers: Primitive[] = []
    const reach = Math.min(220, rail - 20)
    const many = Math.max(0, Math.min(MAX_HANGERS, Math.floor((w - 140) / 95) + 1))
    const offset = (w - (many - 1) * 95) / 2
    for (let i = 0; i < many; i++) {
      const x = offset + i * 95
      hangers.push(line([pt(x - lean[i % lean.length], rail - reach), pt(x + lean[i % lean.length], rail + reach)], THIN))
    }
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), line([pt(40, rail), pt(w - 40, rail)], THIN), ...hangers]
    if (opening === 'Sliding') {
      // Two tracks, the doors on one and the other in turn.
      for (let i = 0; i < n; i++) {
        const y = i % 2 === 0 ? front : front + 12
        prims.push(line([pt((w * i) / n - (i > 0 ? 15 : 0), y), pt((w * (i + 1)) / n + (i < n - 1 ? 15 : 0), y)], { strokeWidth: 1.5 }))
      }
      return prims
    }
    prims.push(line([pt(0, front), pt(w, front)]))
    for (let i = 1; i < n; i++) prims.push(line([pt((w * i) / n, front), pt((w * i) / n, d)]))
    return prims
  },
  front: ({ width, height, doors, opening }) => {
    const [w, h] = [atLeast(1, width), atLeast(300, height)]
    const n = Math.min(MAX_FRONTS, count(doors))
    const plinth = Math.min(80, h / 10)
    const prims: Primitive[] = [rect(0, 0, w, -h), line([pt(0, -plinth), pt(w, -plinth)], THIN)]
    const each = w / n
    for (let i = 0; i < n; i++) {
      const [x0, x1] = [i * each + (i > 0 ? GAP / 2 : 0), (i + 1) * each - (i < n - 1 ? GAP / 2 : 0)]
      if (opening === 'Sliding') {
        // A recessed handle up the outer edge of each door, the doors overlapping where they meet.
        const edge = i % 2 === 0 ? x0 + 30 : x1 - 30
        prims.push(rect(x0, -plinth - GAP, x1, -h + GAP, THIN), line([pt(edge, -h * 0.4), pt(edge, -h * 0.6)], { strokeWidth: 2 }))
      } else prims.push(...door(x0, x1, -plinth - GAP, -h + GAP, n === 1 || i % 2 === 0 ? 'right' : 'left'))
    }
    return prims
  },
  side: ({ depth, height }) => {
    const [d, h] = [atLeast(1, depth), atLeast(300, height)]
    const plinth = Math.min(80, h / 10)
    return [outline([pt(0, 0), pt(d - 40, 0), pt(d - 40, -plinth), pt(d, -plinth), pt(d, -h), pt(0, -h)]), line([pt(d - 25, -plinth), pt(d - 25, -h)], THIN)]
  },
}
