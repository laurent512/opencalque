import { childrenOf, isVisible } from './document'
import { add, dist, len, mid, norm, perp, rotate, scale, sub, type Vec2, ellipseArc, smoothPoints } from './geometry'
import { resolveColor } from './colors'
import { fillFields } from './fields'
import { applyModifiers, movedModifiers, segmentsInside, HATCH_INK, patternStrokes } from './modifiers'
import { transformPrimitive, type Primitive } from './primitives'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Asset, Document, Node, NodeOf, NodeType } from './schema'
import { DEFAULT_PAPER_SCALE, paperFormat } from './papers'
import { roomAt } from './rooms'
import { hostWall, wallPolygons, wallSeams } from './walls'

export const DEFAULT_INK = '#1f1f1f'
export const WALL_FILL = '#ffffff'
/** The floor of a room, light enough to draw on, and the line of a divider between two rooms. */
export const ROOM_FILL = 'rgba(96, 125, 170, 0.13)'
export const DIVIDER_INK = '#8b9099'
/** A sheet of paper and its edge. */
export const PAPER_FILL = '#ffffff'
export const PAPER_EDGE = '#c4c8cf'
const DIMENSION_TEXT_SIZE = 150
const DIMENSION_MARKER_SIZE = 100
const MAX_INSTANCE_DEPTH = 8

export interface KindContext {
  doc: Document
  registry: Registry
  depth: number
}

/** How one node type draws itself and responds to direct manipulation. */
export interface NodeKind<N> {
  primitives(node: N, ctx: KindContext): Primitive[]
  /** Patch that translates the node by `d`. */
  move(node: N, d: Vec2): Record<string, unknown>
  /** Points the user can drag to reshape the node. */
  handles?(node: N): Vec2[]
  /** Patch that puts handle `index` at `p`. */
  moveHandle?(node: N, index: number, p: Vec2): Record<string, unknown>
  /** Points other geometry snaps to. Defaults to the vertices of the node's paths. */
  snapPoints?(node: N): Vec2[]
}

const moveXY = (node: { x: number; y: number }, d: Vec2) => ({ x: node.x + d.x, y: node.y + d.y })
const moveAB = (node: { a: Vec2; b: Vec2 }, d: Vec2) => ({ a: add(node.a, d), b: add(node.b, d) })
const handlesAB = (node: { a: Vec2; b: Vec2 }) => [node.a, node.b]
const moveHandleAB = (_: unknown, index: number, p: Vec2) => (index === 0 ? { a: p } : { b: p })

function rectCorners(node: NodeOf<'rect'>): Vec2[] {
  const local = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: node.width, y: node.height },
    { x: 0, y: node.height },
  ]
  return local.map((p) => add(rotate(p, node.rotation ?? 0), node))
}

const boxCorners = (node: { x: number; y: number; width: number; height: number }): Vec2[] => [
  { x: node.x, y: node.y },
  { x: node.x + node.width, y: node.y },
  { x: node.x + node.width, y: node.y + node.height },
  { x: node.x, y: node.y + node.height },
]

