import type { Document, Node } from './schema'
import { cloneOps } from './groups'
import { kindOf } from './kinds'
import type { Op } from './ops'

/*
 * Offsetting: a copy of a line or a shape lying parallel to it, at a distance. What that means for
 * each type is its kind's (`parallel`, `beside` in kinds.ts); the sign of a distance says which
 * side, the same for both, and what that side is called does not matter here.
 */

/** Whether the node has a parallel copy of its own kind: a wall, a group or an ellipse has none. */
export const canOffset = (node: Node): boolean => kindOf(node).parallel?.(node, 0) != null

/** How far `p` is from the node, signed for the side it is on, as `offsetOps` takes a distance. */
export const besideNode = (node: Node, p: { x: number; y: number }): number => kindOf(node).beside?.(node, p) ?? 0

/**
 * The operations that make a parallel copy of the node, `distance` from it, with its look and its
 * layer. Null when it has none at that distance: a shape would fold over itself.
 */
export function offsetOps(doc: Document, node: Node, distance: number): { ops: Op[]; id: string } | null {
  const patch = kindOf(node).parallel?.(node, distance)
  if (!patch) return null
  const { ops, id } = cloneOps(doc, node.id, { x: 0, y: 0 })
  return { ops: [...ops, { op: 'update_node', id, patch }], id }
}
