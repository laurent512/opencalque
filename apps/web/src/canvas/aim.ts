import { boundsContainPoint, dist, norm, snapLinesOf, snapTo, sub, wallPoints, type Snap, type Vec2 } from '@opencalque/core'
import { usePrefs } from '../prefs'
import { gridStep } from '../view'
import { MEASURING, SNAP_REACH, type Keys } from './gesture'
import { get, type Canvas } from './runtime'
import { round } from './shapes'

/* Where a point lands for the pointer where it is: snapped to what is drawn or to the grid, or held to a direction. */

/** How long, in ms, the pointer rests on a point for what is drawn after to line up with it. */
const REST = 250
/** How many points rested on are kept to line up with: one across, one up and down, and one more. */
const TRACKED = 3
/** How many lines ending at a point rested on are carried on past it, at most. */
const CARRIED = 8

/** A line carried on past a point rested on: the point, and the way the line goes on from it. */
type Carried = { from: Vec2; dir: Vec2 }
/** The lines that end at each point kept, found once when it is kept. */
const carriedFrom = new WeakMap<Vec2, Carried[]>()

/**
 * The lines of what is drawn that end at `p` (or turn there, as at the corner of a rectangle),
 * each carried on past it the way it was going.
 */
function linesEndingAt(c: Canvas, p: Vec2): Carried[] {
  const ways: Carried[] = []
  const add = (from: Vec2) => {
    const dir = norm(sub(p, from))
    if (dist(from, p) > 1e-6 && !ways.some((w) => dist(w.dir, dir) < 1e-6) && ways.length < CARRIED) ways.push({ from: p, dir })
  }
  for (const item of c.snappable) {
    if (!item.bounds || !boundsContainPoint(item.bounds, p, 1)) continue
    for (const line of snapLinesOf(item)) {
      for (let i = 0; i < line.length; i++) {
        if (dist(line[i], p) > 1e-6) continue
        if (i > 0) add(line[i - 1])
        if (i + 1 < line.length) add(line[i + 1])
      }
    }
  }
  return ways
}

/** The lines carried on past the points rested on lately. */
const carriedLines = (c: Canvas): Carried[] => trackedPoints(c).flatMap((q) => carriedFrom.get(q) ?? [])

/** The points the pointer rested on lately, the latest first: what is drawn lines up with them. Another tool forgets them. */
export function trackedPoints(c: Canvas): Vec2[] {
  const { tool } = get()
  if (c.tracked.tool !== tool) c.tracked = { tool, points: [], resting: null }
  return c.tracked.points
}

/**
 * Follows where the pointer rests: a point (a corner, a centre, a middle, a crossing) snapped to for long
 * enough is kept, once the pointer leaves it, to line up with. Only those: a point merely passed
 * over is not, and lining up with every point of a plan would find a line almost anywhere.
 */
function rest(c: Canvas, hit: Snap | null): void {
  const on = hit && (hit.kind === 'point' || hit.kind === 'centre' || hit.kind === 'middle' || hit.kind === 'crossing') ? hit.p : null
  const { resting } = c.tracked
  if (resting && on && dist(on, resting.p) < 1e-6) return
  const now = performance.now()
  if (resting && now - resting.since >= REST) {
    c.tracked.points = [resting.p, ...trackedPoints(c).filter((q) => dist(q, resting.p) > 1e-6)].slice(0, TRACKED)
    // A point where lines end also carries them on past it, as CAD programs track.
    if (!carriedFrom.has(resting.p)) carriedFrom.set(resting.p, linesEndingAt(c, resting.p))
  }
  c.tracked.resting = on ? { p: on, since: now } : null
}

/** A point the pointer gives, what it was snapped to (shown by its mark), and the point it was taken from when that is elsewhere. */
export interface Target {
  p: Vec2
  marker: Snap | null
  link?: [Vec2, Vec2]
}

/**
 * The point `t` along the way `dir` from `from`, the way gone tidied rather than the point: held
 * level, it keeps the y of `from` exactly, upright its x, and at 45° goes as far across as down,
 * whatever decimals `from` has (a traced plan's do). Tidying the point itself left it a hair off.
 */
const stepFrom = (from: Vec2, dir: Vec2, t: number): Vec2 => ({ x: from.x + round(dir.x * t), y: from.y + round(dir.y * t) })

/**
 * Where a point lands after snapping: on what is drawn nearby (a point, the middle of a line, a
 * crossing, the foot of a perpendicular from `from`, a place upright from one point and level with
 * another, of those the pointer rested on and `from`, a line ending at one of those carried on past
 * it, or `carried`, the line itself, or upright or level with one of them), else on the grid.
 * Shift holds it to 45° steps from `from`, where it still lines up with what is drawn
 * (`heldLine`); Alt turns snapping off.
 */
