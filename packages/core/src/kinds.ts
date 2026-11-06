import { childrenOf, isVisible, rootOf } from './document'
import { add, applyTransform, besidePath, dist, inverseTransform, len, mid, norm, parallelPath, perp, rotate, scale, sub, type Bounds, type Vec2, ellipseArc, smoothPoints, unionBounds } from './geometry'
import { fadeColor, resolveColor } from './colors'
import { DIMENSION_MARKER_SIZE, DIMENSION_TEXT_SIZE, styledDimension } from './dimensions'
import { fillFields } from './fields'
import { formatFeetInches } from './imperial'
import { applyModifiers, movedModifiers, HATCH_INK, HATCH_WEIGHT, patternStrokes } from './modifiers'
import { primitiveBounds, transformPrimitive, type Primitive } from './primitives'
import { tidy, turned, type Placing } from './similarity'
import { sheetContentOf } from './templates'
import type { Op } from './ops'
import type { Registry } from './registry'
import { DEFAULT_MATERIAL, type Asset, type Document, type DrawingSettings, type Node, type NodeOf, type NodeType, type WallEdge } from './schema'
import { DEFAULT_PAPER_SCALE, paperFormat, paperSheet } from './papers'
import { regionPerimeter, roomAt } from './rooms'
import { tablePrimitives } from './tables'
import { bulgeThrough, hostWall, materialSeams, wallMiddle, wallPoints, wallPolygons, wallSeams, wallOutlineRuns, wallSides } from './walls'

export const DEFAULT_INK = '#1f1f1f'
export const WALL_FILL = '#ffffff'
/** The floor of a room, light enough to draw on, and the line of a divider between two rooms. */
export const ROOM_FILL = 'rgba(96, 125, 170, 0.13)'
export const DIVIDER_INK = '#8b9099'
/** A sheet of paper and its edge. */
export const PAPER_FILL = '#ffffff'
export const PAPER_EDGE = '#c4c8cf'
const MAX_INSTANCE_DEPTH = 8
/** How far from vertical, in degrees, a dimension line may lean and still have its text read the way the dimension says vertical text reads. */
const VERTICAL_TEXT_TOLERANCE = 1

export interface KindContext {
  doc: Document
  registry: Registry
  depth: number
  /**
   * The colour of what says none of its own, in place of the default ink: inside a component
   * placement, the colour of the layer the placement is on, so that a chair put on a grey layer
   * ("existing") is drawn grey, as a block is in CAD programs. Unset elsewhere.
   */
  ink?: string
  /** The paper being drawn on, for what the drawing puts on every sheet: text fields are filled in for that sheet and the page it lies on. */
  sheet?: { name: string; scale: number; format: string; page: string | null }
}

/** What a text says once its fields are filled in for where it is being drawn. */
const said = (text: string, parent: string | null, ctx: KindContext) => fillFields(text, ctx.doc, ctx.sheet ? ctx.sheet.page : parent, ctx.sheet)

/** How one node type draws itself and responds to direct manipulation. */
export interface NodeKind<N> {
  primitives(node: N, ctx: KindContext): Primitive[]
  /** Patch that translates the node by `d`. */
  move(node: N, d: Vec2): Record<string, unknown>
  /** Points the user can drag to reshape the node. A parametric object's depend on its kind, found in `registry`. */
  handles?(node: N, registry?: Registry): Vec2[]
  /** Patch that puts handle `index` at `p`. */
  moveHandle?(node: N, index: number, p: Vec2, registry?: Registry): Record<string, unknown>
  /** Points other geometry snaps to. Defaults to the vertices of the node's paths. */
  snapPoints?(node: N): Vec2[]
  /**
   * The lines other geometry snaps onto: their middles, where they cross, the foot of a
   * perpendicular, the nearest point. Given the paths the node draws, which are what is used when
   * a kind does not say.
   */
  snapLines?(node: N, drawn: Vec2[][]): Vec2[][]
  /**
   * The patch that turns, mirrors and scales the node as `t` says, keeping what the node means:
   * a wall's thickness and a text's size scale with it, a parametric object has its lengths scaled
   * rather than being stretched, text and pictures go to their mirrored place but stay readable, a
   * paper stays upright. Null for what is never transformed (a page, a component). `transformOps`
   * moves the node's modifiers, and goes through what a group holds.
   */
  transform(node: N, t: Placing, registry: Registry): Record<string, unknown> | null
  /**
   * The patch that lays the node parallel to itself, `distance` away (the Offset tool, `offset.ts`);
   * null when it has no such copy at that distance. Which side a sign means is the kind's, and the
   * same as in `beside`. A type without one is not offset.
   */
  parallel?(node: N, distance: number): Record<string, unknown> | null
  /** How far `p` is from the node, signed as `parallel` takes a distance. */
  beside?(node: N, p: Vec2): number
}

const moveXY = (node: { x: number; y: number }, d: Vec2) => ({ x: node.x + d.x, y: node.y + d.y })
const moveAB = (node: { a: Vec2; b: Vec2 }, d: Vec2) => ({ a: add(node.a, d), b: add(node.b, d) })
const handlesAB = (node: { a: Vec2; b: Vec2 }) => [node.a, node.b]
const moveHandleAB = (_: unknown, index: number, p: Vec2) => (index === 0 ? { a: p } : { b: p })

/** The four corners of a rectangle, turned with it, from its top-left corner round. */
export function rectCorners(node: NodeOf<'rect'>): Vec2[] {
  const local = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: node.width, y: node.height },
    { x: 0, y: node.height },
  ]
  return local.map((p) => add(rotate(p, node.rotation ?? 0), node))
}

/** A box with a top-left corner and a turn (a rectangle, a picture) transformed: it cannot itself be mirrored, so it goes to its mirrored place. */
const transformBox = (node: { x: number; y: number; width: number; height: number; rotation?: number }, t: Placing) => ({
  ...t.box(node, node.width),
  width: t.length(node.width),
  height: t.length(node.height),
  rotation: t.angle(node.rotation),
})
const transformAB = (node: { a: Vec2; b: Vec2 }, t: Placing) => ({ a: t.point(node.a), b: t.point(node.b) })
/** An end marker's size, scaled when the node gives one. */
const markerSize = (node: { markerSize?: number }, t: Placing) => (node.markerSize === undefined ? {} : { markerSize: t.length(node.markerSize) })

const boxCorners = (node: { x: number; y: number; width: number; height: number }): Vec2[] => [
  { x: node.x, y: node.y },
  { x: node.x + node.width, y: node.y },
  { x: node.x + node.width, y: node.y + node.height },
  { x: node.x, y: node.y + node.height },
]

/** What a parametric object draws in its own coordinates, from its parameters, before it is placed. */
export function parametricPrimitives(node: NodeOf<'parametric'>, ctx: KindContext): Primitive[] {
  const kind = ctx.registry.parametric.get(node.kind)
  if (!kind) return placeholder(node.kind)
  try {
    const env = kind.opening ? { wallThickness: hostWall(ctx.doc, node, ctx.registry)?.thickness } : {}
    return kind.build(ctx.registry.resolveProps(kind, node.props), env)
  } catch {
    // A faulty extension must not take the whole drawing down with it.
    return placeholder(node.kind)
  }
}

/**
 * How a component, or a parametric object of a kind and parameters (those it starts with when not
 * given), is drawn on its own, from its origin: its symbol, as a legend shows it. Placed nowhere, a
 * door stands in no wall.
 */
