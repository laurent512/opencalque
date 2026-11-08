import { boundsContainPoint, dist, type Bounds, type Vec2 } from './geometry'
import { kindOf } from './kinds'
import type { Registry } from './registry'
import { heldItems, sceneBounds, snapPointsOf, type SceneItem } from './scene'
import type { Document, Node } from './schema'

/**
 * Snapping: where a point being placed lands on what is already drawn, and how something being
 * moved lines up with the things around it. Both are worked out from the scene alone, so they
 * know nothing of node types beyond what each kind says of itself (`snapPoints`, `snapLines`).
 */

/**
 * What a point snapped to: a point of an object, the centre of a shape, the middle of a line,
 * where two lines cross, the foot of a perpendicular, the nearest place on a line, or a place
 * lined up with points around it.
 */
export type SnapKind = 'point' | 'centre' | 'middle' | 'crossing' | 'perpendicular' | 'edge' | 'aligned'

export interface Snap {
  p: Vec2
  kind: SnapKind
  /** For a place lined up with points around it: the lines from each of those points to it, to be shown. */
  guides?: [Vec2, Vec2][]
}

export interface SnapOptions {
  /** Items that are not snapped to: usually the one being drawn or dragged. */
  exclude?: string[]
  /** Where the line being drawn starts. With it, the foot of a perpendicular from there onto a line is offered. */
  from?: Vec2
  /**
   * Points to line up with, besides `from`: in the editor, those the pointer rested on lately.
   * Lining up with every point of a drawing would find a line almost anywhere in a full plan.
   */
  aligners?: Vec2[]
  /** The pointer as the grid would have it. A line with nothing more precise nearby is then taken at the place nearest to this, so that going along a level or upright line still goes by grid steps. */
  gridded?: Vec2
}

/** Which is kept of two places equally near the pointer: the more specific. The centre of a circle is also one of its points, and is called its centre. */
const RANK: Record<SnapKind, number> = { centre: 0, point: 1, crossing: 2, middle: 3, perpendicular: 4, edge: 5, aligned: 6 }
/** A line that turns by less than this (radians, 12°) at a point is a curve passing through it, not a corner. */
const CORNER = Math.PI / 15
/** No more than this many stretches of line near the pointer are tried against one another for crossings. */
const MAX_NEAR = 60

/** The lines of an item that can be snapped onto, each as the points it goes through. */
export function snapLinesOf(item: SceneItem): Vec2[][] {
  const drawn = item.prims.flatMap((p) => (p.kind === 'path' && !p.texture && p.backdrop !== 'floor' && p.points.length > 1 ? [p.closed ? [...p.points, p.points[0]] : p.points] : []))
  return kindOf(item.node).snapLines?.(item.node, drawn) ?? drawn
}

/** The point of a-b nearest to `p`, and how far along it is as a fraction. */
function nearestOn(p: Vec2, a: Vec2, b: Vec2): { at: Vec2; t: number } {
  const d = { x: b.x - a.x, y: b.y - a.y }
  const length2 = d.x * d.x + d.y * d.y
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / length2))
  return { at: { x: a.x + d.x * t, y: a.y + d.y * t }, t }
}

/** One straight stretch of a line near the pointer. `corners` says whether each of its ends is a corner (or the end of the line) rather than a point a curve passes through. */
interface Stretch {
  a: Vec2
  b: Vec2
  corners: [boolean, boolean]
}

/** Whether a line turns sharply at point `i`; its two ends count as corners. */
function isCorner(line: Vec2[], i: number): boolean {
  if (i <= 0 || i >= line.length - 1) return true
  const turn = Math.atan2(line[i + 1].y - line[i].y, line[i + 1].x - line[i].x) - Math.atan2(line[i].y - line[i - 1].y, line[i].x - line[i - 1].x)
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > CORNER
}

/**
 * Where a point being placed at `at` snaps to among what is drawn, within `reach` (in mm: a
 * number of screen pixels at the current zoom), or null when nothing is near enough.
 *
 * Offered, nearest first and the more specific first when equally near: the points each object
 * gives to snap to and the corners of its lines, the places where two lines cross, the middle of
 * a straight line, and the foot of the perpendicular from `from`. With none of those in reach, the
 * place upright from one point and level with another, of `aligners` and `from`, where both are in
 * reach; then a line itself, the place on it nearest to the pointer; then a place upright or level
 * with one of them, the grid saying where along.
 */
