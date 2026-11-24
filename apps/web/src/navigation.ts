import { applyTransform, buildScene, rootOf, sceneBounds, viewPlacement, type Document, type NodeOf, type Transform } from '@opencalque/core'
import { registry } from './extensions'
import { ahead, scopePath, type ScopePath, type ScopeStep } from './scopePath'
import { useStore, type View } from './store'

/*
 * Where in the drawing the user is: the page shown, the group or component gone into (`scope`), the
 * placements it was reached through (`through`) and the places left on the way out (`trail`), which
 * the breadcrumb shows. Code that sets `scope` goes through these functions so that those rules hold.
 */

type Place = Pick<ReturnType<typeof useStore.getState>, 'doc' | 'page' | 'scope' | 'through' | 'trail'>

const get = useStore.getState
const set = useStore.setState

/** Shows a page; showing the page already shown, from inside something, is leaving it for the page. */
export function showPage(id: string): void {
  const { doc, scope, page, through, trail } = get()
  const left = id === page && scope !== page ? (trailFrom(doc, page, scope, through, trail) ?? { scope, through }) : null
  set({ page: id, scope: id, through: [], trail: left, selection: [] })
}

/** The way to the scope, and the places ahead of it on the trail (`ahead`): none when that way does not lead into it. */
export function trailAhead(s: Place = get()): { path: ScopePath; trail: ScopePath | null; steps: ScopeStep[] } {
  const path = scopePath(s.doc, s.page, s.scope, s.through)
  if (!s.trail) return { path, trail: null, steps: [] }
  const trail = scopePath(s.doc, s.page, s.trail.scope, s.trail.through)
  return { path, trail, steps: ahead(path, trail) }
}

/** `trail`, while the way to `scope` leads into it. */
function trailFrom(doc: Document, page: string, scope: string, through: string[] | null, trail: Place['trail']): Place['trail'] {
  return trail && trailAhead({ doc, page, scope, through, trail }).steps.length > 0 ? trail : null
}

/**
 * Goes inside a component or group to edit what it contains, or with null comes back out one step
 * (`scopePath`): from a group to whatever holds it, from a component to where its placement is,
 * leaving what was gone into selected; a component opened from the library goes back to the page.
 * Given the instance it was reached by, a component stays where and as large as that instance drew
 * it, and comes back out the same way: only the rest of the drawing goes away. Going into anything
 * that is not on the trail forgets it.
 */
export function editComponent(id: string | null, instance?: NodeOf<'instance'>): void {
  const { doc, scope, page, view, through, trail } = get()
  if (id !== null) {
    const enter = (to: { scope: string; through: string[] | null; view?: View }) => set({ ...to, selection: [], trail: trailFrom(doc, page, to.scope, to.through, trail) })
    // A view (an elevation, a section) is gone into in its own coordinates, where it is drawn and as large.
    const target = doc.nodes[id]
    if (target?.type === 'elevation') return enter({ scope: id, through, view: intoView(view, viewPlacement(target), 1) })
    if (target?.type !== 'component') return enter({ scope: id, through })
    const chain = rootOf(doc, scope)?.type === 'page' ? [] : through
    if (!instance || !chain) return enter({ scope: id, through: null })
    return enter({ scope: id, through: [...chain, instance.id], view: carried(view, doc, id, [instance], 1) })
  }
  const { steps } = scopePath(doc, page, scope, through)
  if (steps.length > 1) return leaveTo(steps[steps.length - 2].id)
  set({ scope: page, through: [], trail: null, selection: [] })
}

/**
 * Comes back out to a place on the way to what is being edited (`scopePath`), with what leads on
 * from there selected: the group gone into, or the placement of the component. Coming out of
 * components goes back through their placements, so the drawing stays where it was on screen.
 * Where it came out of becomes the trail, unless it was already on the way into a deeper one.
 */
