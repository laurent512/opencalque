import {
  add,
  elevationEdges,
  elevationItemAt,
  elevationItemsOf,
  viewShows,
  elevationSideOps,
  elevationSplitOps,
  type MoveGuides,
  nearestEdge,
  elevationMovePatch,
  heightAboveFloor,
  isLocked,
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
  moveViewCorner,
  perp,
  keptViewPatch,
  boundsContainPoint,
  moveGuides,
  type MoveSnap,
  moveOps,
  norm,
  openingSpan,
  paperScaleTo,
  resizeFrame,
  resizePatch,
  rotate,
  moveAgainstWall,
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
import { msg, t } from '../../i18n'
import { usePrefs } from '../../prefs'
import { commit, preview, select, selectCorner, useStore, cancel } from '../../store'
import { gridStep } from '../../view'
import { formatLength, formatNumber } from '../../units'
import { heldNearest, lineEnd, snap, squareFrom, type Target } from '../aim'
import { ALIGN_REACH, MOUNT_REACH, SNAP_REACH, TOUCH_REACH, type ElevationEdges, type GestureOf } from '../gesture'
import { clearanceAt, cornerAt, endAt, faceAt, looseEndAt, frameCornerAt, frameCursor, frameGripAt, gripAt, gripBox, handleAt, inViewGripAt, inViewSplitAt, lineUp, pointedAt, titleAt, viewEdgeAt, viewLineHandleAt } from '../picking'
import { get, type Canvas, type Move, type Press, type Release } from '../runtime'
import { logMoveEnd, logMoveStart, logMoveStep } from '../snapLog'
import { faceAcross, faceOf, paperLabel, resizeCursor, round, sizes, thicknessLabel, thicknessStep, wallNormal } from '../shapes'

/*
 * The select tool: what a press picks or takes hold of, and each drag that follows. Every drag is a
 * preview from the drawing as it was when the press came (`base`), committed on release.
 */

/** The points of a polyline on either side of its point `i`, round past its ends when it is closed. */
function neighbours(points: Vec2[], i: number, closed: boolean): Vec2[] {
  const n = points.length
  return [i - 1, i + 1].flatMap((j) => {
    const k = closed ? (j + n) % n : j
    return k >= 0 && k < n && k !== i ? [points[k]] : []
  })
}

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
  // The selected view line's own points and edges come first: its far corners lie at the corners of a room.
  const corner = viewLineHandleAt(c, at) ? null : cornerAt(c, at)
  if (corner) {
    const alone = e.altKey && s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'wall' ? s.selection[0] : undefined
    selectCorner(corner)
    c.gesture = { kind: 'corner', from: corner, only: alone }
    return
  }
  const index = handleAt(c, at)
  if (index >= 0) {
    const node = s.doc.nodes[s.selection[0]]
    // An end of a view line is taken by its arrow, anywhere along it: the end keeps that far from the pointer.
    const end = node.type === 'elevation' && (index === 1 || index === 2) ? (index === 1 ? node.a : node.b) : null
    c.gesture = { kind: 'handle', node, index, ...(end ? { grab: sub(world, end) } : {}) }
    return
  }
  const face = faceAt(c, at)
  if (face) {
    const moving = (wallThicknessOps(s.doc, face.wall, face.wall.thickness + 10, face.side, registry) ?? []).flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
    c.gesture = { kind: 'face', wall: face.wall, side: face.side, moving }
    useStore.setState({ wallFace: 'drag' })
    return
  }
  // A socket, a switch, a door shown in an elevation is the one of the plan: pressed there, it is
  // selected, and dragged, it moves on the plan, along its wall and up or down.
  // A side of what is selected, where a view shows it, dragged: the side across stays where it is.
  const side = e.shiftKey || e.ctrlKey || e.metaKey ? null : inViewGripAt(c, at)
  if (side) {
    c.gesture = { kind: 'grip', view: side.view, item: side.item, side: side.side, start: world, edges: elevationEdges(side.view, s.doc, registry, side.item.node.id) }
    return
  }
  // A line across it there (a tall unit's between two sections), dragged up and down.
  const split = e.shiftKey || e.ctrlKey || e.metaKey ? null : inViewSplitAt(c, at)
  if (split) {
    c.gesture = { kind: 'split', ...split, start: world, edges: elevationEdges(split.view, s.doc, registry, split.item.node.id) }
    return
  }
  const shown = e.shiftKey || e.ctrlKey || e.metaKey ? null : elevationAt(c, world)
  if (shown) {
    select([shown.item.node.id])
    const edges = elevationEdges(shown.view, s.doc, registry, shown.item.node.id)
    c.gesture = { kind: 'elevated', view: shown.view, node: shown.item.node, start: world, role: shown.item.role, raises: shown.item.raises, box: shown.item.box, levels: shown.item.levels, edges }
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
  // A view pressed by its line or its eye on the plan, not by its picture: Properties opens on its
  // line of view or its camera (`viewPart`).
  const byLine = hit.node.type === 'camera' || (hit.node.type === 'elevation' && (hit.foreign || (!!hit.bounds && !boundsContainPoint(hit.bounds, world))))
  if (!adding && ids.length === 1 && byLine) useStore.setState({ viewPart: 'line' })
  // Dragged by its line, an elevation's line moves across, as by its edge (7), and the drawing stays where it is.
  if (!adding && byLine && hit.node.type === 'elevation' && kindOf(hit.node).handles!(hit.node, registry, s.doc).length === 10) {
    c.gesture = { kind: 'handle', node: hit.node, index: 7 }
    return
  }
  // A paper moves alone, over the drawing: that is how a sheet is put where it frames what it should.
  if (ids.includes(hit.id)) c.gesture = { kind: 'press', at, start: world, nodes: ids.map((id) => s.doc.nodes[id]) }
}

export const pressMove: Move<'press'> = (c, g, _e, at) => {
  if (dist(at, g.at) <= 3) return
  const lined = lineUp(c, g.nodes)
  c.gesture = { kind: 'move', start: g.start, nodes: g.nodes, ...lined }
  const { view, base, doc } = get()
  logMoveStart(base ?? doc, g.nodes, lined.moving, lined.others, view.zoom, ALIGN_REACH / view.zoom, TOUCH_REACH / view.zoom)
}

export const moveMove: Move<'move'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const step = e.altKey || !usePrefs.getState().snapToGrid ? 0.001 : gridStep(s.view.zoom, s.doc.settings?.grid)
  let d = { x: Math.round((world.x - g.start.x) / step) * step, y: Math.round((world.y - g.start.y) / step) * step }
  // A single door or window slides along walls instead of moving freely.
  const only = g.nodes.length === 1 ? g.nodes[0] : null
  const span = only && !e.altKey ? openingSpan(only, registry) : null
  if (only?.type === 'parametric' && span) {
    const target = { x: (span[0].x + span[1].x) / 2 + world.x - g.start.x, y: (span[0].y + span[1].y) / 2 + world.y - g.start.y }
    const onWall = snapOpeningToWall(s.base ?? s.doc, s.scope, registry, only, target, 10 / s.view.zoom, step, only.rotation ?? 0)
    if (onWall) {
      logMoveStep(s.base ?? s.doc, g.others, sub(world, g.start), { x: (onWall.x ?? only.x) - only.x, y: (onWall.y ?? only.y) - only.y }, 'a door or window, put on the nearest wall')
      out.previewed = preview([{ op: 'update_node', id: only.id, patch: onWall }])
      return
    }
  }
  // Something fixed on walls, or standing against them, goes against the wall its box comes near,
  // whichever way it faced and wherever it was taken, and along the wall against the units and the
  // walls beside it, nothing else (`moveAgainstWall`).
  if (only?.type === 'parametric' && !e.altKey && g.moving) {
    const lining = usePrefs.getState().snapToObjects
    const before = s.base ?? s.doc
    const against = moveAgainstWall(before, s.scope, registry, only, g.moving, lining ? g.others : [], sub(world, g.start), MOUNT_REACH / s.view.zoom, TOUCH_REACH / s.view.zoom, step)
    if (against) {
      const { patch, why, row } = against
      const moved = { x: patch.x - only.x, y: patch.y - only.y }
      const how = `against the face of the nearest wall${lining ? `, along it against what is beside it (${row.length} things in sight: units and walls)` : ', snapping to objects is off'}`
      logMoveStep(before, row, sub(world, g.start), moved, how, { d: moved, x: false, y: false, why: { x: why?.axis === 'x' ? why : null, y: why?.axis === 'y' ? why : null } })
      out.previewed = preview([{ op: 'update_node', id: only.id, patch }])
      return
    }
  }
  // What is moved lines up with what is around it, and keeps equal gaps with its neighbours;
  // along an axis where nothing is near enough for that, it goes by the grid.
  let fit: MoveSnap | undefined
  if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) {
    fit = alignMove(g.moving, g.others, sub(world, g.start), ALIGN_REACH / s.view.zoom, TOUCH_REACH / s.view.zoom)
    d = { x: fit.x ? round(fit.d.x) : d.x, y: fit.y ? round(fit.d.y) : d.y }
  }
  // Held level or upright by an arrow key, it only moves that way; lining up still decides how far.
  if (s.axisLock) {
    d = s.axisLock === 'x' ? { x: d.x, y: 0 } : { x: 0, y: d.y }
    out.guide = { at: g.start, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  }
  if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) out.smart = moveGuides(g.moving, g.others, d)
  const before = s.base ?? s.doc
  const how = e.altKey ? 'Alt held: no lining up' : !usePrefs.getState().snapToObjects ? 'snapping to objects is off' : !g.moving ? 'nothing to line up by' : `lined up${step >= 1 ? `, else by grid steps of ${step} mm` : ', else free'}`
  logMoveStep(before, g.others, sub(world, g.start), d, s.axisLock ? `${how}; held along ${s.axisLock} by an arrow key` : how, fit)
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
  // What stays put beside the point dragged: the other end of a wall or a line, the points on
  // either side of a point of a polyline (not of a curve, whose stretches are not straight).
  const ends = 'a' in g.node && 'b' in g.node && g.index < 2 ? { moved: g.index === 0 ? g.node.a : g.node.b, fixed: g.index === 0 ? g.node.b : g.node.a } : null
  const node = g.node
  const beside = ends
    ? { moved: ends.moved, fixed: [ends.fixed] }
    : node.type === 'polyline' && !node.smooth && node.points[g.index]
      ? { moved: node.points[g.index], fixed: neighbours(node.points, g.index, !!node.closed) }
      : null
  // Shift holds the point to the line it already lies on, or to a level, upright or 45° line
  // through a point beside it, whichever the pointer is nearer: that line is shown running across the view.
  const own = (beside?.fixed ?? []).filter((q) => dist(beside!.moved, q) > 1e-6).map((q) => ({ at: q, angle: Math.atan2(beside!.moved.y - q.y, beside!.moved.x - q.x) }))
  const held = e.shiftKey && beside && beside.fixed.length > 0 ? heldNearest(c, world, [...own, ...beside.fixed.flatMap(squareFrom)], [g.node.id]) : null
  // The point also snaps onto the way it already goes from there, shown dashed, to make a line longer or shorter only.
  const carriedOn = ['line', 'wall', 'divider', 'gridline', 'polyline'].includes(g.node.type) ? own.map(({ at }) => ({ from: at, dir: norm(sub(beside!.moved, at)) })) : []
  // The points beside it are where a perpendicular onto another line would be dropped from.
  // Held level or upright by an arrow key, the point stays on that line through where it was,
  // and may be brought level with something pointed at elsewhere.
  const was = s.axisLock ? kindOf(g.node).handles?.(g.node, registry, s.base ?? s.doc)[g.index] : undefined
  // Taken by an arrow away from its point, it goes by the grid (Alt: exactly where the pointer says).
  const step = e.altKey || !usePrefs.getState().snapToGrid ? 0 : gridStep(s.view.zoom, s.doc.settings?.grid)
  const grabbed = g.grab && sub(world, g.grab)
  const target: Target = grabbed
    ? { p: step > 0 ? { x: Math.round(grabbed.x / step) * step, y: Math.round(grabbed.y / step) * step } : grabbed, marker: null }
    : was
      ? lineEnd(c, world, e, [g.node.id], was)
      : held
        ? held.target
        : snap(c, world, { altKey: e.altKey, shiftKey: false }, [g.node.id], beside?.fixed, carriedOn)
  if (was && s.axisLock) out.guide = { at: was, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  else if (held) out.guide = held.line
  out.link = target.link
  out.marker = target.marker
  // The other walls that end at a wall's corner come along with it, unless Alt is held.
  const joined = e.altKey ? [] : wallEndFollowOps(s.base ?? s.doc, g.node, g.index, target.p)
  // A corner of what a view's line sees turns it about the corner across; with Shift, it keeps its
  // way and sets its depth. The view keeps what it still shows where it was on the sheet (`keptViewPatch`).
  const patch = g.node.type === 'elevation' && g.index >= 3 && g.index <= 6 ? keptViewPatch(g.node, moveViewCorner(g.node, (g.index - 3) as 0 | 1 | 2 | 3, target.p, e.shiftKey ? 'stretch' : 'turn')) : kindOf(g.node).moveHandle!(g.node, g.index, target.p, registry, s.base ?? s.doc)
  out.previewed = preview([{ op: 'update_node', id: g.node.id, patch }, ...joined])
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
  const hit = !e.altKey && usePrefs.getState().snapToObjects ? snapTo(c.snappable, world, SNAP_REACH / s.view.zoom, { exclude: g.moving }) : null
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
  const hit = !e.altKey && usePrefs.getState().snapToObjects ? snapTo(c.snappable, world, SNAP_REACH / s.view.zoom, { exclude: [g.wall.id, ...g.joined.map((other) => other.id)] }) : null
  const target = hit ? hit.p : world
  const raw = (target.x - fixed.x) * along.x + (target.y - fixed.y) * along.y
  const step = gridStep(s.view.zoom, s.doc.settings?.grid)
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
  // The grip follows the pointer, snapped as a point would be. From a corner the proportions are
  // kept as the Properties panel keeps them (`keepProportions`), and Shift does the other.
  const target = snap(c, world, { altKey: e.altKey, shiftKey: false }, [g.node.id])
  out.marker = target.marker
  const keep = e.shiftKey !== usePrefs.getState().keepProportions
  const patch = resizePatch(g.node, g.grip, target.p, keep, registry, s.base ?? s.doc)
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
/**
 * The object of the plan that an elevation on the drawing shows under the pointer, and that
 * elevation; locked ones are left out. Only in a view that is open: selected, or showing what is
 * selected (picked in it, or on the plan). In any other, the first press takes the view, and a drag
 * moves it, as a 3D view's does and a group's first click does (the owner's choice); the next goes
 * into it.
 */
function elevationAt(c: Canvas, world: Vec2) {
  const s = get()
  const selected = new Set(s.selection)
  for (const item of c.scene) {
    // Inside a view, its drawing (`viewBackdrop`) is the ground drawn on, not a view to pick in.
    if (item.node.type !== 'elevation' || item.id !== item.node.id) continue
    if (!selected.has(item.id) && !viewShows(item.node, s.doc, registry, selected)) continue
    const found = elevationItemAt(item.node, s.doc, registry, world, 3 / s.view.zoom)
    if (found && !isLocked(s.doc, found.node) && !isLocked(s.doc, item.node)) return { view: item.node, item: found }
  }
  return null
}

/**
 * How far something dragged `raw` mm one way in an elevation goes: so far that one of its edges
 * (`pairs`: edges of it, and what each may land on) lands on the nearest within `reach`, else by whole
 * steps of the grid; `free` (Alt, or lining up turned off) lines up with nothing. And where it landed.
 */
function lineUpInView(raw: number, pairs: [number[], number[]][], reach: number, step: number, free: boolean): { delta: number; at: number | null } {
  let best: { delta: number; at: number } | null = null
  if (!free) {
    for (const [own, targets] of pairs) {
      const hit = nearestEdge(own.map((edge) => edge + raw), targets, reach)
      if (hit && (!best || Math.abs(hit.delta) < Math.abs(best.delta))) best = hit
    }
  }
  return best ? { delta: raw + best.delta, at: best.at } : { delta: Math.round(raw / step) * step, at: null }
}

/** The lines shown where something dragged in an elevation lined up: upright at `x`, level at `y`, across what the view draws. */
function viewGuides(edges: ElevationEdges, x: number | null, y: number | null): MoveGuides | undefined {
  const lines: [Vec2, Vec2][] = []
  if (x !== null) lines.push([{ x, y: Math.min(...edges.ys) }, { x, y: Math.max(...edges.ys) }])
  if (y !== null) lines.push([{ x: Math.min(...edges.xs), y }, { x: Math.max(...edges.xs), y }])
  return lines.length > 0 ? { lines, gaps: [] } : undefined
}

/** How what is dragged in an elevation goes: the grid's steps (none with Alt or the grid off), whether it lines up (not with Alt), and how near. */
function viewSteps(e: { altKey: boolean }) {
  const s = get()
  return {
    step: e.altKey || !usePrefs.getState().snapToGrid ? 0.001 : gridStep(s.view.zoom),
    free: e.altKey || !usePrefs.getState().snapToObjects,
    reach: SNAP_REACH / s.view.zoom,
  }
}

/**
 * An object dragged in an elevation: across the view along its wall and, for what can be raised, up
 * and down. Its sides and its middle line up with those of what is beside it, its top, its bottom and
 * the level lines drawn across it with theirs, the walls' and the floor, else it goes by whole steps of the grid. Shift keeps it to
 * whichever way it went further; Alt lines up with nothing and leaves the grid. Its height is said as it goes.
 */
export const elevatedMove: Move<'elevated'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const { step, free, reach } = viewSteps(e)
  const { box, edges } = g
  const middle = (box.minX + box.maxX) / 2
  const across = lineUpInView(world.x - g.start.x, [[[box.minX, box.maxX], edges.xs], [[middle], edges.middles]], reach, step, free)
  const upright = g.raises ? lineUpInView(world.y - g.start.y, [[[box.minY, box.maxY, ...g.levels], edges.ys]], reach, step, free) : { delta: 0, at: null }
  let [ds, dh] = [across.delta, -upright.delta]
  let [x, y] = [across.at, upright.at]
  if (e.shiftKey) {
    if (Math.abs(world.x - g.start.x) >= Math.abs(world.y - g.start.y)) [dh, y] = [0, null]
    else [ds, x] = [0, null]
  }
  const before = s.base ?? s.doc
  const patch = elevationMovePatch(g.view, before, registry, g.node, ds, dh)
  if (!patch) return
  out.previewed = preview([{ op: 'update_node', id: g.node.id, patch }])
  out.smart = viewGuides(edges, x, y)
  if (g.role !== 'opening') out.status = t('{height} above the floor', { height: formatLength(Number('z' in patch ? (patch.z ?? 0) : (heightAboveFloor(g.node, registry) ?? 0))) })
  else if (g.raises && g.node.type === 'parametric') {
    const kind = registry.parametric.get(g.node.kind)
    const sill = kind?.sill
    const props = registry.resolveProps(kind!, (patch.props ?? g.node.props) as Record<string, unknown>)
    if (sill) out.status = t('Sill {height} above the floor', { height: formatLength(Number(props[sill])) })
  }
}

