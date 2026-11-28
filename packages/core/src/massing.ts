import { leavesOf } from './document'
import { applyTransform, inverseTransform, boundsOfPoints, boundsTouch, dist, distToSegment, mid, norm, pointInPolygon, scale, sub, add, type Bounds, type Vec2 } from './geometry'
import { convexHull, DEFAULT_WALL_HEIGHT, heightOf, heightsOf, outlineOf, shownOnPlan } from './elevation'
import { nodePrimitives } from './kinds'
import type { Primitive } from './primitives'
import type { Finish, KindSolid, ParametricKind, Registry } from './registry'
import { roomAt, roomRegions, type Region } from './rooms'
import type { Document, Node, NodeOf } from './schema'
import { heightAboveFloor, heightInPlace, mountOf, propsInPlace } from './walls/mount'
import { hostWall, openingSpan, wallOpenings } from './walls/openings'
import { wallParts } from './walls/outline'
import { wallsIn } from './walls/spatial'

/*
 * The plan raised to its heights, as plain solids: what a viewpoint (`camera.ts`) looks at. Nothing
 * of it is stored; it is worked out from the plan each time, as an elevation is, from what the
 * elevations read (a wall's height, a door's or a window's sill and height, an object's height and
 * its height above the floor). Each solid is an outline on the plan standing from `bottom` to `top`
 * above the floor, which any renderer can raise. An object's solid carries the drawings the
 * drawing already makes of it (`drawings`), for a renderer to paint on its faces, so that a sink
 * shows its bowls and tap on its top and a base unit its doors on its front.
 */

/**
 * What a solid is of: a stretch of wall, an object, the glass of a window, a ceiling; or the walls
 * of a stairwell going down through the floor ('shaft'), whose hole a renderer cuts out of the
 * ground it lays under everything.
 */
export type SolidRole = 'wall' | 'object' | 'glass' | 'ceiling' | 'shaft'

export interface Solid {
  /** The node it comes from: the wall, the object, the window, the room. */
  node: string
  role: SolidRole
  /** Its outline on the plan, closed (the last point is not repeated). */
  outline: Vec2[]
  /** What is cut out of it on the plan: a ceiling round a column. */
  holes?: Vec2[][]
  /** Where it starts and stops above the floor, in mm. */
  bottom: number
  top: number
  /** For an object: what the drawing draws of it, to be painted on its faces. */
  drawings?: SolidDrawings
  /** For a slab of an object its kind gives (`solids`): what it looks like. */
  finish?: Finish
  /** For a slab that narrows or widens as it goes up: its outline at its top, point for point (`KindSolid.upper`). */
  upper?: Vec2[]
}

/**
 * What the drawing draws of an object, and where each drawing goes on its solid, as elevations
 * place them. `top` is its plan, in the drawing's coordinates: on its top face where it lies.
 * `front`, `side` and `back` are what its kind draws seen from there, each in its own X across and
 * its own Y down: a point of a face at `p` on the plan and `z` above the floor is at X =
 * (p - origin)·along for the front and the back, (p - origin)·facing for a side, and Y = base - z.
 * A face takes the drawing of where it looks: within 45° of `facing` its front, past 135° its back,
 * else its side (`seenFrom`). A kind that draws none of them leaves those faces plain.
 */
export interface SolidDrawings {
  top: Primitive[]
  front?: Primitive[]
  side?: Primitive[]
  back?: Primitive[]
  /** Its insertion point on the plan (its own X = Y = 0). */
  origin: Vec2
  /** Its own X on the plan, as long as one of its millimetres. */
  along: Vec2
  /** The way it faces on the plan (its own +Y, or -Y for what stands out of its wall the other way), of length 1. */
  facing: Vec2
  /** How high above the floor its own Y = 0 is in those drawings: its underside, or for what is fixed on a wall, the point its height is measured to. */
  base: number
}

/** Marks a slab that goes up to the ceiling (`KindSolid.toCeiling`), until `massing` knows how high it is. */
const TO_CEILING = Symbol('to the ceiling')

