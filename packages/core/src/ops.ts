import { generateKeyBetween } from 'fractional-indexing'
import * as z from 'zod'
import { withoutColorRef } from './colors'
import { withDimensionStyle } from './dimensions'
import { componentUses, holdsChildren, isContainer, isOrderKey, layersOf, newId, orderAfter, rootOf } from './document'
import {
  AssetSchema,
  DEFAULT_MATERIAL,
  DimensionStyleSchema,
  type DimensionStyle,
  LayerSchema,
  MaterialSchema,
  type Material,
  NodeSchema,
  type Asset,
  type ContainerNode,
  type Document,
  type Node,
  SharedColorSchema,
  type SharedColor,
} from './schema'
import { keepUnknown, unknownKeys } from './unknown'

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
  | { op: 'add_color'; color: Omit<SharedColor, 'id'> & { id?: string } }
  | { op: 'update_color'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_color'; id: string }
  /** Taken out with wall types in format 2: refused, saying what to do instead. */
  | { op: 'add_wall_type' | 'update_wall_type' | 'remove_wall_type'; [key: string]: unknown }
  | { op: 'add_dimension_style'; dimensionStyle: Omit<DimensionStyle, 'id'> & { id?: string } }
  | { op: 'update_dimension_style'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_dimension_style'; id: string }
  | { op: 'add_material'; material: Omit<Material, 'id'> & { id?: string } }
  | { op: 'update_material'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_material'; id: string }
  | { op: 'add_asset'; asset: Omit<Asset, 'id'> & { id?: string } }
  | { op: 'set_document'; name?: string; info?: Record<string, string | null>; settings?: { system?: 'metric' | 'imperial' | null; decimal?: '.' | ',' | null } }

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
    .object({ op: z.literal('add_color'), color: z.looseObject({ name: z.string(), value: z.string() }) })
    .describe('Adds a shared colour. Use it by setting a colour property (style.stroke, style.fill, a layer color) to "var(--<id>)".'),
  ...(['add_wall_type', 'update_wall_type', 'remove_wall_type'] as const).map((op) =>
    z.looseObject({ op: z.literal(op) }).describe('Refused since format 2, which took wall types out: a wall carries what it is made of itself.'),
  ),
  z
    .object({ op: z.literal('add_dimension_style'), dimensionStyle: z.looseObject({ name: z.string() }) })
    .describe('Adds a dimension style: a name and whichever properties of a dimension it defines, under the same names (style, startMarker, size, unit…). Dimensions take it with "dimensionStyle": "<id>".'),
  z.object({ op: z.literal('update_dimension_style'), id: z.string(), patch }).describe('Changes a dimension style; every dimension in it follows, except where it has a value of its own. A null in the patch makes the style stop defining that property.'),
  z.object({ op: z.literal('remove_dimension_style'), id: z.string() }).describe('Removes a dimension style. Its dimensions keep how they look: what the style gave them becomes their own.'),
  z
    .object({ op: z.literal('add_material'), material: z.looseObject({ name: z.string() }) })
    .describe('Adds a material: a name, and the fill and pattern it is drawn with. Walls and the floors of rooms take it with "material": "<id>".'),
  z.object({ op: z.literal('update_material'), id: z.string(), patch }).describe('Changes a material; every wall and floor made of it follows. A null in the patch removes that property.'),
  z.object({ op: z.literal('remove_material'), id: z.string() }).describe('Removes a material. Walls made of it are of the default material after; floors made of it keep its colour and pattern as their own. The default material cannot be removed.'),
  z.object({ op: z.literal('update_color'), id: z.string(), patch }).describe('Changes a shared colour; everything that refers to it changes with it.'),
  z.object({ op: z.literal('remove_color'), id: z.string() }).describe('Removes a shared colour. What referred to it keeps the colour it had, as a plain colour.'),
  z
    .object({ op: z.literal('add_asset'), asset: z.looseObject({ mime: z.string(), data: z.string() }) })
    .describe('Embeds a file (base64) so image nodes can show it. Assets are dropped on save once nothing uses them.'),
  z
    .object({
      op: z.literal('set_document'),
      name: z.string().optional(),
      info: z.record(z.string(), z.string().nullable()).optional(),
      settings: z.object({ system: z.enum(['metric', 'imperial']).nullable().optional(), decimal: z.enum(['.', ',']).nullable().optional() }).optional(),
    })
    .describe(
      'Renames the document and/or changes what it says about itself ("info": project, client, address, author), shown in title blocks, and/or how it writes its numbers ("settings": system, decimal). In "info" and "settings" each key replaces that entry and a null or empty value removes it.',
    ),
])

export class OpError extends Error {}

/** Validates untrusted JSON into a list of operations. */
export function parseOps(json: unknown): Op[] {
  const result = z.array(OpSchema).safeParse(json)
  if (!result.success) throw new OpError(`Invalid operations:\n${z.prettifyError(result.error)}`)
  return result.data as Op[]
}

/**
 * What one call of `applyOps` remembers between its operations, so that a long list (a DXF of
 * twenty thousand lines, a large selection deleted) costs in proportion to its length rather than
 * to its length times the size of the drawing.
 */
interface Batch {
  /**
   * For each parent, an order key at or above the highest of its children's: a node added on top
   * goes after it. It may stay above a child that has since moved away, which only means the next
   * key is a little longer.
   */
  top?: Map<string | null, string>
}

/** Applies operations in order and returns the new document. All or nothing: on error the input is untouched. */
export function applyOps(doc: Document, ops: Op[]): Document {
  if (ops.length === 0) return doc
  const next: Document = { ...doc, nodes: { ...doc.nodes }, layers: { ...doc.layers } }
  if (doc.assets) next.assets = { ...doc.assets }
  if (doc.colors) next.colors = { ...doc.colors }
  if (doc.dimensionStyles) next.dimensionStyles = { ...doc.dimensionStyles }
  if (doc.materials) next.materials = { ...doc.materials }
  const batch: Batch = {}
  for (let i = 0; i < ops.length; ) {
    // Removals that follow one another are done together, finding what each takes along in one pass.
    if (ops[i].op === 'remove_node') {
      let end = i
      while (end < ops.length && ops[end].op === 'remove_node') end++
      removeNodes(next, ops.slice(i, end).map((op) => (op as { id: string }).id))
      i = end
    } else applyOp(next, ops[i++], batch)
  }
  return next
}

/** The highest order key among the children of `parent`, or one above it; null when it has none. */
function topOrder(d: Document, batch: Batch, parent: string | null): string | null {
  if (!batch.top) {
    batch.top = new Map()
    for (const node of Object.values(d.nodes)) raise(batch, node.parent, node.order)
  }
  return batch.top.get(parent) ?? null
}

function raise(batch: Batch, parent: string | null, order: string): void {
  const top = batch.top?.get(parent)
  if (batch.top && (top === undefined || order > top)) batch.top.set(parent, order)
}

/**
 * Removes nodes as `remove_node` operations one after the other would: each with everything
 * inside it however deeply, and a component with its instances. Naming a node that an earlier one
 * of them took along is an error, as it would be one at a time.
 */
function removeNodes(d: Document, ids: string[]): void {
  const children = new Map<string, string[]>()
  const instances = new Map<string, string[]>()
  let pages = 0
  for (const node of Object.values(d.nodes)) {
    if (node.parent !== null) {
      const list = children.get(node.parent)
      if (list) list.push(node.id)
      else children.set(node.parent, [node.id])
    }
    if (node.type === 'instance') {
      const list = instances.get(node.component)
      if (list) list.push(node.id)
      else instances.set(node.component, [node.id])
    }
    if (node.type === 'page') pages++
  }
  const doomed = new Set<string>()
  for (const id of ids) {
    const node = d.nodes[id]
    if (!node || doomed.has(id)) throw new OpError(`Unknown node "${id}"`)
    if (node.type === 'page' && pages-- === 1) throw new OpError('Cannot remove the last page')
    for (const queue = [id]; queue.length > 0; ) {
      const next = queue.pop()!
      if (doomed.has(next)) continue
      doomed.add(next)
      queue.push(...(children.get(next) ?? []))
      if (d.nodes[next]?.type === 'component') queue.push(...(instances.get(next) ?? []))
    }
  }
  for (const id of doomed) delete d.nodes[id]
}

/** What a script that still uses wall types is told: format 2 took them out. */
export const NO_WALL_TYPES =
  'Wall types were taken out in format 2 (OpenCalque 1.2): a wall carries what it is made of itself. Give walls their "material" and "thickness", and a "height" or a "style" of their own; a wall of several materials is several walls side by side.'

/** Refuses what a node or patch says of wall types; taking it away (null) is let through. */
function typeless(input: Record<string, unknown>): void {
  if ((input.wallType !== undefined && input.wallType !== null) || (input.overrides !== undefined && input.overrides !== null)) throw new OpError(NO_WALL_TYPES)
}

/** Validates what an operation makes, keeping the properties the format does not know (see unknown.ts). */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new OpError(`Invalid ${what}:\n${z.prettifyError(result.error)}`)
  return keepUnknown(value, result.data)
}

