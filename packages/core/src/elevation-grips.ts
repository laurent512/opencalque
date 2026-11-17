import { elevationHeightOps, elevationMovePatch, lineOf, type ElevationItem } from './elevation'
import { add, dist, norm, scale, sub, type Vec2 } from './geometry'
import { kindOf } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import { frameGrips, resizeFrame, resizePatch } from './resize'
import type { Document, Node, NodeOf } from './schema'
import { dot } from './walls/course'

/*
 * Editing an object by the sides of the box an elevation draws it in: whatever the object, each side
 * does what that side means for it, worked out from what it already has. Its left and right are the
 * sides of its box on the plan that face along the view (its width seen from in front, its depth seen
 * from the side, the ends of a door or window along its wall); its top is its height
 * (`elevationHeightOps`); its bottom is its underside, raised with its top where it is. Kept apart
 * from elevation.ts, which kinds.ts draws elevations with and so cannot use kinds.ts.
 */

export type ElevationSide = 'left' | 'right' | 'top' | 'bottom'

type Elevation = NodeOf<'elevation'>

/** How much nearer the way along the view a side of its box on the plan must face than across it to be its left or right: within 45°. */
const ALONG = Math.SQRT1_2 - 1e-9

/**
 * What dragging `side` of the box an elevation draws an object in by `delta` mm does, as operations:
 * across the view (+ to the right) for its left or right, up (+) for its top or bottom; the side across
 * stays where it is. Null where that side cannot be dragged.
 */
export function elevationSideOps(view: Elevation, doc: Document, registry: Registry, item: ElevationItem, side: ElevationSide, delta: number): Op[] | null {
  const node = item.node
  if (side === 'top') return elevationHeightOps(doc, registry, node, delta)
  if (side === 'bottom') {
    // What is not raised (a door) has a bottom that stays on the floor.
    if (!item.raises) return null
    // No lower than the floor, no higher than 1 mm under its top.
    const above = view.y - item.box.maxY
    const tall = item.box.maxY - item.box.minY
    const dh = Math.min(Math.max(delta, -above), tall - 1)
    // As much shorter, its bottom where it is, then raised by as much: its top comes back where it was.
    const shorter = elevationHeightOps(doc, registry, node, -dh)
    if (!shorter) return null
    const changed = shorter.find((op): op is Extract<Op, { op: 'update_node' }> => op.op === 'update_node' && op.id === node.id)
    const after = (changed ? { ...node, ...changed.patch } : node) as typeof node
    const raised = elevationMovePatch(view, doc, registry, after, 0, dh)
    return raised ? [...shorter, { op: 'update_node', id: node.id, patch: raised }] : null
  }
  const line = lineOf(doc, view)
  if (!line || dist(line.a, line.b) < 1e-6) return null
  const d = norm(sub(line.b, line.a))
  const way = side === 'right' ? 1 : -1
  const patch = sideResize(doc, registry, node, d, way, delta)
  return patch ? [{ op: 'update_node', id: node.id, patch }] : null
}

/**
 * The patch that moves the side of an object's box on the plan that faces `way` along `d` by `delta`
 * along `d`: the side of its resize frame facing that way (a unit, furniture, a placement), else the
 * end of what stretches along its own X facing that way (a door, a window). Null when it has neither.
 */
function sideResize(doc: Document, registry: Registry, node: Node, d: Vec2, way: 1 | -1, delta: number): Record<string, unknown> | null {
  const frame = resizeFrame(node, registry, doc)
  if (frame) {
    const grips = frameGrips(frame)
    const centre = scale(add(grips[0], grips[2]), 0.5)
    // The middles of its sides are grips 4 to 7: the one facing most that way.
    const facing = [4, 5, 6, 7].map((grip) => ({ grip, at: grips[grip], score: dot(norm(sub(grips[grip], centre)), d) * way })).sort((p, q) => q.score - p.score)[0]
    if (facing.score < ALONG) return null
    return resizePatch(node, facing.grip, add(facing.at, scale(d, delta)), false, registry, doc)
  }
  const handles = node.type === 'parametric' ? (kindOf(node).handles?.(node, registry, doc) ?? []) : []
  if (handles.length !== 2 || dist(handles[0], handles[1]) < 1e-6) return null
  if (Math.abs(dot(norm(sub(handles[1], handles[0])), d)) < ALONG) return null
  const index = dot(sub(handles[1], handles[0]), d) * way > 0 ? 1 : 0
  return kindOf(node).moveHandle!(node, index, add(handles[index], scale(d, delta)), registry, doc)
}

/** The sides of the box an elevation draws an object in that can be dragged (`elevationSideOps`). */
export function elevationSides(view: Elevation, doc: Document, registry: Registry, item: ElevationItem): ElevationSide[] {
  return (['left', 'right', 'top', 'bottom'] as const).filter((side) => elevationSideOps(view, doc, registry, item, side, 0) !== null)
}

/**
 * How far to move edges at `moving` for one of them to land on one of `targets`: the nearest within
 * `reach`, else null. What is dragged in an elevation lines up so with what is beside it.
 */
export function nearestEdge(moving: number[], targets: number[], reach: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null
  for (const m of moving) {
    for (const at of targets) {
      const delta = at - m
      if (Math.abs(delta) <= reach && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at }
    }
  }
  return best
}
