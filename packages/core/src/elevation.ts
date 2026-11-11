import { leavesOf, rootOf } from './document'
import { applyTransform, dist, norm, perp, sub, unionBounds, type Bounds, type Vec2 } from './geometry'
import type { Op } from './ops'
import { primitiveBounds, transformPrimitive, type Primitive } from './primitives'
import type { ParametricKind, Registry } from './registry'
import { leavesOf as everythingIn } from './document'
import type { Document, Node, NodeOf } from './schema'
import { courseOf, cross, distToBody, dot, middleAcross, tidy, wallSides, type Wall } from './walls/course'
import { followAlong } from './walls/follow'
import { faceAcross, faceStretch, heightAboveFloor, mountAt, mountedOn, mountOf, wallMounted } from './walls/mount'
import { openingSpan, wallOpenings } from './walls/openings'
import { wallOutline } from './walls/outline'
import { wallsIn } from './walls/spatial'

/*
 * Views of the plan (ARCHITECTURE §4, "Elevations and sections"), worked out from the plan each time
 * they are drawn, as a room's floor is: nothing of a view is stored but its line, its depth and
 * where it is drawn. There is one drawing, never two kept in step. The line (a `viewline` node) is
 * on the plan, and says what is seen: a cut along it, seen from the right of it (as it runs from
 * `a` to `b`), looking at what lies beyond it up to its depth: what crosses the line is cut, what is
 * beyond it seen. The views drawn from it (`elevation` nodes, which refer to it) say only where they
 * are drawn, and how; any page may hold them. An elevation is a view whose line's far side lies on
 * the face of a wall: the line is tied to that wall only by that, and follows it as doors do.
 */

/**
 * How the drawing draws a node, in the drawing's coordinates: what an elevation reads the place of
 * furniture from. Given by kinds.ts, which draws elevations and so cannot be imported here.
 */
let drawnBy: ((node: Node, doc: Document, registry: Registry) => Primitive[]) | null = null
export function drawElevationsWith(drawn: (node: Node, doc: Document, registry: Registry) => Primitive[]): void {
  drawnBy = drawn
}

/** How far beyond its line a view sees, when it does not say. */
export const DEFAULT_DEPTH = 6000
/** How far in front of a face the line of an elevation of it is put: where whoever looks at it stands. */
export const ELEVATION_DEPTH = 1000
/** The faces a view sees, filled so that nearer ones hide those behind. */
const WALL_SEEN = '#ffffff'
/** The walls in front of them, cut by its line or in the way of what it sees: plain grey, all alike. */
const WALL_GREY = '#e8ecf1'

/** How high a wall stands in an elevation when neither it nor its page says. */
export const DEFAULT_WALL_HEIGHT = 2500
/** How far a wall may be turned from the line of a view, as a sine (30°), and be a face it looks at, at a slant; turned further, it is at the side. */
const FACE_TURN = 0.5
/** How far, in mm, the line may be off a face, and still be on it. */
const ON_FACE = 1
/** How far past the ends of its line a view looks for the walls its ends run into. */
const CUT_REACH = 2000
/** The square what is fixed on a wall is drawn as when its kind gives no front, in mm. */
const PLATE = 80
/** What stands in front of the face, lighter than the face and what is on it. */
const STANDING_WEIGHT = 0.6
const FLOOR_WEIGHT = 2

export type Elevation = NodeOf<'elevation'>
export type ViewLine = NodeOf<'viewline'>
type Face = 'left' | 'right'
/** What a line sees, and from where. */
type Sight = Pick<ViewLine, 'a' | 'b' | 'depth'>

/** The line a view is drawn from, or null when the drawing has none of that id. */
export function lineOf(doc: Document, view: Pick<Elevation, 'line'>): ViewLine | null {
  const line = doc.nodes[view.line]
  return line?.type === 'viewline' ? line : null
}

/** The views drawn from a line, in the drawing's order of ids. */
export function viewsOf(doc: Document, lineId: string): Elevation[] {
  return Object.values(doc.nodes).filter((node): node is Elevation => node.type === 'elevation' && node.line === lineId)
}

/**
 * When a patch moves the start of a line, the views of it moved across by as much as its start went
 * along the line, so that what they still show stays where it was on the sheet: a view made shorter
 * at its start by dragging its line keeps its end where it was. Only for the editor's drags of a
 * line by its ends and corners; a line moved whole, with the plan, leaves its views where they are.
 */
export function keepViewsOps(doc: Document, line: ViewLine, patch: Record<string, unknown>): Op[] {
  const a = patch.a as Vec2 | undefined
  if (!a || dist(line.a, line.b) < 1e-6) return []
  const shift = dot(sub(a, line.a), norm(sub(line.b, line.a)))
  if (Math.abs(shift) < 1e-9) return []
  return viewsOf(doc, line.id).map((view): Op => ({ op: 'update_node', id: view.id, patch: { x: tidy(view.x + shift) } }))
}

/** The way to the right of a line from `a` to `b`, which is where a view along it is seen from. */
const viewer = (a: Vec2, b: Vec2) => perp(norm(sub(b, a)))

/** How far beyond its line a view sees, in mm. */
export const depthOf = (node: Pick<ViewLine, 'depth'>) => node.depth ?? DEFAULT_DEPTH

/**
 * The part of the plan a view sees, as four corners: its line from `a` to `b`, then its far side,
 * the same line moved off it by its depth, the way it looks (away from whoever looks).
 */
export function seenArea(node: Sight): [Vec2, Vec2, Vec2, Vec2] {
  if (dist(node.a, node.b) < 1e-6) return [node.a, node.b, node.b, node.a]
  const [c, d] = farSide(node)
  return [node.a, node.b, d, c]
}

/** The far side of what a view sees, from the end across from `a` to the end across from `b`: where an elevation's face is. */
export function farSide(node: Sight): [Vec2, Vec2] {
  if (dist(node.a, node.b) < 1e-6) return [node.a, node.b]
  const n = viewer(node.a, node.b)
  const reach = -depthOf(node)
  return [
    { x: node.a.x + n.x * reach, y: node.a.y + n.y * reach },
    { x: node.b.x + n.x * reach, y: node.b.y + n.y * reach },
  ]
}

/** How short a view may be made by its ends, in mm. */
const SHORTEST = 100
/** How far, in degrees, an end may be dragged off the line and the line still keep its way: the sine. */
const KEEP_WAY = Math.sin((4 * Math.PI) / 180)

/**
 * The patch that moves an end of a view line to `p`. Dragged nearly along the line, the end stays on
 * it, which makes its views shorter or longer, and elevations still of their face; further off, the
 * line turns, and its views become sections along it. The ends are kept apart by `SHORTEST`.
 * (`keepViewsOps` keeps what the views still show where it was on the sheet.)
 */