function symbolPrimitives(object: { kind: 'component' | 'parametric'; id: string; props?: Record<string, unknown> }, ctx: KindContext): Primitive[] {
  if (ctx.depth >= MAX_INSTANCE_DEPTH) return []
  const base = { id: '', parent: '', order: 'a0', x: 0, y: 0 }
  const node = object.kind === 'component' ? { ...base, type: 'instance', component: object.id } : { ...base, type: 'parametric', kind: object.id, props: object.props ?? {} }
  return nodePrimitives(node as Node, { ...ctx, depth: ctx.depth + 1 })
}

/** The text a dimension shows for a measured length in mm, with its own decimal mark or else the drawing's (`drawing`). */
export function dimensionLabel(node: Pick<NodeOf<'dimension'>, 'text' | 'unit' | 'decimals' | 'showUnit' | 'fraction' | 'decimal'>, length: number, drawing: DrawingSettings = {}): string {
  if (node.text) return node.text
  const unit = node.unit ?? 'mm'
  // Feet and inches say their own units with their marks.
  if (unit === 'ft-in') return formatFeetInches(length, node.fraction ?? 16)
  const value = (length / { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit]).toFixed(node.decimals ?? { mm: 0, cm: 1, m: 2, in: 1, ft: 2 }[unit]).replace('.', node.decimal ?? drawing.decimal ?? '.')
  return node.showUnit ? `${value} ${unit}` : value
}

/**
 * The floor area a room writes under its name, from its area in mm²: in m², or in ft² in an
 * imperial drawing, with the drawing's decimal mark (`drawing`), unless the room says otherwise.
 */
export function roomArea(node: Pick<NodeOf<'room'>, 'system' | 'decimal'>, area: number, drawing: DrawingSettings = {}): string {
  const [value, unit] = (node.system ?? drawing.system) === 'imperial' ? [area / (304.8 * 304.8), 'ft²'] : [area / 1e6, 'm²']
  return `${value.toFixed(2).replace('.', node.decimal ?? drawing.decimal ?? '.')} ${unit}`
}

/** How far it is round a room's floor, from its perimeter in mm, as `roomArea` writes its area: in m, or in ft. */
export function roomPerimeter(node: Pick<NodeOf<'room'>, 'system' | 'decimal'>, perimeter: number, drawing: DrawingSettings = {}): string {
  const [value, unit] = (node.system ?? drawing.system) === 'imperial' ? [perimeter / 304.8, 'ft'] : [perimeter / 1000, 'm']
  return `${value.toFixed(2).replace('.', node.decimal ?? drawing.decimal ?? '.')} ${unit}`
}

/** The symbol at one end of a dimension line. `out` points along the line, away from its middle. */
function dimensionMarker(type: NodeOf<'dimension'>['startMarker'], at: Vec2, out: Vec2, along: Vec2, size: number, style: object): Primitive[] {
  const back = sub(at, scale(out, size))
  const wing = scale(perp(out), size * 0.3)
  switch (type ?? 'tick') {
    case 'tick': {
      const half = scale(rotate(along, -45), size / 2)
      return [{ kind: 'path', points: [sub(at, half), add(at, half)], ...style }]
    }
    case 'arrow':
      return [{ kind: 'path', closed: true, fill: 'stroke', points: [at, add(back, wing), sub(back, wing)], ...style }]
    case 'open-arrow':
      return [{ kind: 'path', points: [add(back, wing), at, sub(back, wing)], ...style }]
    case 'dot':
      return [{ kind: 'ellipse', cx: at.x, cy: at.y, rx: size / 4, ry: size / 4, fill: 'stroke', ...style }]
    case 'none':
      return []
  }
}

/** What a title block can show, in the order it is listed for the user. */
export const TITLE_FIELDS = ['project', 'client', 'address', 'sheet', 'page', 'author', 'scale', 'format', 'date', 'number'] as const
export type TitleField = (typeof TITLE_FIELDS)[number]

/** The entries a sheet leaves out when it does not say: the page's name usually repeats the sheet's. */
const TITLE_HIDDEN: TitleField[] = ['page']

/** The entries of its title block a paper leaves out. */
export const titleBlockHidden = (node: NodeOf<'paper'>): TitleField[] => (node.titleBlock?.hide as TitleField[] | undefined) ?? TITLE_HIDDEN

/**
 * What each entry of a paper's title block reads, hidden or not, with fields such as {date}
 * filled in. Most come from elsewhere than the paper: the drawing's information, shared by all
 * its sheets, the names of the paper and of its page, its scale and format. An empty text means
 * the entry has nothing to say and takes no room in the block.
 */
export function titleBlockValues(node: NodeOf<'paper'>, doc: Document): Record<TitleField, string> {
  const fill = (text: string | undefined) => fillFields(text ?? '', doc, node.parent).trim()
  const block = node.titleBlock ?? {}
  const s = node.scale ?? DEFAULT_PAPER_SCALE
  let page: Node | undefined = node.parent ? doc.nodes[node.parent] : undefined
  while (page && page.type !== 'page' && page.parent) page = doc.nodes[page.parent]
  return {
    project: fill(block.project || doc.info?.project || doc.name),
    client: fill(doc.info?.client),
    address: fill(doc.info?.address),
    sheet: (node.name ?? '').trim(),
    page: page?.type === 'page' ? (page.name ?? '').trim() : '',
    author: fill(block.author || doc.info?.author),
    scale: `1:${s}`,
    format: paperFormat(node)?.name ?? `${Math.round(node.width / s)} × ${Math.round(node.height / s)}`,
    date: fill(block.date),
    number: fill(block.number),
  }
}

/**
 * The border and title block of a paper that asks for one. Sizes are those of the printed sheet
 * (a 10 mm margin, a block 100 mm wide), multiplied by the paper's scale to stand on the drawing.
 * The block is built from the entries that are shown and have something to say, so it is only as
 * tall as it needs to be: a heading of the project, client and address, a line with the names of
 * the sheet and its page and the author, and a row of cells for scale, format, date and number.
 * It has no captions, only values, so it reads the same in any language.
 */
