import { add, dist, mid, norm, perp, scale, sub, type Vec2 } from '../geometry'
import type { Op } from '../ops'
import type { Document, WALL_JOINS } from '../schema'
import { courseOf, cross, dot, JOIN_TOLERANCE, tidy, wallArc, wallContains, wallSides, type Wall } from './course'
import { joinedNear, wallIndex, wallsOver } from './spatial'

/*
 * Corners: where wall ends meet, how their faces are brought together there (`meet`, `cap`), and
 * the corner as something to select, move and join, known by where it is rather than as a node.
 */

/**
 * A mitre sticking out further than this many half-thicknesses is cut off instead. At 2, walls
 * meeting at less than 60° get a chamfered corner rather than a long spike; a right angle (1.41)
 * and anything wider keep their sharp point.
 */
const MITER_LIMIT = 2
/** Even a sharp point asked for by name stops somewhere: past this many half-thicknesses it is two walls nearly folded onto each other. */
const FORCED_MITER_LIMIT = 60

/**
 * One wall leaving a joint: its direction away from the joint, how far its faces are on either
 * side of its line (`plus` towards `perp(d)`, `minus` away from it), half its thickness, and its
 * length.
 */
interface Ray {
  /** The wall, and which of its ends is at the joint. */
  wall?: Wall
  end?: 'a' | 'b'
  d: Vec2
  plus: number
  minus: number
  h: number
  length: number
  angle: number
  self: boolean
  /** How this end asks to be joined, if it says. */
  join?: WallJoin
  /** Whether this end asks for the line across it to be drawn (true) or not (false), if it says. */
  line?: boolean
  /** Whether this end gives that line a look of its own (colour, weight or kind of line). */
  look?: boolean
  /** For a curved wall, the centre of its curve: its faces are then circles about it, not lines. */
  centre?: Vec2
}

export type WallJoin = (typeof WALL_JOINS)[number]

/** The reach of a wall to either side of the way it leaves the joint at `end`: leaving from `a`, its right is the plus side; from `b`, its left. */
function reachAt(wall: Wall, end: 'a' | 'b'): { plus: number; minus: number; h: number } {
  const { left, right } = wallSides(wall)
  return end === 'a' ? { plus: right, minus: left, h: wall.thickness / 2 } : { plus: left, minus: right, h: wall.thickness / 2 }
}

/** How two wall ends that meet are joined, from what each of them asks for. Rounded wins over cut off, which wins over one running through. */
function styleOf(a: WallJoin | undefined, b: WallJoin | undefined): 'auto' | 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = [a, b]
  if (asked.includes('round')) return 'round'
  if (asked.includes('bevel')) return 'bevel'
  if (asked.includes('through') || asked.includes('butt')) return 'butt'
  // A sharp point asked for by name is kept at any angle; with nothing asked, the corner does what suits its angle.
  return asked.includes('miter') ? 'miter' : 'auto'
}

/** A face of a wall at a joint: a line through `at` going `d`, or, for a curved wall, the circle about `centre` through `at`. */
interface Face {
  at: Vec2
  d: Vec2
  centre?: Vec2
}

/** Where a line through `at` going `d` crosses a circle: none, one or two points. */
export function lineCircle(at: Vec2, d: Vec2, centre: Vec2, radius: number): Vec2[] {
  const f = sub(at, centre)
  const b = dot(f, d)
  const disc = b * b - (dot(f, f) - radius * radius)
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [-b - root, -b + root].map((t) => add(at, scale(d, t)))
}

/** Where two circles cross: none, one or two points. */
function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2)
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const u = scale(sub(c2, c1), 1 / d)
  const m = add(c1, scale(u, a))
  return [add(m, scale(perp(u), h)), sub(m, scale(perp(u), h))]
}

/**
 * Where two faces at a joint really cross, when one or both are curved: of the places they
 * cross, the one nearest the joint, which is where the corner is. Null when they do not cross.
 */
