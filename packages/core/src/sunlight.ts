import ClipperLib from 'clipper-lib'
import { boundsContainPoint, boundsOfPoints, boundsTouch, pointInPolygon, type Vec2 } from './geometry'
import { leavesOf, rootOf } from './document'
import { lookedAt } from './elevation'
import { massing, type Solid } from './massing'
import { openingSpan } from './walls/openings'
import { span } from './perf'
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'
import { shadowReach, sunAt, towardsSun, type Site, type SunPosition } from './sun'

/*
 * The shade the sun casts on a plan, and the floors it lights (ARCHITECTURE, "The sun").
 *
 * Everything raised (`massing`: each stretch of wall, each object, each ceiling) is an outline
 * standing from a bottom to a top. A point of the ground is in the shade of one when the line from
 * it to the sun goes through it: the outline pushed away from the sun by its bottom and by its top,
 * and everything in between, which is the outline swept along a segment (a Minkowski sum). The
 * union of those sweeps is all the shade on the ground, with no ray cast. Inside a room, the ceiling
 * shades the whole floor but where the light comes in under it, through a door or a window: there the
 * wall above and below the opening casts nothing, and the patch of sun on the floor is what is left,
 * cut by the reveals of the wall, by the furniture in the way, by another wing of the building. The
 * glass of windows casts nothing.
 */

/** The default site, where a drawing says none (`settings.site`). */
export const DEFAULT_SITE: Site = { latitude: 48.857, longitude: 2.352, timeZone: 'Europe/Paris' }

/** How large a sun's circle of the sky is drawn, in mm, when it says nothing (`radius`). */
export const SUN_RADIUS = 2000

/** Under this height, in degrees, the sun is taken as this high: lower, a wall's shade runs for hundreds of metres. */
const LOWEST = 3

/** The most solids whose shade is worked out for one sun: past them, the rest cast none. */
export const MOST_SHADING = 20_000

/** Where the building of a drawing is. */
export function siteOf(doc: Document): Site {
  return doc.settings?.site ?? DEFAULT_SITE
}

/** Which way true north is on the plan of the page `id` is on, in degrees clockwise from up. */
export function northOf(doc: Document, id: string | null): number {
  const page = id ? rootOf(doc, id) : null
  return page?.type === 'page' ? (page.north ?? 0) : 0
}

/** Where a sun node's sun is in the sky, and the way to it on its page's plan; null for a moment that is not one. */
export function sunOf(doc: Document, sun: NodeOf<'sun'>): { position: SunPosition; towards: Vec2 } | null {
  const position = sunAt(siteOf(doc), sun.date, sun.time)
  return position && { position, towards: towardsSun(position.azimuth, northOf(doc, sun.parent)) }
}

/** The suns of a page, in the order of the drawing. */
export function sunsOf(doc: Document, pageId: string): NodeOf<'sun'>[] {
  return leavesOf(doc, pageId).filter((n): n is NodeOf<'sun'> => n.type === 'sun')
}

/** The sun a viewpoint's view is lit by: the one it names on the plan it looks at, else the first there; null with none. */
export function sunFor(doc: Document, camera: NodeOf<'camera'>, pageId: string): NodeOf<'sun'> | null {
  const suns = sunsOf(doc, pageId)
  return suns.find((sun) => sun.id === camera.sun) ?? suns[0] ?? null
}

/** Where the light of a viewpoint's view comes from: the way to its sun on the plan and how high it is drawn (`drawnAltitude`); null with no sun on the plan it looks at, or one at a moment that is not one. */
export function cameraSun(doc: Document, camera: NodeOf<'camera'>): { towards: Vec2; altitude: number } | null {
  const page = rootOf(doc, lookedAt(doc, camera))
  const sun = page ? sunFor(doc, camera, page.id) : null
  const at = sun && sunOf(doc, sun)
  return at && { towards: towardsSun(at.position.azimuth, northOf(doc, page!.id)), altitude: drawnAltitude(at.position.altitude, sun!.reach) }
}