/** What a node or layer is told when its order is not one. */
const badOrder = (order: string) => `"${order}" is not an order key. Use a fractional-indexing key such as "a0" or "a1V", which sorts by plain string comparison, or leave "order" out to put it on top.`

function merge(target: object, changes: Record<string, unknown>, fixed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(changes)) {
    if (fixed.includes(key)) throw new OpError(`"${key}" cannot be changed`)
    if (value === null && key !== 'parent') delete out[key]
    else out[key] = value
  }
  return out
}

function checkNode(d: Document, node: Node): void {
  if (!isOrderKey(node.order)) throw new OpError(`Node ${node.id}: ${badOrder(node.order)}`)
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
  if (node.layer !== undefined && root.type === 'component') {
    throw new OpError(`Node ${node.id}: what is inside a component has no layer, each placement of the component giving its own. Leave "layer" out.`)
  }
  if (node.type === 'instance' && node.style !== undefined) {
    throw new OpError(`Node ${node.id}: an instance has no style; it looks as its component is drawn. Change the shapes inside the component, or put the instance on a layer of another colour.`)
  }
  if (node.type === 'image' && !d.assets?.[node.asset]) throw new OpError(`Unknown asset "${node.asset}"`)
  if (node.type === 'dimension' && node.dimensionStyle !== undefined && !d.dimensionStyles?.[node.dimensionStyle]) throw new OpError(`Unknown dimension style "${node.dimensionStyle}"`)
  if (node.type === 'room' && node.material !== undefined && !d.materials?.[node.material]) throw new OpError(`Unknown material "${node.material}"`)
  if (node.type === 'wall' && node.material !== undefined && !d.materials?.[node.material]) throw new OpError(`Wall ${node.id}: unknown material "${node.material}"`)
  if (node.type === 'instance') {
    if (d.nodes[node.component]?.type !== 'component') throw new OpError(`Unknown component "${node.component}"`)
    if (root.type === 'component' && componentUses(d, node.component, root.id)) {
      throw new OpError('A component cannot contain an instance of itself')
    }
  }
}

