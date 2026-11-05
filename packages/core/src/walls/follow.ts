import { applyTransform, dist, type Vec2 } from '../geometry'
import type { Op } from '../ops'
import type { Registry } from '../registry'
import type { Document, NodeOf } from '../schema'
import { courseOf, middleAcross, tidy, type Wall } from './course'
import { hostWall, wallOpenings } from './openings'

/*
 * Doors and windows follow the wall they are in. Nothing ties one to its wall but where it is
 * (openings.ts), so an edit that changes a wall and not its openings would leave them where they
 * were: out of a wall made shorter, beside a wall turned. `openingFollowOps` puts them back in it,
 * after any edit, whatever made it (a corner dragged, a length or an angle typed, the trim tool,
 * the assistant), so that no edit of a wall has to know of them.
 */

/** Ends closer than this, in mm, have not moved. */
const STILL = 1e-6

const angleOf = (d: Vec2) => (Math.atan2(d.y, d.x) * 180) / Math.PI
const same = (p: Vec2, q: Vec2) => dist(p, q) < STILL

/**
 * The operations that put back in their wall the doors and windows an edit left behind: those that
 * sat in a straight wall `changed` before the edit (`before`), where the edit (`after`) changed the
 * wall and not them. Each keeps its distance from the end of the wall that stayed where it was; one
 * in a wall that moved or turned whole moves or turns with it; one in a wall both of whose ends
 * moved keeps its place as a share of the wall's length. It keeps its place across the thickness
 * and its side, and stays within the wall when the wall is long enough to hold it. An opening the
 * edit moved itself (`wallFollowOps`, a change of thickness), one in a curved wall, one whose wall
 * was taken away, and one that is in another wall after the edit (the other half of a wall split in
 * two) are left as the edit left them.
 */
export function openingFollowOps(before: Document, after: Document, changed: Iterable<string>, registry: Registry): Op[] {
  const ops: Op[] = []
  const placed = new Set<string>()
  for (const id of changed) {
    const old = before.nodes[id]
    const now = after.nodes[id]
    if (old?.type !== 'wall' || now?.type !== 'wall' || old === now || old.bulge || now.bulge) continue
    if (sameMiddle(old, now)) continue
    for (const { node } of wallOpenings(before, old, registry)) {
      if (placed.has(node.id) || after.nodes[node.id] !== node || hostWall(before, node, registry)?.id !== old.id) continue
      // In another wall now, as the other half of a wall split in two: where it is, it is right.
      const host = hostWall(after, node, registry)
      if (host && host.id !== now.id) continue
      const patch = putBack(node, old, now, registry)
      if (patch) ops.push({ op: 'update_node', id: node.id, patch })
      placed.add(node.id)
    }
  }
  return ops
}

/** Whether the middle of a wall's thickness runs where it ran, either way round: what is in it stays where it is. */
function sameMiddle(old: Wall, now: Wall): boolean {
  const ends = (wall: Wall) => {
    const course = courseOf(wall)
    return [course.offset(0, middleAcross(wall)), course.offset(course.length, middleAcross(wall))]
  }
  const [p, q] = ends(old)
  const [r, s] = ends(now)
  return (same(p, r) && same(q, s)) || (same(p, s) && same(q, r))
}

/** Where an opening of `old` goes in `now`, as a patch, or null when it need not move. */
function putBack(node: NodeOf<'parametric'>, old: Wall, now: Wall, registry: Registry): Record<string, number> | null {
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  const [was, is] = [courseOf(old), courseOf(now)]
  // The middle of the stretch it cuts, along the wall and across it from the middle of the thickness.
  const middle = applyTransform({ x: (opening.from + opening.to) / 2, y: 0 }, node)
  const { along, across } = was.project(middle)
  const off = across - middleAcross(old)
  let s: number
  if (same(old.a, now.a)) s = along
  else if (same(old.b, now.b)) s = is.length - (was.length - along)
  else if (Math.abs(is.length - was.length) < STILL) s = along
  else s = was.length > 0 ? (along * is.length) / was.length : 0
  const half = Math.abs(opening.to - opening.from) / 2
  if (is.length >= 2 * half) s = Math.max(half, Math.min(is.length - half, s))
  const rotation = ((((node.rotation ?? 0) + angleOf(is.dir(0)) - angleOf(was.dir(0))) % 360) + 360) % 360
  const centre = is.offset(s, middleAcross(now) + off)
  const offset = applyTransform({ x: (opening.from + opening.to) / 2, y: 0 }, { ...node, x: 0, y: 0, rotation })
  const patch = { x: tidy(centre.x - offset.x), y: tidy(centre.y - offset.y), rotation: tidy(rotation) }
  return Math.abs(patch.x - node.x) < STILL && Math.abs(patch.y - node.y) < STILL && Math.abs(patch.rotation - (node.rotation ?? 0)) < STILL ? null : patch
}
