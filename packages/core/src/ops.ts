import { generateKeyBetween } from 'fractional-indexing'
import * as z from 'zod'
import { withoutColorRef } from './colors'
import { withDimensionStyle } from './dimensions'
import { componentUses, holdsChildren, isContainer, isOrderKey, layersOf, linkable, newId, orderAfter, rootOf, VIEW_CONTENTS } from './document'
import {
  AssetSchema,
  DEFAULT_MATERIAL,
  DimensionStyleSchema,
  GRID_DIVISIONS,
  type DimensionStyle,
  LayerSchema,
  MaterialSchema,
  type Material,
  NodeSchema,
  PresetSchema,
  type Preset,
  type Asset,
  type ContainerNode,
  type Document,
  type Node,
  type NodeOf,
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
  | { op: 'add_preset'; preset: Omit<Preset, 'id'> & { id?: string } }
  | { op: 'update_preset'; id: string; patch: Record<string, unknown> }
  | { op: 'remove_preset'; id: string }
  | { op: 'add_asset'; asset: Omit<Asset, 'id'> & { id?: string } }
  | { op: 'set_document'; name?: string; info?: Record<string, string | null>; settings?: { system?: 'metric' | 'imperial' | null; decimal?: '.' | ',' | null; titleBlock?: { layout?: 'corner' | 'strip'; labels?: Record<string, string> } | null; grid?: { spacing: number; divisions?: number } | null; site?: { latitude: number; longitude: number; timeZone?: string } | null } }

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
    .describe('Removes a node and everything inside it. Removing a component also removes its instances, and removing an object the links that join it to others.'),
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
  z
    .object({ op: z.literal('add_preset'), preset: z.looseObject({ name: z.string(), of: z.string() }) })
    .describe("Saves settings for one of the editor's tools under a name, picked there before drawing: for 'wall', its thickness, material and layer; for a parametric kind ('arch.door', 'arch.window'), its props. Nothing drawn refers to them."),
  z.object({ op: z.literal('update_preset'), id: z.string(), patch }).describe('Changes saved settings. A null in the patch removes that property.'),
  z.object({ op: z.literal('remove_preset'), id: z.string() }).describe('Removes saved settings. Nothing drawn changes.'),
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
      settings: z
        .object({
          system: z.enum(['metric', 'imperial']).nullable().optional(),
          decimal: z.enum(['.', ',']).nullable().optional(),
          titleBlock: z.object({ layout: z.enum(['corner', 'strip']).optional(), labels: z.record(z.string(), z.string()).optional() }).nullable().optional(),
          grid: z.object({ spacing: z.number(), divisions: z.number().int().optional() }).nullable().optional(),
          site: z.object({ latitude: z.number(), longitude: z.number(), timeZone: z.string().optional() }).nullable().optional(),
        })
        .optional(),
    })
    .describe(
      'Renames the document and/or changes what it says about itself ("info": project, client, address, author), shown in title blocks, and/or how it writes its numbers and lays out its title blocks ("settings": system, decimal, titleBlock), the grid the editor shows ("grid": spacing of its main lines in mm, and the divisions of each square) and where the building stands, for the sun ("site": latitude, longitude, timeZone). In "info" and "settings" each key replaces that entry and a null or empty value removes it.',
    ),
])

export class OpError extends Error {}

/** Saved settings without their reference to a layer or a material that is removed. */
function withoutPresetRef(presets: Record<string, Preset>, key: 'layer' | 'material', id: string): Record<string, Preset> {
  return Object.fromEntries(
    Object.entries(presets).map(([pid, preset]) => {
      if (preset[key] !== id) return [pid, preset]
      const { [key]: _, ...rest } = preset
      return [pid, rest]
    }),
  )
}

/** The layout of a drawing's title blocks as a `set_document` gives it, checked: a layout and captions, as texts. */
function titleLayout(value: unknown): { layout?: 'corner' | 'strip'; labels?: Record<string, string> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OpError('The setting "titleBlock" is an object with "layout" and "labels".')
  const { layout, labels, ...rest } = value as Record<string, unknown>
  const unknown = Object.keys(rest)[0]
  if (unknown !== undefined) throw new OpError(`Unknown title block setting "${unknown}". Use layout or labels.`)
  if (layout !== undefined && layout !== 'corner' && layout !== 'strip') throw new OpError(`The title block's layout is "corner" or "strip", not "${String(layout)}".`)
  if (labels !== undefined && (typeof labels !== 'object' || labels === null || Array.isArray(labels) || Object.values(labels).some((text) => typeof text !== 'string')))
    throw new OpError('The title block\'s labels are texts by entry, such as { "project": "Project" }.')
  return { ...(layout !== undefined ? { layout } : {}), ...(labels !== undefined ? { labels: labels as Record<string, string> } : {}) }
}

