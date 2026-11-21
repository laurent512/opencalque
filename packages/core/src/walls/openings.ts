import { isVisible, leavesOf, rootOf } from '../document'
import { add, applyTransform, dist, perp, scale, sub, type Vec2 } from '../geometry'
import type { Registry } from '../registry'
import type { Document, Node, NodeOf } from '../schema'
import { courseOf, distToBody, dot, laidAgainst, middleAcross, tidy, wallArc, wallSides, type Wall } from './course'
import { cellKey, current, drawnWith, wallIndex, wallsIn } from './spatial'

/*
 * Doors and windows in walls. Nothing ties one to its wall but where it is: an opening is in a wall
 * when both ends of the stretch it cuts lie between the wall's faces, found again each time. It
 * goes through the walls laid against that one, face to face, as a lining of insulation and the
 * plaster on it are: a wall of several materials is drawn as several walls side by side.
 */

/** A door or window set in a wall, with the stretch of the wall's middle line it takes (distances from `a`). */
interface Cut {
  node: NodeOf<'parametric'>
  from: number
  to: number
  visible: boolean
}

/** The doors and windows of one page or component and the walls they are set in. */
interface OpeningIndex {
  /** For each wall, what is set in it, in order along it. */
  cuts: Map<string, Cut[]>
  /** For each door or window, the wall it sits in (the first in the drawing's order, where two overlap), or null. */
  hosts: Map<string, Wall | null>
}

/** Walls are filed by the squares of this many millimetres that their outline covers. */
const OPENING_GRID = 1000
/** A wall covering more squares than this is looked at for every opening instead. */
const OPENING_GRID_CELLS = 4096
const openingIndexes = new WeakMap<Registry, WeakMap<Document['nodes'], { version: number; layers: Document['layers']; byRoot: Map<string, OpeningIndex> }>>()

export function openingIndex(doc: Document, parentId: string | null, registry: Registry): OpeningIndex {
  let byNodes = openingIndexes.get(registry)
  if (!byNodes) openingIndexes.set(registry, (byNodes = new WeakMap()))
  let entry = byNodes.get(doc.nodes)
  // What an opening cuts depends on the extensions in use, and whether it is shown, on the layers.
  if (!entry || entry.version !== registry.version || entry.layers !== doc.layers) byNodes.set(doc.nodes, (entry = { version: registry.version, layers: doc.layers, byRoot: new Map() }))
  const root = rootOf(doc, parentId)
  const key = root?.id ?? ''
  const known = entry.byRoot.get(key)
  if (known) return known

  const { walls, rank } = wallIndex(doc, parentId)
  const grid = new Map<string, Wall[]>()
  // Curved walls, and walls too large for the grid, are tried for every opening.
  const always: Wall[] = []
  const square = (v: number) => Math.floor(v / OPENING_GRID)
  for (const wall of walls) {
    // Its line is somewhere between its faces: a thickness all round covers it whichever face it is.
    const pad = wall.thickness + 1
    const [x0, x1, y0, y1] = [square(Math.min(wall.a.x, wall.b.x) - pad), square(Math.max(wall.a.x, wall.b.x) + pad), square(Math.min(wall.a.y, wall.b.y) - pad), square(Math.max(wall.a.y, wall.b.y) + pad)]
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (wallArc(wall) || !(cells <= OPENING_GRID_CELLS)) {
      always.push(wall)
      continue
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(cellKey(x, y))
        if (list) list.push(wall)
        else grid.set(cellKey(x, y), [wall])
      }
    }
  }

  const index: OpeningIndex = { cuts: new Map(), hosts: new Map() }
  for (const node of root ? leavesOf(doc, root.id) : []) {
    const span = node.type === 'parametric' ? openingSpan(node, registry) : null
    if (!span || node.type !== 'parametric') continue
    // A straight wall that a span lies in shares a stretch of it, which is in some square the span covers.
    const candidates = new Set(always)
    for (let x = square(Math.min(span[0].x, span[1].x)); x <= square(Math.max(span[0].x, span[1].x)); x++) {
      for (let y = square(Math.min(span[0].y, span[1].y)); y <= square(Math.max(span[0].y, span[1].y)); y++) for (const wall of grid.get(cellKey(x, y)) ?? []) candidates.add(wall)
    }
    let host: Wall | null = null
    const cut = (wall: Wall, taken: [number, number]) => {
      const list = index.cuts.get(wall.id)
      const one = { node, from: taken[0], to: taken[1], visible: isVisible(doc, node) }
      if (list) list.push(one)
      else index.cuts.set(wall.id, [one])
    }
    const cutting = new Set<string>()
    for (const wall of [...candidates].sort((u, v) => rank.get(u.id)! - rank.get(v.id)!)) {
      const taken = overlap(wall, span)
      if (!taken) continue
      host ??= wall
      cutting.add(wall.id)
      cut(wall, taken)
    }
    // And through the walls laid against it, face to face, one after the other.
    if (host && !wallArc(host)) {
      const near = new Set(always)
      const reach = STACK_REACH
      for (let x = square(Math.min(span[0].x, span[1].x) - reach); x <= square(Math.max(span[0].x, span[1].x) + reach); x++) {
        for (let y = square(Math.min(span[0].y, span[1].y) - reach); y <= square(Math.max(span[0].y, span[1].y) + reach); y++) for (const wall of grid.get(cellKey(x, y)) ?? []) near.add(wall)
      }
      const stack = [host]
      for (let i = 0; i < stack.length && stack.length <= MAX_STACK; i++) {
        for (const wall of near) {
          if (cutting.has(wall.id) || !laidAgainst(stack[i], wall)) continue
          const taken = along(wall, span)
          if (!taken) continue
          cutting.add(wall.id)
          stack.push(wall)
          cut(wall, taken)
        }
      }
    }
    index.hosts.set(node.id, host)
  }
  for (const list of index.cuts.values()) list.sort((p, q) => p.from - q.from)
  entry.byRoot.set(key, index)
  return index
}

