import { colorRefsIn } from './colors'
import { childrenOf, componentUses, componentsOf, layerIn, layersOf, leavesOf, newId, ordersAt, rootOf } from './document'
import { cloneOps } from './groups'
import { moveOps, nodePrimitives } from './kinds'
import { applyOps, OpError, type NodeInput, type Op } from './ops'
import type { Registry } from './registry'
import { boundsOf } from './scene'
import type { Document, Node } from './schema'
import { transformOps } from './transform'
import { placedShapes, primitiveNodes } from './vectorize'

/**
 * Turns nodes into a component and leaves an instance in their place. The component's origin
 * (the instance insertion point) is the top-left corner of the nodes' bounds. Returns the new
 * document and the operations that make it.
 */
export function createComponent(
  doc: Document,
  registry: Registry,
  nodeIds: string[],
  name: string,
): { doc: Document; ops: Op[]; componentId: string; instanceId: string } {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Select at least one object to create a component')
  const nodes = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))
  if (nodes.length !== picked.size) throw new OpError('Objects of a component must all be on the same page')

  const ctx = { doc, registry, depth: 0 }
  const bounds = boundsOf(nodes.flatMap((n) => nodePrimitives(n, ctx)))
  const origin = bounds ? { x: bounds.minX, y: bounds.minY } : { x: 0, y: 0 }
  const back = { x: -origin.x, y: -origin.y }
  const componentId = newId('component')
  const instanceId = newId()
  // What goes into the component leaves its layer: the placement takes the first one, for all of it.
  const layer = layerIn(doc, first.parent, nodes.find((n) => n.layer !== undefined)?.layer)
  const inside = (n: Node): Node[] => childrenOf(doc, n.id).flatMap((child) => [child, ...inside(child)])
  const ops: Op[] = [
    { op: 'add_node', node: { type: 'component', id: componentId, name } },
    ...nodes.flatMap((n) => moveOps(doc, n, back)),
    ...nodes.map((n): Op => ({ op: 'update_node', id: n.id, patch: { parent: componentId, layer: null } })),
    ...nodes.flatMap(inside).flatMap((n): Op[] => (n.layer === undefined ? [] : [{ op: 'update_node', id: n.id, patch: { layer: null } }])),
    {
      op: 'add_node',
      node: {
        type: 'instance',
        id: instanceId,
        parent: first.parent,
        order: nodes[0].order,
        ...(layer ? { layer } : {}),
        component: componentId,
        x: origin.x,
        y: origin.y,
      },
    },
  ]
  return { doc: applyOps(doc, ops), ops, componentId, instanceId }
}

/**
 * How many placements each component has where the drawing shows them: on a page, or inside a
 * component that is itself placed so (what is on every sheet counting as shown). Each placement
 * counts once: placed twice in a table, a chair counts two however many tables there are. A
 * component placed only inside unused ones counts none: deleting those would leave it unused too.
 */
export function componentPlacements(doc: Document): Map<string, number> {
  const inside = new Map<string, string[]>()
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'instance') continue
    const root = rootOf(doc, node.parent)
    if (root) inside.set(root.id, [...(inside.get(root.id) ?? []), node.component])
  }
  const counts = new Map<string, number>()
  const shown = Object.values(doc.nodes).filter((n) => n.parent === null && (n.type === 'page' || (n.type === 'component' && n.sheet !== undefined))).map((n) => n.id)
  // Each root once: a component reached again only adds to its count, not to what it reaches.
  const seen = new Set(shown)
  for (let i = 0; i < shown.length; i++) {
    for (const component of inside.get(shown[i]) ?? []) {
      counts.set(component, (counts.get(component) ?? 0) + 1)
      if (!seen.has(component)) {
        seen.add(component)
        shown.push(component)
      }
    }
  }
  return counts
}

/** The components the drawing does not show anywhere (`componentPlacements`), what is on every sheet aside. */
export function unusedComponents(doc: Document): string[] {
  const counts = componentPlacements(doc)
  return componentsOf(doc)
    .filter((c) => c.sheet === undefined && !counts.get(c.id))
    .map((c) => c.id)
}

/**
 * Puts copies of what a component holds in the place of one of its instances, where the instance
 * drew them: they become objects of the drawing, which editing the component no longer changes.
 * They take the instance's place in the stacking order and its layer, whose colour they were drawn
 * in where the component gives none. An instance with modifiers leaves a group that keeps them, so
 * that the drawing looks the same. Returns the new document, the operations that make it, and the
 * ids of what took its place.
 */