export function moveViewEnd(node: Pick<ViewLine, 'a' | 'b'>, end: 'a' | 'b', p: Vec2): Record<string, unknown> {
  const length = dist(node.a, node.b)
  if (length < 1e-6) return {}
  const d = norm(sub(node.b, node.a))
  const s = dot(sub(p, node.a), d)
  const at = (t: number) => ({ x: tidy(node.a.x + d.x * t), y: tidy(node.a.y + d.y * t) })
  const other = end === 'a' ? node.b : node.a
  const way = sub(p, other)
  const keeps = dist(p, other) < 1e-6 || Math.abs(cross(norm(way), d)) <= KEEP_WAY
  if (end === 'b') return { b: keeps ? at(Math.max(SHORTEST, s)) : { x: tidy(p.x), y: tidy(p.y) } }
  const t = Math.min(s, length - SHORTEST)
  return { a: keeps ? at(t) : { x: tidy(p.x), y: tidy(p.y) } }
}

/** How far, in degrees, a corner may turn the area it is dragged by and the area still keep its way: the sine. */
const KEEP_TURN = Math.sin((3 * Math.PI) / 180)

/**
 * The patch that moves a corner of what a view sees (`seenArea`: 0 its start on its line, 1 its
 * end, 2 the far corner across from its end, 3 the far corner across from its start) to where `p`
 * is, the corner across from it staying where it is and the area a rectangle.
 *
 * 'turn' (dragging a corner): the area turns about that corner and is as long as it then must be,
 * keeping its depth, so that the corner dragged is where the pointer is; within 3° of its way it
 * keeps its way, and is only made longer or shorter. Turned, the far side of an elevation leaves its
 * face, and it is a section along its new line.
 *
 * 'stretch' (with Shift): the area keeps its way, taken in its own directions along its line and
 * beyond it: a corner on the line moves the line, its far side staying where it is (an elevation
 * stays one of its face, seen from nearer or further); a far corner moves the far side.
 *
 * It stays `SHORTEST` long, and sees no less than nothing. (`keepViewsOps` keeps what its views
 * still show where it was on the sheet.)
 */
export function moveViewCorner(node: Sight, corner: 0 | 1 | 2 | 3, p: Vec2, how: 'turn' | 'stretch' = 'turn'): Record<string, unknown> {
  if (how === 'turn') return turnViewCorner(node, corner, p)
  const length = dist(node.a, node.b)
  if (length < 1e-6) return {}
  const d = norm(sub(node.b, node.a))
  // Beyond the line, the way it looks.
  const n = viewer(node.a, node.b)
  const look = { x: -n.x, y: -n.y }
  const deep = depthOf(node)
  const s = dot(sub(p, node.a), d)
  const t = dot(sub(p, node.a), look)
  const point = (along: number, beyond: number) => ({ x: tidy(node.a.x + d.x * along + look.x * beyond), y: tidy(node.a.y + d.y * along + look.y * beyond) })
  const atStart = corner === 0 || corner === 3
  const from = atStart ? Math.min(s, length - SHORTEST) : 0
  const to = atStart ? length : Math.max(SHORTEST, s)
  if (corner === 0 || corner === 1) {
    // The line moved, its far side where it was.
    const near = Math.min(t, deep)
    return { a: point(from, near), b: point(to, near), depth: tidy(deep - near) }
  }
  return { ...(atStart ? { a: point(from, 0) } : { b: point(to, 0) }), depth: tidy(Math.max(0, t)) }
}

/**
 * A corner dragged to `p`, the one across from it staying, the area keeping its depth and turning
 * as it must (see `moveViewCorner`).
 */
function turnViewCorner(node: Sight, corner: 0 | 1 | 2 | 3, p: Vec2): Record<string, unknown> {
  const length = dist(node.a, node.b)
  if (length < 1e-6) return {}
  const was = norm(sub(node.b, node.a))
  const lookOf = (u: Vec2) => ({ x: u.y, y: -u.x })
  const deep = depthOf(node)
  const area = seenArea(node)
  const fixed = area[(corner + 2) % 4]
  // From the corner that stays to the one dragged: so many lengths along the line and depths beyond it.
  const [along, beyond] = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const)[corner]
  const w = sub(p, fixed)
  const far = Math.hypot(w.x, w.y)
  // As long as the corner must be from the one that stays; a corner brought nearer than the depth allows takes the depth down.
  const span = Math.sqrt(Math.max(SHORTEST ** 2, far ** 2 - deep ** 2))
  const depth = far ** 2 < SHORTEST ** 2 + deep ** 2 ? Math.sqrt(Math.max(0, far ** 2 - SHORTEST ** 2)) : deep
  // w = u × (along·span − i·beyond·depth), as complex numbers (the way it looks is u turned by -90°).
  const [cr, ci] = [along * span, -beyond * depth]
  const m = cr * cr + ci * ci
  let u = m > 1e-9 ? norm({ x: (w.x * cr + w.y * ci) / m, y: (w.y * cr - w.x * ci) / m }) : was
  let l = span
  // Nearly its way: it keeps it, only longer or shorter.
  if (Math.abs(cross(u, was)) <= KEEP_TURN && dot(u, was) > 0) {
    u = was
    l = Math.max(SHORTEST, Math.abs(dot(w, was)))
  }
  const look = lookOf(u)
  // Where each corner is from the start of the line: its end along it, the far ones beyond.
  const offsets = [
    { x: 0, y: 0 },
    { x: u.x * l, y: u.y * l },
    { x: u.x * l + look.x * depth, y: u.y * l + look.y * depth },
    { x: look.x * depth, y: look.y * depth },
  ]
  const start = sub(fixed, offsets[(corner + 2) % 4])
  const end = { x: start.x + u.x * l, y: start.y + u.y * l }
  return {
    a: { x: tidy(start.x), y: tidy(start.y) },
    b: { x: tidy(end.x), y: tidy(end.y) },
    depth: tidy(depth),
  }
}

/**
 * The patch that moves an edge of what a view line sees (`seenArea`) to where `p` is, across itself,
 * the area a rectangle the way it lies, as a wall's face is dragged: 'line', the line itself, its far
 * side staying where it is (an elevation stays one of its face, seen from nearer or further);
 * 'far', its far side, the line staying (`depthThrough`); 'start' and 'end', the sides across from
 * its ends, which make it start or end further along, at least `SHORTEST` long. Only how far `p` is
 * across the edge counts, so that the edge is taken anywhere along it.
 */
