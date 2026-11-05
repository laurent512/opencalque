import { goTo } from './instances'
import { entryName, entryTarget, isModel, placementsOf } from '../entries'
import {
  alikeTo,
  applyOps,
  buildScene,
  childrenOf,
  cloneOps,
  componentsOf,
  createComponent,
  detachInstance,
  duplicatePageOps,
  groupNodes,
  modifierKind,
  moveOps,
  orderAfter,
  orderBefore,
  ordersAt,
  placeInOps,
  reorderOps,
  sceneBounds,
  transformOps,
  vectorizeOps,
  ungroupNode,
  unusedComponents,
  wallFollowOps,
  type Likeness,
  type Modifier,
  type Node,
  type Op,
  replaceWithOps,
} from '@opencalque/core'
import { registry } from '../extensions'
import { t, tn } from '../i18n'
import { showPage } from '../navigation'
import { apply, cancel, commit, layerHere, select, setTool, useStore } from '../store'
import { withoutFill } from '../materials'
import { gridStep } from '../view'
import { ask, toast } from '../windows'
import { withPaperContents } from './clipboard'
import { guarded } from './common'

/* What is done to the selection and to pages: delete, duplicate, transform, group, components, stacking order, alignment, styles. */

const get = useStore.getState

/**
 * The settings of the dimension tool, for the dimensions it draws next in this drawing: the style
 * among them only if this drawing has it, since the settings outlive the drawing they were made in.
 */
export function dimensionToolLook(): Record<string, unknown> {
  const { doc, dimensionTemplate } = get()
  const { dimensionStyle, ...look } = dimensionTemplate
  return typeof dimensionStyle === 'string' && doc.dimensionStyles?.[dimensionStyle] ? { ...look, dimensionStyle } : look
}

/**
 * Ends typing into a text. A text left empty is removed (or never added, when it was new), since
 * an empty text cannot be seen or clicked. Afterwards the text is selected with the select tool.
 */
export function finishTextEdit(): void {
  const { editingText, doc } = get()
  if (!editingText) return
  useStore.setState({ editingText: null })
  const node = doc.nodes[editingText.id]
  // A text with no words cannot be seen; an annotation with none is still an arrow, a grid line still a line.
  const empty = node?.type === 'annotation' || node?.type === 'gridline' ? false : node?.type !== 'text' || node.text.trim() === ''
  if (!empty) commit()
  else {
    cancel()
    if (!editingText.create && get().doc.nodes[editingText.id]) apply([{ op: 'remove_node', id: editingText.id }])
  }
  setTool('select')
  select(empty ? [] : [editingText.id])
}

export function deleteSelection(): void {
  apply(get().selection.map((id): Op => ({ op: 'remove_node', id })))
}

export function duplicateSelection(): void {
  const { doc, selection } = get()
  // A paper is duplicated with what is on it, beside the original rather than over it.
  const all = withPaperContents(selection)
  const papers = selection.map((id) => doc.nodes[id]).filter((node) => node?.type === 'paper')
  const d = papers.length > 0 ? { x: Math.max(...papers.map((p) => (p.type === 'paper' ? p.width : 0))) * 1.1, y: 0 } : { x: 200, y: 200 }
  const copies = all.map((id) => ({ of: id, ...cloneOps(doc, id, d) }))
  if (apply(copies.flatMap((copy) => copy.ops))) select(copies.filter((copy) => selection.includes(copy.of)).map((copy) => copy.id))
}

/**
 * Turns, mirrors or resizes the selection as one thing, about the middle of the box around it.
 * A paper takes what is on it along.
 */
export function transformSelection(change: { rotation?: number; mirror?: 'horizontal' | 'vertical'; scale?: number }): void {
  const { doc, scope, selection } = get()
  const box = sceneBounds(buildScene(doc, scope, registry).filter((item) => selection.includes(item.id)))
  if (!box || (change.scale !== undefined && !(change.scale > 0))) return
  const pivot = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const nodes = selection.map((id) => doc.nodes[id])
  // Top to bottom is left to right followed by a half turn.
  const rotation = (change.rotation ?? 0) + (change.mirror === 'vertical' ? 180 : 0)
  apply(transformOps(doc, nodes, { pivot, mirror: change.mirror !== undefined, rotation, scale: change.scale }, registry))
}

/**
 * Adds a modifier of the given kind to each selected object. One with a width and a height, such
 * as a crop, starts a little inside the selection, so that it is seen to do something; its corners
 * can then be dragged on the drawing.
 */