export function snap(c: Canvas, world: Vec2, e: Keys, exclude: string[], from?: Vec2, carried: Carried[] = []): Target {
  const { zoom } = get().view
  const { snapToGrid, snapToObjects } = usePrefs.getState()
  if (e.altKey) return { p: world, marker: null }
  // What measures the drawing takes its points from what is drawn, never from the grid: a grid
  // point near a corner would give a length that is not the drawing's, with nothing to show it.
  const measuring = MEASURING.includes(get().tool)
  const onGrid = snapToGrid && !measuring
  const step = gridStep(zoom)
  if (e.shiftKey && from) {
    const d = sub(world, from)
    const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
    return measuring ? heldMeasure(c, world, from, angle, exclude) : heldLine(c, world, from, angle, exclude)
  }
  const gridded = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step }
  const hit = snapToObjects ? snapTo(c.snappable, world, SNAP_REACH / zoom, { exclude, from, gridded: onGrid ? gridded : undefined, aligners: trackedPoints(c), extensions: [...carried, ...carriedLines(c)] }) : null
  rest(c, hit)
  if (hit) {
    // A point of an object (or its centre) is taken exactly as it is, and so is what a place lined up with points
    // takes from them (level with one: its y; upright from one: its x), or it would be a hair off
    // level; the rest of a place worked out on a line is tidied.
    const from = (axis: 'x' | 'y') => (hit.kind === 'aligned' && hit.guides?.some(([q]) => q[axis] === hit.p[axis]) ? hit.p[axis] : round(hit.p[axis]))
    const p = hit.kind === 'point' || hit.kind === 'centre' ? hit.p : { x: from('x'), y: from('y') }
    return { p, marker: { p, kind: hit.kind, ...(hit.guides ? { guides: hit.guides } : {}) } }
  }
  return { p: onGrid ? gridded : world, marker: null }
}

/**
 * Where a measured point goes while Shift holds its direction from `from` (`angle`, a multiple
 * of 45°): on that line, at what the pointer meets there. A point pointed at elsewhere (a corner,
 * a middle, a crossing) brings it level with that point, with a link to show what it was taken
 * from; otherwise it stops where the line crosses a drawn line near the pointer (the face of a
 * wall, the side of a rectangle), which is what a dimension measures to; otherwise it is where
 * the pointer is along the line. Never on the grid (see MEASURING).
 */
function heldMeasure(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[]): Target {
  const { zoom } = get().view
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const along = (q: Vec2) => (q.x - from.x) * dir.x + (q.y - from.y) * dir.y
  const at = (t: number) => stepFrom(from, dir, t)
  const pointed = along(world)
  if (usePrefs.getState().snapToObjects) {
    // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
    const target = snapTo(c.snappable, world, SNAP_REACH / zoom, { exclude })
    if (target && target.kind !== 'edge') {
      const p = at(along(target.p))
      return { p, marker: target, ...(dist(p, target.p) > 1e-6 ? { link: [target.p, p] as [Vec2, Vec2] } : {}) }
    }
    // The drawn lines the held line crosses, the nearest to the pointer within reach.
    let reach = SNAP_REACH / zoom
    let crossing: number | null = null
    for (const item of c.snappable) {
      if (exclude.includes(item.id)) continue
      for (const prim of item.prims) {
        // Hatching and the sheets and floors things lie on are not what is measured.
        if (prim.kind !== 'path' || prim.texture || prim.backdrop) continue
        const points = prim.points
        const count = prim.closed ? points.length : points.length - 1
        for (let i = 0; i < count; i++) {
          const a = points[i]
          const edge = sub(points[(i + 1) % points.length], a)
          const denom = dir.x * edge.y - dir.y * edge.x
          if (Math.abs(denom) < 1e-9) continue
          const between = sub(a, from)
          const t = (between.x * edge.y - between.y * edge.x) / denom
          const u = (between.x * dir.y - between.y * dir.x) / denom
          if (u < -1e-9 || u > 1 + 1e-9 || Math.abs(t - pointed) >= reach) continue
          reach = Math.abs(t - pointed)
          crossing = t
        }
      }
    }
    if (crossing !== null) {
      const p = at(crossing)
      return { p, marker: { p, kind: 'crossing' } }
    }
  }
  return { p: at(pointed), marker: null }
}

/**
 * Keeps a point on the line through `from` at `angle`, whatever the grid says: the pointer only
 * chooses how far along. That distance goes by grid steps, except near a line the held line
 * crosses, where it stops on it: a wall's line (its middle, or the face it is drawn by), or
 * anything drawn, a wall's faces, the lines of a traced plan and the sides of shapes included.
 * `forward` keeps it on the side the angle points to.
 */
