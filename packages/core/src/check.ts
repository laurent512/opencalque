import { componentsOf, leavesOf, pagesOf, rootOf } from './document'
import { add, dist, scale, type Vec2 } from './geometry'
import type { Registry } from './registry'
import { GAP, roomAt } from './rooms'
import type { Document, Node, NodeOf } from './schema'
import { courseOf, cross, distToBody, dot, middleAcross, wallContains, wallSides, type Wall } from './walls/course'
import { hostWall, openingSpan, wallOpenings } from './walls/openings'
import { wallIndex, wallsOver } from './walls/spatial'

/*
 * What a drawing can tell is wrong with it, for whoever cannot see it: the assistant, an agent, a
 * script. A wall a few millimetres short leaves a room with no floor and nothing says so. Only what
 * is nearly always a mistake is reported, in English as the errors of the core are, and a problem
 * says what to do about it. A drawing with problems is still a valid drawing.
 */

export type ProblemKind = 'room-not-enclosed' | 'rooms-in-one-space' | 'wall-gap' | 'walls-overlap' | 'opening-not-in-wall' | 'opening-past-wall-end' | 'openings-overlap'

export interface DrawingProblem {
  kind: ProblemKind
  /** What is wrong and what to do about it, with the ids it speaks of. */
  message: string
  /** The nodes concerned, in a settled order. */
  nodes: string[]
  /** Where it is. */
  at: Vec2
}

/**
 * A wall end stopping closer than this, in mm, to a wall it does not reach may have been meant to
 * reach it: it is about a wall's thickness, what is lost by mistaking a wall's face for its line,
 * and no doorway is so narrow. Closer than `GAP` it does reach it, as rooms see it.
 */
export const WALL_GAP = 300
/** How finely, in mm, the way ahead of a wall end is looked along: walls are not thinner. */
const LOOK_STEP = 10
/** Lengths under this, in mm, do not count as an overlap or as sticking out. */
const SLACK = 1
/** The sine of the angle under which two walls run the same way. */
const PARALLEL = 0.01

const mm = (n: number) => Math.round(n * 10) / 10
const point = (p: Vec2) => `(${mm(p.x)}, ${mm(p.y)})`
const named = (node: Node) => `"${node.id}"${node.name ? ` (${node.name})` : ''}`
const material = (wall: Wall) => wall.material ?? ''

/** How much of their thickness two straight walls running the same way share, in mm: nothing or less when they do not lie over each other. */
function sharedThickness(wall: Wall, other: Wall): number {
  const course = courseOf(wall)
  const { left, right } = wallSides(wall)
  const { across } = course.project(other.a)
  const theirs = wallSides(other)
  // A wall running the other way has its left on this one's right.
  const opposite = dot(course.dir(0), courseOf(other).dir(0)) < 0
  const [before, after] = opposite ? [theirs.right, theirs.left] : [theirs.left, theirs.right]
  return Math.min(right, across + after) - Math.max(-left, across - before)
}

/** How far ahead of `from` along `way` a wall begins, looking `WALL_GAP` ahead, or null when none does. */
function aheadOf(from: Vec2, way: Vec2, wall: Wall): number | null {
  for (let t = 0; t <= WALL_GAP; t += LOOK_STEP) if (wallContains(wall, add(from, scale(way, t)))) return t
  return null
}

/**
 * The problem with a wall end that stops short of another wall, if it does: one with nothing
 * within `GAP` of it, heading straight for a wall or for the end of one close by. Walls stand free
 * for good reasons, so this is only asked on a page where a room did not close or two ran into one,
 * where such an end is likely to be why.
 */
