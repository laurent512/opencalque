import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { host } from './host'
import { FORMAT, FORMAT_VERSION, type ContainerNode, type Document, type DrawingSettings, type Layer, type Node } from './schema'

export function newId(prefix = 'n'): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = host.crypto.getRandomValues(new Uint8Array(10))
  return `${prefix}_${Array.from(bytes, (b) => alphabet[b % 36]).join('')}`
}

/** The first page and layer get fixed ids so scripts can target a fresh document without reading it. */
export function createDocument(name = 'Untitled'): Document {
  const order = generateKeyBetween(null, null)
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: newId('doc'),
    name,
    unit: 'mm',
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order } },
    nodes: { page_1: { id: 'page_1', type: 'page', name: 'Page 1', parent: null, order } },
  }
}

/** How a drawing writes its numbers, what it leaves out filled in: metric, with a decimal point. */
export const settingsOf = (doc: Pick<Document, 'settings'>): Required<DrawingSettings> => ({ system: doc.settings?.system ?? 'metric', decimal: doc.settings?.decimal ?? '.' })

export const isContainer = (node: Node): node is ContainerNode => node.type === 'page' || node.type === 'component'

/** Whether other nodes can have this node as their parent. */
export const holdsChildren = (node: Node): boolean => isContainer(node) || node.type === 'group'

const byOrder = <T extends { id: string; order: string }>(a: T, b: T) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1

// Documents are immutable, so the tree index of a `nodes` map never goes stale.
const indexCache = new WeakMap<Document['nodes'], Map<string | null, Node[]>>()

function treeIndex(doc: Document): Map<string | null, Node[]> {
  let index = indexCache.get(doc.nodes)
  if (!index) {
    index = new Map()
    for (const node of Object.values(doc.nodes)) {
      const list = index.get(node.parent)
      if (list) list.push(node)
      else index.set(node.parent, [node])
    }
    for (const list of index.values()) list.sort(byOrder)
    indexCache.set(doc.nodes, index)
  }
  return index
}

/** Children of a page or component, bottom to top. */
export function childrenOf(doc: Document, parentId: string): Node[] {
  return treeIndex(doc).get(parentId) ?? []
}

const roots = (doc: Document) => treeIndex(doc).get(null) ?? []
export const pagesOf = (doc: Document) => roots(doc).filter((n) => n.type === 'page')
export const componentsOf = (doc: Document) => roots(doc).filter((n) => n.type === 'component')
export const layersOf = (doc: Document): Layer[] => Object.values(doc.layers).sort(byOrder)

/** The page or component a node ultimately belongs to, through any groups. */
export function rootOf(doc: Document, id: string | null): ContainerNode | undefined {
  let node = id === null ? undefined : doc.nodes[id]
  // The guard stops a malformed document with a parent loop from hanging the walk.
  for (let hops = 0; node && !isContainer(node) && hops < 1000; hops++) node = node.parent === null ? undefined : doc.nodes[node.parent]
  return node && isContainer(node) ? node : undefined
}

/**
 * The layer for a node put in `parent`: `layer` on a page, none inside a component, whose content
 * is drawn on the layer of each of its placements.
 */
export function layerIn(doc: Document, parent: string | null, layer: string | undefined): string | undefined {
  return layer === undefined || rootOf(doc, parent)?.type === 'component' ? undefined : layer
}

const leafCache = new WeakMap<Document['nodes'], Map<string, Node[]>>()

/** Everything drawn inside a page or component, with groups opened up: the groups themselves are left out. */
export function leavesOf(doc: Document, rootId: string): Node[] {
  let cache = leafCache.get(doc.nodes)
  if (!cache) leafCache.set(doc.nodes, (cache = new Map()))
  let leaves = cache.get(rootId)
  if (!leaves) {
    const walk = (id: string): Node[] => childrenOf(doc, id).flatMap((n) => (n.type === 'group' ? walk(n.id) : [n]))
    cache.set(rootId, (leaves = walk(rootId)))
  }
  return leaves
}

/**
 * Whether a string is an order key that sorts and can be put between others: a key of the
 * fractional-indexing package, such as "a0" or "a1V". Anything else ("top", "1") would sort, but
 * nothing could ever be placed above or below it.
 */
export function isOrderKey(key: string): boolean {
  if (!/^[A-Za-z][0-9A-Za-z]*$/.test(key)) return false
  try {
    generateKeyBetween(key, null)
    return true
  } catch {
    return false
  }
}

/** An order key between two neighbours; null stands for "before the first" or "after the last". */
export const orderBetween = (below: string | null, above: string | null): string => generateKeyBetween(below, above)

/**
 * `count` order keys for nodes put at index `at` among `siblings` (in their order, without those
 * nodes), so that they sort after the one below and before the one above. Siblings may share a
 * key (two people adding at once, a drawing of an older version), and nothing goes between two
 * that do: then the keys keep to the side of the neighbour named by `beside` ('below' by default,
 * just above it; 'above', just under it) and go past the others that share its key.
 */
