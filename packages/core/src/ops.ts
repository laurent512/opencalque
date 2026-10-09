import * as z from 'zod'
import { componentUses, holdsChildren, isContainer, layersOf, newId, orderAfter, rootOf } from './document'
import { AssetSchema, LayerSchema, NodeSchema, type Asset, type ContainerNode, type Document, type Node } from './schema'

/**
 * Operations are the only way a document changes. Each one touches a single node or layer and is
 * plain JSON, so the same stream serves the UI, undo, scripts, AI agents and (later) realtime sync.
 */

type Input<N> = N extends ContainerNode
  ? Omit<N, 'id' | 'order' | 'parent'> & { id?: string; order?: string; parent?: null }
  : Omit<N, 'id' | 'order'> & { id?: string; order?: string }

/** A node to add. `id` is generated when omitted; `order` defaults to on top of its siblings. */
export type NodeInput = Input<Node>

export interface LayerInput {
  id?: string
  name: string
  order?: string
  visible?: boolean
  locked?: boolean
  color?: string
}

export type Op =
  | { op: 'add_node'; node: NodeInput }
  | { op: 'update_node'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_node'; id: string }
  | { op: 'add_layer'; layer: LayerInput }
  | { op: 'update_layer'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_layer'; id: string }
  | { op: 'add_asset'; asset: Omit<Asset, 'id'> & { id?: string } }
  | { op: 'set_document'; name: string }

const patch = z
  .record(z.string(), z.unknown())
  .describe('Shallow merge patch: each key replaces that property, and a null value removes it.')

export const OpSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_node'),
      node: z.looseObject({ type: z.string() }).describe('A node as in the document schema. "id" and "order" may be omitted.'),
    })
    .describe('Adds a node. Pages and components take no parent; every other node needs a page, component or group as parent.'),
  z
    .object({ op: z.literal('update_node'), id: z.string(), patch })
    .describe('Changes properties of a node. Set "parent" or "order" to move it. "id" and "type" cannot change.'),
  z
    .object({ op: z.literal('remove_node'), id: z.string() })
    .describe('Removes a node and everything inside it. Removing a component also removes its instances.'),
  z.object({ op: z.literal('add_layer'), layer: z.looseObject({ name: z.string() }) }),
  z.object({ op: z.literal('update_layer'), id: z.string(), patch }),
  z
    .object({ op: z.literal('remove_layer'), id: z.string() })
    .describe('Removes a layer. Its nodes move to the first remaining layer.'),
  z
    .object({ op: z.literal('add_asset'), asset: z.looseObject({ mime: z.string(), data: z.string() }) })
    .describe('Embeds a file (base64) so image nodes can show it. Assets are dropped on save once nothing uses them.'),
  z.object({ op: z.literal('set_document'), name: z.string() }).describe('Renames the document.'),
])

export class OpError extends Error {}

/** Validates untrusted JSON into a list of operations. */
export function parseOps(json: unknown): Op[] {
  const result = z.array(OpSchema).safeParse(json)
  if (!result.success) throw new OpError(`Invalid operations:\n${z.prettifyError(result.error)}`)
  return result.data as Op[]
}

/** Applies operations in order and returns the new document. All or nothing: on error the input is untouched. */
export function applyOps(doc: Document, ops: Op[]): Document {
  if (ops.length === 0) return doc
  const next: Document = { ...doc, nodes: { ...doc.nodes }, layers: { ...doc.layers } }
  if (doc.assets) next.assets = { ...doc.assets }
  for (const op of ops) applyOp(next, op)
  return next
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new OpError(`Invalid ${what}:\n${z.prettifyError(result.error)}`)
  return result.data
}

function merge(target: object, changes: Record<string, unknown>, fixed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(changes)) {
    if (fixed.includes(key)) throw new OpError(`"${key}" cannot be changed`)
    if (value === null && key !== 'parent') delete out[key]
    else out[key] = value
  }
  return out
}

function siblingOrders(d: Document, parent: unknown): string[] {
  const orders: string[] = []
  for (const n of Object.values(d.nodes)) if (n.parent === parent) orders.push(n.order)
  return orders
}

