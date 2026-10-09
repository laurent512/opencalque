import {
  applyOps,
  buildScene,
  childrenOf,
  cloneOps,
  copyNodes,
  componentsOf,
  createComponent,
  createDocument,
  groupNodes,
  importComponents,
  isClipboard,
  orderAfter,
  orderBefore,
  orderBetween,
  parseDocument,
  paperContents,
  pasteNodes,
  sceneBounds,
  serializeDocument,
  toDXF,
  toSVG,
  ungroupNode,
  type Document,
  type Op,
  moveOps,
  transformOps,
  wallFollowOps,
  modifierKind,
  type Modifier,
  toPDF,
  duplicatePageOps,
  movePageOps,
  pagesOf,
  type Node,
} from '@opencalque/core'
import { gridStep } from './canvas/draw'
import { t, tn } from './i18n'
import { platform } from './platform'
import { usePrefs } from './prefs'
import { apply, cancel, commit, isDirty, loadDocument, registry, replaceDoc, select, setTool, toast, useStore, showPage } from './store'

const get = useStore.getState
/** What a drawing file may be called: the current extension, the one from before the project was renamed, and plain JSON. */
export const DRAWING_EXTENSIONS = ['opencalque', 'opencad', 'json']
const baseName = () => get().doc.name.trim() || t('Untitled')

/** Runs an action, showing any failure to the user instead of losing it in the console. */
export async function guarded(action: () => void | Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    toast((error as Error).message)
  }
}

const confirmDiscard = () => !isDirty() || window.confirm(t('Discard unsaved changes?'))

/** An empty drawing whose first page and layer are named in the current language. */
export function blankDocument(): Document {
  return applyOps(createDocument(t('Untitled')), [
    { op: 'update_node', id: 'page_1', patch: { name: t('Page {n}', { n: 1 }) } },
    { op: 'update_layer', id: 'layer_1', patch: { name: t('Layer {n}', { n: 1 }) } },
  ])
}

export function newDocument(): void {
  if (confirmDiscard()) loadDocument(blankDocument(), null)
}

export const openDocument = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (file) loadDocument(parseDocument(JSON.parse(file.content)), file)
  })

let started = false

/**
 * What happens once when the app starts: the file it was launched with is opened, or, without
 * one, the welcome window offers where to begin.
 */
export const startUp = () =>
  guarded(async () => {
    // The interface is rebuilt when the language changes; the app starts only once.
    if (started) return
    started = true
    const file = await platform.initial()
    if (file) loadDocument(parseDocument(JSON.parse(file.content)), file)
    else if (usePrefs.getState().showWelcome) useStore.setState({ welcomeOpen: true })
  })

/** Opens the drawing that comes with the app, as a new one with no file: a furnished flat to explore. */
export const openExample = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    // Fetched only when asked for, so that it does not weigh on every start.
    const example = await import('../../../examples/apartment.opencalque?raw')
    loadDocument(parseDocument(JSON.parse(example.default)), null)
    useStore.setState({ welcomeOpen: false })
  })

/** Reopens a drawing from the list the desktop app keeps. */
export const openRecent = (path: string) =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.openRecent?.(path)
    if (!file) return toast(t('This file is no longer there'))
    loadDocument(parseDocument(JSON.parse(file.content)), file)
    useStore.setState({ welcomeOpen: false })
  })

export const saveDocument = (saveAs = false) =>
  guarded(async () => {
    cancel()
    const { doc, file } = get()
    const token = saveAs ? undefined : (file?.token ?? undefined)
    const stored = await platform.save(serializeDocument(doc), file?.name ?? `${baseName()}.opencalque`, token)
    if (stored) useStore.setState({ saved: doc, file: stored })
  })

/**
 * Exports papers as a PDF at their real size and scale: the selected ones, or every paper of the
 * drawing, one page each.
 */
export const exportPdf = () =>
  guarded(async () => {
    const { doc, selection } = get()
    const papers = Object.values(doc.nodes).filter((node) => node.type === 'paper')
    if (papers.length === 0) return toast(t('Add a paper first (F): it sets the size and the scale of the printed sheet.'))
    const chosen = papers.filter((paper) => selection.includes(paper.id))
    const pdf = toPDF(doc, registry, chosen.length > 0 ? chosen.map((paper) => paper.id) : undefined)
    const stored = await platform.save(pdf, `${baseName()}.pdf`)
    if (stored) toast(tn(chosen.length || papers.length, 'Exported {n} sheet as PDF, to scale', 'Exported {n} sheets as PDF, to scale'))
  })