export function moveViewEdge(node: Sight, edge: 'line' | 'far' | 'start' | 'end', p: Vec2): Record<string, unknown> {
  const length = dist(node.a, node.b)
  if (length < 1e-6) return {}
  if (edge === 'far') return { depth: depthThrough(node, p) }
  const d = norm(sub(node.b, node.a))
  const s = dot(sub(p, node.a), d)
  const at = (t: number) => ({ x: tidy(node.a.x + d.x * t), y: tidy(node.a.y + d.y * t) })
  if (edge === 'start') return { a: at(Math.min(s, length - SHORTEST)) }
  if (edge === 'end') return { b: at(Math.max(SHORTEST, s)) }
  // Beyond the line, the way it looks; never past its far side.
  const n = viewer(node.a, node.b)
  const deep = depthOf(node)
  const t = Math.min(deep, -dot(sub(p, node.a), n))
  const moved = (q: Vec2) => ({ x: tidy(q.x - n.x * t), y: tidy(q.y - n.y * t) })
  return { a: moved(node.a), b: moved(node.b), depth: tidy(deep - t) }
}

/** The depth that puts the far side of what a view sees through `p`, never below 0. */
export function depthThrough(node: Pick<ViewLine, 'a' | 'b'>, p: Vec2): number {
  if (dist(node.a, node.b) < 1e-6) return 0
  return Math.max(0, Math.round(-dot(sub(p, node.a), viewer(node.a, node.b))))
}

/**
 * An elevation of a face, as `wallFaceAt` gives it (from `a` to `b`, seen from its right): its line
 * `depth` in front of the face, where whoever looks at it stands, and its far side on the face.
 */
export function viewOfFace(face: { a: Vec2; b: Vec2 }, depth = ELEVATION_DEPTH): { a: Vec2; b: Vec2; depth: number } {
  const n = viewer(face.a, face.b)
  const out = (p: Vec2) => ({ x: tidy(p.x + n.x * depth), y: tidy(p.y + n.y * depth) })
  return { a: out(face.a), b: out(face.b), depth }
}

/**
 * The face of the wall nearest to `p`, on `p`'s side of it, as the line an elevation of it looks at:
 * from `a` to `b`, seen from the right of that line, so `a` is on the left of the view. It is the
 * face as drawn (`faceStretch`): an inside face from corner to corner of the room, not into the
 * walls it meets. Null when no straight wall is within `reach` of `p`.
 */
export function wallFaceAt(doc: Document, containerId: string, p: Vec2, reach: number): { wall: Wall; face: Face; a: Vec2; b: Vec2 } | null {
  let wall: Wall | null = null
  let nearest = Infinity
  for (const w of wallsIn(doc, containerId)) {
    if (w.bulge) continue
    const distance = distToBody(p, w)
    if (distance <= reach && distance < nearest) {
      wall = w
      nearest = distance
    }
  }
  if (!wall) return null
  const course = courseOf(wall)
  const face: Face = course.project(p).across >= middleAcross(wall) ? 'right' : 'left'
  const [from, to] = faceStretch(doc, wall, face)
  const start = course.offset(from, faceAcross(wall, face))
  const end = course.offset(to, faceAcross(wall, face))
  // Its right face is to the right of the wall's own line, so seen the way the wall runs; its left face the other way round.
  const [a, b] = face === 'right' ? [start, end] : [end, start]
  return { wall, face, a: { x: tidy(a.x), y: tidy(a.y) }, b: { x: tidy(b.x), y: tidy(b.y) } }
}

/** Which face of a straight wall the line from `a` to `b` lies on, facing the side it is seen from, if any. */
function faceUnder(wall: Wall, a: Vec2, b: Vec2): Face | null {
  if (wall.bulge || dist(a, b) < 1e-6 || dist(wall.a, wall.b) < 1e-6) return null
  const course = courseOf(wall)
  if (Math.abs(cross(course.dir(0), norm(sub(b, a)))) > 1e-3) return null
  // Seen from its right, the line is on the face whose outside is that way.
  const face: Face = dot(viewer(a, b), perp(course.dir(0))) > 0 ? 'right' : 'left'
  const across = faceAcross(wall, face)
  return [a, b].every((p) => Math.abs(course.project(p).across - across) <= ON_FACE) ? face : null
}

/** The first wall, in the drawing's order, whose face the far side of a view line lies on, and that face: what makes its views elevations of it. */
export function elevationWall(doc: Document, node: ViewLine): { wall: Wall; face: Face } | null {
  const [a, b] = farSide(node)
  for (const wall of wallsIn(doc, node.parent)) {
    const face = faceUnder(wall, a, b)
    if (face) return { wall, face }
  }
  return null
}

/**
 * Where an opening is, up the wall: from the floor, or from its sill when its kind says one
 * (`sill`), up to its `height` parameter, never above the wall; the whole wall without one.
 */
function heightsOf(kind: ParametricKind, props: Record<string, any>, wall: number): [number, number] {
  const bottom = kind.sill ? Math.max(0, Number(props[kind.sill]) || 0) : 0
  const tall = typeof props.height === 'number' && props.height > 0 ? props.height : wall - bottom
  return [Math.min(bottom, wall), Math.min(bottom + tall, wall)]
}

/** How high a wall stands: its own height, else its page's, else `DEFAULT_WALL_HEIGHT`. */
function heightOf(doc: Document, wall: Wall): number {
  const page = rootOf(doc, wall.parent)
  return wall.height ?? (page?.type === 'page' ? page.wallHeight : undefined) ?? DEFAULT_WALL_HEIGHT
}

/**
 * The points a primitive is drawn through, in the drawing: a path's own, round an ellipse every
 * fifteen degrees. Not the box around it, upright on the page, which is wider than an object turned
 * at an angle: two kitchen units side by side along a slanted wall would be drawn over each other.
 */
function outlineOf(p: Primitive): Vec2[] {
  if (p.kind === 'path') return p.points
  if (p.kind !== 'ellipse') return []
  const turn = ((p.rotation ?? 0) * Math.PI) / 180
  return Array.from({ length: 24 }, (_, i) => {
    const a = (i * Math.PI) / 12
    const [x, y] = [p.rx * Math.cos(a), p.ry * Math.sin(a)]
    return { x: p.cx + x * Math.cos(turn) - y * Math.sin(turn), y: p.cy + x * Math.sin(turn) + y * Math.cos(turn) }
  })
}