function facesCross(p: Vec2, a: Face, b: Face, reach: number): Vec2 | null {
  const points =
    a.centre && b.centre
      ? circleCircle(a.centre, dist(a.centre, a.at), b.centre, dist(b.centre, b.at))
      : a.centre
        ? lineCircle(b.at, b.d, a.centre, dist(a.centre, a.at))
        : lineCircle(a.at, a.d, b.centre!, dist(b.centre!, b.at))
  // A curved face goes on round its whole circle, and may cross the other face a second time,
  // behind a wall or past its far end: only a crossing ahead along both walls, within their
  // reach, is the corner.
  const ahead = points.filter((q) => dot(sub(q, p), a.d) > -1e-6 && dot(sub(q, p), b.d) > -1e-6 && dist(q, p) <= reach)
  if (ahead.length === 0) return null
  return ahead.reduce((best, q) => (dist(q, p) < dist(best, p) ? q : best))
}

/**
 * Where the "plus" face of ray `a` meets the "minus" face of ray `b`, its neighbour going around
 * the joint. Returns the outline points each wall takes, ordered from its own face towards the joint.
 */
function meet(p: Vec2, a: Ray, b: Ray, style: 'auto' | 'miter' | 'round' | 'bevel' = 'auto'): { a: Vec2[]; b: Vec2[]; at?: Vec2 } {
  const qa = add(p, scale(perp(a.d), a.plus))
  const qb = sub(p, scale(perp(b.d), b.minus))
  const square = { a: [qa], b: [qb] }
  const denom = cross(a.d, b.d)
  if (Math.abs(denom) < 1e-9) return square
  const between = sub(qb, qa)
  const s = cross(between, b.d) / denom
  const u = cross(between, a.d) / denom
  let c = add(qa, scale(a.d, s))
  if (s >= 0 && u >= 0 && (a.centre || b.centre)) {
    // On the inner side of a corner the faces really cross. A curved face has turned away from its
    // tangent by then, so where they cross is worked out on the faces themselves, before anything
    // is judged from the tangents: two walls that leave the joint nearly the same way have tangents
    // that meet far off, while their curves, bending apart, cross close by.
    const crossing = facesCross(p, { at: qa, d: a.d, centre: a.centre }, { at: qb, d: b.d, centre: b.centre }, Math.min(a.length, b.length))
    // Curved faces that bend away from each other never meet ahead: each wall then ends square at the joint.
    if (!crossing) return square
    c = crossing
  } else if (s > a.length || u > b.length) return square // The faces would cross beyond the far end of a wall: too short to mitre.
  if (style === 'round' || style === 'bevel') {
    // Rounded and cut off are worked out from the faces of the walls, not from the joint: walls drawn
    // by a face have their joint on that face, and a corner whose point is the joint itself would
    // have nothing left to round or cut. So the corner is the same whichever line the walls are drawn
    // by. Which side is the outer one is judged from where the middles of the walls cross.
    const o = middlesCross(p, a, b)
    const ga = add(o, scale(perp(a.d), (a.plus + a.minus) / 2))
    const gb = sub(o, scale(perp(b.d), (b.plus + b.minus) / 2))
    // Only the outer side of a corner, where the faces cross beyond that point, has a point to round or cut off.
    if (cross(sub(gb, ga), b.d) / denom < 0) {
      // A circle touching both outer faces, as wide as the thinner wall: for two walls of one
      // thickness drawn by their middle, the circle about the joint. Its centre is inside both
      // walls, where they are divided.
      const r = Math.min(a.plus + a.minus, b.plus + b.minus) / 2
      const ia = sub(qa, scale(perp(a.d), r))
      const ib = add(qb, scale(perp(b.d), r))
      const centre = add(ia, scale(a.d, cross(sub(ib, ia), b.d) / denom))
      const ta = add(centre, scale(perp(a.d), r))
      const tb = sub(centre, scale(perp(b.d), r))
      if (style === 'bevel') {
        const m = mid(ta, tb)
        return { a: [ta, m], b: [tb, m], at: centre }
      }
      // The arc from where it touches one face to where it touches the other, each wall taking the half on its side.
      const from = Math.atan2(ta.y - centre.y, ta.x - centre.x)
      let sweep = Math.atan2(tb.y - centre.y, tb.x - centre.x) - from
      if (sweep > Math.PI) sweep -= 2 * Math.PI
      if (sweep < -Math.PI) sweep += 2 * Math.PI
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16)))
      const point = (t: number): Vec2 => ({ x: tidy(centre.x + r * Math.cos(from + sweep * t)), y: tidy(centre.y + r * Math.sin(from + sweep * t)) })
      const half = Array.from({ length: steps + 1 }, (_, i) => i / (2 * steps))
      return { a: half.map((t) => point(t)), b: half.map((t) => point(1 - t)), at: centre }
    }
  }
  // Left to itself, cut off when the point would stick out too far. A sharp point asked for by name
  // is drawn whatever its length, short of what no drawing could hold.
  // Measured against the faces that meet there, which for a wall drawn by a face may be its whole thickness from the joint.
  const tip = dist(c, p) / Math.max(a.plus, b.minus, 1e-9)
  if (s < 0 && ((style === 'auto' && tip > MITER_LIMIT) || tip > FORCED_MITER_LIMIT)) {
    const m = mid(qa, qb)
    return { a: [qa, m], b: [qb, m] }
  }
  return { a: [c], b: [c] }
}