export function addModifier(type: string): void {
  const { doc, scope, selection } = get()
  const kind = modifierKind(registry, type)
  const box = sceneBounds(buildScene(doc, scope, registry).filter((item) => selection.includes(item.id)))
  if (!kind || !box) return
  const sized = kind.params.some((p) => p.key === 'width') && kind.params.some((p) => p.key === 'height')
  // A little inside the selection along its length; across something thin (a line), comfortably around it, so there are corners to drag.
  const longest = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1)
  const span = (min: number, max: number) => (max - min < longest * 0.2 ? { from: (min + max) / 2 - longest * 0.15, size: longest * 0.3 } : { from: min + (max - min) * 0.15, size: (max - min) * 0.7 })
  const across = span(box.minX, box.maxX)
  const down = span(box.minY, box.maxY)
  const added: Modifier = {
    type,
    frame: sized ? { x: across.from, y: down.from } : { x: box.minX, y: box.minY },
    // A repeat starts with steps that clear the object by a fifth of its size, rounded to a tidy length.
    params: sized ? { width: across.size, height: down.size } : type === 'array' ? { dx: Math.ceil(((box.maxX - box.minX) * 1.2) / 10) * 10 || 1000, dy: Math.ceil(((box.maxY - box.minY) * 1.2) / 10) * 10 || 1000 } : {},
  }
  apply(selection.map((id): Op => ({ op: 'update_node', id, patch: { modifiers: [...(doc.nodes[id].modifiers ?? []), added] } })))
}

/** The polylines and polygons among the selection. */
const selectedPolylines = () => {
  const { doc, selection } = get()
  return selection.flatMap((id) => {
    const node = doc.nodes[id]
    return node?.type === 'polyline' ? [node] : []
  })
}
export const canClosePolylines = () => selectedPolylines().some((n) => !n.closed && n.points.length >= 3)
export const canOpenPolylines = () => selectedPolylines().some((n) => n.closed)
export const canCurvePolylines = () => selectedPolylines().some((n) => !n.smooth)
export const canStraightenPolylines = () => selectedPolylines().some((n) => n.smooth)
/** Closes or opens the selected polylines, or curves or straightens them; null takes the property away. */
export function setPolylines(patch: { closed?: true | null; smooth?: true | null }): void {
  apply(selectedPolylines().map((n): Op => ({ op: 'update_node', id: n.id, patch })))
}

/** Makes a copy of a page, with what is on it, and shows the copy. */
export function duplicatePage(id: string): void {
  const { doc } = get()
  const page = doc.nodes[id]
  if (!page) return
  const copy = duplicatePageOps(doc, id, t('{name} (copy)', { name: page.name ?? '' }))
  if (apply(copy.ops)) showPage(copy.id)
}

/** The scene items of the selection, each with the box it takes up. */
function selectedBoxes() {
  const { doc, scope, selection } = get()
  return buildScene(doc, scope, registry).flatMap((item) => (selection.includes(item.id) && item.bounds ? [{ node: item.node, box: item.bounds }] : []))
}

/** The operations that move one selected object by `d`. */
const shift = (node: Node, d: { x: number; y: number }): Op[] => (d.x === 0 && d.y === 0 ? [] : moveOps(get().doc, node, d))

/** Lines the selected objects up on one side, or on the middle, of the box around them all. */
export function alignSelection(to: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const items = selectedBoxes()
  if (items.length < 2) return
  const all = sceneBounds(items.map((item) => ({ bounds: item.box }) as never))!
  apply(
    items.flatMap(({ node, box }) => {
      const dx = to === 'left' ? all.minX - box.minX : to === 'right' ? all.maxX - box.maxX : to === 'center' ? (all.minX + all.maxX - box.minX - box.maxX) / 2 : 0
      const dy = to === 'top' ? all.minY - box.minY : to === 'bottom' ? all.maxY - box.maxY : to === 'middle' ? (all.minY + all.maxY - box.minY - box.maxY) / 2 : 0
      return shift(node, { x: dx, y: dy })
    }),
  )
}