function parametricPrimitives(node: NodeOf<'parametric'>, ctx: KindContext): Primitive[] {
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

/** The text a dimension shows for a measured length in mm. */
export function dimensionLabel(node: Pick<NodeOf<'dimension'>, 'text' | 'unit' | 'decimals' | 'showUnit'>, length: number): string {
  if (node.text) return node.text
  const unit = node.unit ?? 'mm'
  const value = (length / { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit]).toFixed(node.decimals ?? { mm: 0, cm: 1, m: 2, in: 1, ft: 2 }[unit])
  return node.showUnit ? `${value} ${unit}` : value
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
  const text = textLines(fillFields(node.text, ctx.doc, node.parent), words, words.size, { align: words.right ? 'right' : 'left', font: node.font })
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

function dimensionPrimitives(node: NodeOf<'dimension'>): Primitive[] {
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

  const label = dimensionLabel(node, length)
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
    angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
    if (angle > 90 || angle <= -90) angle += 180
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

const KINDS: { [T in NodeType]: NodeKind<NodeOf<T>> } = {
  page: { primitives: () => [], move: () => ({}) },
  component: { primitives: () => [], move: () => ({}) },
  group: {
    primitives: (node, ctx) =>
      childrenOf(ctx.doc, node.id)
        .filter((child) => isVisible(ctx.doc, child))
        .flatMap((child) => nodePrimitives(child, ctx)),
    // A group has nothing of its own to move; see moveOps.
    move: () => ({}),
  },
  line: {
    primitives: (node) => [{ kind: 'path', points: [node.a, node.b] }, ...endMarkers([node.a, node.b], node)],
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
  },
  polyline: {
    primitives: (node) => [{ kind: 'path', points: node.smooth ? smoothPoints(node.points, node.closed) : node.points, closed: node.closed }, ...(node.closed ? [] : endMarkers(node.points, node))],
    move: (node, d) => ({ points: node.points.map((p) => add(p, d)) }),
    handles: (node) => node.points,
    moveHandle: (node, index, p) => ({ points: node.points.map((q, i) => (i === index ? p : q)) }),
  },
  rect: {
    primitives: (node) => [{ kind: 'path', points: rectCorners(node), closed: true }],
    move: moveXY,
    handles: (node) => (node.rotation ? [] : rectCorners(node)),
    moveHandle: (node, index, p) => {
      const fixed = rectCorners(node)[(index + 2) % 4]
      return { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y), width: Math.abs(p.x - fixed.x), height: Math.abs(p.y - fixed.y) }
    },
  },
  room: {
    primitives: (node, ctx) => {
      const region = roomAt(ctx.doc, node.parent, node)
      const size = node.size ?? 250
      const label = (text: string, line: number): Primitive => ({ kind: 'text', x: node.x, y: node.y + line * size * 1.3, text, size, align: 'center' })
      const name = label(node.name ?? '', 0)
      // Walls that no longer close leave a room with no floor to show; its name stays, to find it by.
      if (!region) return [name]
      const floor: Primitive = { kind: 'path', points: region.outline, closed: true, fill: ROOM_FILL, stroke: 'none', backdrop: 'floor' }
      return node.showArea === false ? [floor, name] : [floor, name, label(`${(region.area / 1e6).toFixed(2)} m²`, 1)]
    },
    move: moveXY,
    // The floor is not something to snap to; the walls around it are.
    snapPoints: () => [],
  },
  divider: {
    primitives: (node) => [{ kind: 'path', points: [node.a, node.b], stroke: DIVIDER_INK, dash: [8, 6], own: true }],
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
  },
  paper: {
    primitives: (node, ctx) => [{ kind: 'path', points: boxCorners(node), closed: true, fill: PAPER_FILL, stroke: PAPER_EDGE, backdrop: true }, ...titleBlock(node, ctx.doc)],
    move: moveXY,
    handles: boxCorners,
    moveHandle: (node, index, p) => {
      const fixed = boxCorners(node)[(index + 2) % 4]
      return { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y), width: Math.abs(p.x - fixed.x), height: Math.abs(p.y - fixed.y) }
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
  },
  text: {
    primitives: (node, ctx) => textLines(fillFields(node.text, ctx.doc, node.parent), node, node.size, { rotation: node.rotation, font: node.font, align: node.align, bold: node.bold }),
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
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
  },
  wall: {
    primitives: (node, ctx) => {
      const type = node.wallType ? ctx.doc.wallTypes?.[node.wallType] : undefined
      const pieces = wallPolygons(node, ctx.doc, ctx.registry)
      return [
        ...pieces.map((points): Primitive => ({ kind: 'path', closed: true, union: 'wall', fill: type?.fill ?? WALL_FILL, points })),
        ...wallSeams(node, ctx.doc).map((points): Primitive => ({ kind: 'path', points })),
        // Only a build-up measured through and through can be drawn to scale inside the wall.
        ...wallLayerLines(node, (type?.layers ?? []).every((layer) => layer.thickness !== undefined) ? (type?.layers as { thickness: number }[] | undefined) ?? [] : [], pieces),
      ]
    },
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
    snapPoints: (node) => [node.a, node.b, mid(node.a, node.b)],
  },
  dimension: {
    primitives: dimensionPrimitives,
    move: moveAB,
    // The third handle sits on the dimension line and sets how far it stands off.
    handles: (node) => [node.a, node.b, add(mid(node.a, node.b), scale(perp(norm(sub(node.b, node.a))), node.offset))],
    moveHandle: (node, index, p) => {
      if (index < 2) return moveHandleAB(node, index, p)
      const n = perp(norm(sub(node.b, node.a)))
      return { offset: Math.round((p.x - node.a.x) * n.x + (p.y - node.a.y) * n.y) }
    },
    snapPoints: handlesAB,
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
  },
  instance: {
    primitives: (node, ctx) => {
      if (ctx.depth >= MAX_INSTANCE_DEPTH) return []
      const component = ctx.doc.nodes[node.component]
      if (component?.type !== 'component') return placeholder('missing component').map((p) => transformPrimitive(p, node))
      const inner = { ...ctx, depth: ctx.depth + 1 }
      return childrenOf(ctx.doc, component.id)
        .filter((child) => isVisible(ctx.doc, child))
        .flatMap((child) => nodePrimitives(child, inner))
        .map((p) => transformPrimitive(p, node))
    },
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
  },
  parametric: {
    primitives: (node, ctx) => parametricPrimitives(node, ctx).map((p) => transformPrimitive(p, node)),
    move: moveXY,
  },
}

export function kindOf(node: Node): NodeKind<any> {
  return KINDS[node.type]
}

/**
 * The lines between the layers of a wall's build-up: one along the wall at each place where a
 * layer ends and the next begins, counted from its left face. Each is drawn long and kept only
 * where it is inside the wall's own outline, so it stops at openings and meets the same line of
 * the next wall on the mitre of a corner.
 */
function wallLayerLines(wall: NodeOf<'wall'>, layers: { thickness: number }[], pieces: Vec2[][]): Primitive[] {
  if (layers.length < 2 || dist(wall.a, wall.b) < 1e-6) return []
  const d = norm(sub(wall.b, wall.a))
  const n = perp(d)
  const reach = wall.thickness * 4
  const out: Primitive[] = []
  let across = -wall.thickness / 2
  for (const layer of layers.slice(0, -1)) {
    across += layer.thickness
    // The left face is the one on the left when going from a to b: against the normal used here.
    const shift = scale(n, -across)
    const from = add(sub(wall.a, scale(d, reach)), shift)
    const to = add(add(wall.b, scale(d, reach)), shift)
    for (const piece of pieces) for (const points of segmentsInside(from, to, piece)) out.push({ kind: 'path', points, strokeWidth: 0.5 })
  }
  return out
}

/** What backs the closed shapes of a component or an object that have no fill: the white of the paper. */
export const OBJECT_FILL = '#ffffff'

/**
 * The primitives of a node with styles resolved: the node's own style wins, then what the kind
 * specified, then the layer color, then the default ink. Primitives marked `own` skip the first step.
 */
export function nodePrimitives(node: Node, ctx: KindContext): Primitive[] {
  // References to shared colours are followed here, once, for whatever the kind and the style say.
  const paint = (value: string | undefined) => resolveColor(ctx.doc, value)
  const layerColor = paint(node.layer === undefined ? undefined : ctx.doc.layers[node.layer]?.color)
  // A wall takes from its type what the type defines, and keeps what it says for itself.
  const type = node.type === 'wall' && node.wallType ? ctx.doc.wallTypes?.[node.wallType] : undefined
  const typed = type && {
    ...(type.stroke === undefined ? {} : { stroke: type.stroke }),
    ...(type.strokeWidth === undefined ? {} : { strokeWidth: type.strokeWidth }),
    ...(type.dash === undefined ? {} : { dash: type.dash }),
    ...(type.pattern === undefined ? {} : { pattern: type.pattern }),
  }
  const style = typed ? { ...typed, ...node.style } : node.style
  const styled = kindOf(node)
    .primitives(node, ctx)
    .map((p) => {
      const stroke = paint(p.own ? p.stroke : (style?.stroke ?? p.stroke)) ?? layerColor ?? DEFAULT_INK
      const fill = paint(p.own ? p.fill : (style?.fill ?? p.fill))
      return {
        ...p,
        stroke,
        strokeWidth: (p.own ? p.strokeWidth : (style?.strokeWidth ?? p.strokeWidth)) ?? 1,
        fill: fill === 'stroke' ? stroke : fill,
        dash: p.own ? p.dash : (style?.dash ?? p.dash),
      }
    })
  // The pattern of the fill: strokes inside each closed shape, cut to it, over its colour.
  const pattern = style?.pattern
  const hatching: Primitive[] = pattern
    ? styled.flatMap((p): Primitive[] => {
        if (p.own) return []
        const shape = p.kind === 'path' && p.closed ? p.points : p.kind === 'ellipse' ? ellipseArc({ ...p, from: 0, to: 360 }).slice(0, -1) : []
        return patternStrokes(shape, pattern).map(
          (points): Primitive => ({ kind: 'path', points, stroke: paint(pattern.stroke) ?? HATCH_INK, strokeWidth: 0.6, own: true, backdrop: p.backdrop, clip: [...(p.clip ?? []), shape] }),
        )
      })
    : []
  // A component or an object is a solid thing: a chair hides the floor it stands on. Each of its
  // closed shapes that has no fill of its own is backed with paper white, all the backings under
  // all the lines, so that one shape of the object never hides the lines of another.
  const solid = node.type === 'instance' || node.type === 'parametric'
  const backing: Primitive[] = solid
    ? styled.flatMap((p): Primitive[] =>
        (p.kind === 'path' ? p.closed && p.points.length > 2 : p.kind === 'ellipse') && p.fill === undefined && !p.backdrop ? [{ ...p, fill: OBJECT_FILL, stroke: 'none', dash: undefined }] : [],
      )
    : []
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