/**
 * The shade on the ground, and the floors lit under ceilings, as outlines with no holes (each hole
 * joined to its outline by a cut of no width); and in `layers`, each again from a little wider to a
 * little narrower (`SOFT_LAYERS` of them, across `SOFT_EDGE`), whose colours laid one over the other
 * fade their edges: what is drawn.
 */
export interface Sunlight {
  shade: Vec2[][]
  lit: Vec2[][]
  layers: { shade: Vec2[][]; lit: Vec2[][] }[]
}

/**
 * How much the shade and the sunlit floors are smoothed, in mm: slivers and gaps narrower than
 * twice this go, and corners are rounded as much. Light from a sun, which is not a point, has no
 * hairline shadows nor sharp corners; drawn exactly, the plan showed specks and stripes.
 */
const SMOOTH = 60
/**
 * How wide the soft edge of the shade and the sunlit floors is, in mm, drawn in so many layers: a
 * third of it outside their edge and the rest inside, so that a small patch of sun keeps its colour
 * in its middle (all inside, one 20 cm wide had almost none), and its halo does not go through a wall
 * of 10 cm into the room beyond.
 */
export const SOFT_EDGE = 150
export const SOFT_LAYERS = 4

/**
 * How high the sun is drawn for its shade to reach `reach` times as far as the sun's own (a sun's
 * `reach`, Shade length in Properties), in degrees: lower for a longer shade.
 */
export function drawnAltitude(altitude: number, reach = 1): number {
  if (altitude <= 0 || reach === 1) return altitude
  return (Math.atan(Math.tan((altitude * Math.PI) / 180) / Math.max(0.05, reach)) * 180) / Math.PI
}

type Path = ClipperLib.Path
const SCALE = 10
const toPath = (points: Vec2[]): Path => points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
const fromPath = (path: Path): Vec2[] => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))
const moved = (path: Path, d: Vec2): Path => path.map((p) => ({ X: p.X + Math.round(d.x * SCALE), Y: p.Y + Math.round(d.y * SCALE) }))

/** Whether a closed outline turns the same way at every corner. */
function convex(path: Path): boolean {
  let sign = 0
  for (let i = 0; i < path.length; i++) {
    const [a, b, c] = [path[i], path[(i + 1) % path.length], path[(i + 2) % path.length]]
    const cross = (b.X - a.X) * (c.Y - b.Y) - (b.Y - a.Y) * (c.X - b.X)
    if (cross === 0) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

/** The convex hull of points (Andrew's monotone chain). */
function hull(points: Path): Path {
  const sorted = [...points].sort((a, b) => a.X - b.X || a.Y - b.Y)
  const cross = (o: ClipperLib.IntPoint, a: ClipperLib.IntPoint, b: ClipperLib.IntPoint) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X)
  const half = (list: Path) => {
    const out: Path = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** The ground a solid shades: its outline swept from where its bottom's shade falls to where its top's does. */
function sweep(solid: Solid, push: Vec2): Path[] {
  const bottom = Math.max(0, solid.bottom)
  const low = { x: push.x * bottom, y: push.y * bottom }
  const high = { x: push.x * solid.top, y: push.y * solid.top }
  const outlines = [solid.outline, ...(solid.upper ? [solid.upper] : [])].map(toPath).filter((path) => path.length >= 3)
  return outlines.flatMap((path) => {
    if (convex(path)) return [hull([...moved(path, low), ...moved(path, high)])]
    const segment = [moved([{ X: 0, Y: 0 }], low)[0], moved([{ X: 0, Y: 0 }], high)[0]]
    return [moved(path, low), ...ClipperLib.Clipper.MinkowskiSum(path, segment, false)]
  })
}

const unite = (paths: Path[]): Path[] => {
  const clipper = new ClipperLib.Clipper()
  for (const path of paths) clipper.AddPath(ClipperLib.Clipper.Orientation(path) ? path : [...path].reverse(), ClipperLib.PolyType.ptSubject, true)
  const out: Path[] = []
  clipper.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return out
}

/** `subject` with what `clip` covers taken out (`ctDifference`) or kept only (`ctIntersection`), as a tree of outlines and holes. */
function clipped(subject: Path[], clip: Path[], type: ClipperLib.ClipType): ClipperLib.PolyTree {
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true)
  const tree = new ClipperLib.PolyTree()
  clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return tree
}

/**
 * Outlines grown by `by` mm, or shrunk when it is negative, their corners rounded (`round`), each
 * arc within 3 mm of a circle, or mitred: what is already round stays so.
 */
function grown(paths: Path[], by: number, round = true): Path[] {
  if (paths.length === 0) return []
  const offset = new ClipperLib.ClipperOffset(2, 3 * SCALE)
  offset.AddPaths(paths, round ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const out: Path[] = []
  offset.Execute(out, by * SCALE)
  return out
}

/** Outlines with what is narrower than twice `SMOOTH` taken out, and the gaps as narrow filled, every corner rounded. */
const smoothed = (paths: Path[]): Path[] => grown(grown(grown(paths, SMOOTH), -2 * SMOOTH), SMOOTH)

/** The same as `clipped`, as plain outlines and holes, to clip again. */
function clippedPaths(subject: Path[], clip: Path[], type: ClipperLib.ClipType): Path[] {
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true)
  const out: Path[] = []
  clipper.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return out
}

const middleOf = (points: Vec2[]): Vec2 => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length })