function applyOp(d: Document, op: Op, batch: Batch): void {
  switch (op.op) {
    case 'add_node': {
      const input = op.node as Record<string, unknown>
      const container = input.type === 'page' || input.type === 'component'
      const id = (input.id as string | undefined) ?? newId(container ? String(input.type) : 'n')
      if (d.nodes[id]) throw new OpError(`Node "${id}" already exists`)
      const parent = container ? null : input.parent
      const order = input.order ?? generateKeyBetween(topOrder(d, batch, typeof parent === 'string' ? parent : null), null)
      if (input.type === 'wall') typeless(input)
      const node = parse(NodeSchema, { ...input, id, parent, order }, 'node')
      checkNode(d, node)
      d.nodes[id] = node
      raise(batch, node.parent, node.order)
      return
    }
    case 'update_node': {
      const node = d.nodes[op.id]
      if (!node) throw new OpError(`Unknown node "${op.id}"`)
      if (node.type === 'wall') typeless(op.patch)
      const next = parse(NodeSchema, merge(node, op.patch, ['id', 'type']), 'node')
      checkNode(d, next)
      d.nodes[op.id] = next
      if (next.parent !== node.parent || next.order !== node.order) raise(batch, next.parent, next.order)
      return
    }
    case 'remove_node':
      return removeNodes(d, [op.id])
    case 'add_layer': {
      const id = op.layer.id ?? newId('layer')
      if (d.layers[id]) throw new OpError(`Layer "${id}" already exists`)
      const order = op.layer.order ?? orderAfter(Object.values(d.layers).map((l) => l.order))
      const layer = parse(LayerSchema, { ...op.layer, id, order }, 'layer')
      if (!isOrderKey(layer.order)) throw new OpError(`Layer ${id}: ${badOrder(layer.order)}`)
      d.layers[id] = layer
      return
    }
    case 'update_layer': {
      const layer = d.layers[op.id]
      if (!layer) throw new OpError(`Unknown layer "${op.id}"`)
      const next = parse(LayerSchema, merge(layer, op.patch, ['id']), 'layer')
      if (!isOrderKey(next.order)) throw new OpError(`Layer ${op.id}: ${badOrder(next.order)}`)
      d.layers[op.id] = next
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
    case 'add_color': {
      const id = op.color.id ?? newId('color')
      if (d.colors?.[id]) throw new OpError(`Colour "${id}" already exists`)
      if (id === 'layer') throw new OpError('"layer" cannot be the id of a shared colour: "var(--layer)" means the colour of the layer a node is on.')
      d.colors = { ...d.colors, [id]: parse(SharedColorSchema, { ...op.color, id }, 'colour') }
      return
    }
    case 'update_color': {
      const color = d.colors?.[op.id]
      if (!color) throw new OpError(`Unknown colour "${op.id}"`)
      d.colors = { ...d.colors, [op.id]: parse(SharedColorSchema, merge(color, op.patch, ['id']), 'colour') }
      return
    }
    case 'remove_color': {
      const color = d.colors?.[op.id]
      if (!color) throw new OpError(`Unknown colour "${op.id}"`)
      const { [op.id]: _, ...rest } = d.colors!
      d.colors = rest
      // What used it keeps how it looks: the reference becomes the colour it stood for.
      for (const n of Object.values(d.nodes)) d.nodes[n.id] = withoutColorRef(n, op.id, color.value)
      for (const l of Object.values(d.layers)) d.layers[l.id] = withoutColorRef(l, op.id, color.value)
      // So do the dimension styles and materials that gave it.
      if (d.dimensionStyles) d.dimensionStyles = withoutColorRef(d.dimensionStyles, op.id, color.value)
      if (d.materials) d.materials = withoutColorRef(d.materials, op.id, color.value)
      return
    }
    case 'add_wall_type':
    case 'update_wall_type':
    case 'remove_wall_type':
      throw new OpError(NO_WALL_TYPES)
    case 'add_dimension_style': {
      const id = op.dimensionStyle.id ?? newId('dimstyle')
      if (d.dimensionStyles?.[id]) throw new OpError(`Dimension style "${id}" already exists`)
      d.dimensionStyles = { ...d.dimensionStyles, [id]: parse(DimensionStyleSchema, { ...op.dimensionStyle, id }, 'dimension style') }
      return
    }
    case 'update_dimension_style': {
      const style = d.dimensionStyles?.[op.id]
      if (!style) throw new OpError(`Unknown dimension style "${op.id}"`)
      d.dimensionStyles = { ...d.dimensionStyles, [op.id]: parse(DimensionStyleSchema, merge(style, op.patch, ['id']), 'dimension style') }
      return
    }
    case 'remove_dimension_style': {
      const style = d.dimensionStyles?.[op.id]
      if (!style) throw new OpError(`Unknown dimension style "${op.id}"`)
      const { [op.id]: _, ...rest } = d.dimensionStyles!
      d.dimensionStyles = rest
      // Its dimensions keep how they look, as what referred to a removed colour does: what the style gave them becomes their own.
      for (const n of Object.values(d.nodes)) {
        if (n.type !== 'dimension' || n.dimensionStyle !== op.id) continue
        const { dimensionStyle: __, ...plain } = withDimensionStyle(n, style)
        d.nodes[n.id] = plain
      }
      return
    }
    case 'add_material': {
      const id = op.material.id ?? newId('material')
      if (d.materials?.[id]) throw new OpError(`Material "${id}" already exists`)
      d.materials = { ...d.materials, [id]: parse(MaterialSchema, { ...op.material, id }, 'material') }
      return
    }
    case 'update_material': {
      const material = d.materials?.[op.id]
      if (!material) throw new OpError(`Unknown material "${op.id}"`)
      d.materials = { ...d.materials, [op.id]: parse(MaterialSchema, merge(material, op.patch, ['id']), 'material') }
      return
    }
    case 'remove_material': {
      const material = d.materials?.[op.id]
      if (!material) throw new OpError(`Unknown material "${op.id}"`)
      if (op.id === DEFAULT_MATERIAL) throw new OpError('The default material cannot be removed: it is what walls are made of until they are given another. Change its fill or pattern instead.')
      const { [op.id]: _, ...rest } = d.materials!
      d.materials = rest
      // The walls made of it are of the default material after; a floor keeps how it looks: what the material gave it becomes its own.
      for (const n of Object.values(d.nodes)) {
        if (n.type === 'wall' && n.material === op.id) {
          const { material: _, ...wall } = n
          d.nodes[n.id] = wall
        }
        if (n.type !== 'room' || n.material !== op.id) continue
        const { material: __, ...room } = n
        const look = { ...(material.fill === undefined ? {} : { fill: material.fill }), ...(material.pattern === undefined ? {} : { pattern: material.pattern }) }
        d.nodes[n.id] = Object.keys(look).length > 0 ? { ...room, style: { ...look, ...room.style } } : room
      }
      return
    }
    case 'add_asset': {
      const id = op.asset.id ?? newId('asset')
      if (d.assets?.[id]) throw new OpError(`Asset "${id}" already exists`)
      d.assets = { ...d.assets, [id]: parse(AssetSchema, { ...op.asset, id }, 'asset') }
      return
    }
    case 'set_document': {
      if (op.name !== undefined) d.name = op.name
      if (op.info) {
        const info: Record<string, string> = { ...d.info }
        for (const [key, value] of Object.entries(op.info)) {
          if (!['project', 'client', 'address', 'author'].includes(key)) throw new OpError(`Unknown document information "${key}". Use project, client, address or author.`)
          if (value === null || value.trim() === '') delete info[key]
          else info[key] = value
        }
        if (Object.keys(info).length > 0) d.info = info
        else delete d.info
      }
      if (op.settings) {
        const settings: Record<string, string> = { ...d.settings }
        for (const [key, value] of Object.entries(op.settings)) {
          const allowed = key === 'system' ? ['metric', 'imperial'] : key === 'decimal' ? ['.', ','] : null
          if (!allowed) throw new OpError(`Unknown drawing setting "${key}". Use system or decimal.`)
          if (value === null || value === undefined) delete settings[key]
          else if (!allowed.includes(value)) throw new OpError(`The setting "${key}" is ${allowed.map((one) => `"${one}"`).join(' or ')}, not "${value}".`)
          else settings[key] = value
        }
        if (Object.keys(settings).length > 0) d.settings = settings as Document['settings']
        else delete d.settings
      }
      return
    }
  }
}

/**
 * The properties written in operations that the format does not know, one line per node or entry,
 * as a script or an assistant should be told: they are kept (a newer version may know them) but
 * do nothing here. Usually a misspelling, such as "thicknes", or a property of another type of node.
 * Operations that are invalid anyway are left to `applyOps` to report.
 */
export function unknownProperties(doc: Document, ops: Op[]): string[] {
  const out: string[] = []
  const report = (what: string, keys: string[]) => {
    if (keys.length > 0) out.push(`${what}: ${keys.map((key) => `"${key}"`).join(', ')}`)
  }
  /** The nodes added earlier in the list, so that a later update of one is checked too. */
  const added = new Map<string, Record<string, unknown>>()
  const check = (schema: z.ZodType, input: Record<string, unknown>, only?: string[]): string[] => {
    const result = schema.safeParse(input)
    if (!result.success) return []
    return unknownKeys(input, result.data).filter((path) => !only || only.includes(path.split(/[.[]/)[0]))
  }
  const patched = (target: object, patch: Record<string, unknown>) => Object.fromEntries(Object.entries({ ...target, ...patch }).filter(([, value]) => value !== null))
  for (const op of ops) {
    switch (op.op) {
      case 'add_node': {
        const node = op.node as Record<string, unknown>
        const id = typeof node.id === 'string' ? node.id : undefined
        const container = node.type === 'page' || node.type === 'component'
        const full = { ...node, id: id ?? 'new', parent: container ? null : (node.parent ?? 'parent'), order: node.order ?? 'a0' }
        if (id) added.set(id, full)
        report(`new ${String(node.type)}${id ? ` "${id}"` : ''}`, check(NodeSchema, full))
        break
      }
      case 'update_node': {
        const node = (doc.nodes[op.id] as Record<string, unknown> | undefined) ?? added.get(op.id)
        if (node) report(`${String(node.type)} "${op.id}"`, check(NodeSchema, patched(node, op.patch), Object.keys(op.patch)))
        break
      }
      case 'add_layer':
        report(`new layer "${op.layer.name}"`, check(LayerSchema, { id: 'new', order: 'a0', ...op.layer }))
        break
      case 'update_layer':
        if (doc.layers[op.id]) report(`layer "${op.id}"`, check(LayerSchema, patched(doc.layers[op.id], op.patch), Object.keys(op.patch)))
        break
      case 'add_color':
        report(`new colour "${op.color.name}"`, check(SharedColorSchema, { id: 'new', ...op.color }))
        break
      case 'update_color':
        if (doc.colors?.[op.id]) report(`colour "${op.id}"`, check(SharedColorSchema, patched(doc.colors[op.id], op.patch), Object.keys(op.patch)))
        break
      case 'add_dimension_style':
        report(`new dimension style "${op.dimensionStyle.name}"`, check(DimensionStyleSchema, { id: 'new', ...op.dimensionStyle }))
        break
      case 'update_dimension_style':
        if (doc.dimensionStyles?.[op.id]) report(`dimension style "${op.id}"`, check(DimensionStyleSchema, patched(doc.dimensionStyles[op.id], op.patch), Object.keys(op.patch)))
        break
      case 'add_material':
        report(`new material "${op.material.name}"`, check(MaterialSchema, { id: 'new', ...op.material }))
        break
      case 'update_material':
        if (doc.materials?.[op.id]) report(`material "${op.id}"`, check(MaterialSchema, patched(doc.materials[op.id], op.patch), Object.keys(op.patch)))
        break
    }
  }
  return out
}
