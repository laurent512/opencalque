import { isVisible, leavesOf, rootOf } from './document'
import { applyTransform, dist, norm, perp, sub, unionBounds, type Bounds, type Vec2 } from './geometry'
import type { Op } from './ops'
import { primitiveBounds, transformPrimitive, type Primitive } from './primitives'
import type { ParametricKind, Registry } from './registry'
import { leavesOf as everythingIn } from './document'
import type { Document, Node, NodeOf } from './schema'
import { courseOf, cross, distToBody, dot, middleAcross, tidy, wallSides, type Wall } from './walls/course'
import { followAlong } from './walls/follow'
import { DEFAULT_WALL_HEIGHT, faceAcross, faceStretch, heightAboveFloor, heightInPlace, heightOf, mountAt, mountedOn, mountOf, propsInPlace, wallMounted } from './walls/mount'
import { openingSpan, wallOpenings } from './walls/openings'
import { wallOutline } from './walls/outline'
import { wallsIn } from './walls/spatial'

/*
 * Views of the plan (ARCHITECTURE §4, "Elevations and sections"), worked out from the plan each time
 * they are drawn, as a room's floor is: nothing of a view is stored but its line, its depth and
 * where it is drawn. There is one drawing, never two kept in step. A view (an `elevation` node)
 * holds its line (ARCHITECTURE §10, "Views"), which says what is seen: a cut along it, seen from the
 * right of it (as it runs from `a` to `b`), looking at what lies beyond it up to its depth: what
 * crosses the line is cut, what is beyond it seen; and it is drawn at its `x`, `y`, on its page or
 * on another (`page` is then the page it looks at). An elevation is a view whose far side lies on
 * the face of a wall: it is tied to that wall only by that, and follows it as doors do.
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

export { DEFAULT_WALL_HEIGHT, heightOf }
/** How far a wall may be turned from the line of a view, as a sine (30°), and be a face it looks at, at a slant; turned further, it is at the side. */
const FACE_TURN = 0.5
/** How far, in mm, the line may be off a face, and still be on it. */
const ON_FACE = 1
/** How far above and below the floor the clip at the ends of a view reaches, in mm: past anything drawn. */
const VIEW_HEIGHT = 1e6
/** The square what is fixed on a wall is drawn as when its kind gives no front, in mm. */
const PLATE = 80
/** What stands in front of the face, lighter than the face and what is on it. */
const STANDING_WEIGHT = 0.6
const FLOOR_WEIGHT = 2

export type Elevation = NodeOf<'elevation'>
/** What a view sees, and from where: its line, its depth, and the page or component whose plan it looks at (`parent`). */
export interface ViewLine {
  a: Vec2
  b: Vec2
  depth?: number
  parent: string | null
}
type Face = 'left' | 'right'
/** What a line sees, and from where. */
type Sight = Pick<ViewLine, 'a' | 'b' | 'depth'>

/** The page a view looks at: the one it says (`page`) while the drawing has it, else the page or component it is on. */
export function lookedAt(doc: Document, view: Pick<Elevation, 'page' | 'parent'>): string | null {
  if (view.page && doc.nodes[view.page]?.type === 'page') return view.page
  return rootOf(doc, view.parent)?.id ?? view.parent
}

/** What a view sees, and from where: its own line, on the plan it looks at. */
export function lineOf(doc: Document, view: Pick<Elevation, 'a' | 'b' | 'depth' | 'page' | 'parent'>): ViewLine {
  return { a: view.a, b: view.b, depth: view.depth, parent: lookedAt(doc, view) }
}

/** The views (elevations, viewpoints) that look at a page from another, by that page: kept with each state of the drawing. */
const lookers = new WeakMap<Document['nodes'], Map<string, Node[]>>()

/**
 * The views shown on another page that look at the plan of `pageId` (`page`): the plan draws their
 * marks, to place them, and a click there selects them (`buildScene`).
 */
export function viewsLookingAt(doc: Document, pageId: string): Node[] {
  let index = lookers.get(doc.nodes)
  if (!index) {
    index = new Map()
    for (const node of Object.values(doc.nodes)) {
      if ((node.type !== 'elevation' && node.type !== 'camera') || !node.page || node.page === rootOf(doc, node.parent)?.id) continue
      index.set(node.page, [...(index.get(node.page) ?? []), node])
    }
    lookers.set(doc.nodes, index)
  }
  return index.get(pageId) ?? []
}

/** Whether a view's line is on the page or component it is drawn on, where its line is shown and dragged. */
export const lineHere = (doc: Document, view: Pick<Elevation, 'page' | 'parent'>): boolean => lookedAt(doc, view) === (rootOf(doc, view.parent)?.id ?? view.parent)

/**
 * When a patch moves the start of a view's line, the view moved across by as much as its start
 * went along the line, so that what it still shows stays where it was on the sheet: a view made
 * shorter at its start by dragging its line keeps its end where it was. Only for the editor's drags
 * of a line by its ends and corners; a line moved whole, with the plan, leaves the view where it is.
 */