/** How far, in mm, from the stretch an opening cuts, the walls laid against its wall are looked for. */
const STACK_REACH = 1000
/** How many walls an opening goes through, at most, its own and those laid against it. */
const MAX_STACK = 16
/** The stretch of a straight wall (distances from `a`) that a span takes, wherever across it the span lies. */
function along(wall: Wall, span: [Vec2, Vec2]): [number, number] | null {
  const course = courseOf(wall)
  const ts = span.map((p) => course.project(p).along)
  const from = Math.max(0, Math.min(...ts))
  const to = Math.min(course.length, Math.max(...ts))
  return to - from > 1e-6 ? [from, to] : null
}

/** The stretch a parametric node cuts out of a wall, as two world points, or null if it cuts nothing. */
export function openingSpan(node: Node, registry: Registry): [Vec2, Vec2] | null {
  if (node.type !== 'parametric') return null
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  return [applyTransform({ x: opening.from, y: 0 }, node), applyTransform({ x: opening.to, y: 0 }, node)]
}

/** The part of a wall's centerline (distances from `a`) covered by a span lying inside the wall. */
export function overlap(wall: Wall, span: [Vec2, Vec2]): [number, number] | null {
  if (dist(wall.a, wall.b) < 1e-6) return null
  const course = courseOf(wall)
  const length = course.length
  const ts: number[] = []
  const { left, right } = wallSides(wall)
  for (const p of span) {
    const { along, across } = course.project(p)
    if (across < -left - 1e-6 || across > right + 1e-6) return null
    ts.push(along)
  }
  const from = Math.max(0, Math.min(...ts))
  const to = Math.min(length, Math.max(...ts))
  return to - from > 1e-6 ? [from, to] : null
}

/** The doors and windows set in a wall, each with the stretch of the wall's middle line it takes (distances from `a`), in order along it. */
export function wallOpenings(doc: Document, wall: Wall, registry: Registry): { node: Extract<Node, { type: 'parametric' }>; from: number; to: number }[] {
  if (current(doc, wall)) return (openingIndex(doc, wall.parent, registry).cuts.get(wall.id) ?? []).map(({ node, from, to }) => ({ node, from, to }))
  return drawnWith(doc, wall.parent)
    .flatMap((node) => {
      const span = openingSpan(node, registry)
      const taken = span && overlap(wall, span)
      return taken && node.type === 'parametric' ? [{ node, from: taken[0], to: taken[1] }] : []
    })
    .sort((p, q) => p.from - q.from)
}

/** The wall an opening sits in, if any. */
export function hostWall(doc: Document, node: Node, registry: Registry): Wall | null {
  if (current(doc, node)) return openingIndex(doc, node.parent, registry).hosts.get(node.id) ?? null
  const span = openingSpan(node, registry)
  if (!span) return null
  return wallsIn(doc, node.parent).find((wall) => overlap(wall, span)) ?? null
}