export function snapTo(scene: SceneItem[], at: Vec2, reach: number, options: SnapOptions = {}): Snap | null {
  const { exclude = [], from, gridded, aligners = [] } = options
  let best: Snap | null = null
  let nearest = Infinity
  const offer = (p: Vec2, kind: SnapKind) => {
    const d = dist(p, at)
    if (d > reach) return
    if (d < nearest - 1e-9 || (best !== null && Math.abs(d - nearest) <= 1e-9 && RANK[kind] < RANK[best.kind])) {
      best = { p, kind }
      nearest = d
    }
  }

  const near: Stretch[] = []
  for (const item of scene) {
    if (exclude.includes(item.id)) continue
    for (const q of snapPointsOf(item)) offer(q, 'point')
    const centre = kindOf(item.node).centre?.(item.node)
    if (centre) offer(centre, 'centre')
    if (!item.bounds || !boundsContainPoint(item.bounds, at, reach)) continue
    for (const line of snapLinesOf(item)) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [a, b] = [line[i], line[i + 1]]
        if (dist(nearestOn(at, a, b).at, at) > reach) continue
        near.push({ a, b, corners: [isCorner(line, i), isCorner(line, i + 1)] })
      }
    }
  }

  for (const { a, b, corners } of near) {
    if (corners[0]) offer(a, 'point')
    if (corners[1]) offer(b, 'point')
    // The middle of a straight line means something; the middle of one small stretch of a curve
    // does not, and nor does one so close to both ends that they would be snapped to instead.
    if (corners[0] && corners[1] && dist(a, b) > 4 * reach) offer({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'middle')
    if (from) {
      const d = { x: b.x - a.x, y: b.y - a.y }
      const length2 = d.x * d.x + d.y * d.y
      const t = length2 === 0 ? -1 : ((from.x - a.x) * d.x + (from.y - a.y) * d.y) / length2
      const foot = { x: a.x + d.x * t, y: a.y + d.y * t }
      // A line started on this very line has no perpendicular to it.
      if (t >= 0 && t <= 1 && dist(foot, from) > 1e-6) offer(foot, 'perpendicular')
    }
  }
  const tried = near.slice(0, MAX_NEAR)
  for (let i = 0; i < tried.length; i++) {
    for (let j = i + 1; j < tried.length; j++) {
      const [p, q] = [tried[i], tried[j]]
      const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y }
      const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y }
      const denominator = r.x * s.y - r.y * s.x
      if (Math.abs(denominator) < 1e-9) continue
      const between = { x: q.a.x - p.a.x, y: q.a.y - p.a.y }
      const t = (between.x * s.y - between.y * s.x) / denominator
      const u = (between.x * r.y - between.y * r.x) / denominator
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue
      // Two stretches that follow one another meet at the point they share, which is no crossing.
      const ends = (v: number) => v < 1e-9 || v > 1 - 1e-9
      if (ends(t) && ends(u)) continue
      offer({ x: p.a.x + r.x * t, y: p.a.y + r.y * t }, 'crossing')
    }
  }
  if (best) return best

  // Lined up with the points given: upright from the nearest across, level with the nearest up and down.
  let upright: Vec2 | null = null
  let level: Vec2 | null = null
  const line = (q: Vec2) => {
    const dx = Math.abs(q.x - at.x)
    const dy = Math.abs(q.y - at.y)
    if (dx <= reach && dist(q, at) > reach && (!upright || dx < Math.abs(upright.x - at.x) - 1e-9)) upright = q
    if (dy <= reach && dist(q, at) > reach && (!level || dy < Math.abs(level.y - at.y) - 1e-9)) level = q
  }
  for (const q of aligners) line(q)
  if (from) line(from)
  const [x, y] = [upright as Vec2 | null, level as Vec2 | null]
  if (x && y) {
    const p = { x: x.x, y: y.y }
    return { p, kind: 'aligned', guides: [[x, p], [y, p]] }
  }

  let edge: Snap | null = null
  let off = Infinity
  for (const { a, b } of near) {
    const here = nearestOn(at, a, b).at
    if (dist(here, at) >= off) continue
    off = dist(here, at)
    const stepped = gridded ? nearestOn(gridded, a, b).at : here
    edge = { p: dist(stepped, at) <= 3 * reach ? stepped : here, kind: 'edge' }
  }
  if (edge || (!x && !y)) return edge
  const along = gridded ?? at
  const p = x ? { x: x.x, y: along.y } : { x: along.x, y: y!.y }
  return { p, kind: 'aligned', guides: [[(x ?? y)!, p]] }
}

/** Something that can be lined up with: the box around it, and the points it gives to snap to. */
export interface Alignable {
  bounds: Bounds
  points: Vec2[]
}