export function ordersAt(siblings: readonly { order: string }[], at: number, count: number, beside: 'below' | 'above' = 'below'): string[] {
  let below: string | null = siblings[at - 1]?.order ?? null
  let above: string | null = siblings[at]?.order ?? null
  if (below !== null && above !== null && above <= below) {
    const tied = below
    if (beside === 'below') above = siblings.slice(at).find((n) => n.order > tied)?.order ?? null
    else below = siblings.slice(0, at).findLast((n) => n.order < tied)?.order ?? null
  }
  return generateNKeysBetween(below, above, count)
}

/** An order key that sorts after every key in `orders`. */
export function orderAfter(orders: Iterable<string>): string {
  let last: string | null = null
  for (const o of orders) if (last === null || o > last) last = o
  return generateKeyBetween(last, null)
}

/** An order key that sorts before every key in `orders`. */
export function orderBefore(orders: Iterable<string>): string {
  let first: string | null = null
  for (const o of orders) if (first === null || o < first) first = o
  return generateKeyBetween(null, first)
}

export function isVisible(doc: Document, node: Node): boolean {
  return node.visible !== false && (node.layer === undefined || doc.layers[node.layer]?.visible !== false)
}

export function isLocked(doc: Document, node: Node): boolean {
  return node.locked === true || (node.layer !== undefined && doc.layers[node.layer]?.locked === true)
}

/** Whether component `from` draws component `target`, directly or through nested instances. */
export function componentUses(doc: Document, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true
  if (seen.has(from)) return false
  seen.add(from)
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'instance' && rootOf(doc, node.parent)?.id === from && componentUses(doc, node.component, target, seen)) return true
  }
  return false
}

/** Structural problems that the schema alone cannot express. Empty when the document is sound. */
export function checkIntegrity(doc: Document): string[] {
  const problems: string[] = []
  for (const [key, layer] of Object.entries(doc.layers)) {
    if (layer.id !== key) problems.push(`Layer key "${key}" does not match its id "${layer.id}"`)
    if (!isOrderKey(layer.order)) problems.push(`Layer ${key}: "${layer.order}" is not an order key`)
  }
  for (const map of ['colors', 'dimensionStyles', 'materials', 'assets'] as const) {
    for (const [key, entry] of Object.entries(doc[map] ?? {})) if (entry.id !== key) problems.push(`${map} key "${key}" does not match its id "${entry.id}"`)
  }
  if (Object.keys(doc.layers).length === 0) problems.push('Document has no layer')
  if (!Object.values(doc.nodes).some((n) => n.type === 'page')) problems.push('Document has no page')
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (node.id !== key) problems.push(`Node key "${key}" does not match its id "${node.id}"`)
    if (!isOrderKey(node.order)) problems.push(`Node ${key}: "${node.order}" is not an order key`)
    if (node.layer !== undefined && !doc.layers[node.layer]) problems.push(`Node ${key}: unknown layer "${node.layer}"`)
    if (node.type === 'wall' && node.material !== undefined && !doc.materials?.[node.material]) problems.push(`Node ${key}: unknown material "${node.material}"`)
    if (node.type === 'dimension' && node.dimensionStyle !== undefined && !doc.dimensionStyles?.[node.dimensionStyle]) problems.push(`Node ${key}: unknown dimension style "${node.dimensionStyle}"`)
    if (node.type === 'room' && node.material !== undefined && !doc.materials?.[node.material]) problems.push(`Node ${key}: unknown material "${node.material}"`)
    if (isContainer(node)) {
      if (node.parent !== null) problems.push(`Node ${key}: a ${node.type} cannot have a parent`)
      continue
    }
    const parent = node.parent === null ? undefined : doc.nodes[node.parent]
    if (!parent || !holdsChildren(parent)) problems.push(`Node ${key}: parent must be an existing page, component or group`)
    else if (!rootOf(doc, node.parent)) problems.push(`Node ${key}: is not inside any page or component`)
    if (node.layer !== undefined && rootOf(doc, node.parent)?.type === 'component') problems.push(`Node ${key}: is inside a component and has a layer`)
    if (node.type === 'instance' && node.style !== undefined) problems.push(`Node ${key}: an instance has a style`)
    if (node.type === 'image' && !doc.assets?.[node.asset]) problems.push(`Node ${key}: unknown asset "${node.asset}"`)
    if (node.type === 'instance') {
      const component = doc.nodes[node.component]
      if (component?.type !== 'component') problems.push(`Node ${key}: unknown component "${node.component}"`)
      else if (rootOf(doc, node.parent)?.type === 'component' && componentUses(doc, node.component, rootOf(doc, node.parent)!.id)) {
        problems.push(`Node ${key}: a component contains itself`)
      }
    }
  }
  return problems
}

/** The document without its embedded files: everything a reader of the drawing needs, at a fraction of the size. */
export function withoutAssets(doc: Document): Document {
  const { assets: _, ...rest } = doc
  return rest
}

/** Assets no image refers to any more are left out, so deleting a picture shrinks the file. */
export function serializeDocument(doc: Document): string {
  const used = new Set(Object.values(doc.nodes).flatMap((n) => (n.type === 'image' ? [n.asset] : [])))
  const assets = Object.fromEntries(Object.entries(doc.assets ?? {}).filter(([id]) => used.has(id)))
  const { assets: _, ...rest } = doc
  return JSON.stringify(used.size > 0 ? { ...rest, assets } : rest, null, 2) + '\n'
}
