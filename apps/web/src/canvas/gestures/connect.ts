import { controlSide, controlsOn, hitTest, newId, rootOf, toggleControlOps, type Bounds, type SceneItem, type Vec2 } from '@opencalque/core'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { apply, cancel, layerHere, preview, select, useStore } from '../../store'
import { labelOf } from '../../ui'
import type { PointerAt } from '../gesture'
import { get, syncStep, type Canvas, type Move, type Press, type Shown } from '../runtime'

/*
 * The connect tool: a click on a switch, a dimmer or a push button, then on each light or socket it
 * controls, links them (a `link` node, `networks/`); a click on one it controls already unlinks it.
 * Either may be clicked first. What the clicks go from is the switch (or light) selected: the
 * one clicked first, or one selected when the tool is taken (from its right-click menu, say), until
 * another of its kind is clicked, which they then go from. Esc lets it go, unselecting it. While the
 * tool is in use, the lights that nothing controls are marked.
 */

/** Starts from `id`: it is selected, and the next clicks link to it. */
function startFrom(c: Canvas, id: string): void {
  c.gesture = { kind: 'connect', from: id }
  select([id])
  syncStep(c)
}

/** The one switch or light selected, which the clicks go from; null when the selection is anything else. */
function chosen(): string | null {
  const s = get()
  return s.selection.length === 1 && controlSide(s.doc.nodes[s.selection[0]], registry) ? s.selection[0] : null
}

/** Goes from the switch or light selected, if one is: when the tool is taken, and whenever what was in progress was reset (a save, say). */
export function connectStart(c: Canvas): void {
  const id = chosen()
  if (id && c.gesture.kind !== 'connect') {
    c.gesture = { kind: 'connect', from: id }
    syncStep(c)
  }
}

/** How near, in screen pixels, the pointer must be to a symbol for the tool to take it. */
const REACH = 6

/** The object under the pointer that gives or takes control, if any. */
function deviceAt(c: Canvas, world: Vec2): SceneItem | null {
  const devices = c.scene.filter((item) => controlSide(item.node, registry) !== null)
  return hitTest(devices, world, REACH / get().view.zoom)
}

/**
 * Where a link drawn now goes: the page or group being edited, on the layer of the switch (or light)
 * it starts from, so that hiding the layer of the electrical symbols hides their links too; on the
 * layer things go on there when that one has none.
 */
const place = (from: string) => {
  const s = get()
  const layer = s.doc.nodes[from]?.layer
  return { id: newId(), parent: s.scope, ...(layer && s.doc.layers[layer] ? { layer } : layerHere(s)) }
}

export const connectDown: Press = (c, _e, _at, world) => {
  const s = get()
  const hit = deviceAt(c, world)
  if (!hit) {
    useStore.setState({ status: t('Click a switch, a light or a socket') })
    return
  }
  const from = c.gesture.kind === 'connect' ? c.gesture.from : chosen()
  if (from === null || from === hit.id || !s.doc.nodes[from]) return startFrom(c, hit.id)
  cancel()
  const made = toggleControlOps(get().doc, registry, from, hit.id, place(from))
  // Two of a kind (two switches, two lights): the clicks go on from the new one.
  if (!made) return startFrom(c, hit.id)
  apply(made.ops)
  useStore.setState({ status: made.linked ? t('{from} now controls {to}', names(from, hit.id)) : t('{from} no longer controls {to}', names(from, hit.id)) })
}

/** The two ends of a link by their names, the one that controls first. */
function names(a: string, b: string): { from: string; to: string } {
  const doc = get().doc
  const [from, to] = controlSide(doc.nodes[a], registry) === 'out' ? [a, b] : [b, a]
  return { from: labelOf(doc, doc.nodes[from]), to: labelOf(doc, doc.nodes[to]) }
}

/** The boxes of the lights of the page being edited that nothing controls, to mark them. */
function loose(c: Canvas): Bounds[] {
  const s = get()
  const root = rootOf(s.base ?? s.doc, s.scope)
  if (!root) return []
  const ids = new Set(controlsOn(s.base ?? s.doc, registry, root.id).uncontrolled.map((device) => device.id))
  return c.scene.flatMap((item) => (ids.has(item.id) && item.bounds ? [item.bounds] : []))
}

/** What the tool shows with nothing clicked yet: the symbol under the pointer, lit, and what is left unconnected. */
export function connectHover(c: Canvas, e: PointerAt, at: Vec2, world: Vec2, out: Shown): void {
  connectStart(c)
  if (c.gesture.kind === 'connect') return connectMove(c, c.gesture, e, at, world, out)
  const hit = deviceAt(c, world)
  if (hit) out.lit = hit.id
  out.loose = loose(c)
}

/**
 * After a first click: the link a click on what is under the pointer would make, shown as it would
 * be drawn, or taken away when the two are linked already; elsewhere, a line from the one clicked
 * to the pointer.
 */
export const connectMove: Move<'connect'> = (c, g, _e, _at, world, out) => {
  const s = get()
  const before = s.base ?? s.doc
  const hit = deviceAt(c, world)
  out.loose = loose(c)
  const made = hit && hit.id !== g.from ? toggleControlOps(before, registry, g.from, hit.id, place(g.from)) : null
  if (hit && made) {
    out.lit = hit.id
    out.previewed = preview(made.ops)
    out.status = made.linked ? t('Click to make {from} control {to}', names(g.from, hit.id)) : t('Click to unlink {from} and {to}', names(g.from, hit.id))
    return
  }
  cancel()
  const box = c.scene.find((item) => item.id === g.from)?.bounds
  if (box) out.link = [{ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, world]
  if (hit && hit.id !== g.from) out.status = t('Click to go on from {name}', { name: labelOf(before, hit.node) })
}