/**
 * A side of the box an elevation draws an object in, dragged (`elevationSideOps`): it lines up with
 * the sides, tops and bottoms of what is beside it, the walls and the floor, else goes by whole steps
 * of the grid; Alt lines up with nothing and leaves the grid. Its size in the view is said as it goes.
 */
export const gripMove: Move<'grip'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const { step, free, reach } = viewSteps(e)
  const { box } = g.item
  const sideways = g.side === 'left' || g.side === 'right'
  const edge = g.side === 'left' ? box.minX : g.side === 'right' ? box.maxX : g.side === 'top' ? box.minY : box.maxY
  const moved = lineUpInView(sideways ? world.x - g.start.x : world.y - g.start.y, [[[edge], sideways ? g.edges.xs : g.edges.ys]], reach, step, free)
  const ops = elevationSideOps(g.view, s.base ?? s.doc, registry, g.item, g.side, sideways ? moved.delta : -moved.delta)
  if (!ops) return
  out.previewed = preview(ops)
  out.smart = viewGuides(g.edges, sideways ? moved.at : null, sideways ? null : moved.at)
  const now = elevationItemsOf(get().doc, registry, g.item.node.id).find(({ view }) => view.id === g.view.id)?.item.box
  if (now) out.status = `${formatLength(now.maxX - now.minX)} × ${formatLength(now.maxY - now.minY)}`
}

