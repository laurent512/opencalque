import { add, arcThrough, DEFAULT_PAPER_SCALE, dist, len, norm, PAPER_FORMATS, paperSize, perp, scale, sub, wallArc, wallEdgeLines, wallMiddle, wallSides, type Document, type NodeInput, type NodeOf, type Op, type SnapKind, type Style, type Vec2 } from '@opencalque/core'
import { dimensionToolLook } from '../actions'
import { registry } from '../extensions'
import { t } from '../i18n'
import type { Tool } from '../tools'
import { formatLength, formatNumber, unit } from '../units'
import type { Overlay, SizeLabel, AngleMark } from './draw'
import { BOXES, FORMAT_REACH } from './gesture'
import { layerHere } from '../store'
import { get } from './runtime'

/* What the drawing tools make, and the sizes and labels shown while they make it. */

export const round = (n: number) => Math.round(n * 1000) / 1000

/** What a snap is called beside its mark. A point of an object needs no name. */
export const snapName = (kind: SnapKind): string | undefined =>
  kind === 'middle' ? t('Middle') : kind === 'crossing' ? t('Crossing') : kind === 'perpendicular' ? t('Perpendicular') : kind === 'edge' ? t('On the line') : kind === 'aligned' ? t('Lined up') : undefined

/**
 * Applies the sizes typed in the quick bar to where a shape would end: a typed size wins over
 * the pointer, which still chooses the direction (and the size that was not typed).
 */
export function constrain(tool: Tool, start: Vec2, p: Vec2, free = false): Vec2 {
  const { a, b } = get().drawLocks
  if (a === undefined && b === undefined) return tool === 'paper' && !free ? (paperFormats(start, p).find((f) => f.active)?.b ?? p) : p
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    return { x: start.x + (a === undefined ? d.x : d.x < 0 ? -a : a), y: start.y + (b === undefined ? d.y : d.y < 0 ? -b : b) }
  }
  // Angles are entered counter-clockwise, as on paper; Y grows downward in the drawing.
  const angle = b === undefined ? Math.atan2(d.y, d.x) : (-b * Math.PI) / 180
  const length = a ?? len(d)
  return { x: round(start.x + Math.cos(angle) * length), y: round(start.y + Math.sin(angle) * length) }
}

/**
 * The standard formats a paper could take while it is pulled from `start` towards `p`: upright
 * when the pointer is further down than across, lying otherwise, and on whichever side of the
 * first corner the pointer is. The one whose far corner the pointer is close to is `active`.
 */
export function paperFormats(start: Vec2, p: Vec2): NonNullable<Overlay['ghosts']> {
  const { paperScale, view } = get()
  const d = sub(p, start)
  const landscape = Math.abs(d.x) >= Math.abs(d.y)
  let nearest = FORMAT_REACH / view.zoom
  let active = ''
  const formats = PAPER_FORMATS.map((format) => {
    const size = paperSize(format.name, landscape, paperScale)!
    const b = { x: start.x + (d.x < 0 ? -size.width : size.width), y: start.y + (d.y < 0 ? -size.height : size.height) }
    if (dist(b, p) < nearest) {
      nearest = dist(b, p)
      active = format.name
    }
    return { a: start, b, label: format.name }
  })
  return formats.map((format) => ({ ...format, active: format.label === active }))
}

/**
 * `p` brought onto the nearest of the eight directions from `from` (across, up and down, and the
 * diagonals), at the same distance. Used where nothing else is snapped to, as on a scanned plan.
 */
export function straighten(from: Vec2, p: Vec2): Vec2 {
  const d = sub(p, from)
  const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: round(from.x + Math.cos(angle) * len(d)), y: round(from.y + Math.sin(angle) * len(d)) }
}

/** The two sizes of a shape from `start` to `p`, as the quick bar shows them, and the labels drawn beside it. */
export function sizes(tool: Tool, start: Vec2, p: Vec2): { live: { a: number; b: number }; labels: SizeLabel[]; angle?: AngleMark } {
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(d.x), height: Math.abs(d.y) }
    return { live: { a: box.width, b: box.height }, labels: boxLabels(box) }
  }
  const angle = (Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10 + 360) % 360
  if (len(d) < 1e-6) return { live: { a: 0, b: 0 }, labels: [] }
  // The length runs along the line, on its upper side and the right way up.
  let turn = (Math.atan2(d.y, d.x) * 180) / Math.PI
  if (turn > 90 || turn <= -90) turn += 180
  const up = { x: Math.sin((turn * Math.PI) / 180), y: -Math.cos((turn * Math.PI) / 180) }
  const length: SizeLabel = { at: { x: (start.x + p.x) / 2, y: (start.y + p.y) / 2 }, dx: up.x * 16, dy: up.y * 16, text: formatLength(len(d)), rotation: turn }
  // The way from one point of a curve or an arc to the next is not the way the line drawn goes: it has no angle to show.
  const straight = tool !== 'curve' && tool !== 'arc'
  return { live: { a: len(d), b: angle }, labels: [length], ...(straight ? { angle: { at: start, degrees: angle } } : {}) }
}

