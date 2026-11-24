import { childrenOf, newId, ordersAt, pagesOf } from './document'
import { viewPlacement } from './elevation'
import type { Vec2 } from './geometry'
import { kindOf, moveOps, movePatch } from './kinds'
import { applyOps, OpError, type NodeInput, type Op } from './ops'
import type { Registry } from './registry'
import type { Document, Node, NodeOf } from './schema'
import { transformOps } from './transform'

/**
 * Puts nodes that share a parent into a new group, which takes the place of the topmost of them
 * in the stacking order. A group has no geometry of its own: its members keep their coordinates.
 * Returns the new document and the operations that make it.
 */
export function groupNodes(doc: Document, nodeIds: string[], name?: string): { doc: Document; ops: Op[]; groupId: string } {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Select at least one object to group')
  const members = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))
  if (members.length !== picked.size) throw new OpError('Objects of a group must all be in the same place')
  const groupId = newId('group')
  const ops: Op[] = [
    { op: 'add_node', node: { type: 'group', id: groupId, parent: first.parent, order: members[members.length - 1].order, ...(name ? { name } : {}) } },
    ...members.map((n): Op => ({ op: 'update_node', id: n.id, patch: { parent: groupId } })),
  ]
  return { doc: applyOps(doc, ops), ops, groupId }
}

/** Dissolves a group: its members take its place in its parent, in the same order. Returns the new document and the operations that make it. */
export function ungroupNode(doc: Document, groupId: string): { doc: Document; ops: Op[]; childIds: string[] } {
  const group = doc.nodes[groupId]
  if (group?.type !== 'group' || group.parent === null) throw new OpError('Select a group to ungroup')
  const siblings = childrenOf(doc, group.parent)
  const at = siblings.findIndex((n) => n.id === groupId)
  const members = childrenOf(doc, groupId)
  const orders = ordersAt(siblings.filter((n) => n.id !== groupId), at, members.length)
  const ops: Op[] = [
    ...members.map((n, i): Op => ({ op: 'update_node', id: n.id, patch: { parent: group.parent, order: orders[i] } })),
    { op: 'remove_node', id: groupId },
  ]
  return { doc: applyOps(doc, ops), ops, childIds: members.map((n) => n.id) }
}

/**
 * The operations that copy a node, with everything inside it when it is a group, moved by
 * `offset`. The copy goes on top of its siblings. Returns the id the copy will have.
 */
export function cloneOps(doc: Document, id: string, offset: Vec2, into?: string): { ops: Op[]; id: string } {
  const node = doc.nodes[id]
  if (!node) throw new OpError(`Unknown node "${id}"`)
  const copyId = newId(node.type === 'group' ? 'group' : 'n')
  const { order, ...rest } = node
  const copy = { ...rest, ...movePatch(node, offset), id: copyId, parent: into ?? node.parent }
  // Inside a copied group the members keep their order; the top-level copy goes on top.
  const ops: Op[] = [{ op: 'add_node', node: (into ? { ...copy, order } : copy) as NodeInput }]
  if (node.type === 'group') for (const child of childrenOf(doc, id)) ops.push(...cloneOps(doc, child.id, offset, copyId).ops)
  return { ops, id: copyId }
}

/**
 * The operations that make a copy of a page, with everything on it, placed right after it.
 */
export function duplicatePageOps(doc: Document, pageId: string, name: string): { ops: Op[]; id: string } {
  const page = doc.nodes[pageId]
  if (page?.type !== 'page') throw new OpError(`"${pageId}" is not a page`)
  const pages = pagesOf(doc)
  const id = newId('page')
  const ops: Op[] = [{ op: 'add_node', node: { type: 'page', id, name, order: ordersAt(pages, pages.findIndex((p) => p.id === pageId) + 1, 1)[0] } }]
  for (const child of childrenOf(doc, pageId)) {
    ops.push(...cloneOps(doc, child.id, { x: 0, y: 0 }, id).ops)
  }
  return { ops, id }
}

