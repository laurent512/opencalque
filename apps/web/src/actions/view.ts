import { boundsOf, boundsOfPoints, buildScene, cameraPrimitives, isVisible, lookedAt, nodePrimitives, rootOf, sceneBounds, seenArea, unionBounds, type Bounds, type Node } from '@opencalque/core'
import { camerasOf, framesOf } from '../perspective/seen'
import { registry } from '../extensions'
import { editComponent, showPage } from '../navigation'
import { useStore } from '../store'

/* Where the drawing is looked at: zooming, and coming back to the view left when going inside a component from a list. */

const get = useStore.getState

/** How far the view zooms out and in, in screen pixels per millimetre. */
export const MIN_ZOOM = 0.002
export const MAX_ZOOM = 20

/** Zooms to `zoom` pixels per millimetre around the centre of the canvas, within the limits. */
export const zoomTo = (zoom: number): void => zoomBy(zoom / get().view.zoom)

/** Where the view was when a component was opened from a list, to come back to. */
let before: { component: string; view: { zoom: number; x: number; y: number }; selection: string[] } | null = null

/**
 * Goes inside a component opened from a list rather than through a placement of it (the Components
 * panel, the object library, what is on every sheet from a paper's properties): what it holds fills
 * the view, in its middle. Leaving it, by whatever way, brings back the view the drawing was looked
 * at with, and what was selected.
 */
export function openComponent(id: string): void {
  const { view, scope, doc, selection } = get()
  // Opened from inside another one opened so: leaving still comes back to where it all started.
  if (rootOf(doc, scope)?.id !== id) before = { component: id, view: before?.view ?? view, selection: before?.selection ?? selection }
  editComponent(id)
  zoomToFit()
}

useStore.subscribe((state) => {
  // Still inside it while a group of it is being edited.
  if (!before || rootOf(state.doc, state.scope)?.id === before.component) return
  const { view, selection } = before
  before = null
  useStore.setState({ view, selection: selection.filter((id) => state.doc.nodes[id]?.parent === state.scope) })
})

/** Zooms around the centre of the canvas. */
export function zoomBy(factor: number): void {
  const { view, viewport } = get()
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  useStore.setState({ view: { zoom, x: cx - ((cx - view.x) / view.zoom) * zoom, y: cy - ((cy - view.y) / view.zoom) * zoom } })
}

/** Brings the whole of what is drawn into view, with the views of its viewpoints in their frames on the plan. */
export function zoomToFit(): void {
  const { doc, scope } = get()
  const cameras = camerasOf(doc, scope).filter((c) => isVisible(doc, c))
  const frames = [...framesOf(doc, cameras).values()].map((f): Bounds => ({ minX: f.x, minY: f.y, maxX: f.x + f.width, maxY: f.y + f.height }))
  showBounds(frames.reduce<Bounds | null>((all, one) => unionBounds(all, one), sceneBounds(buildScene(doc, scope, registry))))
}

/** Brings what is selected into the middle of the view, filling it: to see where an object picked in a list is. */
export function zoomToSelection(): void {
  const { doc, selection } = get()
  const ctx = { doc, registry, depth: 0 }
  const b = boundsOf(selection.flatMap((id) => (doc.nodes[id] ? nodePrimitives(doc.nodes[id], ctx) : [])))
  if (!b) return
  // Room around it, as much again as it is large and at least a metre, so that one sees where it is and not only what.
  const room = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1000)
  showBounds({ minX: b.minX - room, minY: b.minY - room, maxX: b.maxX + room, maxY: b.maxY + room })
}

/** The view selected alone (a 3D view, an elevation, a section), or none. */
function selectedView(): Extract<Node, { type: 'camera' | 'elevation' }> | null {
  const { doc, selection } = get()
  const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  return node?.type === 'camera' || node?.type === 'elevation' ? node : null
}

/** On `page` with the view still selected: a view's eye or line and its picture may be on two pages. */
function goWith(node: Node, page: string | null): void {
  if (!page || page === rootOf(get().doc, get().scope)?.id) return
  showPage(page)
  useStore.setState({ selection: [node.id] })
}

/** Zooms on where the view selected looks from, on the plan it looks at: a viewpoint's eye and what it sees, an elevation's line and what it sees. */
export function zoomToViewMark(): void {
  const node = selectedView()
  if (!node) return
  goWith(node, lookedAt(get().doc, node))
  const b = node.type === 'camera' ? boundsOf(cameraPrimitives(node)) : boundsOfPoints(seenArea(node))
  if (!b) return
  const room = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1000) / 2
  showBounds({ minX: b.minX - room, minY: b.minY - room, maxX: b.maxX + room, maxY: b.maxY + room })
}

/** Zooms on the picture of the view selected, on the page it is shown on: a viewpoint's frame, an elevation's drawing. */
export function zoomToViewPicture(): void {
  const node = selectedView()
  if (!node) return
  const { doc } = get()
  const page = rootOf(doc, node.parent)?.id ?? null
  goWith(node, page)
  if (node.type === 'camera') {
    const frame = framesOf(doc, [node]).get(node.id)
    return frame && showBounds({ minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height })
  }
  showBounds(page ? (buildScene(doc, page, registry).find((item) => item.id === node.id)?.bounds ?? null) : null)
}

/** Brings a rectangle of the drawing into the middle of the view: at the same zoom where it fits there, so that going from one thing to the next does not jump; else zoomed out to fit it. */
export function bringIntoView(b: Bounds): void {
  const { view, viewport } = get()
  if (viewport.width === 0) return
  const margin = 80
  if ((b.maxX - b.minX) * view.zoom > viewport.width - 2 * margin || (b.maxY - b.minY) * view.zoom > viewport.height - 2 * margin) return showBounds(b)
  useStore.setState({ view: { ...view, x: viewport.width / 2 - ((b.minX + b.maxX) / 2) * view.zoom, y: viewport.height / 2 - ((b.minY + b.maxY) / 2) * view.zoom } })
}

/** Fits a rectangle of the drawing in the view, with a margin, zooming in no further than 2 px a millimetre. */
function showBounds(b: Bounds | null): void {
  const { viewport } = get()
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