/** What of `subject` (any simple polygon) lies inside `clip`, a convex polygon (Sutherland-Hodgman). */
function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  const middle = clip.reduce((m, q) => ({ x: m.x + q.x / clip.length, y: m.y + q.y / clip.length }), { x: 0, y: 0 })
  let out = subject
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const [u, v] = [clip[i], clip[(i + 1) % clip.length]]
    let n = perp(sub(v, u))
    if (dot(n, sub(middle, u)) < 0) n = { x: -n.x, y: -n.y }
    const side = (p: Vec2) => dot(n, sub(p, u))
    const kept: Vec2[] = []
    for (let j = 0; j < out.length; j++) {
      const [p, q] = [out[j], out[(j + 1) % out.length]]
      const [sp, sq] = [side(p), side(q)]
      if (sp >= 0) kept.push(p)
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq)
        kept.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
      }
    }
    out = kept
  }
  return out
}

/** The stretch, as distances along a line from `p` in direction `d`, that a convex polygon covers, or null. */
function clipLine(p: Vec2, d: Vec2, length: number, polygon: Vec2[]): [number, number] | null {
  let [from, to] = [0, length]
  // Every edge of the polygon is kept on its inner side, which is the side of its middle.
  const middle = polygon.reduce((m, q) => ({ x: m.x + q.x / polygon.length, y: m.y + q.y / polygon.length }), { x: 0, y: 0 })
  for (let i = 0; i < polygon.length; i++) {
    const [u, v] = [polygon[i], polygon[(i + 1) % polygon.length]]
    let n = perp(sub(v, u))
    if (dot(n, sub(middle, u)) < 0) n = { x: -n.x, y: -n.y }
    const start = dot(n, sub(p, u))
    const rate = dot(n, d)
    if (Math.abs(rate) < 1e-12) {
      if (start < 0) return null
      continue
    }
    const t = -start / rate
    if (rate > 0) from = Math.max(from, t)
    else to = Math.min(to, t)
  }
  return to - from > 1e-6 ? [from, to] : null
}

/**
 * What an elevation draws, in the drawing's coordinates: the point (s, h) of the view, `s` mm along
 * its line from `a` and `h` mm above the floor, is at (x + s, y - h). From the back: the faces of
 * the walls along the line, their doors and windows, what is fixed on those faces, the walls the
 * line runs into cut through, the floor, and its dimensions.
 */
export function elevationPrimitives(node: Elevation, doc: Document, registry: Registry, measure: Measure = () => []): Primitive[] {
  return layout(node, doc, registry, measure).prims
}

/** Draws a dimension from `a` to `b`, its line `offset` mm to the right of the way from `a` to `b` (as a dimension node does). */
export type Measure = (a: Vec2, b: Vec2, offset: number) => Primitive[]

/** How far below the floor the dimensions along it stand, in mm. */
const CHAIN_BELOW = 300
/** How far right of what it measures the height of an object fixed on the face is written, in mm. */
const HEIGHT_BESIDE = 60

/** An object of the plan as an elevation shows it: a door or window, what is fixed on the face, or what stands in front of it, and the box it is drawn in. */
export interface ElevationItem {
  node: NodeOf<'parametric'> | NodeOf<'instance'>
  role: 'opening' | 'fixed' | 'standing'
  box: Bounds
  /** Whether it goes up and down when dragged: what is fixed on the face, and an opening whose kind says its sill. */
  raises: boolean
  /** Whether what is drawn in front of it hides all of it: it is then neither dimensioned nor taken by a click in the view. */
  hidden?: boolean
}

/** What a view draws of something beyond its line: over which stretch of it, and how far it is along the line of sight at a point `s` of that stretch. */
interface Layer {
  from: number
  to: number
  depth: (s: number) => number
  prims: Primitive[]
}

/**
 * How far beyond the line of a view an outline on the plan is, along the line of sight `s` along
 * it: the nearest of the points where that line of sight crosses it (`along` and `off` place a point
 * of the plan in the view, `off` towards whoever looks). Outside the outline's stretch, its nearest
 * point's.
 */
function sightDepth(outline: Vec2[], s: number, along: (p: Vec2) => number, off: (p: Vec2) => number): number {
  let nearest = -Infinity
  for (let i = 0; i < outline.length; i++) {
    const [p, q] = [outline[i], outline[(i + 1) % outline.length]]
    const [sp, sq] = [along(p), along(q)]
    if ((s < sp && s < sq) || (s > sp && s > sq)) continue
    // An edge along the line of sight is crossed all along: its nearer end counts.
    nearest = Math.max(nearest, Math.abs(sq - sp) < 1e-9 ? Math.max(off(p), off(q)) : off(p) + (off(q) - off(p)) * ((s - sp) / (sq - sp)))
  }
  if (nearest === -Infinity) nearest = Math.max(...outline.map(off))
  return -nearest
}

/** Whether boxes cover all of `box`: over all its width, each of them as high as it is. */
function covers(over: Bounds[], box: Bounds): boolean {
  const spans = over
    .filter((b) => b.minY <= box.minY + ON_FACE && b.maxY >= box.maxY - ON_FACE)
    .map((b) => [b.minX, b.maxX])
    .sort((p, q) => p[0] - q[0])
  let reached = box.minX
  for (const [x0, x1] of spans) {
    if (x0 > reached + ON_FACE) break
    reached = Math.max(reached, x1)
  }
  return reached >= box.maxX - ON_FACE
}

/** A wall in the way over a stretch of a view: beyond where it is cut, or all of it. */
interface WayPiece {
  wall: Wall
  from: number
  to: number
  depth: (s: number) => number
  height: number
}

/** Whether two walls are joined: an end of one on the other. */
const joined = (one: Wall, other: Wall) => [one.a, one.b].some((p) => distToBody(p, other) <= ON_FACE) || [other.a, other.b].some((p) => distToBody(p, one) <= ON_FACE)

/**
 * Walls in the way taken together where they are joined and as high: each run of such walls side by
 * side, or one in front of the other, over the stretch they take together, as near as the nearest
 * of them along each line of sight.
 */
function joinedRuns(pieces: WayPiece[]): { from: number; to: number; height: number; depth: (s: number) => number }[] {
  // Which mass each wall is of: walls joined to one another, directly or through others.
  const parent = new Map(pieces.map((piece) => [piece.wall.id, piece.wall.id]))
  const mass = (id: string): string => {
    while (parent.get(id) !== id) id = parent.get(id)!
    return id
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (pieces[i].wall.id !== pieces[j].wall.id && joined(pieces[i].wall, pieces[j].wall)) parent.set(mass(pieces[j].wall.id), mass(pieces[i].wall.id))
    }
  }
  const masses = new Map<string, WayPiece[]>()
  for (const piece of pieces) {
    const key = `${mass(piece.wall.id)} ${piece.height}`
    masses.set(key, [...(masses.get(key) ?? []), piece])
  }
  const runs: { from: number; to: number; height: number; depth: (s: number) => number }[] = []
  for (const together of masses.values()) {
    let run: WayPiece[] = []
    const close = () => {
      if (run.length === 0) return
      const members = run
      const from = Math.min(...members.map((m) => m.from))
      const to = Math.max(...members.map((m) => m.to))
      // At each point, the nearest of those there.
      const depth = (s: number) => {
        const there = members.filter((m) => s >= m.from - ON_FACE && s <= m.to + ON_FACE)
        return Math.min(...(there.length > 0 ? there : members).map((m) => m.depth(s)))
      }
      runs.push({ from, to, height: members[0].height, depth })
      run = []
    }
    for (const piece of [...together].sort((p, q) => p.from - q.from)) {
      if (run.length > 0 && piece.from > Math.max(...run.map((m) => m.to)) + ON_FACE) close()
      run.push(piece)
    }
    close()
  }
  return runs
}

