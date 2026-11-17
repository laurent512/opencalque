import { leavesOf, rootOf } from '../document'
import { applyTransform, inverseTransform, perp, sub, type Vec2 } from '../geometry'
import { alignMove, type AlignCandidate, type Alignable } from '../snap'
import type { Mount, Registry } from '../registry'
import type { Document, Node, NodeOf } from '../schema'
import { courseOf, cross, distToBody, middleAcross, tidy, wallSides, type Wall } from './course'
import { wallOutline } from './outline'
import { wallIndex, wallsIn, wallsOver } from './spatial'

/*
 * Objects fixed on the face of a wall: sockets, switches, wall lights (ARCHITECTURE §4, "Fixed on
 * walls"). As with doors, nothing ties one to its wall but where it is. An object whose kind says
 * it mounts on walls (`mount`) is on a wall when its back lies along one of the wall's faces, and it
 * stands out of the wall: found again each time, never stored.
 */

/** How far, in mm, the back of an object may be off a face, along it or across it, and still be on it. */
const ON_FACE = 1
/** How far its back may turn from the face and still lie along it: the sine of the angle. */
const ALONG_FACE = 1e-3

/** Where an object fixed on a wall is: the wall, which face, and how far along the wall's line from `a`. */
export interface Mounting {
  wall: Wall
  face: 'left' | 'right'
  along: number
}

/** The way the kind of `node` goes against walls, fixed on them or standing against them, if it does. */
export function mountOf(node: Node, registry: Registry): Mount | null {
  if (node.type !== 'parametric') return null
  const mount = registry.parametric.get(node.kind)?.mount
  return mount?.on === 'wall' || mount?.on === 'floor' ? mount : null
}

/** Whether `node` is fixed on a wall at a height (a socket), rather than standing against it. */
export const fixedOnWall = (node: Node, registry: Registry): boolean => mountOf(node, registry)?.on === 'wall'

/** How high above the floor an object is, in mm: its own `z`, else its kind's usual height when it is fixed on walls, else null. */
export function heightAboveFloor(node: Node, registry: Registry): number | null {
  if (node.type !== 'parametric') return null
  const mount = mountOf(node, registry)
  return node.z ?? (mount?.on === 'wall' ? (mount.height ?? null) : null)
}

/** The middle of its back, the way its own X runs and the way it stands out, in the drawing. */
function backOf(node: { x: number; y: number; rotation?: number; flipX?: boolean }, mount: Mount): { at: Vec2; along: Vec2; out: Vec2 } {
  const back = mount.back ?? 0
  const at = applyTransform({ x: 0, y: back }, node)
  return {
    at,
    along: sub(applyTransform({ x: 1, y: back }, node), at),
    out: sub(applyTransform({ x: 0, y: back + (mount.out === 'up' ? -1 : 1) }, node), at),
  }
}

/** The across of a face of a wall, from its line: positive to the right. */
export const faceAcross = (wall: Wall, face: Mounting['face']) => (face === 'right' ? wallSides(wall).right : -wallSides(wall).left)

/**
 * Where a face of a straight wall is as it is drawn, as distances along the wall's line from `a`:
 * not the wall's line from end to end, but from corner to corner of its outline, mitred into the
 * walls it meets. An inside face stops where the wall it meets begins, an outside face runs on to
 * the outer corner. The wall's line from end to end when its outline says nothing of that face.
 */
export function faceStretch(doc: Document, wall: Wall, face: Mounting['face']): [number, number] {
  const course = courseOf(wall)
  const across = faceAcross(wall, face)
  const on = wallOutline(wall, doc)
    .map((p) => course.project(p))
    .filter((p) => Math.abs(p.across - across) <= 0.5)
    .map((p) => p.along)
  return on.length >= 2 ? [Math.min(...on), Math.max(...on)] : [0, course.length]
}

/** Whether `node`, fixed on walls, is laid on a face of `wall`, and which. */
function onFace(wall: Wall, back: { at: Vec2; along: Vec2; out: Vec2 }): Mounting | null {
  const course = courseOf(wall)
  const { along, across } = course.project(back.at)
  if (along < -ON_FACE || along > course.length + ON_FACE) return null
  const d = course.dir(Math.max(0, Math.min(course.length, along)))
  if (Math.abs(cross(d, back.along)) > ALONG_FACE) return null
  // It stands out of the wall: to the right of its line on its right face, to the left on its left.
  const face = cross(d, back.out) > 0 ? 'right' : 'left'
  return Math.abs(across - faceAcross(wall, face)) <= ON_FACE ? { wall, face, along } : null
}