function titleBlock(node: NodeOf<'paper'>, doc: Document): Primitive[] {
  const s = node.scale ?? DEFAULT_PAPER_SCALE
  // A sheet too small to hold it goes without.
  if (!node.titleBlock || node.width < 130 * s || node.height < 60 * s) return []
  const values = titleBlockValues(node, doc)
  const hidden = new Set<string>(titleBlockHidden(node))
  const shown = (field: TitleField) => (hidden.has(field) ? '' : values[field])

  const ink = { stroke: '#1f1f1f', own: true }
  const margin = 10 * s
  const width = 100 * s
  const right = node.x + node.width - margin
  const bottom = node.y + node.height - margin
  const left = right - width
  const line = (x1: number, y1: number, x2: number, y2: number): Primitive => ({ kind: 'path', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], ...ink, strokeWidth: 0.6 })
  // A text too long for its place is set smaller, down to what still reads, rather than run out of the block.
  const words = (text: string, x: number, y: number, size: number, room: number, look: { align?: 'left' | 'right'; bold?: boolean } = {}): Primitive => {
    const fitted = Math.max(size * 0.5, Math.min(size, room / Math.max(1, text.length * 0.56)))
    return { kind: 'text', x, y, text, size: fitted * s, ...look, ...ink }
  }

  // The heading: the project in large letters, then the client and each line of the address.
  const heading = [shown('project'), shown('client'), ...shown('address').split('\n').map((part) => part.trim())].filter(Boolean)
  const large = shown('project') !== ''
  const headingHeight = heading.length === 0 ? 0 : (large ? 12 : 8) + (heading.length - 1) * 5
  // The names: the sheet and its page on the left (once, when they are the same), the author on the right.
  const names = [...new Set([shown('sheet'), shown('page')].filter(Boolean))].join(' · ')
  const author = shown('author')
  const namesHeight = names || author ? 9 : 0
  // The cells: each as wide as what it usually holds, sharing the row among those that are there.
  const cells = (
    [
      ['scale', 22],
      ['format', 20],
      ['date', 32],
      ['number', 26],
    ] as [TitleField, number][]
  ).filter(([field]) => shown(field) !== '')
  const cellsHeight = cells.length > 0 ? 9 : 0

  const frame: Primitive = { kind: 'path', closed: true, ...ink, strokeWidth: 1.2, points: boxCorners({ x: node.x + margin, y: node.y + margin, width: node.width - 2 * margin, height: node.height - 2 * margin }) }
  const height = (headingHeight + namesHeight + cellsHeight) * s
  if (height === 0) return [frame]
  const top = bottom - height
  const out: Primitive[] = [frame, { kind: 'path', closed: true, ...ink, strokeWidth: 1.2, points: boxCorners({ x: left, y: top, width, height }) }]
  const pad = 3 * s

  let y = top
  heading.forEach((text, i) => {
    const first = i === 0
    const baseline = first ? (large ? 8.5 : 5.5) : (large ? 12 : 8) + (i - 1) * 5 + 3
    out.push(words(text, left + pad, y + baseline * s, first && large ? 5 : 3, 94, { bold: first && large }))
  })
  y += headingHeight * s
  if (namesHeight) {
    if (y > top) out.push(line(left, y, right, y))
    // The author takes what it needs, up to half the line; the names have the rest.
    const authorRoom = author ? Math.min(47, author.length * 3 * 0.56 + 2) : 0
    if (names) out.push(words(names, left + pad, y + 6 * s, 3.5, 94 - authorRoom))
    if (author) out.push(words(author, right - pad, y + 6 * s, 3, authorRoom, { align: 'right' }))
    y += namesHeight * s
  }
  if (cellsHeight) {
    if (y > top) out.push(line(left, y, right, y))
    const total = cells.reduce((sum, [, weight]) => sum + weight, 0)
    let x = left
    cells.forEach(([field, weight], i) => {
      const cell = (weight / total) * width
      if (i > 0) out.push(line(x, y, x, bottom))
      out.push(words(shown(field), x + pad, y + 6 * s, 3.5, cell / s - 6))
      x += cell
    })
  }
  return out
}

/**
 * What the drawing puts on every sheet, as this paper shows it. It was drawn in millimetres of
 * real paper on a sheet of a given size, so it is multiplied by the paper's scale to stand on the
 * drawing: it keeps its printed size wherever the paper lies and whatever its scale. On a sheet
 * of another size each thing keeps its distance from the corner it was nearest to, so what was in
 * the bottom right corner still is. Text fields are filled in for this sheet.
 */
function sheetContent(node: NodeOf<'paper'>, ctx: KindContext): Primitive[] {
  const component = node.plain ? undefined : sheetContentOf(ctx.doc)
  // A sheet lying inside that component would draw itself.
  if (!component?.sheet || ctx.depth >= MAX_INSTANCE_DEPTH || rootOf(ctx.doc, node.parent)?.id === component.id) return []
  const scale = node.scale ?? DEFAULT_PAPER_SCALE
  const inner: KindContext = { ...ctx, depth: ctx.depth + 1, sheet: { ...paperSheet(node), page: node.parent } }
  const [wider, taller] = [node.width / scale - component.sheet.width, node.height / scale - component.sheet.height]
  const [midX, midY] = [component.sheet.width / 2, component.sheet.height / 2]
  return childrenOf(ctx.doc, component.id)
    .filter((child) => child.type !== 'paper' && isVisible(ctx.doc, child))
    .flatMap((child) => {
      const prims = nodePrimitives(child, inner)
      const reach = prims.map(primitiveBounds).reduce<Bounds | null>(unionBounds, null)
      if (!reach) return []
      const [right, low] = [(reach.minX + reach.maxX) / 2 > midX, (reach.minY + reach.maxY) / 2 > midY]
      return prims.map((prim) => transformPrimitive(prim, { x: node.x + (right ? wider * scale : 0), y: node.y + (low ? taller * scale : 0), scale }))
    })
}

/** Text size of an annotation that does not give one, and how much its leader curves by default. */
export const ANNOTATION_TEXT_SIZE = 200
export const ANNOTATION_BEND = 0.2

/** The length of the symbols at the ends of a line that does not give one, in mm. */
export const LINE_MARKER_SIZE = 150

/** The symbols at the two ends of a line through `points`, each pointing the way the line arrives there. */
function endMarkers(points: Vec2[], node: { startMarker?: NodeOf<'dimension'>['startMarker']; endMarker?: NodeOf<'dimension'>['endMarker']; markerSize?: number }): Primitive[] {
  if (points.length < 2 || (!node.startMarker && !node.endMarker)) return []
  const size = node.markerSize ?? LINE_MARKER_SIZE
  const atStart = norm(sub(points[0], points[1]))
  const atEnd = norm(sub(points[points.length - 1], points[points.length - 2]))
  return [...dimensionMarker(node.startMarker ?? 'none', points[0], atStart, atStart, size, {}), ...dimensionMarker(node.endMarker ?? 'none', points[points.length - 1], atEnd, atEnd, size, {})]
}

/** A text as one primitive per line, each a line height below the one before, turned with the text. */
function textLines(text: string, at: Vec2, size: number, look: { rotation?: number; font?: string; align?: 'left' | 'center' | 'right'; bold?: boolean }): Primitive[] {
  return text.split('\n').flatMap((line, i): Primitive[] => {
    if (line === '') return []
    const down = rotate({ x: 0, y: i * size * 1.25 }, look.rotation ?? 0)
    return [{ kind: 'text', x: at.x + down.x, y: at.y + down.y, text: line, size, ...look }]
  })
}

/** The angles an ellipse is an arc between, or null when it is whole. One angle given alone runs to or from the X axis. */
export function arcOf(node: { from?: number; to?: number }): { from: number; to: number } | null {
  return node.from === undefined && node.to === undefined ? null : { from: node.from ?? 0, to: node.to ?? 360 }
}

/**
 * The leader of an annotation as points from its tip to its text: a straight line, or a curve that
 * bows to one side by `bend` times its length, like a line drawn by hand.
 */
export function annotationCurve(node: { a: Vec2; b: Vec2; bend?: number; shape?: 'curve' | 'straight' | 'elbow' }): Vec2[] {
  const length = dist(node.a, node.b)
  const bend = node.bend ?? ANNOTATION_BEND
  if (node.shape === 'elbow') {
    // Level from the text, then square down or up to the tip; with nothing to turn, a straight line.
    const corner = { x: node.a.x, y: node.b.y }
    return dist(corner, node.a) < 1e-6 || dist(corner, node.b) < 1e-6 ? [node.a, node.b] : [node.a, corner, node.b]
  }
  if (length < 1e-6 || Math.abs(bend) < 1e-6 || node.shape === 'straight') return [node.a, node.b]
  const control = add(mid(node.a, node.b), scale(perp(norm(sub(node.b, node.a))), bend * length))
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20
    const [p, q, r] = [(1 - t) ** 2, 2 * t * (1 - t), t ** 2]
    return { x: p * node.a.x + q * control.x + r * node.b.x, y: p * node.a.y + q * control.y + r * node.b.y }
  })
}