/** Spaces the selected objects evenly between the first and the last, which stay where they are. */
export function distributeSelection(along: 'x' | 'y'): void {
  const [min, max] = along === 'x' ? (['minX', 'maxX'] as const) : (['minY', 'maxY'] as const)
  const items = selectedBoxes().sort((p, q) => p.box[min] + p.box[max] - q.box[min] - q.box[max])
  if (items.length < 3) return
  // The same gap between each object and the next, whatever their sizes.
  const taken = items.reduce((sum, item) => sum + item.box[max] - item.box[min], 0)
  const gap = (items[items.length - 1].box[max] - items[0].box[min] - taken) / (items.length - 1)
  let at = items[0].box[min]
  apply(
    items.flatMap(({ node, box }) => {
      const d = at - box[min]
      at += box[max] - box[min] + gap
      return shift(node, along === 'x' ? { x: d, y: 0 } : { x: 0, y: d })
    }),
  )
}

/**
 * Takes the look of an object (colours, weight, dashes, fill). With objects selected they are given
 * it; with none, its line colour and fill become those of what is drawn next.
 */
/**
 * What the eyedropper gives `target` of the look of `source`: its style, and between walls, or
 * between rooms, its material. A wall, or a floor of a material, takes no fill of its own: its
 * material gives it.
 */
function lookFrom(source: Node, target: Node): Record<string, unknown> {
  const material = target.type === source.type && (target.type === 'wall' || target.type === 'room') ? { material: (source as { material?: string }).material ?? null } : {}
  const made = 'material' in material ? material.material : (target as { material?: string }).material
  const style = target.type === 'wall' || (target.type === 'room' && made) ? withoutFill(source.style) : source.style
  return { style: style ?? null, ...material }
}

export function pickStyle(source: Node): void {
  const { selection, doc } = get()
  // A placed component looks as its component does and takes no look of its own.
  const targets = selection.filter((id) => id !== source.id && doc.nodes[id]?.type !== 'instance')
  if (targets.length === 0 && selection.some((id) => doc.nodes[id]?.type === 'instance')) {
    toast(t('A component looks as it is drawn, in the colour of its layer: change the component, or put it on another layer.'))
  } else if (targets.length > 0) {
    if (apply(targets.map((id): Op => ({ op: 'update_node', id, patch: lookFrom(source, doc.nodes[id]) })))) toast(tn(targets.length, 'Style given to {n} object', 'Style given to {n} objects'))
  } else {
    // What the bar above the tools shows, which is what the next shapes take: the colour of their lines and their fill.
    useStore.setState({ drawColor: source.style?.stroke ?? null, drawFill: source.style?.fill ?? null, drawPattern: source.style?.pattern ?? null })
    toast(t('Style picked up: the next shapes you draw will have it'))
  }
  setTool('select')
}

/**
 * Adds to the selection what is alike to it in the way said (`alikeTo`), among what can be picked
 * where the editing is: the walls of one material and thickness, the placements of one component…
 */
export function selectAlike(by: Likeness): void {
  const { doc, scope, selection } = get()
  const chosen = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const pickable = buildScene(doc, scope, registry)
    .filter((item) => !item.locked)
    .map((item) => item.node)
  const found = alikeTo(chosen, pickable, by, registry).map((node) => node.id)
  const ids = [...new Set([...selection, ...found])]
  select(ids)
  toast(tn(ids.length, '{n} object selected', '{n} objects selected'))
}

/** Moves the selection by whole steps of the grid as it is shown; `dx` and `dy` count steps. */
export function nudgeSelection(dx: number, dy: number): void {
  const { doc, selection, view } = get()
  const step = gridStep(view.zoom)
  const d = { x: dx * step, y: dy * step }
  const nodes = selection.map((id) => doc.nodes[id])
  apply([...nodes.flatMap((node) => moveOps(doc, node, d)), ...wallFollowOps(doc, nodes, d, registry)])
}

export const groupSelection = () =>
  guarded(() => {
    const { doc, selection } = get()
    const result = groupNodes(doc, selection)
    if (apply(result.ops)) select([result.groupId])
  })

/**
 * Dissolves every selected group, and turns every selected component into objects of the drawing
 * that no longer follow it, leaving what was inside selected.
 */
export const ungroupSelection = () =>
  guarded(() => {
    let { doc } = get()
    const ops: Op[] = []
    const freed: string[] = []
    for (const id of get().selection) {
      const type = doc.nodes[id]?.type
      if (type === 'group') {
        const result = ungroupNode(doc, id)
        doc = result.doc
        ops.push(...result.ops)
        freed.push(...result.childIds)
      } else if (type === 'instance') {
        const result = detachInstance(doc, id, registry)
        doc = result.doc
        ops.push(...result.ops)
        freed.push(...result.ids)
      } else freed.push(id)
    }
    if (apply(ops)) select(freed)
  })

