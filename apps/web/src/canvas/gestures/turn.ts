import { dist, hitTest, sub, transformOps, type Op, type Snap, type Vec2 } from '@opencalque/core'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { cancel, commit, preview, select, useStore } from '../../store'
import { formatAngle } from '../../units'
import { snap } from '../aim'
import type { Overlay } from '../draw'
import type { GestureOf, Keys } from '../gesture'
import { get, type Canvas, type Move, type Press } from '../runtime'

/* The rotate tool: a pivot, a point of the line the turn starts from, then where that line goes. */

/**
 * What the rotate tool does for the pointer at `world`. Before the base line is set, the line
 * from the pivot to the pointer is shown, to be clicked where the turn starts from. Then the
 * selection turns by the angle from that line to the pointer, read counter-clockwise as when
 * drawing; a value typed in the quick bar wins over the pointer.
 */
function turnAim(c: Canvas, g: GestureOf<'turn'>, world: Vec2, e: Keys): { ops: Op[]; marker?: Snap | null; live?: { a: number; b: number }; reading: NonNullable<Overlay['angleReading']>; status: string } {
  const s = get()
  if (!g.from) {
    const target = snap(c, world, e, [], g.pivot)
    return { ops: [], marker: target.marker, reading: { vertex: g.pivot, a: target.p }, status: t('Click where the turn starts from') }
  }
  const typed = s.drawLocks.b
  // The line goes to a point of the drawing as any point placed does (not to what is turning,
  // which follows the pointer), and then turns exactly onto it: a plan at an odd angle is lined
  // up with by pointing at it, which whole degrees could not do (#12).
  const target = typed === undefined && !e.shiftKey ? snap(c, world, e, g.nodes.map((n) => n.id)) : null
  const aimed = target?.marker ? target.p : world
  const along = (p: Vec2) => (Math.atan2(p.y - g.pivot.y, p.x - g.pivot.x) * 180) / Math.PI
  let raw = along(aimed) - along(g.from)
  raw = ((((raw + 180) % 360) + 360) % 360) - 180
  // Otherwise whole degrees; Shift keeps to steps of 15, Alt turns freely. Clockwise on screen, as the document keeps it.
  const step = e.shiftKey ? 15 : e.altKey ? 0.01 : 1
  const rotation = typed !== undefined ? -typed : target?.marker && dist(aimed, g.pivot) > 1e-6 ? raw : Math.round(raw / step) * step
  const degrees = Math.round((((((-rotation + 180) % 360) + 360) % 360) - 180) * 100) / 100
  // The base line turned by as much: the arc between the two shows the angle.
  const radians = (rotation * Math.PI) / 180
  const d = sub(g.from, g.pivot)
  const turned = { x: g.pivot.x + d.x * Math.cos(radians) - d.y * Math.sin(radians), y: g.pivot.y + d.x * Math.sin(radians) + d.y * Math.cos(radians) }
  return {
    ops: transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, rotation }, registry),
    marker: target?.marker ?? null,
    live: { a: 0, b: degrees },
    reading: { vertex: g.pivot, a: g.from, b: turned, label: `${formatAngle(degrees)}°` },
    status: t('Rotation {degrees}°', { degrees: formatAngle(degrees) }),
  }
}

/** Turns the selection as shown, and is ready for the next turn. */
export function finishTurn(c: Canvas, g: GestureOf<'turn'>, world: Vec2, e: Keys): void {
  if (preview(turnAim(c, g, world, e).ops)) commit()
  else cancel()
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
  useStore.setState({ drawLocks: {}, drawLive: null })
}

/** Three clicks: the pivot, a point of the line the turn starts from, and where that line goes. */
export const rotateDown: Press = (c, e, _at, world) => {
  const s = get()
  const g = c.gesture
  if (g.kind === 'turn') {
    if (g.from) return finishTurn(c, g, world, e)
    const from = snap(c, world, e, [], g.pivot).p
    if (dist(from, g.pivot) > 1e-6) g.from = from
    return
  }
  if (s.selection.length === 0) {
    // Nothing to turn yet: a click picks it, as with the select tool.
    const hit = hitTest(c.scene, world, 5 / s.view.zoom)
    if (hit) select([hit.id])
    return
  }
  c.gesture = { kind: 'turn', nodes: s.selection.map((id) => s.doc.nodes[id]), pivot: snap(c, world, e, []).p }
}

export const turnMove: Move<'turn'> = (c, g, e, _at, world, out) => {
  const aimed = turnAim(c, g, world, e)
  out.previewed = preview(aimed.ops)
  out.status = aimed.status
  out.angleReading = aimed.reading
  if (aimed.live) out.live = aimed.live
  if ('marker' in aimed) out.marker = aimed.marker ?? null
}