function gapAt(doc: Document, wall: Wall, end: 'a' | 'b'): DrawingProblem | null {
  if (wall.joins?.[end] === 'free') return null
  const course = courseOf(wall)
  const at = end === 'a' ? 0 : course.length
  const { left, right } = wallSides(wall)
  const from = course.offset(at, middleAcross(wall))
  const others = wallsOver(wallIndex(doc, wall.parent), from, WALL_GAP + wall.thickness).filter((other) => other.id !== wall.id)
  // Across the whole of its end: a wall drawn by a face can touch by the other one.
  const across = [from, wall[end], course.offset(at, -left), course.offset(at, right)]
  if (others.some((other) => across.some((p) => distToBody(p, other) < GAP))) return null
  const way = scale(course.dir(at), end === 'a' ? -1 : 1)
  const stopped = others.filter((other) => {
    if (aheadOf(from, way, other) !== null) return true
    // Two walls of a corner, each stopping short of the other, are not ahead of each other.
    return Math.abs(cross(way, courseOf(other).dir(0))) >= PARALLEL && Math.min(dist(from, other.a), dist(from, other.b)) < WALL_GAP
  })
  if (stopped.length === 0) return null
  const other = stopped.reduce((best, one) => (distToBody(from, one) < distToBody(from, best) ? one : best))
  return {
    kind: 'wall-gap',
    message: `Wall ${named(wall)} stops ${mm(distToBody(from, other))} mm short of wall ${named(other)} at ${point(wall[end])}, which may be why a room is not closed off. Make its end ${end} reach the other wall, or set "joins": {"${end}": "free"} if the gap is meant.`,
    nodes: [wall.id, other.id].sort(),
    at: wall[end],
  }
}

/** The problem with two walls of one material drawn over each other, if they are: a wall drawn once for each of the rooms it divides. */
function overlapOf(wall: Wall, other: Wall): DrawingProblem | null {
  if (wall.bulge || other.bulge || material(wall) !== material(other)) return null
  const course = courseOf(wall)
  const theirs = courseOf(other)
  if (course.length === 0 || theirs.length === 0 || Math.abs(cross(course.dir(0), theirs.dir(0))) >= PARALLEL) return null
  const [s, t] = [course.project(other.a).along, course.project(other.b).along]
  const from = Math.max(0, Math.min(s, t))
  const to = Math.min(course.length, Math.max(s, t))
  if (to - from <= SLACK || sharedThickness(wall, other) < Math.min(wall.thickness, other.thickness) / 2) return null
  return {
    kind: 'walls-overlap',
    message: `Walls ${named(wall)} and ${named(other)} are drawn over each other for ${mm(to - from)} mm from ${point(course.at(from))}. Draw a wall between two rooms once: remove one, or shorten it.`,
    nodes: [wall.id, other.id].sort(),
    at: course.at(from),
  }
}

function roomProblems(doc: Document, rooms: NodeOf<'room'>[]): DrawingProblem[] {
  const problems: DrawingProblem[] = []
  const first = new Map<object, NodeOf<'room'>>()
  for (const room of rooms) {
    const floor = roomAt(doc, room.parent, room)
    if (!floor) {
      problems.push({
        kind: 'room-not-enclosed',
        message: `Room ${named(room)} at ${point(room)} has no floor: the point is in a wall, or the walls around it do not close. Close them, or move the room's point into the space it names.`,
        nodes: [room.id],
        at: { x: room.x, y: room.y },
      })
      continue
    }
    const before = first.get(floor)
    if (!before) first.set(floor, room)
    else
      problems.push({
        kind: 'rooms-in-one-space',
        message: `Rooms ${named(before)} and ${named(room)} are in the same space, so each shows the whole floor. Remove one, or split the space with a wall or a divider.`,
        nodes: [before.id, room.id].sort(),
        at: { x: room.x, y: room.y },
      })
  }
  return problems
}