export const exportDxf = () =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toDXF(doc, scope, registry), `${baseName()}.dxf`)
  })

// Kept as well as the system clipboard, which a browser may refuse to let a page read.
let lastCopy = ''

/** The given objects plus everything lying on any paper among them: a paper carries what is on it. */
export function withPaperContents(ids: string[]): string[] {
  const { doc, scope } = get()
  if (!ids.some((id) => doc.nodes[id]?.type === 'paper')) return ids
  const scene = buildScene(doc, scope, registry)
  return [...new Set(ids.flatMap((id) => [id, ...paperContents(scene, id)]))]
}

/** Copies the selection as JSON text, so it can be pasted into another drawing or another window. */
export const copySelection = () =>
  guarded(async () => {
    const { doc, selection } = get()
    if (selection.length === 0) return
    lastCopy = JSON.stringify(copyNodes(doc, withPaperContents(selection)))
    await navigator.clipboard?.writeText(lastCopy).catch(() => {})
  })

export const cutSelection = () =>
  guarded(async () => {
    await copySelection()
    // What was copied is what goes: a paper is cut together with what is on it.
    apply(withPaperContents(get().selection).map((id): Op => ({ op: 'remove_node', id })))
  })

export const paste = () =>
  guarded(async () => {
    const text = (await navigator.clipboard?.readText().catch(() => '')) || lastCopy
    let clip: Document
    try {
      clip = parseDocument(JSON.parse(text))
    } catch {
      return toast(t('There is nothing from OpenCalque on the clipboard.'))
    }
    if (!isClipboard(clip)) return toast(t('There is nothing from OpenCalque on the clipboard.'))
    const { doc, scope, activeLayer } = get()
    // Pasting into the drawing it came from would land exactly on the original, so it is shifted.
    const result = pasteNodes(doc, clip, scope, { x: 200, y: 200 }, activeLayer)
    replaceDoc(result.doc)
    select(result.ids)
  })

export const exportSvg = () =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toSVG(doc, scope, registry), `${baseName()}.svg`)
  })

/** Any OpenCalque document can be used as a library: this copies all of its components in. */
export const importLibrary = () =>
  guarded(async () => {
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (!file) return
    const before = componentsOf(get().doc).length
    const { doc } = importComponents(get().doc, parseDocument(JSON.parse(file.content)))
    replaceDoc(doc)
    const count = componentsOf(doc).length - before
    toast(tn(count, 'Imported {n} component from {file}', 'Imported {n} components from {file}', { file: file.name }))
  })

/**
 * Ends typing into a text. A text left empty is removed (or never added, when it was new), since
 * an empty text cannot be seen or clicked. Afterwards the text is selected with the select tool.
 */
export function finishTextEdit(): void {
  const { editingText, doc } = get()
  if (!editingText) return
  useStore.setState({ editingText: null })
  const node = doc.nodes[editingText.id]
  // A text with no words cannot be seen; an annotation with none is still an arrow.
  const empty = node?.type === 'annotation' ? false : node?.type !== 'text' || node.text.trim() === ''
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
  const nodes = withPaperContents(selection).map((id) => doc.nodes[id])
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
    params: sized ? { width: across.size, height: down.size } : {},
  }
  apply(selection.map((id): Op => ({ op: 'update_node', id, patch: { modifiers: [...(doc.nodes[id].modifiers ?? []), added] } })))
}

/** Makes a copy of a page, with what is on it, and shows the copy. */
export function duplicatePage(id: string): void {
  const { doc } = get()
  const page = doc.nodes[id]
  if (!page) return
  const copy = duplicatePageOps(doc, id, t('{name} (copy)', { name: page.name ?? '' }))
  if (apply(copy.ops)) showPage(copy.id)
}

/** Moves a page one place up or down the list of pages. */
export function movePage(id: string, by: -1 | 1): void {
  apply(movePageOps(get().doc, id, by))
}

/** The scene items of the selection, each with the box it takes up. */
function selectedBoxes() {
  const { doc, scope, selection } = get()
  return buildScene(doc, scope, registry).flatMap((item) => (selection.includes(item.id) && item.bounds ? [{ node: item.node, box: item.bounds }] : []))
}

/** The operations that move one selected object, with what a paper carries, by `d`. */
const shift = (node: Node, d: { x: number; y: number }): Op[] => (d.x === 0 && d.y === 0 ? [] : withPaperContents([node.id]).flatMap((id) => moveOps(get().doc, get().doc.nodes[id], d)))

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
 * Takes the look of an object (colours, weight, dashes). With objects selected they are given it;
 * with none, it becomes the look of what is drawn next.
 */
