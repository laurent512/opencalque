import { childrenOf, isVisible } from './document'
import { add, dist, len, mid, norm, perp, rotate, scale, sub, type Vec2 } from './geometry'
import { applyModifiers, movedModifiers } from './modifiers'
import { transformPrimitive, type Primitive } from './primitives'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Asset, Document, Node, NodeOf, NodeType } from './schema'
import { roomAt } from './rooms'
import { hostWall, wallPolygons } from './walls'

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

/** Text size of an annotation that does not give one, and how much its leader curves by default. */
export const ANNOTATION_TEXT_SIZE = 200
export const ANNOTATION_BEND = 0.2

/**
 * The leader of an annotation as points from its tip to its text: a straight line, or a curve that
 * bows to one side by `bend` times its length, like a line drawn by hand.
 */
export function annotationCurve(node: { a: Vec2; b: Vec2; bend?: number }): Vec2[] {
  const length = dist(node.a, node.b)
  const bend = node.bend ?? ANNOTATION_BEND
  if (length < 1e-6 || Math.abs(bend) < 1e-6) return [node.a, node.b]
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

function annotationPrimitives(node: NodeOf<'annotation'>): Primitive[] {
  const curve = annotationCurve(node)
  const words = annotationText(node)
  const text: Primitive[] = node.text === '' ? [] : [{ kind: 'text', x: words.x, y: words.y, text: node.text, size: words.size, align: words.right ? 'right' : 'left', font: node.font }]
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
    primitives: (node) => [{ kind: 'path', points: [node.a, node.b] }],
    move: moveAB,
    handles: handlesAB,
    moveHandle: moveHandleAB,
  },
  polyline: {
    primitives: (node) => [{ kind: 'path', points: node.points, closed: node.closed }],
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
    primitives: (node) => [{ kind: 'path', points: boxCorners(node), closed: true, fill: PAPER_FILL, stroke: PAPER_EDGE, backdrop: true }],
    move: moveXY,
    handles: boxCorners,
    moveHandle: (node, index, p) => {
      const fixed = boxCorners(node)[(index + 2) % 4]
      return { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y), width: Math.abs(p.x - fixed.x), height: Math.abs(p.y - fixed.y) }
    },
  },
  ellipse: {
    primitives: (node) => [{ kind: 'ellipse', cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, rotation: node.rotation }],
    move: (node, d) => ({ cx: node.cx + d.x, cy: node.cy + d.y }),
    snapPoints: (node) => [{ x: node.cx, y: node.cy }],
  },
  text: {
    primitives: (node) => [{ kind: 'text', x: node.x, y: node.y, text: node.text, size: node.size, rotation: node.rotation, font: node.font }],
    move: moveXY,
    snapPoints: (node) => [{ x: node.x, y: node.y }],
  },
  annotation: {
    primitives: annotationPrimitives,
    move: moveAB,
    // The two ends, and the middle of the leader, which is dragged to bend it.
    handles: (node) => {
      const curve = annotationCurve(node)
      return [node.a, node.b, curve[Math.floor(curve.length / 2)]]
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
    primitives: (node, ctx) =>
      wallPolygons(node, ctx.doc, ctx.registry).map((points) => ({ kind: 'path', closed: true, union: 'wall', fill: WALL_FILL, points })),
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
 * The primitives of a node with styles resolved: the node's own style wins, then what the kind
 * specified, then the layer color, then the default ink. Primitives marked `own` skip the first step.
 */
export function nodePrimitives(node: Node, ctx: KindContext): Primitive[] {
  const layerColor = node.layer === undefined ? undefined : ctx.doc.layers[node.layer]?.color
  const style = node.style
  const styled = kindOf(node)
    .primitives(node, ctx)
    .map((p) => {
      const stroke = (p.own ? p.stroke : (style?.stroke ?? p.stroke)) ?? layerColor ?? DEFAULT_INK
      const fill = p.own ? p.fill : (style?.fill ?? p.fill)
      return {
        ...p,
        stroke,
        strokeWidth: (p.own ? p.strokeWidth : (style?.strokeWidth ?? p.strokeWidth)) ?? 1,
        fill: fill === 'stroke' ? stroke : fill,
        dash: p.own ? p.dash : (style?.dash ?? p.dash),
      }
    })
  // Last of all, so modifiers work on the node as it would otherwise be drawn.
  return applyModifiers(node, styled, ctx.registry)
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
