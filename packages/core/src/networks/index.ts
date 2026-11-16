import { isVisible, leavesOf, linkable, rootOf } from '../document'
import { add, dist, mid, norm, scale, sub, unionBounds, type Bounds, type Vec2 } from '../geometry'
import type { Op } from '../ops'
import { primitiveBounds, type Primitive } from '../primitives'
import type { Port, Registry } from '../registry'
import type { Document, Node, NodeOf } from '../schema'

/*
 * Networks: what joins the objects of a plan to one another. A `link` node joins two objects, by
 * their ids, through the connections (`ports`) their kinds declare: a switch gives control, a light
 * takes it. Links are functional first: a control link says that a switch turns a light on, not
 * where the wire runs, so a wireless switch and a wired one are linked alike. What a domain works
 * out from them is in a module of its own (`electrical.ts`), computed each time, never stored.
 */

export type Link = NodeOf<'link'>

/** What a control link carries, and the ports it joins carry. */
export const CONTROL = 'control'
/** How much a control link bows when it says nothing, as a fraction of its length. */
export const LINK_BEND = 0.25
/** The dashes of a control link, in screen pixels, as electrical plans draw it. */
const CONTROL_DASH = [6, 4]

/** The connections of a node: those its kind declares, for a parametric object; none for anything else. */
export function portsOf(node: Node | undefined, registry: Registry): Port[] {
  if (node?.type !== 'parametric') return []
  const kind = registry.parametric.get(node.kind)
  if (!kind?.ports) return []
  try {
    return kind.ports(registry.resolveProps(kind, node.props))
  } catch {
    return []
  }
}

/** What a link carries: control, unless it is a run, which joins no particular port yet. */
const carried = (link: Pick<Link, 'role'>) => ((link.role ?? 'control') === 'control' ? CONTROL : null)

/**
 * The port a link joins at one of its ends: the one it names, else the first of that end's that
 * fits (giving at its start, taking at its end, carrying what the link carries). Null when the end
 * has none that fits, or the link is a run.
 */
export function linkPort(doc: Document, registry: Registry, link: Pick<Link, 'from' | 'to' | 'fromPort' | 'toPort' | 'role'>, side: 'from' | 'to'): Port | null {
  const carries = carried(link)
  if (!carries) return null
  const ports = portsOf(doc.nodes[link[side]], registry).filter((port) => port.way === (side === 'from' ? 'out' : 'in') && port.carries === carries)
  const named = side === 'from' ? link.fromPort : link.toPort
  return (named === undefined ? undefined : ports.find((port) => port.key === named)) ?? ports[0] ?? null
}

/**
 * The links that start or end at one of `ids`. It looks through every node, once: for the editor
 * and the tools, never inside `applyOps`.
 */
export function linksAt(doc: Document, ids: Iterable<string>): Link[] {
  const wanted = new Set(ids)
  return Object.values(doc.nodes).filter((node): node is Link => node.type === 'link' && (wanted.has(node.from) || wanted.has(node.to)))
}

/** Whether `from` gives control and `to` takes it, so that a control link can go from one to the other. */
export function canControl(doc: Document, registry: Registry, from: string, to: string): boolean {
  if (from === to) return false
  const gives = portsOf(doc.nodes[from], registry).some((port) => port.way === 'out' && port.carries === CONTROL)
  const takes = portsOf(doc.nodes[to], registry).some((port) => port.way === 'in' && port.carries === CONTROL)
  return gives && takes
}

/** Whether a node gives control (a switch) or takes it (a light), or neither. */
export function controlSide(node: Node | undefined, registry: Registry): 'out' | 'in' | null {
  const ports = portsOf(node, registry).filter((port) => port.carries === CONTROL)
  return ports.some((port) => port.way === 'out') ? 'out' : ports.some((port) => port.way === 'in') ? 'in' : null
}

/**
 * The operations that make one of two objects control the other, whichever was given first (the
 * one that gives control is the start of the link), or, when it does already, that undo it: what
 * clicking a switch then a light does. `place` says where a new link goes: its id, its page or
 * group, and its layer. Null when neither can control the other.
 */
export function toggleControlOps(
  doc: Document,
  registry: Registry,
  a: string,
  b: string,
  place: { id?: string; parent: string; layer?: string; fromPort?: string },
): { ops: Op[]; linked: boolean } | null {
  const [from, to] = canControl(doc, registry, a, b) ? [a, b] : canControl(doc, registry, b, a) ? [b, a] : [null, null]
  if (!from || !to) return null
  const existing = linksAt(doc, [from]).filter((link) => (link.role ?? 'control') === 'control' && link.from === from && link.to === to)
  if (existing.length > 0) return { ops: existing.map((link): Op => ({ op: 'remove_node', id: link.id })), linked: false }
  // The port it starts from is the one asked for when the switch is the first clicked; else the first.
  const fromPort = from === a && place.fromPort !== undefined ? { fromPort: place.fromPort } : {}
  const node = { ...(place.id ? { id: place.id } : {}), type: 'link' as const, parent: place.parent, ...(place.layer === undefined ? {} : { layer: place.layer }), from, to, ...fromPort }
  return { ops: [{ op: 'add_node', node }], linked: true }
}

/** The box of what a node draws. */
function boxOf(prims: Primitive[]): Bounds | null {
  return prims.reduce<Bounds | null>((box, prim) => unionBounds(box, primitiveBounds(prim)), null)
}

const inside = (p: Vec2, box: Bounds) => p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY

/** The middle of a page or component: of the points that place what it holds, worked out once per drawing. */
const middles = new WeakMap<Document['nodes'], Map<string, Vec2 | null>>()
function middleOf(doc: Document, root: string): Vec2 | null {
  let known = middles.get(doc.nodes)
  if (!known) middles.set(doc.nodes, (known = new Map()))
  if (!known.has(root)) {
    const points = leavesOf(doc, root).flatMap((node): Vec2[] => ('a' in node && 'b' in node ? [node.a, node.b] : 'x' in node && 'y' in node ? [{ x: node.x, y: node.y }] : []))
    known.set(root, points.length === 0 ? null : { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length })
  }
  return known.get(root)!
}

/**
 * How much a link bows, signed: what it says, or else towards the middle of its page, so that a link
 * between two things on a wall bows into the room rather than through the wall.
 */
export function linkBend(doc: Document, link: Link, a: Vec2, b: Vec2): number {
  if ((link.role ?? 'control') !== 'control') return 0
  if (link.bend !== undefined) return link.bend
  const root = rootOf(doc, link.parent)
  const middle = root && middleOf(doc, root.id)
  // Positive bows to the left of the way from a to b as seen on screen; with Y growing downward,
  // this cross product is negative for a point on that side.
  const side = middle ? (b.x - a.x) * (middle.y - a.y) - (b.y - a.y) * (middle.x - a.x) : 0
  return side <= 0 ? LINK_BEND : -LINK_BEND
}

/** How finely the curve of a link is drawn: as many straight pieces. */
const LINK_STEPS = 48

/** The two ends of a link as it is drawn: the box and the middle of what each draws. Null when an end is missing, hidden, or on another page. */
function linkEnds(doc: Document, link: Link, drawn: (node: Node) => Primitive[]): { boxes: [Bounds, Bounds]; a: Vec2; b: Vec2 } | null {
  const ends = [doc.nodes[link.from], doc.nodes[link.to]]
  if (!ends.every(linkable)) return null
  const root = rootOf(doc, link.parent)
  if (ends.some((end) => !isVisible(doc, end!) || rootOf(doc, end!.parent) !== root)) return null
  const [first, second] = ends.map((end) => boxOf(drawn(end!)))
  if (!first || !second) return null
  const middle = (box: Bounds) => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
  return { boxes: [first, second], a: middle(first), b: middle(second) }
}

/** To the left of the way from a to b, as seen on screen (Y grows downward): the side a positive bend bows to. */
const leftOf = (a: Vec2, b: Vec2): Vec2 => {
  const d = norm(sub(b, a))
  return { x: d.y, y: -d.x }
}

/**
 * The line a link is drawn along: from the middle of what one end draws to the middle of the other,
 * bowed for a control link, and cut where it enters each, so that it goes from the edge of one
 * symbol to the edge of the other. Null when an end is missing, hidden, on another page, or when the
 * two cover each other. `drawn` gives what a node draws, in the drawing's coordinates.
 */
export function linkPath(doc: Document, link: Link, drawn: (node: Node) => Primitive[]): Vec2[] | null {
  const ends = linkEnds(doc, link, drawn)
  if (!ends) return null
  const { boxes, a, b } = ends
  const length = dist(a, b)
  if (length < 1e-6) return null
  const bend = linkBend(doc, link, a, b)
  // A quadratic curve: its middle stands off the straight line by half of what the bend says.
  const pull = add(mid(a, b), scale(leftOf(a, b), bend * length))
  const points = Array.from({ length: LINK_STEPS + 1 }, (_, i) => {
    const t = i / LINK_STEPS
    const [p, q, r] = [(1 - t) * (1 - t), 2 * (1 - t) * t, t * t]
    return { x: p * a.x + q * pull.x + r * b.x, y: p * a.y + q * pull.y + r * b.y }
  })
  let first = 0
  while (first < points.length && inside(points[first], boxes[0])) first++
  let last = points.length - 1
  while (last >= first && inside(points[last], boxes[1])) last--
  const kept = points.slice(first, last + 1)
  return kept.length >= 2 ? kept : null
}

/** The middle of a control link's curve, which is dragged to bow it more, less, or the other way; null for a run or a link not drawn. */
export function linkMiddle(doc: Document, link: Link, drawn: (node: Node) => Primitive[]): Vec2 | null {
  const ends = (link.role ?? 'control') === 'control' ? linkEnds(doc, link, drawn) : null
  if (!ends || dist(ends.a, ends.b) < 1e-6) return null
  const { a, b } = ends
  return add(mid(a, b), scale(leftOf(a, b), (linkBend(doc, link, a, b) * dist(a, b)) / 2))
}

/** The bend that puts the middle of a control link's curve as far off its straight line as `p` is, rounded to a thousandth; null when it is not drawn. */
export function bendThrough(doc: Document, link: Link, p: Vec2, drawn: (node: Node) => Primitive[]): number | null {
  const ends = linkEnds(doc, link, drawn)
  if (!ends) return null
  const { a, b } = ends
  const length = dist(a, b)
  if (length < 1e-6) return null
  const left = leftOf(a, b)
  const off = sub(p, mid(a, b))
  return Math.round(((2 * (off.x * left.x + off.y * left.y)) / length) * 1000) / 1000
}

/** What a link draws: a dashed curve for a control link, as electrical plans show a switch and its lights; a plain line for a run. */
export function linkPrimitives(doc: Document, link: Link, drawn: (node: Node) => Primitive[]): Primitive[] {
  const points = linkPath(doc, link, drawn)
  if (!points) return []
  return [{ kind: 'path', points, ...((link.role ?? 'control') === 'control' ? { dash: CONTROL_DASH } : {}) }]
}