/** The drawing's grid as an operation gives it, checked: main lines a positive number of mm apart, each square divided into 1 to `GRID_DIVISIONS` parts, 1 left out. */
function gridSetting(value: unknown): { spacing: number; divisions?: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OpError('The setting "grid" is an object with "spacing" (in mm) and "divisions".')
  const { spacing, divisions, ...rest } = value as Record<string, unknown>
  const unknown = Object.keys(rest)[0]
  if (unknown !== undefined) throw new OpError(`Unknown grid setting "${unknown}". Use spacing or divisions.`)
  if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) throw new OpError(`The grid's spacing is a length in mm greater than 0, not ${JSON.stringify(spacing)}.`)
  if (divisions !== undefined && (typeof divisions !== 'number' || !Number.isInteger(divisions) || divisions < 1 || divisions > GRID_DIVISIONS))
    throw new OpError(`The grid's divisions are a whole number from 1 to ${GRID_DIVISIONS}, not ${JSON.stringify(divisions)}.`)
  return { spacing, ...(divisions !== undefined && divisions > 1 ? { divisions } : {}) }
}

/** Where the building stands as a `set_document` gives it, checked: a latitude and a longitude in degrees, and a time zone. */
function siteSetting(value: unknown): { latitude: number; longitude: number; timeZone?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OpError('The setting "site" is an object with "latitude", "longitude" (in degrees) and "timeZone".')
  const { latitude, longitude, timeZone, ...rest } = value as Record<string, unknown>
  const unknown = Object.keys(rest)[0]
  if (unknown !== undefined) throw new OpError(`Unknown site setting "${unknown}". Use latitude, longitude or timeZone.`)
  if (typeof latitude !== 'number' || !(latitude >= -90 && latitude <= 90)) throw new OpError(`The site's latitude is in degrees from -90 to 90 (north positive), not ${JSON.stringify(latitude)}.`)
  if (typeof longitude !== 'number' || !(longitude >= -180 && longitude <= 180)) throw new OpError(`The site's longitude is in degrees from -180 to 180 (east positive), not ${JSON.stringify(longitude)}.`)
  if (timeZone !== undefined && (typeof timeZone !== 'string' || timeZone.trim() === '')) throw new OpError(`The site's time zone is a name such as "Europe/Paris", not ${JSON.stringify(timeZone)}.`)
  return { latitude, longitude, ...(typeof timeZone === 'string' ? { timeZone } : {}) }
}

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
  // What the operations left as it was stays the very same object, so that whatever was worked out
  // from it (a view raised to its heights, a scene) is seen to still hold: copied above to be
  // changed safely, the layers would otherwise be new after any edit at all.
  for (const key of KEPT_WHOLE) {
    const [was, now] = [doc[key], next[key]] as [Record<string, unknown> | undefined, Record<string, unknown> | undefined]
    if (was && now && was !== now && sameEntries(was, now)) (next as unknown as Record<string, unknown>)[key] = was
  }
  return next
}

/** The parts of a document besides its nodes that `applyOps` copies before changing them. */
const KEPT_WHOLE = ['layers', 'assets', 'colors', 'dimensionStyles', 'materials'] as const

/** Whether two records hold the same values under the same keys. */
function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
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

/** What removing a node takes along besides itself: what is inside it, its links, and a component's placements or a view line's views. */
function removal(d: Document): { along: (id: string) => string[]; pages: number } {
  const children = new Map<string, string[]>()
  const instances = new Map<string, string[]>()
  // The links at each node, which go with it: a link with one end is not drawn and means nothing.
  const links = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key)
    if (list) list.push(id)
    else map.set(key, [id])
  }
  let pages = 0
  for (const node of Object.values(d.nodes)) {
    if (node.type === 'link') for (const end of [node.from, node.to]) add(links, end, node.id)
    if (node.parent !== null) add(children, node.parent, node.id)
    const used = node.type === 'instance' ? node.component : null
    if (used !== null) add(instances, used, node.id)
    if (node.type === 'page') pages++
  }
  const along = (id: string) => {
    const type = d.nodes[id]?.type
    const users = type === 'component' ? (instances.get(id) ?? []) : []
    return [...(children.get(id) ?? []), ...(links.get(id) ?? []), ...users]
  }
  return { along, pages }
}