/** A thing with more points than this lines up by its box alone: matching them all would find a fit almost anywhere. */
const ALIGN_POINTS = 12
/** A group holding more things than this, of those kept, lines up by its own box alone, so that each movement stays quick. */
const ALIGN_HELD = 2000

/**
 * What a move of the items `ids` of a scene lines up by, the box around them with their points,
 * and with: each other item that `keep` keeps (in the editor, those in sight) by its box and its
 * points. A group counts as itself and as each thing it holds, however deeply, so that a thing
 * lines up with one wall of a plan whose walls were grouped together. Pictures to trace over are
 * not lined up with.
 */
export function alignables(scene: SceneItem[], doc: Document, registry: Registry, ids: ReadonlySet<string>, keep: (bounds: Bounds) => boolean = () => true): { moving: Alignable | null; others: Alignable[] } {
  const points = (items: SceneItem[]) => {
    const all = items.flatMap(snapPointsOf)
    return all.length > ALIGN_POINTS ? [] : all
  }
  // Something inside a group may be what is moved, picked in the Structure panel, or be in a group that is.
  const moved = (node: Node, group: string) => {
    for (let at: Node | undefined = node; at && at.id !== group; at = doc.nodes[at.parent ?? '']) if (ids.has(at.id)) return true
    return false
  }
  const counts = (item: SceneItem): item is SceneItem & { bounds: Bounds } => !!item.bounds && item.node.type !== 'image' && keep(item.bounds)
  const others = scene.flatMap((item): Alignable[] => {
    if (ids.has(item.id) || !counts(item)) return []
    const held = item.node.type === 'group' ? heldItems(doc, item.id, registry).filter((one) => !moved(one.node, item.id) && counts(one)) : []
    return [item, ...(held.length > ALIGN_HELD ? [] : held)].map((one) => ({ bounds: one.bounds!, points: points([one]) }))
  })
  const mine = scene.filter((item) => ids.has(item.id))
  const bounds = sceneBounds(mine)
  return { moving: bounds && { bounds, points: points(mine) }, others }
}

export interface MoveSnap {
  /** The movement to make instead of the one asked for. */
  d: Vec2
  /** Whether the movement was changed along X, and along Y. Where it was not, the caller is free to round it to the grid. */
  x: boolean
  y: boolean
}

export interface MoveGuides {
  /** Lines to show where what is moved lines up with something: each from the one to the other. */
  lines: [Vec2, Vec2][]
  /** Equal gaps to show, each as the stretch of empty space it is. */
  gaps: [Vec2, Vec2][]
}

type Axis = 'x' | 'y'
const across = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')
const span = (b: Bounds, axis: Axis): [number, number] => (axis === 'x' ? [b.minX, b.maxX] : [b.minY, b.maxY])
const pointOn = (axis: Axis, along: number, other: number): Vec2 => (axis === 'x' ? { x: along, y: other } : { x: other, y: along })

/**
 * A value along an axis that can be lined up with, and the stretch of the other axis it is found
 * over. The sides and middle of a box line up with those of other boxes, and points with points:
 * matching everything with everything would find something to snap to almost anywhere.
 */
interface Mark {
  v: number
  from: number
  to: number
  box: boolean
}

function marks(thing: Alignable, axis: Axis, d: Vec2 = { x: 0, y: 0 }): Mark[] {
  const [lo, hi] = span(thing.bounds, axis)
  const [from, to] = span(thing.bounds, across(axis)).map((v) => v + d[across(axis)])
  return [
    ...[lo, (lo + hi) / 2, hi].map((v) => ({ v: v + d[axis], from, to, box: true })),
    ...thing.points.map((p) => ({ v: p[axis] + d[axis], from: p[across(axis)] + d[across(axis)], to: p[across(axis)] + d[across(axis)], box: false })),
  ]
}

/** The things beside what is moved along an axis: those it would pass in front of if it slid that way. */
function mates(moving: Alignable, others: Alignable[], axis: Axis, d: Vec2): Bounds[] {
  const [from, to] = span(moving.bounds, across(axis)).map((v) => v + d[across(axis)])
  return others.map((o) => o.bounds).filter((b) => span(b, across(axis))[0] < to && span(b, across(axis))[1] > from)
}

/** A place along an axis where what is moved would stand at equal gaps from its neighbours, with those gaps. */
interface Spacing {
  /** Where its near side would be. */
  lo: number
  gaps: [number, number][]
}

