import { childrenOf, isVisible, leavesOf, rootOf } from './document'
import { add, applyTransform, dist, distToSegment, mid, norm, perp, scale, sub, type Vec2, len } from './geometry'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Document, Node, NodeOf, WALL_JOINS } from './schema'

type Wall = NodeOf<'wall'>

/** Wall ends closer than this (mm) are treated as meeting at one joint. */
const JOIN_TOLERANCE = 0.5
/**
 * A mitre sticking out further than this many half-thicknesses is cut off instead. At 2, walls
 * meeting at less than 60° get a chamfered corner rather than a long spike; a right angle (1.41)
 * and anything wider keep their sharp point.
 */
const MITER_LIMIT = 2

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
  /** How this end asks to be joined, if it says. */
  join?: WallJoin
}

export type WallJoin = (typeof WALL_JOINS)[number]

/** How two wall ends that meet are joined, from what each of them asks for. Rounded wins over cut off, which wins over one running through. */
function styleOf(a: WallJoin | undefined, b: WallJoin | undefined): 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = [a, b]
  if (asked.includes('round')) return 'round'
  if (asked.includes('bevel')) return 'bevel'
  if (asked.includes('through') || asked.includes('butt')) return 'butt'
  return 'miter'
}

/**
 * Where the "plus" face of ray `a` meets the "minus" face of ray `b`, its neighbour going around
 * the joint. Returns the outline points each wall takes, ordered from its own face towards the joint.
 */
