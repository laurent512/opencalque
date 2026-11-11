import { generateNKeysBetween } from 'fractional-indexing'
import { checkIntegrity, componentUses, holdsChildren, isContainer, isOrderKey, newId, orderAfter, rootOf } from './document'
import type { Document, Layer, Node } from './schema'

const byOrder = <T extends { id: string; order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1)

/**
 * Puts right what would otherwise make a drawing impossible to open or to edit, and says what it
 * changed, one line each. A drawing written by hand, by a script or by another program can refer
 * to a layer, a material or a parent that is not there, or give an order that cannot be sorted
 * between; refusing it would lose the whole drawing for one slip, and opening it as it is would
 * make every later edit fail. What can be kept is kept: a node whose parent is missing goes onto
 * the first page, a reference to a missing type or style is dropped. Only what cannot be drawn at
 * all is removed: a picture whose file is missing, a component placement whose component is gone.
 */
export function repairDocument(input: Document): { doc: Document; repairs: string[] } {
  const repairs: string[] = []
  const doc: Document = { ...input, layers: { ...input.layers }, nodes: { ...input.nodes } }
  const nodes = doc.nodes
  const set = (node: Node) => (nodes[node.id] = node)

  // Every entry is filed under its own id.
  for (const [key, layer] of Object.entries(doc.layers)) {
    if (layer.id === key) continue
    doc.layers[key] = { ...layer, id: key }
    repairs.push(`Layer "${key}" gave "${layer.id}" as its id; it now has its key as id.`)
  }
  for (const map of ['colors', 'dimensionStyles', 'materials', 'assets'] as const) {
    const entries = doc[map]
    if (!entries || Object.entries(entries).every(([key, entry]) => entry.id === key)) continue
    doc[map] = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, { ...entry, id: key }])) as never
    repairs.push(`Some entries of "${map}" gave an id other than their key; they now have their key as id.`)
  }
  for (const [key, node] of Object.entries(nodes)) {
    if (node.id === key) continue
    nodes[key] = { ...node, id: key }
    repairs.push(`Node "${key}" gave "${node.id}" as its id; it now has its key as id.`)
  }

  // Pages and components stand on their own.
  for (const node of Object.values(nodes)) {
    if (isContainer(node) && node.parent !== null) {
      set({ ...node, parent: null })
      repairs.push(`The ${node.type} "${node.id}" had a parent; a ${node.type} has none.`)
    }
  }

  if (Object.keys(doc.layers).length === 0) {
    doc.layers.layer_1 = { id: 'layer_1', name: 'Layer 1', order: 'a0' }
    repairs.push('The drawing had no layer; one was added.')
  }

  // Orders that cannot be sorted between: the siblings that have one are given new keys, in the order they had.
  const layers = Object.values(doc.layers)
  if (layers.some((layer) => !isOrderKey(layer.order))) {
    const sorted = [...layers].sort(byOrder)
    const keys = generateNKeysBetween(null, null, sorted.length)
    sorted.forEach((layer: Layer, i) => (doc.layers[layer.id] = { ...layer, order: keys[i] }))
    repairs.push('Some layers had an order that is not an order key; the layers were given new ones, in the same order.')
  }
  const siblings = new Map<string | null, Node[]>()
  for (const node of Object.values(nodes)) {
    const list = siblings.get(node.parent)
    if (list) list.push(node)
    else siblings.set(node.parent, [node])
  }
  for (const [parent, list] of siblings) {
    if (list.every((node) => isOrderKey(node.order))) continue
    const keys = generateNKeysBetween(null, null, list.length)
    list.sort(byOrder).forEach((node, i) => set({ ...node, order: keys[i] }))
    repairs.push(`Some nodes ${parent === null ? 'among the pages and components' : `in "${parent}"`} had an order that is not an order key; they were given new ones, in the same order.`)
  }

  if (!Object.values(nodes).some((node) => node.type === 'page')) {
    const id = nodes.page_1 ? newId('page') : 'page_1'
    const roots = Object.values(nodes).filter((node) => node.parent === null)
    set({ id, type: 'page', name: 'Page 1', parent: null, order: orderAfter(roots.map((node) => node.order)) })
    repairs.push('The drawing had no page; one was added.')
  }
  const firstPage = Object.values(nodes)
    .filter((node) => node.type === 'page')
    .sort(byOrder)[0]

  for (const node of Object.values(nodes)) {
    if (node.layer !== undefined && !doc.layers[node.layer]) {
      const { layer: _, ...rest } = node
      set(rest as Node)
      repairs.push(`Node "${node.id}" was on layer "${node.layer}", which does not exist; it is now on no layer.`)
    }
  }

  // A node that is not inside any page or component, through a missing parent, a parent that holds
  // nothing, or groups inside one another in a loop, goes on top of the first page.
  for (let moved = true; moved; ) {
    moved = false
    for (const node of Object.values(nodes)) {
      if (isContainer(node)) continue
      const parent = node.parent === null ? undefined : nodes[node.parent]
      if (parent && holdsChildren(parent) && rootOf(doc, node.parent)) continue
      const onPage = Object.values(nodes).filter((n) => n.parent === firstPage.id)
      set({ ...node, parent: firstPage.id, order: orderAfter(onPage.map((n) => n.order)) })
      const why = !parent ? 'does not exist' : !holdsChildren(parent) ? 'cannot hold anything' : 'is not inside any page or component'
      repairs.push(`Node "${node.id}" was inside "${node.parent}", which ${why}; it was put on the page "${firstPage.id}".`)
      moved = true
    }
  }

  // What a component holds is on no layer, each placement giving its own, and a placement has no
  // look of its own. A drawing of version 1 is brought there by its migration; this is for one
  // written otherwise.
  for (const { id } of Object.values(nodes)) {
    const node = nodes[id]
    if (node.layer !== undefined && !isContainer(node) && rootOf(doc, node.parent)?.type === 'component') {
      const { layer: _, ...rest } = node
      set(rest as Node)
      repairs.push(`Node "${id}" is inside a component and was on layer "${node.layer}"; what a component holds is on no layer, and is drawn on the layer of each placement.`)
    }
    const now = nodes[id]
    if (now.type === 'instance' && now.style !== undefined) {
      const { style: _, ...rest } = now
      set(rest)
      repairs.push(`Component placement "${id}" had a style of its own, which was taken off: a placement looks as its component is drawn.`)
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type === 'room' && node.material !== undefined && !doc.materials?.[node.material]) {
      const { material: _, ...rest } = node
      set(rest)
      repairs.push(`Room "${node.id}" had a floor of material "${node.material}", which does not exist; it keeps the look it gives itself.`)
    }
    if (node.type === 'wall' && node.material !== undefined && !doc.materials?.[node.material]) {
      const { material: _, ...rest } = node
      set(rest)
      repairs.push(`Wall "${node.id}" was of material "${node.material}", which does not exist; it is of the default material.`)
    }
    if (node.type === 'dimension' && node.dimensionStyle !== undefined && !doc.dimensionStyles?.[node.dimensionStyle]) {
      const { dimensionStyle: _, ...rest } = node
      set(rest)
      repairs.push(`Dimension "${node.id}" was in dimension style "${node.dimensionStyle}", which does not exist; it keeps the look it gives itself.`)
    }
    if (node.type === 'image' && !doc.assets?.[node.asset]) {
      delete nodes[node.id]
      repairs.push(`Picture "${node.id}" was removed: its file ("${node.asset}") is not in the drawing.`)
    }
    if (node.type === 'elevation' && nodes[node.line]?.type !== 'viewline') {
      delete nodes[node.id]
      repairs.push(`View "${node.id}" was removed: its line ("${node.line}") is not in the drawing.`)
    }
    if (node.type === 'instance' && nodes[node.component]?.type !== 'component') {
      delete nodes[node.id]
      repairs.push(`Component placement "${node.id}" was removed: its component ("${node.component}") is not in the drawing.`)
    }
  }
  // A component that would draw itself, through placements of others inside it, loses the placement that closes the loop.
  for (const node of Object.values(nodes)) {
    if (node.type !== 'instance') continue
    const root = rootOf(doc, node.parent)
    if (root?.type === 'component' && componentUses(doc, node.component, root.id)) {
      delete nodes[node.id]
      repairs.push(`Component placement "${node.id}" was removed: it made the component "${root.id}" contain itself.`)
    }
  }

  const problems = checkIntegrity(doc)
  if (problems.length > 0) throw new Error(`Not a valid OpenCalque document:\n${problems.join('\n')}`)
  return { doc: repairs.length > 0 ? doc : input, repairs }
}
