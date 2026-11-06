import { arcMiddleOfRadius, dist, len, newId, nextGridLabel, norm, paperSize, perp, sub, type NodeInput, type Vec2 } from '@opencalque/core'
import { t } from '../../i18n'
import { apply, cancel, commit, layerHere, preview, useStore } from '../../store'
import { formatLength, formatNumber } from '../../units'
import { gridStep } from '../../view'
import { lineEnd, snap, type Target } from '../aim'
import { BOXES, CHAINED, DRAG_DISTANCE, DRAG_TIME, SAME_POINT, type GestureOf, type Keys } from '../gesture'
import { get, reset, syncStep, type Canvas, type Move, type Press, type Release } from '../runtime'
import { arcNode, axisOf, constrain, currentStyle, paperFormats, polyline, shape, sizes, wallOps } from '../shapes'

/*
 * The tools that add to the drawing point by point: the line and curve tools, whose points make a
 * line, a polyline or a polygon, straight or flowing through them (`poly`); the two-point shapes,
 * walls and dividers chaining one after the other (`draw`), a dimension then taking a third point
 * for its line (`offset`) and an arc one that it goes through (`arc`); and text.
 */

/** Where the second point of the two-point shape being drawn goes, for the pointer where it is. */
export function aim(c: Canvas, g: GestureOf<'draw'>, world: Vec2, e: Keys): Target {
  const { tool } = get()
  if (CHAINED.includes(tool)) return lineEnd(c, world, e, [g.id], g.start)
  return snap(c, world, e, [g.id], tool === 'dimension' || tool === 'gridline' || tool === 'arc' ? g.start : undefined)
}

/**
 * The point the arc being drawn goes through, for the pointer where it is: on a radius typed in
 * the quick bar, which wins; on the top of a half circle with Shift; else snapped.
 */
function arcAim(c: Canvas, g: GestureOf<'arc'>, world: Vec2, e: Keys): Target {
  const { a: radius } = get().drawLocks
  if (radius !== undefined) return { p: arcMiddleOfRadius(g.a, g.b, radius, world), marker: null }
  if (e.shiftKey) return { p: arcMiddleOfRadius(g.a, g.b, 0, world), marker: null }
  return snap(c, world, e, [g.id])
}

/** Keeps the arc being drawn, through the point the pointer gives. */
export function finishArc(c: Canvas, g: GestureOf<'arc'>, world: Vec2, e: Keys): void {
  if (preview([{ op: 'add_node', node: arcNode(g.id, g.a, g.b, arcAim(c, g, world, e).p) }])) commit()
  else cancel()
  useStore.setState({ drawLocks: {}, drawLive: null })
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
}

/** Completes the shape being drawn at `p`. Chained tools then start the next one from there. */
export function finishShape(c: Canvas, g: GestureOf<'draw'>, end: Vec2, chain: boolean): void {
  let p = end
  const { tool } = get()
  if (dist(g.start, p) < 1e-6) {
    // Clicking the last corner again ends the run. As a double-click on a run of walls, it also
    // closes the run back to where it started.
    const closable = tool === 'wall' && g.segments >= 2 && dist(g.start, g.origin) > 1e-6
    const closes = closable && performance.now() - g.since < 500
    reset(c)
    if (closes) apply(wallOps(newId(), g.start, g.origin))
    // A slower double-click is still one when the system says so (its own timing, set by the user): see onDoubleClick.
    c.ended = closable && !closes ? { start: g.start, origin: g.origin, time: performance.now() } : null
    return
  }
  p = constrain(tool, g.start, p, c.lastWorld.altKey)
  useStore.setState({ drawLocks: {}, axisLock: null, drawLive: null })
  if (tool === 'dimension') {
    // Not done yet: the next click places the dimension line.
    preview([{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])
    c.gesture = { kind: 'offset', id: g.id, a: g.start, b: p }
    return
  }
  if (tool === 'arc') {
    // Not done yet: the next click says what it goes through. Until then it is its straight line.
    preview([{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])
    c.gesture = { kind: 'arc', id: g.id, a: g.start, b: p }
    return
  }
  if (tool === 'annotation') {
    // Not added yet: it stays a preview while its note is typed in place, then both are kept together.
    const create = shape(tool, g.id, g.start, p) as NodeInput & { id: string }
    if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: g.id, create } })
    else cancel()
    c.gesture = { kind: 'idle' }
    c.setOverlay({})
    return
  }
  if (preview(tool === 'wall' ? wallOps(g.id, g.start, p) : [{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])) {
    commit()
    // The grid line drawn next is labelled after this one: B after A, 2 after 1.
    if (tool === 'gridline') useStore.setState((s) => ({ gridlineTemplate: { ...s.gridlineTemplate, label: nextGridLabel(String(s.gridlineTemplate.label ?? '')) } }))
  } else cancel()
  // A run that arrives back at its first point is complete.
  const continues = chain && CHAINED.includes(tool) && !(g.segments >= 1 && dist(p, g.origin) < 1e-6)
  c.gesture = continues ? { kind: 'draw', id: newId(), start: p, press: null, origin: g.origin, segments: g.segments + 1, since: performance.now() } : { kind: 'idle' }
}

