import {
  add,
  alignMove,
  boundsOfPoints,
  dist,
  frameContains,
  frameGrips,
  frameMiddle,
  hitTest,
  itemsInside,
  itemsTouching,
  kindOf,
  moveCornerOps,
  moveGuides,
  moveOps,
  norm,
  openingSpan,
  paperScaleTo,
  resizeFrame,
  resizePatch,
  rotate,
  snapOpeningToWall,
  snapTo,
  sub,
  transformOps,
  wallEdgeLines,
  wallEndFollowOps,
  wallEndsAt,
  wallEndsOf,
  wallFollowOps,
  wallSpot,
  wallThicknessOps,
  type Modifier,
  type Node,
  type Op,
  type Vec2,
} from '@opencalque/core'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { usePrefs } from '../../prefs'
import { commit, preview, select, selectCorner, useStore, cancel } from '../../store'
import { gridStep } from '../../view'
import { formatLength, formatNumber } from '../../units'
import { heldNearest, lineEnd, snap, squareFrom, type Target } from '../aim'
import { ALIGN_REACH, SNAP_REACH, type GestureOf } from '../gesture'
import { clearanceAt, cornerAt, endAt, faceAt, looseEndAt, frameCornerAt, frameCursor, frameGripAt, gripAt, gripBox, handleAt, lineUp, titleAt } from '../picking'
import { get, type Canvas, type Move, type Press, type Release } from '../runtime'
import { faceAcross, faceOf, paperLabel, resizeCursor, round, sizes, thicknessLabel, thicknessStep, wallNormal } from '../shapes'

/*
 * The select tool: what a press picks or takes hold of, and each drag that follows. Every drag is a
 * preview from the drawing as it was when the press came (`base`), committed on release.
 */

