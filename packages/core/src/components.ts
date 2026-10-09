import { colorRefsIn } from './colors'
import { childrenOf, componentsOf, layersOf, leavesOf, newId } from './document'
import { moveOps, nodePrimitives } from './kinds'
import { applyOps, OpError, type NodeInput, type Op } from './ops'
import type { Registry } from './registry'
import { boundsOf } from './scene'
import type { Document } from './schema'

/**
 * Turns nodes into a component and leaves an instance in their place. The component's origin
 * (the instance insertion point) is the top-left corner of the nodes' bounds.
 */
export function createComponent(
  doc: Document,
  registry: Registry,
  nodeIds: string[],
  name: string,
): { doc: Document; componentId: string; instanceId: string } {
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
  const ops: Op[] = [
    { op: 'add_node', node: { type: 'component', id: componentId, name } },
    ...nodes.flatMap((n) => moveOps(doc, n, back)),
    ...nodes.map((n): Op => ({ op: 'update_node', id: n.id, patch: { parent: componentId } })),
    {
      op: 'add_node',
      node: {
        type: 'instance',
        id: instanceId,
        parent: first.parent,
        order: nodes[0].order,
        layer: nodes[0].layer,
        component: componentId,
        x: origin.x,
        y: origin.y,
      },
    },
  ]
  return { doc: applyOps(doc, ops), componentId, instanceId }
}

/**
 * The operations that copy what is inside `from` (a page, component or group of `source`) into
 * `to` in `target`, with new ids, however deeply grouped. Pictures bring their files; nodes go to
 * the target layer with the same name as theirs, else to `fallbackLayer`, else to none.
 * `components` maps the source's component ids to the target's, for the instances among them.
 * Returns the ids given to the nodes copied directly into `to`.
 */
export function transplantOps(
  target: Document,
  source: Document,
  from: string,
  to: string,
  options: { components: Record<string, string>; only?: Set<string>; fallbackLayer?: string },
): { ops: Op[]; top: string[] } {
  const layerByName = new Map(layersOf(target).map((l) => [l.name, l.id]))
  const ops: Op[] = []
  const top: string[] = []
  const copyInto = (parent: string, into: string, depth: number) => {
    for (const child of childrenOf(source, parent)) {
      if (depth === 0 && options.only && !options.only.has(child.id)) continue
      // A picture needs its file too. The asset keeps its id, so copying it twice adds it once.
      const asset = child.type === 'image' ? source.assets?.[child.asset] : undefined
      if (asset && !target.assets?.[asset.id] && !ops.some((o) => o.op === 'add_asset' && o.asset.id === asset.id)) {
        ops.push({ op: 'add_asset', asset })
      }
      // So does a shared colour it refers to, which also keeps its id.
      for (const id of colorRefsIn(child)) {
        const color = source.colors?.[id]
        if (color && !target.colors?.[id] && !ops.some((o) => o.op === 'add_color' && o.color.id === id)) ops.push({ op: 'add_color', color })
      }
      const sourceLayer = child.layer === undefined ? undefined : source.layers[child.layer]
      const layer = (sourceLayer && layerByName.get(sourceLayer.name)) ?? options.fallbackLayer
      const node = { ...child, id: newId(child.type === 'group' ? 'group' : 'n'), parent: into, layer }
      if (node.layer === undefined) delete node.layer
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
  return { ops, top }
}

/**
 * Copies components from another document. Any document can serve as a library. Components the
 * imported ones depend on come along, and re-importing the same component reuses the earlier copy.
 * Returns the new document and a map from source component id to local component id.
 */
export function importComponents(
  doc: Document,
  source: Document,
  componentIds: string[] = componentsOf(source).map((c) => c.id),
): { doc: Document; imported: Record<string, string> } {
  const imported: Record<string, string> = {}
  for (const n of Object.values(doc.nodes)) {
    if (n.type === 'component' && typeof n.meta?.source === 'string') {
      const [docId, componentId] = n.meta.source.split('#')
      if (docId === source.id) imported[componentId] = n.id
    }
  }
  // Each component is applied as soon as it is described, so that the next one can refer to it.
  let result = doc

  const copy = (sourceId: string) => {
    if (imported[sourceId]) return
    const component = source.nodes[sourceId]
    if (component?.type !== 'component') throw new OpError(`"${sourceId}" is not a component of the library`)
    const id = newId('component')
    imported[sourceId] = id
    // Nested components first, so the instances copied below have something to point at.
    for (const leaf of leavesOf(source, sourceId)) if (leaf.type === 'instance') copy(leaf.component)
    const { id: _, order: __, parent: ___, ...definition } = component
    result = applyOps(result, [{ op: 'add_node', node: { ...definition, id, meta: { ...component.meta, source: `${source.id}#${sourceId}` } } }])
    result = applyOps(result, transplantOps(result, source, sourceId, id, { components: imported }).ops)
  }

  for (const id of componentIds) copy(id)
  return { doc: result, imported }
}