/**
 * A line across what a view draws (a tall unit's between two sections), dragged up and down: it lines
 * up with the tops and bottoms of what is beside it, the walls and the floor, else goes by whole steps
 * of the grid; Alt lines up with nothing and leaves the grid. How high it is above the floor is said as it goes.
 */
export const splitMove: Move<'split'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const { step, free, reach } = viewSteps(e)
  const moved = lineUpInView(world.y - g.start.y, [[[g.y], g.edges.ys]], reach, step, free)
  const y = g.y + moved.delta
  const ops = elevationSplitOps(g.view, s.base ?? s.doc, registry, g.item, g.index, y)
  if (!ops) return
  out.previewed = preview(ops)
  out.smart = viewGuides(g.edges, null, moved.at)
  out.status = t('{height} above the floor', { height: formatLength(g.view.y - y - (heightAboveFloor(g.item.node, registry) ?? 0)) })
}

/** What a press on each side of the box a view draws the selected object in does, said while the pointer is on it. */
const GRIP_HINTS = {
  left: msg('Drag the side to make it wider or narrower: the other side stays where it is'),
  right: msg('Drag the side to make it wider or narrower: the other side stays where it is'),
  top: msg('Drag the top up or down to change its height'),
  bottom: msg('Drag the bottom up or down: its top stays where it is'),
}