function checkNode(d: Document, node: Node): void {
  if (node.layer !== undefined && !d.layers[node.layer]) throw new OpError(`Unknown layer "${node.layer}"`)
  if (isContainer(node)) {
    if (node.parent !== null) throw new OpError(`A ${node.type} cannot have a parent`)
    return
  }
  const parent = node.parent === null ? undefined : d.nodes[node.parent]
  if (!parent || !holdsChildren(parent)) throw new OpError(`Node ${node.id}: parent must be an existing page, component or group`)
  // Walking up from the parent must reach a page or component without meeting the node itself.
  for (let up: Node | undefined = parent; up && !isContainer(up); up = up.parent === null ? undefined : d.nodes[up.parent]) {
    if (up.id === node.id) throw new OpError('A group cannot be placed inside itself')
  }
  const root = rootOf(d, node.parent)
  if (!root) throw new OpError(`Node ${node.id}: is not inside any page or component`)
  if (node.type === 'image' && !d.assets?.[node.asset]) throw new OpError(`Unknown asset "${node.asset}"`)
  if (node.type === 'instance') {
    if (d.nodes[node.component]?.type !== 'component') throw new OpError(`Unknown component "${node.component}"`)
    if (root.type === 'component' && componentUses(d, node.component, root.id)) {
      throw new OpError('A component cannot contain an instance of itself')
    }
  }
}

function applyOp(d: Document, op: Op): void {
  switch (op.op) {
    case 'add_node': {
      const input = op.node as Record<string, unknown>
      const container = input.type === 'page' || input.type === 'component'
      const id = (input.id as string | undefined) ?? newId(container ? String(input.type) : 'n')
      if (d.nodes[id]) throw new OpError(`Node "${id}" already exists`)
      const parent = container ? null : input.parent
      const order = input.order ?? orderAfter(siblingOrders(d, parent))
      const node = parse(NodeSchema, { ...input, id, parent, order }, 'node')
      checkNode(d, node)
      d.nodes[id] = node
      return
    }
    case 'update_node': {
      const node = d.nodes[op.id]
      if (!node) throw new OpError(`Unknown node "${op.id}"`)
      const next = parse(NodeSchema, merge(node, op.patch, ['id', 'type']), 'node')
      checkNode(d, next)
      d.nodes[op.id] = next
      return
    }
    case 'remove_node': {
      const node = d.nodes[op.id]
      if (!node) throw new OpError(`Unknown node "${op.id}"`)
      const all = Object.values(d.nodes)
      if (node.type === 'page' && all.filter((n) => n.type === 'page').length === 1) {
        throw new OpError('Cannot remove the last page')
      }
      // Everything inside goes too, however deeply nested, and so do instances of a removed component.
      const doomed = new Set([op.id])
      for (let grew = true; grew; ) {
        grew = false
        for (const n of all) {
          if (doomed.has(n.id)) continue
          if ((n.parent !== null && doomed.has(n.parent)) || (n.type === 'instance' && doomed.has(n.component))) {
            doomed.add(n.id)
            grew = true
          }
        }
      }
      for (const id of doomed) delete d.nodes[id]
      return
    }
    case 'add_layer': {
      const id = op.layer.id ?? newId('layer')
      if (d.layers[id]) throw new OpError(`Layer "${id}" already exists`)
      const order = op.layer.order ?? orderAfter(Object.values(d.layers).map((l) => l.order))
      d.layers[id] = parse(LayerSchema, { ...op.layer, id, order }, 'layer')
      return
    }
    case 'update_layer': {
      const layer = d.layers[op.id]
      if (!layer) throw new OpError(`Unknown layer "${op.id}"`)
      d.layers[op.id] = parse(LayerSchema, merge(layer, op.patch, ['id']), 'layer')
      return
    }
    case 'remove_layer': {
      if (!d.layers[op.id]) throw new OpError(`Unknown layer "${op.id}"`)
      delete d.layers[op.id]
      const fallback = layersOf(d)[0]
      if (!fallback) throw new OpError('Cannot remove the last layer')
      for (const n of Object.values(d.nodes)) if (n.layer === op.id) d.nodes[n.id] = { ...n, layer: fallback.id }
      return
    }
    case 'add_asset': {
      const id = op.asset.id ?? newId('asset')
      if (d.assets?.[id]) throw new OpError(`Asset "${id}" already exists`)
      d.assets = { ...d.assets, [id]: parse(AssetSchema, { ...op.asset, id }, 'asset') }
      return
    }
    case 'set_document':
      d.name = op.name
      return
  }
}