function openingProblems(doc: Document, openings: NodeOf<'parametric'>[], walls: Wall[], registry: Registry): DrawingProblem[] {
  const problems: DrawingProblem[] = []
  for (const node of openings) {
    const host = hostWall(doc, node, registry)
    if (!host) {
      // A door drawn on its own, as on a sheet of details, is in no wall because there are none.
      if (walls.length > 0)
        problems.push({
          kind: 'opening-not-in-wall',
          message: `The ${node.kind} ${named(node)} at ${point(node)} is in no wall, so it cuts nothing. Put its point in the middle of a wall's thickness and turn it to the direction of the wall.`,
          nodes: [node.id],
          at: { x: node.x, y: node.y },
        })
      continue
    }
    const course = courseOf(host)
    const past = Math.max(...openingSpan(node, registry)!.map((p) => Math.max(-course.project(p).along, course.project(p).along - course.length)))
    if (past > SLACK)
      problems.push({
        kind: 'opening-past-wall-end',
        message: `The ${node.kind} ${named(node)} runs ${mm(past)} mm past the end of wall ${named(host)}. Move it along the wall, or make it narrower.`,
        nodes: [host.id, node.id].sort(),
        at: { x: node.x, y: node.y },
      })
  }
  for (const wall of walls) {
    let last: { node: Node; to: number } | null = null
    for (const { node, from, to } of wallOpenings(doc, wall, registry)) {
      if (last && last.to - from > SLACK)
        problems.push({
          kind: 'openings-overlap',
          message: `${named(last.node)} and ${named(node)} overlap by ${mm(last.to - from)} mm in wall ${named(wall)}. Move one along the wall.`,
          nodes: [last.node.id, node.id].sort(),
          at: courseOf(wall).at(from),
        })
      if (!last || to > last.to) last = { node, to }
    }
  }
  return problems
}

const keyOf = (problem: DrawingProblem) => `${problem.kind}:${problem.nodes.join(',')}`

/**
 * What is wrong with the pages and components `roots` (by default all of them): rooms that have no
 * floor, with the wall ends that may be why, or that share one, walls drawn over each other, doors
 * and windows outside a wall, past its end or over one another. Each problem is told once.
 */
export function checkDrawing(doc: Document, registry: Registry, roots?: Iterable<string>): DrawingProblem[] {
  const ids = roots ? [...roots] : [...pagesOf(doc), ...componentsOf(doc)].map((node) => node.id)
  const found = new Map<string, DrawingProblem>()
  const keep = (problem: DrawingProblem | null) => {
    if (problem && !found.has(keyOf(problem))) found.set(keyOf(problem), problem)
  }
  for (const id of ids) {
    if (!doc.nodes[id]) continue
    const leaves = leavesOf(doc, id)
    const index = wallIndex(doc, id)
    const rooms = roomProblems(doc, leaves.filter((node): node is NodeOf<'room'> => node.type === 'room'))
    rooms.forEach(keep)
    for (const wall of index.walls) {
      if (dist(wall.a, wall.b) < 1e-6) continue
      if (rooms.length > 0) {
        keep(gapAt(doc, wall, 'a'))
        keep(gapAt(doc, wall, 'b'))
      }
      // Of two walls lying along each other, an end of one is on the other.
      for (const p of [wall.a, wall.b]) for (const other of wallsOver(index, p)) if (other.id !== wall.id) keep(overlapOf(wall, other))
    }
    const openings = leaves.filter((node): node is NodeOf<'parametric'> => openingSpan(node, registry) !== null)
    openingProblems(doc, openings, index.walls, registry).forEach(keep)
  }
  return [...found.values()]
}

/** The pages and components an edit from `before` to `after` changed something in. */
function changedRoots(before: Document, after: Document): Set<string> {
  const roots = new Set<string>()
  const note = (doc: Document, id: string) => {
    const root = rootOf(doc, id)
    if (root) roots.add(root.id)
  }
  for (const id of Object.keys(after.nodes)) if (before.nodes[id] !== after.nodes[id]) note(after, id)
  for (const id of Object.keys(before.nodes)) if (!after.nodes[id]) note(before, id)
  return roots
}

/**
 * The problems an edit made: those of what it changed that were not there before it. What the
 * person left as it was, a wall end kept short on purpose, is not brought up again.
 */
export function problemsMadeBy(before: Document, after: Document, registry: Registry): DrawingProblem[] {
  if (before.nodes === after.nodes) return []
  const roots = changedRoots(before, after)
  const known = new Set(checkDrawing(before, registry, roots).map(keyOf))
  return checkDrawing(after, registry, roots).filter((problem) => !known.has(keyOf(problem)))
}