/** The wall face an object fixed on walls is laid on, if any: the first wall in the drawing's order. */
export function mountedOn(doc: Document, node: Node, registry: Registry): Mounting | null {
  const mount = mountOf(node, registry)
  if (!mount || node.type !== 'parametric') return null
  const back = backOf(node, mount)
  for (const wall of wallsOver(wallIndex(doc, node.parent), back.at, ON_FACE)) {
    const found = onFace(wall, back)
    if (found) return found
  }
  return null
}

const mountIndexes = new WeakMap<Registry, WeakMap<Document['nodes'], { version: number; byRoot: Map<string, Map<string, NodeOf<'parametric'>[]>> }>>()

/** What is fixed on each wall of the page or component of `parentId`, by wall id. Made once for each state of the drawing. */
function mountIndex(doc: Document, parentId: string | null, registry: Registry): Map<string, NodeOf<'parametric'>[]> {
  let byNodes = mountIndexes.get(registry)
  if (!byNodes) mountIndexes.set(registry, (byNodes = new WeakMap()))
  let entry = byNodes.get(doc.nodes)
  if (!entry || entry.version !== registry.version) byNodes.set(doc.nodes, (entry = { version: registry.version, byRoot: new Map() }))
  const root = rootOf(doc, parentId)
  const key = root?.id ?? ''
  const known = entry.byRoot.get(key)
  if (known) return known
  const index = new Map<string, NodeOf<'parametric'>[]>()
  for (const node of root ? leavesOf(doc, root.id) : []) {
    if (node.type !== 'parametric' || !mountOf(node, registry)) continue
    const on = mountedOn(doc, node, registry)
    if (!on) continue
    const list = index.get(on.wall.id)
    if (list) list.push(node)
    else index.set(on.wall.id, [node])
  }
  entry.byRoot.set(key, index)
  return index
}

/** The objects fixed on a face of `wall`. */
export function wallMounted(doc: Document, wall: Wall, registry: Registry): NodeOf<'parametric'>[] {
  return mountIndex(doc, wall.parent, registry).get(wall.id) ?? []
}

/** Where an object fixed on walls goes so that its back lies on `face` of `wall`, `along` mm from its `a`. */
export function mountAt(node: { kind: string; props: Record<string, unknown>; flipX?: boolean }, mount: Mount, wall: Wall, face: Mounting['face'], along: number): { x: number; y: number; rotation: number } {
  const course = courseOf(wall)
  const d = course.dir(along)
  const on = course.offset(along, faceAcross(wall, face))
  // Out of the wall: the right of its line is the way `perp` turns its direction.
  const outward = face === 'right' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
  // Its own +Y, or -Y when it stands out upwards, turned to point out of the wall.
  const own = mount.out === 'up' ? { x: -outward.x, y: -outward.y } : outward
  const rotation = ((((Math.atan2(-own.x, own.y) * 180) / Math.PI) % 360) + 360) % 360
  const back = applyTransform({ x: 0, y: mount.back ?? 0 }, { x: 0, y: 0, rotation, flipX: node.flipX })
  return { x: tidy(on.x - back.x), y: tidy(on.y - back.y), rotation: tidy(rotation) }
}

/**
 * Where to put an object fixed on walls so that it lies on the wall nearest to `p`: on the face on
 * the pointer's side, at the pointer along it (rounded to `step`, within the wall), turned to
 * stand out of the wall. Returns null when no wall is within `reach` of `p`, or the kind is not
 * one fixed on walls.
 *
 * Given `extent`, the half sizes of an upright box around `p`, the reach is from that box rather
 * than from `p`: what is moved goes against a wall when its side nears it, whichever way it faces.
 * Two walls as near (in a corner), it keeps to the one it stands against as it is turned.
 */
