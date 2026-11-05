import { childrenOf } from '../document'
import { add, dist, len, norm, perp, scale, sub, type Vec2 } from '../geometry'
import type { Op } from '../ops'
import type { Registry } from '../registry'
import type { Document, Node } from '../schema'
import { courseOf, cross, dot, JOIN_TOLERANCE, middleAcross, tidy, wallArc, wallContains, wallPoints, wallSides, type Wall } from './course'
import { lineCircle, moveCornerOps, wallEndsAt, wallEndsOf } from './joints'
import { openingIndex } from './openings'
import { withoutEnd } from './outline'
import { wallIndex, wallsIn, wallsNear } from './spatial'

/* Changes to walls that keep the plan in one piece: what follows a move, thicker from one face, a corner put in, ends extended and trimmed. */

/** The given nodes with every group among them replaced by what it holds, at any depth. */
const flatten = (doc: Document, nodes: Node[]): Node[] => nodes.flatMap((n) => (n.type === 'group' ? flatten(doc, childrenOf(doc, n.id)) : [n]))

/**
 * What has to follow when nodes are moved by `d` for the plan to stay in one piece. Walls are tied
 * to each other, and openings to walls, by position only, so this is where the ties are honoured:
 * - an end of another wall joined to an end of a moved wall goes with it, so that wall stretches
 *   and turns instead of being left behind (an end set loose there, joined to nothing, stays);
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
  // The walls joined to a moved one at its ends, and those only: not one set loose there, nor a
  // lining stopping against it. What follows is what the canvas shows as joined.
  for (const wall of walls) {
    for (const side of ['a', 'b'] as const) {
      for (const { wall: other, end } of wallEndsOf(doc, wall, side)) {
        if (other.id === wall.id || going.has(other.id)) continue
        ends.set(other.id, { ...ends.get(other.id), [end]: add(other[end], d) })
      }
    }
  }
  for (const parent of new Set(walls.map((w) => w.parent))) {
    for (const [id, host] of openingIndex(doc, parent, registry).hosts) {
      const other = doc.nodes[id]
      if (host && going.has(host.id) && !going.has(id) && other?.type === 'parametric') ops.push({ op: 'update_node', id, patch: { x: other.x + d.x, y: other.y + d.y } })
    }
  }
  return [...[...ends].map(([id, patch]): Op => ({ op: 'update_node', id, patch })), ...ops]
}

/** Moves a point beside a wall across it by `by`, to its right when positive: straight across, or for a curved wall towards or away from its centre. */
function acrossBy(wall: Wall): (p: Vec2, by: number) => Vec2 {
  const arc = wallArc(wall)
  const right = arc ? null : perp(norm(sub(wall.b, wall.a)))
  const way = arc ? Math.sign(arc.sweep) : 0
  return (p, by) => {
    if (right) return { x: tidy(p.x + right.x * by), y: tidy(p.y + right.y * by) }
    const out = sub(p, arc!.centre)
    const r = len(out)
    if (r < 1e-9) return p
    const q = add(arc!.centre, scale(out, (r - way * by) / r))
    return { x: tidy(q.x), y: tidy(q.y) }
  }
}

/** The doors and windows set in a wall moved across by `by`, as it is, so they stay in the middle of its thickness. */
function openingsAcross(doc: Document, wall: Wall, by: number, registry: Registry): Op[] {
  if (Math.abs(by) < 1e-9) return []
  const move = acrossBy(wall)
  const ops: Op[] = []
  for (const [id, host] of openingIndex(doc, wall.parent, registry).hosts) {
    const opening = doc.nodes[id]
    if (host?.id === wall.id && opening?.type === 'parametric') ops.push({ op: 'update_node', id, patch: { ...move({ x: opening.x, y: opening.y }, by) } })
  }
  return ops
}

/**
 * A line meeting the wall's line at a sharper angle than this (its sine) slides along itself to
 * follow it; one nearly along it would have to slide far, and is left where it is instead.
 */
const SLIDE_LIMIT = 0.25

