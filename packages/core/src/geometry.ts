export interface Vec2 {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Placement of a local coordinate system: mirror on X first, then rotate (degrees, clockwise on screen), then translate. */
export interface Transform {
  x: number
  y: number
  rotation?: number
  flipX?: boolean
  /** Size multiplier, applied before anything else. Defaults to 1. */
  scale?: number
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })

export function norm(a: Vec2): Vec2 {
  const l = len(a)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

export function rotate(p: Vec2, degrees: number): Vec2 {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

export function applyTransform(p: Vec2, t: Transform): Vec2 {
  const k = t.scale ?? 1
  const flipped = { x: (t.flipX ? -p.x : p.x) * k, y: p.y * k }
  const rotated = t.rotation ? rotate(flipped, t.rotation) : flipped
  return { x: rotated.x + t.x, y: rotated.y + t.y }
}

export function boundsOfPoints(points: Vec2[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function boundsContainPoint(b: Bounds, p: Vec2, margin = 0): boolean {
  return p.x >= b.minX - margin && p.x <= b.maxX + margin && p.y >= b.minY - margin && p.y <= b.maxY + margin
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a)
  const l2 = d.x * d.x + d.y * d.y
  if (l2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2))
  return dist(p, { x: a.x + t * d.x, y: a.y + t * d.y })
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Points along a circular arc, angles in degrees (0 = +X, 90 = +Y). */
export function arcPoints(center: Vec2, radius: number, startDeg: number, endDeg: number, segments = 24): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const a = ((startDeg + ((endDeg - startDeg) * i) / segments) * Math.PI) / 180
    points.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) })
  }
  return points
}
