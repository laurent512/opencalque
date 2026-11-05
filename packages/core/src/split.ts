import { childrenOf } from './document'
import { add, dist, norm, scale, sub, type Vec2 } from './geometry'
import { rectCorners } from './kinds'
import type { NodeInput, Op } from './ops'
import type { Document, Node } from './schema'
import { courseOf, cross, dot, JOIN_TOLERANCE, tidy, wallArc, wallParallel, wallPoints, wallSides } from './walls/course'
import { splitWallOps } from './walls/edit'

/** A place to cut something in two: the point, which way the thing runs there, and how long it is on either side. */
export interface SplitPlace {
  at: Vec2
  dir: Vec2
  before: number
  after: number
  /** Points halfway along each side, to write their lengths at. */
  beforeMiddle: Vec2
  afterMiddle: Vec2
  /** Each side as a string of points along the thing, from its start to the cut and from the cut to its end, to show what the lengths measure. */
  parts: [Vec2[], Vec2[]]
}

/** What can be cut in two: a wall, a line, a room divider, or a polyline that is not closed. */
export const canSplit = (node: Node): boolean => node.type === 'wall' || node.type === 'line' || node.type === 'divider' || (node.type === 'polyline' && !node.closed)

/** The points of what can be cut, as a run of straight stretches, or a course for a wall. */
function along(node: Node): { length: number; at(s: number): Vec2; dir(s: number): Vec2; project(p: Vec2): number } | null {
  if (node.type === 'wall') {
    const course = courseOf(node)
    return { length: course.length, at: course.at, dir: course.dir, project: (p) => course.project(p).along }
  }
  const points = node.type === 'line' || node.type === 'divider' ? [node.a, node.b] : node.type === 'polyline' && !node.closed ? node.points : null
  if (!points || points.length < 2) return null
  const starts: number[] = []
  let length = 0
  for (let i = 0; i < points.length - 1; i++) {
    starts.push(length)
    length += dist(points[i], points[i + 1])
  }
  const stretch = (s: number) => {
    let i = starts.length - 1
    while (i > 0 && starts[i] > s) i--
    return i
  }
  return {
    length,
    at: (s) => {
      const i = stretch(s)
      const piece = dist(points[i], points[i + 1])
      return piece < 1e-9 ? points[i] : add(points[i], scale(sub(points[i + 1], points[i]), (s - starts[i]) / piece))
    },
    dir: (s) => {
      const i = stretch(s)
      return norm(sub(points[i + 1], points[i]))
    },
    project: (p) => {
      let best = { s: 0, d: Infinity }
      for (let i = 0; i < points.length - 1; i++) {
        const piece = dist(points[i], points[i + 1])
        if (piece < 1e-9) continue
        const d = norm(sub(points[i + 1], points[i]))
        const t = Math.max(0, Math.min(piece, dot(sub(p, points[i]), d)))
        const q = add(points[i], scale(d, t))
        if (dist(q, p) < best.d) best = { s: starts[i] + t, d: dist(q, p) }
      }
      return best.s
    },
  }
}

/**
 * Where `node` would be cut for a pointer at `p`: the nearest point on it, or, with `step`, the
 * point whose distance from its start is the nearest whole number of steps. Null when that is
 * at one of its ends, or the node cannot be cut.
 */
export function splitPlace(node: Node, p: Vec2, step?: number): SplitPlace | null {
  const run = canSplit(node) ? along(node) : null
  if (!run) return null
  let s = run.project(p)
  if (step && step > 0) s = Math.round(s / step) * step
  if (s < JOIN_TOLERANCE * 2 || s > run.length - JOIN_TOLERANCE * 2) return null
  const at = run.at(s)
  const stretch = (from: number, to: number) => Array.from({ length: 33 }, (_, i) => run.at(from + ((to - from) * i) / 32))
  return {
    at: { x: tidy(at.x), y: tidy(at.y) },
    dir: run.dir(s),
    before: s,
    after: run.length - s,
    beforeMiddle: run.at(s / 2),
    afterMiddle: run.at((s + run.length) / 2),
    parts: [stretch(0, s), stretch(s, run.length)],
  }
}