/**
 * The operations that give a wall a new thickness by moving one of its faces, `side`, while the
 * other stays where it is; with no side, both faces move and the middle of its thickness stays.
 * The wall's line (its corners) moves only as far as that asks: not at all for a wall drawn by the
 * face that stays, half the change for one drawn by its middle, all of it for one drawn by the face
 * that moves. When it moves, what is tied to it by position goes with it:
 * - the walls it shares a corner with slide along their own line to stay joined, the corner going
 *   where that line meets the line moved across; where they do not make one line (or curve), the
 *   corner moves across with the wall and they turn a little; where they carry straight on from
 *   it, they are left where they are, and the two walls then simply butt against each other;
 * - an end of the wall that stops against the side of another slides along that other wall;
 * - walls that stop against its sides are lengthened or shortened along themselves to keep reaching it.
 * Its doors and windows move with the middle of its thickness. A curved wall keeps its centre:
 * the radius of its line changes. Null when the thickness cannot be had that way: a curved wall
 * whose line would shrink to its centre. `doc` is the drawing before the change.
 */
export function wallThicknessOps(doc: Document, wall: Wall, thickness: number, side: 'left' | 'right' | null, registry: Registry): Op[] | null {
  // How much of the thickness lies left of the line: none for a wall drawn by its left face, all of it by its right, half by its middle.
  const share = wallSides(wall).left / wall.thickness
  const change = thickness - wall.thickness
  // How far the line moves across, and how far the middle of the thickness, for the face that stays to stay.
  const across = side === 'right' ? share * change : side === 'left' ? -(1 - share) * change : (-(1 - 2 * share) * change) / 2
  const middle = side === 'right' ? change / 2 : side === 'left' ? -change / 2 : 0
  if (Math.abs(across) < 1e-9) return [{ op: 'update_node', id: wall.id, patch: { thickness } }, ...openingsAcross(doc, wall, middle, registry)]
  const moved = lineAcrossOps(doc, wall, across, { thickness }, true)
  return moved && [...moved, ...openingsAcross(doc, wall, middle, registry)]
}

/**
 * The operations that move a wall's line across by `across` (to its right when positive), with
 * `patch` for what else changes in the wall: its corners go along, the walls joined there sliding
 * along their own line to stay joined, or, where they carry straight on from it, left where they
 * are; an end of it that stops against the side of another wall slides along that wall; and, with
 * `stopping`, the walls that stop against its sides are lengthened or shortened to keep reaching
 * it. A curved wall keeps its centre. Null when its line would shrink to its centre.
 */
function lineAcrossOps(doc: Document, wall: Wall, across: number, change: Record<string, unknown>, stopping: boolean): Op[] | null {
  const arc = wallArc(wall)
  const way = arc ? Math.sign(arc.sweep) : 0
  const radius = arc ? arc.radius - way * across : 0
  if (arc && radius < 1) return null
  const right = arc ? null : perp(norm(sub(wall.b, wall.a)))
  const move = acrossBy(wall)
  /** Where the line through `p` going `d` meets the wall's line moved across, as far from it as `p` was; null when that line runs too nearly along the wall. */
  const onto = (p: Vec2, d: Vec2): Vec2 | null => {
    if (right) {
      const k = dot(d, right)
      return Math.abs(k) < SLIDE_LIMIT ? null : { x: tidy(p.x + (d.x * across) / k), y: tidy(p.y + (d.y * across) / k) }
    }
    const out = sub(p, arc!.centre)
    const r = len(out)
    if (r < 1e-9 || Math.abs(dot(d, scale(out, 1 / r))) < SLIDE_LIMIT) return null
    const crossings = lineCircle(p, d, arc!.centre, r - way * across)
    if (crossings.length === 0) return null
    const q = crossings.reduce((best, c) => (dist(c, p) < dist(best, p) ? c : best))
    return { x: tidy(q.x), y: tidy(q.y) }
  }
  const straight = (w: Wall): Vec2 | null => (wallArc(w) || dist(w.a, w.b) < 1e-6 ? null : norm(sub(w.b, w.a)))
  const walls = wallIndex(doc, wall.parent).walls
  const ops: Op[] = []
  const done: Vec2[] = []
  /** Moves the corner at `from` to `to`: every end of another wall there goes with it. */
  const carry = (from: Vec2, to: Vec2) => {
    done.push(from)
    ops.push(...moveCornerOps(doc, wall.parent, from, to).filter((op) => op.op !== 'update_node' || op.id !== wall.id))
  }

  const ends = (['a', 'b'] as const).map((end) => {
    const c = wall[end]
    const others = wallEndsAt(doc, wall.parent, c).filter((other) => other.wall.id !== wall.id)
    done.push(c)
    if (others.length > 0) {
      // The walls there, as one line: the corner slides along it, or, when it carries straight on
      // from this wall, it stays where it is and this wall's end leaves it.
      const lines = others.map((other) => straight(other.wall))
      const line = lines[0]
      if (line && lines.every((d) => d && Math.abs(cross(d, line)) < 1e-3)) {
        const slid = onto(c, line)
        if (!slid) return move(c, across)
        carry(c, slid)
        return slid
      }
      const to = move(c, across)
      carry(c, to)
      return to
    }
    // An end that stops against the side of another wall slides along that wall.
    const host = walls.find((w) => w.id !== wall.id && straight(w) && wallContains(w, c, JOIN_TOLERANCE))
    return (host && onto(c, straight(host)!)) || move(c, across)
  })
  const patch: Record<string, unknown> = { a: ends[0], b: ends[1], ...change }
  if (arc) {
    // The same centre, so the face that stays is the same circle: the curve stands off its new chord by what that radius gives.
    const chord = dist(ends[0], ends[1])
    patch.bulge = tidy(Math.sign(wall.bulge!) * (radius - Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))))
  }
  ops.unshift({ op: 'update_node', id: wall.id, patch })

  // The walls that stop against its sides.
  for (const other of stopping ? walls : []) {
    if (other.id === wall.id) continue
    for (const end of ['a', 'b'] as const) {
      const p = other[end]
      if (done.some((q) => dist(p, q) < JOIN_TOLERANCE) || !wallContains(wall, p, JOIN_TOLERANCE)) continue
      const line = straight(other)
      const to = line && onto(p, line)
      // One that runs along the wall rather than up to it is not stopping against it.
      if (to) carry(p, to)
    }
  }
  return ops
}

