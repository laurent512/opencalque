import { generateNKeysBetween } from 'fractional-indexing'
import { childrenOf, newId, orderBetween, pagesOf } from './document'
import type { Vec2 } from './geometry'
import { kindOf, movePatch } from './kinds'
import { applyOps, OpError, type NodeInput, type Op } from './ops'
import type { Document } from './schema'

/**
 * Puts nodes that share a parent into a new group, which takes the place of the topmost of them
 * in the stacking order. A group has no geometry of its own: its members keep their coordinates.
 */
export function groupNodes(doc: Document, nodeIds: string[], name?: string): { doc: Document; groupId: string } {
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
  return { doc: applyOps(doc, ops), groupId }
}

/** Dissolves a group: its members take its place in its parent, in the same order. */
export function ungroupNode(doc: Document, groupId: string): { doc: Document; childIds: string[] } {
  const group = doc.nodes[groupId]
  if (group?.type !== 'group' || group.parent === null) throw new OpError('Select a group to ungroup')
  const siblings = childrenOf(doc, group.parent)
  const at = siblings.findIndex((n) => n.id === groupId)
  const members = childrenOf(doc, groupId)
  const orders = generateNKeysBetween(siblings[at - 1]?.order ?? null, siblings[at + 1]?.order ?? null, members.length)
  const ops: Op[] = [
    ...members.map((n, i): Op => ({ op: 'update_node', id: n.id, patch: { parent: group.parent, order: orders[i] } })),
    { op: 'remove_node', id: groupId },
  ]
  return { doc: applyOps(doc, ops), childIds: members.map((n) => n.id) }
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
 * The operations that make a copy of a page, with everything on it, placed right after it. What is
 * on a shared layer is left out: it already shows on every page, the copy included.
 */
export function duplicatePageOps(doc: Document, pageId: string, name: string): { ops: Op[]; id: string } {
  const page = doc.nodes[pageId]
  if (page?.type !== 'page') throw new OpError(`"${pageId}" is not a page`)
  const pages = pagesOf(doc)
  const next = pages[pages.findIndex((p) => p.id === pageId) + 1]
  const id = newId('page')
  const ops: Op[] = [{ op: 'add_node', node: { type: 'page', id, name, order: orderBetween(page.order, next?.order ?? null) } }]
  for (const child of childrenOf(doc, pageId)) {
    if (child.layer !== undefined && doc.layers[child.layer]?.shared) continue
    ops.push(...cloneOps(doc, child.id, { x: 0, y: 0 }, id).ops)
  }
  return { ops, id }
}

/** The operations that move a page one place earlier (-1) or later (+1) in the list of pages. */
export function movePageOps(doc: Document, pageId: string, by: -1 | 1): Op[] {
  const pages = pagesOf(doc)
  const from = pages.findIndex((p) => p.id === pageId)
  const other = pages[from + by]
  if (from < 0 || !other) return []
  // The two pages swap their places in the order.
  return [
    { op: 'update_node', id: pageId, patch: { order: other.order } },
    { op: 'update_node', id: other.id, patch: { order: pages[from].order } },
  ]
}
