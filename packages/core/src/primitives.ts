import {
  applyTransform,
  boundsOfPoints,
  distToSegment,
  ellipseArc,
  pointInPolygon,
  rotate,
  segmentTouchesBounds,
  type Bounds,
  type Transform,
  type Vec2,
} from './geometry'

/**
 * Primitives are the only thing renderers and exporters understand. Every node kind, built-in or
 * contributed by an extension, describes itself as a list of primitives in world millimetres.
 */
/** Line weights are in screen pixels; on paper one pixel is this many millimetres. A weight of 2 prints as a 0.5 mm line. */
export const PRINT_MM_PER_PIXEL = 0.25

export interface PrimStyle {
  /** CSS color, or 'none'. Also the ink color of text. */
  stroke?: string
  /** Line weight in screen pixels; it does not scale with zoom. */
  strokeWidth?: number
  /** CSS color, 'none', or 'stroke' to fill with whatever the stroke color resolves to. */
  fill?: string
  dash?: number[]
  /**
   * Set when the kind derived this style from the node's own properties. The node's general
   * `style` then does not override it; unset values still fall back to the layer color and defaults.
   */
  own?: boolean
  /** Its own stroke, weight and dash win over the node's style; what it leaves unset still comes from the style. */
  over?: boolean
  /**
   * A surface other things lie on: it is painted beneath them whatever its place in the stacking
   * order, and its fill cannot be clicked (only its outline, if it has one), so that what lies on
   * it stays reachable. `true` is a sheet of paper, under everything; 'floor' is the floor of a
   * room, over papers and pictures but under walls and all else.
   */
  backdrop?: boolean | 'floor'
  /**
   * Outlines the primitive is only visible inside of, all of them at once. They may be any simple shape.
   * Put there by modifiers such as crop; renderers clip to them rather than anything being cut.
   */
  clip?: Vec2[][]
  /**
   * Set on strokes that render a surface (a hatch, the pattern of a fill) rather than outline
   * something. They are drawn like any other line, but nothing snaps to them.
   */
  texture?: boolean
  /** Set on the strokes of a pattern laid on a merged shape (a wall): painted with the merged fills, under their outline, which they would otherwise cross. */
  merged?: boolean
  /**
   * How much the see-through groups it is in let through, multiplied; set only where there is no
   * fill to fade. The white an object backs such a shape with (`objectBacking`) is faded as much.
   */
  faded?: number
}

export interface PathPrim extends PrimStyle {
  kind: 'path'
  points: Vec2[]
  closed?: boolean
  /**
   * Paths with a union key are painted together (`paintOrder`): their fills, then the outline of
   * the whole, centred on its edges, with what lies inside it left out (`mergedOutlines`). Those
   * sharing a key are one shape; one of another key stacked over them shows its outline and its
   * pattern over them (for walls, the key is the material).
   */
  union?: string
}

export interface EllipsePrim extends PrimStyle {
  kind: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
  rotation?: number
}

export interface TextPrim extends PrimStyle {
  kind: 'text'
  /** Baseline anchor. */
  x: number
  y: number
  text: string
  size: number
  rotation?: number
  /** Which part of the text is at (x, y): its left end, its middle, or its right end. Defaults to 'left'. */
  align?: 'left' | 'center' | 'right'
  /** CSS font family. */
  font?: string
  bold?: boolean
}

export interface ImagePrim extends PrimStyle {
  kind: 'image'
  /** Top-left corner; the picture is rotated around it. */
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  /** URL of the picture, usually a data: URL. */
  href: string
  opacity?: number
}

export type Primitive = PathPrim | EllipsePrim | TextPrim | ImagePrim

function imageCorners(p: ImagePrim): Vec2[] {
  const local = [
    { x: 0, y: 0 },
    { x: p.width, y: 0 },
    { x: p.width, y: p.height },
    { x: 0, y: p.height },
  ]
  return local.map((q) => applyTransform(q, { x: p.x, y: p.y, rotation: p.rotation }))
}

export function transformPrimitive(p: Primitive, t: Transform): Primitive {
  const moved = transformGeometry(p, t)
  // What a primitive is clipped to goes wherever the primitive goes.
  return p.clip ? { ...moved, clip: p.clip.map((outline) => outline.map((q) => applyTransform(q, t))) } : moved
}