export const selectDown: Press = (c, e, at, world) => {
  const s = get()
  const { frame, ownBox } = c
  // A click on the length of a temporary dimension opens it, to type another (`ClearanceEditor`).
  const measuring = clearanceAt(c, at)
  if (measuring !== null) {
    useStore.setState({ measuring })
    return
  }
  const cropped = frameCornerAt(c, at)
  if (cropped) {
    c.gesture = { kind: 'crop', node: s.doc.nodes[s.selection[0]], index: cropped.index, fixed: cropped.outline[(cropped.corner + 2) % 4] }
    return
  }
  const framed = frameGripAt(c, at)
  if (framed !== null && frame) {
    if (framed === 'knob') {
      c.setGripCursor('grabbing')
      c.gesture = { kind: 'rotate', nodes: [frame.node], pivot: frame.centre, from: Math.atan2(world.y - frame.centre.y, world.x - frame.centre.x) }
    } else c.gesture = { kind: 'resize', node: frame.node, grip: framed }
    return
  }
  const grip = gripAt(c, at)
  if (grip) {
    const { box, corner } = grip
    const nodes = s.selection.map((id) => s.doc.nodes[id])
    const points = frameGrips(box).slice(0, 4)
    const middle = frameMiddle(box)
    if (corner === 'knob') c.setGripCursor('grabbing')
    // A turned object's own box turns with it; the box around anything else is turned by the gesture.
    c.gesture =
      corner === 'knob'
        ? { kind: 'rotate', nodes, pivot: middle, from: Math.atan2(world.y - middle.y, world.x - middle.x), box: ownBox ? undefined : box }
        : { kind: 'scale', nodes, pivot: points[(corner + 2) % 4], corner: points[corner] }
    return
  }
  // The line across an end of the selected wall (not the point on it): the end goes along the wall,
  // and the ends of the walls it meets there with it.
  const ending = endAt(c, at)
  if (ending) {
    const joined = wallEndsOf(s.doc, ending.wall, ending.end).flatMap(({ wall, end }) => (wall.id === ending.wall.id ? [] : [{ id: wall.id, end }]))
    c.gesture = { kind: 'end', wall: ending.wall, end: ending.end, joined }
    useStore.setState({ wallFace: 'end drag' })
    return
  }
  // The end of the selected wall where other walls end without being joined to it (it was set
  // loose, or it is a lining stopping against them) is that wall's own: the corner there is theirs,
  // and dragging it moves the selected wall alone.
  const loose = looseEndAt(c, at)
  if (loose >= 0) {
    c.gesture = { kind: 'handle', node: s.doc.nodes[s.selection[0]], index: loose }
    return
  }
  // A wall end is a corner of the plan, shared by the walls that meet there: pressing on one
  // selects the corner, and dragging takes them all. With Alt, only the wall that was selected.
  const corner = cornerAt(c, at)
  if (corner) {
    const alone = e.altKey && s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'wall' ? s.selection[0] : undefined
    selectCorner(corner)
    c.gesture = { kind: 'corner', from: corner, only: alone }
    return
  }
  const index = handleAt(c, at)
  if (index >= 0) {
    c.gesture = { kind: 'handle', node: s.doc.nodes[s.selection[0]], index }
    return
  }
  const face = faceAt(c, at)
  if (face) {
    const moving = (wallThicknessOps(s.doc, face.wall, face.wall.thickness + 10, face.side, registry) ?? []).flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
    c.gesture = { kind: 'face', wall: face.wall, side: face.side, moving }
    useStore.setState({ wallFace: 'drag' })
    return
  }
  const hit = titleAt(c, at) ?? hitTest(c.scene, world, 5 / s.view.zoom)
  // On the drawing there is no "in between", so Shift and Ctrl (or Cmd) both add to or take from the selection.
  const adding = e.shiftKey || e.ctrlKey || e.metaKey
  if (!hit) {
    // The box around a selection is the selection: a press in an empty part of it, between the
    // things selected, takes hold of them all, as a right-click there is about them all. Only
    // a click that does not become a drag lets them go.
    const box = adding ? null : gripBox(c)
    if (box && frameContains(box, world, 6 / s.view.zoom)) {
      c.gesture = { kind: 'press', at, start: world, nodes: s.selection.map((id) => s.doc.nodes[id]), beside: true }
      return
    }
    if (!adding) select([])
    c.gesture = { kind: 'marquee', start: world, keep: adding ? s.selection : [] }
    return
  }
  let ids = s.selection
  if (adding) ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id]
  else if (!ids.includes(hit.id)) ids = [hit.id]
  select(ids)
  // A paper moves alone, over the drawing: that is how a sheet is put where it frames what it should.
  if (ids.includes(hit.id)) c.gesture = { kind: 'press', at, start: world, nodes: ids.map((id) => s.doc.nodes[id]) }
}

export const pressMove: Move<'press'> = (c, g, _e, at) => {
  if (dist(at, g.at) > 3) c.gesture = { kind: 'move', start: g.start, nodes: g.nodes, ...lineUp(c, g.nodes) }
}

export const moveMove: Move<'move'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const step = e.altKey ? 0.001 : gridStep(s.view.zoom)
  let d = { x: Math.round((world.x - g.start.x) / step) * step, y: Math.round((world.y - g.start.y) / step) * step }
  // A single door or window slides along walls instead of moving freely.
  const only = g.nodes.length === 1 ? g.nodes[0] : null
  const span = only && !e.altKey ? openingSpan(only, registry) : null
  if (only?.type === 'parametric' && span) {
    const target = { x: (span[0].x + span[1].x) / 2 + world.x - g.start.x, y: (span[0].y + span[1].y) / 2 + world.y - g.start.y }
    const onWall = snapOpeningToWall(s.base ?? s.doc, s.scope, registry, only, target, 10 / s.view.zoom, step, only.rotation ?? 0)
    if (onWall) {
      out.previewed = preview([{ op: 'update_node', id: only.id, patch: onWall }])
      return
    }
  }
  // What is moved lines up with what is around it, and keeps equal gaps with its neighbours;
  // along an axis where nothing is near enough for that, it goes by the grid.
  if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) {
    const fit = alignMove(g.moving, g.others, sub(world, g.start), ALIGN_REACH / s.view.zoom)
    d = { x: fit.x ? round(fit.d.x) : d.x, y: fit.y ? round(fit.d.y) : d.y }
  }
  // Held level or upright by an arrow key, it only moves that way; lining up still decides how far.
  if (s.axisLock) {
    d = s.axisLock === 'x' ? { x: d.x, y: 0 } : { x: 0, y: d.y }
    out.guide = { at: g.start, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  }
  if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) out.smart = moveGuides(g.moving, g.others, d)
  const before = s.base ?? s.doc
  // Walls joined to the ones being moved stretch to stay joined, and openings follow their wall. Alt moves only what was picked.
  out.previewed = preview([...g.nodes.flatMap((n) => moveOps(before, n, d)), ...(e.altKey ? [] : wallFollowOps(before, g.nodes, d, registry))])
}