export function keptViewPatch(view: Pick<Elevation, 'a' | 'b' | 'x' | 'scale'>, patch: Record<string, unknown>): Record<string, unknown> {
  const a = patch.a as Vec2 | undefined
  if (!a || dist(view.a, view.b) < 1e-6) return patch
  const shift = dot(sub(a, view.a), norm(sub(view.b, view.a))) * viewScale(view)
  if (Math.abs(shift) < 1e-9) return patch
  return { ...patch, x: tidy(view.x + shift) }
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

/**
 * The patch that gives a view another depth (undefined: the default). An elevation, whose far side
 * is on the face of a wall (`elevationWall`), keeps its far side there: its line moves, nearer the
 * face or further from it. A section keeps its line, where it cuts, and sees nearer or further.
 */
export function depthPatch(doc: Document, view: Elevation, depth: number | undefined): Record<string, unknown> {
  const line = lineOf(doc, view)
  const next = depth === undefined ? undefined : Math.max(0, depth)
  const stored = { depth: next ?? null }
  if (dist(line.a, line.b) < 1e-6 || !elevationWall(doc, line)) return stored
  const shift = (next ?? DEFAULT_DEPTH) - depthOf(line)
  const n = viewer(line.a, line.b)
  const moved = (p: Vec2) => ({ x: tidy(p.x + n.x * shift), y: tidy(p.y + n.y * shift) })
  return { ...stored, a: moved(line.a), b: moved(line.b) }
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
export function heightsOf(kind: ParametricKind, props: Record<string, any>, wall: number): [number, number] {
  const bottom = kind.sill ? Math.max(0, Number(props[kind.sill]) || 0) : 0
  const tall = typeof props.height === 'number' && props.height > 0 ? props.height : wall - bottom
  return [Math.min(bottom, wall), Math.min(bottom + tall, wall)]
}


/**
 * The points a primitive is drawn through, in the drawing: a path's own, round an ellipse every
 * fifteen degrees. Not the box around it, upright on the page, which is wider than an object turned
 * at an angle: two kitchen units side by side along a slanted wall would be drawn over each other.
 */
export function outlineOf(p: Primitive): Vec2[] {
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
export function elevationPrimitives(node: Elevation, doc: Document, registry: Registry): Primitive[] {
  return layout(node, doc, registry).prims
}

/** Draws a dimension from `a` to `b`, its line `offset` mm to the right of the way from `a` to `b` (as a dimension node does). */
export type Measure = (a: Vec2, b: Vec2, offset: number) => Primitive[]

/** How far below the floor the dimensions along it stand, in mm. */
const CHAIN_BELOW = 300
/** How far right of what it measures the height of an object fixed on the face is written, in mm. */
const HEIGHT_BESIDE = 60
/** How far left of a view the height of the face it looks at is written, in mm. */
const FACE_HEIGHT_BESIDE = 300

/** An object of the plan as an elevation shows it: a door or window, what is fixed on the face, or what stands in front of it, and the box it is drawn in. */
export interface ElevationItem {
  node: NodeOf<'parametric'> | NodeOf<'instance'>
  role: 'opening' | 'fixed' | 'standing'
  box: Bounds
  /** Whether it goes up and down when dragged: anything but a door or window, and a window whose kind says its sill. */
  raises: boolean
  /** Whether what is drawn in front of it hides all of it: it is then neither dimensioned nor taken by a click in the view. */
  hidden?: boolean
  /**
   * The Y in the drawing of the level lines drawn across it, inside its box (`levelsOf`): under a
   * door, the edges of an oven or a fridge, between two drawers. What is dragged lines up with them.
   */
  levels: number[]
}

/** How much of the width of an object a level line drawn in it must take to be one to line up with: not a handle, a knob or the curve of a corner. */
const LEVEL_SHARE = 0.3

/**
 * The Y of the level lines that `prims` draw across `box`, inside it (not its top and bottom), each
 * once: the straight stretches of paths within half a millimetre of level that take at least
 * `LEVEL_SHARE` of its width.
 */
export function levelsOf(prims: Primitive[], box: Bounds): number[] {
  const least = Math.max(1, (box.maxX - box.minX) * LEVEL_SHARE)
  const found: number[] = []
  for (const p of prims) {
    if (p.kind !== 'path') continue
    const n = p.points.length
    for (let i = 0; i < (p.closed ? n : n - 1); i++) {
      const [a, b] = [p.points[i], p.points[(i + 1) % n]]
      if (Math.abs(a.y - b.y) > 0.5 || Math.abs(a.x - b.x) < least) continue
      const y = (a.y + b.y) / 2
      if (y - box.minY < 1 || box.maxY - y < 1 || found.some((f) => Math.abs(f - y) < 0.5)) continue
      found.push(y)
    }
  }
  return found.sort((a, b) => b - a)
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
export function convexHull(points: Vec2[]): Vec2[] {
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

/** Seen from in front, the side or behind: as the way an object faces (`facing`) turns from the way to the viewer (`viewer`), by less than 45°, more than 135°, or in between. */
export function seenFrom(facing: Vec2, viewer: Vec2): 'front' | 'side' | 'back' {
  const length = Math.hypot(facing.x, facing.y)
  const c = length < 1e-9 ? 1 : dot(facing, viewer) / length
  return c >= Math.SQRT1_2 - 1e-9 ? 'front' : c <= -Math.SQRT1_2 + 1e-9 ? 'back' : 'side'
}

/** What stands on the floor is drawn lighter than the walls: its kind's lines given no weight of their own. */
const standingWeight = (p: Primitive): Primitive => ((p.kind === 'path' || p.kind === 'ellipse') && p.strokeWidth === undefined ? { ...p, strokeWidth: STANDING_WEIGHT } : p)

/**
 * Whether the plan shows `node`: it, its layer and every group it is in shown. What the plan does
 * not show, its views do not draw either: an object, a door, a wall hidden, or on a hidden layer.
 */
export function shownOnPlan(doc: Document, node: Node): boolean {
  for (let at: Node | undefined = node, depth = 0; at && at.type !== 'page' && depth < 64; at = at.parent ? doc.nodes[at.parent] : undefined, depth++) {
    if (!isVisible(doc, at)) return false
  }
  return true
}

/** How much larger than the plan a view is drawn (`scale`), within what is sensible. */
export const viewScale = (view: Pick<Elevation, 'scale'>): number => Math.min(20, Math.max(0.05, view.scale ?? 1))

/**
 * Where a view puts what it holds (its dimensions, its notes): at its (x, y), as large as it is
 * drawn. What it holds is in its own coordinates: along its line from its start, up from its floor
 * (Y negative), in mm of the plan, so that a dimension says the real length.
 */
export const viewPlacement = (view: Pick<Elevation, 'x' | 'y' | 'scale'>) => ({ x: view.x, y: view.y, scale: viewScale(view) })

/** What a view draws, laid out in its own coordinates: as large as the plan, from its origin. */
interface Laid {
  prims: Primitive[]
  items: ElevationItem[]
  /** The faces seen, white, as boxes: as high as the highest, the face's height. */
  faces: Bounds[]
  /** How long its line is. */
  length: number
}

/** Each view's layout in its own coordinates, kept with each state of the drawing: its drawing and its automatic dimensions both read it. */
const laidOut = new WeakMap<Document['nodes'], WeakMap<Elevation, Laid>>()
function laid(view: Elevation, doc: Document, registry: Registry): Laid {
  let views = laidOut.get(doc.nodes)
  if (!views) laidOut.set(doc.nodes, (views = new WeakMap()))
  let found = views.get(view)
  if (!found) views.set(view, (found = layoutAtPlanScale({ ...view, x: 0, y: 0 }, doc, registry)))
  return found
}

/**
 * What an elevation draws, and where in it each object of the plan is, at its place and scale:
 * laid out in its own coordinates (`laid`), then put at its (x, y) and made larger or smaller, what
 * it draws and the boxes of what it shows alike, so that what works with them in the drawing
 * (picking, dragging, lining up) needs no more than to turn a distance dragged back into one of the
 * plan (`viewScale`). Its dimensions are what it holds (`autoDimensionPrimitives`), drawn as it is.
 */
function layout(view: Elevation, doc: Document, registry: Registry): { prims: Primitive[]; items: ElevationItem[] } {
  const drawn = laid(view, doc, registry)
  const s = viewScale(view)
  const placing = viewPlacement(view)
  const y = (v: number) => view.y + v * s
  const x = (v: number) => view.x + v * s
  return {
    prims: drawn.prims.map((p) => transformPrimitive(p, placing)),
    items: drawn.items.map((item) => ({ ...item, box: { minX: x(item.box.minX), maxX: x(item.box.maxX), minY: y(item.box.minY), maxY: y(item.box.maxY) }, levels: item.levels.map(y) })),
  }
}

/** What an elevation draws, as large as the plan, and where in it each object of the plan is. */
function layoutAtPlanScale(view: Elevation, doc: Document, registry: Registry): Laid {
  const line = lineOf(doc, view)
  if (!line) return { prims: [], items: [], faces: [], length: 0 }
  // What it sees from its line, drawn where it is.
  const node = { ...line, x: view.x, y: view.y, walls: view.walls }
  const length = dist(node.a, node.b)
  if (length < 1e-6) return { prims: [], items: [], faces: [], length }
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
  /**
   * What a kind draws of an object as the view sees it, put at `h` above the floor: its front, its
   * side or its back, as the way it faces (its own +Y, -Y for one that stands out of its wall the
   * other way) turns from the viewer by less than 45°, by more than 135°, or in between (`seenFrom`).
   * Null when its kind draws nothing for that, for the caller to draw something else.
   */
  const seenAs = (object: NodeOf<'parametric'>, props: Record<string, any>, h: number): Primitive[] | null => {
    const kind = registry.parametric.get(object.kind)
    if (!kind) return null
    const origin = applyTransform({ x: 0, y: 0 }, object)
    const ownX = sub(applyTransform({ x: 1, y: 0 }, object), origin)
    const ownY = sub(applyTransform({ x: 0, y: 1 }, object), origin)
    const facing = mountOf(object, registry)?.out === 'up' ? { x: -ownY.x, y: -ownY.y } : ownY
    const from = seenFrom(facing, front)
    const shapes = from === 'front' ? kind.front?.(props) : from === 'side' ? kind.side?.(props) : kind.back?.(props)
    if (!shapes) return null
    // A side is drawn along the way it faces, from its own Y = 0; a front or a back along its own X.
    const mirrored = dot(from === 'side' ? facing : ownX, d) < 0
    return shapes.map((p) => transformPrimitive(p, { x: node.x + along(origin), y: node.y - h, flipX: mirrored }))
  }

  const items: ElevationItem[] = []
  // The first thing each item draws, to know in which layer it is painted.
  const drawnFirst = new Map<ElevationItem, Primitive>()
  const shown = (object: ElevationItem['node'], role: ElevationItem['role'], prims: Primitive[]) => {
    const box = prims.map(primitiveBounds).reduce<Bounds | null>((all, one) => (one ? (all ? unionBounds(all, one) : one) : all), null)
    const kind = object.type === 'parametric' ? registry.parametric.get(object.kind) : undefined
    if (box) {
      const item: ElevationItem = { node: object, role, box, raises: role !== 'opening' || !!kind?.sill, levels: levelsOf(prims, box) }
      items.push(item)
      if (prims[0]) drawnFirst.set(item, prims[0])
    }
    return prims
  }
  const deep = depthOf(node)
  const front = viewer(node.a, node.b)
  const off = (p: Vec2) => dot(sub(p, node.a), front)
  const walls = wallsIn(doc, node.parent).filter((wall) => shownOnPlan(doc, wall))

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
      if (!shownOnPlan(doc, opening)) continue
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
      if (!shownOnPlan(doc, object)) continue
      // What stands on the floor against the face is drawn as what stands in front of it, below.
      const origin = applyTransform({ x: 0, y: 0 }, object)
      if (mountOf(object, registry)?.on !== 'wall' || mountedOn(doc, object, registry)?.face !== face || !within(along(origin)) || !between(origin)) continue
      const kind = registry.parametric.get(object.kind)
      const own = kind?.front?.(propsInPlace(doc, object, registry))
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
  // Cut along the line only, between its ends: nothing is drawn past them, so a wall an end stops
  // against is not drawn, and one it goes into is drawn as far as it goes (the owner's choice).
  const cutAt = new Map<string, { taken: [number, number] }>()
  for (const wall of node.walls === false ? [] : walls) {
    if (along0.has(wall.id) || wall.bulge) continue
    const course = courseOf(wall)
    const sides = wallSides(wall)
    const outline = [course.offset(0, -sides.left), course.offset(course.length, -sides.left), course.offset(course.length, sides.right), course.offset(0, sides.right)]
    const taken = clipLine(node.a, d, length, outline)
    if (taken) cutAt.set(wall.id, { taken })
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
  for (const wall of walls) {
    const found = cutAt.get(wall.id)
    if (!found) continue
    const { taken } = found
    const course = courseOf(wall)
    const height = heightOf(doc, wall)
    // Where along the wall it is cut, and what opening is there.
    const middle = { x: node.a.x + d.x * ((taken[0] + taken[1]) / 2), y: node.a.y + d.y * ((taken[0] + taken[1]) / 2) }
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
    if ((leaf.type !== 'instance' && leaf.type !== 'parametric') || !shownOnPlan(doc, leaf)) continue
    if (leaf.type === 'parametric' && (mountOf(leaf, registry)?.on === 'wall' || openingSpan(leaf, registry))) continue
    let tall: number | undefined
    let looks: Primitive[] | null = null
    // On the floor, unless it is raised: its underside that high.
    const raised = heightAboveFloor(leaf, registry) ?? 0
    if (leaf.type === 'parametric') {
      const kind = registry.parametric.get(leaf.kind)
      const props = kind ? propsInPlace(doc, leaf, registry) : {}
      tall = kind?.height?.(props)
      // Drawn as its kind draws it from where it is seen, lighter than the walls; else as its box.
      looks = kind ? seenAs(leaf, props, raised) : null
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
    const drawn = looks ? looks.map(standingWeight) : [{ kind: 'path', points: box(from, to, raised, raised + tall), closed: true, strokeWidth: STANDING_WEIGHT, own: true } as Primitive]
    layers.push({ from, to, depth: depthOn(seenOf(points)), prims: shown(leaf, 'standing', drawn) })
  }

  // What is made to be fixed on a wall but stands in view on no face the view draws (a wall cabinet
  // put out in the room, a socket on a wall the view does not look at): drawn too, by its front at
  // its height, as what stands is.
  const onFaces = new Set(items.filter((item) => item.role === 'fixed').map((item) => item.node.id))
  for (const leaf of drawnBy ? everythingIn(doc, rootOf(doc, node.parent)?.id ?? '') : []) {
    if (leaf.type !== 'parametric' || onFaces.has(leaf.id) || mountOf(leaf, registry)?.on !== 'wall' || !shownOnPlan(doc, leaf)) continue
    const points = drawnBy!(leaf, doc, registry).flatMap(outlineOf)
    if (points.length === 0) continue
    const offs = points.map(off)
    const [nearest, furthest] = [Math.max(...offs), Math.min(...offs)]
    if (nearest < -deep - ON_FACE || furthest > ON_FACE) continue
    const ss = points.map(along)
    if (Math.max(...ss) < 0 || Math.min(...ss) > length) continue
    const kind = registry.parametric.get(leaf.kind)
    const props = kind ? propsInPlace(doc, leaf, registry) : {}
    const own = kind?.front?.(props)
    const half = PLATE / 2
    const h = heightAboveFloor(leaf, registry) ?? 0
    // As it is seen: a wall cabinet on a wall at the side of the view by its side. A kind that draws
    // nothing from there is drawn by its front still, as before there were sides.
    const prims = shown(leaf, 'fixed', seenAs(leaf, props, h) ?? placed(leaf, own ?? [{ kind: 'path', points: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }], closed: true }], h))
    layers.push({ from: Math.max(0, Math.min(...ss)), to: Math.min(length, Math.max(...ss)), depth: depthOn(seenOf(points)), prims })
  }

  // Nothing is drawn past the ends of the line (the owner's choice): what crosses one, a window or
  // a cabinet partly in view, is clipped there, and can be taken only where it is drawn.
  const [x0, x1] = [node.x, node.x + length]
  const ends = box(0, length, -VIEW_HEIGHT, VIEW_HEIGHT)
  const clipped = (p: Primitive): Primitive => {
    const b = primitiveBounds(p)
    return b && (b.minX < x0 - ON_FACE || b.maxX > x1 + ON_FACE) ? { ...p, clip: [...(p.clip ?? []), ends] } : p
  }
  for (const item of items) item.box = { ...item.box, minX: Math.max(item.box.minX, x0), maxX: Math.min(item.box.maxX, x1) }
  const floor: Primitive = { kind: 'path', points: [at(0, 0), at(length, 0)], strokeWidth: FLOOR_WEIGHT }
  // What is painted after an item and filled hides it; one all hidden is neither dimensioned nor taken.
  const ordered = paintOrder(layers)
  const layerOf = new Map<Primitive, number>(ordered.flatMap((layer, i) => layer.prims.map((p) => [p, i] as [Primitive, number])))
  const covering = ordered.map((layer) => layer.prims.flatMap((p) => (p.kind === 'path' && p.closed && p.fill !== undefined && p.fill !== 'none' ? [primitiveBounds(p)!] : [])))
  for (const item of items) {
    const at = layerOf.get(drawnFirst.get(item)!)
    if (at !== undefined) item.hidden = covers(covering.slice(at + 1).flat(), item.box)
  }
  const faces = ordered.flatMap((layer) => layer.prims.flatMap((p) => (p.kind === 'path' && p.own && p.closed && p.fill === WALL_SEEN ? [primitiveBounds(p)!] : [])))
  // Its name is not written: as for anything else, it names it in the Structure list. A title under
  // it is a text of its own, written where and as the person wants.
  return { prims: [...ordered.flatMap((layer) => layer.prims.map(clipped)), floor], items, faces, length }
}

/** Which rows a view's automatic dimensions draw (`autodimensions`): each unless it says false. */
export interface DimensionRows {
  fixed?: boolean
  pieces?: boolean
  overall?: boolean
  heights?: boolean
}

/** Stops of a chain nearer than this, in mm, are one: the few millimetres between two units are no dimension. */
const NEAREST_STOPS = 15

/**
 * The dimensions a view draws by itself (`autodimensions`, what it holds), in its own coordinates:
 * along its line from its start, up from its floor (Y negative). Rows, from the floor down: what is
 * fixed on the face (a socket, a switch, a wall cabinet), from the start of the view to each
 * (`fixed`), with its height above the floor beside it (`heights`); the sides of the doors, the
 * windows and what stands in front, one after the other, a kitchen's units (`pieces`), with a door's
 * or a window's sill and top beside it (`heights`); the face from end to end, and its height at its
 * start (`overall`). What a person setting them out on site measures. Stops nearer than
 * `NEAREST_STOPS` are one; what is hidden is not dimensioned.
 */
export function autoDimensionPrimitives(view: Elevation, doc: Document, registry: Registry, measure: Measure, rows: DimensionRows = {}): Primitive[] {
  const { items, faces, length } = laid(view, doc, registry)
  const line = lineOf(doc, view)
  if (length < 1e-6) return []
  const d = norm(sub(line.b, line.a))
  const along = (p: Vec2) => dot(sub(p, line.a), d)
  const at = (s: number, h: number): Vec2 => ({ x: s, y: -h })
  const dimensions: Primitive[] = []
  const chainAt = (stops: number[], below: number) => {
    const sorted = [0, ...stops, length].map((s) => Math.round(Math.min(length, Math.max(0, s)))).sort((p, q) => p - q)
    const chain = sorted.filter((s, i) => i === 0 || s - sorted[i - 1] >= NEAREST_STOPS || s === length)
    // The end of the view is a stop of its own: one nearer it before it goes.
    const kept = chain.filter((s, i) => !(i > 0 && i < chain.length - 1 && length - s < NEAREST_STOPS))
    for (let i = 1; i < kept.length; i++) dimensions.push(...measure(at(kept[i - 1], 0), at(kept[i], 0), below))
  }
  const heightsAt = (x: number, heights: number[]) => {
    const ups = [0, ...heights.filter((h) => h >= 1).map((h) => Math.round(h))].sort((p, q) => p - q).filter((h, i, all) => i === 0 || h - all[i - 1] >= 1)
    for (let i = 1; i < ups.length; i++) dimensions.push(...measure({ x, y: -ups[i - 1] }, { x, y: -ups[i] }, 0))
  }
  const fixed = items.filter((item) => item.role === 'fixed' && !item.hidden)
  const pieces = items.filter((item) => (item.role === 'opening' || item.role === 'standing') && !item.hidden)
  let below = CHAIN_BELOW
  if (rows.fixed !== false && fixed.length > 0) {
    chainAt(fixed.map((item) => along(applyTransform({ x: 0, y: 0 }, item.node))), below)
    below += CHAIN_BELOW
  }
  if (rows.heights !== false) for (const item of fixed) heightsAt(item.box.maxX + HEIGHT_BESIDE, [heightAboveFloor(item.node, registry) ?? 0])
  if (rows.pieces !== false && pieces.length > 0) {
    chainAt(pieces.flatMap((item) => [item.box.minX, item.box.maxX]), below)
    below += CHAIN_BELOW
  }
  // A door's or a window's sill and top; not the underside of what stands on the floor, which is the few centimetres of its plinth.
  if (rows.heights !== false) for (const item of pieces) if (item.role === 'opening') heightsAt(item.box.maxX + HEIGHT_BESIDE, [-item.box.maxY, -item.box.minY])
  if (rows.overall !== false && (faces.length > 0 || pieces.length > 0 || fixed.length > 0)) {
    chainAt([], below)
    const top = faces.reduce((most, face) => Math.max(most, -face.minY), 0)
    if (top >= 1) heightsAt(-FACE_HEIGHT_BESIDE, [top])
  }
  return dimensions
}

/** The object of the plan an elevation shows at `p` (within `margin` of its box), what is fixed on the face before the doors and windows. */
export function elevationItemAt(node: Elevation, doc: Document, registry: Registry, p: Vec2, margin = 0): ElevationItem | null {
  // What a wall in front hides all of is not there to be taken.
  const items = layout(node, doc, registry).items.filter((item) => !item.hidden)
  const inside = (item: ElevationItem) => p.x >= item.box.minX - margin && p.x <= item.box.maxX + margin && p.y >= item.box.minY - margin && p.y <= item.box.maxY + margin
  return items.find((item) => item.role === 'fixed' && inside(item)) ?? items.find(inside) ?? null
}

/** Every elevation of the drawing that shows the object `id`, not all hidden there, with how it shows it. */
/** Whether a view shows any of `ids` (not hidden behind what is in front): read from its layout, kept for each state of the drawing. */
export function viewShows(view: Elevation, doc: Document, registry: Registry, ids: ReadonlySet<string>): boolean {
  return ids.size > 0 && laid(view, doc, registry).items.some((item) => !item.hidden && ids.has(item.node.id))
}

export function elevationItemsOf(doc: Document, registry: Registry, id: string): { view: Elevation; item: ElevationItem }[] {
  return Object.values(doc.nodes).flatMap((view) => (view.type === 'elevation' ? layout(view, doc, registry).items.filter((item) => item.node.id === id && !item.hidden).map((item) => ({ view, item })) : []))
}

/**
 * What something dragged in an elevation lines up with, in the drawing: the sides (`xs`), the tops
 * and bottoms (`ys`) and the middles across (`middles`) of everything else it shows of the plan, with
 * the level lines drawn across them (`levels`: under a door, the edges of an oven or a fridge, so that
 * the fronts of units side by side are made as high), the sides and tops of the walls it draws,
 * its floor and its two ends. `except` is the object dragged.
 */
export function elevationEdges(view: Elevation, doc: Document, registry: Registry, except: string): { xs: number[]; ys: number[]; middles: number[] } {
  const { prims, items } = layout(view, doc, registry)
  const others = items.filter((item) => !item.hidden && item.node.id !== except)
  const walls = prims.flatMap((p) => (p.kind === 'path' && p.own && p.closed && (p.fill === WALL_SEEN || p.fill === WALL_GREY) ? [primitiveBounds(p)!] : []))
  const line = lineOf(doc, view)
  const length = line ? dist(line.a, line.b) : 0
  return {
    xs: [...others.flatMap(({ box }) => [box.minX, box.maxX]), ...walls.flatMap((b) => [b.minX, b.maxX]), view.x, view.x + length * viewScale(view)],
    ys: [...others.flatMap(({ box, levels }) => [box.minY, box.maxY, ...levels]), ...walls.map((b) => b.minY), view.y],
    middles: others.map(({ box }) => (box.minX + box.maxX) / 2),
  }
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
 * moves across the view, as what is made to be fixed on a wall but is on none does, and up or down
 * by its height above the floor (`z`, left out back on the floor). Null when the view has no line, or one of no length.
 */
export function elevationMovePatch(view: Elevation, doc: Document, registry: Registry, object: ElevationItem['node'], drawnAlong: number, drawnUp: number): Record<string, unknown> | null {
  // Dragged in the drawing, where the view may be drawn larger or smaller than the plan.
  const [ds, dh] = [drawnAlong / viewScale(view), drawnUp / viewScale(view)]
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
  if (dh === 0) return moved
  if (object.type === 'parametric' && openingSpan(object, registry)) {
    const kind = registry.parametric.get(object.kind)
    const sill = kind?.sill
    if (!kind || !sill) return moved
    return { ...moved, props: { ...object.props, [sill]: Math.max(0, tidy(Number(registry.resolveProps(kind, object.props)[sill]) + dh)) } }
  }
  const z = Math.max(0, tidy((heightAboveFloor(object, registry) ?? 0) + dh))
  return { ...moved, z: z > 0 ? z : null }
}

/**
 * What raising the top of an object shown in an elevation by `dh` mm does to it, its bottom staying
 * where it is: a parametric object whose kind has a `height` (a tall unit, a door, a wall cabinet)
 * is made that much taller, and what is fixed on a wall by its centre goes up half as much; a
 * placement of a component makes the component taller, and with it every placement of it. Never
 * less than 1 mm tall. Null for what has no height to change.
 */
export function elevationHeightOps(doc: Document, registry: Registry, object: ElevationItem['node'], dh: number): Op[] | null {
  if (object.type === 'instance') {
    const component = doc.nodes[object.component]
    if (component?.type !== 'component' || !component.height) return null
    const scale = object.scale ?? 1
    const height = Math.max(1, tidy(component.height * scale + dh)) / scale
    return [{ op: 'update_node', id: component.id, patch: { height: tidy(height) } }]
  }
  const kind = registry.parametric.get(object.kind)
  if (!kind?.params.some((p) => p.key === 'height' && p.type === 'number')) return null
  const was = Number(propsInPlace(doc, object, registry).height) || 0
  const height = Math.max(1, tidy(was + dh))
  const mount = mountOf(object, registry)
  // Where its height is worked out, what its kind says makes it that high (a wall cabinet no longer
  // up to the ceiling), or nothing: a tall unit of sections is as high as they are.
  const set = heightInPlace(doc, object, registry) === null ? { height } : kind.heightSet?.(registry.resolveProps(kind, object.props), height)
  if (!set) return null
  const patch: Record<string, unknown> = { props: { ...object.props, ...set } }
  if (mount?.on === 'wall' && mount.measured !== 'bottom') patch.z = tidy((heightAboveFloor(object, registry) ?? 0) + (height - was) / 2)
  return [{ op: 'update_node', id: object.id, patch }]
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
 * The operations that keep the lines of views where they belong after an edit (`applyEdit`).
 *
 * A view moved with the walls it looks at (its `x`, `y` moved by as much as a wall of the plan it
 * looks at, in the same edit, its line left as it was) has its line moved with them: the plan and
 * its views were moved together, as a selection of both is. So has a view whose plan was moved
 * whole, every wall of it by as much, the view staying where it is drawn: a section goes with the
 * plan it cuts, as an elevation does with its face.
 *
 * An elevation whose face the edit changed, as `mountFollowOps` does for what is fixed on it: its
 * far side is put back on the face, and its line kept its depth in front of it. Each end of the far
 * side is seen to alone. One that was at an end of the face as drawn (a corner of the room) stays
 * at an end of a face: where a face still ends there (the wall turned round, or cut in two there)
 * it is left, else it goes to that end of the face, so that the view of a whole face stays of the
 * whole face as the wall gets longer or shorter. One that was along the wall is left while it is still on a face, else keeps its place
 * along the wall as a door does (`followAlong`). Both go on the same face, wherever it now is. Left
 * alone: a line the edit changed itself, and one on a wall that is curved or was taken away.
 */
/** A view's line moved by `d`. */
const shifted = (view: Elevation, d: Vec2) => ({ a: { x: tidy(view.a.x + d.x), y: tidy(view.a.y + d.y) }, b: { x: tidy(view.b.x + d.x), y: tidy(view.b.y + d.y) } })

export function elevationFollowOps(before: Document, after: Document, changed: Iterable<string>): Op[] {
  const ids = [...changed]
  const walls = new Map<string, { old: Wall; now: Wall }>()
  const views: { old: Elevation; now: Elevation }[] = []
  for (const id of ids) {
    const old = before.nodes[id]
    const now = after.nodes[id]
    if (old?.type === 'wall' && now?.type === 'wall' && old !== now) walls.set(id, { old, now })
    if (old?.type === 'elevation' && now?.type === 'elevation' && old !== now) views.push({ old, now })
  }
  if (walls.size === 0) return []
  const ops: Op[] = []
  // By value: every node an operation touches is parsed again, its points new objects.
  const same = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y
  const lineKept = (old: Elevation, now: Elevation) => same(old.a, now.a) && same(old.b, now.b) && old.depth === now.depth
  // Moved with the plan: the line goes as far as the view and the walls went.
  const carried = new Set<string>()
  for (const { old, now } of views) {
    if (!lineKept(old, now)) continue
    const d = { x: now.x - old.x, y: now.y - old.y }
    if (Math.hypot(d.x, d.y) < 1e-9) continue
    const page = lookedAt(before, old)
    const along = [...walls.values()].some(({ old: was, now: is }) => rootOf(before, was.parent)?.id === page && Math.abs(is.a.x - was.a.x - d.x) < 1e-6 && Math.abs(is.a.y - was.a.y - d.y) < 1e-6 && Math.abs(is.b.x - was.b.x - d.x) < 1e-6 && Math.abs(is.b.y - was.b.y - d.y) < 1e-6)
    if (!along) continue
    carried.add(now.id)
    ops.push({ op: 'update_node', id: now.id, patch: shifted(old, d) })
  }
  // The plan moved whole: every wall of a page by the same, the views of it left where they are drawn.
  const wholly = new Map<string, Vec2 | null>()
  const movedBy = (page: string): Vec2 | null => {
    if (wholly.has(page)) return wholly.get(page)!
    let d: Vec2 | null = null
    for (const wall of wallsIn(before, page)) {
      const now = walls.get(wall.id)?.now
      const by = now && { x: now.a.x - wall.a.x, y: now.a.y - wall.a.y }
      const same = by && Math.abs(now.b.x - wall.b.x - by.x) < 1e-6 && Math.abs(now.b.y - wall.b.y - by.y) < 1e-6 && (!d || (Math.abs(by.x - d.x) < 1e-6 && Math.abs(by.y - d.y) < 1e-6))
      if (!same) {
        d = null
        break
      }
      d = by
    }
    const found = d && Math.hypot(d.x, d.y) > 1e-9 ? d : null
    wholly.set(page, found)
    return found
  }
  for (const node of Object.values(before.nodes)) {
    if (node.type !== 'elevation' || carried.has(node.id) || after.nodes[node.id] !== node) continue
    const page = lookedAt(before, node)
    const d = page ? movedBy(page) : null
    if (!d) continue
    carried.add(node.id)
    ops.push({ op: 'update_node', id: node.id, patch: shifted(node, d) })
  }
  // On the face of a wall the edit changed: back on it.
  const straight = new Map([...walls].filter(([, { old, now }]) => !old.bulge && !now.bulge))
  if (straight.size === 0) return ops
  const roots = new Set([...straight.values()].map(({ old }) => rootOf(before, old.parent)?.id).filter((id): id is string => !!id))
  for (const node of Object.values(before.nodes)) {
    if (node.type !== 'elevation' || carried.has(node.id)) continue
    const now = after.nodes[node.id]
    // A view the edit set itself (but for moving where it is drawn) is left as it was set.
    if (now?.type !== 'elevation' || !lineKept(node, now) || (now !== node && now.x === node.x && now.y === node.y)) continue
    const line = lineOf(before, node)
    if (!line.parent || !roots.has(line.parent)) continue
    const [farA, farB] = farSide(line)
    const far = { a: farA, b: farB, parent: line.parent }
    const on = carriers(before, far).find((carrier) => straight.has(carrier.wall.id))
    if (!on) continue
    const { old, now: wall } = straight.get(on.wall.id)!
    const [was, is] = [courseOf(old), courseOf(wall)]
    const across = faceAcross(wall, on.face)
    const still = carriers(after, far)
    const stretch = faceStretch(after, wall, on.face)
    const d = norm(sub(far.b, far.a))
    const follow = (p: Vec2): Vec2 => {
      const s = was.project(p).along
      const atEnd = Math.abs(s - on.stretch[0]) <= ON_FACE ? stretch[0] : Math.abs(s - on.stretch[1]) <= ON_FACE ? stretch[1] : null
      if (atEnd !== null ? still.some(({ ends }) => ends.some((end) => dist(end, p) <= ON_FACE)) : still.some(({ ends }) => (dot(sub(p, ends[0]), d) + ON_FACE) * (dot(sub(p, ends[1]), d) - ON_FACE) <= 0)) return p
      const q = is.offset(atEnd ?? followAlong(old, wall, s, 0), across)
      return { x: tidy(q.x), y: tidy(q.y) }
    }
    const [a, b] = [follow(far.a), follow(far.b)]
    if (a === far.a && b === far.b) continue
    // The line back in front of the face, as far as it was.
    const moved = viewOfFace({ a, b }, depthOf(line))
    ops.push({ op: 'update_node', id: node.id, patch: { a: moved.a, b: moved.b } })
  }
  return ops
}