/** Where the next point of a polyline goes: on its own first point when the pointer is near it (to close), else snapped and constrained. */
export function polyPoint(c: Canvas, g: GestureOf<'poly'>, world: Vec2, e: Keys): Vec2 {
  const last = g.points[g.points.length - 1]
  if (g.points.length >= 3 && dist(world, g.points[0]) * get().view.zoom < 10) return g.points[0]
  return constrain('line', last, lineEnd(c, world, e, [g.id], last).p)
}

/**
 * Ends the line being drawn, keeping it when it has at least one segment: one segment is a line,
 * several a polyline, and closed it is a polygon, which can be filled.
 */
export function finishPoly(c: Canvas, g: GestureOf<'poly'>, closed: boolean): void {
  const node = g.points.length === 2 && !closed ? shape('line', g.id, g.points[0], g.points[1]) : polyline(g.id, g.points, closed && g.points.length >= 3)
  if (g.points.length >= 2 && preview([{ op: 'add_node', node }])) commit()
  else cancel()
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
  useStore.setState({ drawLocks: {}, axisLock: null, drawLive: null })
  syncStep(c)
}

/** The text starts empty and is typed in place; see TextEditor. */
export const textDown: Press = (c, e, _at, world) => {
  const s = get()
  const { p } = snap(c, world, e, [])
  const create: NodeInput & { id: string } = { id: newId(), type: 'text', parent: s.scope, ...layerHere(s), x: p.x, y: p.y, text: '', size: 200, ...currentStyle() }
  if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: create.id, create } })
}

export const lineDown: Press = (c, e, at, world) => {
  const s = get()
  const g = c.gesture
  if (g.kind !== 'poly') {
    c.endedLine = null
    c.lastClick = at
    c.gesture = { kind: 'poly', id: newId(), points: [snap(c, world, e, []).p], since: performance.now(), press: { ...at, time: performance.now() } }
    return
  }
  const p = polyPoint(c, g, world, e)
  const last = g.points[g.points.length - 1]
  // Clicking the last point again, give or take the wobble of a double-click, ends the line; as a
  // double-click it closes the shape, when it has two segments to close. Coming back to the first point closes it too.
  const typed = s.drawLocks.a !== undefined || s.drawLocks.b !== undefined
  const near = !typed && (dist(world, last) * s.view.zoom < SAME_POINT || (c.lastClick !== null && dist(at, c.lastClick) < SAME_POINT))
  c.lastClick = at
  if (near || dist(p, last) < 1e-6) {
    const closable = g.points.length >= 3
    const closes = closable && performance.now() - g.since < 500
    finishPoly(c, g, closes)
    c.endedLine = closable && !closes ? { id: g.id, time: performance.now() } : null
    return
  }
  if (g.points.length >= 3 && p === g.points[0]) return finishPoly(c, g, true)
  g.points.push(p)
  g.since = performance.now()
  useStore.setState({ drawLocks: {}, axisLock: null })
}

/** The two-point tools: the first click starts a shape, the next finishes it (and, for a dimension, a third places its line). */
export const drawDown: Press = (c, e, at, world) => {
  const s = get()
  const g = c.gesture
  if (g.kind === 'offset') {
    commit()
    c.gesture = { kind: 'idle' }
  } else if (g.kind === 'arc') {
    finishArc(c, g, world, e)
  } else if (g.kind === 'draw') {
    // A click back on the point just placed, give or take the wobble of a double-click, is that
    // point: it ends the run (and, as a double-click, closes it) rather than drawing a tiny wall
    // to wherever snapping took the pointer. A length typed in the quick bar still goes from there.
    const typed = s.drawLocks.a !== undefined || s.drawLocks.b !== undefined
    const near = dist(world, g.start) * s.view.zoom < SAME_POINT || (c.lastClick !== null && dist(at, c.lastClick) < SAME_POINT)
    const back = CHAINED.includes(s.tool) && !typed && near
    c.lastClick = at
    finishShape(c, g, back ? g.start : aim(c, g, world, e).p, true)
  } else {
    c.ended = null
    c.lastClick = at
    const start = snap(c, world, e, []).p
    if (s.tool === 'paper') {
      // Sheets are large next to what is usually on screen. Step back, keeping the clicked corner
      // where it is, until an A3 fits in half the width, so the formats on offer can be seen.
      const fits = (0.5 * s.viewport.width) / paperSize('A3', true, s.paperScale)!.width
      if (s.view.zoom > fits) useStore.setState({ view: { zoom: fits, x: at.x - start.x * fits, y: at.y - start.y * fits } })
    }
    const drawn: GestureOf<'draw'> = { kind: 'draw', id: newId(), start, press: { ...at, time: performance.now() }, origin: start, segments: 0, since: 0 }
    c.gesture = drawn
    // A box whose width and height were both typed needs no second point: one click places it.
    const { a, b } = s.drawLocks
    if (BOXES.includes(s.tool) && a !== undefined && b !== undefined) finishShape(c, drawn, { x: start.x + 1, y: start.y + 1 }, false)
  }
}