export const handleMove: Move<'handle'> = (c, g, e, _at, world, out) => {
  const s = get()
  if (g.node.type === 'paper' && !e.altKey) {
    // A corner of a paper sets its scale: the sheet stays the sheet it is, so the corner keeps
    // to the diagonal, which is shown running across the view. Alt gives it any size instead.
    const patch = paperScaleTo(g.node, g.index, world)
    const fixed = kindOf(g.node).handles!(g.node, registry)[(g.index + 2) % 4]
    out.guide = { at: fixed, angle: Math.atan2(g.node.height, g.node.width) * (g.index % 2 === 0 ? 1 : -1) }
    out.labels = paperLabel(patch)
    out.status = out.labels[0].text
    out.previewed = preview([{ op: 'update_node', id: g.node.id, patch }])
    return
  }
  // Shift holds the end of a wall or a line to the line it already lies on, or to a level, upright
  // or 45° line through its other end, whichever the pointer is nearer: that line is shown running across the view.
  const ends = 'a' in g.node && 'b' in g.node && g.index < 2 ? { moved: g.index === 0 ? g.node.a : g.node.b, fixed: g.index === 0 ? g.node.b : g.node.a } : null
  const own = ends && dist(ends.moved, ends.fixed) > 1e-6 ? [{ at: ends.fixed, angle: Math.atan2(ends.moved.y - ends.fixed.y, ends.moved.x - ends.fixed.x) }] : []
  const held = e.shiftKey && ends ? heldNearest(c, world, [...own, ...squareFrom(ends.fixed)], [g.node.id]) : null
  // The end that stays put is where a perpendicular onto another line would be dropped from.
  // Held level or upright by an arrow key, the point stays on that line through where it was,
  // and may be brought level with something pointed at elsewhere.
  const was = s.axisLock ? kindOf(g.node).handles?.(g.node, registry)[g.index] : undefined
  const target: Target = was ? lineEnd(c, world, e, [g.node.id], was) : held ? held.target : snap(c, world, { altKey: e.altKey, shiftKey: false }, [g.node.id], ends?.fixed)
  if (was && s.axisLock) out.guide = { at: was, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  else if (held) out.guide = held.line
  out.link = target.link
  out.marker = target.marker
  // The other walls that end at a wall's corner come along with it, unless Alt is held.
  const joined = e.altKey ? [] : wallEndFollowOps(s.base ?? s.doc, g.node, g.index, target.p)
  out.previewed = preview([{ op: 'update_node', id: g.node.id, patch: kindOf(g.node).moveHandle!(g.node, g.index, target.p, registry) }, ...joined])
}

export const cornerMove: Move<'corner'> = (c, g, e, _at, world, out) => {
  const s = get()
  // Nothing has moved until the pointer has: a press on a corner only selects it.
  const before = s.base ?? s.doc
  const ends = wallEndsAt(before, s.scope, g.from)
  // Shift holds the corner to the line of one of the walls that meet there (of the wall itself, for
  // a free end), or to a level, upright or 45° line through the other end of one of them, so that
  // the wall comes level or upright: whichever line the pointer is nearest to, shown across the view.
  const lines = ends.flatMap(({ wall, end }) => [{ at: g.from, angle: Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) }, ...squareFrom(end === 'a' ? wall.b : wall.a)])
  const held = e.shiftKey && !s.axisLock && lines.length > 0 ? heldNearest(c, world, lines, ends.map((end) => end.wall.id)) : null
  const target: Target = s.axisLock ? lineEnd(c, world, e, ends.map((end) => end.wall.id), g.from) : held ? held.target : snap(c, world, e, ends.map((end) => end.wall.id))
  if (s.axisLock) out.guide = { at: g.from, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  else if (held) out.guide = held.line
  out.link = target.link
  out.marker = target.marker
  if (dist(target.p, g.from) < 1e-6) {
    cancel()
    return
  }
  const ops = moveCornerOps(before, s.scope, g.from, target.p).filter((op) => !g.only || (op.op === 'update_node' && op.id === g.only))
  out.previewed = preview(ops)
  if (out.previewed) useStore.setState({ corner: g.only ? null : target.p })
}

export const faceMove: Move<'face'> = (c, g, e, _at, world, out) => {
  const s = get()
  // The face follows the pointer across the wall, or a point or line of something else the
  // pointer is near, to line it up; otherwise the thickness goes by steps that suit the zoom.
  // Alt, as everywhere, leaves out both. With Ctrl (Cmd on a Mac) the wall grows both ways,
  // its middle line staying put, as Ctrl resizes from the middle in office programs.
  const both = e.ctrlKey || e.metaKey
  const hit = !e.altKey && usePrefs.getState().snapToObjects ? snapTo(c.scene, world, SNAP_REACH / s.view.zoom, { exclude: g.moving }) : null
  const across = wallSpot(g.wall, hit ? hit.p : world).across
  // From the face that stays to the pointer; or, both ways, twice as far as the pointer is from the middle of the thickness.
  const middle = (faceAcross(g.wall, 'right') + faceAcross(g.wall, 'left')) / 2
  const raw = both ? 2 * Math.abs(across - middle) : g.side === 'right' ? across - faceAcross(g.wall, 'left') : faceAcross(g.wall, 'right') - across
  const step = thicknessStep(s.view.zoom)
  const thickness = Math.max(1, hit || e.altKey ? round(raw) : Math.round(raw / step) * step)
  if (hit) out.marker = { p: hit.p, kind: hit.kind }
  const ops = wallThicknessOps(s.base ?? s.doc, g.wall, thickness, both ? null : g.side, registry)
  if (ops) out.previewed = preview(ops)
  const now = get().doc.nodes[g.wall.id]
  if (now?.type === 'wall') {
    out.face = faceOf(now, get().doc, g.side)
    out.labels = [thicknessLabel(now, g.side)]
    out.status = t('Thickness {value}', { value: formatLength(now.thickness) })
  }
}

export const endMove: Move<'end'> = (c, g, e, _at, world, out) => {
  const s = get()
  // The end goes along the wall, the other staying where it is: to a point or a line of
  // something else the pointer is near, or by lengths that suit the zoom. Alt, as everywhere,
  // leaves out both. The wall keeps its direction, and so its doors and windows their places; the
  // walls it meets at that end follow it, to stay joined.
  const fixed = g.end === 'a' ? g.wall.b : g.wall.a
  const along = norm(sub(g.wall[g.end], fixed))
  const hit = !e.altKey && usePrefs.getState().snapToObjects ? snapTo(c.scene, world, SNAP_REACH / s.view.zoom, { exclude: [g.wall.id, ...g.joined.map((other) => other.id)] }) : null
  const target = hit ? hit.p : world
  const raw = (target.x - fixed.x) * along.x + (target.y - fixed.y) * along.y
  const step = gridStep(s.view.zoom)
  const length = Math.max(1, hit || e.altKey ? round(raw) : Math.round(raw / step) * step)
  const p = { x: fixed.x + along.x * length, y: fixed.y + along.y * length }
  if (hit) out.marker = { p: hit.p, kind: hit.kind }
  out.previewed = preview([g.wall.id, ...g.joined.map((other) => other.id)].map((id, i): Op => ({ op: 'update_node', id, patch: { [i === 0 ? g.end : g.joined[i - 1].end]: p } })))
  const now = get().doc.nodes[g.wall.id]
  if (now?.type === 'wall') out.face = wallEdgeLines(now, get().doc, registry, g.end)
  out.labels = sizes('wall', fixed, p).labels
  out.status = t('Length {value}', { value: formatLength(length) })
}

export const cropMove: Move<'crop'> = (c, g, e, _at, world, out) => {
  const target = snap(c, world, e, [g.node.id])
  out.marker = target.marker
  const width = Math.max(1, Math.abs(target.p.x - g.fixed.x))
  const height = Math.max(1, Math.abs(target.p.y - g.fixed.y))
  const modifiers = (g.node.modifiers ?? []).map((m, i): Modifier => (i === g.index ? { ...m, params: { ...m.params, width, height }, frame: { x: Math.min(target.p.x, g.fixed.x), y: Math.min(target.p.y, g.fixed.y) } } : m))
  out.previewed = preview([{ op: 'update_node', id: g.node.id, patch: { modifiers } }])
  out.status = `${formatNumber(width)} × ${formatLength(height)}`
}

export const resizeMove: Move<'resize'> = (c, g, e, _at, world, out) => {
  const s = get()
  // The grip follows the pointer, snapped as a point would be; Shift keeps the proportions from a corner.
  const target = snap(c, world, { altKey: e.altKey, shiftKey: false }, [g.node.id])
  out.marker = target.marker
  const patch = resizePatch(g.node, g.grip, target.p, e.shiftKey, registry, s.base ?? s.doc)
  if (patch) {
    out.previewed = preview([{ op: 'update_node', id: g.node.id, patch }])
    // The box as it now is, rounded as the object rounds it (a stair to whole steps).
    const size = resizeFrame({ ...g.node, ...patch } as Node, registry, s.base ?? s.doc)
    if (size) out.status = `${formatLength(size.width)} × ${formatLength(size.height)}`
  }
}

export const scaleMove: Move<'scale'> = (_c, g, e, _at, world, out) => {
  const s = get()
  // How far along the box's diagonal the pointer is, measured from the corner that stays put.
  const diagonal = sub(g.corner, g.pivot)
  const along = ((world.x - g.pivot.x) * diagonal.x + (world.y - g.pivot.y) * diagonal.y) / (diagonal.x ** 2 + diagonal.y ** 2 || 1)
  // In steps of 5% unless Alt is held; never down to nothing.
  const factor = Math.max(0.05, e.altKey ? along : Math.round(along * 20) / 20)
  out.previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, scale: factor }, registry))
  out.status = t('Scale {percent} %', { percent: String(Math.round(factor * 1000) / 10) })
}

