import { add, applyTransform, inverseTransform, rotate, sub, type Bounds, type Vec2 } from './geometry'
import type { Registry } from './registry'
import { buildScene, sceneBounds } from './scene'
import type { Document, Node, NodeOf } from './schema'

/**
 * Shapes that are boxes (a rectangle, an ellipse) are resized as boxes, by a frame around them
 * that turns with them: four corners that move two sides, four middles of sides that move one.
 * The side or corner opposite stays where it is.
 */

/** A box as it is drawn: its top-left corner before it is turned, how much it is turned about that corner (degrees, clockwise), its size. */
export interface ResizeFrame {
  origin: Vec2
  rotation: number
  width: number
  height: number
}

/** A parametric object that says how it is resized as a box (`ParametricKind.box`): that, and its parameters with their defaults. */
function boxOf(node: Node, registry?: Registry) {
  const kind = node.type === 'parametric' ? registry?.parametric.get(node.kind) : undefined
  if (!kind?.box || node.type !== 'parametric') return null
  const props = registry!.resolveProps(kind, node.props)
  const bounds = kind.box.bounds(props)
  return Object.values(bounds).every(Number.isFinite) ? { node, box: kind.box, props, bounds } : null
}

/** The box a component's contents fill, in its own coordinates, worked out once for each state of the drawing. */
const contentBoxes = new WeakMap<Document['nodes'], Map<string, Bounds | null>>()
function contentBox(doc: Document, component: string, registry: Registry): Bounds | null {
  let known = contentBoxes.get(doc.nodes)
  if (!known) contentBoxes.set(doc.nodes, (known = new Map()))
  if (!known.has(component)) known.set(component, doc.nodes[component]?.type === 'component' ? sceneBounds(buildScene(doc, component, registry)) : null)
  return known.get(component)!
}

/** A placed component, with the box its contents fill in the component's own coordinates; null for anything else, or a component with nothing in it. */
function placedOf(node: Node, registry?: Registry, doc?: Document) {
  if (node.type !== 'instance' || !registry || !doc) return null
  const box = contentBox(doc, node.component, registry)
  if (!box || box.maxX - box.minX < 1e-6 || box.maxY - box.minY < 1e-6) return null
  return { node, bounds: { left: box.minX, top: box.minY, right: box.maxX, bottom: box.maxY } }
}

/**
 * The frame a node is resized by, or null for a node that is not a box. A parametric object's
 * depends on its kind, found in `registry`; a placed component's on what the component holds, in `doc`.
 */
export function resizeFrame(node: Node, registry?: Registry, doc?: Document): ResizeFrame | null {
  const placed = placedOf(node, registry, doc)
  if (placed) {
    const { left, top, right, bottom } = placed.bounds
    const k = placed.node.scale ?? 1
    // As for a mirrored object below, the frame's left is the right of the component's own box.
    return {
      origin: applyTransform({ x: placed.node.flipX ? right : left, y: top }, placed.node),
      rotation: placed.node.rotation ?? 0,
      width: (right - left) * k * (placed.node.scaleX ?? 1),
      height: (bottom - top) * k * (placed.node.scaleY ?? 1),
    }
  }
  const parametric = boxOf(node, registry)
  if (parametric) {
    const { left, top, right, bottom } = parametric.bounds
    // The frame's left is on the left as it is seen: for a mirrored object, the right of its own box.
    return { origin: applyTransform({ x: node.type === 'parametric' && node.flipX ? right : left, y: top }, parametric.node), rotation: parametric.node.rotation ?? 0, width: right - left, height: bottom - top }
  }
  if (node.type === 'rect') return { origin: { x: node.x, y: node.y }, rotation: node.rotation ?? 0, width: node.width, height: node.height }
  if (node.type === 'ellipse') {
    const rotation = node.rotation ?? 0
    // An ellipse turns about its centre: its frame's corner is where that turn takes it.
    return { origin: add({ x: node.cx, y: node.cy }, rotate({ x: -node.rx, y: -node.ry }, rotation)), rotation, width: 2 * node.rx, height: 2 * node.ry }
  }
  return null
}