/**
 * Layers in the order to paint them: of two that take some of the same stretch of the view, the one
 * further along the line of sight in the middle of what they share first, so that a nearer one
 * covers it there. Things on the plan do not pass through one another, so this is the same along
 * all they share. A loop (three things each partly in front of the next) is broken at the furthest.
 */
function paintOrder(layers: Layer[]): Layer[] {
  const n = layers.length
  const behind: number[][] = layers.map(() => [])
  const waiting = new Array<number>(n).fill(0)
  const middle = layers.map((layer) => layer.depth((layer.from + layer.to) / 2))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [lo, hi] = [Math.max(layers[i].from, layers[j].from), Math.min(layers[i].to, layers[j].to)]
      if (hi - lo < 1e-6) continue
      const s = (lo + hi) / 2
      const [di, dj] = [layers[i].depth(s), layers[j].depth(s)]
      if (Math.abs(di - dj) < 1e-9) continue
      // The further first: the nearer waits for it.
      const [far, near] = di > dj ? [i, j] : [j, i]
      behind[far].push(near)
      waiting[near]++
    }
  }
  const order: Layer[] = []
  const done = new Array<boolean>(n).fill(false)
  for (let k = 0; k < n; k++) {
    let next = -1
    for (let i = 0; i < n; i++) if (!done[i] && waiting[i] === 0 && (next < 0 || middle[i] > middle[next])) next = i
    if (next < 0) for (let i = 0; i < n; i++) if (!done[i] && (next < 0 || middle[i] > middle[next])) next = i
    done[next] = true
    order.push(layers[next])
    for (const near of behind[next]) waiting[near]--
  }
  return order
}