/**
 * The operations that draw a wall by another of its lines: its middle, or its left or right face
 * as it runs from `a` to `b`. The wall stays where it is, with its doors and windows: its line goes
 * onto the line chosen, and its corners with it, the walls joined there sliding along their own
 * line to stay joined (as when it is made thicker, `lineAcrossOps`). A thickness given afterwards
 * grows away from that line. Several walls are changed one after the other, each from the drawing
 * the one before left. A curved wall whose line cannot go there keeps its line and moves instead.
 */
export function wallJustifyOps(doc: Document, wall: Wall, justify: 'left' | 'center' | 'right', registry: Registry): Op[] {
  const next = justify === 'center' ? undefined : justify
  if (wall.justify === next || (justify === 'center' && wall.justify === 'center')) return []
  const by = middleAcross({ thickness: wall.thickness, justify: next }) - middleAcross(wall)
  const patch = { justify: next ?? null }
  return lineAcrossOps(doc, wall, -by, patch, false) ?? [{ op: 'update_node', id: wall.id, patch }, ...openingsAcross(doc, wall, by, registry)]
}

/**
 * The operations that turn a wall drawn by one of its faces over its line, as Revit flips one: it
 * then lies on the other side of that line, its corners where they are, the walls joined there
 * mitred to it anew, its doors and windows going across with it. The look given to the face on the
 * line stays with it (`edges.left` and `edges.right` swap). A wall drawn by its middle lies on both
 * sides of its line and has nothing to flip: no operations.
 */
export function flipWallOps(doc: Document, wall: Wall, registry: Registry): Op[] {
  if (wall.justify !== 'left' && wall.justify !== 'right') return []
  const justify = wall.justify === 'left' ? 'right' : 'left'
  const by = middleAcross({ thickness: wall.thickness, justify }) - middleAcross(wall)
  const { left, right, ...ends } = wall.edges ?? {}
  // `edges` is replaced whole by the patch, so a face with no look of its own is left out of it.
  const edges = left || right ? { edges: { ...ends, ...(right ? { left: right } : {}), ...(left ? { right: left } : {}) } } : {}
  return [{ op: 'update_node', id: wall.id, patch: { justify, ...edges } }, ...openingsAcross(doc, wall, by, registry)]
}

/**
 * What has to follow when end `index` (0 for `a`, 1 for `b`) of a wall is dragged to `p`: the ends
 * of the other walls that met it there. `doc` is the drawing before the drag.
 */