/** Which sides of the box each grip moves: corners 0 to 3 (top-left, top-right, bottom-right, bottom-left), then the middles of the top, right, bottom and left sides. */
const MOVES: { left?: true; right?: true; top?: true; bottom?: true }[] = [
  { left: true, top: true },
  { right: true, top: true },
  { right: true, bottom: true },
  { left: true, bottom: true },
  { top: true },
  { right: true },
  { bottom: true },
  { left: true },
]

/** A point of the frame, given in the frame's own terms (0 to width across, 0 to height down), on the drawing. */
const place = (frame: ResizeFrame, local: Vec2) => add(frame.origin, rotate(local, frame.rotation))

/** An upright box as a frame. */
export const boundsFrame = (b: Bounds): ResizeFrame => ({ origin: { x: b.minX, y: b.minY }, rotation: 0, width: b.maxX - b.minX, height: b.maxY - b.minY })

/** The middle of a frame, on the drawing. */
export const frameMiddle = (frame: ResizeFrame): Vec2 => place(frame, { x: frame.width / 2, y: frame.height / 2 })

/** Whether a point of the drawing is inside a frame, or no further than `margin` outside it. */
export function frameContains(frame: ResizeFrame, p: Vec2, margin = 0): boolean {
  const local = rotate(sub(p, frame.origin), -frame.rotation)
  return local.x >= -margin && local.x <= frame.width + margin && local.y >= -margin && local.y <= frame.height + margin
}

/** Where the eight grips are on the drawing, in the order of `MOVES`. */
export function frameGrips(frame: ResizeFrame): Vec2[] {
  const { width: w, height: h } = frame
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ].map((local) => place(frame, local))
}

/** Whether a grip moves only one side, and so changes only the width or only the height. */
export const isSideGrip = (grip: number) => grip >= 4

/**
 * The patch that resizes a box-shaped node by putting grip `grip` at `p`, the opposite side or
 * corner staying where it is. `proportional` keeps the shape's proportions (a corner only). The
 * box keeps its turn; dragged past the opposite side, it turns inside out into a box the other way.
 */