/** Where an annotation's text is anchored: just past `b`, on the side away from the tip. */
export function annotationText(node: { a: Vec2; b: Vec2; size?: number }): { x: number; y: number; size: number; right: boolean } {
  const size = node.size ?? ANNOTATION_TEXT_SIZE
  const right = node.b.x < node.a.x
  // Lowered so that the leader arrives at the middle of the line of text, not at its baseline.
  return { x: node.b.x + (right ? -1 : 1) * size * 0.3, y: node.b.y + size * 0.35, size, right }
}

function annotationPrimitives(node: NodeOf<'annotation'>, ctx: KindContext): Primitive[] {
  const curve = annotationCurve(node)
  const words = annotationText(node)
  const text = textLines(said(node.text, node.parent, ctx), words, words.size, { align: words.right ? 'right' : 'left', font: node.font })
  if (curve.length < 2 || dist(node.a, node.b) < 1e-6) return text
  const markerSize = node.markerSize ?? words.size * 0.75
  // Each end symbol points the way the leader is heading as it arrives there.
  const atTip = norm(sub(curve[0], curve[1]))
  const atText = norm(sub(curve[curve.length - 1], curve[curve.length - 2]))
  return [
    { kind: 'path', points: curve },
    ...dimensionMarker(node.startMarker ?? 'arrow', node.a, atTip, atTip, markerSize, {}),
    ...dimensionMarker(node.endMarker ?? 'none', node.b, atText, atText, markerSize, {}),
    ...text,
  ]
}

/** The diameter of a grid line's bubble when it does not give one, in mm. */
export const GRIDLINE_BUBBLE = 800

/**
 * Where the bubbles of a grid line are: past its ends, each touching the line. A bubble is a circle
 * of radius `r`, its label `r` tall; a label too wide for it stretches it level into a pill, whose
 * straight sides run `half` either side of its middle. Without the font's measures, a label is
 * taken to be 0.55 of its height wide per character, as elsewhere, with a margin of 0.35 r each side.
 */
export function gridlineBubbles(node: Pick<NodeOf<'gridline'>, 'a' | 'b' | 'bubbles' | 'size' | 'label'>): { centre: Vec2; r: number; half: number }[] {
  const r = (node.size ?? GRIDLINE_BUBBLE) / 2
  const half = Math.max(0, r * (node.label.length * 0.275 + 0.35 - 1))
  const along = dist(node.a, node.b) < 1e-6 ? { x: 0, y: 1 } : norm(sub(node.b, node.a))
  const which = node.bubbles ?? 'start'
  const ends = [
    ...(which === 'start' || which === 'both' ? [{ at: node.a, out: scale(along, -1) }] : []),
    ...(which === 'end' || which === 'both' ? [{ at: node.b, out: along }] : []),
  ]
  // The pill lies level whichever way the line runs, so it reaches further along a line that runs across it.
  return ends.map(({ at, out }) => ({ centre: add(at, scale(out, r + Math.abs(out.x) * half)), r, half }))
}

/** A grid line's bubble: a circle, or a level pill when its label is too wide for one. */
function gridlineBubble({ centre, r, half }: { centre: Vec2; r: number; half: number }, look: object): Primitive {
  if (half < 1e-6) return { kind: 'ellipse', cx: centre.x, cy: centre.y, rx: r, ry: r, ...look }
  const right = ellipseArc({ cx: centre.x + half, cy: centre.y, rx: r, ry: r, from: -90, to: 90 })
  const left = ellipseArc({ cx: centre.x - half, cy: centre.y, rx: r, ry: r, from: 90, to: 270 })
  return { kind: 'path', points: [...right, ...left], closed: true, ...look }
}

function gridlinePrimitives(node: NodeOf<'gridline'>): Primitive[] {
  // The node's style is the line. The bubbles and their label take its colour and weight but are never dashed.
  const look = { own: true, stroke: node.style?.stroke, strokeWidth: node.style?.strokeWidth }
  const line: Primitive[] = dist(node.a, node.b) < 1e-6 ? [] : [{ kind: 'path', points: [node.a, node.b] }]
  return [
    ...line,
    ...gridlineBubbles(node).flatMap(({ centre, r, half }): Primitive[] => [
      gridlineBubble({ centre, r, half }, look),
      // Upright whichever way the line runs, so that every label of a grid reads the same way.
      ...(node.label === '' ? [] : [{ kind: 'text' as const, x: centre.x, y: centre.y + r * 0.35, text: node.label, size: r, align: 'center' as const, font: node.font, own: true, stroke: node.style?.stroke }]),
    ]),
  ]
}

/**
 * The label of the grid line after one labelled `label`: the next letter (A, B … Z, AA), or the
 * next number (1, 2 … 10), keeping what comes before, so "A1" is followed by "A2". A label that
 * ends in neither is kept as it is.
 */
export function nextGridLabel(label: string): string {
  const number = /^(.*?)(\d+)$/.exec(label)
  if (number) {
    const next = String(Number(number[2]) + 1).padStart(number[2].length, '0')
    return number[1] + next
  }
  const letters = /^(.*?)([A-Z]+|[a-z]+)$/.exec(label)
  if (!letters) return label
  const first = letters[2] === letters[2].toUpperCase() ? 'A' : 'a'
  const chars = letters[2].split('')
  let i = chars.length - 1
  // Z rolls over to A and carries, as on a counter: Z is followed by AA, AZ by BA.
  while (i >= 0 && chars[i].toUpperCase() === 'Z') chars[i--] = first
  if (i < 0) chars.unshift(first)
  else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1)
  return letters[1] + chars.join('')
}

