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
  /** Stretch along its own X and Y axes, on top of `scale`: a component placed wider or taller than it is drawn. Default to 1. */
  scaleX?: number
  scaleY?: number
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
  const flipped = { x: (t.flipX ? -p.x : p.x) * k * (t.scaleX ?? 1), y: p.y * k * (t.scaleY ?? 1) }
  const rotated = t.rotation ? rotate(flipped, t.rotation) : flipped
  return { x: rotated.x + t.x, y: rotated.y + t.y }
}

/** The point that `applyTransform` with `t` takes to `p`: a point of the drawing in the terms of what `t` places. */
export function inverseTransform(p: Vec2, t: Transform): Vec2 {
  const k = t.scale ?? 1
  const moved = { x: p.x - t.x, y: p.y - t.y }
  const unrotated = t.rotation ? rotate(moved, -t.rotation) : moved
  const x = unrotated.x / (k * (t.scaleX ?? 1))
  return { x: (t.flipX ? -x : x) || 0, y: unrotated.y / (k * (t.scaleY ?? 1)) || 0 }
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

/** Whether two boxes have any point in common. */
export function boundsTouch(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/** Whether any point of the segment from `a` to `b` is in the box: whether anything of it is left once each side of the box has cut it. */
export function segmentTouchesBounds(a: Vec2, b: Vec2, box: Bounds): boolean {
  let start = 0
  let end = 1
  const sides: [along: number, room: number][] = [
    [a.x - b.x, a.x - box.minX],
    [b.x - a.x, box.maxX - a.x],
    [a.y - b.y, a.y - box.minY],
    [b.y - a.y, box.maxY - a.y],
  ]
  for (const [along, room] of sides) {
    if (along === 0) {
      if (room < 0) return false
    } else if (along < 0) start = Math.max(start, room / along)
    else end = Math.min(end, room / along)
  }
  return start <= end
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

/**
 * A curve flowing through every one of the points (a Catmull-Rom spline), as the points to draw
 * it with: `steps` to each stretch between two of them.
 */
export function smoothPoints(points: Vec2[], closed = false, steps = 12): Vec2[] {
  const n = points.length
  if (n < 3) return points
  const at = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))])
  const out: Vec2[] = []
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const blend = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
      out.push({ x: blend(p0.x, p1.x, p2.x, p3.x), y: blend(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  if (!closed) out.push(points[n - 1])
  return out
}

/**
 * The points of a path with its corners rounded: each corner becomes an arc of `radius` (the same
 * for every corner, or one per point in a list) touching the two sides it joins. A corner takes at
 * most half of a side it shares with another corner, so a radius too large for its sides is made
 * smaller. An open path keeps its two ends; `perQuarter` is how many stretches draw a quarter turn.
 */
export function roundCorners(points: Vec2[], radius: number | readonly number[], closed = true, perQuarter = 6): Vec2[] {
  const n = points.length
  if (n < 3) return points
  const out: Vec2[] = []
  const push = (p: Vec2) => {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) out.push(p)
  }
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const r = typeof radius === 'number' ? radius : (radius[i] ?? 0)
    if (!closed && (i === 0 || i === n - 1)) {
      push(p)
      continue
    }
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const u = norm(sub(prev, p))
    const v = norm(sub(next, p))
    // The angle the two sides make at this corner: none to round when they run on in a straight line.
    const angle = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)))
    if (!(r > 0) || len(u) === 0 || len(v) === 0 || angle < 1e-6 || Math.PI - angle < 1e-6) {
      push(p)
      continue
    }
    // An end of an open path has no arc of its own, so the corner next to it may take the whole side.
    const before = dist(prev, p) / (!closed && i === 1 ? 1 : 2)
    const after = dist(next, p) / (!closed && i === n - 2 ? 1 : 2)
    const tan = Math.tan(angle / 2)
    const reach = Math.min(r / tan, before, after)
    const radiusHere = reach * tan
    const start = add(p, scale(u, reach))
    const end = add(p, scale(v, reach))
    const center = add(p, scale(norm(add(u, v)), radiusHere / Math.sin(angle / 2)))
    const from = Math.atan2(start.y - center.y, start.x - center.x)
    let sweep = Math.atan2(end.y - center.y, end.x - center.x) - from
    if (sweep > Math.PI) sweep -= 2 * Math.PI
    if (sweep < -Math.PI) sweep += 2 * Math.PI
    const steps = Math.max(1, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * perQuarter))
    for (let k = 0; k <= steps; k++) {
      const a = from + (sweep * k) / steps
      push({ x: center.x + radiusHere * Math.cos(a), y: center.y + radiusHere * Math.sin(a) })
    }
  }
  // A closed path whose last arc ends where its first began.
  if (closed && out.length > 1) {
    const [first, last] = [out[0], out[out.length - 1]]
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) out.pop()
  }
  return out
}