/** The operations that cut `node` in two at `place`, the second part becoming a node with the id given. */
export function splitOps(node: Node, place: SplitPlace, newId: string): Op[] | null {
  if (node.type === 'wall') return splitWallOps(node, place.at, newId)?.ops ?? null
  const { id: _, order: __, ...rest } = node
  if (node.type === 'line' || node.type === 'divider') {
    // The ends keep their symbols: the first part its start, the second its end.
    const { startMarker, endMarker, ...plain } = rest as typeof rest & { startMarker?: unknown; endMarker?: unknown }
    return [
      { op: 'update_node', id: node.id, patch: { b: place.at, endMarker: null } },
      { op: 'add_node', node: { ...plain, ...(endMarker === undefined ? {} : { endMarker }), id: newId, a: place.at, b: node.b } as NodeInput },
    ]
  }
  if (node.type === 'polyline') {
    const run = along(node)!
    // The points before the cut stay with the first part, those after go to the second.
    const starts: number[] = []
    let length = 0
    for (let i = 0; i < node.points.length; i++) {
      starts.push(length)
      if (i < node.points.length - 1) length += dist(node.points[i], node.points[i + 1])
    }
    const first = node.points.filter((_, i) => starts[i] < place.before - 1e-6)
    const second = node.points.filter((_, i) => starts[i] > place.before + 1e-6)
    if (first.length === 0 || second.length === 0 || run.length < 1e-6) return null
    const { startMarker, endMarker, ...plain } = rest as typeof rest & { startMarker?: unknown; endMarker?: unknown }
    return [
      { op: 'update_node', id: node.id, patch: { points: [...first, place.at], endMarker: null } },
      { op: 'add_node', node: { ...plain, ...(endMarker === undefined ? {} : { endMarker }), id: newId, points: [place.at, ...second] } as NodeInput },
    ]
  }
  return null
}

/** What the trim tool would take away of something: the stretch between `from` and `to`, distances along it from its start, of its `length`; `piece`, that stretch as points. */
export interface TrimPlace {
  from: number
  to: number
  length: number
  piece: Vec2[]
}

/** The points of what can be trimmed, from its start to its end: a straight wall's line, a line, a divider, an open polyline. */
function runPoints(node: Node): Vec2[] | null {
  if (node.type === 'wall') return wallArc(node) ? null : [node.a, node.b]
  if (node.type === 'line' || node.type === 'divider') return [node.a, node.b]
  return node.type === 'polyline' && !node.closed && node.points.length >= 2 ? node.points : null
}

/**
 * The lines that cut what is trimmed, among what lies beside it: for a wall, the lines of the
 * other walls, so that what is left of it ends against them as a T; for a line, the other lines,
 * dividers, polylines and rectangles, and the faces of walls.
 */
function cuttingEdges(doc: Document, node: Node): Vec2[][] {
  const edges: Vec2[][] = []
  for (const other of childrenOf(doc, node.parent!)) {
    if (other.id === node.id || other.visible === false) continue
    if (node.type === 'wall') {
      if (other.type === 'wall') edges.push(wallPoints(other))
      continue
    }
    if (other.type === 'line' || other.type === 'divider') edges.push([other.a, other.b])
    else if (other.type === 'polyline') edges.push(other.closed ? [...other.points, other.points[0]] : other.points)
    else if (other.type === 'rect') edges.push([...rectCorners(other), rectCorners(other)[0]])
    else if (other.type === 'wall') {
      const { left, right } = wallSides(other)
      edges.push(wallParallel(other, -left), wallParallel(other, right))
    }
  }
  return edges
}