/** The smallest convex outline around points (Andrew's monotone chain), counter-clockwise. */
function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y)
  if (sorted.length < 3) return sorted
  const turn = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const half = (list: Vec2[]) => {
    const out: Vec2[] = []
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** What an elevation draws, and where in it each object of the plan is. */
function layout(view: Elevation, doc: Document, registry: Registry, measure: Measure = () => []): { prims: Primitive[]; items: ElevationItem[] } {
  const line = lineOf(doc, view)
  if (!line) return { prims: [], items: [] }
  // What it sees from its line, drawn where it is.
  const node = { ...line, x: view.x, y: view.y, walls: view.walls, dimensions: view.dimensions }
  const length = dist(node.a, node.b)
  if (length < 1e-6) return { prims: [], items: [] }
  const d = norm(sub(node.b, node.a))
  const along = (p: Vec2) => dot(sub(p, node.a), d)
  const at = (s: number, h: number): Vec2 => ({ x: node.x + s, y: node.y - h })
  const box = (s0: number, s1: number, h0: number, h1: number): Vec2[] => [at(s0, h0), at(s1, h0), at(s1, h1), at(s0, h1)]
  const within = (s: number) => s >= -ON_FACE && s <= length + ON_FACE
  /** What a kind draws seen from in front, put at `s` along the view and `h` above the floor, the way its own X runs. */
  const placed = (object: NodeOf<'parametric'>, shapes: Primitive[], h: number): Primitive[] => {
    const origin = applyTransform({ x: 0, y: 0 }, object)
    const mirrored = dot(sub(applyTransform({ x: 1, y: 0 }, object), origin), d) < 0
    const s = along(origin)
    return shapes.map((p) => transformPrimitive(p, { x: node.x + s, y: node.y - h, flipX: mirrored }))
  }

  const items: ElevationItem[] = []
  // The first thing each item draws, to know in which layer it is painted.
  const drawnFirst = new Map<ElevationItem, Primitive>()
  const shown = (object: ElevationItem['node'], role: ElevationItem['role'], prims: Primitive[]) => {
    const box = prims.map(primitiveBounds).reduce<Bounds | null>((all, one) => (one ? (all ? unionBounds(all, one) : one) : all), null)
    const kind = object.type === 'parametric' ? registry.parametric.get(object.kind) : undefined
    if (box) {
      const item: ElevationItem = { node: object, role, box, raises: role === 'fixed' || !!kind?.sill }
      items.push(item)
      if (prims[0]) drawnFirst.set(item, prims[0])
    }
    return prims
  }
  const deep = depthOf(node)
  const front = viewer(node.a, node.b)
  const off = (p: Vec2) => dot(sub(p, node.a), front)
  const walls = wallsIn(doc, node.parent)

  // Everything seen beyond the line is drawn as layers, each over the stretch of the view it takes,
  // the furthest first where two take the same stretch (`paintOrder`): a face, filled, hides what
  // is behind it, a wall in the way too, and what stands only outlined is hidden by what is in front.
  // How far a layer is, along the line of sight at `s`, is how far its outline on the plan is there.
  const layers: Layer[] = []
  const depthOn = (outline: Vec2[]) => (s: number) => sightDepth(outline, s, along, off)
  // The part of an outline on the plan that the view sees, for knowing how far it is.
  const seenOf = (points: Vec2[]) => clipConvex(convexHull(points), seenArea(node))

  // The faces it sees, each with its doors and windows and what is fixed on it: every face turned
  // towards it beyond its line, up to its far side (the face of an elevation), as far as it is between
  // the two. A face at a slant to the line (a section not quite along a wall) is a face it looks at
  // still, drawn over the stretch it takes, so long as it is within `FACE_TURN` of the line's way; a
  // wall turned further is at the side of what it sees, and in the way (below).
  const seen = new Set<string>()
  // Those whose face lies along the line: never cut by it.
  const along0 = new Set<string>()
  const seenFaces: { wall: Wall; face: Face; ends: [Vec2, Vec2] }[] = []
  // Between the line and the far side, or `slack` past it (a door's place is the middle of its wall, behind the face).
  const between = (p: Vec2, slack = 0) => off(p) <= ON_FACE + slack && off(p) >= -deep - ON_FACE - slack
  for (const wall of walls) {
    if (wall.bulge || dist(wall.a, wall.b) < 1e-6) continue
    const course = courseOf(wall)
    const turn = Math.abs(cross(course.dir(0), d))
    if (turn > FACE_TURN) continue
    for (const face of ['right', 'left'] as Face[]) {
      const outward = perp(course.dir(0))
      if (dot(outward, front) * (face === 'right' ? 1 : -1) <= 0) continue
      const across = faceAcross(wall, face)
      const [p, q] = faceStretch(doc, wall, face).map((t) => course.offset(t, across))
      // The part of the face between the line and the far side.
      const [op, oq] = [off(p), off(q)]
      const [lo, hi] = [-deep - ON_FACE, ON_FACE]
      const at = (k: number) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k })
      const kOf = (o: number) => (Math.abs(oq - op) < 1e-9 ? null : (o - op) / (oq - op))
      const ks = [0, 1, kOf(lo), kOf(hi)].filter((k): k is number => k !== null && k >= 0 && k <= 1).filter((k) => between(at(k)))
      if (ks.length === 0) continue
      seenFaces.push({ wall, face, ends: [at(Math.min(...ks)), at(Math.max(...ks))] })
      if (turn <= 1e-3) along0.add(wall.id)
    }
  }
  for (const { wall, face, ends } of seenFaces) {
    const ss = ends.map(along)
    const from = Math.max(0, Math.min(...ss))
    const to = Math.min(length, Math.max(...ss))
    if (to - from < 1e-6) continue
    seen.add(wall.id)
    const height = heightOf(doc, wall)
    const faces: Primitive[] = []
    layers.push({ from, to, depth: depthOn(ends), prims: faces })
    faces.push({ kind: 'path', points: box(from, to, 0, height), closed: true, fill: WALL_SEEN, own: true })
    for (const { node: opening } of wallOpenings(doc, wall, registry)) {
      const kind = registry.parametric.get(opening.kind)
      if (!kind) continue
      const props = registry.resolveProps(kind, opening.props)
      const span = openingSpan(opening, registry)
      if (!span || !span.some((p) => within(along(p)) && between(p, wall.thickness))) continue
      const own = kind.front?.(props)
      const [bottom, top] = heightsOf(kind, props, height)
      const [s0, s1] = span.map(along)
      faces.push(...shown(opening, 'opening', own ? placed(opening, own, 0) : [{ kind: 'path', points: box(Math.min(s0, s1), Math.max(s0, s1), bottom, top), closed: true }]))
    }
    for (const object of wallMounted(doc, wall, registry)) {
      // What stands on the floor against the face is drawn as what stands in front of it, below.
      const origin = applyTransform({ x: 0, y: 0 }, object)
      if (mountOf(object, registry)?.on !== 'wall' || mountedOn(doc, object, registry)?.face !== face || !within(along(origin)) || !between(origin)) continue
      const kind = registry.parametric.get(object.kind)
      const own = kind?.front?.(registry.resolveProps(kind, object.props))
      const half = PLATE / 2
      faces.push(...shown(object, 'fixed', placed(object, own ?? [{ kind: 'path', points: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }], closed: true }], heightAboveFloor(object, registry) ?? 0)))
    }
  }

  // The walls in front of the faces, unless the view leaves them out (`walls: false`), all plain
  // grey: those its line cuts, and those in the way of what it sees (any other wall within what it
  // sees, `seenArea`, as a wall at an angle across a room, which hides from it what is behind).
  // Each is drawn over the width it takes along the view and its height, among the other layers.
  // In a room of square corners, the walls at the corners are outside what it sees.
  // A wall cut through is drawn so where it is cut; only what of it runs on beyond that is in the
  // way (a wall at an angle), not the stretch behind its cut (a window cut through stays open).
  // Cut along the line, and past its ends as far as the walls its ends run into (the walls at the
  // corners of a room, for an elevation), only those touching its ends.
  const reach = CUT_REACH
  const start = { x: node.a.x - d.x * reach, y: node.a.y - d.y * reach }
  const cutAt = new Map<string, { taken: [number, number]; crossing: [number, number] }>()
  for (const wall of node.walls === false ? [] : walls) {
    if (along0.has(wall.id) || wall.bulge) continue
    const course = courseOf(wall)
    const sides = wallSides(wall)
    const outline = [course.offset(0, -sides.left), course.offset(course.length, -sides.left), course.offset(course.length, sides.right), course.offset(0, sides.right)]
    const crossing = clipLine(start, d, length + 2 * reach, outline)
    if (!crossing) continue
    const taken: [number, number] = [crossing[0] - reach, crossing[1] - reach]
    if (taken[1] < -ON_FACE || taken[0] > length + ON_FACE) continue
    cutAt.set(wall.id, { taken, crossing })
  }
  const area = seenArea(node)
  const inWay: WayPiece[] = []
  for (const wall of node.walls === false ? [] : walls) {
    if (seen.has(wall.id) || wall.bulge) continue
    const inside = clipConvex(wallOutline(wall, doc), area)
    if (inside.length < 3) continue
    const ss = inside.map(along)
    const from = Math.max(0, Math.min(...ss))
    const to = Math.min(length, Math.max(...ss))
    const cutThere = cutAt.get(wall.id)?.taken
    const pieces: [number, number][] = cutThere ? [[from, Math.min(to, cutThere[0])], [Math.max(from, cutThere[1]), to]] : [[from, to]]
    for (const [s0, s1] of pieces) if (s1 - s0 >= 1) inWay.push({ wall, from: s0, to: s1, depth: depthOn(inside), height: heightOf(doc, wall) })
  }
  // Where each is cut, the full height it stands, on the line; but where the cut goes through a
  // door or a window, only above and below it, a layer of its own for each.
  let [left, right] = [0, length]
  for (const wall of walls) {
    const found = cutAt.get(wall.id)
    if (!found) continue
    const { taken, crossing } = found
    const course = courseOf(wall)
    left = Math.min(left, taken[0])
    right = Math.max(right, taken[1])
    const height = heightOf(doc, wall)
    // Where along the wall it is cut, and what opening is there.
    const middle = { x: start.x + d.x * ((crossing[0] + crossing[1]) / 2), y: start.y + d.y * ((crossing[0] + crossing[1]) / 2) }
    const t = course.project(middle).along
    const through = wallOpenings(doc, wall, registry).find(({ from, to }) => t > from && t < to)
    const kind = through && registry.parametric.get(through.node.kind)
    if (!kind) {
      inWay.push({ wall, from: taken[0], to: taken[1], depth: () => 0, height })
      continue
    }
    const [bottom, top] = heightsOf(kind, registry.resolveProps(kind, through!.node.props), height)
    for (const [h0, h1] of ([[0, bottom], [top, height]] as [number, number][]).filter(([h0, h1]) => h1 - h0 > 1)) {
      layers.push({ from: taken[0], to: taken[1], depth: () => 0, prims: [{ kind: 'path', points: box(taken[0], taken[1], h0, h1), closed: true, fill: WALL_GREY, own: true }] })
    }
  }
  // Walls joined to one another are one mass: where they are both in front of the faces, cut or in
  // the way, side by side or one in front of the other, they are drawn as one, with no line where they meet.
  for (const run of joinedRuns(inWay)) {
    layers.push({ from: run.from, to: run.to, depth: run.depth, prims: [{ kind: 'path', points: box(run.from, run.to, 0, run.height), closed: true, fill: WALL_GREY, own: true }] })
  }

  // What stands on the floor in view, beyond its line (or across it) up to its depth: furniture,
  // appliances, as boxes of the width they take along the view and as tall as they say. Only
  // outlined, so that nothing fixed on a face behind is hidden; a wall in front of one hides it.
  for (const leaf of drawnBy ? everythingIn(doc, rootOf(doc, node.parent)?.id ?? '') : []) {
    if (leaf.type !== 'instance' && leaf.type !== 'parametric') continue
    if (leaf.type === 'parametric' && (mountOf(leaf, registry)?.on === 'wall' || openingSpan(leaf, registry))) continue
    let tall: number | undefined
    if (leaf.type === 'parametric') {
      const kind = registry.parametric.get(leaf.kind)
      tall = kind?.height?.(registry.resolveProps(kind, leaf.props))
    } else {
      const component = doc.nodes[leaf.component]
      tall = component?.type === 'component' && component.height ? component.height * (leaf.scale ?? 1) : undefined
    }
    if (!tall || !(tall > 0)) continue
    const points = drawnBy!(leaf, doc, registry).flatMap(outlineOf)
    if (points.length === 0) continue
    const offs = points.map(off)
    const [nearest, furthest] = [Math.max(...offs), Math.min(...offs)]
    if (nearest < -deep - ON_FACE || furthest > ON_FACE) continue
    const ss = points.map(along)
    const from = Math.max(0, Math.min(...ss))
    const to = Math.min(length, Math.max(...ss))
    if (to - from < 1) continue
    layers.push({ from, to, depth: depthOn(seenOf(points)), prims: shown(leaf, 'standing', [{ kind: 'path', points: box(from, to, 0, tall), closed: true, strokeWidth: STANDING_WEIGHT, own: true }]) })
  }

  // What is made to be fixed on a wall but stands in view on no face the view draws (a wall cabinet
  // put out in the room, a socket on a wall the view does not look at): drawn too, by its front at
  // its height, as what stands is.
  const onFaces = new Set(items.filter((item) => item.role === 'fixed').map((item) => item.node.id))
  for (const leaf of drawnBy ? everythingIn(doc, rootOf(doc, node.parent)?.id ?? '') : []) {
    if (leaf.type !== 'parametric' || onFaces.has(leaf.id) || mountOf(leaf, registry)?.on !== 'wall') continue
    const points = drawnBy!(leaf, doc, registry).flatMap(outlineOf)
    if (points.length === 0) continue
    const offs = points.map(off)
    const [nearest, furthest] = [Math.max(...offs), Math.min(...offs)]
    if (nearest < -deep - ON_FACE || furthest > ON_FACE) continue
    const ss = points.map(along)
    if (Math.max(...ss) < 0 || Math.min(...ss) > length) continue
    const kind = registry.parametric.get(leaf.kind)
    const own = kind?.front?.(registry.resolveProps(kind, leaf.props))
    const half = PLATE / 2
    const prims = shown(leaf, 'fixed', placed(leaf, own ?? [{ kind: 'path', points: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }], closed: true }], heightAboveFloor(leaf, registry) ?? 0))
    layers.push({ from: Math.max(0, Math.min(...ss)), to: Math.min(length, Math.max(...ss)), depth: depthOn(seenOf(points)), prims })
  }

  const floor: Primitive = { kind: 'path', points: [at(left, 0), at(right, 0)], strokeWidth: FLOOR_WEIGHT }
  // Where each thing fixed on the face is: a chain along the floor from the start of the view, and
  // its height above the floor beside it. What a person setting them out on site measures.
  const dimensions: Primitive[] = []
  // What is painted after an item and filled hides it; one all hidden is not dimensioned.
  const ordered = paintOrder(layers)
  const layerOf = new Map<Primitive, number>(ordered.flatMap((layer, i) => layer.prims.map((p) => [p, i] as [Primitive, number])))
  const covering = ordered.map((layer) => layer.prims.flatMap((p) => (p.kind === 'path' && p.closed && p.fill !== undefined && p.fill !== 'none' ? [primitiveBounds(p)!] : [])))
  for (const item of items) {
    const at = layerOf.get(drawnFirst.get(item)!)
    if (at !== undefined) item.hidden = covers(covering.slice(at + 1).flat(), item.box)
  }
  const placedItems = items.filter((item) => item.role === 'fixed' && !item.hidden)
  if (node.dimensions !== false && placedItems.length > 0) {
    const stops = [0, ...placedItems.map((item) => along(applyTransform({ x: 0, y: 0 }, item.node))), length].map((s) => Math.round(s)).sort((p, q) => p - q)
    const chain = stops.filter((s, i) => i === 0 || s - stops[i - 1] >= 1)
    for (let i = 1; i < chain.length; i++) dimensions.push(...measure(at(chain[i - 1], 0), at(chain[i], 0), CHAIN_BELOW))
    for (const item of placedItems) {
      const h = heightAboveFloor(item.node, registry) ?? 0
      if (h < 1) continue
      const x = item.box.maxX + HEIGHT_BESIDE
      dimensions.push(...measure({ x, y: node.y }, { x, y: node.y - h }, 0))
    }
  }
  // Its name is not written: as for anything else, it names it in the Structure list. A title under
  // it is a text of its own, written where and as the person wants.
  return { prims: [...ordered.flatMap((layer) => layer.prims), floor, ...dimensions], items }
}