export function leaveTo(id: string): void {
  const { doc, scope, page, view, through, trail } = get()
  const path = scopePath(doc, page, scope, through)
  const at = path.steps.findIndex((step) => step.id === id)
  if (at < 0 || at === path.steps.length - 1) return
  const { depth } = path.steps[at]
  const next = path.steps[at + 1]
  const left = (path.through ?? []).slice(depth).map((ref) => doc.nodes[ref] as NodeOf<'instance'>)
  // Out of a view, back from its coordinates, the drawing where it was on screen.
  const outOf = path.steps.slice(at + 1).flatMap((step) => (doc.nodes[step.id]?.type === 'elevation' ? [doc.nodes[step.id] as NodeOf<'elevation'>] : []))
  const back = outOf.reduceRight((v, node) => intoView(v, viewPlacement(node), -1), view)
  set({
    scope: id,
    through: path.through && path.through.slice(0, depth),
    trail: trailFrom(doc, page, scope, through, trail) ?? { scope, through },
    selection: [next.depth === depth ? next.id : left[0].id],
    ...(left.length > 0 ? { view: carried(back, doc, rootOf(doc, scope)!.id, left, -1) } : outOf.length > 0 ? { view: back } : {}),
  })
}

/**
 * Goes back into a place on the trail, ahead of the scope, by the placements it was left through,
 * so the drawing is where it was on screen; what leads on from there is selected, as when leaving.
 */
export function returnTo(id: string): void {
  const { doc, view } = get()
  const { path, trail, steps } = trailAhead()
  const at = steps.findIndex((step) => step.id === id)
  if (!trail || at < 0) return
  const { depth } = steps[at]
  const next = steps[at + 1]
  const into = (trail.through ?? []).slice(path.steps[path.steps.length - 1].depth, depth).map((ref) => doc.nodes[ref] as NodeOf<'instance'>)
  // Back into a view, into its coordinates.
  const views = steps.slice(0, at + 1).flatMap((step) => (doc.nodes[step.id]?.type === 'elevation' ? [doc.nodes[step.id] as NodeOf<'elevation'>] : []))
  const there = views.reduce((v, node) => intoView(v, viewPlacement(node), 1), view)
  set({
    scope: id,
    through: trail.through && trail.through.slice(0, depth),
    selection: next ? [next.depth === depth ? next.id : trail.through![depth]] : [],
    ...(into.length > 0 ? { view: carried(there, doc, rootOf(doc, id)!.id, into, 1) } : views.length > 0 ? { view: there } : {}),
  })
}

/** Lets go of the places left: the breadcrumb no longer offers to go back into them. */
export function forgetTrail(): void {
  set({ trail: null })
}

/**
 * The view that shows a component's contents where `instances` (outermost first) draw them, going
 * in (1), or the other way, coming out (-1). The middle of the contents is what stays put, which
 * for an instance that is not turned is every point of it.
 */
/**
 * The view that shows a view's contents (an elevation's dimensions and notes, in its own coordinates)
 * where it draws them, going in (1), or the other way, coming out (-1): its placement is a move and
 * a size, with no turn, so every point stays put on screen.
 */
function intoView(view: View, placing: { x: number; y: number; scale: number }, way: 1 | -1): View {
  if (way === 1) return { zoom: view.zoom * placing.scale, x: view.x + placing.x * view.zoom, y: view.y + placing.y * view.zoom }
  const zoom = view.zoom / placing.scale
  return { zoom, x: view.x - placing.x * zoom, y: view.y - placing.y * zoom }
}

function carried(view: View, doc: Document, component: string, instances: Transform[], way: 1 | -1): View {
  const box = sceneBounds(buildScene(doc, component, registry))
  const inner = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : { x: 0, y: 0 }
  const outer = instances.reduceRight((p, t) => applyTransform(p, t), inner)
  const scale = instances.reduce((k, t) => k * (t.scale ?? 1), 1)
  const [from, to, zoom] = way === 1 ? [outer, inner, view.zoom * scale] : [inner, outer, view.zoom / scale]
  const at = { x: from.x * view.zoom + view.x, y: from.y * view.zoom + view.y }
  return { zoom, x: at.x - to.x * zoom, y: at.y - to.y * zoom }
}
