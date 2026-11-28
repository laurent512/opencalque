import { span } from './perf'
import ClipperLib from 'clipper-lib'
import { leavesOf, rootOf } from './document'
import { distToSegment, pointInPolygon, type Vec2 } from './geometry'
import type { Op } from './ops'
import type { Document, Node, NodeOf } from './schema'
import { distToBody } from './walls/course'
import { wallOutline } from './walls/outline'
import { drawnWith, wallIndex, wallsOver } from './walls/spatial'

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

/** How near the edge of its space a room's point is on it, in mm: its name and area would be drawn across a wall or a divider. */
const EDGE = 100

const nearEdge = (p: Vec2, region: Region) => [region.outline, ...region.holes].some((ring) => ring.some((q, i) => distToSegment(p, q, ring[(i + 1) % ring.length]) < EDGE))

/** Spaces smaller than this, in square millimetres (a shaft, the gap between two walls), get no room of themselves. */
export const LEAST_ROOM = 1_000_000

const inRegion = (p: Vec2, region: Region) => pointInPolygon(p, region.outline) && !region.holes.some((hole) => pointInPolygon(p, hole))

/** Points a grid of so many per side looks among for the middle of a space. */
const SEARCH = 24

/**
 * A point well inside a space, where its name and area are written: of a grid over it, the point
 * inside farthest from its outline and its holes (the middle of a rectangle, the wider arm of an L).
 */
export function middleOf(region: Region): Vec2 {
  const edges = [region.outline, ...region.holes].flatMap((ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]] as const))
  const xs = region.outline.map((p) => p.x)
  const ys = region.outline.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const found: { p: Vec2; clear: number }[] = []
  for (let i = 0; i <= SEARCH; i++) {
    for (let j = 0; j <= SEARCH; j++) {
      const p = { x: minX + ((maxX - minX) * i) / SEARCH, y: minY + ((maxY - minY) * j) / SEARCH }
      if (inRegion(p, region)) found.push({ p, clear: Math.min(...edges.map(([a, b]) => distToSegment(p, a, b))) })
    }
  }
  if (found.length === 0) return { x: Math.round(region.outline[0].x), y: Math.round(region.outline[0].y) }
  // Of the points nearly as far from every side as the farthest, the one nearest the middle of the box:
  // in a rectangle, its middle, not the first point of the line across it that is as far from its long sides.
  const most = Math.max(...found.map((f) => f.clear))
  const middle = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const best = found.filter((f) => f.clear >= most * 0.95).reduce((a, b) => (Math.hypot(b.p.x - middle.x, b.p.y - middle.y) < Math.hypot(a.p.x - middle.x, a.p.y - middle.y) ? b : a)).p
  return { x: Math.round(best.x), y: Math.round(best.y) }
}

const roomsIn = (doc: Document, parentId: string): NodeOf<'room'>[] => {
  const root = rootOf(doc, parentId)
  return root ? leavesOf(doc, root.id).filter((n): n is NodeOf<'room'> => n.type === 'room') : []
}

/** How far apart, in mm, the points looked at along the edge of a space are, to find what bounds it. */
const SAMPLE = 250
/** At most so many points looked at along one edge of a space. */
const SAMPLES_PER_EDGE = 200

/**
 * The walls and dividers that bound a space of the plan of `parentId` (`roomRegions`), round its
 * outline and its holes (a column standing in it, the walls of a room inside it): those within
 * `GAP` of its edge, looked at every `SAMPLE` mm along it, in the order of the drawing.
 */
export function spaceBounds(doc: Document, parentId: string, region: Region): Node[] {
  return span('rooms: what bounds a space', () => {
    const index = wallIndex(doc, parentId)
    const dividers = drawnWith(doc, parentId).filter((n): n is NodeOf<'divider'> => n.type === 'divider')
    const found = new Set<Node>()
    for (const ring of [region.outline, ...region.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [a, b] = [ring[i], ring[(i + 1) % ring.length]]
        const steps = Math.min(SAMPLES_PER_EDGE, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE)))
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          for (const wall of wallsOver(index, p, GAP)) if (distToBody(p, wall) < GAP) found.add(wall)
          for (const divider of dividers) if (distToSegment(p, divider.a, divider.b) < GAP) found.add(divider)
        }
      }
    }
    return [...found]
  })
}

/** The walls and dividers round a room's space (`spaceBounds`), in the order of the drawing; none when its walls do not close. */
export function roomBounds(doc: Document, room: NodeOf<'room'>): Node[] {
  const region = room.parent ? roomAt(doc, room.parent, room) : null
  return region && room.parent ? spaceBounds(doc, room.parent, region) : []
}

/**
 * The rooms that go with nodes moved by `d` (`moved`, groups taken apart): a room not moved itself
 * whose space is bounded only by walls and dividers that are (`spaceBounds`), so that the space
 * goes whole and its name goes with it rather than being left behind in no space. A room whose
 * space is bounded by anything else as well (a wall that stays, one stretched to follow, a column
 * standing in it) stays where it is: its space changes shape rather than moving. `doc` is the
 * drawing before the move.
 */