/**
 * The circular arc from `a` to `b` through `p`, in the terms of an ellipse that is an arc: its
 * centre, its radius and the angles it runs clockwise between, which may start from `b`. Null when
 * the three points are as good as in line, where there is no such arc.
 */
export function arcThrough(a: Vec2, b: Vec2, p: Vec2): { cx: number; cy: number; r: number; from: number; to: number } | null {
  const chord = dist(a, b)
  if (chord < 1e-6) return null
  const middle = mid(a, b)
  const along = norm(sub(b, a))
  const across = perp(along)
  const u = (p.x - middle.x) * along.x + (p.y - middle.y) * along.y
  const v = (p.x - middle.x) * across.x + (p.y - middle.y) * across.y
  if (Math.abs(v) < chord * 1e-4) return null
  // Across from the middle of the chord, the centre is as far from `p` as from either end.
  const k = (u * u + v * v - (chord * chord) / 4) / (2 * v)
  const centre = add(middle, scale(across, k))
  const angle = (q: Vec2) => (Math.atan2(q.y - centre.y, q.x - centre.x) * 180) / Math.PI
  const turn = (from: number, to: number) => (((to - from) % 360) + 360) % 360
  const [start, end] = [angle(a), angle(b)]
  const fromA = turn(start, angle(p)) < turn(start, end)
  return { cx: centre.x, cy: centre.y, r: dist(centre, a), from: fromA ? start : end, to: fromA ? end : start }
}

/**
 * The point an arc of radius `radius` from `a` to `b` passes through, halfway round, on the side of
 * the chord `towards` is on. There are two such arcs, a short and a long one: it is the one whose
 * middle is nearer `towards`. A radius too small to reach makes a half circle.
 */
export function arcMiddleOfRadius(a: Vec2, b: Vec2, radius: number, towards: Vec2): Vec2 {
  const half = dist(a, b) / 2
  const middle = mid(a, b)
  const across = perp(norm(sub(b, a)))
  const beside = (towards.x - middle.x) * across.x + (towards.y - middle.y) * across.y
  const r = Math.max(radius, half)
  const rise = Math.sqrt(r * r - half * half)
  const [short, long] = [r - rise, r + rise]
  const height = Math.abs(Math.abs(beside) - short) <= Math.abs(Math.abs(beside) - long) ? short : long
  return add(middle, scale(across, beside < 0 ? -height : height))
}

/** Whether two segments cross, each passing from one side of the other to its other side. */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/** Whether a path crosses itself. */
function crossesItself(points: Vec2[], closed: boolean): boolean {
  const n = points.length
  const sides = closed ? n : n - 1
  for (let i = 0; i < sides; i++) {
    for (let j = i + 2; j < sides; j++) {
      if (closed && i === 0 && j === n - 1) continue
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true
    }
  }
  return false
}

/** How near two segments come to each other. */
function segmentsGap(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b))
}

/** Whether every side of `moved` stays at least `clear` from every side of `path`. */
function staysClear(moved: Vec2[], path: Vec2[], closed: boolean, clear: number): boolean {
  const n = path.length
  const sides = closed ? n : n - 1
  for (let i = 0; i < sides; i++) {
    for (let j = 0; j < sides; j++) {
      if (segmentsGap(moved[i], moved[(i + 1) % n], path[j], path[(j + 1) % n]) < clear) return false
    }
  }
  return true
}

