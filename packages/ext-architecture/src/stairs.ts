import { add, arcPoints, norm, perp, scale, sub, transformPrimitive, type ParamDef, type ParametricKind, type Primitive, type Vec2 } from '@opencalque/core'
import { atLeast, clamp, count, HEIGHT, line, mirrorAlong, outline, pt, STEPS, TREAD, TURN, WIDTH } from './shared'

/** The narrowest a stair is made by pulling its side, in mm. */
const MIN_FLIGHT = 300
/**
 * How high a stair climbs, from the floor it starts on to the floor above (a ceiling of 2.50 m and
 * its floor): its steps share it, one rise more than there are treads, the last onto that floor.
 * Only the 3D view uses it.
 */
const RISE = HEIGHT(2700)
/**
 * Which way a stair goes from the floor it is drawn on, as plans say it: 'Up' (Monte), from here to
 * the floor above, its foot here; or 'Down' (Descend), from the floor below, which its foot is on,
 * arriving here at its top. Drawn alike on the plan, its arrow to its top; in 3D, it goes through
 * the ceiling or through the floor (`stairwell`).
 */
const GOES: ParamDef = { key: 'goes', label: 'Goes', type: 'string', default: 'Up', options: ['Up', 'Down'] }

/** The walking line of a stair: a dot where it starts and an arrow pointing up the flight. */
function walkLine(points: Vec2[], size: number): Primitive[] {
  const tip = points[points.length - 1]
  const back = scale(norm(sub(tip, points[points.length - 2])), -size)
  const side = scale(perp(back), 0.6)
  return [
    line(points),
    line([add(add(tip, back), side), tip, sub(add(tip, back), side)]),
    { kind: 'ellipse', cx: points[0].x, cy: points[0].y, rx: size * 0.25, ry: size * 0.25 },
  ]
}

export const straightStair: ParametricKind = {
  kind: 'arch.stair',
  category: 'architecture',
  label: 'Stair, straight',
  description: 'Starts at the insertion point and climbs upward on the sheet.',
  params: [WIDTH, STEPS(12), TREAD, RISE, GOES],
  // Up and down, it gains or loses whole steps; across, it is as wide as it is pulled.
  box: {
    bounds: ({ width, steps, tread }) => ({ left: 0, top: -count(steps) * atLeast(1, tread), right: atLeast(1, width), bottom: 0 }),
    resize: ({ tread }, { width, height }) => ({
      ...(width === undefined ? {} : { width: Math.round(atLeast(MIN_FLIGHT, width)) }),
      ...(height === undefined ? {} : { steps: count(height / atLeast(1, tread)) }),
    }),
  },
  build({ width, steps, tread }) {
    const w = atLeast(1, width)
    const t = atLeast(1, tread)
    const n = count(steps)
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, -n * t), pt(0, -n * t)])]
    for (let i = 1; i < n; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
    return [...prims, ...walkLine([pt(w / 2, -t / 2), pt(w / 2, -n * t + t / 2)], Math.min(w, t) * 0.35)]
  },
  // Solid, in layers one rise thick, each from its step to the top of the flight: the floor at the
  // top is one rise over the top step. Each reaches a little down into the one under it: where they
  // only touched, along an edge longer on one than on the other, the view showed specks through the
  // join. Going down, the same flight a height lower: its top arrives at this floor.
  solids({ width, steps, tread, height, goes }) {
    const [w, t, n, h] = [atLeast(1, width), atLeast(1, tread), count(steps), atLeast(1, height)]
    const rise = h / (n + 1)
    const into = Math.min(10, rise / 4)
    const foot = goes === 'Down' ? -h : 0
    return Array.from({ length: n }, (_, k) => ({ outline: [pt(0, -k * t), pt(w, -k * t), pt(w, -n * t), pt(0, -n * t)], bottom: foot + Math.max(0, k * rise - into), top: foot + (k + 1) * rise }))
  },
  stairwell: ({ width, steps, tread, height, goes }) => {
    const [w, l] = [atLeast(1, width), count(steps) * atLeast(1, tread)]
    const outline = [pt(0, 0), pt(w, 0), pt(w, -l), pt(0, -l)]
    return goes === 'Down' ? { outline, way: 'down', depth: atLeast(1, height) } : { outline, way: 'up' }
  },
}

export const lStair: ParametricKind = {
  kind: 'arch.stair.l',
  category: 'architecture',
  label: 'Stair, L-shaped',
  description: 'Climbs upward on the sheet, then turns a quarter on a landing.',
  params: [WIDTH, STEPS(14), { key: 'before', label: 'Steps before turn', type: 'number', default: 7 }, TREAD, TURN],
  // Up and down, the first flight gains or loses steps; across, the second.
  box: {
    bounds: ({ width, steps, before, tread, turn }) => {
      const [w, t, n1] = [atLeast(1, width), atLeast(1, tread), count(before)]
      const end = w + count(steps - n1) * t
      return { left: turn === 'Left' ? w - end : 0, top: -n1 * t - w, right: turn === 'Left' ? w : end, bottom: 0 }
    },
    resize: ({ width, steps, before, tread }, size) => {
      const [w, t] = [atLeast(1, width), atLeast(1, tread)]
      const n1 = size.height === undefined ? count(before) : count((size.height - w) / t)
      const n2 = size.width === undefined ? count(steps - count(before)) : count((size.width - w) / t)
      return { before: n1, steps: n1 + n2 }
    },
  },
  build({ width, steps, before, tread, turn }) {
    const w = atLeast(1, width)
    const t = atLeast(1, tread)
    const n1 = count(before)
    const n2 = count(steps - n1)
    const top = -n1 * t
    const end = w + n2 * t
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, top), pt(end, top), pt(end, top - w), pt(0, top - w)])]
    for (let i = 1; i <= n1; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
    for (let i = 0; i < n2; i++) prims.push(line([pt(w + i * t, top - w), pt(w + i * t, top)]))
    prims.push(...walkLine([pt(w / 2, -t / 2), pt(w / 2, top - w / 2), pt(end - t / 2, top - w / 2)], Math.min(w, t) * 0.35))
    return turn === 'Left' ? mirrorAlong(prims, w) : prims
  },
}