export function detachInstance(doc: Document, instanceId: string, registry: Registry): { doc: Document; ops: Op[]; ids: string[] } {
  const instance = doc.nodes[instanceId]
  if (instance?.type !== 'instance' || instance.parent === null) throw new OpError('Select a component to detach')
  const component = doc.nodes[instance.component]
  if (component?.type !== 'component') throw new OpError(`Component "${instance.component}" does not exist`)
  // Stretched, what it holds would no longer be what it is (a turned rectangle stretched is no
  // rectangle): its shapes are taken as they are drawn, as lines, shapes and texts in a group.
  if ((instance.scaleX ?? 1) !== 1 || (instance.scaleY ?? 1) !== 1) {
    const group = newId('group')
    const { name = component.name, layer, modifiers } = instance
    const own = { ...(name ? { name } : {}), ...(layer ? { layer } : {}), ...(modifiers ? { modifiers } : {}) }
    const ops: Op[] = [
      { op: 'add_node', node: { type: 'group', id: group, parent: instance.parent, order: instance.order, ...own } },
      ...primitiveNodes(placedShapes(doc, instance, registry), group, layer).map((node): Op => ({ op: 'add_node', node })),
      { op: 'remove_node', id: instanceId },
    ]
    return { doc: applyOps(doc, ops), ops, ids: [group] }
  }
  const parts = childrenOf(doc, component.id)
  const kept = (instance.modifiers?.length ?? 0) > 0
  const { layer } = instance
  // What a component holds is on no layer: the copies, groups and all, go on the instance's.
  const onLayer = (op: Op): Op => (layer !== undefined && op.op === 'add_node' ? { ...op, node: { ...op.node, layer } } : op)
  const ops: Op[] = []
  let into = instance.parent
  if (kept) {
    into = newId('group')
    const { name = component.name, modifiers } = instance
    ops.push({ op: 'add_node', node: { type: 'group', id: into, parent: instance.parent, order: instance.order, ...(name ? { name } : {}), ...(layer ? { layer } : {}), ...(modifiers ? { modifiers } : {}) } })
  }
  // Loose, the copies go where the instance was among its siblings; in a group they keep the component's order.
  const siblings = childrenOf(doc, instance.parent)
  const at = siblings.findIndex((n) => n.id === instanceId)
  const orders = kept ? [] : ordersAt(siblings.filter((n) => n.id !== instanceId), at, parts.length)
  const placement = { x: instance.x, y: instance.y }
  const copies = parts.map((part, i) => {
    const copy = cloneOps(doc, part.id, placement, into)
    ops.push(...copy.ops.map(onLayer), ...(kept ? [] : [{ op: 'update_node', id: copy.id, patch: { order: orders[i] } } as Op]))
    return copy.id
  })
  ops.push({ op: 'remove_node', id: instanceId })
  const moved = applyOps(doc, ops)
  // Moved by the insertion point, they are then turned, mirrored and sized about it, as the instance drew them.
  const turn = transformOps(moved, copies.map((id) => moved.nodes[id]), { pivot: placement, mirror: instance.flipX, rotation: instance.rotation, scale: instance.scale }, registry)
  return { doc: applyOps(moved, turn), ops: [...ops, ...turn], ids: kept ? [into] : copies }
}

/**
 * The operations that copy what is inside `from` (a page, component or group of `source`) into
 * `to` in `target`, with new ids, however deeply grouped. Pictures bring their files, walls and
 * floors their materials and dimensions their style, unless the target has one of that id already; nodes go to
 * the target layer with the same name as theirs, else to `fallbackLayer`, else to none, and to no
 * layer at all inside a component.
 * `components` maps the source's component ids to the target's, for the instances among them.
 * With `onTop`, the nodes copied directly into `to` go on top of what is there, in the order they
 * had among themselves, rather than at the places in the stacking order they had where they came from.
 * Returns the ids given to the nodes copied directly into `to`.
 */