export const hover: Move<'idle'> = (c, _g, _e, at, world, out) => {
  const s = get()
  // On a side of what is selected, where a view shows it, a press drags that side.
  const side = s.tool === 'select' ? inViewGripAt(c, at) : null
  if (side) {
    out.status = t(GRIP_HINTS[side.side])
    const cursor = side.side === 'left' || side.side === 'right' ? 'ew-resize' : 'ns-resize'
    if (c.gripCursor !== cursor) c.setGripCursor(cursor)
    if (s.wallFace !== null) useStore.setState({ wallFace: null })
    return
  }
  if (s.tool === 'select' && inViewSplitAt(c, at)) {
    out.status = t('Drag the line up or down: the parts either side of it give and take')
    if (c.gripCursor !== 'row-resize') c.setGripCursor('row-resize')
    if (s.wallFace !== null) useStore.setState({ wallFace: null })
    return
  }
  // Over what an elevation shows of the plan, a press takes it.
  const inView = s.tool === 'select' ? elevationAt(c, world) : null
  if (inView) {
    out.status = inView.item.raises ? t('Drag it along the wall, or up and down to raise or lower it') : t('Drag it along the wall')
    if (c.gripCursor !== 'move') c.setGripCursor('move')
    if (s.wallFace !== null) useStore.setState({ wallFace: null })
    return
  }
  const { handles } = c
  const framed = frameCornerAt(c, at) ? null : frameGripAt(c, at)
  const grip = framed !== null ? null : (frameCornerAt(c, at) ?? gripAt(c, at))
  // On the line across a free end of the selected wall, a press makes it longer or shorter.
  const ending = framed === null && !grip ? endAt(c, at) : null
  const onCorner = s.tool === 'select' && framed === null && !grip && !ending && !viewLineHandleAt(c, at) && cornerAt(c, at) !== null
  const own = onCorner ? 0 : s.tool === 'select' ? handleAt(c, at) : -1
  const boxed = ['rect', 'paper'].includes(s.doc.nodes[s.selection[0]]?.type ?? '')
  const diagonal = (corner: number, turn = 0) => resizeCursor(rotate({ x: corner === 1 || corner === 2 ? 1 : -1, y: corner >= 2 ? 1 : -1 }, turn))
  const stretched = s.doc.nodes[s.selection[0]]?.type === 'parametric' && handles.length === 2
  // On an edge of what a view line sees (not on one of its corners), a press drags it across: the edge is shown, and the pointer says across.
  const edged = own === 0 || own >= 7 ? viewEdgeAt(c, at) : null
  if (edged) out.face = [edged.edge]
  const pointer = edged ? resizeCursor(perp(sub(edged.edge[1], edged.edge[0]))) : ending ? resizeCursor(sub(ending.wall.b, ending.wall.a)) : framed !== null ? (framed === 'knob' ? 'grab' : frameCursor(c, framed)) : grip ? (grip.corner === 'knob' ? 'grab' : diagonal(grip.corner, 'box' in grip ? grip.box.rotation : 0)) : own >= 0 ? (boxed ? diagonal(own) : stretched ? resizeCursor(sub(handles[1], handles[0])) : 'move') : null
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
  // What a click would pick up is outlined, and on a view line or a view, what it sees is shown
  // faintly, to know what it covers without selecting it. Not over a grip or a face, where a press
  // does something else, nor while words are typed in place.
  if (s.tool === 'select' && shown === null && !s.editingText) {
    const pointed = pointedAt(c, at, world)
    const hit = pointed?.item
    if (pointed) out.hovered = { thing: pointed.thing, ...(pointed.thing !== hit ? { group: { id: hit!.id, bounds: hit!.bounds } } : {}) }
    const type = hit && s.doc.nodes[hit.id]?.type
    if (type === 'elevation') out.viewHover = hit!.id
  }
}

export const pressUp: Release<'press'> = (c, g) => {
  if (g.beside) select([])
  c.gesture = { kind: 'idle' }
}

/** Ends any drag of the select tool: what it previewed becomes one step to undo. */
export function dragUp(c: Canvas): void {
  const s = get()
  if (c.gesture.kind === 'move') logMoveEnd(s.base ?? s.doc, c.gesture.moving, c.gesture.others)
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