/** A width under a box and a height to its right. */
export function boxLabels(box: { x: number; y: number; width: number; height: number }): SizeLabel[] {
  return [
    { at: { x: box.x + box.width / 2, y: box.y + box.height }, dx: 0, dy: 18, text: formatLength(box.width) },
    { at: { x: box.x + box.width, y: box.y + box.height / 2 }, dx: 18, dy: 0, text: formatLength(box.height), rotation: -90 },
  ]
}

/**
 * What is written above a selected paper: its scale, as "1:100". Its format is in the panel, and
 * its size in the drawing says nothing a format and a scale do not.
 */
export function paperLabel(paper: { x: number; y: number; width: number; height: number; scale?: number }): SizeLabel[] {
  return [{ at: { x: paper.x + paper.width / 2, y: paper.y }, dx: 0, dy: -18, text: `1:${formatNumber(paper.scale ?? DEFAULT_PAPER_SCALE)}` }]
}

/**
 * The look given to what is drawn next, as chosen in the bar above the tools: the colour of its
 * lines and, for a closed shape, its fill. Nothing at all when its lines are left to the layer and
 * it has no fill. Weights and kinds of line are set afterwards, in the properties.
 */
export function currentStyle(closed = false): { style?: Style } {
  const { drawColor, drawFill, drawPattern } = get()
  const style = { ...(drawColor ? { stroke: drawColor } : {}), ...(closed && drawFill ? { fill: drawFill } : {}), ...(closed && drawPattern ? { pattern: drawPattern } : {}) }
  return Object.keys(style).length > 0 ? { style } : {}
}

/**
 * Whether what is selected is only rooms. A room is its walls' and has nothing of its own to scale
 * or turn (only its name, which is moved), so the box around it has no grips; nor is a press in
 * it, on its floor, a press on it: the floor is not clickable, so that what is on it is.
 */
export const roomsOnly = (doc: Document, selection: string[]) => selection.length > 0 && selection.every((id) => doc.nodes[id]?.type === 'room')

