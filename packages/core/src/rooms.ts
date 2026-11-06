import ClipperLib from 'clipper-lib'
import { leavesOf, rootOf } from './document'
import { pointInPolygon, type Vec2 } from './geometry'
import type { Document, NodeOf } from './schema'
import { wallOutline } from './walls'

/**
 * Rooms are found, not stored. A `room` node is only a point with a name; the space it stands for
 * is whatever the walls and dividers around that point enclose, worked out again each time the
 * drawing changes. So a room follows its walls when they move, and cannot go stale.
 *
 * The space is the one seen on the drawing: what the walls, as they are drawn (their outlines,
 * mitred where they meet, doors and windows left out), leave empty around the point. So a room
 * closes exactly when its walls touch all round, and its floor runs along their faces whatever
 * their thicknesses, the faces they are drawn by, the way they meet or the order they were drawn
 * in. Walls closer than `GAP` are taken as touching: a corner drawn a hair short still closes. A
 * divider is a wall of no thickness. Rooms used to be traced along the walls' lines, then drawn in
 * by their thicknesses, with rules for what nearly met; those rules met in ways nobody foresaw.
 */
export interface Region {
  /** The floor: the faces of the walls around it. */
  outline: Vec2[]
  /** What stands inside it, cut out of it: a free-standing column, the walls of a room within it. */
  holes: Vec2[][]
  /** Floor area in square millimetres, less the holes. */
  area: number
}

/** How far it is round a floor, in mm: along the faces of its walls, doors included, not round what stands inside it. */
export const regionPerimeter = (region: Pick<Region, 'outline'>): number =>
  region.outline.reduce((total, p, i) => total + Math.hypot(region.outline[(i + 1) % region.outline.length].x - p.x, region.outline[(i + 1) % region.outline.length].y - p.y), 0)

/** Walls closer than this, in mm, are taken as touching. */
export const GAP = 50
/** Clipper works in whole numbers: hundredths of a millimetre. */
const SCALE = 100
/** Walls thinner than this, in mm, are taken as lines, as dividers are. */
const THIN = 1

type Path = ClipperLib.Path
const toPath = (points: Vec2[]): Path => points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
const fromPath = (path: Path): Vec2[] => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))

/** Outlines grown by `by` mm all round, as one group: the first (lowest) decides which way round counts as outside. */
function grown(paths: Path[], by: number, ends: ClipperLib.EndType): Path[] {
  const offset = new ClipperLib.ClipperOffset(4, 0.25)
  offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ends)
  const out: Path[] = []
  offset.Execute(out, by * SCALE)
  return out
}

/** Every space the walls and dividers of a page or component leave enclosed. */
function regionsFrom(shapes: Vec2[][], lines: Vec2[][]): Region[] {
  // Each wall grown by half the gap taken as touching, so walls that close enough now overlap, then
  // all of them as one: what they enclose are the rooms, each shrunk by that half all round. Each
  // outline is turned the same way round first, so that all of them grow.
  const half = GAP / 2
  const outlines = shapes.map(toPath).filter((path) => path.length > 2).map((path) => (ClipperLib.Clipper.Orientation(path) ? path : path.reverse()))
  const solid = [
    ...grown(outlines, half, ClipperLib.EndType.etClosedPolygon),
    ...grown(lines.map(toPath).filter((path) => path.length > 1), half, ClipperLib.EndType.etOpenSquare),
  ]
  if (solid.length === 0) return []
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(solid, ClipperLib.PolyType.ptSubject, true)
  const tree = new ClipperLib.PolyTree()
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)

  const regions: Region[] = []
  // Each hole of the walls is a room; what is inside it in turn (a column, the walls of a room in a
  // room) is an island in it, whose own holes are rooms again.
  const visit = (node: ClipperLib.PolyNode) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) {
        // The room grown back by that half: out to the faces of its walls, its islands back to theirs.
        const floor = grown([child.Contour(), ...child.Childs().map((island) => island.Contour())], half, ClipperLib.EndType.etClosedPolygon)
        const areas = floor.map((path) => ClipperLib.Clipper.Area(path))
        const outer = areas.reduce((best, area, i) => (Math.abs(area) > Math.abs(areas[best]) ? i : best), 0)
        const area = Math.abs(areas.reduce((total, a) => total + a, 0)) / (SCALE * SCALE)
        if (floor.length > 0 && area > 0) regions.push({ outline: fromPath(floor[outer]), holes: floor.filter((_, i) => i !== outer).map(fromPath), area })
      }
      visit(child)
    }
  }
  visit(tree)
  return regions
}

const cache = new WeakMap<Document['nodes'], Map<string, Region[]>>()

/** Every space enclosed by the walls and dividers drawn on the same page or component as `parentId`, whatever groups they are in. */
export function roomRegions(doc: Document, parentId: string | null): Region[] {
  const root = rootOf(doc, parentId)
  if (!root) return []
  let byRoot = cache.get(doc.nodes)
  if (!byRoot) cache.set(doc.nodes, (byRoot = new Map()))
  let regions = byRoot.get(root.id)
  if (!regions) {
    const leaves = leavesOf(doc, root.id)
    const walls = leaves.filter((n): n is NodeOf<'wall'> => n.type === 'wall')
    // A divider, or a wall too thin to have an outline, bounds rooms as a line.
    const lines = [...leaves.filter((n): n is NodeOf<'divider'> => n.type === 'divider'), ...walls.filter((w) => w.thickness < THIN)].map((n) => [n.a, n.b])
    byRoot.set(root.id, (regions = regionsFrom(walls.filter((w) => w.thickness >= THIN).map((wall) => wallOutline(wall, doc)), lines)))
  }
  return regions
}

/** The enclosed space a point is in, or null when it is in none (outside every room, or in a wall). Of spaces inside one another, the smallest. */
export function roomAt(doc: Document, parentId: string | null, p: Vec2): Region | null {
  let found: Region | null = null
  for (const region of roomRegions(doc, parentId)) {
    if (!pointInPolygon(p, region.outline) || region.holes.some((hole) => pointInPolygon(p, hole))) continue
    if (!found || region.area < found.area) found = region
  }
  return found
}