function transformGeometry(p: Primitive, t: Transform): Primitive {
  const k = t.scale ?? 1
  const [sx, sy] = [k * (t.scaleX ?? 1), k * (t.scaleY ?? 1)]
  switch (p.kind) {
    case 'path':
      return { ...p, points: p.points.map((q) => applyTransform(q, t)) }
    case 'ellipse': {
      // Stretched along an axis it is not square to, an ellipse is no longer one that has a turn
      // and two radii: it is drawn as the line round it, which is.
      const own = (((p.rotation ?? 0) % 180) + 180) % 180
      if (sx !== sy && own !== 0 && own !== 90) {
        const { kind: _, cx, cy, rx, ry, rotation, ...style } = p
        return { ...style, kind: 'path', closed: true, points: ellipseArc({ cx, cy, rx, ry, rotation, from: 0, to: 360 }).slice(0, -1).map((q) => applyTransform(q, t)) }
      }
      const c = applyTransform({ x: p.cx, y: p.cy }, t)
      const [ax, ay] = own === 90 ? [sy, sx] : [sx, sy]
      return { ...p, cx: c.x, cy: c.y, rx: p.rx * ax, ry: p.ry * ay, rotation: (t.flipX ? -(p.rotation ?? 0) : (p.rotation ?? 0)) + (t.rotation ?? 0) }
    }
    case 'text': {
      // Letters are not stretched: they take the stretch across their lines, their height.
      const c = applyTransform(p, t)
      const upright = Math.abs(Math.cos(((p.rotation ?? 0) * Math.PI) / 180)) >= Math.SQRT1_2
      return { ...p, x: c.x, y: c.y, size: p.size * (upright ? sy : sx), rotation: (t.rotation ?? 0) + (p.rotation ?? 0) }
    }
    case 'image': {
      // Pictures are moved and turned with their container but never mirrored.
      const c = applyTransform(p, t)
      return { ...p, x: c.x, y: c.y, width: p.width * sx, height: p.height * sy, rotation: (t.rotation ?? 0) + (p.rotation ?? 0) }
    }
  }
}

/** Approximate outline of a text primitive; exact metrics depend on the renderer's font. */
function textCorners(p: TextPrim): Vec2[] {
  const w = p.text.length * p.size * (p.bold ? 0.6 : 0.55)
  const x0 = p.align === 'center' ? -w / 2 : p.align === 'right' ? -w : 0
  const local = [
    { x: x0, y: -p.size },
    { x: x0 + w, y: -p.size },
    { x: x0 + w, y: p.size * 0.25 },
    { x: x0, y: p.size * 0.25 },
  ]
  return local.map((q) => applyTransform(q, { x: p.x, y: p.y, rotation: p.rotation }))
}

export function primitiveBounds(p: Primitive): Bounds | null {
  let bounds = geometryBounds(p)
  // No tighter than the box of each clip outline: enough for selecting and framing.
  for (const outline of p.clip ?? []) {
    const within = boundsOfPoints(outline)
    if (!bounds || !within) return null
    bounds = { minX: Math.max(bounds.minX, within.minX), minY: Math.max(bounds.minY, within.minY), maxX: Math.min(bounds.maxX, within.maxX), maxY: Math.min(bounds.maxY, within.maxY) }
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return null
  }
  return bounds
}

function geometryBounds(p: Primitive): Bounds | null {
  switch (p.kind) {
    case 'path':
      return boundsOfPoints(p.points)
    case 'ellipse': {
      const r = ((p.rotation ?? 0) * Math.PI) / 180
      const hw = Math.hypot(p.rx * Math.cos(r), p.ry * Math.sin(r))
      const hh = Math.hypot(p.rx * Math.sin(r), p.ry * Math.cos(r))
      return { minX: p.cx - hw, minY: p.cy - hh, maxX: p.cx + hw, maxY: p.cy + hh }
    }
    case 'text':
      return boundsOfPoints(textCorners(p))
    case 'image':
      return boundsOfPoints(imageCorners(p))
  }
}

