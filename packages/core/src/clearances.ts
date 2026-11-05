import { add, boundsOfPoints, dist, norm, pointInPolygon, scale, sub, type Vec2 } from './geometry'
import { applyOps } from './ops'
import { moveOps, nodePrimitives } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import { boundsOf } from './scene'
import type { Document, Node, NodeOf } from './schema'
import { courseOf, cross, dot, wallArc, wallSides } from './walls/course'
import { wallFollowOps } from './walls/edit'
import { hostWall, openingIndex, openingSpan } from './walls/openings'
import { wallPolygons } from './walls/outline'
import { wallIndex } from './walls/spatial'

/*
 * Temporary dimensions (ARCHITECTURE §4, "Clearances"): how far the one thing selected stands from
 * the walls around it, shown while it is selected and typed to move it, as Revit does. Nothing of
 * it is stored.
 */

/** One distance from what is selected to what is around it: from a point of it to a point of the wall (or opening) it faces. */
export interface Clearance {
  from: Vec2
  to: Vec2
  length: number
}

/** Walls further than this are not looked for. */
const REACH = 30000
/** A hit closer than this is the face the ray leaves from, not one it meets. */
const SKIN = 0.5
/** Walls running within this sine of the wall a door is in carry on from it, or line it: the door is not measured to them. */
const PARALLEL = Math.sin(Math.PI / 180)

type Wall = NodeOf<'wall'>

/** The shapes of the walls a ray could meet, near `box`: each wall's drawn outline, mitred into its neighbours. */
function obstacles(doc: Document, node: Node, registry: Registry, box: { minX: number; minY: number; maxX: number; maxY: number }, skip: (wall: Wall) => boolean): Vec2[][] {
  const shapes: Vec2[][] = []
  for (const wall of wallIndex(doc, node.parent).walls) {
    if (wall.id === node.id || skip(wall)) continue
    const reach = wall.thickness
    const near = boundsOfPoints([wall.a, wall.b])!
    if (near.maxX + reach < box.minX - REACH || near.minX - reach > box.maxX + REACH || near.maxY + reach < box.minY - REACH || near.minY - reach > box.maxY + REACH) continue
    shapes.push(...wallPolygons(wall, doc, registry))
  }
  return shapes
}

/** How far a ray from `from` along `dir` goes before it enters one of the shapes, or null within REACH; shapes it starts inside are passed through. */
function cast(from: Vec2, dir: Vec2, shapes: Vec2[][]): number | null {
  let best: number | null = null
  for (const shape of shapes) {
    if (pointInPolygon(from, shape)) continue
    for (let i = 0; i < shape.length; i++) {
      const p = shape[i]
      const e = sub(shape[(i + 1) % shape.length], p)
      const denom = cross(dir, e)
      if (Math.abs(denom) < 1e-12) continue
      const between = sub(p, from)
      const t = cross(between, e) / denom
      const u = cross(between, dir) / denom
      if (t > SKIN && t <= REACH && u >= 0 && u <= 1 && (best === null || t < best)) best = t
    }
  }
  return best
}

const clearance = (from: Vec2, dir: Vec2, length: number | null): Clearance[] => (length === null ? [] : [{ from, to: add(from, scale(dir, length)), length }])

/** From the middle of each face of a straight wall, straight out to the nearest wall it faces. */
function wallClearances(doc: Document, wall: Wall, registry: Registry): Clearance[] {
  if (wallArc(wall) || dist(wall.a, wall.b) < 1) return []
  const course = courseOf(wall)
  const right = norm({ x: -(wall.b.y - wall.a.y), y: wall.b.x - wall.a.x })
  const { left, right: reach } = wallSides(wall)
  const box = boundsOfPoints([wall.a, wall.b])!
  const shapes = obstacles(doc, wall, registry, box, () => false)
  const middle = course.length / 2
  return [
    ...clearance(course.offset(middle, reach), right, cast(course.offset(middle, reach), right, shapes)),
    ...clearance(course.offset(middle, -left), scale(right, -1), cast(course.offset(middle, -left), scale(right, -1), shapes)),
  ]
}

/**
 * From each side of a door or window, along its wall, to the nearest face of a wall crossing or
 * meeting it, or to the next door or window in it: measured on both faces of the wall, the nearer
 * kept, so that at a corner it is the inside one.
 */