/**
 * Where the middles of two walls leaving a joint cross, along the way each leaves it: the joint
 * itself for walls drawn by their middle, and for walls drawn by a face half a thickness in from it.
 */
function middlesCross(p: Vec2, a: Ray, b: Ray): Vec2 {
  const ma = add(p, scale(perp(a.d), (a.plus - a.minus) / 2))
  const mb = add(p, scale(perp(b.d), (b.plus - b.minus) / 2))
  const denom = cross(a.d, b.d)
  if (Math.abs(denom) < 1e-9) return p
  return add(ma, scale(a.d, cross(sub(mb, ma), b.d) / denom))
}

/** How far from the face of a wall, in mm, an end may be and still stop against it. */
const STOP_TOLERANCE = 1
/** An end meeting a wall at a sharper angle than this (its sine) stops against it; one running nearly along it does not. */
const STOP_LIMIT = 0.25

/** The wall an end stops against, and which of that wall's faces it comes up to: 1 its right, -1 its left, as it runs from a to b. */
export interface Stop {
  wall: Wall
  side: 1 | -1
}

/**
 * Where a free end of a wall stops against the side of another: in that wall's body or on its
 * face, coming to it at an angle. The end is cut along the face it comes up to, so it lies flat
 * against it at any angle, with nothing sticking into the other wall and no gap left beside it;
 * the two points of the cut are given from its minus side to its plus side, as `cap` goes. Null
 * when the end is in no wall, or in more than one (a corner, where the cut would not be one line),
 * or runs nearly along it, or would be cut beyond the other wall's ends or far from its own.
 *
 * Null too where the other wall is of another material and stacked under this one, as the
 * Structure panel orders them: this wall then keeps its length and is drawn over the other, as
 * any wall over one of another material is (`paintOrder`, `outsideMass`). A wall not yet in the
 * drawing, being drawn, goes on top. Walls of one material are one mass, and the end is cut.
 */