export const uStair: ParametricKind = {
  kind: 'arch.stair.u',
  category: 'architecture',
  label: 'Stair, U-shaped',
  description: 'Climbs upward on the sheet, turns half on a landing and comes back.',
  params: [WIDTH, STEPS(16), TREAD, { key: 'gap', label: 'Gap between flights', type: 'number', default: 100, unit: 'length' }, TURN],
  // Up and down, both flights gain or lose a step for each tread; across, the gap between them changes.
  box: {
    bounds: ({ width, steps, tread, gap, turn }) => {
      const [w, t] = [atLeast(1, width), atLeast(1, tread)]
      const far = 2 * w + atLeast(0, gap)
      return { left: turn === 'Left' ? w - far : 0, top: -count(steps / 2) * t - w, right: turn === 'Left' ? w : far, bottom: 0 }
    },
    resize: ({ width, steps, tread }, size) => {
      const [w, t] = [atLeast(1, width), atLeast(1, tread)]
      const more = size.height === undefined ? 0 : count((size.height - w) / t) - count(steps / 2)
      return {
        ...(size.height === undefined ? {} : { steps: Math.max(2, Math.round(steps) + 2 * more) }),
        ...(size.width === undefined ? {} : { gap: Math.round(atLeast(0, size.width - 2 * w)) }),
      }
    },
  },
  build({ width, steps, tread, gap, turn }) {
    const w = atLeast(1, width)
    const t = atLeast(1, tread)
    const g = atLeast(0, gap)
    const n1 = count(steps / 2)
    const n2 = count(steps - n1)
    const top = -n1 * t
    const back = top + n2 * t
    const far = 2 * w + g
    const prims: Primitive[] = [
      outline([pt(0, 0), pt(w, 0), pt(w, top), pt(w + g, top), pt(w + g, back), pt(far, back), pt(far, top - w), pt(0, top - w)]),
    ]
    for (let i = 1; i <= n1; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
    for (let i = 0; i < n2; i++) prims.push(line([pt(w + g, top + i * t), pt(far, top + i * t)]))
    const walk = [pt(w / 2, -t / 2), pt(w / 2, top - w / 2), pt(far - w / 2, top - w / 2), pt(far - w / 2, back - t / 2)]
    prims.push(...walkLine(walk, Math.min(w, t) * 0.35))
    return turn === 'Left' ? mirrorAlong(prims, w) : prims
  },
}

export const spiralStair: ParametricKind = {
  kind: 'arch.stair.spiral',
  category: 'architecture',
  label: 'Stair, spiral',
  description: 'The insertion point is the centre. Starts at the bottom of the circle.',
  params: [
    { key: 'radius', label: 'Radius', type: 'number', default: 1000, unit: 'length' },
    { key: 'inner', label: 'Column radius', type: 'number', default: 150, unit: 'length' },
    STEPS(14),
    { key: 'sweep', label: 'Sweep angle', type: 'number', default: 300 },
    { key: 'clockwise', label: 'Clockwise', type: 'boolean', default: true },
  ],
  // Whichever way it is pulled, its radius follows: it stays round.
  box: {
    bounds: ({ radius }) => ({ left: -atLeast(1, radius), top: -atLeast(1, radius), right: atLeast(1, radius), bottom: atLeast(1, radius) }),
    resize: (_, { width, height }) => ({ radius: Math.round(atLeast(MIN_FLIGHT, Math.max(width ?? 0, height ?? 0) / 2)) }),
  },
  build({ radius, inner, steps, sweep, clockwise }) {
    const outer = atLeast(1, radius)
    const column = clamp(inner, 0, outer * 0.9)
    const n = count(steps)
    const turn = clamp(sweep, 10, 360)
    const from = 90
    const to = from + turn
    const centre = pt(0, 0)
    const prims: Primitive[] =
      turn >= 360
        ? [{ kind: 'ellipse', cx: 0, cy: 0, rx: outer, ry: outer }]
        : [outline([...arcPoints(centre, outer, from, to, 64), ...arcPoints(centre, column, to, from, 32)])]
    if (column > 0) prims.push({ kind: 'ellipse', cx: 0, cy: 0, rx: column, ry: column })
    for (let i = turn >= 360 ? 0 : 1; i < n; i++) {
      const angle = from + (turn * i) / n
      prims.push(line([arcPoints(centre, column, angle, angle, 1)[0], arcPoints(centre, outer, angle, angle, 1)[0]]))
    }
    const half = turn / n / 2
    const walk = arcPoints(centre, column + (outer - column) * 0.6, from + half, to - half, 64)
    prims.push(...walkLine(walk, (outer - column) * 0.12))
    return clockwise ? prims : prims.map((p) => transformPrimitive(p, { x: 0, y: 0, flipX: true }))
  },
}