const filled = (p: PrimStyle) => p.fill !== undefined && p.fill !== 'none'

/** Distance from a point to what the primitive paints; 0 when the point is on a filled area. */
/**
 * Whether a point lies inside a closed shape, filled or not. Components and objects are picked
 * this way: a cabinet drawn as an outline is still a thing one clicks in the middle of.
 */
export function insidePrimitive(p: Primitive, pt: Vec2): boolean {
  if (p.backdrop || p.clip?.some((outline) => !pointInPolygon(pt, outline))) return false
  if (p.kind === 'path') return !!p.closed && p.points.length > 2 && pointInPolygon(pt, p.points)
  if (p.kind === 'ellipse') {
    if (p.rx <= 0 || p.ry <= 0) return false
    const q = rotate({ x: pt.x - p.cx, y: pt.y - p.cy }, -(p.rotation ?? 0))
    return Math.hypot(q.x / p.rx, q.y / p.ry) < 1
  }
  return false
}

/** Whether a line through `points` has any point in the box or, for a `solid` closed shape, the box is inside it. */
function lineTouches(points: Vec2[], closed: boolean, solid: boolean, box: Bounds): boolean {
  const n = points.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    if (segmentTouchesBounds(points[i], points[(i + 1) % n], box)) return true
  }
  // Having crossed no side of it, the box is either wholly inside or wholly outside.
  return solid && pointInPolygon({ x: box.minX, y: box.minY }, points)
}

/**
 * Whether a box has on it something of what a click there would find (`distToPrimitive`): the lines
 * of a shape and the inside of one that is filled, never a floor or the inside of a sheet. Of a
 * clip it asks only that the box meets its outline, which is close enough for selecting.
 */
export function primitiveTouches(p: Primitive, box: Bounds): boolean {
  if (p.backdrop === 'floor') return false
  if (p.clip?.some((outline) => !lineTouches(outline, true, true, box))) return false
  switch (p.kind) {
    case 'path':
      return lineTouches(p.points, !!p.closed, !!p.closed && filled(p) && !p.backdrop, box)
    case 'ellipse':
      return lineTouches(ellipseArc({ ...p, from: 0, to: 360 }), true, filled(p), box)
    case 'text':
      return lineTouches(textCorners(p), true, true, box)
    case 'image':
      return lineTouches(imageCorners(p), true, true, box)
  }
}

export function distToPrimitive(p: Primitive, pt: Vec2): number {
  // A floor and its pattern lie under everything: a click there is for what stands on it.
  if (p.backdrop === 'floor') return Infinity
  // What is clipped away cannot be clicked.
  if (p.clip?.some((outline) => !pointInPolygon(pt, outline))) return Infinity
  switch (p.kind) {
    case 'path': {
      if (p.points.length === 0) return Infinity
      if (p.closed && filled(p) && !p.backdrop && pointInPolygon(pt, p.points)) return 0
      let best = Infinity
      const n = p.points.length
      for (let i = 0; i < (p.closed ? n : n - 1); i++) {
        best = Math.min(best, distToSegment(pt, p.points[i], p.points[(i + 1) % n]))
      }
      return best
    }
    case 'ellipse': {
      if (p.rx <= 0 || p.ry <= 0) return Math.hypot(pt.x - p.cx, pt.y - p.cy)
      const q = rotate({ x: pt.x - p.cx, y: pt.y - p.cy }, -(p.rotation ?? 0))
      const k = Math.hypot(q.x / p.rx, q.y / p.ry)
      if (k < 1 && filled(p)) return 0
      return Math.abs(k - 1) * Math.min(p.rx, p.ry)
    }
    case 'text': {
      const corners = textCorners(p)
      if (pointInPolygon(pt, corners)) return 0
      let best = Infinity
      for (let i = 0; i < 4; i++) best = Math.min(best, distToSegment(pt, corners[i], corners[(i + 1) % 4]))
      return best
    }
    case 'image': {
      const corners = imageCorners(p)
      if (pointInPolygon(pt, corners)) return 0
      let best = Infinity
      for (let i = 0; i < 4; i++) best = Math.min(best, distToSegment(pt, corners[i], corners[(i + 1) % 4]))
      return best
    }
  }
}