/** How large what is fixed on a wall with no height of its own is drawn, in mm: a socket's plate. */
const PLATE = 80
/** How thick the glass of a window is drawn, in mm: thick enough to show its frame. */
const PANE = 30
/** How thick a ceiling is, in mm. */
const SLAB = 20
/** How far a ceiling reaches past the faces of the walls around its room, in mm. */
const CEILING_REACH = 40
/** Below this, a stretch of wall over or under an opening is left out, in mm. */
const SLIVER = 1

/**
 * The page's walls, doors, windows, furniture and ceilings, as solids. `also` are points whose room
 * has a ceiling too, though no room is named there (where a viewpoint stands). Given `from`, where
 * the plan is looked at from, only the building there is raised (`buildingAround`): a page often
 * holds other plans, another floor or an elevation, which a view through a window must not show.
 */
export function massing(doc: Document, pageId: string, registry: Registry, also: Vec2[] = [], from?: Vec2): Solid[] {
  const solids: Solid[] = []
  const shown = wallsIn(doc, pageId).filter((wall) => shownOnPlan(doc, wall))
  const building = from ? buildingAround(shown, from) : null
  const walls = building?.walls ?? shown
  const near = (outline: Vec2[]) => {
    const box = building && boundsOfPoints(outline)
    return !building || !box || boundsTouch(box, building.bounds)
  }
  // A ceiling over each room, as high as the highest wall, so that what is seen from inside is closed.
  const ceiling = walls.length > 0 ? Math.max(...walls.map((wall) => heightOf(doc, wall))) : DEFAULT_WALL_HEIGHT
  for (const wall of walls) solids.push(...wallSolids(doc, wall, registry))
  // What a stair cuts out of the ceiling it goes up through, on the plan; one going down through the
  // floor has walls round its opening down to the floor below, and that floor at their foot.
  const throughCeiling: Vec2[][] = []
  for (const leaf of leavesOf(doc, pageId)) {
    if ((leaf.type !== 'instance' && leaf.type !== 'parametric') || !shownOnPlan(doc, leaf)) continue
    const well = leaf.type === 'parametric' ? stairwellOf(leaf, registry) : null
    if (well && near(well.outline)) {
      if (well.way === 'up') throughCeiling.push(well.outline)
      else {
        // Its top just under the ground, which covers it round the opening.
        solids.push({ node: leaf.id, role: 'shaft', outline: grown(well.outline, SHAFT_WALL), holes: [well.outline], bottom: -well.depth - SLAB, top: -2 })
        solids.push({ node: leaf.id, role: 'wall', outline: well.outline, bottom: -well.depth - SLAB, top: -well.depth })
      }
    }
    if (openingSpan(leaf, registry)) {
      if (leaf.type === 'parametric') solids.push(...openingSolids(doc, leaf, registry, from).filter((solid) => near(solid.outline)))
      continue
    }
    for (const solid of objectSolids(doc, leaf, registry)) {
      if (!near(solid.outline)) continue
      // What goes up to the ceiling is made to, a copy of what is kept.
      if (!(TO_CEILING in solid)) solids.push(solid)
      else {
        const { [TO_CEILING]: _, ...rest } = solid as Solid & { [TO_CEILING]?: true }
        solids.push(ceiling > solid.bottom ? { ...rest, top: ceiling } : rest)
      }
    }
  }
  // Each space the walls close has a ceiling, the room named there or not (a hall, a corridor, the
  // stairs: without one, the sun shone down into them and on through their doors and windows), but
  // for a room open to the sky (`open`: a courtyard, a terrace). A ceiling is its room's, to pick.
  const regions = new Map<Region, string>()
  const open = new Set<Region>()
  const rooms = leavesOf(doc, pageId).filter((leaf): leaf is NodeOf<'room'> => leaf.type === 'room')
  for (const room of rooms) {
    const region = room.open ? roomAt(doc, room.parent, room) : null
    if (region) open.add(region)
  }
  for (const room of rooms) {
    if (!shownOnPlan(doc, room)) continue
    const region = roomAt(doc, room.parent, room)
    if (region && !open.has(region) && !regions.has(region) && near(region.outline)) regions.set(region, room.id)
  }
  for (const region of roomRegions(doc, pageId)) if (!open.has(region) && !regions.has(region) && near(region.outline)) regions.set(region, '')
  for (const p of also) {
    const region = roomAt(doc, pageId, p)
    if (region && !open.has(region) && !regions.has(region)) regions.set(region, '')
  }
  const wallParts = solids.filter((solid) => solid.role === 'wall' && solid.bottom >= 0)
  for (const [region, node] of regions) {
    // Each a little larger than its room, into the walls around it, so that two rooms with no wall
    // between them have no crack between their ceilings; open where a stair in the room goes up.
    const holes = [...region.holes, ...throughCeiling.filter((cut) => pointInPolygon(centreOf(cut), region.outline) && !region.holes.some((hole) => pointInPolygon(centreOf(cut), hole)))]
    const outline = grown(region.outline, CEILING_REACH)
    // As high as the highest of the walls round it, whose faces it reaches into: a taller wing, or a
    // garden wall, elsewhere on the page leaves no gap over the walls of this room for light to come through.
    const box = boundsOfPoints(outline)
    const round = wallParts.filter((part) => box && boundsTouch(boundsOfPoints(part.outline)!, box) && part.outline.some((p) => pointInPolygon(p, outline)))
    const height = round.length > 0 ? Math.max(...round.map((part) => part.top)) : ceiling
    solids.push({ node, role: 'ceiling', outline, ...(holes.length > 0 ? { holes } : {}), bottom: height, top: height + SLAB })
  }
  return solids
}