function meet(p: Vec2, a: Ray, b: Ray, style: 'miter' | 'round' | 'bevel' = 'miter'): { a: Vec2[]; b: Vec2[] } {
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
  // Only the outer side of a corner, where the faces cross beyond the joint, has a point to round or cut off.
  if (s < 0 && style === 'round') {
    // An arc around the joint from one face to the other, each wall taking the half on its side.
    const from = Math.atan2(qa.y - p.y, qa.x - p.x)
    let sweep = Math.atan2(qb.y - p.y, qb.x - p.x) - from
    if (sweep > Math.PI) sweep -= 2 * Math.PI
    if (sweep < -Math.PI) sweep += 2 * Math.PI
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16)))
    const at = (t: number): Vec2 => {
      const r = a.h + (b.h - a.h) * t
      return { x: tidy(p.x + r * Math.cos(from + sweep * t)), y: tidy(p.y + r * Math.sin(from + sweep * t)) }
    }
    const half = Array.from({ length: steps + 1 }, (_, i) => i / (2 * steps))
    return { a: half.map((t) => at(t)), b: half.map((t) => at(1 - t)) }
  }
  if (s < 0 && (style === 'bevel' || dist(c, p) > MITER_LIMIT * Math.max(a.h, b.h))) {
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
function cap(p: Vec2, wall: Wall, away: Vec2, walls: Wall[], seams?: [Vec2, Vec2][]): Vec2[] {
  const rays: Ray[] = []
  for (const w of walls) {
    const length = dist(w.a, w.b)
    if (length < 1e-6) continue
    for (const [end, other] of [[w.a, w.b], [w.b, w.a]]) {
      const self = w.id === wall.id
      if (self ? end !== p : dist(end, p) > JOIN_TOLERANCE) continue
      const d = self ? away : norm(sub(other, end))
      rays.push({ d, h: w.thickness / 2, length, angle: Math.atan2(d.y, d.x), self, join: end === w.a ? w.joins?.a : w.joins?.b })
    }
  }
  const h = wall.thickness / 2
  if (rays.length < 2) return [sub(p, scale(perp(away), h)), add(p, scale(perp(away), h))]
  rays.sort((x, y) => x.angle - y.angle)
  const i = rays.findIndex((r) => r.self)
  const me = rays[i]
  const next = rays[(i + 1) % rays.length]
  const prev = rays[(i + rays.length - 1) % rays.length]
  // A choice of joint only means something between two walls; where more meet they are mitred.
  const style = rays.length === 2 ? styleOf(me.join, next.join) : 'miter'
  if (style === 'butt') {
    // One wall runs on to the far face of the other, which stops against its near face. How far
    // that is along each wall depends on the angle they meet at.
    const other = next
    const slant = Math.abs(cross(me.d, other.d))
    const reach = slant < 1e-6 ? 0 : Math.min(other.h / slant, MITER_LIMIT * other.h)
    const passes = me.join === 'through' || (me.join !== 'butt' && other.join === 'butt')
    const end = passes ? sub(p, scale(away, reach)) : add(p, scale(away, reach))
    const square = [sub(end, scale(perp(away), h)), add(end, scale(perp(away), h))]
    // Walls are painted as one mass, which would hide where this one stops: the line of its end is kept to be drawn.
    if (!passes) seams?.push([square[0], square[1]])
    return square
  }
  return [...meet(p, prev, me, style).b, p, ...meet(p, me, next, style).a.reverse()]
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

/** The doors and windows set in a wall, each with the stretch of the wall's middle line it takes (distances from `a`), in order along it. */
export function wallOpenings(doc: Document, wall: Wall, registry: Registry): { node: Extract<Node, { type: 'parametric' }>; from: number; to: number }[] {
  return drawnWith(doc, wall.parent)
    .flatMap((node) => {
      const span = openingSpan(node, registry)
      const taken = span && overlap(wall, span)
      return taken && node.type === 'parametric' ? [{ node, from: taken[0], to: taken[1] }] : []
    })
    .sort((p, q) => p.from - q.from)
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
 * The lines to draw across a wall where it stops against another that runs through: the one place
 * where two joined walls show the line between them.
 */
export function wallSeams(wall: Wall, doc: Document): [Vec2, Vec2][] {
  if (!wall.joins || dist(wall.a, wall.b) < 1e-6) return []
  const d = norm(sub(wall.b, wall.a))
  const walls = wallsIn(doc, wall.parent)
  const seams: [Vec2, Vec2][] = []
  cap(wall.a, wall, d, walls, seams)
  cap(wall.b, wall, scale(d, -1), walls, seams)
  return seams
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

/** One end of a wall. */
export interface WallEnd {
  wall: Wall
  end: 'a' | 'b'
}

/** The wall ends that are at a point: a corner of the plan, or the free end of one wall. */
export function wallEndsAt(doc: Document, parentId: string | null, p: Vec2): WallEnd[] {
  return wallsIn(doc, parentId).flatMap((wall): WallEnd[] => [
    ...(dist(wall.a, p) < JOIN_TOLERANCE ? [{ wall, end: 'a' as const }] : []),
    ...(dist(wall.b, p) < JOIN_TOLERANCE ? [{ wall, end: 'b' as const }] : []),
  ])
}

/** How the walls at a corner are joined, as one choice: 'butt' covers the through and butt pair. */
export function cornerJoin(ends: WallEnd[]): 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = ends.map(({ wall, end }) => wall.joins?.[end])
  return styleOf(asked.find((j) => j === 'round') ?? asked.find((j) => j === 'bevel') ?? asked.find((j) => j === 'through' || j === 'butt'), undefined)
}

/**
 * The operations that give a corner one kind of joint. For 'butt', the wall at `through` (an index
 * into `ends`) is the one that runs past; the others stop against it.
 */
export function cornerJoinOps(ends: WallEnd[], join: 'miter' | 'round' | 'bevel' | 'butt', through = 0): Op[] {
  return ends.map(({ wall, end }, i): Op => {
    const value: WallJoin | undefined = join === 'miter' ? undefined : join === 'butt' ? (i === through ? 'through' : 'butt') : join
    const joins = { ...wall.joins, [end]: value }
    if (value === undefined) delete joins[end]
    return { op: 'update_node', id: wall.id, patch: { joins: Object.keys(joins).length > 0 ? joins : null } }
  })
}

/** The operations that move a corner: every wall end at `from` goes to `to`. */
export function moveCornerOps(doc: Document, parentId: string | null, from: Vec2, to: Vec2): Op[] {
  const patches = new Map<string, Record<string, Vec2>>()
  for (const { wall, end } of wallEndsAt(doc, parentId, from)) patches.set(wall.id, { ...patches.get(wall.id), [end]: to })
  return [...patches].map(([id, patch]): Op => ({ op: 'update_node', id, patch }))
}

/**
 * The operations that put a corner in the middle of a wall: the wall stops at `p` (brought onto
 * its centerline) and a second one carries on from there. Returns nothing when `p` is at an end.
 */
export function splitWallOps(wall: Node, p: Vec2, newWallId: string): { ops: Op[]; at: Vec2 } | null {
  if (wall.type !== 'wall') return null
  const length = dist(wall.a, wall.b)
  const d = norm(sub(wall.b, wall.a))
  const along = dot(sub(p, wall.a), d)
  if (along < JOIN_TOLERANCE * 2 || along > length - JOIN_TOLERANCE * 2) return null
  const at = { x: tidy(wall.a.x + d.x * along), y: tidy(wall.a.y + d.y * along) }
  const { id: _, order: __, joins, ...rest } = wall
  return {
    at,
    ops: [
      // Each half keeps the joint of the end it keeps.
      { op: 'update_node', id: wall.id, patch: { b: at, joins: joins?.a ? { a: joins.a } : null } },
      { op: 'add_node', node: { ...rest, id: newWallId, a: at, b: wall.b, ...(joins?.b ? { joins: { b: joins.b } } : {}) } },
    ],
  }
}

/** Where the line of a wall, taken from `from` in direction `d`, meets the middle lines of the other walls: how far along, nearest first. */
function crossings(doc: Document, parentId: string | null, wall: Wall, from: Vec2, d: Vec2): number[] {
  const hits: number[] = []
  for (const other of wallsIn(doc, parentId)) {
    if (other.id === wall.id) continue
    const e = sub(other.b, other.a)
    const denom = cross(d, e)
    if (Math.abs(denom) < 1e-9) continue
    const between = sub(other.a, from)
    const t = cross(between, e) / denom
    const u = cross(between, d) / denom
    if (u >= -1e-6 && u <= 1 + 1e-6) hits.push(t)
  }
  return hits.sort((p, q) => p - q)
}

/** The ends of a wall that no other wall ends at: the ones that can be extended or trimmed. */
const freeEnds = (doc: Document, wall: Wall): ('a' | 'b')[] => (['a', 'b'] as const).filter((end) => wallEndsAt(doc, wall.parent, wall[end]).length === 1)

/**
 * Lengthens walls to the next wall in their way: each free end of each wall given (or only `end`
 * of the one wall given) runs straight on until it meets the middle line of another wall. An end
 * with nothing ahead of it stays where it is.
 */
export function extendWallOps(doc: Document, walls: Wall[], end?: 'a' | 'b'): Op[] {
  return walls.flatMap((wall): Op[] => {
    const patch: Record<string, Vec2> = {}
    for (const side of end ? [end] : freeEnds(doc, wall)) {
      const tip = wall[side]
      const d = sub(tip, wall[side === 'a' ? 'b' : 'a'])
      const reach = len(d)
      if (reach < 1e-6) continue
      // Distances are in units of the wall's own length; just past the tip is the first place to look.
      const ahead = crossings(doc, wall.parent, wall, tip, d).find((t) => t > JOIN_TOLERANCE / reach)
      if (ahead !== undefined) patch[side] = { x: tidy(tip.x + d.x * ahead), y: tidy(tip.y + d.y * ahead) }
    }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: wall.id, patch }] : []
  })
}

/**
 * Cuts back the part of a wall that sticks out past another: each free end (or only `end`) is
 * brought back to the nearest wall it has crossed. A wall crossing a single wall with both ends
 * free loses only its shorter overhang, so that something of it is left.
 */
export function trimWallOps(doc: Document, walls: Wall[], end?: 'a' | 'b'): Op[] {
  return walls.flatMap((wall): Op[] => {
    const d = sub(wall.b, wall.a)
    const length = len(d)
    if (length < 1e-6) return []
    // Where other walls cross this one, as a share of its length from a to b, ends left out.
    const cuts = crossings(doc, wall.parent, wall, wall.a, d).filter((t) => t > JOIN_TOLERANCE / length && t < 1 - JOIN_TOLERANCE / length)
    if (cuts.length === 0) return []
    const sides = end ? [end] : freeEnds(doc, wall)
    let from = sides.includes('a') ? cuts[0] : 0
    let to = sides.includes('b') ? cuts[cuts.length - 1] : 1
    // One crossing and both ends free: keep the longer side.
    if (to - from < 1e-9) [from, to] = cuts[0] < 0.5 ? [cuts[0], 1] : [0, cuts[0]]
    const at = (t: number): Vec2 => ({ x: tidy(wall.a.x + d.x * t), y: tidy(wall.a.y + d.y * t) })
    const patch = { ...(from > 0 ? { a: at(from) } : {}), ...(to < 1 ? { b: at(to) } : {}) }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: wall.id, patch }] : []
  })
}