export function transplantOps(
  target: Document,
  source: Document,
  from: string,
  to: string,
  options: {
    components: Record<string, string>
    only?: Set<string>
    fallbackLayer?: string
    onTop?: boolean
    /** Nodes that keep their id where they land, as the lines a clipboard refers to. */
    keep?: Set<string>
    /** The ids of the view lines, copied before, that the views copied here are of. */
    lines?: Map<string, string>
  },
): { ops: Op[]; top: string[]; ids: Map<string, string> } {
  const layerByName = new Map(layersOf(target).map((l) => [l.name, l.id]))
  const layered = rootOf(target, to)?.type !== 'component'
  const ops: Op[] = []
  const top: string[] = []
  const ids = new Map<string, string>()
  const copyInto = (parent: string, into: string, depth: number) => {
    for (const child of childrenOf(source, parent)) {
      if (depth === 0 && options.only && !options.only.has(child.id)) continue
      // A picture needs its file too. The asset keeps its id, so copying it twice adds it once.
      const asset = child.type === 'image' ? source.assets?.[child.asset] : undefined
      if (asset && !target.assets?.[asset.id] && !ops.some((o) => o.op === 'add_asset' && o.asset.id === asset.id)) {
        ops.push({ op: 'add_asset', asset })
      }
      // So does the dimension style it is drawn in, which keeps its id as well.
      const dimensionStyle = child.type === 'dimension' && child.dimensionStyle ? source.dimensionStyles?.[child.dimensionStyle] : undefined
      // So does the material of a wall or of a floor, which keeps its id too.
      const materials = [child.type === 'wall' || child.type === 'room' ? child.material : undefined].flatMap((id) => (id && source.materials?.[id] ? [source.materials[id]] : []))
      // So does a shared colour it, its style or its materials refer to, which also keeps its id.
      for (const id of colorRefsIn([child, dimensionStyle, materials])) {
        const color = source.colors?.[id]
        if (color && !target.colors?.[id] && !ops.some((o) => o.op === 'add_color' && o.color.id === id)) ops.push({ op: 'add_color', color })
      }
      for (const material of materials) {
        if (!target.materials?.[material.id] && !ops.some((o) => o.op === 'add_material' && o.material.id === material.id)) ops.push({ op: 'add_material', material })
      }
      if (dimensionStyle && !target.dimensionStyles?.[dimensionStyle.id] && !ops.some((o) => o.op === 'add_dimension_style' && o.dimensionStyle.id === dimensionStyle.id)) {
        ops.push({ op: 'add_dimension_style', dimensionStyle })
      }
      const sourceLayer = child.layer === undefined ? undefined : source.layers[child.layer]
      const layer = layered ? ((sourceLayer && layerByName.get(sourceLayer.name)) ?? options.fallbackLayer) : undefined
      const node = { ...child, id: options.keep?.has(child.id) ? child.id : newId(child.type === 'group' ? 'group' : 'n'), parent: into, layer }
      ids.set(child.id, node.id)
      if (node.layer === undefined) delete node.layer
      // Added without an order, each goes on top of the last: the children are taken bottom first.
      if (depth === 0 && options.onTop) delete (node as { order?: string }).order
      if (node.type === 'instance') {
        const component = options.components[node.component]
        if (!component) throw new OpError(`The component "${node.component}" was not copied`)
        node.component = component
      }
      ops.push({ op: 'add_node', node: node as NodeInput })
      if (depth === 0) top.push(node.id)
      if (child.type === 'group') copyInto(child.id, node.id, depth + 1)
    }
  }
  copyInto(from, to, 0)
  // A view is of the copy of its line, when its line was copied too, and comes after it, once it is there.
  const views: Op[] = []
  const rest: Op[] = []
  for (const op of ops) {
    if (op.op !== 'add_node' || op.node.type !== 'elevation') rest.push(op)
    else {
      const line = ids.get(op.node.line) ?? options.lines?.get(op.node.line)
      if (line) op.node.line = line
      views.push(op)
    }
  }
  return { ops: [...rest, ...views], top, ids }
}

/**
 * `name`, or, when a component of the drawing is called so already, `name` followed by the first
 * number from 2 that none is; `taken` adds names given in the same go.
 */
export function freeComponentName(doc: Document, name: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...componentsOf(doc).flatMap((c) => (c.name ? [c.name] : [])), ...taken])
  if (!used.has(name)) return name
  let n = 2
  while (used.has(`${name} ${n}`)) n++
  return `${name} ${n}`
}

/**
 * Copies components from another document. Any document can serve as a library. Components the
 * imported ones depend on come along, and a component the document already has is reused rather
 * than copied again: one of its own, or one brought in before from the same place. Each copy keeps
 * where it first came from (`meta.source`, "drawing#component"), however many documents it went
 * through on the way, so that a component copied to the clipboard and pasted back into its own
 * drawing is the same component, its new instances instances of it.
 * With `fresh`, every component comes in anew, as the source holds it, however many times it was
 * brought in before: a component of the document's own, which keeps no `meta.source`, so that
 * nothing takes it for another. Libraries, and drawings whose components are taken, are imported
 * that way; a paste is not.
 * Returns the new document, the operations that make it, and a map from source component id to
 * local component id.
 */