export function resizePatch(node: Node, grip: number, p: Vec2, proportional = false, registry?: Registry, doc?: Document): Record<string, unknown> | null {
  const placed = placedOf(node, registry, doc)
  if (placed) return placedResize(placed, grip, p, proportional)
  const parametric = boxOf(node, registry)
  if (parametric) return parametricResize(parametric, grip, p, proportional)
  const frame = resizeFrame(node)
  const moves = MOVES[grip]
  if (!frame || !moves) return null
  const { width: w, height: h } = frame
  // The pointer in the frame's own terms.
  const local = rotate(sub(p, frame.origin), -frame.rotation)
  let left = moves.left ? local.x : 0
  let right = moves.right ? local.x : w
  let top = moves.top ? local.y : 0
  let bottom = moves.bottom ? local.y : h
  if (proportional && !isSideGrip(grip) && w > 0 && h > 0) {
    // The larger of the two changes sets both, from the corner that stays.
    const k = Math.max(Math.abs(right - left) / w, Math.abs(bottom - top) / h)
    if (moves.left) left = right - Math.sign(right - left || 1) * w * k
    else right = left + Math.sign(right - left || 1) * w * k
    if (moves.top) top = bottom - Math.sign(bottom - top || 1) * h * k
    else bottom = top + Math.sign(bottom - top || 1) * h * k
  }
  const box = { minX: Math.min(left, right), maxX: Math.max(left, right), minY: Math.min(top, bottom), maxY: Math.max(top, bottom) }
  const tidy = (n: number) => Math.round(n * 1000) / 1000 + 0
  if (node.type === 'rect') {
    const corner = place(frame, { x: box.minX, y: box.minY })
    return { x: tidy(corner.x), y: tidy(corner.y), width: tidy(box.maxX - box.minX), height: tidy(box.maxY - box.minY) }
  }
  const centre = place(frame, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
  return { cx: tidy(centre.x), cy: tidy(centre.y), rx: tidy((box.maxX - box.minX) / 2), ry: tidy((box.maxY - box.minY) / 2) }
}

/**
 * A parametric object resized by a grip of its frame: the width or height the pointer gives, made
 * into parameters by its kind (which rounds them to what the object can be), then the object placed
 * so that the side or corner opposite the grip stays where it was. It never turns inside out: a
 * size is at least a millimetre. A corner with `proportional` keeps the object's proportions, the
 * larger of the two changes setting both, as for a shape.
 */
function parametricResize(parametric: NonNullable<ReturnType<typeof boxOf>>, grip: number, p: Vec2, proportional = false): Record<string, unknown> | null {
  const { node, box, props, bounds: b } = parametric as typeof parametric & { node: NodeOf<'parametric'> }
  const seen = MOVES[grip]
  if (!seen) return null
  // In its own terms, a mirrored object's left is the right of what is seen.
  const moves = node.flipX ? { ...seen, left: seen.right, right: seen.left } : seen
  const local = inverseTransform(p, node)
  let width = moves.left || moves.right ? Math.max(1, moves.left ? b.right - local.x : local.x - b.left) : undefined
  let height = moves.top || moves.bottom ? Math.max(1, moves.top ? b.bottom - local.y : local.y - b.top) : undefined
  const [w, h] = [b.right - b.left, b.bottom - b.top]
  if (proportional && !isSideGrip(grip) && width !== undefined && height !== undefined && w > 0 && h > 0) {
    const k = Math.max(width / w, height / h)
    width = Math.max(1, w * k)
    height = Math.max(1, h * k)
  }
  const changed = box.resize(props, { width, height })
  const next = box.bounds({ ...props, ...changed })
  // The side held keeps its place: the far one when the near one moves, else the near one. Along
  // a size that was not pulled but changed with the other (a spiral stays round), the middle stays.
  const middle = (lo: number, hi: number, nlo: number, nhi: number) => (lo + hi) / 2 - (nlo + nhi) / 2
  const dx = moves.left ? b.right - next.right : moves.right ? b.left - next.left : middle(b.left, b.right, next.left, next.right)
  const dy = moves.top ? b.bottom - next.bottom : moves.bottom ? b.top - next.top : middle(b.top, b.bottom, next.top, next.bottom)
  const at = applyTransform({ x: dx, y: dy }, node)
  const tidy = (n: number) => Math.round(n * 1000) / 1000 + 0
  return { x: tidy(at.x), y: tidy(at.y), props: { ...node.props, ...changed } }
}

/**
 * A placed component stretched by a grip of its frame: wider or taller than the component is
 * drawn (`scaleX`, `scaleY`, on top of its `scale`), the side or corner opposite the grip staying
 * where it was, or along a side not pulled, its middle. A corner with `proportional` stretches
 * both ways alike. It never turns inside out: a stretch is at least a hundredth.
 */
function placedResize(placed: NonNullable<ReturnType<typeof placedOf>>, grip: number, p: Vec2, proportional: boolean): Record<string, unknown> | null {
  const { node, bounds: b } = placed as typeof placed & { node: NodeOf<'instance'> }
  const seen = MOVES[grip]
  if (!seen) return null
  const moves = node.flipX ? { ...seen, left: seen.right, right: seen.left } : seen
  const local = inverseTransform(p, node)
  let fx = moves.left || moves.right ? (moves.left ? b.right - local.x : local.x - b.left) / (b.right - b.left) : 1
  let fy = moves.top || moves.bottom ? (moves.top ? b.bottom - local.y : local.y - b.top) / (b.bottom - b.top) : 1
  if (proportional && !isSideGrip(grip)) fx = fy = Math.max(fx, fy)
  const round = (n: number) => Math.round(n * 1e5) / 1e5
  const scaleX = round((node.scaleX ?? 1) * Math.max(0.01, fx))
  const scaleY = round((node.scaleY ?? 1) * Math.max(0.01, fy))
  // The point that stays: on the side held, or the middle of a side not pulled; it is where it was, stretched or not.
  const held = { x: moves.left ? b.right : moves.right ? b.left : (b.left + b.right) / 2, y: moves.top ? b.bottom : moves.bottom ? b.top : (b.top + b.bottom) / 2 }
  const was = applyTransform(held, node)
  const now = applyTransform(held, { ...node, x: 0, y: 0, scaleX, scaleY })
  const tidy = (n: number) => Math.round(n * 1000) / 1000 + 0
  return { x: tidy(was.x - now.x), y: tidy(was.y - now.y), scaleX: scaleX === 1 ? null : scaleX, scaleY: scaleY === 1 ? null : scaleY }
}