export const rotateMove: Move<'rotate'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const raw = ((Math.atan2(world.y - g.pivot.y, world.x - g.pivot.x) - g.from) * 180) / Math.PI
  // Whole degrees; Shift keeps to steps of 15, Alt turns freely.
  const step = e.shiftKey ? 15 : e.altKey ? 0.01 : 1
  const degrees = Math.round(raw / step) * step
  out.previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, rotation: degrees }, registry))
  // The box turns with what it holds, its knob staying with the pointer, rather than growing around it.
  if (g.box) out.turning = { ...g.box, origin: add(g.pivot, rotate(sub(g.box.origin, g.pivot), degrees)), rotation: g.box.rotation + degrees }
  out.status = t('Rotation {degrees}°', { degrees: String(Math.round((((degrees % 360) + 360) % 360) * 100) / 100) })
}

/** As in CAD, a box dragged leftwards picks up what it touches, and one dragged rightwards what lies wholly inside it. */
const crossing = (g: GestureOf<'marquee'>, world: Vec2) => world.x < g.start.x

/** What the box from where the drag started to `world` selects, with what was kept. */
function boxed(c: Canvas, g: GestureOf<'marquee'>, world: Vec2): string[] {
  const box = boundsOfPoints([g.start, world])!
  const found = crossing(g, world) ? itemsTouching(c.scene, box) : itemsInside(c.scene, box)
  return [...new Set([...g.keep, ...found.map((item) => item.id)])]
}