function dimensionPrimitives(node: NodeOf<'dimension'>, drawing?: DrawingSettings): Primitive[] {
  const length = dist(node.a, node.b)
  if (length < 1e-6) return []
  const size = node.size ?? DIMENSION_TEXT_SIZE
  const dir = norm(sub(node.b, node.a))
  const n = perp(dir)
  const side = Math.sign(node.offset || 1)
  const a = add(node.a, scale(n, node.offset))
  const b = add(node.b, scale(n, node.offset))
  const middle = mid(a, b)

  // The node's style is the dimension line. Markers follow it but are never dashed; extension
  // lines and text follow it unless they have settings of their own.
  const line = node.style
  const markers = { own: true, stroke: line?.stroke, strokeWidth: line?.strokeWidth }
  const extension = {
    own: true,
    stroke: node.extension?.stroke ?? line?.stroke,
    strokeWidth: node.extension?.strokeWidth ?? line?.strokeWidth,
    dash: node.extension?.dash,
  }
  const gap = scale(n, side * (node.extensionGap ?? 0))
  const overshoot = scale(n, side * size * 0.4)

  const label = dimensionLabel(node, length, drawing)
  const width = label.length * size * 0.55
  const position = node.textPosition ?? 'above'
  let angle = 0
  let anchor: Vec2
  // How much of the dimension line the text covers on each side of the middle when it sits on it.
  let cover: number
  if (node.textRotation === 'horizontal') {
    // Push the text off the line along the normal that points up the sheet (or left for a vertical line).
    const up = n.y > 0 || (n.y === 0 && n.x > 0) ? scale(n, -1) : n
    const away = position === 'center' ? 0 : (size * 0.3 + (Math.abs(up.x) * width) / 2 + Math.abs(up.y) * size * 0.5) * (position === 'below' ? -1 : 1)
    const centre = add(middle, scale(up, away))
    anchor = { x: centre.x, y: centre.y + size * 0.35 }
    cover = (Math.abs(dir.x) * width) / 2 + Math.abs(dir.y) * size * 0.6 + size * 0.2
  } else {
    // Along the line, turned to read from below. On a vertical line it reads from bottom to top
    // or from top to bottom, as the dimension says; one that leans a little reads the same way.
    angle = ((((Math.atan2(dir.y, dir.x) * 180) / Math.PI) % 180) + 180) % 180
    if (Math.abs(angle - 90) <= VERTICAL_TEXT_TOLERANCE) {
      if (node.verticalText === 'up') angle -= 180
    } else if (angle > 90) angle -= 180
    const lift = position === 'above' ? size * 0.3 : position === 'below' ? -size : -size * 0.35
    anchor = add(middle, scale(rotate({ x: 0, y: -1 }, angle), lift))
    cover = width / 2 + size * 0.3
  }
  const broken = position === 'center' && length > 2 * cover
  const lines: Vec2[][] = broken ? [[a, sub(middle, scale(dir, cover))], [add(middle, scale(dir, cover)), b]] : [[a, b]]
  const markerSize = node.markerSize ?? DIMENSION_MARKER_SIZE

  return [
    { kind: 'path', points: [add(node.a, gap), add(a, overshoot)], ...extension },
    { kind: 'path', points: [add(node.b, gap), add(b, overshoot)], ...extension },
    ...lines.map((points): Primitive => ({ kind: 'path', points })),
    ...dimensionMarker(node.startMarker, a, scale(dir, -1), dir, markerSize, markers),
    ...dimensionMarker(node.endMarker, b, dir, dir, markerSize, markers),
    {
      kind: 'text',
      x: anchor.x,
      y: anchor.y,
      text: label,
      size,
      rotation: angle,
      align: 'center',
      font: node.font,
      own: true,
      stroke: node.textColor ?? line?.stroke,
    },
  ]
}

// Building a data: URL copies megabytes, so it is done once per asset, not once per redraw.
const assetUrls = new WeakMap<Asset, string>()

export function assetUrl(asset: Asset): string {
  let url = assetUrls.get(asset)
  if (!url) {
    url = `data:${asset.mime};base64,${asset.data}`
    assetUrls.set(asset, url)
  }
  return url
}

function placeholder(label: string): Primitive[] {
  const s = 600
  return [
    { kind: 'path', closed: true, dash: [4, 4], points: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }] },
    { kind: 'text', x: s / 2, y: s / 2, text: label, size: 80, align: 'center' },
  ]
}

/** A primitive drawn see-through by `by` (0 to 1): its stroke and fill, or a picture as a whole. */
function fadedPrimitive(prim: Primitive, by: number): Primitive {
  if (prim.kind === 'image') return { ...prim, opacity: (prim.opacity ?? 1) * by }
  return { ...prim, ...(prim.stroke === undefined ? {} : { stroke: fadeColor(prim.stroke, by) }), ...(prim.fill === undefined ? { faded: (prim.faded ?? 1) * by } : { fill: fadeColor(prim.fill, by) }) }
}

