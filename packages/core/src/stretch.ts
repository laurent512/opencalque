import { boundsOfPoints, type Bounds, type Vec2 } from './geometry'
import { moveOps, nodePrimitives } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import { boundsOf } from './scene'
import type { Document, Node, NodeOf } from './schema'
import { middleAcross, wallParallel } from './walls/course'
import { wallEndFollowOps } from './walls/edit'
import { openingIndex } from './walls/openings'

/*
 * Making a selection wider or higher without scaling it (ARCHITECTURE §4, "Stretching a
 * selection"): its far side moves, what runs across is lengthened, and walls keep their thickness.
 */

/**
 * The box the middles of walls span, as a plan is measured from axis to axis: for four walls of
 * 200 mm round a room 6.7 m across outside, 6.5 m. Null without walls.
 */
export function wallAxesBounds(walls: NodeOf<'wall'>[]): Bounds | null {
  return boundsOfPoints(walls.flatMap((wall) => wallParallel(wall, middleAcross(wall))))
}

/** The types drawn between two points, `a` and `b`, which a stretch moves one by one. */
const TWO_POINTS = new Set(['wall', 'line', 'divider', 'dimension', 'annotation', 'gridline'])

/**
 * The operations that make the selection `nodes` longer by `by` mm along `axis` (shorter when
 * negative), its near side (left, or top) staying where it is, as CAD programs stretch what a
 * window takes in from the far side:
 * - the points that lie along the far side move: the ends of walls and lines, and the corners of
 *   polylines, within the thickness of the thickest wall selected (a millimetre without walls).
 *   So the outermost wall on that side moves whole, the walls running across get longer, and a
 *   wall standing against it in a T keeps reaching it; walls keep their thickness;
 * - walls outside the selection that are joined at a moved end follow it, as when a corner is dragged;
 * - doors and windows go with a wall that moves whole, and stay in a wall that gets longer;
 * - anything else (a component, an object, a text, a room) moves whole when its middle lies along
 *   the far side, and stays otherwise.
 * Nothing when the selection has no size along `axis`.
 */
export function stretchOps(doc: Document, nodes: Node[], axis: 'x' | 'y', by: number, registry: Registry): Op[] {
  const ctx = { doc, registry, depth: 0 }
  const box = boundsOf(nodes.flatMap((node) => nodePrimitives(node, ctx)))
  if (!box || by === 0) return []
  const far = (axis === 'x' ? box.maxX : box.maxY) - Math.max(1, ...nodes.map((node) => (node.type === 'wall' ? node.thickness : 0))) - 0.5
  const onFarSide = (p: Vec2) => p[axis] >= far
  const moved = (p: Vec2): Vec2 => (onFarSide(p) ? { ...p, [axis]: p[axis] + by } : p)
  const d = axis === 'x' ? { x: by, y: 0 } : { x: 0, y: by }

  const parents = [...new Set(nodes.map((node) => node.parent))]
  const hosts = new Map(parents.flatMap((parent) => [...openingIndex(doc, parent, registry).hosts]))
  // What each node is given, merged: a wall's end can be moved as part of the selection and as the
  // end of a wall it is joined to, to the same point.
  const patches = new Map<string, Record<string, unknown>>()
  const patch = (id: string, given: Record<string, unknown>) => patches.set(id, { ...patches.get(id), ...given })
  const others: Op[] = []
  const movedWhole = new Set<string>()

  for (const node of nodes) {
    // A door or window in a wall goes with its wall.
    if (hosts.get(node.id)) continue
    if (TWO_POINTS.has(node.type)) {
      const line = node as NodeOf<'wall' | 'line' | 'divider' | 'dimension' | 'annotation' | 'gridline'>
      const [a, b] = [moved(line.a), moved(line.b)]
      if (a === line.a && b === line.b) continue
      patch(node.id, { ...(a !== line.a ? { a } : {}), ...(b !== line.b ? { b } : {}) })
      if (node.type !== 'wall') continue
      if (a !== line.a && b !== line.b) movedWhole.add(node.id)
      for (const [index, p] of [[0, a] as const, [1, b] as const]) {
        if (p === (index === 0 ? line.a : line.b)) continue
        for (const op of wallEndFollowOps(doc, node, index, p)) if (op.op === 'update_node') patch(op.id, op.patch)
      }
    } else if (node.type === 'polyline') {
      const points = node.points.map(moved)
      if (points.some((p, i) => p !== node.points[i])) patch(node.id, { points })
    } else {
      const own = boundsOf(nodePrimitives(node, ctx))
      if (own && onFarSide({ x: (own.minX + own.maxX) / 2, y: (own.minY + own.maxY) / 2 })) others.push(...moveOps(doc, node, d))
    }
  }
  // Doors and windows go with a wall moved whole, whether they were selected or not.
  for (const [id, host] of hosts) {
    const opening = doc.nodes[id]
    if (host && movedWhole.has(host.id) && opening?.type === 'parametric') patch(id, { x: opening.x + d.x, y: opening.y + d.y })
  }
  return [...[...patches].map(([id, given]): Op => ({ op: 'update_node', id, patch: given })), ...others]
}