/**
 * The operations that put nodes in `parent` (a page, a component or a group), next to `target`,
 * one of what it holds, just before or just after it in the stacking order, or on top of what it
 * holds when there is no target. They may come from anywhere in the same page or component; they
 * keep their order among themselves, and their coordinates (a group has no geometry of its own);
 * but into or out of a view (an elevation, a section), whose contents are in its own coordinates,
 * they are brought into them or out of them (with `registry`), so that they stay where they are seen.
 * A node that `parent` is inside of, or `parent` itself, is left where it is: a group cannot go
 * inside itself. Nothing is done when they would end up where they are.
 */
export function placeInOps(doc: Document, ids: string[], parent: string, target?: { id: string; after: boolean }, registry?: Registry): Op[] {
  const above = new Set<string>()
  for (let up: string | null = parent; up !== null; up = doc.nodes[up]?.parent ?? null) above.add(up)
  const moving = ids.map((id) => doc.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n && n.parent !== null && !above.has(n.id))
  if (moving.length === 0 || (target && moving.some((n) => n.id === target.id))) return []
  // In their order on the drawing: below one another as they were, where they shared a parent.
  moving.sort((p, q) => (p.parent === q.parent ? (p.order < q.order ? -1 : 1) : 0))
  const going = new Set(moving.map((n) => n.id))
  const siblings = childrenOf(doc, parent)
  const rest = siblings.filter((n) => !going.has(n.id))
  const at = target ? rest.findIndex((n) => n.id === target.id) + (target.after ? 1 : 0) : rest.length
  if (target && at < (target.after ? 1 : 0)) return []
  const result = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  if (result.length === siblings.length && result.every((n, i) => n === siblings[i])) return []
  const orders = ordersAt(rest, at, moving.length, target && !target.after ? 'above' : 'below')
  const placed = moving.map((n, i): Op => ({ op: 'update_node', id: n.id, patch: { ...(n.parent === parent ? {} : { parent }), order: orders[i] } }))
  // Out of a view, through where it draws them; into one, back into its coordinates.
  const to = viewAbove(doc, parent)
  const carried: Op[] = []
  let work = doc
  for (const n of moving) {
    const from = viewAbove(doc, n.parent)
    if (!registry || from?.id === to?.id) continue
    const steps: Op[][] = []
    const step = (make: (node: Node) => Op[]) => {
      const ops = make(work.nodes[n.id])
      work = applyOps(work, ops)
      steps.push(ops)
    }
    if (from) {
      const { x, y, scale } = viewPlacement(from)
      step((node) => transformOps(work, [node], { pivot: { x: 0, y: 0 }, scale }, registry))
      step((node) => moveOps(work, node, { x, y }))
    }
    if (to) {
      const { x, y, scale } = viewPlacement(to)
      step((node) => moveOps(work, node, { x: -x, y: -y }))
      step((node) => transformOps(work, [node], { pivot: { x: 0, y: 0 }, scale: 1 / scale }, registry))
    }
    carried.push(...steps.flat())
  }
  return [...carried, ...placed]
}

/** The view (an elevation, a section) that `id` is, or is inside of: what its contents' coordinates are of. */
function viewAbove(doc: Document, id: string | null): NodeOf<'elevation'> | null {
  for (let at = id, depth = 0; at !== null && depth < 64; depth++) {
    const node: Node | undefined = doc.nodes[at]
    if (!node) return null
    if (node.type === 'elevation') return node
    at = node.parent
  }
  return null
}

/**
 * The operations that move sibling nodes next to `target`, just before or just after it in their
 * parent's order, keeping their order among themselves. Pages are put among the pages. Nothing is
 * done when they would end up where they are, or when the target is one of them.
 */
export function reorderOps(doc: Document, ids: string[], target: string, after: boolean): Op[] {
  const node = doc.nodes[target]
  const moving = new Set(ids)
  if (!node || moving.has(target)) return []
  const siblings = node.parent === null ? pagesOf(doc) : childrenOf(doc, node.parent)
  const moved = siblings.filter((n) => moving.has(n.id))
  const rest = siblings.filter((n) => !moving.has(n.id))
  const at = rest.findIndex((n) => n.id === target) + (after ? 1 : 0)
  const result = [...rest.slice(0, at), ...moved, ...rest.slice(at)]
  if (moved.length === 0 || result.every((n, i) => n === siblings[i])) return []
  const orders = ordersAt(rest, at, moved.length, after ? 'below' : 'above')
  return moved.map((n, i): Op => ({ op: 'update_node', id: n.id, patch: { order: orders[i] } }))
}