/** The object of the plan an elevation shows at `p` (within `margin` of its box), what is fixed on the face before the doors and windows. */
export function elevationItemAt(node: Elevation, doc: Document, registry: Registry, p: Vec2, margin = 0): ElevationItem | null {
  // What a wall in front hides all of is not there to be taken.
  const items = layout(node, doc, registry).items.filter((item) => !item.hidden)
  const inside = (item: ElevationItem) => p.x >= item.box.minX - margin && p.x <= item.box.maxX + margin && p.y >= item.box.minY - margin && p.y <= item.box.maxY + margin
  return items.find((item) => item.role === 'fixed' && inside(item)) ?? items.find(inside) ?? null
}

/** Where the elevations of the drawing show the objects of `ids`: each elevation, and the box of each object in it. */
export function shownInElevations(doc: Document, registry: Registry, ids: string[]): { view: Elevation; box: Bounds }[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  return Object.values(doc.nodes).flatMap((view) => (view.type === 'elevation' ? layout(view, doc, registry).items.filter((item) => wanted.has(item.node.id)).map((item) => ({ view, box: item.box })) : []))
}

/**
 * What dragging an object shown in an elevation by `ds` mm across the view and `dh` mm up does to it
 * on the plan, as a patch: what is fixed on the face slides along it, staying on the wall, and
 * goes up or down, never below the floor; a door or window slides along its wall, and a window
 * (whose kind says its sill) goes up or down by its sill height; what stands in front of the face
 * moves across the view, as what is made to be fixed on a wall but is on none does, up and down
 * too. Null when the view has no line, or one of no length.
 */
