import { childrenOf, isVisible, leavesOf, rootOf } from './document'
import { add, applyTransform, dist, distToSegment, mid, norm, perp, scale, sub, type Vec2 } from './geometry'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Document, Node, NodeOf } from './schema'

type Wall = NodeOf<'wall'>

/** Wall ends closer than this (mm) are treated as meeting at one joint. */
const JOIN_TOLERANCE = 0.5
/** A mitre sticking out further than this many half-thicknesses is cut off square instead. */
const MITER_LIMIT = 4

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
// Adding 0 turns -0 into 0.
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0

/** Everything drawn on the same page or component as `parentId`, whatever groups it is in. */
const drawnWith = (doc: Document, parentId: string | null): Node[] => {
  const root = rootOf(doc, parentId)
  return root ? leavesOf(doc, root.id) : []
}

// Grouping is only a way of organising: walls join, and openings cut, across group boundaries.
const wallsIn = (doc: Document, parentId: string | null): Wall[] => drawnWith(doc, parentId).filter((n): n is Wall => n.type === 'wall')

/** One wall leaving a joint: its direction away from the joint, half thickness and length. */
interface Ray {
  d: Vec2
  h: number
  length: number
  angle: number
  self: boolean
}

/**
 * Where the "plus" face of ray `a` meets the "minus" face of ray `b`, its neighbour going around
 * the joint. Returns the outline points each wall takes, ordered from its own face towards the joint.
 */
function meet(p: Vec2, a: Ray, b: Ray): { a: Vec2[]; b: Vec2[] } {
  const qa = add(p, scale(perp(a.d), a.h))
  const qb = sub(p, scale(perp(b.d), b.h))
  const square = { a: [qa], b: [qb] }
  const denom = cross(a.d, b.d)
  if (Math.abs(denom) < 1e-9) return square
  const between = sub(qb, qa)
  const s = cross(between, b.d) / denom
  const u = cross(between, a.d) / denom
  // The faces would cross beyond the far end of a wall: too short to mitre.
  if (s > a.length || u > b.length) return square
  const c = add(qa, scale(a.d, s))
  if (s < 0 && dist(c, p) > MITER_LIMIT * Math.max(a.h, b.h)) {
    const m = mid(qa, qb)
    return { a: [qa, m], b: [qb, m] }
  }
  return { a: [c], b: [c] }
}

/**
 * The outline of a wall end at `p`, from its minus face round to its plus face. A free end is cut
 * square. Where other walls end at the same point, the faces are mitred with their neighbours and
 * the outline passes through `p`, so the walls around a joint tile it exactly.
 */
function cap(p: Vec2, wall: Wall, away: Vec2, walls: Wall[]): Vec2[] {
  const rays: Ray[] = []
  for (const w of walls) {
    const length = dist(w.a, w.b)
    if (length < 1e-6) continue
    for (const [end, other] of [[w.a, w.b], [w.b, w.a]]) {
      const self = w.id === wall.id
      if (self ? end !== p : dist(end, p) > JOIN_TOLERANCE) continue
      const d = self ? away : norm(sub(other, end))
      rays.push({ d, h: w.thickness / 2, length, angle: Math.atan2(d.y, d.x), self })
    }
  }
  const h = wall.thickness / 2
  if (rays.length < 2) return [sub(p, scale(perp(away), h)), add(p, scale(perp(away), h))]
  rays.sort((x, y) => x.angle - y.angle)
  const i = rays.findIndex((r) => r.self)
  const me = rays[i]
  const next = rays[(i + 1) % rays.length]
  const prev = rays[(i + rays.length - 1) % rays.length]
  return [...meet(p, prev, me).b, p, ...meet(p, me, next).a.reverse()]
}

/** The stretch a parametric node cuts out of a wall, as two world points, or null if it cuts nothing. */
export function openingSpan(node: Node, registry: Registry): [Vec2, Vec2] | null {
  if (node.type !== 'parametric') return null
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  return [applyTransform({ x: opening.from, y: 0 }, node), applyTransform({ x: opening.to, y: 0 }, node)]
}

/** The part of a wall's centerline (distances from `a`) covered by a span lying inside the wall. */
function overlap(wall: Wall, span: [Vec2, Vec2]): [number, number] | null {
  const length = dist(wall.a, wall.b)
  if (length < 1e-6) return null
  const d = norm(sub(wall.b, wall.a))
  const ts: number[] = []
  for (const p of span) {
    const rel = sub(p, wall.a)
    if (Math.abs(cross(d, rel)) > wall.thickness / 2 + 1e-6) return null
    ts.push(dot(rel, d))
  }
  const from = Math.max(0, Math.min(...ts))
  const to = Math.min(length, Math.max(...ts))
  return to - from > 1e-6 ? [from, to] : null
}

/** The wall an opening sits in, if any. */
export function hostWall(doc: Document, node: Node, registry: Registry): Wall | null {
  const span = openingSpan(node, registry)
  if (!span) return null
  return wallsIn(doc, node.parent).find((wall) => overlap(wall, span)) ?? null
}

/**
 * The outline of a wall as one polygon per solid stretch: ends mitred into the walls they meet,
 * and gaps left for the doors and windows placed on it.
 */