/**
 * Removes nodes as `remove_node` operations one after the other would: each with everything
 * inside it however deeply, a component with its instances, and an object with its links. Naming a node that an earlier one
 * of them took along is an error, as it would be one at a time.
 */
function removeNodes(d: Document, ids: string[]): void {
  const { along, pages: count } = removal(d)
  let pages = count
  const doomed = new Set<string>()
  for (const id of ids) {
    const node = d.nodes[id]
    if (!node || doomed.has(id)) throw new OpError(`Unknown node "${id}"`)
    if (node.type === 'page' && pages-- === 1) throw new OpError('Cannot remove the last page')
    for (const queue = [id]; queue.length > 0; ) {
      const next = queue.pop()!
      if (doomed.has(next)) continue
      doomed.add(next)
      queue.push(...along(next))
    }
  }
  for (const id of doomed) delete d.nodes[id]
}

/**
 * The `remove_node` operations that delete the given nodes, leaving out those another of them takes
 * along (a view with its view line, an object inside a group, a link with what it joins), which
 * named again would be an error. Unknown ids are left out too.
 */
export function removeOps(doc: Document, ids: Iterable<string>): Op[] {
  const wanted = [...new Set(ids)].filter((id) => doc.nodes[id])
  const { along } = removal(doc)
  const taken = new Set<string>()
  const seen = new Set<string>()
  for (const id of wanted) {
    if (taken.has(id)) continue
    seen.add(id)
    for (const queue = along(id); queue.length > 0; ) {
      const next = queue.pop()!
      if (next === id) continue
      taken.add(next)
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(...along(next))
    }
  }
  return wanted.filter((id) => !taken.has(id)).map((id): Op => ({ op: 'remove_node', id }))
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
  // A view holds what is drawn on it, annotations, in its own coordinates; what is of the plan goes on the plan.
  if (node.parent !== null && d.nodes[node.parent]?.type === 'elevation' && !VIEW_CONTENTS.includes(node.type)) {
    throw new OpError(`Node ${node.id}: a ${node.type} cannot go in an elevation or section, which holds what is drawn on it (${VIEW_CONTENTS.join(', ')}); put it on the plan`)
  }
  // A view's automatic dimensions are its own: they go in a view only.
  if (node.type === 'autodimensions' && (node.parent === null || d.nodes[node.parent]?.type !== 'elevation')) throw new OpError(`Node ${node.id}: automatic dimensions go in an elevation or section (their parent), which they dimension`)
  if (node.type === 'autodimensions' && node.dimensionStyle !== undefined && !d.dimensionStyles?.[node.dimensionStyle]) throw new OpError(`Unknown dimension style "${node.dimensionStyle}"`)
  // A viewpoint looks at the plan of its page, where its view is shown: inside a component it would see nothing and show nowhere.
  if (node.type === 'camera' && root.type === 'component') throw new OpError(`Node ${node.id}: a viewpoint goes on a page, not in a component: it looks at the plan of its page`)
  // A sun shades the plan of its page, where its north is: inside a component it would have neither.
  if (node.type === 'sun' && root.type === 'component') throw new OpError(`Node ${node.id}: a sun goes on a page, not in a component: it lights the plan of its page`)
  if (node.layer !== undefined && root.type === 'component') {
    throw new OpError(`Node ${node.id}: what is inside a component has no layer, each placement of the component giving its own. Leave "layer" out.`)
  }
  if (node.type === 'instance' && node.style !== undefined) {
    throw new OpError(`Node ${node.id}: an instance has no style; it looks as its component is drawn. Change the shapes inside the component, or put the instance on a layer of another colour.`)
  }
  if (node.type === 'image' && !d.assets?.[node.asset]) throw new OpError(`Unknown asset "${node.asset}"`)
  if (node.type === 'camera' && node.picture !== undefined && !d.assets?.[node.picture]) throw new OpError(`Unknown asset "${node.picture}"`)
  if (node.type === 'dimension' && node.dimensionStyle !== undefined && !d.dimensionStyles?.[node.dimensionStyle]) throw new OpError(`Unknown dimension style "${node.dimensionStyle}"`)
  if (node.type === 'room' && node.material !== undefined && !d.materials?.[node.material]) throw new OpError(`Unknown material "${node.material}"`)
  if (node.type === 'wall' && node.material !== undefined && !d.materials?.[node.material]) throw new OpError(`Wall ${node.id}: unknown material "${node.material}"`)
  if ((node.type === 'elevation' || node.type === 'camera') && node.page !== undefined && d.nodes[node.page]?.type !== 'page') throw new OpError(`Node ${node.id}: "page" is "${node.page}", which is not a page of the drawing; leave it out for a view of the plan of the page it is on`)
  if (node.type === 'link') checkLink(d, node, root.id)
  if (node.type === 'instance') {
    if (d.nodes[node.component]?.type !== 'component') throw new OpError(`Unknown component "${node.component}"`)
    if (root.type === 'component' && componentUses(d, node.component, root.id)) {
      throw new OpError('A component cannot contain an instance of itself')
    }
  }
}