const centreOf = (points: Vec2[]): Vec2 => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length })

/** How thick the walls round a stairwell going down are, in mm. */
const SHAFT_WALL = 100

/** The opening an object goes through to another floor (`ParametricKind.stairwell`), placed on the plan; null when none. */
function stairwellOf(node: NodeOf<'parametric'>, registry: Registry): { outline: Vec2[]; way: 'up' | 'down'; depth: number } | null {
  const kind = registry.parametric.get(node.kind)
  if (!kind?.stairwell) return null
  try {
    const well = kind.stairwell(registry.resolveProps(kind, node.props))
    if (!well || well.outline.length < 3) return null
    const depth = Number(well.depth)
    if (well.way === 'down' && !(depth > 0)) return null
    return { outline: well.outline.map((p) => applyTransform(p, node)), way: well.way === 'down' ? 'down' : 'up', depth: well.way === 'down' ? depth : 0 }
  } catch {
    return null
  }
}

/** How far apart two walls may be and still be of one building, in mm: past a gap left by mistake, short of the space between two plans. */
const SAME_BUILDING = 300
/** How far past its walls a building takes in what stands around it, in mm: a table on a terrace. */
const AROUND_BUILDING = 1000

/**
 * The building at `p`: the wall nearest to it, the walls that meet or nearly meet it (within 300
 * mm, their thickness aside), those that meet them, and so on, and the box round them grown by a
 * metre, within which what stands belongs to it. Plans drawn apart on one page are other buildings.
 */
export function buildingAround(walls: NodeOf<'wall'>[], p: Vec2): { walls: NodeOf<'wall'>[]; bounds: Bounds } | null {
  if (walls.length === 0) return null
  const reach = (wall: NodeOf<'wall'>) => wall.thickness + SAME_BUILDING
  const boxes = walls.map((wall) => {
    const r = reach(wall)
    return { minX: Math.min(wall.a.x, wall.b.x) - r, minY: Math.min(wall.a.y, wall.b.y) - r, maxX: Math.max(wall.a.x, wall.b.x) + r, maxY: Math.max(wall.a.y, wall.b.y) + r }
  })
  let first = 0
  for (let i = 1; i < walls.length; i++) if (distToSegment(p, walls[i].a, walls[i].b) < distToSegment(p, walls[first].a, walls[first].b)) first = i
  const kept = new Set([first])
  const queue = [first]
  while (queue.length > 0) {
    const i = queue.pop()!
    for (let j = 0; j < walls.length; j++) {
      if (kept.has(j) || !boundsTouch(boxes[i], boxes[j])) continue
      if (segmentsApart(walls[i].a, walls[i].b, walls[j].a, walls[j].b) > (walls[i].thickness + walls[j].thickness) / 2 + SAME_BUILDING) continue
      kept.add(j)
      queue.push(j)
    }
  }
  const inside = [...kept].map((i) => walls[i])
  const box = boundsOfPoints(inside.flatMap((wall) => [wall.a, wall.b]))!
  return {
    walls: inside,
    bounds: { minX: box.minX - AROUND_BUILDING, minY: box.minY - AROUND_BUILDING, maxX: box.maxX + AROUND_BUILDING, maxY: box.maxY + AROUND_BUILDING },
  }
}

