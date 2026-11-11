import { add, arcThrough, len, norm, scale, sub, type Vec2 } from './geometry'
import type { NodeInput, Op } from './ops'
import type { Node, NodeOf } from './schema'
import { cross, dot, tidy } from './walls/course'

/*
 * The fillet tool, as in CAD: two lines made to meet. With no radius, each is cut back or carried
 * on to where they cross, which makes a clean corner; with a radius, each stops where an arc of
 * that radius, added between them, takes over.
 */

/** What can be filleted: a straight line. */
export const canFillet = (node: Node): node is NodeOf<'line'> => node.type === 'line'

const point = (p: Vec2): Vec2 => ({ x: tidy(p.x), y: tidy(p.y) })

/**
 * The operations that make `first` and `second` meet, each clicked at `at` (the part of each kept
 * is the one on the side of their crossing it was clicked on), with an arc of `radius` between
 * them when it is more than 0. The arc is a node with the id given, on the first line's layer and
 * in its look. Null when they cannot meet: lines that run side by side, or too short for the radius.
 */
export function filletOps(first: NodeOf<'line'>, firstAt: Vec2, second: NodeOf<'line'>, secondAt: Vec2, radius: number, arcId: string): Op[] | null {
  if (first.id === second.id || !(radius >= 0)) return null
  const d1 = sub(first.b, first.a)
  const d2 = sub(second.b, second.a)
  const denom = cross(d1, d2)
  if (len(d1) < 1e-9 || len(d2) < 1e-9 || Math.abs(denom) < 1e-9 * len(d1) * len(d2)) return null
  const crossing = add(first.a, scale(d1, cross(sub(second.a, first.a), d2) / denom))
  // For each line: the way from the crossing to the part kept, the end that stays, and how far it is.
  const kept = (line: NodeOf<'line'>, at: Vec2) => {
    const dir = norm(sub(line.b, line.a))
    const along = (q: Vec2) => dot(sub(q, crossing), dir)
    // Clicked on the crossing itself: the longer part is kept.
    const side = Math.abs(along(at)) > 1e-6 ? Math.sign(along(at)) : Math.abs(along(line.a)) >= Math.abs(along(line.b)) ? Math.sign(along(line.a)) : Math.sign(along(line.b))
    const stays: 'a' | 'b' = along(line.a) * side >= along(line.b) * side ? 'a' : 'b'
    return { way: scale(dir, side || 1), moves: stays === 'a' ? ('b' as const) : ('a' as const), reach: along(line[stays]) * side }
  }
  const one = kept(first, firstAt)
  const two = kept(second, secondAt)
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(one.way, two.way))))
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return null
  // How far back from the crossing each line stops, for the arc to touch it there.
  const back = radius / Math.tan(angle / 2)
  if (one.reach <= back + 1e-6 || two.reach <= back + 1e-6) return null
  const ends = [add(crossing, scale(one.way, back)), add(crossing, scale(two.way, back))].map(point)
  const ops: Op[] = [
    { op: 'update_node', id: first.id, patch: { [one.moves]: ends[0] } },
    { op: 'update_node', id: second.id, patch: { [two.moves]: ends[1] } },
  ]
  if (radius === 0) return ops
  // The arc's middle is the point of it nearest the crossing, on the line halfway between the two.
  const halfway = norm(add(one.way, two.way))
  const centre = add(crossing, scale(halfway, radius / Math.sin(angle / 2)))
  const arc = arcThrough(ends[0], ends[1], sub(centre, scale(halfway, radius)))
  if (!arc) return null
  const node = {
    id: arcId,
    type: 'ellipse',
    parent: first.parent,
    ...(first.layer ? { layer: first.layer } : {}),
    ...(first.style ? { style: first.style } : {}),
    cx: tidy(arc.cx),
    cy: tidy(arc.cy),
    rx: radius,
    ry: radius,
    from: arc.from,
    to: arc.to,
  } as NodeInput
  return [...ops, { op: 'add_node', node }]
}
