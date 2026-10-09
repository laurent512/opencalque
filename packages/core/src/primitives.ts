import {
  applyTransform,
  boundsOfPoints,
  distToSegment,
  pointInPolygon,
  rotate,
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
}

export interface PathPrim extends PrimStyle {
  kind: 'path'
  points: Vec2[]
  closed?: boolean
  /** Paths sharing a union key are painted as one merged shape (outlines first, fills on top). */
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
  switch (p.kind) {
    case 'path':
      return { ...p, points: p.points.map((q) => applyTransform(q, t)) }
    case 'ellipse': {
      const c = applyTransform({ x: p.cx, y: p.cy }, t)
      return { ...p, cx: c.x, cy: c.y, rx: p.rx * (t.scale ?? 1), ry: p.ry * (t.scale ?? 1), rotation: (t.flipX ? -(p.rotation ?? 0) : (p.rotation ?? 0)) + (t.rotation ?? 0) }
    }
    case 'text': {
      const c = applyTransform(p, t)
      return { ...p, x: c.x, y: c.y, size: p.size * (t.scale ?? 1), rotation: (t.rotation ?? 0) + (p.rotation ?? 0) }
    }
    case 'image': {
      // Pictures are moved and turned with their container but never mirrored.
      const c = applyTransform(p, t)
      return { ...p, x: c.x, y: c.y, width: p.width * (t.scale ?? 1), height: p.height * (t.scale ?? 1), rotation: (t.rotation ?? 0) + (p.rotation ?? 0) }
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
