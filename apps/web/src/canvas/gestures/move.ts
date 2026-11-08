import { cloneOps, hitTest, len, moveOps, sub, wallFollowOps, type Op, type Snap, type Vec2 } from '@opencalque/core'
import { withPaperContents } from '../../actions/clipboard'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { cancel, commit, preview, select, useStore } from '../../store'
import { formatLength } from '../../units'
import { lineEnd, snap } from '../aim'
import type { GestureOf, Keys } from '../gesture'
import { get, type Canvas, type Move, type Press } from '../runtime'
import { constrain } from '../shapes'

/*
 * The move tool, as in CAD: a point to move the selection by, then where that point goes, both
 * snapped, so that a corner, a middle or a centre of what is moved lands exactly on one of
 * something else. Two clicks rather than a drag, so the view can be panned and zoomed between them.
 */

/** The keys the move tool reads: Ctrl (⌘ on a Mac) besides those of any point. */
type MoveKeys = Keys & { ctrlKey?: boolean; metaKey?: boolean }

/** Whether the click leaves a copy where the pointer is, rather than moving the selection there. */
const copying = (e: MoveKeys) => !!(e.ctrlKey || e.metaKey)

/**
 * What the move tool does for the pointer at `world`: the selection moved by the way from the
 * point taken to where the pointer snaps, or a length and an angle typed in the quick bar, on what
 * was there when the tool took it. With Ctrl (⌘) a copy goes there instead; with Alt the pointer
 * is taken as it is and only what is selected moves, as when it is dragged.
 */
function moveAim(c: Canvas, g: GestureOf<'displace'>, world: Vec2, e: MoveKeys): { ops: Op[]; marker: Snap | null; link?: [Vec2, Vec2]; to: Vec2; status: string } {
  const s = get()
  const before = s.base ?? s.doc
  // Not onto what moves: it follows the pointer. An arrow key holds the way level or upright.
  const target = lineEnd(c, world, e, g.ids, g.from)
  const to = constrain('move', g.from, target.p)
  const d = sub(to, g.from)
  const ids = g.ids.filter((id) => before.nodes[id])
  const nodes = ids.map((id) => before.nodes[id])
  const ops = copying(e)
    ? g.copies.filter((id) => before.nodes[id]).flatMap((id) => cloneOps(before, id, d).ops)
    : [...nodes.flatMap((n) => moveOps(before, n, d)), ...(e.altKey ? [] : wallFollowOps(before, nodes, d, registry))]
  const status = copying(e) ? t('Copy, {distance} away', { distance: formatLength(len(d)) }) : t('Move by {distance}', { distance: formatLength(len(d)) })
  return { ops, marker: target.marker, link: target.link, to, status }
}

/** Moves the selection, or leaves a copy, as shown. A copy keeps the tool going from the same point, for the next one. */
export function finishMove(c: Canvas, g: GestureOf<'displace'>, world: Vec2, e: MoveKeys): void {
  const again = copying(e)
  if (preview(moveAim(c, g, world, e).ops)) commit()
  else cancel()
  useStore.setState({ drawLocks: {}, drawLive: null, axisLock: null })
  if (again) return
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
}

/** Two clicks: the point to move by, and where it goes. With nothing selected, a click picks what to move. */
export const moveToolDown: Press = (c, e, _at, world) => {
  const s = get()
  const g = c.gesture
  if (g.kind === 'displace') return finishMove(c, g, world, e)
  if (s.selection.length === 0) {
    const hit = hitTest(c.scene, world, 5 / s.view.zoom)
    if (hit) select([hit.id])
    return
  }
  // The point taken may be one of what is moved: a corner of it, its middle, its centre.
  c.gesture = { kind: 'displace', ids: [...s.selection], copies: withPaperContents(s.selection), from: snap(c, world, e, []).p }
}

export const displaceMove: Move<'displace'> = (c, g, e, _at, world, out) => {
  const aimed = moveAim(c, g, world, e)
  out.previewed = preview(aimed.ops)
  out.marker = aimed.marker
  if (aimed.link) out.link = aimed.link
  out.status = aimed.status
  out.measure = { a: g.from, b: aimed.to }
  const d = sub(aimed.to, g.from)
  out.live = { a: len(d), b: (-Math.atan2(d.y, d.x) * 180) / Math.PI }
}