const KINDS: { [T in NodeType]: NodeKind<NodeOf<T>> } = {
  page: { primitives: () => [], move: () => ({}), transform: () => null },
  component: { primitives: () => [], move: () => ({}), transform: () => null },
  group: {
    primitives: (node, ctx) => {
      const prims = childrenOf(ctx.doc, node.id)
        .filter((child) => isVisible(ctx.doc, child))
        .flatMap((child) => nodePrimitives(child, ctx))
      // A group made see-through is so by the colours of all it draws, and its pictures by their
      // own opacity, which every export knows already; groups inside it are faded again.
      const by = node.opacity ?? 1
      return by >= 1 ? prims : prims.map((prim) => fadedPrimitive(prim, by))
    },
    // A group has nothing of its own to move or transform; see moveOps and transformOps.
    move: () => ({}),
    transform: () => ({}),
  },
  line: {
    primitives: (node) => [{ kind: 'path', points: [node.a, node.b] }, ...endMarkers([node.a, node.b], node)],
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
    transform: (node, t) => ({ ...transformAB(node, t), ...markerSize(node, t) }),
    parallel: (node, distance) => {
      const path = parallelPath([node.a, node.b], false, distance)
      return path && { a: path[0], b: path[1] }
    },
    beside: (node, p) => besidePath([node.a, node.b], false, p),
  },
  polyline: {
    primitives: (node) => [{ kind: 'path', points: node.smooth ? smoothPoints(node.points, node.closed) : node.points, closed: node.closed }, ...(node.closed ? [] : endMarkers(node.points, node))],
    move: (node, d) => ({ points: node.points.map((p) => add(p, d)) }),
    handles: (node) => node.points,
    moveHandle: (node, index, p) => ({ points: node.points.map((q, i) => (i === index ? p : q)) }),
    transform: (node, t) => ({ points: node.points.map((p) => t.point(p)), ...markerSize(node, t) }),
    parallel: (node, distance) => {
      const points = parallelPath(node.points, !!node.closed, distance, node.smooth)
      return points && { points }
    },
    beside: (node, p) => besidePath(node.smooth ? smoothPoints(node.points, node.closed) : node.points, !!node.closed, p),
  },
  rect: {
    primitives: (node) => [{ kind: 'path', points: rectCorners(node), closed: true }],
    // Its corners run clockwise on screen: a positive distance is inwards.
    parallel: (node, distance) => {
      const [width, height] = [node.width - 2 * distance, node.height - 2 * distance]
      if (width <= 0 || height <= 0) return null
      return { ...add(node, rotate({ x: distance, y: distance }, node.rotation ?? 0)), width, height }
    },
    beside: (node, p) => besidePath(rectCorners(node), true, p),
    move: moveXY,
    // No points of its own to drag: it is resized as a box, by a frame that turns with it (resize.ts).
    transform: transformBox,
  },
  room: {
    primitives: (node, ctx) => {
      const region = roomAt(ctx.doc, node.parent, node)
      const size = node.size ?? 250
      const label = (text: string, line: number): Primitive => ({ kind: 'text', x: node.x, y: node.y + line * size * 1.3, text, size, align: 'center' })
      const name = label(node.name ?? '', 0)
      // Walls that no longer close leave a room with no floor to show; its name stays, to find it by.
      if (!region) return [name]
      // The room's stroke is the colour of its name: the floor keeps no outline whatever it is.
      const floor: Primitive = { kind: 'path', points: region.outline, closed: true, fill: ROOM_FILL, stroke: 'none', over: true, backdrop: 'floor' }
      // Under the name, its area, then how far it is round it: each on the next line, as many as are shown.
      const lines = [...(node.showArea === false ? [] : [roomArea(node, region.area, ctx.doc.settings)]), ...(node.showPerimeter ? [roomPerimeter(node, regionPerimeter(region), ctx.doc.settings)] : [])]
      return [floor, name, ...lines.map((text, i) => label(text, i + 1))]
    },
    move: moveXY,
    // The floor is not something to snap to; the walls around it are.
    snapPoints: () => [],
    snapLines: () => [],
    transform: (node, t) => ({ ...t.point(node), ...(node.size === undefined && t.scale === 1 ? {} : { size: t.length(node.size ?? 250) }) }),
  },
  table: {
    primitives: (node, ctx) => tablePrimitives(node, ctx.doc, ctx.registry, (object) => symbolPrimitives(object, ctx)),
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
    // A table stays upright and readable: it goes to where its corner is taken, its text scaled.
    transform: (node, t) => ({ ...t.point(node), ...(node.size === undefined && t.scale === 1 ? {} : { size: t.length(node.size ?? 200) }) }),
  },
  divider: {
    primitives: (node) => [{ kind: 'path', points: [node.a, node.b], stroke: DIVIDER_INK, dash: [8, 6], own: true }],
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
    transform: transformAB,
  },
  paper: {
    primitives: (node, ctx) => [{ kind: 'path', points: boxCorners(node), closed: true, fill: PAPER_FILL, stroke: PAPER_EDGE, backdrop: true }, ...titleBlock(node, ctx.doc), ...sheetContent(node, ctx)],
    move: moveXY,
    handles: boxCorners,
    moveHandle: (node, index, p) => {
      const fixed = boxCorners(node)[(index + 2) % 4]
      return { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y), width: Math.abs(p.x - fixed.x), height: Math.abs(p.y - fixed.y) }
    },
    // A sheet stays upright, about its middle: a quarter turn swaps its sides.
    transform: (node, t) => {
      const centre = t.point({ x: node.x + node.width / 2, y: node.y + node.height / 2 })
      const quarter = Math.abs((((t.turn % 180) + 180) % 180) - 90) < 1e-6
      const width = t.length(quarter ? node.height : node.width)
      const height = t.length(quarter ? node.width : node.height)
      return { x: tidy(centre.x - width / 2), y: tidy(centre.y - height / 2), width, height }
    },
  },
  ellipse: {
    // With a start and an end angle it is an arc, drawn as an open line.
    primitives: (node) => {
      const arc = arcOf(node)
      return arc ? [{ kind: 'path', points: ellipseArc({ ...node, ...arc }) }] : [{ kind: 'ellipse', cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, rotation: node.rotation }]
    },
    move: (node, d) => ({ cx: node.cx + d.x, cy: node.cy + d.y }),
    snapPoints: (node) => {
      const centre = { x: node.cx, y: node.cy }
      const arc = arcOf(node)
      if (!arc) return [centre]
      const points = ellipseArc({ ...node, ...arc })
      return [centre, points[0], points[points.length - 1]]
    },
    transform: (node, t) => {
      const centre = t.point({ x: node.cx, y: node.cy })
      // Mirrored, an arc runs the other way round: its ends swap, each to the other side of the axis.
      const ends = arcOf(node)
      const arc = t.mirror && ends ? { from: turned(180 - ends.to), to: turned(180 - ends.from) } : {}
      return { cx: centre.x, cy: centre.y, rx: t.length(node.rx), ry: t.length(node.ry), rotation: t.angle(node.rotation), ...arc }
    },
    // What runs parallel to a circle is a circle; to any other ellipse, no ellipse. A positive distance is outwards.
    parallel: (node, distance) => {
      const radius = node.rx + distance
      return Math.abs(node.rx - node.ry) < 1e-6 && radius > 0 ? { rx: radius, ry: radius } : null
    },
    beside: (node, p) => dist(p, { x: node.cx, y: node.cy }) - node.rx,
  },
  text: {
    primitives: (node, ctx) => textLines(said(node.text, node.parent, ctx), node, node.size, { rotation: node.rotation, font: node.font, align: node.align, bold: node.bold }),
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
    // Its width is not known exactly without the renderer's font; this matches the estimate used for picking.
    transform: (node, t) => ({ ...t.box(node, node.text.length * node.size * 0.55), size: t.length(node.size), rotation: t.angle(node.rotation) }),
  },
  annotation: {
    primitives: annotationPrimitives,
    move: moveAB,
    // The two ends, and the middle of the leader, which is dragged to bend it.
    handles: (node) => {
      const curve = annotationCurve(node)
      // Only a curved leader has a middle to pull on.
      return (node.shape ?? 'curve') === 'curve' ? [node.a, node.b, curve[Math.floor(curve.length / 2)]] : [node.a, node.b]
    },
    moveHandle: (node, index, p) => {
      if (index < 2) return moveHandleAB(node, index, p)
      const length = dist(node.a, node.b)
      if (length < 1e-6) return {}
      // The middle of the curve stands off the straight line by half of what the bend says.
      const off = sub(p, mid(node.a, node.b))
      const across = perp(norm(sub(node.b, node.a)))
      return { bend: Math.round(((2 * (off.x * across.x + off.y * across.y)) / length) * 1000) / 1000 }
    },
    snapPoints: (node) => [node.a, node.b],
    // A leader points at things; it is not one of them.
    snapLines: () => [],
    transform: (node, t) => ({
      ...transformAB(node, t),
      ...(node.size === undefined && t.scale === 1 ? {} : { size: t.length(node.size ?? ANNOTATION_TEXT_SIZE) }),
      ...markerSize(node, t),
      // Which side the leader bows to is a matter of handedness, which a mirror reverses.
      ...(t.mirror ? { bend: -(node.bend ?? ANNOTATION_BEND) } : {}),
    }),
  },
  gridline: {
    primitives: gridlinePrimitives,
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
    snapPoints: (node) => [node.a, node.b],
    // Things are drawn on the grid: its line is one to snap onto, its bubbles are not.
    snapLines: (node) => [[node.a, node.b]],
    // The label stays upright, whatever turns the line.
    transform: (node, t) => ({ ...transformAB(node, t), ...(node.size === undefined && t.scale === 1 ? {} : { size: t.length(node.size ?? GRIDLINE_BUBBLE) }) }),
  },
  wall: {
    primitives: (node, ctx) => {
      const pieces = wallPolygons(node, ctx.doc, ctx.registry)
      // With an edge hidden or given a look of its own, the wall is still filled whole, but its
      // outline is drawn edge by edge: runs of the edges shown, each with its look, as lines that
      // merge like the outline does.
      const runs = wallOutlineRuns(node, pieces)
      const look = (edge: WallEdge | undefined) => (edge ? { over: true, stroke: edge.stroke, strokeWidth: edge.strokeWidth, dash: edge.dash } : {})
      // Walls are painted together, those of one material as one shape; where one material meets
      // another, the line is drawn over them, and a wall over one of another material shows its
      // outline and pattern over it, as stacked (`paintOrder`, `outsideMass`).
      const union = `wall:${node.material && ctx.doc.materials?.[node.material] ? node.material : ''}`
      return [
        ...pieces.map((points): Primitive => ({ kind: 'path', closed: true, union, fill: WALL_FILL, points, ...(runs ? { stroke: 'none' } : {}) })),
        ...(runs ?? []).map(({ points, edge }): Primitive => ({ kind: 'path', union, fill: 'none', points, ...look(edge === 'opening' ? undefined : node.edges?.[edge]) })),
        ...wallSeams(node, ctx.doc).map(({ points, end }): Primitive => ({ kind: 'path', points, ...look(node.edges?.[end]) })),
        // Drawn over the wall, it takes the wall's line but not its fill.
        ...materialSeams(ctx.doc, node, ctx.registry).map((points): Primitive => ({ kind: 'path', points, fill: 'none', over: true })),
      ]
    },
    move: moveAB,
    // Its two ends, and the middle of its line, which is pulled sideways to curve it.
    handles: (node) => [node.a, node.b, wallMiddle(node)],
    moveHandle: (node, index, p) => (index < 2 ? moveHandleAB(node, index, p) : { bulge: bulgeThrough(node, p) ?? null }),
    // The middle of a straight wall is found as the middle of its line; the top of a curve has to be given.
    snapPoints: (node) => (node.bulge ? [node.a, node.b, wallMiddle(node)] : [node.a, node.b]),
    // Its faces as drawn, and its line (its middle, or the face it is drawn by), which is where another wall comes to meet it.
    snapLines: (node, drawn) => [...drawn, wallPoints(node)],
    transform: (node, t) => {
      // The side a curved wall bows to, its left and right faces, and the face it is drawn by are
      // matters of handedness, which a mirror reverses: the same face is then on the other hand.
      const swapped = t.mirror && node.edges && (node.edges.left || node.edges.right) ? { edges: { ...node.edges, left: node.edges.right, right: node.edges.left } } : {}
      const justify = t.mirror && (node.justify === 'left' || node.justify === 'right') ? { justify: node.justify === 'left' ? 'right' : 'left' } : {}
      return { ...transformAB(node, t), thickness: t.length(node.thickness), ...(node.bulge ? { bulge: t.length(node.bulge * (t.mirror ? -1 : 1)) } : {}), ...swapped, ...justify }
    },
  },
  dimension: {
    primitives: (node, ctx) => dimensionPrimitives(styledDimension(ctx.doc, node), ctx.doc.settings),
    move: moveAB,
    // The third handle sits on the dimension line and sets how far it stands off.
    handles: (node) => [node.a, node.b, add(mid(node.a, node.b), scale(perp(norm(sub(node.b, node.a))), node.offset))],
    moveHandle: (node, index, p) => {
      if (index < 2) return moveHandleAB(node, index, p)
      const n = perp(norm(sub(node.b, node.a)))
      return { offset: Math.round((p.x - node.a.x) * n.x + (p.y - node.a.y) * n.y) }
    },
    snapPoints: handlesAB,
    snapLines: () => [],
    transform: (node, t) => ({
      ...transformAB(node, t),
      // The side its line stands on is a matter of handedness, which a mirror reverses.
      offset: t.length(node.offset * (t.mirror ? -1 : 1)),
      ...(node.size === undefined ? {} : { size: t.length(node.size) }),
      ...markerSize(node, t),
      ...(node.extensionGap === undefined ? {} : { extensionGap: t.length(node.extensionGap) }),
    }),
  },
  image: {
    primitives: (node, ctx) => {
      const asset = ctx.doc.assets?.[node.asset]
      if (!asset) return placeholder('missing image').map((p) => transformPrimitive(p, node))
      const { x, y, width, height, rotation, opacity } = node
      return [{ kind: 'image', x, y, width, height, rotation, opacity, href: assetUrl(asset) }]
    },
    move: moveXY,
    // A scanned plan is not geometry: nothing should snap to its corners.
    snapPoints: () => [],
    snapLines: () => [],
    transform: transformBox,
  },
  instance: {
    primitives: (node, ctx) => {
      if (ctx.depth >= MAX_INSTANCE_DEPTH) return []
      const component = ctx.doc.nodes[node.component]
      if (component?.type !== 'component') return placeholder('missing component').map((p) => transformPrimitive(p, node))
      // What the component draws without a colour of its own takes that of the layer it is placed on.
      const placed = node.layer === undefined ? undefined : resolveColor(ctx.doc, ctx.doc.layers[node.layer]?.color)
      const inner = { ...ctx, depth: ctx.depth + 1, ink: placed ?? ctx.ink }
      return childrenOf(ctx.doc, component.id)
        .filter((child) => isVisible(ctx.doc, child))
        .flatMap((child) => nodePrimitives(child, inner))
        .map((p) => transformPrimitive(p, node))
    },
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
    transform: (node, t) => ({ ...t.point(node), rotation: t.angle(node.rotation), ...(t.mirror ? { flipX: !node.flipX } : {}), ...(t.scale === 1 ? {} : { scale: tidy((node.scale ?? 1) * t.scale) }) }),
  },
  parametric: {
    primitives: (node, ctx) => parametricPrimitives(node, ctx).map((p) => transformPrimitive(p, node)),
    move: moveXY,
    // One whose kind says which of its lengths is its size along its X axis (a door's or a window's
    // width) has the two ends of that size to drag, on that axis: each moves alone, the other
    // staying where it is, so the object is stretched along a wall rather than scaled.
    handles: (node, registry) => {
      const size = stretchOf(node, registry)
      return size ? [applyTransform({ x: 0, y: 0 }, node), applyTransform({ x: size.value, y: 0 }, node)] : []
    },
    moveHandle: (node, index, p, registry) => {
      const size = stretchOf(node, registry)
      if (!size) return {}
      // Where the pointer is along the object's own X axis; how far off that axis it is does not count.
      const along = inverseTransform(p, node).x
      const tidy = (n: number) => Math.round(n * 1000) / 1000
      if (index === 1) return { props: { ...node.props, [size.key]: tidy(Math.max(MIN_STRETCH, along)) } }
      // The start moves, and the insertion point with it: the end stays where it was.
      const start = Math.min(along, size.value - MIN_STRETCH)
      const at = applyTransform({ x: start, y: 0 }, node)
      return { x: tidy(at.x), y: tidy(at.y), props: { ...node.props, [size.key]: tidy(size.value - start) } }
    },
    transform: (node, t, registry) => {
      const patch: Record<string, unknown> = { ...t.point(node), rotation: t.angle(node.rotation), ...(t.mirror ? { flipX: !node.flipX } : {}) }
      const kind = registry.parametric.get(node.kind)
      if (t.scale !== 1 && kind) {
        // A door twice the size is a door with twice the width, not a stretched drawing of one.
        const props: Record<string, unknown> = { ...node.props }
        for (const param of kind.params) {
          if (param.unit !== 'length' || typeof param.default !== 'number') continue
          const value = props[param.key]
          props[param.key] = t.length(typeof value === 'number' ? value : param.default)
        }
        patch.props = props
      }
      return patch
    },
  },
}