function spacings(moving: Alignable, others: Alignable[], axis: Axis, d: Vec2, reach: number): Spacing[] {
  const [lo, hi] = span(moving.bounds, axis).map((v) => v + d[axis])
  const width = hi - lo
  const row = mates(moving, others, axis, d).map((b) => span(b, axis))
  // Its neighbours on either side: the nearest thing that ends before it, the nearest that starts after it.
  const before = row.filter((s) => s[1] <= lo + reach).sort((p, q) => q[1] - p[1])[0]
  const after = row.filter((s) => s[0] >= hi - reach).sort((p, q) => p[0] - q[0])[0]
  const found: Spacing[] = []
  // Halfway between its two neighbours.
  if (before && after && after[0] - before[1] > width) {
    const at = (before[1] + after[0] - width) / 2
    found.push({ lo: at, gaps: [[before[1], at], [at + width, after[0]]] })
  }
  // As far from its neighbour as that one is from the next one along.
  if (before) {
    const further = row.filter((s) => s[1] <= before[0]).sort((p, q) => q[1] - p[1])[0]
    if (further && before[0] - further[1] > 0) found.push({ lo: before[1] + before[0] - further[1], gaps: [[further[1], before[0]], [before[1], before[1] + before[0] - further[1]]] })
  }
  if (after) {
    const further = row.filter((s) => s[0] >= after[1]).sort((p, q) => p[0] - q[0])[0]
    if (further && further[0] - after[1] > 0) found.push({ lo: after[0] - (further[0] - after[1]) - width, gaps: [[after[0] - (further[0] - after[1]), after[0]], [after[1], further[0]]] })
  }
  return found
}

/**
 * How a movement by `d` should be adjusted so that what is moved lines up with what is around
 * it. Along each axis on its own, the sides and the middle of its box are tried against those of
 * every other thing, and its points against their points; so are the places where it would stand
 * at equal gaps from its neighbours. Whatever is within `reach` and nearest wins, lining up before spacing out.
 */
export function alignMove(moving: Alignable, others: Alignable[], d: Vec2, reach: number): MoveSnap {
  const fix = (axis: Axis): number | null => {
    let best: number | null = null
    const own = marks(moving, axis, d)
    for (const other of others) {
      for (const target of marks(other, axis)) {
        for (const mark of own) {
          const change = target.v - mark.v
          if (mark.box === target.box && Math.abs(change) <= reach && (best === null || Math.abs(change) < Math.abs(best))) best = change
        }
      }
    }
    const lo = span(moving.bounds, axis)[0] + d[axis]
    for (const spacing of spacings(moving, others, axis, d, reach)) {
      const change = spacing.lo - lo
      if (Math.abs(change) <= reach && (best === null || Math.abs(change) < Math.abs(best) - 1e-9)) best = change
    }
    return best
  }
  const [x, y] = [fix('x'), fix('y')]
  return { d: { x: d.x + (x ?? 0), y: d.y + (y ?? 0) }, x: x !== null, y: y !== null }
}

/** As close as two values need to be to count as lined up, in mm. */
const LINED_UP = 0.01

/**
 * What to show once something has been moved by `d`: a line wherever it now lines up with
 * another thing, and the gaps it now keeps equal with its neighbours. It reports what is true of
 * where things are, however they got there, so the grid lining things up shows as well.
 */
export function moveGuides(moving: Alignable, others: Alignable[], d: Vec2): MoveGuides {
  const lines: [Vec2, Vec2][] = []
  const gaps: [Vec2, Vec2][] = []
  for (const axis of ['x', 'y'] as const) {
    // One line for each value lined up on, running over everything that shares it.
    const found = new Map<number, [number, number]>()
    const own = marks(moving, axis, d)
    for (const other of others) {
      for (const target of marks(other, axis)) {
        for (const mark of own) {
          if (mark.box !== target.box || Math.abs(target.v - mark.v) > LINED_UP) continue
          const key = Math.round(target.v / LINED_UP)
          const seen = found.get(key)
          found.set(key, [Math.min(seen?.[0] ?? Infinity, mark.from, target.from), Math.max(seen?.[1] ?? -Infinity, mark.to, target.to)])
        }
      }
    }
    for (const [key, [from, to]] of [...found].slice(0, 6)) lines.push([pointOn(axis, key * LINED_UP, from), pointOn(axis, key * LINED_UP, to)])

    const lo = span(moving.bounds, axis)[0] + d[axis]
    const [from, to] = span(moving.bounds, across(axis)).map((v) => v + d[across(axis)])
    const spacing = spacings(moving, others, axis, d, LINED_UP).find((s) => Math.abs(s.lo - lo) <= LINED_UP)
    for (const [start, end] of spacing?.gaps ?? []) gaps.push([pointOn(axis, start, (from + to) / 2), pointOn(axis, end, (from + to) / 2)])
  }
  return { lines, gaps }
}