export function snapMountToWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: { kind: string; props: Record<string, unknown>; flipX?: boolean; rotation?: number },
  p: Vec2,
  reach: number,
  step: number,
  extent?: Vec2,
): { x: number; y: number; rotation: number } | null {
  const kind = registry.parametric.get(node.kind)
  const mount = kind?.mount
  if (mount?.on !== 'wall' && mount?.on !== 'floor') return null
  let wall: Wall | null = null
  let nearest = Infinity
  for (const w of wallsIn(doc, containerId)) {
    let distance = distToBody(p, w)
    if (extent && distance < Infinity) {
      const course = courseOf(w)
      const { along, across } = course.project(p)
      const dir = course.dir(Math.max(0, Math.min(course.length, along)))
      // How far the box reaches across the wall from its middle.
      distance = Math.max(0, distance - (Math.abs(dir.y) * extent.x + Math.abs(dir.x) * extent.y))
      // Turning to stand against this wall costs a millimetre: against two, it keeps to the one it faces from.
      const turn = mountAt(node, mount, w, across >= middleAcross(w) ? 'right' : 'left', 0).rotation
      if (Math.abs((((turn - (node.rotation ?? 0)) % 360) + 360) % 360) > 1e-6) distance += 1
    }
    if (distance <= reach && distance < nearest) {
      wall = w
      nearest = distance
    }
  }
  if (!wall) return null
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  const face = across >= middleAcross(wall) ? 'right' : 'left'
  // Its middle under the pointer, by the grid: what is as wide as a kitchen unit is put by its middle.
  const box = kind!.box?.bounds(registry.resolveProps(kind!, node.props))
  const middle = box ? (box.left + box.right) / 2 : 0
  const half = box ? Math.abs(box.right - box.left) / 2 : 0
  const first = mountAt(node, mount, wall, face, 0)
  // Which way its own X runs along the wall, once turned to stand out of it.
  const ownX = sub(applyTransform({ x: 1, y: 0 }, { ...first, flipX: node.flipX }), applyTransform({ x: 0, y: 0 }, { ...first, flipX: node.flipX }))
  const way = cross(perp(course.dir(0)), ownX) < 0 ? 1 : -1
  // On the face as it is drawn, not inside a wall it meets at a corner, and all of it on the face
  // when the face is long enough: pushed towards a corner, it stops in it.
  const [from, to] = wall.bulge ? [0, course.length] : faceStretch(doc, wall, face)
  const centre = Math.max(from + half, Math.min(to - half, step > 0 ? Math.round(along / step) * step : along))
  const s = to - from >= 2 * half ? centre : (from + to) / 2
  return mountAt(node, mount, wall, face, s - way * middle)
}

/**
 * A wall standing across the one what is moved stands against, which its box `placed` has been
 * pushed into along `axis`: it stays against it, on the side of the wall its middle is on, as a
 * wardrobe stops against the wall at the end of a room. The deepest such wall wins; null when none.
 */
function wallStop(doc: Document, placed: Alignable, row: Alignable[], axis: 'x' | 'y', way: Vec2): AlignCandidate | null {
  const across = axis === 'x' ? 'y' : 'x'
  const [lo, hi] = axis === 'x' ? [placed.bounds.minX, placed.bounds.maxX] : [placed.bounds.minY, placed.bounds.maxY]
  const [from, to] = across === 'x' ? [placed.bounds.minX, placed.bounds.maxX] : [placed.bounds.minY, placed.bounds.maxY]
  const [low, high] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
  let stop: AlignCandidate | null = null
  row.forEach((other, i) => {
    const wall = other.id ? doc.nodes[other.id] : undefined
    if (wall?.type !== 'wall') return
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)
    // Only a wall running across: one along it, carrying on its line, is no stop.
    if (length < 1e-6 || Math.abs(((wall.b.x - wall.a.x) * way.x + (wall.b.y - wall.a.y) * way.y) / length) > NEARLY_LEVEL) return
    const [olo, ohi] = axis === 'x' ? [other.bounds.minX, other.bounds.maxX] : [other.bounds.minY, other.bounds.maxY]
    const [ofrom, oto] = across === 'x' ? [other.bounds.minX, other.bounds.maxX] : [other.bounds.minY, other.bounds.maxY]
    if (!(lo < ohi && hi > olo && from < oto && to > ofrom)) return
    const before = (lo + hi) / 2 < (olo + ohi) / 2
    const change = before ? olo - hi : ohi - lo
    if (!stop || Math.abs(change) > Math.abs(stop.change)) stop = { rule: 'touch', axis, change, own: before ? high : low, target: before ? low : high, other: i }
  })
  return stop
}