/** How far apart two segments are: 0 when they cross. */
function segmentsApart(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const crosses = side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
  return crosses ? 0 : Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b))
}

/**
 * A wall as its solid stretches, each as high as the wall, and over and under each door or window
 * between them, the wall above its top and below its sill; in a window, its glass.
 */
function wallSolids(doc: Document, wall: NodeOf<'wall'>, registry: Registry): Solid[] {
  const height = heightOf(doc, wall)
  const { pieces } = wallParts(wall, doc, registry)
  const out: Solid[] = pieces.map((piece) => ({ node: wall.id, role: 'wall', outline: piece.outline, bottom: 0, top: height }))
  const openings = wallOpenings(doc, wall, registry).filter(({ node }) => shownOnPlan(doc, node))
  for (let i = 0; i + 1 < pieces.length; i++) {
    const [before, after] = [pieces[i], pieces[i + 1]]
    if (before.end.length < 2 || after.start.length < 2) continue
    // Across the gap: the end of one stretch (right face to left) and the start of the next (left to right).
    const [right0, left0] = [before.end[0], before.end[before.end.length - 1]]
    const [left1, right1] = [after.start[0], after.start[after.start.length - 1]]
    const gap = [right0, left0, left1, right1]
    const middle = (before.to + after.from) / 2
    const opening = openings.find(({ from, to }) => from <= middle && to >= middle)
    const kind = opening && registry.parametric.get(opening.node.kind)
    if (!opening || !kind) {
      out.push({ node: wall.id, role: 'wall', outline: gap, bottom: 0, top: height })
      continue
    }
    const [bottom, top] = heightsOf(kind, registry.resolveProps(kind, opening.node.props), height)
    if (height - top > SLIVER) out.push({ node: wall.id, role: 'wall', outline: gap, bottom: top, top: height })
    if (bottom > SLIVER) {
      out.push({ node: wall.id, role: 'wall', outline: gap, bottom: 0, top: bottom })
      // What starts above the floor is a window: glass across it, in the middle of the wall, unless its kind makes its own.
      if (top - bottom > SLIVER && !kind.solids) out.push({ node: opening.node.id, role: 'glass', outline: pane(mid(right0, left0), mid(left1, right1), norm(sub(left0, right0))), bottom, top })
    }
  }
  return out
}

/** An outline made larger by `d` all round, each side moved out along its own perpendicular. */
function grown(outline: Vec2[], d: number): Vec2[] {
  const n = outline.length
  if (n < 3) return outline
  // Which way is out: the outline runs one way or the other round its area.
  let area = 0
  for (let i = 0; i < n; i++) area += outline[i].x * outline[(i + 1) % n].y - outline[(i + 1) % n].x * outline[i].y
  const out = area > 0 ? 1 : -1
  return outline.map((p, i) => {
    const [prev, next] = [outline[(i + n - 1) % n], outline[(i + 1) % n]]
    const normal = (a: Vec2, b: Vec2) => {
      const e = norm(sub(b, a))
      return { x: e.y * out, y: -e.x * out }
    }
    const [n1, n2] = [normal(prev, p), normal(p, next)]
    const bisector = { x: n1.x + n2.x, y: n1.y + n2.y }
    const length = Math.hypot(bisector.x, bisector.y)
    if (length < 1e-6) return p
    // Along the bisector, as far as keeps each side `d` away, but no further than 4 d at a sharp corner.
    const k = Math.min(4 * d, d / Math.max(0.25, (bisector.x * n1.x + bisector.y * n1.y) / length))
    return add(p, scale({ x: bisector.x / length, y: bisector.y / length }, k))
  })
}

/** A thin pane from `p` to `q`, `across` being the way across the wall. */
function pane(p: Vec2, q: Vec2, across: Vec2): Vec2[] {
  const half = scale(across, PANE / 2)
  return [add(p, half), add(q, half), sub(q, half), sub(p, half)]
}

