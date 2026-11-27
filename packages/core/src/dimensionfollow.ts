/**
 * Dimensions that follow what they measure, by position, as doors and windows follow their walls:
 * an edit that moves a point of a wall (an end, a corner of its outline, a side of one of its doors
 * or windows) or of anything else (a point it draws) takes with it the end of each dimension that
 * was on that point. Nothing ties a dimension to what it measures in the drawing; where its end is
 * says it.
 */

import { dist, type Vec2 } from './geometry'
import { nodePrimitives } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Document, Node, NodeOf } from './schema'
import { courseOf, distToBody, type Wall } from './walls/course'
import { faceAcross } from './walls/mount'
import { wallOpenings } from './walls/openings'
import { wallOutline } from './walls/outline'
import { wallsIn } from './walls/spatial'

/**
 * What a dimension on the plan measures, and so whose points are looked at: not a view, a sheet, a
 * table, a text or another dimension, whose drawing would be worked out twice for nothing at every
 * step of a drag (a view's picture is its whole elevation).
 */
const MEASURED = new Set(['wall', 'parametric', 'instance', 'line', 'polyline', 'rect', 'ellipse', 'gridline', 'divider'])

/** How near a point of what moved a dimension's end must be, in mm, to be on it. */
const ON_POINT = 0.5

/**
 * The points of a node a dimension's end may be on, each by a name that stays as the node changes,
 * so that where each went can be told: a wall's ends, the sides of its openings on each face (by
 * the opening), the corners of its outline (by their place, when it has as many before and after);
 * the points anything else draws (by their place, likewise).
 */
function pointsOf(doc: Document, node: Node, registry: Registry): Map<string, Vec2> {
  const out = new Map<string, Vec2>()
  if (node.type === 'wall') {
    out.set('a', node.a)
    out.set('b', node.b)
    const course = courseOf(node)
    for (const opening of wallOpenings(doc, node, registry)) {
      for (const face of ['left', 'right'] as const) {
        out.set(`${opening.node.id} ${face} from`, course.offset(opening.from, faceAcross(node, face)))
        out.set(`${opening.node.id} ${face} to`, course.offset(opening.to, faceAcross(node, face)))
      }
    }
    wallOutline(node, doc).forEach((p, i) => out.set(`corner ${i}`, p))
    return out
  }
  let i = 0
  for (const p of nodePrimitives(node, { doc, registry, depth: 0 })) {
    const points = p.kind === 'path' ? p.points : p.kind === 'ellipse' ? [{ x: p.cx, y: p.cy }] : []
    for (const point of points) out.set(`point ${i++}`, point)
  }
  return out
}

/** Whether a wall meets another at an end: an edit of one may move the corners of the other. */
const meets = (wall: Wall, other: Wall) => wall.id !== other.id && [wall.a, wall.b].some((p) => distToBody(p, other) <= wall.thickness + other.thickness)

/**
 * The operations that bring the ends of the dimensions of `after` onto the points they were on in
 * `before`, where the nodes `changed` (and the walls meeting the walls among them, and the walls an
 * opening among them is in) moved them. Dimensions that changed themselves, and those drawn on a
 * view (in its coordinates), are left as they are.
 */
export function dimensionFollowOps(before: Document, after: Document, changed: Iterable<string>, registry: Registry): Op[] {
  const moved = new Set(changed)
  const dimensions = Object.values(after.nodes).filter(
    (node): node is NodeOf<'dimension'> => node.type === 'dimension' && !moved.has(node.id) && (node.parent === null || after.nodes[node.parent]?.type !== 'elevation'),
  )
  if (dimensions.length === 0 || moved.size === 0) return []

  const looked = new Set<string>()
  for (const id of moved) {
    const [was, now] = [before.nodes[id], after.nodes[id]]
    if (!was || !now || was.type !== now.type || !MEASURED.has(now.type)) continue
    looked.add(id)
    if (now.type === 'wall' && was.type === 'wall') {
      for (const other of wallsIn(after, now.parent)) if (meets(other, was) || meets(other, now)) looked.add(other.id)
    } else if (now.type === 'parametric') {
      // The sides of an opening are its wall's points.
      for (const wall of wallsIn(after, now.parent)) if ([before, after].some((doc) => wallOpenings(doc, wall, registry).some((o) => o.node.id === id))) looked.add(wall.id)
    }
  }

  const went: [Vec2, Vec2][] = []
  for (const id of looked) {
    const [was, now] = [before.nodes[id], after.nodes[id]]
    if (!was || !now) continue
    const [from, to] = [pointsOf(before, was, registry), pointsOf(after, now, registry)]
    // Places in a list mean the same point only when the list is as long.
    const sameCorners = [...from.keys()].filter((key) => key.startsWith('corner')).length === [...to.keys()].filter((key) => key.startsWith('corner')).length
    const samePoints = [...from.keys()].filter((key) => key.startsWith('point')).length === [...to.keys()].filter((key) => key.startsWith('point')).length
    for (const [key, p] of from) {
      if ((key.startsWith('corner') && !sameCorners) || (key.startsWith('point') && !samePoints)) continue
      const q = to.get(key)
      if (q && dist(p, q) > 1e-6) went.push([p, q])
    }
  }
  if (went.length === 0) return []

  const ops: Op[] = []
  const onto = (end: Vec2) => went.find(([p]) => dist(p, end) <= ON_POINT)?.[1]
  for (const dimension of dimensions) {
    const [a, b] = [onto(dimension.a), onto(dimension.b)]
    if (a || b) ops.push({ op: 'update_node', id: dimension.id, patch: { a: a ?? dimension.a, b: b ?? dimension.b } })
  }
  return ops
}