/** The least a parametric object is stretched to, in mm. */
const MIN_STRETCH = 10

/** The length a parametric object is stretched by along its X axis, as its kind says (`size`), and what it is now; null for a kind that says none. */
function stretchOf(node: NodeOf<'parametric'>, registry: Registry | undefined): { key: string; value: number } | null {
  const kind = registry?.parametric.get(node.kind)
  const key = kind?.size?.x
  if (!kind || !key) return null
  const value = Number(registry!.resolveProps(kind, node.props)[key])
  return Number.isFinite(value) ? { key, value } : null
}

export function kindOf(node: Node): NodeKind<any> {
  return KINDS[node.type]
}

/** Where a straight wall's left face starts, and the way it runs: what an insulation's zigzag is laid from. */
function wallFrame(wall: NodeOf<'wall'>): { x: number; y: number; rotation: number } {
  const along = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x)
  const right = { x: -Math.sin(along), y: Math.cos(along) }
  const left = -wallSides(wall).left
  return { x: wall.a.x + right.x * left, y: wall.a.y + right.y * left, rotation: (along * 180) / Math.PI }
}

/** What backs the closed shapes of a component or an object that have no fill: the white of the paper. */
export const OBJECT_FILL = '#ffffff'

/**
 * A component or an object is a solid thing: a chair hides the floor it stands on. Each of its
 * closed shapes that has no fill of its own is backed with paper white, faded as much as the
 * see-through groups the shape is in; these go under all its lines, so that one shape of the
 * object never hides the lines of another. A shape given the fill 'none' is see-through.
 */
