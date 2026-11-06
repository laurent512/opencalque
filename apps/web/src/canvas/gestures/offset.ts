import { besideNode, canOffset, hitTest, offsetOps, type Node, type Vec2 } from '@opencalque/core'
import { t } from '../../i18n'
import { cancel, commit, preview, useStore } from '../../store'
import { formatLength } from '../../units'
import { gridStep } from '../../view'
import { snap } from '../aim'
import type { GestureOf, Keys } from '../gesture'
import { get, type Canvas, type Move, type Press, type Shown } from '../runtime'

/*
 * The offset tool: a parallel copy of a line or a shape. With a distance typed, the copy follows
 * the pointer along whatever it rests on, on the side it is on, and a click keeps it. With none,
 * the pointer is on the object and says nothing of how far: a click takes the object, and the
 * pointer then sets the distance (`parallel`). That distance stays for the next copies.
 */

/** What is under the pointer in the drawing itself: the copy being shown is not there to be taken. */
function under(c: Canvas, world: Vec2, offsets: boolean) {
  const { base, doc, view } = get()
  const drawn = base ?? doc
  return hitTest(c.scene.filter((item) => drawn.nodes[item.id] && (!offsets || canOffset(item.node))), world, 6 / view.zoom)
}

/** Shows the copy of `node` at `distance`, or says why there is none. Returns its id. */
function show(node: Node, distance: number, out: Shown): string | null {
  const { base, doc } = get()
  const copy = offsetOps(base ?? doc, node, distance)
  if (!copy) {
    cancel()
    out.status = t('Too far: the shape would fold over itself')
    return null
  }
  out.previewed = preview(copy.ops)
  return copy.id
}

/** Keeps the copy of `node` at `distance`. */
function keep(c: Canvas, node: Node, distance: number): void {
  const { base, doc } = get()
  const copy = offsetOps(base ?? doc, node, distance)
  if (copy && preview(copy.ops)) commit()
  else cancel()
  c.setOverlay({})
}

const sideOf = (node: Node, p: Vec2) => (besideNode(node, p) < 0 ? -1 : 1)

/** With nothing in progress: what a click would take, and with a distance typed the copy it would make. */
export function offsetHover(c: Canvas, world: Vec2, out: Shown): void {
  const { a: distance } = get().drawLocks
  const hit = under(c, world, true)
  if (!hit) {
    cancel()
    if (under(c, world, false)) out.status = t('Only lines, polylines, curves, rectangles, circles and arcs can be offset')
    return
  }
  out.lit = hit.id
  if (distance === undefined) cancel()
  else show(hit.node, sideOf(hit.node, world) * distance, out)
}

/** How far the copy goes for a pointer at `world`, and where it is held: a typed distance, a point it passes through, else whole steps of the grid. */
function aimed(c: Canvas, g: GestureOf<'parallel'>, world: Vec2, e: Keys) {
  const { drawLocks, view } = get()
  const target = snap(c, world, e, g.copy ? [g.copy] : [])
  const beside = besideNode(g.node, target.marker ? target.p : world)
  const step = gridStep(view.zoom)
  const free = target.marker !== null || e.altKey
  const length = drawLocks.a ?? (free ? Math.abs(beside) : Math.round(Math.abs(beside) / step) * step)
  return { marker: target.marker, length, distance: beside < 0 ? -length : length }
}

export const parallelMove: Move<'parallel'> = (c, g, e, _at, world, out) => {
  const { marker, length, distance } = aimed(c, g, world, e)
  out.marker = marker
  out.lit = g.node.id
  if (length === 0) {
    cancel()
    return
  }
  g.copy = show(g.node, distance, out) ?? undefined
  out.live = { a: length, b: 0 }
  if (g.copy) out.status = t('Distance {value}', { value: formatLength(length) })
}

/** Keeps the copy being shown, and goes on at that distance. */
export function finishOffset(c: Canvas, g: GestureOf<'parallel'>, world: Vec2, e: Keys): void {
  const { length, distance } = aimed(c, g, world, e)
  c.gesture = { kind: 'idle' }
  if (length === 0) return void cancel()
  keep(c, g.node, distance)
  useStore.setState({ drawLocks: { a: length }, drawLive: null })
}

export const offsetDown: Press = (c, e, _at, world) => {
  const g = c.gesture
  if (g.kind === 'parallel') return finishOffset(c, g, world, e)
  const hit = under(c, world, true)
  if (!hit) return
  const { a: distance } = get().drawLocks
  if (distance === undefined) c.gesture = { kind: 'parallel', node: hit.node }
  else keep(c, hit.node, sideOf(hit.node, world) * distance)
}
