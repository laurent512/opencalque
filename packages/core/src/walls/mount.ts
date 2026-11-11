import { leavesOf, rootOf } from '../document'
import { applyTransform, perp, sub, type Vec2 } from '../geometry'
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
 */
export function snapMountToWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: { kind: string; props: Record<string, unknown>; flipX?: boolean },
  p: Vec2,
  reach: number,
  step: number,
): { x: number; y: number; rotation: number } | null {
  const kind = registry.parametric.get(node.kind)
  const mount = kind?.mount
  if (mount?.on !== 'wall' && mount?.on !== 'floor') return null
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