/**
 * Vectorizes the one selected parametric object: the shapes it draws become a group in its place,
 * to be edited one by one, over the white it was backed with (`vectorizeOps`).
 */
export const vectorizeSelection = () =>
  guarded(() => {
    const { doc, selection } = get()
    const node = doc.nodes[selection[0]]
    if (selection.length === 1 && node?.type === 'table') {
      const made = vectorizeOps(doc, node.id, registry, { group: t('Table of quantities'), backing: '' })
      if (!made || !apply(made.ops)) return
      select([made.id])
      return toast(t('Vectorized into a group of lines and texts. It no longer follows the drawing.'))
    }
    if (selection.length !== 1 || node?.type !== 'parametric') return
    const kind = registry.parametric.get(node.kind)
    const made = vectorizeOps(doc, node.id, registry, { group: kind ? t(kind.label) : node.kind, backing: t('White background') })
    if (!made || !apply(made.ops)) return
    select([made.id])
    toast(kind?.opening ? t('Vectorized into a group of its shapes. It no longer cuts the wall it is in.') : t('Vectorized into a group of its shapes.'))
  })

/**
 * Makes every placement of one entry of the Components panel (a component, or a model of
 * parametric objects) a placement of another, saying how many; a component left so is placed
 * nowhere any more, which it says too.
 */
export function replaceInstances(from: string, to: string): void {
  const { doc } = get()
  const target = entryTarget(doc, to)
  if (!target) return
  const { ops, skipped } = replaceWithOps(doc, placementsOf(doc, from).map((node) => node.id), target)
  const names = { from: entryName(doc, from), to: entryName(doc, to) }
  if (ops.length > 0 && !apply(ops)) return
  const replaced = placementsOf(doc, from).length - skipped
  const done = tn(replaced, 'One instance of “{from}” now places “{to}”.', '{n} instances of “{from}” now place “{to}”.', names)
  const kept = skipped > 0 ? ` ${tn(skipped, 'One inside “{to}” itself was kept.', '{n} inside “{to}” itself were kept.', names)}` : ''
  const left = skipped === 0 && !isModel(from) ? ` ${t('“{from}” is placed nowhere any more: delete it if it is not wanted.', names)}` : ''
  toast(`${done}${kept}${left}`)
}

/** Makes the selected placements placements of another entry, those that become another sort of thing selected again under their new ids. */
export function swapSelectedComponent(to: string): void {
  const { doc, selection } = get()
  const target = entryTarget(doc, to)
  if (!target) return
  const { ops, skipped } = replaceWithOps(doc, selection, target)
  if (ops.length > 0 && apply(ops)) {
    const added = ops.flatMap((op) => (op.op === 'add_node' ? [op.node.id as string] : []))
    select([...selection.filter((id) => get().doc.nodes[id]), ...added])
  }
  if (skipped > 0) toast(t('A component cannot hold itself: what is inside “{to}” was kept.', { to: entryName(doc, to) }))
}

/** Deletes an entry: a component with its placements, or every object of a model, once the user has said yes. */
export function deleteEntry(entry: string): void {
  if (!isModel(entry)) return deleteComponent(entry)
  const { doc } = get()
  const objects = placementsOf(doc, entry)
  if (objects.length === 0) return
  const name = entryName(doc, entry)
  ask({
    title: t('Delete them'),
    message: tn(objects.length, 'The one “{name}” in the drawing will be deleted.', 'The {n} “{name}” in the drawing will be deleted.', { name }),
    action: t('Delete'),
    run: () => apply(objects.map((node): Op => ({ op: 'remove_node', id: node.id }))),
  })
}

/**
 * Selects the objects of a model together, to be changed at once from the Properties panel: there
 * where most of them lie (a page, a group or a component), saying how many lie elsewhere.
 */
export function editModel(entry: string): void {
  const { doc } = get()
  const objects = placementsOf(doc, entry)
  if (objects.length === 0) return
  const by = new Map<string, string[]>()
  for (const node of objects) if (node.parent !== null) by.set(node.parent, [...(by.get(node.parent) ?? []), node.id])
  const [, most] = [...by.entries()].reduce((best, next) => (next[1].length > best[1].length ? next : best))
  if (!goTo(most[0])) return
  select(most)
  const elsewhere = objects.length - most.length
  if (elsewhere > 0) toast(tn(elsewhere, 'One more lies elsewhere: the eye beside it goes to it.', '{n} more lie elsewhere: the eye beside them goes to each.'))
}