/** Past this many points a path moved aside is not looked over for folding: that takes the square of them, and is done as the pointer moves. */
const MAX_FOLD_CHECK = 300

/**
 * A path moved `distance` to its right as it runs (to its left when negative), each side staying
 * parallel to where it was: the sides meet at corners where they now cross. With `smooth`, the
 * points of a curve (`smoothPoints`) instead move straight out from it, keeping its points: it is
 * `distance` away at each, and very nearly so between them. Null when the path has no such
 * parallel: a side would run backwards, or come nearer the path than the distance, which only a
 * fold does: the two sides of a neck passing each other need not cross. A curve is looked at by
 * the lines between its points, which cut its corners, so it is allowed half the distance.
 */
export function parallelPath(points: Vec2[], closed: boolean, distance: number, smooth = false): Vec2[] | null {
  const same = (p: Vec2, q: Vec2) => dist(p, q) < 1e-6
  const path = points.filter((p, i) => i === 0 || !same(p, points[i - 1]))
  if (closed && path.length > 1 && same(path[0], path[path.length - 1])) path.pop()
  const n = path.length
  if (n < 2) return null
  if (distance === 0) return path
  const at = (i: number) => (closed ? path[(i + n) % n] : path[Math.max(0, Math.min(n - 1, i))])
  const moved: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = path[i]
    const before = norm(sub(p, at(i - 1)))
    const after = norm(sub(at(i + 1), p))
    if (smooth) {
      const across = perp(norm(sub(at(i + 1), at(i - 1))))
      if (len(across) === 0) return null
      moved.push(add(p, scale(across, distance)))
      continue
    }
    const [a, b] = [perp(len(before) === 0 ? after : before), perp(len(after) === 0 ? before : after)]
    const meeting = 1 + a.x * b.x + a.y * b.y
    if (meeting < 1e-6) return null
    moved.push(add(p, scale(add(a, b), distance / meeting)))
  }
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [was, is] = [sub(at(i + 1), path[i]), sub(moved[(i + 1) % n], moved[i])]
    if (was.x * is.x + was.y * is.y <= 0) return null
  }
  const clear = Math.abs(distance) * (smooth ? 0.5 : 1 - 1e-6)
  if (n <= MAX_FOLD_CHECK && !crossesItself(path, closed) && !staysClear(moved, path, closed, clear)) return null
  return moved
}

/** How far `p` is from a path, positive to its right as it runs: the side `parallelPath` takes a positive distance to. */
export function besidePath(points: Vec2[], closed: boolean, p: Vec2): number {
  const n = points.length
  let best = Infinity
  let foot = points[0]
  let across = { x: 0, y: 0 }
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const d = sub(b, a)
    const l2 = d.x * d.x + d.y * d.y
    if (l2 === 0) continue
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2))
    const q = add(a, scale(d, t))
    const gap = dist(p, q)
    // Nearest to a corner, it is as near both of the sides there, and the way between them tells.
    if (gap < best - 1e-9) {
      best = gap
      foot = q
      across = perp(norm(d))
    } else if (gap <= best + 1e-9) across = add(across, perp(norm(d)))
  }
  const side = (p.x - foot.x) * across.x + (p.y - foot.y) * across.y
  return side < 0 ? -best : best
}

/** The points of an arc of an ellipse, clockwise on screen from one angle to another (a whole turn when they are equal). */
export function ellipseArc(e: { cx: number; cy: number; rx: number; ry: number; rotation?: number; from: number; to: number }): Vec2[] {
  const sweep = (((e.to - e.from) % 360) + 360) % 360 || 360
  const steps = Math.max(8, Math.ceil(sweep / 4))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = ((e.from + (sweep * i) / steps) * Math.PI) / 180
    const local = rotate({ x: e.rx * Math.cos(angle), y: e.ry * Math.sin(angle) }, e.rotation ?? 0)
    return { x: e.cx + local.x, y: e.cy + local.y }
  })
}
