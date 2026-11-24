import { childrenOf } from './document'
import { rotate } from './geometry'
import { kindOf, nodePrimitives } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import { frameMiddle, type ResizeFrame } from './resize'
import { boundsOf } from './scene'
import type { Document, Node } from './schema'
import { placing, tidy, turned, type Placing, type Similarity } from './similarity'

export type { Placing, Similarity }

/**
 * The operations that apply a similarity to nodes, whatever their types; groups are transformed
 * through what they hold. Each kind of node says how it is transformed (`NodeKind.transform`),
 * keeping its own meaning.
 */
export function transformOps(doc: Document, nodes: Node[], t: Similarity, registry: Registry): Op[] {
  const placed = placing(t)

  /** A node's modifiers go where the node goes: their frames are placed things like any other. */
  const modifiersOf = (node: Node): Record<string, unknown> =>
    node.modifiers?.length
      ? {
          modifiers: node.modifiers.map((m) => {
            const frame = m.frame ?? { x: 0, y: 0 }
            return {
              ...m,
              frame: {
                ...placed.point(frame),
                rotation: placed.angle(frame.rotation),
                ...(placed.mirror ? { flipX: !frame.flipX } : frame.flipX ? { flipX: true } : {}),
                ...(placed.scale === 1 && frame.scale === undefined ? {} : { scale: tidy((frame.scale ?? 1) * placed.scale) }),
              },
            }
          }),
        }
      : {}

  // Groups have no geometry, but they are listed too: a group can carry modifiers of its own.
  const everything = (list: Node[]): Node[] => list.flatMap((n) => (n.type === 'group' ? [n, ...everything(childrenOf(doc, n.id))] : [n]))
  const all = everything(nodes)
  // A view turned with walls, the plan it looks at, has its line turned with them; mirrored, it
  // keeps looking at what it looked at, mirrored too: its ends change places. Turned alone, it
  // stays upright where its corner goes, looking where it did.
  const withPlan = all.some((n) => n.type === 'wall')
  const line = (node: Node): Record<string, unknown> =>
    node.type === 'elevation' && withPlan ? (placed.mirror ? { a: placed.point(node.b), b: placed.point(node.a) } : { a: placed.point(node.a), b: placed.point(node.b) }) : {}
  return all.flatMap((node): Op[] => {
    const geometry = kindOf(node).transform(node, placed, registry)
    if (!geometry) return []
    const patch = { ...geometry, ...line(node), ...modifiersOf(node) }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: node.id, patch }] : []
  })
}

/**
 * The operations that turn each node to `degrees` about its own middle: the middle of the box it
 * fills when it is not turned, which stays where it is whatever the angle. This is what an angle
 * typed in the properties panel does, as in drawing programs, so that a rectangle does not swing
 * about its corner nor a component about its insertion point, each a different point.
 */
export function turnToOps(doc: Document, nodes: Node[], degrees: number, registry: Registry): Op[] {
  return nodes.flatMap((node): Op[] => {
    const now = (node as { rotation?: number }).rotation ?? 0
    if (turned(degrees - now) === 0) return []
    const box = turnedBox(doc, node, registry)
    if (!box) return [{ op: 'update_node', id: node.id, patch: { rotation: turned(degrees) } }]
    return transformOps(doc, [node], { pivot: frameMiddle(box), rotation: degrees - now }, registry)
  })
}

/**
 * The box a node fills when it is not turned, turned as the node is. It keeps its shape whatever
 * the angle and its middle is the node's own middle, so it is the box drawn around a turned
 * object that has no frame of its own (a text, a picture, a compass), and the one it turns about.
 * Null for a node that draws nothing.
 */
export function turnedBox(doc: Document, node: Node, registry: Registry): ResizeFrame | null {
  const now = (node as { rotation?: number }).rotation ?? 0
  // Straightened about the origin, the node fills an upright box; that box, turned back, is the node's own.
  const upright: Record<string, unknown> = { ...node }
  if (now !== 0) {
    for (const op of transformOps(doc, [node], { pivot: { x: 0, y: 0 }, rotation: -now }, registry)) {
      if (op.op !== 'update_node' || op.id !== node.id) continue
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === null) delete upright[key]
        else upright[key] = value
      }
    }
  }
  const box = boundsOf(nodePrimitives(upright as Node, { doc, registry, depth: 0 }))
  if (!box) return null
  return { origin: rotate({ x: box.minX, y: box.minY }, now), rotation: now, width: box.maxX - box.minX, height: box.maxY - box.minY }
}