export function wallEndFollowOps(doc: Document, wall: Node, index: number, p: Vec2): Op[] {
  // A wall's third handle bends it, which moves neither end.
  if (wall.type !== 'wall' || index > 1) return []
  // Only the walls joined to it there: not one that ends at the same point but was set loose, or
  // that it was set loose from, nor a lining stopping against it.
  return wallEndsOf(doc, wall, index === 0 ? 'a' : 'b')
    .filter((other) => other.wall.id !== wall.id)
    .map(({ wall: other, end }): Op => ({ op: 'update_node', id: other.id, patch: { [end]: p } }))
}

/**
 * The operations that put a corner in the middle of a wall: the wall stops at `p` (brought onto
 * its centerline) and a second one carries on from there. Returns nothing when `p` is at an end.
 */
export function splitWallOps(wall: Node, p: Vec2, newWallId: string): { ops: Op[]; at: Vec2 } | null {
  if (wall.type !== 'wall') return null
  const course = courseOf(wall)
  const length = course.length
  const along = course.project(p).along
  if (along < JOIN_TOLERANCE * 2 || along > length - JOIN_TOLERANCE * 2) return null
  const on = course.at(along)
  const at = { x: tidy(on.x), y: tidy(on.y) }
  const { id: _, order: __, joins, bulge: ___, ...rest } = wall
  // Each half of a curved wall stays on the same circle: it bulges by what its own share of the curve asks.
  const arc = wallArc(wall)
  const bulge = (share: number) => (arc ? { bulge: tidy(Math.sign(wall.bulge ?? 0) * arc.radius * (1 - Math.cos((Math.abs(arc.sweep) * share) / 2))) } : {})
  return {
    at,
    ops: [
      // Each half keeps the joint and the edges of the end it keeps. Where they now meet they are two
      // walls joined like any others, with the line between them drawn: that is all a cut is, and
      // hiding that line makes them read as one wall again.
      { op: 'update_node', id: wall.id, patch: { b: at, joins: joins?.a ? { a: joins.a } : null, edges: { ...withoutEnd(wall.edges, 'b'), b: { ...wall.edges?.b, show: true } }, ...bulge(along / length) } },
      {
        op: 'add_node',
        node: { ...rest, id: newWallId, a: at, b: wall.b, ...(joins?.b ? { joins: { b: joins.b } } : {}), edges: { ...withoutEnd(wall.edges, 'a'), a: { ...wall.edges?.a, show: true } }, ...bulge(1 - along / length) },
      },
    ],
  }
}

/** Where the line of a wall, taken from `from` in direction `d`, meets the middle lines of the other walls: how far along, nearest first. */
function crossings(doc: Document, parentId: string | null, wall: Wall, from: Vec2, d: Vec2): number[] {
  const hits: number[] = []
  for (const other of wallsIn(doc, parentId)) {
    if (other.id === wall.id) continue
    // A curved wall is met along its curve, taken stretch by stretch.
    const line = wallPoints(other)
    for (let i = 0; i + 1 < line.length; i++) {
      const e = sub(line[i + 1], line[i])
      const denom = cross(d, e)
      if (Math.abs(denom) < 1e-9) continue
      const between = sub(line[i], from)
      const t = cross(between, e) / denom
      const u = cross(between, d) / denom
      if (u >= -1e-6 && u <= 1 + 1e-6) hits.push(t)
    }
  }
  return hits.sort((p, q) => p - q)
}

/**
 * The ends of a wall that no other wall ends at: the ones that can be extended or trimmed. A
 * curved wall has none: there is no saying where a curve carried on would go.
 */
const freeEnds = (doc: Document, wall: Wall): ('a' | 'b')[] => (wallArc(wall) ? [] : (['a', 'b'] as const).filter((end) => wallEndsOf(doc, wall, end).length === 1))

/**
 * Lengthens walls to the next wall in their way: each free end of each wall given (or only `end`
 * of the one wall given) runs straight on until it meets the middle line of another wall. An end
 * with nothing ahead of it stays where it is.
 */
export function extendWallOps(doc: Document, walls: Wall[], end?: 'a' | 'b'): Op[] {
  return walls.flatMap((wall): Op[] => {
    if (wallArc(wall)) return []
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
    if (length < 1e-6 || wallArc(wall)) return []
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