function stopAgainst(doc: Document, wall: Wall, p: Vec2, away: Vec2, own: { plus: number; minus: number }): { stop: Stop; cut: Vec2[] } | null {
  const index = wallIndex(doc, wall.parent)
  const hosts = wallsOver(index, p, STOP_TOLERANCE).filter((other) => other.id !== wall.id && dist(other.a, other.b) > 1e-6 && wallContains(other, p, STOP_TOLERANCE))
  if (hosts.length !== 1) return null
  const host = hosts[0]
  const madeOf = (w: Wall) => (w.material && doc.materials?.[w.material] ? w.material : '')
  if (madeOf(host) !== madeOf(wall) && (index.rank.get(wall.id) ?? Infinity) > index.rank.get(host.id)!) return null
  const course = courseOf(host)
  const arc = wallArc(host)
  // The way across the host at the end, towards its right face: for a curved wall, towards or away from its centre.
  const n = arc ? (dist(arc.centre, p) < 1e-9 ? null : scale(norm(sub(arc.centre, p)), Math.sign(arc.sweep))) : perp(course.dir(0))
  if (!n) return null
  const k = dot(away, n)
  if (Math.abs(k) < STOP_LIMIT) return null
  const side = k > 0 ? 1 : -1
  const { left, right } = wallSides(host)
  const face = side > 0 ? right : -left
  const cut: Vec2[] = []
  for (const sign of [-1, 1]) {
    const from = add(p, scale(perp(away), sign > 0 ? own.plus : -own.minus))
    let q: Vec2 | undefined
    if (!arc) q = add(from, scale(away, (face - course.project(from).across) / k))
    else {
      const hits = lineCircle(from, away, arc.centre, Math.max(0, arc.radius - Math.sign(arc.sweep) * face))
      q = hits.length === 0 ? undefined : hits.reduce((best, c) => (dist(c, from) < dist(best, from) ? c : best))
    }
    if (!q) return null
    const along = course.project(q).along
    if (along < -1e-6 || along > course.length + 1e-6 || dist(q, from) > (host.thickness + wall.thickness) / Math.abs(k) + STOP_TOLERANCE) return null
    cut.push({ x: tidy(q.x), y: tidy(q.y) })
  }
  return { stop: { wall: host, side }, cut }
}

/**
 * The outline of a wall end at `p`, from its minus face round to its plus face. A free end is cut
 * square, or along the face of the wall it stops against. Where other walls end at the same point,
 * the faces are mitred with their neighbours and the outline passes through `p`, so the walls
 * around a joint tile it exactly. `stopped`, when given, is told the wall this end stops against,
 * at a butt joint or against the side of a wall, and which face of it.
 */
