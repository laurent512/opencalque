import { canFillet, canSplit, dist, extendOps, extendPlace, filletOps, hitTest, newId, type Node, type NodeOf, type Vec2 } from '@opencalque/core'
import { t } from '../../i18n'
import { cancel, commit, preview } from '../../store'
import { formatLength } from '../../units'
import type { GestureOf } from '../gesture'
import { get, type Canvas, type Move, type Press, type Shown } from '../runtime'

/*
 * The tools that fit lines to one another: Extend carries the end of a line, a polyline or a wall
 * on to the next thing in its way, as Trim takes a stretch away; Fillet makes two lines meet, at
 * their crossing or, with a radius typed, by an arc between them.
 */

/** The node of the drawing as it is (not as shown) under the pointer, of those `which` takes. */
function under(c: Canvas, world: Vec2, which: (node: Node) => boolean): Node | null {
  const { base, doc, view } = get()
  const hit = hitTest(c.scene.filter((item) => which(item.node)), world, 6 / view.zoom)
  const node = hit && (base ?? doc).nodes[hit.id]
  return node && which(node) ? node : null
}

/** What extending would do for a pointer at `world`: the thing under it, and the operations that carry its nearer end on. */
function extendAim(c: Canvas, world: Vec2) {
  const { base, doc } = get()
  const node = under(c, world, canSplit)
  const place = node && extendPlace(base ?? doc, node, world)
  const ops = node && place && extendOps(node, place)
  return node && { node, place, ops }
}

/** Before a click: the end that would be carried on, carried on, and by how much. */
export function extendHover(c: Canvas, world: Vec2, out: Shown): void {
  const aim = extendAim(c, world)
  if (!aim) return void cancel()
  out.lit = aim.node.id
  if (!aim.ops || !aim.place) {
    cancel()
    out.status = t('Nothing lies ahead of this end to extend it to')
    return
  }
  out.previewed = preview(aim.ops)
  out.status = t('Longer by {value}', { value: formatLength(dist(aim.place.from, aim.place.to)) })
}

export const extendDown: Press = (c, _e, _at, world) => {
  const aim = extendAim(c, world)
  if (aim?.ops && preview(aim.ops)) commit()
  else cancel()
  c.setOverlay({})
}

/** The radius typed for the fillet, or none: the lines then meet at a sharp corner. */
const radius = () => get().drawLocks.a ?? 0

/** What a fillet with `g`'s first line would do with the line under the pointer, or why it cannot. */
function filletAim(c: Canvas, g: GestureOf<'fillet'>, world: Vec2) {
  const second = under(c, world, (node) => canFillet(node) && node.id !== g.first.id) as NodeOf<'line'> | null
  if (!second) return null
  const ops = filletOps(g.first, g.at, second, world, radius(), newId())
  const why = ops ? '' : filletOps(g.first, g.at, second, world, 0, '') ? t('These lines are too short for this radius') : t('These lines run side by side: they never meet')
  return { second, ops, why }
}

/** With nothing in progress: the line a click would take. */
export function filletHover(c: Canvas, world: Vec2, out: Shown): void {
  const line = under(c, world, canFillet)
  if (line) out.lit = line.id
  else if (under(c, world, () => true)) out.status = t('Only straight lines can be filleted')
}

export const filletMove: Move<'fillet'> = (c, g, _e, _at, world, out) => {
  const aim = filletAim(c, g, world)
  out.lit = aim?.second.id ?? g.first.id
  if (!aim?.ops) {
    cancel()
    if (aim) out.status = aim.why
    return
  }
  out.previewed = preview(aim.ops)
  if (radius() > 0) out.status = t('Radius {value}', { value: formatLength(radius()) })
}

export const filletDown: Press = (c, _e, _at, world) => {
  const g = c.gesture
  if (g.kind !== 'fillet') {
    const first = under(c, world, canFillet) as NodeOf<'line'> | null
    if (first) c.gesture = { kind: 'fillet', first, at: world }
    return
  }
  const aim = filletAim(c, g, world)
  // A click on nothing, or on a line that cannot meet the first, leaves the first taken.
  if (!aim?.ops) return
  if (preview(aim.ops)) commit()
  else cancel()
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
}