export const makeComponent = () =>
  guarded(() => {
    const { doc, selection } = get()
    const name = t('Component {n}', { n: componentsOf(doc).length + 1 })
    const result = createComponent(doc, registry, selection, name)
    if (apply(result.ops)) select([result.instanceId])
  })

/** Deletes a component of the drawing and every placement of it, once the user has said yes. */
export function deleteComponent(id: string): void {
  const { doc } = get()
  const component = doc.nodes[id]
  if (component?.type !== 'component') return
  const name = component.name ?? id
  const placed = Object.values(doc.nodes).filter((node) => node.type === 'instance' && node.component === id).length
  ask({
    title: t('Delete component'),
    message:
      placed === 0
        ? t('“{name}” is placed nowhere in the drawing.', { name })
        : tn(placed, '“{name}” is placed once in the drawing, and that placement goes with it.', '“{name}” is placed {n} times in the drawing, and those placements go with it.', { name }),
    action: t('Delete'),
    run: () => apply([{ op: 'remove_node', id }]),
  })
}

/** Deletes the components the drawing shows nowhere (`unusedComponents`), once the user has said yes. */
export function deleteUnusedComponents(): void {
  const unused = unusedComponents(get().doc)
  if (unused.length === 0) return
  ask({
    title: t('Delete unused components'),
    message: tn(unused.length, '{n} component is placed nowhere in the drawing.', '{n} components are placed nowhere in the drawing.'),
    action: t('Delete'),
    run: () => apply(unused.map((id): Op => ({ op: 'remove_node', id }))),
  })
}

/**
 * Changes what the selection is drawn over: all the way to the front or back, or one step past
 * the next object in that direction. The selected objects keep their order among themselves.
 */
export function reorderSelection(to: 'front' | 'forward' | 'backward' | 'back'): void {
  const { scope, selection } = get()
  let { doc } = get()
  const ops: Op[] = []
  const up = to === 'front' || to === 'forward'
  // Bottom to top. Moving up starts with the topmost so one selected object never jumps another;
  // sending to the front or back is done in the order that keeps them as they were.
  const picked = childrenOf(doc, scope).filter((n) => selection.includes(n.id))
  const sequence = to === 'forward' || to === 'back' ? [...picked].reverse() : picked
  for (const node of sequence) {
    const siblings = childrenOf(doc, scope)
    const at = siblings.findIndex((n) => n.id === node.id)
    const neighbour = siblings[at + (up ? 1 : -1)]
    if (!neighbour || ((to === 'forward' || to === 'backward') && selection.includes(neighbour.id))) continue
    const order =
      to === 'front'
        ? orderAfter(siblings.map((n) => n.order))
        : to === 'back'
          ? orderBefore(siblings.map((n) => n.order))
          : // Just past its neighbour, among the others: above it going up, under it going down.
            ordersAt(
              siblings.filter((n) => n.id !== node.id),
              at + (up ? 1 : -1),
              1,
              up ? 'below' : 'above',
            )[0]
    // Each is placed among the others as they are once those before it have moved.
    const op: Op = { op: 'update_node', id: node.id, patch: { order } }
    doc = applyOps(doc, [op])
    ops.push(op)
  }
  apply(ops)
}

/**
 * Puts objects in a group, or next to an object wherever it is (in a group or not), from the
 * Structure list. What is selected afterwards is what can be selected where the selection is
 * made: the objects, if they are now among what is being edited; else the group they went into,
 * or the group holding it.
 */
export function placeIn(ids: string[], parent: string, target?: { id: string; after: boolean }): void {
  const { doc, scope } = get()
  const ops = placeInOps(doc, ids, parent, target)
  if (ops.length === 0 || !apply(ops)) return
  if (parent === scope) return select(ids)
  let outer = parent
  while (get().doc.nodes[outer]?.parent && get().doc.nodes[outer]!.parent !== scope) outer = get().doc.nodes[outer]!.parent!
  select(get().doc.nodes[outer]?.parent === scope ? [outer] : [])
}

/** Puts objects, or pages, just before or just after another, keeping their own order (as dragged in a list). */
export function moveInOrder(ids: string[], target: string, after: boolean): void {
  const ops = reorderOps(get().doc, ids, target, after)
  if (ops.length > 0) apply(ops)
}

export function runCommand(id: string): void {
  const { doc, scope, selection } = get()
  guarded(() => registry.commands.get(id)?.run({ doc, scope, selection, activeLayer: layerHere().layer, apply }))
}