/** Shows what the box would select while it is being dragged, not only on release. */
export const marqueeMove: Move<'marquee'> = (c, g, _e, _at, world, out) => {
  const s = get()
  const next = boxed(c, g, world)
  if (next.length !== s.selection.length || next.some((id, i) => id !== s.selection[i])) select(next)
  out.marquee = { a: g.start, b: world, crossing: crossing(g, world) }
  out.status = crossing(g, world) ? t('Selects what the box touches') : t('Selects what is wholly inside the box')
}

/**
 * With nothing in progress, the pointer says what a press there would do: resize along a diagonal,
 * turn, move a point, make a wall thicker by its face or longer by its end.
 */
export const hover: Move<'idle'> = (c, _g, _e, at, world, out) => {
  const s = get()
  const { handles } = c
  const framed = frameCornerAt(c, at) ? null : frameGripAt(c, at)
  const grip = framed !== null ? null : (frameCornerAt(c, at) ?? gripAt(c, at))
  // On the line across a free end of the selected wall, a press makes it longer or shorter.
  const ending = framed === null && !grip ? endAt(c, at) : null
  const onCorner = s.tool === 'select' && framed === null && !grip && !ending && cornerAt(c, at) !== null
  const own = onCorner ? 0 : s.tool === 'select' ? handleAt(c, at) : -1
  const boxed = ['rect', 'paper'].includes(s.doc.nodes[s.selection[0]]?.type ?? '')
  const diagonal = (corner: number, turn = 0) => resizeCursor(rotate({ x: corner === 1 || corner === 2 ? 1 : -1, y: corner >= 2 ? 1 : -1 }, turn))
  const stretched = s.doc.nodes[s.selection[0]]?.type === 'parametric' && handles.length === 2
  const pointer = ending ? resizeCursor(sub(ending.wall.b, ending.wall.a)) : framed !== null ? (framed === 'knob' ? 'grab' : frameCursor(c, framed)) : grip ? (grip.corner === 'knob' ? 'grab' : diagonal(grip.corner, 'box' in grip ? grip.box.rotation : 0)) : own >= 0 ? (boxed ? diagonal(own) : stretched ? resizeCursor(sub(handles[1], handles[0])) : 'move') : null
  // On a face of the selected wall, a press makes it thicker or thinner: the face is shown, and the pointer says across.
  const faced = pointer === null ? faceAt(c, at) : null
  if (faced) out.face = faceOf(faced.wall, s.doc, faced.side)
  if (ending) out.face = wallEdgeLines(ending.wall, s.doc, registry, ending.end)
  // On the length of a temporary dimension, a press opens it to type another (`clearanceAt` is asked first).
  const measuring = s.tool === 'select' ? clearanceAt(c, at) : null
  if (measuring !== null) out.clearanceHover = measuring
  const shown = measuring !== null ? 'pointer' : (pointer ?? (faced ? resizeCursor(wallNormal(faced.wall, world)) : null))
  if (shown !== c.gripCursor) c.setGripCursor(shown)
  const over = ending ? 'end hover' : faced ? 'hover' : null
  if (s.wallFace !== over) useStore.setState({ wallFace: over })
}

export const pressUp: Release<'press'> = (c, g) => {
  if (g.beside) select([])
  c.gesture = { kind: 'idle' }
}

/** Ends any drag of the select tool: what it previewed becomes one step to undo. */
export function dragUp(c: Canvas): void {
  const s = get()
  // The box has changed under the pointer; the next movement works out what is there now.
  c.setGripCursor(null)
  if (s.axisLock) useStore.setState({ axisLock: null })
  if (s.wallFace) useStore.setState({ wallFace: null })
  // The points rested on were for this drag; the next starts afresh.
  c.tracked = { tool: s.tool, points: [], resting: null }
  commit()
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
}

export const marqueeUp: Release<'marquee'> = (c, g, _e, _at, world) => {
  select(boxed(c, g, world))
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
}