export function roomFollowOps(doc: Document, moved: Node[], d: Vec2): Op[] {
  if (Math.hypot(d.x, d.y) < 1e-9) return []
  const going = new Set(moved.map((n) => n.id))
  const bounding = moved.filter((n): n is NodeOf<'wall'> | NodeOf<'divider'> => n.type === 'wall' || n.type === 'divider')
  if (bounding.length === 0) return []
  return span('rooms follow', () => {
    const ops: Op[] = []
    const roots = new Map<string, string>()
    for (const node of bounding) {
      const root = rootOf(doc, node.parent)
      if (root && node.parent && !roots.has(root.id)) roots.set(root.id, node.parent)
    }
    // The boxes of what moves, grown by the gap taken as touching: a space none of them reaches is not looked at.
    const boxes = bounding.map((n) => {
      const pad = (n.type === 'wall' ? n.thickness + Math.abs(n.bulge ?? 0) : 0) + GAP
      return { x0: Math.min(n.a.x, n.b.x) - pad, x1: Math.max(n.a.x, n.b.x) + pad, y0: Math.min(n.a.y, n.b.y) - pad, y1: Math.max(n.a.y, n.b.y) + pad }
    })
    for (const parentId of roots.values()) {
      for (const room of roomsIn(doc, parentId)) {
        if (going.has(room.id)) continue
        const region = roomAt(doc, room.parent, room)
        if (!region) continue
        const xs = region.outline.map((p) => p.x)
        const ys = region.outline.map((p) => p.y)
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        if (!boxes.some((b) => b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0)) continue
        const bounds = spaceBounds(doc, parentId, region)
        if (bounds.length > 0 && bounds.every((n) => going.has(n.id))) ops.push({ op: 'update_node', id: room.id, patch: { x: room.x + d.x, y: room.y + d.y } })
      }
    }
    return ops
  })
}

/** Whether an edit made by `ops` touched what bounds spaces: walls and dividers. */
function reshapesSpaces(before: Document, after: Document, ops: Op[]): boolean {
  const bounding = (node: Node | undefined) => node?.type === 'wall' || node?.type === 'divider'
  return ops.some((op) => {
    if (op.op === 'add_node') return bounding(op.node as Node)
    const id = 'id' in op && typeof op.id === 'string' ? op.id : null
    return id !== null && (bounding(before.nodes[id]) || bounding(after.nodes[id]))
  })
}

/**
 * What follows for rooms from an edit (`ops`, from `before` to `after`) on the plan of `parentId`,
 * when rooms are put in by themselves:
 * - `moved`: a room the edit covered (its point now on a wall or a divider, in no space, or within
 *   `EDGE` of the edge of its space, where it was clear of it before) goes to the middle
 *   (`middleOf`) of the largest space without another room that its space now holds;
 * - `spots`: a room goes in each space of at least `LEAST_ROOM` that holds none and that the edit
 *   closed (no space was there before), or split off a space whose room is now in another one (a
 *   wall or a divider drawn across a room).
 * A space left without a room otherwise (its room deleted) stays so. Nothing when the edit touched
 * no wall or divider.
 */
export function roomsAfterEdit(before: Document, after: Document, parentId: string, ops: Op[]): { moved: { id: string; x: number; y: number }[]; spots: Vec2[] } {
  if (!reshapesSpaces(before, after, ops)) return { moved: [], spots: [] }
  return span('rooms put in by themselves', () => roomsFollowing(before, after, parentId))
}

function roomsFollowing(before: Document, after: Document, parentId: string): { moved: { id: string; x: number; y: number }[]; spots: Vec2[] } {
  const spaces = roomRegions(after, parentId).filter((region) => region.area >= LEAST_ROOM)
  // The middle of a space is found only for the spaces looked at, at most once each.
  const found = new Map<Region, Vec2>()
  const middles = { get: (region: Region) => found.get(region) ?? found.set(region, middleOf(region)).get(region) }
  // A point is a space's when that is the smallest space it is in: a space with another inside it is not that one's.
  const spaceOf = (p: Vec2) => roomAt(after, parentId, p)
  const rooms = roomsIn(after, parentId)
  const at = new Map(rooms.map((room) => [room.id, { x: room.x, y: room.y } as Vec2]))
  // The space each room is in, looked up once, and again for a room moved.
  const inside = new Map(rooms.map((room) => [room.id, spaceOf(room)]))
  const roomed = (region: Region) => [...inside.values()].some((space) => space === region)

  const moved: { id: string; x: number; y: number }[] = []
  for (const room of rooms) {
    const now = spaceOf(room)
    const then = (before.nodes[room.id] as NodeOf<'room'> | undefined) ?? room
    const was = roomAt(before, parentId, then)
    if (!was || (now && (!nearEdge(room, now) || nearEdge(then, was)))) continue
    const others = (region: Region) => [...inside].some(([id, space]) => id !== room.id && space === region)
    const free = spaces.filter((region) => inRegion(middles.get(region)!, was) && spaceOf(middles.get(region)!) === region && !others(region))
    if (free.length === 0) continue
    const largest = free.reduce((a, b) => (b.area > a.area ? b : a))
    const p = middles.get(largest)!
    at.set(room.id, p)
    inside.set(room.id, largest)
    moved.push({ id: room.id, x: p.x, y: p.y })
  }

  const roomsBefore = roomsIn(before, parentId)
  const spots: Vec2[] = []
  for (const region of spaces) {
    const p = middles.get(region)!
    if (roomed(region) || spaceOf(p) !== region) continue
    const was = roomAt(before, parentId, p)
    const split = was && roomsBefore.some((room) => inRegion(room, was) && inside.has(room.id) && inside.get(room.id) !== null)
    if (!was || split) spots.push(p)
  }
  return { moved, spots }
}
