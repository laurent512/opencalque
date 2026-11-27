/**
 * The dimensions of a plan round its building, worked out from its walls, for the editor to put
 * down as ordinary dimensions (Object › Dimension the plan): on each side, the building from end
 * to end, its outer walls piece by piece with the sides of their doors and windows, or both. Their
 * ends lie on the corners of the walls and the sides of the openings, so that they follow them as
 * those move (`dimensionFollowOps`).
 */

import { outerFaces, shownOnPlan } from './elevation'
import { boundsOfPoints, perp, unionBounds, type Bounds, type Vec2 } from './geometry'
import type { Registry } from './registry'
import type { Document } from './schema'
import { courseOf } from './walls/course'
import { faceAcross } from './walls/mount'
import { wallOpenings } from './walls/openings'
import { wallOutline } from './walls/outline'
import { wallsIn } from './walls/spatial'

export type PlanSide = 'top' | 'right' | 'bottom' | 'left'
/** What a side shows: the building from end to end, its outer walls piece by piece, both, or nothing. */
export type SideRows = 'overall' | 'detailed' | 'both' | 'none'

export const PLAN_SIDES: PlanSide[] = ['top', 'right', 'bottom', 'left']
/** What each side shows unless said otherwise: as plans are often dimensioned, the whole above and on the left, the pieces below and on the right. */
export const PLAN_SIDES_DEFAULT: Record<PlanSide, SideRows> = { top: 'overall', right: 'detailed', bottom: 'detailed', left: 'overall' }

/** How far out from the building its first row of dimensions is, in mm. */
const FIRST_ROW = 800
/** How far apart two rows of one side are, in mm. */
const NEXT_ROW = 600
/** Stops closer than this along a side, in mm, are one. */
const SAME = 1

const OUTWARD: Record<PlanSide, Vec2> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

/** One dimension to put down: from `a` to `b`, its line `offset` across from them (as a dimension's `offset`). */
export interface PlanDimension {
  a: Vec2
  b: Vec2
  offset: number
}

/**
 * The dimensions of the plan of `parent` (a page or a group): for each side, as `sides` says, the
 * overall length of the box round the walls' outlines, and the detailed chain along it: where the
 * outer faces on that side (`outerFaces`) start and end, and the sides of the doors and windows in
 * their walls, on their outer face. The detailed row is nearer the building, the overall one beyond
 * it. Measured on the edge of the box, which is the outer face of a wall that runs along it: a stop
 * on a face set back from it (a recess) is measured where it comes on that edge. None while no wall
 * is drawn.
 */
export function planDimensions(doc: Document, parent: string, registry: Registry, sides: Partial<Record<PlanSide, SideRows>> = {}): PlanDimension[] {
  const walls = wallsIn(doc, parent).filter((wall) => shownOnPlan(doc, wall))
  let box: Bounds | null = null
  for (const wall of walls) box = unionBounds(box, boundsOfPoints(wallOutline(wall, doc)))
  if (!box) return []
  const outer = outerFaces(doc, parent)
  const out: PlanDimension[] = []
  for (const side of PLAN_SIDES) {
    const rows = sides[side] ?? PLAN_SIDES_DEFAULT[side]
    if (rows === 'none') continue
    const across = side === 'top' || side === 'bottom'
    const along = (p: Vec2) => (across ? p.x : p.y)
    const [from, to] = across ? [box.minX, box.maxX] : [box.minY, box.maxY]
    const edge = side === 'top' ? box.minY : side === 'bottom' ? box.maxY : side === 'left' ? box.minX : box.maxX
    const at = (s: number): Vec2 => (across ? { x: s, y: edge } : { x: edge, y: s })
    // Its line `distance` out from the box: the offset's sign is the side of a to b its line goes to.
    const n = perp(across ? { x: 1, y: 0 } : { x: 0, y: 1 })
    const sign = n.x * OUTWARD[side].x + n.y * OUTWARD[side].y > 0 ? 1 : -1
    const chain = (stops: number[], distance: number) => {
      for (let i = 1; i < stops.length; i++) out.push({ a: at(stops[i - 1]), b: at(stops[i]), offset: sign * distance })
    }
    let distance = FIRST_ROW
    if (rows === 'detailed' || rows === 'both') {
      const stops = [from, to]
      for (const face of outer.filter((f) => f.side === side)) {
        stops.push(along(face.a), along(face.b))
        const course = courseOf(face.wall)
        const onFace = faceAcross(face.wall, face.face)
        for (const opening of wallOpenings(doc, face.wall, registry)) stops.push(along(course.offset(opening.from, onFace)), along(course.offset(opening.to, onFace)))
      }
      const kept = [...new Set(stops.filter((s) => s >= from - SAME && s <= to + SAME).map((s) => Math.round(s * 1000) / 1000))].sort((p, q) => p - q)
      chain(
        kept.filter((s, i) => i === 0 || s - kept[i - 1] > SAME),
        distance,
      )
      distance += NEXT_ROW
    }
    if (rows === 'overall' || rows === 'both') chain([from, to], distance)
  }
  return out
}