export function cap(p: Vec2, wall: Wall, away: Vec2, doc: Document, seams?: [Vec2, Vec2][], stopped?: { stop?: Stop }): Vec2[] {
  const rays: Ray[] = []
  // A wall laid against another from the same corner is joined to nothing there: its end is free.
  const atJoint = joinedNear(wallIndex(doc, wall.parent), p)
  const walls = atJoint.some((w) => w.id === wall.id) ? [wall, ...atJoint.filter((w) => w.id !== wall.id)] : [wall]
  for (const w of walls) {
    if (dist(w.a, w.b) < 1e-6) continue
    for (const side of ['a', 'b'] as const) {
      const end = w[side]
      const self = w.id === wall.id
      if (self ? end !== p : dist(end, p) > JOIN_TOLERANCE) continue
      // A curved wall leaves the joint the way its curve is heading there.
      const course = courseOf(w)
      const d = self ? away : side === 'a' ? course.dir(0) : scale(course.dir(course.length), -1)
      const edge = w.edges?.[side]
      const look = !!edge && (edge.stroke !== undefined || edge.strokeWidth !== undefined || edge.dash !== undefined)
      rays.push({ wall: w, end: side, d, ...reachAt(w, side), length: course.length, angle: Math.atan2(d.y, d.x), self, join: w.joins?.[side], line: edge?.show, look, centre: wallArc(w)?.centre })
    }
  }
  const own = reachAt(wall, p === wall.a ? 'a' : 'b')
  /** Straight across the wall at `at`, from its minus face to its plus face. */
  const square = (at: Vec2): Vec2[] => [sub(at, scale(perp(away), own.minus)), add(at, scale(perp(away), own.plus))]
  if (rays.length < 2) {
    const against = stopAgainst(doc, wall, p, away, own)
    if (!against) return square(p)
    if (stopped) stopped.stop = against.stop
    return against.cut
  }
  rays.sort((x, y) => x.angle - y.angle)
  const i = rays.findIndex((r) => r.self)
  const me = rays[i]
  const next = rays[(i + 1) % rays.length]
  const prev = rays[(i + rays.length - 1) % rays.length]
  // A choice of joint only means something between two walls; where more meet they are mitred.
  const style = rays.length === 2 ? styleOf(me.join, next.join) : 'auto'
  /**
   * Whether the line between the two walls of this joint is drawn. Either of them may ask for it
   * or against it, and asking for it wins; with nothing asked it is `usual` for the kind of joint:
   * not drawn where two walls are joined into one, drawn where one stops against the other.
   */
  const lineShown = (usual: boolean) => (rays.length !== 2 ? false : me.line === true || next.line === true ? true : me.line === false || next.line === false ? false : usual)
  /**
   * Whether this wall is the one of the two that draws the line between them, which is drawn once,
   * in the look of the end that draws it: the end that gives it a look of its own, or else `usual`.
   */
  const drawsLine = (usual: boolean) => (me.look === next.look ? usual : !!me.look)
  /**
   * The two walls brought to the line between them, in the given shape (a mitre unless said), and
   * that line kept to be drawn when `draws`. They meet exactly at the joint, at any angle; a corner
   * rounded or cut off, at the point it is worked out about (`meet`'s `at`), which the joint of walls
   * drawn by a face would leave outside it.
   */
  const joined = (shape: 'auto' | 'miter' | 'round' | 'bevel', draws: boolean): Vec2[] => {
    const back = meet(p, prev, me, shape)
    const ahead = meet(p, me, next, shape)
    const before = back.b
    const after = ahead.a
    if (draws) seams?.push([before[before.length - 1], after[after.length - 1]])
    return [...before, back.at ?? ahead.at ?? p, ...after.reverse()]
  }
  if (style === 'butt') {
    // One wall passes: it runs on, square, far enough to cover the end of the other. The other
    // stops against it: its end is cut along the face of the passing wall that it comes up to, so
    // at any angle it lies flat against that face, with nothing left open and nothing sticking out.
    const other = next
    const passes = me.join === 'through' || (me.join !== 'butt' && other.join === 'butt')
    const [passing, stopping] = passes ? [me, other] : [other, me]
    // The face of the passing wall on the side the other wall arrives from.
    const across = perp(passing.d)
    const face = dot(stopping.d, across) >= 0 ? add(p, scale(across, passing.plus)) : sub(p, scale(across, passing.minus))
    const turn = cross(stopping.d, passing.d)
    // Where a side of the stopping wall meets that face; `sign` picks its minus or its plus side.
    const lands = (sign: number): Vec2 => {
      const from = add(p, scale(perp(stopping.d), sign > 0 ? stopping.plus : -stopping.minus))
      return add(from, scale(stopping.d, cross(sub(face, from), passing.d) / turn))
    }
    // How far past the joint the passing wall has to go to cover both of those places.
    const reach = Math.abs(turn) < 1e-6 ? Infinity : Math.max(0, ...[-1, 1].map((sign) => -dot(sub(lands(sign), p), passing.d)))
    // Walls that carry on from one another, or nearly (one wall cut in two, then bent a little),
    // have no face to stop against within reach: the cut would run far along the wall. They meet
    // instead on the line that halves the angle between them, like a mitre, and that line is
    // drawn across, so they still read as two walls.
    // That is so once the passing wall would have to overrun the joint by more than its own thickness
    // and a quarter: about when the two walls bend by less than 45° from a straight line.
    if (reach > 2.5 * Math.max(passing.h, stopping.h)) return joined('auto', lineShown(true) && drawsLine(!passes))
    // Walls are painted as one mass, which would hide where one stops: the line of its end is kept
    // to be drawn, usually by the wall that stops.
    const cut = [lands(-1), lands(1)]
    if (lineShown(true) && drawsLine(!passes)) seams?.push([cut[0], cut[1]])
    if (passes) return square(sub(p, scale(away, reach)))
    // The face it stops against, as the passing wall's own right or left: from its end a, its plus side is its right.
    const plusSide = dot(stopping.d, across) >= 0
    if (stopped && passing.wall) stopped.stop = { wall: passing.wall, side: plusSide === (passing.end === 'a') ? 1 : -1 }
    return cut
  }
  // Joined into one, the two walls show no line between them unless one asks for it; it is then
  // drawn once, by the one of the two that comes first going round the joint unless the other styles it.
  return joined(style, lineShown(false) && drawsLine(me.angle < next.angle))
}