/**
 * How high an object stands, in mm, from its underside to its top: what an elevation draws of it.
 * What is fixed on a wall is measured to its centre unless its kind says to its underside; with no
 * height of its own, it is a socket's plate. Null for what has no height: it is not raised.
 */
export function objectHeights(doc: Document, node: NodeOf<'instance'> | NodeOf<'parametric'>, registry: Registry): [number, number] | null {
  const z = heightAboveFloor(node, registry) ?? 0
  if (node.type === 'instance') {
    const component = doc.nodes[node.component]
    const tall = component?.type === 'component' && component.height ? component.height * (node.scale ?? 1) : undefined
    return tall && tall > 0 ? [z, z + tall] : null
  }
  const kind = registry.parametric.get(node.kind)
  if (!kind) return null
  const tall = kind.height?.(propsInPlace(doc, node, registry))
  const mount = mountOf(node, registry)
  if (mount?.on === 'wall') {
    const h = tall && tall > 0 ? tall : PLATE
    return mount.measured === 'bottom' ? [z, z + h] : [Math.max(0, z - h / 2), Math.max(0, z - h / 2) + h]
  }
  return tall && tall > 0 ? [z, z + tall] : null
}

/** The outline of an object on the plan as the drawing draws it: the convex outline of its shapes, its words left out (a height written beside it). */
export function footprint(doc: Document, node: Node, registry: Registry): Vec2[] {
  const points = nodePrimitives(node, { doc, registry, depth: 0 })
    .filter((p) => p.kind !== 'text')
    .flatMap(outlineOf)
  const hull = convexHull(points)
  // Nothing to stand up: drawn as a line, or not at all.
  if (hull.length < 3) return []
  const extent = Math.max(...hull.map((p) => dist(p, hull[0])))
  return extent > 1 ? hull : []
}

/** The most slabs one object is made of: what its kind gives past it is left out. */
const MOST_SLABS = 400

/**
 * An object in 3D: the slabs its kind makes it of (`solids`), placed where it stands; else its
 * outline on the plan raised from its underside to its top. Each carries the drawings to paint.
 */
/**
 * The solids of each parametric object, kept with the node they were made of, for as long as the
 * same extensions are in use: a node is never changed, only replaced, and what a parametric object
 * that is not an opening is made of depends on nothing else, but for how tall it is where its kind
 * works that out (`heightInPlace`), which is kept with them. A plan edited is then raised again in the time it takes to
 * raise what the edit changed, and a renderer can tell the solids it has already by who they are.
 */
const raisedObjects = new WeakMap<object, { registry: Registry; version: number; tall: number | null; solids: Solid[] }>()

function objectSolids(doc: Document, node: NodeOf<'instance'> | NodeOf<'parametric'>, registry: Registry): Solid[] {
  const kind = node.type === 'parametric' ? registry.parametric.get(node.kind) : undefined
  if (!kind || kind.opening) return raiseObject(doc, node, registry, kind)
  const tall = heightInPlace(doc, node, registry)
  const kept = raisedObjects.get(node)
  if (kept && kept.registry === registry && kept.version === registry.version && kept.tall === tall) return kept.solids
  const solids = raiseObject(doc, node, registry, kind)
  raisedObjects.set(node, { registry, version: registry.version, tall, solids })
  return solids
}

function raiseObject(doc: Document, node: NodeOf<'instance'> | NodeOf<'parametric'>, registry: Registry, kind: ParametricKind | undefined): Solid[] {
  if (node.type === 'parametric' && kind?.solids) {
    let slabs: ReturnType<NonNullable<typeof kind.solids>> = []
    // A kind's slabs that fail are not drawn: the object is drawn as its outline raised.
    try {
      slabs = kind.solids(propsInPlace(doc, node, registry), {}).slice(0, MOST_SLABS)
    } catch {
      slabs = []
    }
    if (slabs.length > 0) {
      const z = objectHeights(doc, node, registry)?.[0] ?? heightAboveFloor(node, registry) ?? 0
      const drawings = drawingsOf(doc, node, registry)
      const place = (ring: Vec2[]) => ring.map((p) => applyTransform(p, node))
      return slabs
        .filter((slab) => slab.outline.length >= 3 && slab.top > slab.bottom)
        .map((slab) => ({
          node: node.id,
          role: slab.finish === 'glass' ? ('glass' as const) : ('object' as const),
          outline: place(slab.outline),
          ...(slab.holes?.length ? { holes: slab.holes.filter((hole) => hole.length >= 3).map(place) } : {}),
          bottom: z + slab.bottom,
          top: z + slab.top,
          drawings,
          ...(slab.finish === 'dark' || slab.finish === 'metal' ? { finish: slab.finish } : {}),
          ...(slab.upper?.length === slab.outline.length && !slab.holes?.length ? { upper: place(slab.upper) } : {}),
          ...(slab.toCeiling ? { [TO_CEILING]: true } : {}),
        }))
    }
  }
  const heights = objectHeights(doc, node, registry)
  if (!heights) return []
  const outline = footprint(doc, node, registry)
  return outline.length >= 3 ? [{ node: node.id, role: 'object', outline, bottom: heights[0], top: heights[1], drawings: drawingsOf(doc, node, registry) }] : []
}