export function elevationMovePatch(view: Elevation, doc: Document, registry: Registry, object: ElevationItem['node'], ds: number, dh: number): Record<string, unknown> | null {
  const node = lineOf(doc, view)
  if (!node) return null
  const length = dist(node.a, node.b)
  if (length < 1e-6) return null
  const d = norm(sub(node.b, node.a))
  const mount = mountOf(object, registry)
  if (mount?.on === 'wall' && object.type === 'parametric') {
    const on = mountedOn(doc, object, registry)
    // On no wall: across the view, and up or down.
    if (!on) return { x: tidy(object.x + d.x * ds), y: tidy(object.y + d.y * ds), z: Math.max(0, tidy((heightAboveFloor(object, registry) ?? 0) + dh)) }
    const course = courseOf(on.wall)
    const way = dot(course.dir(on.along), d) >= 0 ? 1 : -1
    const [from, to] = on.wall.bulge ? [0, course.length] : faceStretch(doc, on.wall, on.face)
    const along = Math.max(from, Math.min(to, on.along + way * ds))
    const z = Math.max(0, tidy((heightAboveFloor(object, registry) ?? 0) + dh))
    return { ...mountAt(object, mount, on.wall, on.face, along), z }
  }
  const moved = { x: tidy(object.x + d.x * ds), y: tidy(object.y + d.y * ds) }
  if (object.type !== 'parametric' || dh === 0) return moved
  const kind = registry.parametric.get(object.kind)
  const sill = kind?.sill
  if (!kind || !sill) return moved
  return { ...moved, props: { ...object.props, [sill]: Math.max(0, tidy(Number(registry.resolveProps(kind, object.props)[sill]) + dh)) } }
}

/** The faces of walls that a line lies on (the far side of an elevation), each with where it ends as drawn (`faceStretch`), along its wall and as points. */
function carriers(doc: Document, node: Pick<ViewLine, 'a' | 'b' | 'parent'>): { wall: Wall; face: Face; stretch: [number, number]; ends: [Vec2, Vec2] }[] {
  return wallsIn(doc, node.parent).flatMap((wall) => {
    const face = faceUnder(wall, node.a, node.b)
    if (!face) return []
    const course = courseOf(wall)
    const across = faceAcross(wall, face)
    const stretch = faceStretch(doc, wall, face)
    return [{ wall, face, stretch, ends: [course.offset(stretch[0], across), course.offset(stretch[1], across)] as [Vec2, Vec2] }]
  })
}

/**
 * The operations that keep the lines of elevations on the faces they look at when an edit changed the walls of
 * those faces (`applyEdit`), as `mountFollowOps` does for what is fixed on them: their far side is
 * put back on the face, and their line kept their depth in front of it. Each end of the far side is
 * seen to alone. One that was at an end of the face as drawn (a corner of the room) stays
 * at an end of a face: where a face still ends there (the wall turned round, or cut in two there)
 * it is left, else it goes to that end of the face, so that the view of a whole face stays of the
 * whole face as the wall gets longer or shorter. One that was along the wall is left while it is still on a face, else keeps its place
 * along the wall as a door does (`followAlong`). Both go on the same face, wherever it now is. Left
 * alone: a line the edit changed itself, and one on a wall that is curved or was taken away.
 */
export function elevationFollowOps(before: Document, after: Document, changed: Iterable<string>): Op[] {
  const walls = new Map<string, { old: Wall; now: Wall }>()
  for (const id of changed) {
    const old = before.nodes[id]
    const now = after.nodes[id]
    if (old?.type === 'wall' && now?.type === 'wall' && old !== now && !old.bulge && !now.bulge) walls.set(id, { old, now })
  }
  if (walls.size === 0) return []
  const ops: Op[] = []
  const roots = new Set([...walls.values()].map(({ old }) => rootOf(before, old.parent)?.id).filter((id): id is string => !!id))
  for (const root of roots) {
    for (const node of leavesOf(before, root)) {
      if (node.type !== 'viewline' || after.nodes[node.id] !== node) continue
      const [farA, farB] = farSide(node)
      const far = { a: farA, b: farB, parent: node.parent }
      const on = carriers(before, far).find((carrier) => walls.has(carrier.wall.id))
      if (!on) continue
      const { old, now } = walls.get(on.wall.id)!
      const [was, is] = [courseOf(old), courseOf(now)]
      const across = faceAcross(now, on.face)
      const still = carriers(after, far)
      const stretch = faceStretch(after, now, on.face)
      const d = norm(sub(far.b, far.a))
      const follow = (p: Vec2): Vec2 => {
        const s = was.project(p).along
        const atEnd = Math.abs(s - on.stretch[0]) <= ON_FACE ? stretch[0] : Math.abs(s - on.stretch[1]) <= ON_FACE ? stretch[1] : null
        if (atEnd !== null ? still.some(({ ends }) => ends.some((end) => dist(end, p) <= ON_FACE)) : still.some(({ ends }) => (dot(sub(p, ends[0]), d) + ON_FACE) * (dot(sub(p, ends[1]), d) - ON_FACE) <= 0)) return p
        const q = is.offset(atEnd ?? followAlong(old, now, s, 0), across)
        return { x: tidy(q.x), y: tidy(q.y) }
      }
      const [a, b] = [follow(far.a), follow(far.b)]
      if (a === far.a && b === far.b) continue
      // The line back in front of the face, as far as it was.
      const line = viewOfFace({ a, b }, depthOf(node))
      ops.push({ op: 'update_node', id: node.id, patch: { a: line.a, b: line.b } })
    }
  }
  return ops
}