/** The pointer that says a drag resizes along `d`, whichever way that points. */
export function resizeCursor(d: Vec2): string {
  const angle = ((((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180) + 180) % 180
  const nearest = [0, 45, 90, 135, 180].reduce((best, a) => (Math.abs(angle - a) < Math.abs(angle - best) ? a : best), 0)
  return nearest === 45 ? 'nwse-resize' : nearest === 90 ? 'ns-resize' : nearest === 135 ? 'nesw-resize' : 'ew-resize'
}

/** The steps a dragged face changes a thickness by: at least 3 pixels of screen each, so 1 mm close up and 25 mm far out. */
export const thicknessStep = (zoom: number) => [1, 5, 10, 25, 50, 100].find((step) => step * zoom >= 3) ?? 100

/** The way across a wall towards its right face, where its middle line is nearest to `p`. */
export function wallNormal(wall: NodeOf<'wall'>, p: Vec2): Vec2 {
  const arc = wallArc(wall)
  return arc ? scale(norm(sub(p, arc.centre)), -Math.sign(arc.sweep)) : perp(norm(sub(wall.b, wall.a)))
}

/** Where a long face of a wall is across its line: to the right is positive. */
export const faceAcross = (wall: NodeOf<'wall'>, side: 'left' | 'right'): number => (side === 'right' ? wallSides(wall).right : -wallSides(wall).left)

/**
 * A long face of a wall as it is drawn: its stretches between doors and windows, each from where
 * the corner at one end leaves it to where the corner at the other takes it, which at a mitre is
 * past the end of the wall's line or short of it.
 */
export const faceOf = (wall: NodeOf<'wall'>, doc: Document, side: 'left' | 'right'): Vec2[][] => wallEdgeLines(wall, doc, registry, side)

/** The thickness of a wall, written outside the face that is dragged, halfway along it and the right way up. */
export function thicknessLabel(wall: NodeOf<'wall'>, side: 'left' | 'right'): SizeLabel {
  const middle = wallMiddle(wall)
  const out = scale(wallNormal(wall, middle), side === 'right' ? 1 : -1)
  let turn = (Math.atan2(out.x, -out.y) * 180) / Math.PI
  if (turn > 90 || turn <= -90) turn += 180
  return { at: add(middle, scale(wallNormal(wall, middle), faceAcross(wall, side))), dx: out.x * 18, dy: out.y * 18, text: formatLength(wall.thickness), rotation: turn }
}

/**
 * The operation that adds a wall between two clicked points. Drawn along a face, the wall keeps
 * that face as its line (`justify`): the points clicked are its corners, and it lies to the other
 * side of them, so the walls of a run drawn by their inner face keep it flush whatever their
 * thicknesses.
 */
export function wallOps(id: string, a: Vec2, b: Vec2): Op[] {
  const { wallJustify } = get()
  return [{ op: 'add_node', node: { ...shape('wall', id, a, b), ...(wallJustify === 'center' ? {} : { justify: wallJustify }) } as NodeInput }]
}

/** The node a two-point tool makes from its two points. */
export function shape(tool: Tool, id: string, a: Vec2, b: Vec2, offset = 0): NodeInput {
  const { scope, wallThickness, wallMaterial, annotationTemplate, gridlineTemplate, paperScale, base, doc } = get()
  const common = { id, parent: scope, ...layerHere(), ...(tool !== 'dimension' && tool !== 'paper' ? currentStyle(tool === 'rect' || tool === 'ellipse') : {}) }
  switch (tool) {
    case 'paper': {
      // Counted in the drawing as it was before this paper started to be drawn.
      const count = Object.values((base ?? doc).nodes).filter((n) => n.type === 'paper').length
      const name = t('Paper {n}', { n: String(count + 1).padStart(2, '0') })
      return { ...common, type: 'paper', name, scale: paperScale, titleBlock: {}, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    case 'wall':
      // Of the material chosen for the tool, when this drawing has it: the setting outlives the drawing.
      return { ...common, type: 'wall', a, b, thickness: wallThickness, ...(wallMaterial && doc.materials?.[wallMaterial] ? { material: wallMaterial } : {}) }
    case 'divider':
      return { id, parent: scope, ...layerHere(), type: 'divider', a, b }
    case 'annotation':
      // The tip is the first point clicked, the text goes at the second; the words are typed afterwards.
      return { ...annotationTemplate, ...common, type: 'annotation', a, b, text: '' } as NodeInput
    case 'gridline': {
      // The colour chosen in the bar goes with the template's dash.
      const style = { ...(gridlineTemplate.style as Style | undefined), ...common.style }
      return { label: '', ...gridlineTemplate, ...common, ...(Object.keys(style).length > 0 ? { style } : {}), type: 'gridline', a, b } as NodeInput
    }
    case 'dimension': {
      const look = dimensionToolLook()
      const style = typeof look.dimensionStyle === 'string' ? doc.dimensionStyles?.[look.dimensionStyle] : undefined
      // New dimensions read in the unit the user works in, unless the tool's settings or its style say otherwise; their decimal mark is the drawing's.
      const written = style?.unit === undefined ? { unit: unit() } : {}
      return { ...written, ...look, ...common, type: 'dimension', a, b, offset } as NodeInput
    }
    case 'rect':
      return { ...common, type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    case 'ellipse':
      return { ...common, type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 }
    default:
      return { ...common, type: 'line', a, b }
  }
}

/** The guide to show for a line from `from` to `to`: none unless it is exactly horizontal or vertical. */
export const axisOf = (from: Vec2, to: Vec2): Overlay['axis'] => {
  const flat = Math.abs(to.y - from.y) < 1e-6
  const upright = Math.abs(to.x - from.x) < 1e-6
  return flat === upright ? undefined : { at: from, vertical: upright }
}

/** The polyline the line tool makes from the points clicked, or the curve through them that the curve tool makes. */
export const polyline = (id: string, points: Vec2[], closed: boolean): NodeInput => {
  const { scope, tool } = get()
  return { id, type: 'polyline', parent: scope, ...layerHere(), points, closed, ...(tool === 'curve' ? { smooth: true } : {}), ...currentStyle(closed) }
}

/** The arc from `a` to `b` through `p`: an ellipse with a start and an end angle. Three points in line make a line. */
export function arcNode(id: string, a: Vec2, b: Vec2, p: Vec2): NodeInput {
  const arc = arcThrough(a, b, p)
  if (!arc) return shape('line', id, a, b)
  const { scope } = get()
  return { id, type: 'ellipse', parent: scope, ...layerHere(), cx: arc.cx, cy: arc.cy, rx: arc.r, ry: arc.r, from: arc.from, to: arc.to, ...currentStyle() }
}