export function objectBacking(prims: Primitive[]): Primitive[] {
  return prims.flatMap((p): Primitive[] =>
    (p.kind === 'path' ? p.closed && p.points.length > 2 : p.kind === 'ellipse') && p.fill === undefined && !p.backdrop
      ? [{ ...p, fill: fadeColor(OBJECT_FILL, p.faded ?? 1), stroke: 'none', dash: undefined }]
      : [],
  )
}

/**
 * Whether what is inside a container is drawn as a solid object wherever it is placed, as
 * `objectBacking` says: inside a component, unless it is what papers draw on every sheet, which
 * they draw as it is.
 */
export function drawnSolid(doc: Document, containerId: string | null): boolean {
  const root = rootOf(doc, containerId)
  return root?.type === 'component' && !root.sheet
}

/**
 * The primitives of a node with styles resolved: the node's own style wins, then what the kind
 * specified, then the layer color, then the default ink. Primitives marked `own` skip the first step.
 */
export function nodePrimitives(node: Node, ctx: KindContext): Primitive[] {
  // References to shared colours are followed here, once, for whatever the kind and the style say;
  // so is "the layer's colour", which is that of the node's layer, or what it would be drawn in without one.
  const layerColor = resolveColor(ctx.doc, node.layer === undefined ? undefined : ctx.doc.layers[node.layer]?.color)
  const paint = (value: string | undefined) => resolveColor(ctx.doc, value, layerColor ?? ctx.ink ?? DEFAULT_INK)
  // A room's floor takes the colour and pattern of its material, unless it gives its own.
  const material = node.type === 'room' && node.material ? ctx.doc.materials?.[node.material] : undefined
  const floored = material && { ...(material.fill === undefined ? {} : { fill: material.fill }), ...(material.pattern === undefined ? {} : { pattern: material.pattern }) }
  // A wall takes the look of its material, or of the default material, unless it gives its own.
  const made = node.type === 'wall' ? ((node.material ? ctx.doc.materials?.[node.material] : undefined) ?? ctx.doc.materials?.[DEFAULT_MATERIAL]) : undefined
  const walled = made && { ...(made.fill === undefined ? {} : { fill: made.fill }), ...(made.pattern === undefined ? {} : { pattern: made.pattern }) }
  // A dimension takes from its style what the style defines, and keeps what it says for itself.
  const style = node.type === 'dimension' ? styledDimension(ctx.doc, node).style : floored ? { ...floored, ...node.style } : walled ? { ...walled, ...node.style } : node.style
  const styled = kindOf(node)
    .primitives(node, ctx)
    .map((p) => {
      // A merged shape that is only filled, or only drawn, stays so whatever the style says: it is
      // one half of a wall whose outline is drawn edge by edge.
      const split = p.kind === 'path' && p.union !== undefined
      const stroke = split && p.stroke === 'none' ? 'none' : (paint(p.own ? p.stroke : p.over ? (p.stroke ?? style?.stroke) : (style?.stroke ?? p.stroke)) ?? layerColor ?? ctx.ink ?? DEFAULT_INK)
      // So does a line drawn over the shape that says it has no fill, as between the layers of a wall: a fill of the style would fill the curve it makes.
      const fill = (split || p.over) && p.fill === 'none' ? 'none' : paint(p.own ? p.fill : (style?.fill ?? p.fill))
      return {
        ...p,
        stroke,
        strokeWidth: (p.own ? p.strokeWidth : p.over ? (p.strokeWidth ?? style?.strokeWidth) : (style?.strokeWidth ?? p.strokeWidth)) ?? 1,
        fill: fill === 'stroke' ? stroke : fill,
        dash: p.own ? p.dash : p.over ? (p.dash ?? style?.dash) : (style?.dash ?? p.dash),
      }
    })
  // The pattern of the fill: strokes inside each closed shape, cut to it, over its colour. It is laid
  // from the origin of the drawing, so that walls of one material run on into each other with
  // nothing to show where; but the zigzag of an insulation runs along a straight wall, from one
  // face to the other, as the sign for it is drawn.
  const pattern = style?.pattern
  const fitted = pattern?.kind === 'Zigzag' && node.type === 'wall' && !node.bulge ? wallFrame(node) : undefined
  const laid = pattern && fitted ? { ...pattern, spacing: (node as NodeOf<'wall'>).thickness, angle: 0 } : pattern
  const frame = fitted
  const ink = pattern && fadeColor(paint(pattern.stroke) ?? HATCH_INK, pattern.opacity ?? 1)
  const hatching: Primitive[] = pattern
    ? styled.flatMap((p): Primitive[] => {
        // A merged shape that is only an outline (a wall whose layers fill it) is not a fill to lay a pattern on.
        if (p.own || (p.kind === 'path' && p.union !== undefined && p.fill === 'none')) return []
        const shape = p.kind === 'path' && p.closed ? p.points : p.kind === 'ellipse' ? ellipseArc({ ...p, from: 0, to: 360 }).slice(0, -1) : []
        return patternStrokes(shape, laid!, frame).map(
          (points): Primitive => ({ kind: 'path', points, stroke: ink, strokeWidth: pattern.strokeWidth ?? HATCH_WEIGHT, own: true, texture: true, backdrop: p.backdrop, clip: [...(p.clip ?? []), shape], ...(p.kind === 'path' && p.union !== undefined ? { merged: true } : {}) }),
        )
      })
    : []
  const solid = node.type === 'instance' || node.type === 'parametric'
  const backing = solid ? objectBacking(styled) : []
  // Last of all, so modifiers work on the node as it would otherwise be drawn.
  return applyModifiers(node, [...backing, ...styled, ...hatching], ctx.registry)
}

/** The operations that translate a node by `d`. For a group that means moving everything inside it. */
export function moveOps(doc: Document, node: Node, d: Vec2): Op[] {
  if (node.type === 'group') {
    const own = movedModifiers(node, d)
    return [...childrenOf(doc, node.id).flatMap((child) => moveOps(doc, child, d)), ...(own.modifiers ? [{ op: 'update_node' as const, id: node.id, patch: own }] : [])]
  }
  return [{ op: 'update_node', id: node.id, patch: movePatch(node, d) }]
}

/** The patch that translates one node by `d`, its modifiers with it. For a group this is only its own modifiers. */
export function movePatch(node: Node, d: Vec2): Record<string, unknown> {
  return { ...kindOf(node).move(node, d), ...movedModifiers(node, d) }
}

export function lengthOf(node: { a: Vec2; b: Vec2 }): number {
  return len(sub(node.b, node.a))
}