export const drawMove: Move<'draw'> = (c, g, e, _at, world, out) => {
  const s = get()
  const constrained = CHAINED.includes(s.tool) || s.tool === 'dimension' || s.tool === 'gridline' || s.tool === 'arc'
  const target = aim(c, g, world, e)
  out.marker = target.marker
  out.link = target.link
  // The line it is held to is shown across the view, as when Shift holds a wall end on its line.
  if (s.axisLock && CHAINED.includes(s.tool)) out.guide = { at: g.start, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  const end = constrain(s.tool, g.start, target.p, e.altKey)
  // The formats on offer follow the pointer itself, so one stays lit while the paper is held on it.
  if (s.tool === 'paper' && s.drawLocks.a === undefined && s.drawLocks.b === undefined && !e.altKey) out.ghosts = paperFormats(g.start, target.p)
  out.previewed = preview(s.tool === 'wall' ? wallOps(g.id, g.start, end) : [{ op: 'add_node', node: shape(s.tool, g.id, g.start, end) }])
  const d = sub(end, g.start)
  if (constrained) out.axis = axisOf(g.start, end)
  out.status = constrained ? t('Length {value}', { value: formatLength(len(d)) }) : `${formatNumber(Math.abs(d.x))} × ${formatLength(Math.abs(d.y))}`
  if (s.tool !== 'dimension' && s.tool !== 'annotation') Object.assign(out, sizes(s.tool, g.start, end))
}

export const polyMove: Move<'poly'> = (c, g, e, _at, world, out) => {
  const s = get()
  const last = g.points[g.points.length - 1]
  const end = polyPoint(c, g, world, e)
  if (s.axisLock) {
    const target = lineEnd(c, world, e, [g.id], last)
    out.marker = target.marker
    out.link = target.link
    out.guide = { at: last, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
  }
  out.previewed = preview([{ op: 'add_node', node: polyline(g.id, [...g.points, end], false) }])
  out.status = t('Length {value}', { value: formatLength(dist(last, end)) })
  out.axis = axisOf(last, end)
  Object.assign(out, sizes(s.tool, last, end))
}

export const offsetMove: Move<'offset'> = (_c, g, e, _at, world, out) => {
  const s = get()
  const n = perp(norm(sub(g.b, g.a)))
  const step = e.altKey ? 1 : gridStep(s.view.zoom)
  const offset = Math.round(((world.x - g.a.x) * n.x + (world.y - g.a.y) * n.y) / step) * step
  out.previewed = preview([{ op: 'add_node', node: shape('dimension', g.id, g.a, g.b, offset) }])
  out.status = t('Offset {value}', { value: formatLength(Math.abs(offset)) })
}

export const arcMove: Move<'arc'> = (c, g, e, _at, world, out) => {
  const target = arcAim(c, g, world, e)
  out.marker = target.marker
  const node = arcNode(g.id, g.a, g.b, target.p)
  out.previewed = preview([{ op: 'add_node', node }])
  const radius = node.type === 'ellipse' ? (node.rx as number) : 0
  out.live = { a: radius, b: 0 }
  if (radius > 0) out.status = t('Radius {value}', { value: formatLength(radius) })
}

/** A line can be drawn by dragging from its first point to its second, and is then done. */
export const polyUp: Release<'poly'> = (c, g, e, at, world) => {
  if (g.points.length === 1 && g.press && dist(at, g.press) > DRAG_DISTANCE && performance.now() - g.press.time > DRAG_TIME) {
    g.points.push(polyPoint(c, g, world, e))
    finishPoly(c, g, false)
  } else g.press = undefined
}

/** Dragging from the first point to the second sets both at once; a plain click waits for the next click. */
export const drawUp: Release<'draw'> = (c, g, e, at, world) => {
  if (g.press && dist(at, g.press) > DRAG_DISTANCE && performance.now() - g.press.time > DRAG_TIME) {
    finishShape(c, g, aim(c, g, world, e).p, true)
  } else g.press = null
}