/** One end of a wall. */
export interface WallEnd {
  wall: Wall
  end: 'a' | 'b'
}

/**
 * The wall ends that are at a point: a corner of the plan, or the free end of one wall. A wall
 * laid against another from the same corner is not at the corner (`joinedNear`).
 */
export function wallEndsAt(doc: Document, parentId: string | null, p: Vec2): WallEnd[] {
  return joinedNear(wallIndex(doc, parentId), p).flatMap((wall): WallEnd[] => [
    ...(dist(wall.a, p) < JOIN_TOLERANCE ? [{ wall, end: 'a' as const }] : []),
    ...(dist(wall.b, p) < JOIN_TOLERANCE ? [{ wall, end: 'b' as const }] : []),
  ])
}

/** The ends at a wall's end: those of the corner it is part of, or itself alone where its end is free or it is laid against a wall of the corner. */
export function wallEndsOf(doc: Document, wall: Wall, end: 'a' | 'b'): WallEnd[] {
  const ends = wallEndsAt(doc, wall.parent, wall[end])
  return ends.some((other) => other.wall.id === wall.id && other.end === end) ? ends : [{ wall, end }]
}

/**
 * The walls joined to `wall` end to end, itself included, in no particular order. As a run (the
 * default), it goes on through corners where two walls meet and stops where three or more do: one
 * line of walls, open or closed into a loop. With `network`, it goes on through every corner: all
 * the walls that hold together.
 */
export function connectedWalls(doc: Document, wall: Wall, network = false): string[] {
  const found = new Set([wall.id])
  const queue = [wall]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const end of ['a', 'b'] as const) {
      const ends = wallEndsAt(doc, current.parent, current[end])
      if (!network && ends.length !== 2) continue
      for (const other of ends) {
        if (found.has(other.wall.id)) continue
        found.add(other.wall.id)
        queue.push(other.wall)
      }
    }
  }
  return [...found]
}

/** How the walls at a corner are joined, as one choice: 'butt' covers the through and butt pair. */
export function cornerJoin(ends: WallEnd[]): 'auto' | 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = ends.map(({ wall, end }) => wall.joins?.[end])
  return styleOf(asked.find((j) => j === 'round') ?? asked.find((j) => j === 'bevel') ?? asked.find((j) => j === 'through' || j === 'butt') ?? asked.find((j) => j === 'miter'), undefined)
}

/**
 * Whether a corner left to itself is cut off rather than brought to a point, as it stands now:
 * what "automatic" comes to at the angle its two walls make.
 */
export function autoJoinCuts(ends: WallEnd[]): boolean {
  if (ends.length !== 2) return false
  const rays = ends.map(({ wall, end }): Ray => {
    const course = courseOf(wall)
    const d = end === 'a' ? course.dir(0) : scale(course.dir(course.length), -1)
    return { d, ...reachAt(wall, end), length: course.length, angle: Math.atan2(d.y, d.x), self: false, centre: wallArc(wall)?.centre }
  })
  const p = ends[0].wall[ends[0].end]
  return meet(p, rays[0], rays[1], 'auto').a.length > 1 || meet(p, rays[1], rays[0], 'auto').a.length > 1
}