export function wallPolygons(wall: Wall, doc: Document, registry: Registry): Vec2[][] {
  const length = dist(wall.a, wall.b)
  if (length < 1e-6) return []
  const d = norm(sub(wall.b, wall.a))
  const n = scale(perp(d), wall.thickness / 2)
  const walls = wallsIn(doc, wall.parent)
  const capA = cap(wall.a, wall, d, walls)
  const capB = cap(wall.b, wall, scale(d, -1), walls)

  const cuts: [number, number][] = []
  for (const node of drawnWith(doc, wall.parent)) {
    const span = isVisible(doc, node) ? openingSpan(node, registry) : null
    const cut = span && overlap(wall, span)
    if (cut) cuts.push(cut)
  }
  cuts.sort((x, y) => x[0] - y[0])

  const at = (t: number) => add(wall.a, scale(d, t))
  const polygons: Vec2[][] = []
  const piece = (from: number, to: number) => {
    const left = from <= 0 ? capA : [sub(at(from), n), add(at(from), n)]
    const right = to >= length ? capB : [add(at(to), n), sub(at(to), n)]
    polygons.push([...left, ...right])
  }
  let start = 0
  for (const [from, to] of cuts) {
    if (from > start + 1e-6) piece(start, from)
    start = Math.max(start, to)
  }
  if (start < length - 1e-6) piece(start, length)
  return polygons
}

/**
 * Where to put an opening so that it sits on the wall nearest to `p`: centred under the cursor,
 * turned to follow the wall and opening towards the cursor's side. Returns null when no wall is
 * within `reach` of `p`. `step` is the grid the opening's edges are rounded to along the wall.
 * Pass `keepRotation` when moving an existing opening, so it stays on the side it already faces.
 */
export function snapOpeningToWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: { kind: string; props: Record<string, unknown>; flipX?: boolean },
  p: Vec2,
  reach: number,
  step: number,
  keepRotation?: number,
): { x: number; y: number; rotation: number } | null {
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  let wall: Wall | null = null
  let nearest = Infinity
  for (const w of wallsIn(doc, containerId)) {
    const distance = distToSegment(p, w.a, w.b) - w.thickness / 2
    if (distance <= reach && distance < nearest) {
      wall = w
      nearest = distance
    }
  }
  if (!wall) return null
  const length = dist(wall.a, wall.b)
  const d = norm(sub(wall.b, wall.a))
  const half = Math.abs(opening.to - opening.from) / 2
  let t = Math.round((dot(sub(p, wall.a), d) - half) / step) * step + half
  if (length >= 2 * half) t = Math.max(half, Math.min(length - half, t))
  const center = add(wall.a, scale(d, t))
  const along = (Math.atan2(d.y, d.x) * 180) / Math.PI
  const facing =
    keepRotation === undefined
      ? dot(sub(p, center), perp(d)) >= 0
      : Math.cos(((keepRotation - along) * Math.PI) / 180) >= 0
  const rotation = (((along + (facing ? 0 : 180)) % 360) + 360) % 360
  const offset = applyTransform({ x: (opening.from + opening.to) / 2, y: 0 }, { x: 0, y: 0, rotation, flipX: node.flipX })
  return { x: tidy(center.x - offset.x), y: tidy(center.y - offset.y), rotation: tidy(rotation) }
}

/** The given nodes with every group among them replaced by what it holds, at any depth. */
const flatten = (doc: Document, nodes: Node[]): Node[] => nodes.flatMap((n) => (n.type === 'group' ? flatten(doc, childrenOf(doc, n.id)) : [n]))

/**
 * What has to follow when nodes are moved by `d` for the plan to stay in one piece. Walls are tied
 * to each other, and openings to walls, by position only, so this is where the ties are honoured:
 * - an end of another wall that met an end of a moved wall goes with it, so that wall stretches
 *   and turns instead of being left behind;
 * - a door or window sitting in a moved wall goes with it.
 * `doc` is the drawing before the move. The result does not include the move itself.
 */
export function wallFollowOps(doc: Document, moved: Node[], d: Vec2, registry: Registry): Op[] {
  const leaves = flatten(doc, moved)
  const going = new Set(leaves.map((n) => n.id))
  const walls = leaves.filter((n): n is Wall => n.type === 'wall')
  if (walls.length === 0) return []
  const ends = new Map<string, { a?: Vec2; b?: Vec2 }>()
  const ops: Op[] = []
  for (const parent of new Set(walls.map((w) => w.parent))) {
    const here = walls.filter((w) => w.parent === parent)
    const joints = here.flatMap((w) => [w.a, w.b])
    const meets = (p: Vec2) => joints.some((q) => dist(p, q) < JOIN_TOLERANCE)
    for (const other of drawnWith(doc, parent)) {
      if (going.has(other.id)) continue
      if (other.type === 'wall') {
        const patch = { ...(meets(other.a) ? { a: add(other.a, d) } : {}), ...(meets(other.b) ? { b: add(other.b, d) } : {}) }
        if (patch.a || patch.b) ends.set(other.id, { ...ends.get(other.id), ...patch })
      } else if (other.type === 'parametric') {
        const host = hostWall(doc, other, registry)
        if (host && going.has(host.id)) ops.push({ op: 'update_node', id: other.id, patch: { x: other.x + d.x, y: other.y + d.y } })
      }
    }
  }
  return [...[...ends].map(([id, patch]): Op => ({ op: 'update_node', id, patch })), ...ops]
}

/**
 * What has to follow when end `index` (0 for `a`, 1 for `b`) of a wall is dragged to `p`: the ends
 * of the other walls that met it there. `doc` is the drawing before the drag.
 */
export function wallEndFollowOps(doc: Document, wall: Node, index: number, p: Vec2): Op[] {
  if (wall.type !== 'wall') return []
  const joint = index === 0 ? wall.a : wall.b
  return wallsIn(doc, wall.parent)
    .filter((other) => other.id !== wall.id)
    .flatMap((other): Op[] => {
      const patch = { ...(dist(other.a, joint) < JOIN_TOLERANCE ? { a: p } : {}), ...(dist(other.b, joint) < JOIN_TOLERANCE ? { b: p } : {}) }
      return patch.a || patch.b ? [{ op: 'update_node', id: other.id, patch }] : []
    })
}