/**
 * Where to put an opening so that it sits on the wall nearest to `p`: centred under the cursor,
 * turned to follow the wall and opening towards the cursor's side. Returns null when no wall is
 * within `reach` of `p`. `step` is the grid the opening's edges are rounded to along the wall.
 * Pass `keepRotation` when moving an existing opening, so it stays on the side it already faces.
 */
/**
 * Where an opening of half-width `half`, centred `t` along `wall`, goes so that it covers no end of
 * a wall meeting `wall` along its length (a partition at a T): a door there would open onto that
 * wall, drawn standing in its doorway. It slides to the nearer side that clears it (the side of the
 * pointer, `pointer`, when both are as near), staying on the wall; where no place clears every such
 * wall, as on a wall too short, it stays at `t`. The corners at the wall's own ends are left as they
 * were, and so is every opening already placed: this is where an opening is put, not a rule of the
 * drawing.
 */
function clearOfMeetingWalls(doc: Document, containerId: string, wall: Wall, t: number, half: number, pointer: number): number {
  const course = courseOf(wall)
  const length = course.length
  const blocked: [number, number][] = []
  for (const other of wallsIn(doc, containerId)) {
    if (other.id === wall.id) continue
    for (const end of [other.a, other.b]) {
      if (distToBody(end, wall) > 1) continue
      const along = course.project(end).along
      if (along <= 1 || along >= length - 1) continue
      // As wide as the meeting wall is along this one: wider when it meets it at a slant.
      const own = sub(other.b, other.a)
      const ownLength = Math.hypot(own.x, own.y) || 1
      const d = course.dir(along)
      const sine = Math.abs(d.x * own.y - d.y * own.x) / ownLength
      const width = Math.min(other.thickness / Math.max(sine, 1 / 3), 3 * other.thickness)
      blocked.push([along - width / 2, along + width / 2])
    }
  }
  const clear = (c: number) => (length < 2 * half || (c >= half - 1e-6 && c <= length - half + 1e-6)) && blocked.every(([from, to]) => c + half <= from + 1e-6 || c - half >= to - 1e-6)
  if (clear(t)) return t
  const candidates = blocked.flatMap(([from, to]) => [from - half, to + half]).filter(clear)
  if (candidates.length === 0) return t
  return candidates.reduce((best, c) => {
    const [db, dc] = [Math.abs(best - t), Math.abs(c - t)]
    return dc < db - 1e-6 || (Math.abs(dc - db) <= 1e-6 && Math.abs(c - pointer) < Math.abs(best - pointer)) ? c : best
  })
}

export function snapOpeningToWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: { kind: string; props: Record<string, unknown>; flipX?: boolean },
  p: Vec2,
  reach: number,
  step: number,
  keepRotation?: number,
): { x: number; y: number; rotation: number } | null {
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  let wall: Wall | null = null
  let nearest = Infinity
  for (const w of wallsIn(doc, containerId)) {
    const distance = distToBody(p, w)
    if (distance <= reach && distance < nearest) {
      wall = w
      nearest = distance
    }
  }
  if (!wall) return null
  const course = courseOf(wall)
  const length = course.length
  const half = Math.abs(opening.to - opening.from) / 2
  let t = Math.round((course.project(p).along - half) / step) * step + half
  if (length >= 2 * half) t = Math.max(half, Math.min(length - half, t))
  t = clearOfMeetingWalls(doc, containerId, wall, t, half, course.project(p).along)
  const d = course.dir(t)
  // In the middle of the thickness, whichever line of the wall it is drawn by. A door is straight:
  // in a curved wall it is a chord of the curve, its two ends on the middle of the thickness.
  const arc = wallArc(wall)
  const on = course.offset(t, middleAcross(wall))
  const radius = arc ? dist(on, arc.centre) : 0
  const center = arc && half < radius ? add(arc.centre, scale(sub(on, arc.centre), Math.sqrt(radius ** 2 - half ** 2) / radius)) : on
  const along = (Math.atan2(d.y, d.x) * 180) / Math.PI
  const facing =
    keepRotation === undefined
      ? dot(sub(p, center), perp(d)) >= 0
      : Math.cos(((keepRotation - along) * Math.PI) / 180) >= 0
  const rotation = (((along + (facing ? 0 : 180)) % 360) + 360) % 360
  const offset = applyTransform({ x: (opening.from + opening.to) / 2, y: 0 }, { x: 0, y: 0, rotation, flipX: node.flipX })
  return { x: tidy(center.x - offset.x), y: tidy(center.y - offset.y), rotation: tidy(rotation) }
}