export function alongLine(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[], forward = false): Target {
  const { zoom } = get().view
  const { snapToGrid, snapToObjects } = usePrefs.getState()
  const step = gridStep(zoom)
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const pointed = (world.x - from.x) * dir.x + (world.y - from.y) * dir.y
  let length = snapToGrid ? Math.round(pointed / step) * step : pointed
  if (forward) length = Math.max(step, length)
  let crossing = false
  let reach = SNAP_REACH / zoom
  const here = { x: from.x + dir.x * pointed, y: from.y + dir.y * pointed }
  const cross = (a: Vec2, b: Vec2) => {
    const e = sub(b, a)
    const denom = dir.x * e.y - dir.y * e.x
    if (Math.abs(denom) < 1e-9) return
    const between = sub(a, from)
    const t = (between.x * e.y - between.y * e.x) / denom
    const u = (between.x * dir.y - between.y * dir.x) / denom
    if (u < -1e-9 || u > 1 + 1e-9 || (forward && t <= 0) || Math.abs(t - pointed) >= reach) return
    reach = Math.abs(t - pointed)
    length = t
    crossing = true
  }
  for (const item of snapToObjects ? c.snappable : []) {
    if (exclude.includes(item.id) || (item.bounds && !boundsContainPoint(item.bounds, here, reach))) continue
    // A curved wall is crossed somewhere along its curve. Hatching, and the sheets and floors things lie on, are not crossed.
    const lines = [
      ...(item.node.type === 'wall' ? [wallPoints(item.node)] : []),
      ...item.prims.flatMap((prim) => (prim.kind === 'path' && !prim.texture && !prim.backdrop ? [prim.closed ? [...prim.points, prim.points[0]] : prim.points] : [])),
    ]
    for (const line of lines) for (let i = 0; i + 1 < line.length; i++) cross(line[i], line[i + 1])
  }
  const p = stepFrom(from, dir, length)
  return { p, marker: crossing ? { p, kind: 'crossing' } : null }
}

/**
 * Where a point goes while its direction from `from` is held (`angle`), by Shift or by an arrow
 * key: on that line, at what the pointer meets there. A point pointed at elsewhere (a corner, an
 * end, a middle) brings it level with that point, with a link to show what it was taken from;
 * otherwise it stops on a line the held line crosses near the pointer, or goes by grid steps.
 */
function heldLine(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[]): Target {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
  const pointed = snap(c, world, { altKey: false, shiftKey: false }, exclude).marker
  if (pointed && pointed.kind !== 'edge') {
    const t = (pointed.p.x - from.x) * dir.x + (pointed.p.y - from.y) * dir.y
    const p = stepFrom(from, dir, t)
    return { p, marker: pointed, ...(dist(p, pointed.p) > 1e-6 ? { link: [pointed.p, p] as [Vec2, Vec2] } : {}) }
  }
  return alongLine(c, world, from, angle, exclude)
}

/** A line a point may be held to by Shift: through `at`, at `angle` (radians). */
export interface Held {
  at: Vec2
  angle: number
}

/** The lines through a point level, upright and at 45°. */
export const squareFrom = (at: Vec2): Held[] => [0, 1, 2, 3].map((k) => ({ at, angle: (k * Math.PI) / 4 }))

/**
 * Of the lines a point may be held to, the one nearest the pointer, and where the point goes on it
 * (`alongLine`): Shift keeps an end on its own line, or brings it level, upright or at 45° with
 * the point it is measured from, whichever the pointer is nearer.
 */
export function heldNearest(c: Canvas, world: Vec2, lines: Held[], exclude: string[]): { line: Held; target: Target } {
  const off = (line: Held) => Math.abs((world.x - line.at.x) * Math.sin(line.angle) - (world.y - line.at.y) * Math.cos(line.angle))
  const line = lines.reduce((best, one) => (off(one) < off(best) - 1e-9 ? one : best))
  return { line, target: alongLine(c, world, line.at, line.angle, exclude) }
}

/**
 * Where the end of a line being drawn from `from` goes. Usually that is `snap`. With the
 * direction held level or upright by an arrow key, the end stays on that line through `from`
 * and the pointer only says how far: by pointing at something elsewhere, in which case the end
 * comes level with it (`link` joins the two, to show what it was taken from), or else by grid
 * steps, stopping on a wall the line crosses.
 */
export function lineEnd(c: Canvas, world: Vec2, e: Keys, exclude: string[], from: Vec2): Target {
  const lock = get().axisLock
  if (!lock) return snap(c, world, e, exclude, from)
  if (e.altKey) return { p: lock === 'x' ? { x: world.x, y: from.y } : { x: from.x, y: world.y }, marker: null }
  return heldLine(c, world, from, lock === 'x' ? 0 : Math.PI / 2, exclude)
}