/** A link joins two different objects that are there, on the page or in the component it is on. */
function checkLink(d: Document, link: NodeOf<'link'>, root: string): void {
  if (link.from === link.to) throw new OpError(`Link ${link.id}: "from" and "to" are the same object; a link joins two`)
  for (const end of [link.from, link.to]) {
    const node = d.nodes[end]
    if (!linkable(node)) throw new OpError(`Link ${link.id}: "${end}" is not an object of the drawing that can be linked (a page, a component, a group or a link cannot)`)
    if (rootOf(d, node.parent)?.id !== root) throw new OpError(`Link ${link.id}: "${end}" is on another page or component; a link joins objects of the one it is on`)
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
      // Settings saved with it draw on the layer in use after.
      if (d.presets) d.presets = withoutPresetRef(d.presets, 'layer', op.id)
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
      // Settings saved with it draw walls of the default material after, as its walls are.
      if (d.presets) d.presets = withoutPresetRef(d.presets, 'material', op.id)
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
    case 'add_preset': {
      const id = op.preset.id ?? newId('preset')
      if (d.presets?.[id]) throw new OpError(`Saved settings "${id}" already exist`)
      d.presets = { ...d.presets, [id]: parse(PresetSchema, { ...op.preset, id }, 'saved settings') }
      return
    }
    case 'update_preset': {
      const preset = d.presets?.[op.id]
      if (!preset) throw new OpError(`Unknown saved settings "${op.id}"`)
      d.presets = { ...d.presets, [op.id]: parse(PresetSchema, merge(preset, op.patch, ['id']), 'saved settings') }
      return
    }
    case 'remove_preset': {
      if (!d.presets?.[op.id]) throw new OpError(`Unknown saved settings "${op.id}"`)
      const { [op.id]: _, ...rest } = d.presets
      d.presets = rest
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
        const settings: Record<string, unknown> = { ...d.settings }
        for (const [key, value] of Object.entries(op.settings)) {
          if (key === 'titleBlock') {
            const block = value === null || value === undefined ? {} : titleLayout(value)
            if (Object.keys(block).length > 0) settings[key] = block
            else delete settings[key]
            continue
          }
          if (key === 'grid') {
            if (value === null || value === undefined) delete settings[key]
            else settings[key] = gridSetting(value)
            continue
          }
          if (key === 'site') {
            if (value === null || value === undefined) delete settings[key]
            else settings[key] = siteSetting(value)
            continue
          }
          const allowed = key === 'system' ? ['metric', 'imperial'] : key === 'decimal' ? ['.', ','] : null
          if (!allowed) throw new OpError(`Unknown drawing setting "${key}". Use system, decimal, titleBlock, grid or site.`)
          if (value === null || value === undefined) delete settings[key]
          else if (typeof value !== 'string' || !allowed.includes(value)) throw new OpError(`The setting "${key}" is ${allowed.map((one) => `"${one}"`).join(' or ')}, not "${String(value)}".`)
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
      case 'add_preset':
        report(`new saved settings "${op.preset.name}"`, check(PresetSchema, { id: 'new', ...op.preset }))
        break
      case 'update_preset':
        if (doc.presets?.[op.id]) report(`saved settings "${op.id}"`, check(PresetSchema, patched(doc.presets[op.id], op.patch), Object.keys(op.patch)))
        break
      case 'update_material':
        if (doc.materials?.[op.id]) report(`material "${op.id}"`, check(MaterialSchema, patched(doc.materials[op.id], op.patch), Object.keys(op.patch)))
        break
    }
  }
  return out
}