/** How far from level (or upright) a wall may be, as the sine of the angle (2°), for what stands against it to be set against what is beside it. */
const NEARLY_LEVEL = Math.sin((2 * Math.PI) / 180)

/** Where `moveAgainstWall` puts what is moved, and what it went against along the wall. */
export interface AgainstWall {
  patch: { x: number; y: number; rotation: number }
  /** What it went against along the wall, an index into `row`; null when nothing was near enough. */
  why: AlignCandidate | null
  /** What it could go against along the wall: what stands against walls as it does, and the walls. */
  row: Alignable[]
}

/**
 * Where an object that goes against walls goes when it is moved by `d`, `moving` being its box as
 * it was taken and `others` what is around it (`alignables`). It goes against the wall its box
 * comes within `reach` of, whichever way it faced: on the face on the side of the box's middle, its
 * back on that face, turned to stand out of it, its middle where the box's middle has been moved
 * to along the wall. So it does not matter where it was taken, nor which way it was turned. Then,
 * along a wall upright or level, it goes against what is beside it within `touch`: what stands
 * against walls as it does (a unit against the next unit, a socket against the next socket) and
 * the walls standing across (a pillar, the wall of a corner). Nothing else pulls it, so between
 * those it follows the pointer. Null when no wall is near, or the kind goes against none.
 */
export function moveAgainstWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: NodeOf<'parametric'>,
  moving: Alignable,
  others: Alignable[],
  d: Vec2,
  reach: number,
  touch: number,
  step: number,
): AgainstWall | null {
  const mount = mountOf(node, registry)
  if (!mount) return null
  const b = moving.bounds
  const half = { x: (b.maxX - b.minX) / 2, y: (b.maxY - b.minY) / 2 }
  const middle = { x: (b.minX + b.maxX) / 2 + d.x, y: (b.minY + b.maxY) / 2 + d.y }
  let patch = snapMountToWall(doc, containerId, registry, node, middle, reach, step, half)
  if (!patch) return null
  // Along the wall, its own X: lined up along X or Y when the wall is within a few degrees of level
  // or upright, as walls traced from a scan are (one 0.00003° off level once stopped it all).
  const r = (patch.rotation * Math.PI) / 180
  const way = { x: Math.cos(r), y: Math.sin(r) }
  const axis = Math.abs(way.y) <= NEARLY_LEVEL ? 'x' : Math.abs(way.x) <= NEARLY_LEVEL ? 'y' : null
  if (!axis) return { patch, why: null, row: [] }
  // Its box where it now stands: the middle of its box carried along with it, as wide as it was deep when turned a quarter.
  const own = inverseTransform({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, { x: node.x, y: node.y, rotation: node.rotation ?? 0, flipX: node.flipX })
  const there = applyTransform(own, { ...patch, flipX: node.flipX })
  const quarter = Math.abs(((((patch.rotation - (node.rotation ?? 0)) % 180) + 180) % 180) - 90) < 45
  const [hx, hy] = quarter ? [half.y, half.x] : [half.x, half.y]
  // A hair smaller across the wall, so that the wall it stands against, which it only touches, is not in its row.
  const [ix, iy] = axis === 'x' ? [0, 0.5] : [0.5, 0]
  const placed: Alignable = { bounds: { minX: there.x - hx + ix, maxX: there.x + hx - ix, minY: there.y - hy + iy, maxY: there.y + hy - iy }, points: [] }
  const row = others.filter((other) => {
    const at = other.id ? doc.nodes[other.id] : undefined
    return at?.type === 'wall' || (at?.type === 'parametric' && at.id !== node.id && mountOf(at, registry)?.on === mount.on)
  })
  const why = wallStop(doc, placed, row, axis, way) ?? alignMove(placed, row, { x: 0, y: 0 }, 0, touch).why[axis]
  // Slid along the wall by as much as it takes along the axis, so that it stays on a face a little off level.
  if (why && why.rule === 'touch') patch = { ...patch, x: tidy(patch.x + (why.change / way[axis]) * way.x), y: tidy(patch.y + (why.change / way[axis]) * way.y) }
  return { patch, why: why?.rule === 'touch' ? why : null, row }
}