/**
 * A door or a window its kind makes in 3D (`ParametricKind.solids`): its frame, its leaves, its
 * glass, told the thickness of the wall it is in, placed where it is. One on no wall is not raised.
 * Seen `from` a point, what is to be seen from one side of the wall only (`side`) is left out from
 * the other: a leaf opened away from the viewpoint.
 */
function openingSolids(doc: Document, node: NodeOf<'parametric'>, registry: Registry, from?: Vec2): Solid[] {
  const kind = registry.parametric.get(node.kind)
  const wall = kind?.solids && hostWall(doc, node, registry)
  if (!kind?.solids || !wall) return []
  let slabs: KindSolid[] = []
  try {
    slabs = kind.solids(registry.resolveProps(kind, node.props), { wallThickness: wall.thickness }).slice(0, MOST_SLABS)
  } catch {
    return []
  }
  const place = (ring: Vec2[]) => ring.map((p) => applyTransform(p, node))
  const here = from && inverseTransform(from, node).y
  return slabs
    .filter((slab) => slab.outline.length >= 3 && slab.top > slab.bottom && !(slab.side && here !== undefined && Math.sign(here) === -slab.side))
    .map((slab) => ({
      node: node.id,
      role: slab.finish === 'glass' ? ('glass' as const) : ('object' as const),
      outline: place(slab.outline),
      ...(slab.holes?.length ? { holes: slab.holes.filter((hole) => hole.length >= 3).map(place) } : {}),
      bottom: slab.bottom,
      top: slab.top,
      ...(slab.finish === 'dark' || slab.finish === 'metal' ? { finish: slab.finish } : {}),
      ...(slab.upper?.length === slab.outline.length && !slab.holes?.length ? { upper: place(slab.upper) } : {}),
    }))
}

/** What the drawing draws of an object, to be painted on its solid (`SolidDrawings`). Its words are left out. */
export function drawingsOf(doc: Document, node: NodeOf<'instance'> | NodeOf<'parametric'>, registry: Registry): SolidDrawings {
  const drawn = (prims: Primitive[] | undefined) => prims?.filter((p) => p.kind === 'path' || p.kind === 'ellipse')
  const origin = applyTransform({ x: 0, y: 0 }, node)
  const along = sub(applyTransform({ x: 1, y: 0 }, node), origin)
  const ownY = norm(sub(applyTransform({ x: 0, y: 1 }, node), origin))
  const top = drawn(nodePrimitives(node, { doc, registry, depth: 0 }))!
  const base = heightAboveFloor(node, registry) ?? 0
  if (node.type !== 'parametric') return { top, origin, along, facing: ownY, base }
  const kind = registry.parametric.get(node.kind)
  const facing = mountOf(node, registry)?.out === 'up' ? { x: -ownY.x, y: -ownY.y } : ownY
  if (!kind) return { top, origin, along, facing, base }
  const props = propsInPlace(doc, node, registry)
  // A kind's drawing that fails is not painted: the object is still drawn, plain.
  const own = (draw: ((props: Record<string, any>) => Primitive[]) | undefined) => {
    try {
      return drawn(draw?.(props))
    } catch {
      return undefined
    }
  }
  return { top, front: own(kind.front), side: own(kind.side), back: own(kind.back), origin, along, facing, base }
}