export function importComponents(
  doc: Document,
  source: Document,
  componentIds: string[] = componentsOf(source).map((c) => c.id),
  options: { fresh?: boolean } = {},
): { doc: Document; ops: Op[]; imported: Record<string, string> } {
  const imported: Record<string, string> = {}
  // The components the document has, by where they come from: its own, and copies of others, in
  // the order they were added.
  const knownAs = new Map<string, string[]>()
  const know = (key: string, id: string) => knownAs.set(key, [...(knownAs.get(key) ?? []), id])
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== 'component') continue
    know(`${doc.id}#${n.id}`, n.id)
    if (typeof n.meta?.source === 'string') know(n.meta.source, n.id)
  }
  /** Where a component of the source first came from. */
  const origin = (component: Node, id: string) => (typeof component.meta?.source === 'string' ? component.meta.source : `${source.id}#${id}`)
  // Each component is applied as soon as it is described, so that the next one can refer to it.
  let result = doc
  const ops: Op[] = []

  const copy = (sourceId: string) => {
    if (imported[sourceId]) return
    const component = source.nodes[sourceId]
    if (component?.type !== 'component') throw new OpError(`"${sourceId}" is not a component of the library`)
    if (!options.fresh) {
      const known = [...(knownAs.get(origin(component, sourceId)) ?? []), ...(knownAs.get(`${source.id}#${sourceId}`) ?? [])]
      if (known.length > 0) {
        imported[sourceId] = known[0]
        return
      }
    }
    const id = newId('component')
    imported[sourceId] = id
    // Nested components first, so the instances copied below have something to point at.
    for (const leaf of leavesOf(source, sourceId)) if (leaf.type === 'instance') copy(leaf.component)
    const { id: _, order: __, parent: ___, meta, ...definition } = component
    const { source: ____, ...own } = meta ?? {}
    const where = options.fresh ? (Object.keys(own).length > 0 ? { meta: own } : {}) : { meta: { ...meta, source: origin(component, sourceId) } }
    const added: Op[] = [{ op: 'add_node', node: { ...definition, id, ...where } }]
    result = applyOps(result, added)
    const contents = transplantOps(result, source, sourceId, id, { components: imported }).ops
    result = applyOps(result, contents)
    ops.push(...added, ...contents)
  }

  for (const id of componentIds) copy(id)
  return { doc: result, ops, imported }
}

/** What a placement may be made a placement of: a component, or a parametric object of a kind with its parameters. */
export type PlacedModel = { kind: 'component'; id: string } | { kind: 'parametric'; id: string; props: Record<string, unknown> }

/**
 * The operations that make placements (instances of components, or parametric objects) placements
 * of `to` instead, each where it is, turned, mirrored and on its layer, in its place in the
 * stacking order: so that two components drawn twice over and used here and there become one, and
 * tables count them together. The placement is by the insertion point, as a block is replaced in
 * CAD programs. An instance made another component's keeps its scale and stretch, a parametric
 * object made another model takes its kind and parameters, and one made the other sort of thing
 * is replaced by a node of that sort with a new id. What would put a component inside itself is
 * left as it was: `skipped` says how many.
 */
export function replaceWithOps(doc: Document, ids: string[], to: PlacedModel): { ops: Op[]; skipped: number } {
  if (to.kind === 'component' && doc.nodes[to.id]?.type !== 'component') return { ops: [], skipped: 0 }
  const ops: Op[] = []
  let skipped = 0
  for (const id of ids) {
    const node = doc.nodes[id]
    if ((node?.type !== 'instance' && node?.type !== 'parametric') || node.parent === null) continue
    const root = rootOf(doc, node.parent)
    if (to.kind === 'component' && root?.type === 'component' && componentUses(doc, to.id, root.id)) {
      skipped++
      continue
    }
    if (node.type === 'instance' && to.kind === 'component') {
      if (node.component !== to.id) ops.push({ op: 'update_node', id, patch: { component: to.id } })
      continue
    }
    if (node.type === 'parametric' && to.kind === 'parametric') {
      ops.push({ op: 'update_node', id, patch: { kind: to.id, props: to.props } })
      continue
    }
    // The other sort of thing: a node of it in the same place.
    const kept = { parent: node.parent, order: node.order, x: node.x, y: node.y, ...(node.rotation ? { rotation: node.rotation } : {}), ...(node.flipX ? { flipX: true } : {}), ...(node.layer ? { layer: node.layer } : {}), ...(node.visible === false ? { visible: false } : {}), ...(node.locked ? { locked: true } : {}), ...(node.modifiers?.length ? { modifiers: node.modifiers } : {}) }
    const made = to.kind === 'component' ? { type: 'instance', component: to.id } : { type: 'parametric', kind: to.id, props: to.props }
    ops.push({ op: 'remove_node', id }, { op: 'add_node', node: { id: newId(), ...kept, ...made } as NodeInput })
  }
  return { ops, skipped }
}