function openingClearances(doc: Document, node: Node, host: Wall, registry: Registry): Clearance[] {
  const span = openingSpan(node, registry)
  if (!span || wallArc(host)) return []
  const course = courseOf(host)
  const along = norm(sub(host.b, host.a))
  const ends = span.map((p) => course.project(p).along).sort((p, q) => p - q)
  const box = boundsOfPoints(span)!
  // Walls in line with this one (its other half past a corner of two) or laid along it are not what it is measured to.
  const shapes = obstacles(doc, node, registry, box, (wall) => wall.id === host.id || Math.abs(cross(norm(sub(wall.b, wall.a)), along)) < PARALLEL)
  const others = [...openingIndex(doc, node.parent, registry).hosts]
    .filter(([id, wall]) => id !== node.id && wall?.id === host.id)
    .flatMap(([id]) => (openingSpan(doc.nodes[id], registry) ?? []).map((p) => course.project(p).along))
  const { left, right } = wallSides(host)
  const out: Clearance[] = []
  for (const [end, way] of [[ends[0], -1], [ends[1], 1]] as const) {
    const dir = scale(along, way)
    // Along each face: a wall stopping against this one starts there (it is cut along the face),
    // and at a corner the inside face meets the other wall's face, where a ray within the wall
    // would meet the mitre between them.
    const faces = [right, -left].map((across) => cast(course.offset(end, across), dir, shapes)).filter((t): t is number => t !== null)
    const toOpening = others.map((s) => (s - end) * way).filter((t) => t > SKIN)
    const length = Math.min(...faces, ...toOpening)
    const from = course.offset(end, (right - left) / 2)
    if (Number.isFinite(length)) out.push({ from, to: add(from, scale(dir, length)), length })
  }
  return out
}

/** From the middle of each side of the box an object fills, left, right, up and down, to the nearest wall. */
function boxClearances(doc: Document, node: Node, registry: Registry): Clearance[] {
  const box = boundsOf(nodePrimitives(node, { doc, registry, depth: 0 }))
  if (!box) return []
  const shapes = obstacles(doc, node, registry, box, () => false)
  const [mx, my] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]
  const sides: [Vec2, Vec2][] = [
    [{ x: box.minX, y: my }, { x: -1, y: 0 }],
    [{ x: box.maxX, y: my }, { x: 1, y: 0 }],
    [{ x: mx, y: box.minY }, { x: 0, y: -1 }],
    [{ x: mx, y: box.maxY }, { x: 0, y: 1 }],
  ]
  return sides.flatMap(([from, dir]) => clearance(from, dir, cast(from, dir, shapes)))
}

/** The things temporary dimensions are shown for. */
const MEASURED = new Set(['wall', 'parametric', 'instance', 'rect', 'ellipse', 'group'])

/**
 * How far `node` stands from the walls around it: for a straight wall, from each face to the wall
 * it faces; for a door or window in a wall, from each side along the wall; for any other object
 * (a component, an object, a rectangle, an ellipse, a group), from each side of its box, across
 * and up and down. Distances are clear ones, face to face, and only to walls within 30 m.
 */
export function clearances(doc: Document, node: Node, registry: Registry): Clearance[] {
  if (!MEASURED.has(node.type) || node.parent === null) return []
  if (node.type === 'wall') return wallClearances(doc, node, registry)
  const host = node.type === 'parametric' && registry.parametric.get(node.kind)?.opening ? hostWall(doc, node, registry) : null
  return host ? openingClearances(doc, node, host, registry) : boxClearances(doc, node, registry)
}

/** How close, in mm, a distance typed must be met. */
const MET = 0.01
/** How many times a move is corrected, at most, to meet it. */
const TRIES = 12

/**
 * The operations that move `node` so that `measured` (one of its clearances) becomes `length`: along
 * that clearance, the walls joined to a wall following it, and its doors and windows going with it.
 *
 * Moved by the difference, it is at the distance typed only when what it faces stays where it is.
 * A wall it faces may be joined to it, as two sides of a triangle are, and turn as it moves: the
 * distance is then measured again where it went, and the move corrected (by secants) until it is
 * met, so that the number typed is the number read when the wall is selected again.
 */
export function clearanceOps(doc: Document, node: Node, measured: Clearance, length: number, registry: Registry): Op[] {
  if (!(length >= 0) || measured.length <= 0) return []
  const way = scale(sub(measured.to, measured.from), 1 / measured.length)
  const ops = (k: number): Op[] => {
    const d = scale(way, k)
    return [...moveOps(doc, node, d), ...wallFollowOps(doc, [node], d, registry)]
  }
  // How far from the length typed it stands once moved `k` along the way it measures; null when it measures nothing there.
  const off = (k: number): number | null => {
    let next: Document
    try {
      next = applyOps(doc, ops(k))
    } catch {
      return null
    }
    const moved = next.nodes[node.id]
    const start = add(measured.from, scale(way, k))
    const again = moved && clearances(next, moved, registry).filter((c) => c.length > 0 && Math.abs(cross(way, scale(sub(c.to, c.from), 1 / c.length))) < 1e-6 && dot(way, sub(c.to, c.from)) > 0)
    const same = again?.sort((p, q) => dist(p.from, start) - dist(q.from, start))[0]
    return same ? same.length - length : null
  }
  let [k0, f0] = [0, measured.length - length]
  let k1 = measured.length - length
  for (let i = 0; i < TRIES; i++) {
    const f1 = off(k1)
    if (f1 === null || Math.abs(f1) < MET || Math.abs(f1 - f0) < 1e-12) break
    ;[k0, f0, k1] = [k1, f1, k1 - (f1 * (k1 - k0)) / (f1 - f0)]
  }
  return ops(k1)
}
