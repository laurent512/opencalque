import { dist, norm, perp, sub, type Vec2 } from './geometry'
import { newId } from './document'
import type { NodeInput, Op } from './ops'
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'
import { wallOpenings } from './walls'

/** How far the first line of dimensions stands from the face of its wall, and the next one from it, in mm. */
const STAND_OFF = 500
const BETWEEN = 450

/**
 * The operations that dimension walls: along each, a chain from its start to each side of each
 * door and window in it and on to its end, and beyond that one dimension for its whole length
 * when the chain has more than one link. The chains stand on the outer side of the walls, taken
 * as the side away from the middle of all the walls drawn with them.
 *
 * The dimensions of a wall are put in a group named after it, so they are moved or deleted as
 * one. They are ordinary dimensions, measured when made: after the wall changes, delete the
 * group and make it again. `look` is given to each of them (text size, ends, unit…).
 */
export function dimensionChainOps(doc: Document, walls: NodeOf<'wall'>[], registry: Registry, look: Record<string, unknown> = {}, groupName = 'Dimensions'): Op[] {
  const all = Object.values(doc.nodes).filter((node): node is NodeOf<'wall'> => node.type === 'wall' && walls.some((wall) => wall.parent === node.parent))
  const ends = all.flatMap((wall) => [wall.a, wall.b])
  const middle = ends.length > 0 ? { x: ends.reduce((total, p) => total + p.x, 0) / ends.length, y: ends.reduce((total, p) => total + p.y, 0) / ends.length } : { x: 0, y: 0 }

  return walls.flatMap((wall): Op[] => {
    const length = dist(wall.a, wall.b)
    if (length < 1e-6) return []
    const d = norm(sub(wall.b, wall.a))
    const n = perp(d)
    // Outwards: away from the middle of the plan, judged from the middle of the wall.
    const from = { x: (wall.a.x + wall.b.x) / 2 - middle.x, y: (wall.a.y + wall.b.y) / 2 - middle.y }
    const side = from.x * n.x + from.y * n.y >= 0 ? 1 : -1
    const at = (t: number): Vec2 => ({ x: Math.round((wall.a.x + d.x * t) * 1000) / 1000, y: Math.round((wall.a.y + d.y * t) * 1000) / 1000 })
    const stops = [...new Set([0, ...wallOpenings(doc, wall, registry).flatMap(({ from: start, to }) => [start, to]), length].map((t) => Math.round(t * 1000) / 1000))].sort((p, q) => p - q)

    const group = newId()
    const half = wall.thickness / 2
    const dimension = (start: number, end: number, row: number): Op => ({
      op: 'add_node',
      node: {
        ...look,
        type: 'dimension',
        parent: group,
        layer: wall.layer,
        a: at(start),
        b: at(end),
        offset: side * (half + STAND_OFF + row * BETWEEN),
        // The extension lines start at the face of the wall, not in its middle.
        extensionGap: half,
      } as NodeInput,
    })
    const links = stops.slice(1).map((stop, i) => dimension(stops[i], stop, 0))
    return [
      { op: 'add_node', node: { type: 'group', id: group, parent: wall.parent, layer: wall.layer, name: wall.name ? `${groupName}: ${wall.name}` : groupName } as NodeInput },
      ...links,
      ...(links.length > 1 ? [dimension(0, length, 1)] : []),
    ]
  })
}