/**
 * The operations that give a corner one kind of joint. For 'butt', the wall at `through` (an index
 * into `ends`) is the one that runs past; the others stop against it.
 */
export function cornerJoinOps(ends: WallEnd[], join: 'auto' | 'miter' | 'round' | 'bevel' | 'butt', through = 0): Op[] {
  return ends.map(({ wall, end }, i): Op => {
    // Automatic is having nothing asked: it is what a corner is until someone chooses.
    const value: WallJoin | undefined = join === 'auto' ? undefined : join === 'butt' ? (i === through ? 'through' : 'butt') : join
    const joins = { ...wall.joins, [end]: value }
    if (value === undefined) delete joins[end]
    return { op: 'update_node', id: wall.id, patch: { joins: Object.keys(joins).length > 0 ? joins : null } }
  })
}

/**
 * How far apart, in mm, two wall ends may be and be said to nearly meet: closer than this, but not
 * at the same point, they are not joined, which a plan traced or drawn by hand often hides.
 */
export const NEAR_JOIN = 10

/** Another wall's end close to a wall end without being at it, and how far. */
export interface NearEnd {
  wall: Wall
  end: 'a' | 'b'
  at: Vec2
  distance: number
}

/**
 * What a wall end is joined to, for showing it: the walls joined to it there (`joined`), those
 * with an end at the same point that it is not joined to (`touching`: it was set loose, or it is a
 * lining stopping against a wall), whether it was set loose (`loose`), and the nearest end of
 * another wall that nearly meets it (`near`, closer than `NEAR_JOIN`).
 */
export function wallEndState(doc: Document, wall: Wall, end: 'a' | 'b'): { joined: Wall[]; touching: Wall[]; loose: boolean; near: NearEnd | null } {
  const p = wall[end]
  const index = wallIndex(doc, wall.parent)
  const ends = wallEndsOf(doc, wall, end)
  const joined = ends.length > 1 ? ends.filter((one) => one.wall.id !== wall.id).map((one) => one.wall) : []
  let near: NearEnd | null = null
  const touching: Wall[] = []
  for (const other of index.walls) {
    if (other.id === wall.id) continue
    for (const side of ['a', 'b'] as const) {
      const d = dist(other[side], p)
      if (d < JOIN_TOLERANCE) {
        if (!joined.some((one) => one.id === other.id) && !touching.includes(other)) touching.push(other)
      } else if (d < NEAR_JOIN && (!near || d < near.distance)) near = { wall: other, end: side, at: other[side], distance: d }
    }
  }
  return { joined, touching, loose: wall.joins?.[end] === 'free', near }
}

/**
 * The operation that sets a wall end loose ('free': joined to nothing, even where other walls end
 * at the same point) or joins it again, as walls meeting at a point are. Setting it loose forgets
 * the kind of joint it had asked for.
 */
export function looseEndOps(wall: Wall, end: 'a' | 'b', loose: boolean): Op[] {
  const joins: Partial<Record<'a' | 'b', WallJoin>> = { ...wall.joins }
  if (loose) joins[end] = 'free'
  else if (joins[end] === 'free') delete joins[end]
  else return []
  return [{ op: 'update_node', id: wall.id, patch: { joins: Object.keys(joins).length > 0 ? joins : null } }]
}

/** The operations that move a corner: every wall end at `from` goes to `to`. */
export function moveCornerOps(doc: Document, parentId: string | null, from: Vec2, to: Vec2): Op[] {
  const patches = new Map<string, Record<string, Vec2>>()
  for (const { wall, end } of wallEndsAt(doc, parentId, from)) patches.set(wall.id, { ...patches.get(wall.id), [end]: to })
  return [...patches].map(([id, patch]): Op => ({ op: 'update_node', id, patch }))
}