export function pickStyle(source: Node): void {
  const { selection } = get()
  const targets = selection.filter((id) => id !== source.id)
  if (targets.length > 0) {
    if (apply(targets.map((id): Op => ({ op: 'update_node', id, patch: { style: source.style ?? null } })))) toast(tn(targets.length, 'Style given to {n} object', 'Style given to {n} objects'))
  } else {
    useStore.setState({ drawColor: source.style?.stroke ?? null, drawWeight: source.style?.strokeWidth ?? null, drawDash: source.style?.dash ?? null })
    toast(t('Style picked up: the next shapes you draw will have it'))
  }
  setTool('select')
}

/** Moves the selection by whole steps of the grid as it is shown; `dx` and `dy` count steps. */
export function nudgeSelection(dx: number, dy: number): void {
  const { doc, selection, view } = get()
  const step = gridStep(view.zoom)
  const d = { x: dx * step, y: dy * step }
  const nodes = withPaperContents(selection).map((id) => doc.nodes[id])
  apply([...nodes.flatMap((node) => moveOps(doc, node, d)), ...wallFollowOps(doc, nodes, d, registry)])
}

export const groupSelection = () =>
  guarded(() => {
    const { doc, selection } = get()
    const result = groupNodes(doc, selection)
    replaceDoc(result.doc)
    select([result.groupId])
  })

/** Dissolves every selected group, leaving what was inside selected. */
export const ungroupSelection = () =>
  guarded(() => {
    let { doc } = get()
    const freed: string[] = []
    for (const id of get().selection) {
      if (doc.nodes[id]?.type !== 'group') {
        freed.push(id)
        continue
      }
      const result = ungroupNode(doc, id)
      doc = result.doc
      freed.push(...result.childIds)
    }
    replaceDoc(doc)
    select(freed)
  })

export const makeComponent = () =>
  guarded(() => {
    const { doc, selection } = get()
    const name = t('Component {n}', { n: componentsOf(doc).length + 1 })
    const result = createComponent(doc, registry, selection, name)
    replaceDoc(result.doc)
    select([result.instanceId])
  })

/**
 * Changes what the selection is drawn over: all the way to the front or back, or one step past
 * the next object in that direction. The selected objects keep their order among themselves.
 */
export function reorderSelection(to: 'front' | 'forward' | 'backward' | 'back'): void {
  const { scope, selection } = get()
  let { doc } = get()
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
          : up
            ? orderBetween(neighbour.order, siblings[at + 2]?.order ?? null)
            : orderBetween(siblings[at - 2]?.order ?? null, neighbour.order)
    doc = applyOps(doc, [{ op: 'update_node', id: node.id, patch: { order } }])
  }
  replaceDoc(doc)
}

/** Puts one object just above or just below another in the stacking order (as dragged in the object list). */
export function moveInOrder(id: string, target: string, place: 'above' | 'below'): void {
  const { doc, scope } = get()
  if (id === target) return
  const others = childrenOf(doc, scope).filter((n) => n.id !== id)
  const at = others.findIndex((n) => n.id === target)
  if (at < 0) return
  const order = place === 'above' ? orderBetween(others[at].order, others[at + 1]?.order ?? null) : orderBetween(others[at - 1]?.order ?? null, others[at].order)
  apply([{ op: 'update_node', id, patch: { order } }])
}

export function runCommand(id: string): void {
  const { doc, scope, selection, activeLayer } = get()
  guarded(() => registry.commands.get(id)?.run({ doc, scope, selection, activeLayer, apply }))
}

/** Zooms around the centre of the canvas. */
export function zoomBy(factor: number): void {
  const { view, viewport } = get()
  const zoom = Math.min(20, Math.max(0.002, view.zoom * factor))
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  useStore.setState({ view: { zoom, x: cx - ((cx - view.x) / view.zoom) * zoom, y: cy - ((cy - view.y) / view.zoom) * zoom } })
}

export function zoomToFit(): void {
  const { doc, scope, viewport } = get()
  const b = sceneBounds(buildScene(doc, scope, registry))
  if (!b || viewport.width === 0) return
  const margin = 80
  const zoom = Math.min(
    (viewport.width - 2 * margin) / Math.max(b.maxX - b.minX, 1),
    (viewport.height - 2 * margin) / Math.max(b.maxY - b.minY, 1),
    2,
  )
  useStore.setState({
    view: {
      zoom,
      x: viewport.width / 2 - ((b.minX + b.maxX) / 2) * zoom,
      y: viewport.height / 2 - ((b.minY + b.maxY) / 2) * zoom,
    },
  })
}