/**
 * Each outline of a tree with its holes, as one outline with no holes: each hole joined to it by a
 * cut there and back from its nearest point, which has no width, so that it fills as it should with
 * nothing but simple paths, which every renderer draws.
 */
function keyholed(tree: ClipperLib.PolyTree): Vec2[][] {
  const out: Vec2[][] = []
  const outline = (node: ClipperLib.PolyNode) => {
    let ring = fromPath(node.Contour())
    for (const hole of node.Childs()) {
      const inner = fromPath(hole.Contour())
      if (inner.length >= 3 && ring.length >= 3) {
        let [best, at, from] = [Infinity, 0, 0]
        for (let i = 0; i < ring.length; i++)
          for (let j = 0; j < inner.length; j++) {
            const d = (ring[i].x - inner[j].x) ** 2 + (ring[i].y - inner[j].y) ** 2
            if (d < best) [best, at, from] = [d, i, j]
          }
        ring = [...ring.slice(0, at + 1), ...inner.slice(from), ...inner.slice(0, from + 1), ...ring.slice(at)]
      }
      // What lies inside a hole is an outline again.
      for (const island of hole.Childs()) outline(island)
    }
    if (ring.length >= 3) out.push(ring)
  }
  for (const node of tree.Childs()) outline(node)
  return out
}

/** The plan of a page raised, kept while nothing but suns and viewpoints change: moving a sun does not raise the plan again. */
let raised: { nodes: Document['nodes']; layers: Document['layers']; page: string; registry: Registry; solids: Solid[] } | null = null

function solidsOf(doc: Document, pageId: string, registry: Registry): Solid[] {
  const last = raised
  if (last && last.page === pageId && last.registry === registry && last.layers === doc.layers && onlySunsMoved(last.nodes, doc.nodes)) {
    last.nodes = doc.nodes
    return last.solids
  }
  const solids = massing(doc, pageId, registry)
  raised = { nodes: doc.nodes, layers: doc.layers, page: pageId, registry, solids }
  return solids
}

/** Whether nothing but suns and viewpoints changed between two sets of nodes, which leaves what is raised as it was. */
export function onlySunsMoved(before: Document['nodes'], after: Document['nodes']): boolean {
  if (before === after) return true
  const keys = Object.keys(after)
  if (keys.length !== Object.keys(before).length) return false
  const free = (type: string | undefined) => type === 'sun' || type === 'camera'
  return keys.every((id) => before[id] === after[id] || (free(after[id].type) && free(before[id]?.type)))
}

const lights = new WeakMap<Solid[], Map<string, Sunlight>>()

/**
 * The shade the sun casts on the ground of a page's plan, coming from `towards` (on the plan) at
 * `altitude` degrees, and the floors it lights under the ceilings of its rooms; null when it is
 * down. Walls, objects and ceilings cast shade; the glass of windows none.
 */