/** Where the edges cross a run of points, as distances along it from its start, its ends left out, in order. */
function cutsAlong(points: Vec2[], edges: Vec2[][]): number[] {
  const cuts: number[] = []
  let start = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const d = sub(points[i + 1], points[i])
    const piece = Math.hypot(d.x, d.y)
    for (const edge of edges) {
      for (let j = 0; j + 1 < edge.length; j++) {
        const e = sub(edge[j + 1], edge[j])
        const denom = cross(d, e)
        if (Math.abs(denom) < 1e-9) continue
        const between = sub(edge[j], points[i])
        const t = cross(between, e) / denom
        const u = cross(between, d) / denom
        if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-6 && u <= 1 + 1e-6) cuts.push(start + t * piece)
      }
    }
    start += piece
  }
  return cuts.filter((s) => s > JOIN_TOLERANCE && s < start - JOIN_TOLERANCE).sort((p, q) => p - q)
}

/**
 * What the trim tool takes away of `node` for a pointer at `p`, as CAD programs trim: the stretch
 * of it between the nearest places where other things cross it on either side of the pointer, or
 * from one of its ends to the nearest. Null when nothing crosses it, or it cannot be trimmed (a
 * curved wall, a closed shape).
 */
export function trimPlace(doc: Document, node: Node, p: Vec2): TrimPlace | null {
  const points = runPoints(node)
  const run = points && along(node)
  if (!points || !run || run.length < 1e-6 || node.parent === null) return null
  const cuts = cutsAlong(points, cuttingEdges(doc, node))
  if (cuts.length === 0) return null
  const s = run.project(p)
  const from = cuts.filter((cut) => cut < s).pop() ?? 0
  const to = cuts.find((cut) => cut > s) ?? run.length
  const steps = Math.max(2, Math.ceil(((to - from) / run.length) * 32))
  return { from, to, length: run.length, piece: Array.from({ length: steps + 1 }, (_, i) => run.at(from + ((to - from) * i) / steps)) }
}

/**
 * The operations that take `place` (from `trimPlace`) away from `node`: an end is cut back to where
 * the stretch starts, and a stretch in the middle leaves two parts, the second a node with the id
 * given. A wall cut so ends against the wall that crossed it.
 */
export function trimOps(node: Node, place: TrimPlace, newId: string): Op[] | null {
  const run = along(node)
  const points = runPoints(node)
  if (!run || !points) return null
  const at = (s: number): Vec2 => {
    const p = run.at(s)
    return { x: tidy(p.x), y: tidy(p.y) }
  }
  const atStart = place.from <= 0
  const atEnd = place.to >= place.length
  if (atStart && atEnd) return null
  if (node.type !== 'polyline') {
    if (atStart) return [{ op: 'update_node', id: node.id, patch: { a: at(place.to) } }]
    if (atEnd) return [{ op: 'update_node', id: node.id, patch: { b: at(place.from) } }]
    // In the middle: cut in two where the stretch ends, then the first part back to where it starts.
    const split = splitPlace(node, at(place.to))
    const ops = split && splitOps(node, split, newId)
    return ops && [...ops, { op: 'update_node', id: node.id, patch: { b: at(place.from) } }]
  }
  // A polyline keeps the corners before the stretch, and those after it.
  let length = 0
  const starts = points.map((point, i) => (i === 0 ? 0 : (length += dist(points[i - 1], point))))
  const before = [...points.filter((_, i) => starts[i] < place.from - 1e-6), at(place.from)]
  const after = [at(place.to), ...points.filter((_, i) => starts[i] > place.to + 1e-6)]
  if (atStart) return [{ op: 'update_node', id: node.id, patch: { points: after } }]
  if (atEnd) return [{ op: 'update_node', id: node.id, patch: { points: before } }]
  const { id: _, order: __, startMarker: ___, ...rest } = node
  return [
    { op: 'update_node', id: node.id, patch: { points: before, endMarker: null } },
    { op: 'add_node', node: { ...rest, id: newId, points: after } as NodeInput },
  ]
}