export function sunlight(doc: Document, pageId: string, registry: Registry, towards: Vec2, altitude: number): Sunlight | null {
  if (altitude <= 0) return null
  return span('sunlight', () => {
    const solids = solidsOf(doc, pageId, registry)
    const key = `${towards.x.toFixed(5)} ${towards.y.toFixed(5)} ${altitude.toFixed(4)}`
    let kept = lights.get(solids)
    if (!kept) lights.set(solids, (kept = new Map()))
    const known = kept.get(key)
    if (known) return known
    const reach = shadowReach(Math.max(LOWEST, altitude))
    const push = { x: -towards.x * reach, y: -towards.y * reach }
    // A door or a window is a clean opening for the light: its frame, its sashes and its bars, thin
    // as they are, cut the patch of sun under it into stripes that only looked wrong.
    const openings = new Map<string, boolean>()
    const opening = (id: string) => {
      if (!openings.has(id)) openings.set(id, !!doc.nodes[id] && openingSpan(doc.nodes[id], registry) !== null)
      return openings.get(id)!
    }
    const casting = solids.filter((solid) => solid.role !== 'glass' && solid.top > 0 && !opening(solid.node)).slice(0, MOST_SHADING)
    // Under a ceiling is inside: there the floor is in the shade but for what the sun lights.
    const ceilings = solids.filter((solid) => solid.role === 'ceiling')
    const inside = unite(ceilings.map((solid) => toPath(solid.outline)))
    // What stands under a ceiling shades only the floor the sun lights in there, never the ground
    // outside, which the walls and the ceiling round it already shade from any sun that could reach
    // it: it is cut out of the sunlit floors, and only where its shade reaches one. A plan of
    // furnished rooms has many more of those than of walls. (The frames of windows, in the walls,
    // could be taken so too, but testing which are made it slower.)
    const enclosing = ceilings
    const boxes = enclosing.map((solid) => boundsOfPoints(solid.outline)!)
    const indoors = (solid: Solid) => {
      if (solid.role !== 'object') return false
      const centre = middleOf(solid.outline)
      return enclosing.some((around, i) => boundsContainPoint(boxes[i], centre) && pointInPolygon(centre, around.outline))
    }
    const shade = unite(casting.filter((solid) => !indoors(solid)).flatMap((solid) => sweep(solid, push)))
    let lit = inside.length > 0 ? clippedPaths(inside, shade, ClipperLib.ClipType.ctDifference) : []
    if (lit.length > 0) {
      const patches = lit.map((path) => boundsOfPoints(fromPath(path))!)
      const inWay = casting
        .filter(indoors)
        .flatMap((solid) => sweep(solid, push))
        .filter((path) => {
          const box = boundsOfPoints(fromPath(path))!
          return patches.some((patch) => boundsTouch(patch, box))
        })
      if (inWay.length > 0) lit = clippedPaths(lit, unite(inWay), ClipperLib.ClipType.ctDifference)
    }
    const outside = smoothed(clippedPaths(shade, inside, ClipperLib.ClipType.ctDifference))
    const sunlit = smoothed(lit)
    // From a third of the soft edge outside to the rest inside; the shade kept out from under the
    // ceilings, the sunlit floors under them.
    const layers = Array.from({ length: SOFT_LAYERS }, (_, i) => {
      const by = SOFT_EDGE / 3 - (SOFT_EDGE * i) / (SOFT_LAYERS - 1)
      return {
        shade: keyholed(clipped(by === 0 ? outside : grown(outside, by, false), by > 0 ? inside : [], by > 0 ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion)),
        lit: keyholed(clipped(by === 0 ? sunlit : grown(sunlit, by, false), by > 0 ? inside : [], by > 0 ? ClipperLib.ClipType.ctIntersection : ClipperLib.ClipType.ctUnion)),
      }
    })
    const result: Sunlight = { shade: keyholed(clipped(outside, [], ClipperLib.ClipType.ctUnion)), lit: keyholed(clipped(sunlit, [], ClipperLib.ClipType.ctUnion)), layers }
    // A sun dragged through the day asks for a new hour at each step: only the latest few are kept.
    if (kept.size > 16) kept.delete(kept.keys().next().value!)
    kept.set(key, result)
    return result
  })
}
