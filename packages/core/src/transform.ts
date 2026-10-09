import { childrenOf } from './document'
import { add, rotate, scale, sub, type Vec2 } from './geometry'
import { ANNOTATION_BEND, ANNOTATION_TEXT_SIZE } from './kinds'
import type { Op } from './ops'
import type { Registry } from './registry'
import type { Document, Node } from './schema'

/**
 * A change of place, direction and size that keeps shapes in proportion, about a fixed point:
 * first mirrored left to right (when `mirror`), then scaled, then turned. A top-to-bottom mirror
 * is the same as `mirror` with a half turn.
 */
export interface Similarity {
  pivot: Vec2
  mirror?: boolean
  /** Degrees, clockwise on screen. */
  rotation?: number
  /** 1 leaves sizes as they are. */
  scale?: number
}

const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0
/** An angle brought back between 0 and 360. */
const turned = (degrees: number) => tidy(((degrees % 360) + 360) % 360)

/**
 * The operations that apply a similarity to nodes, whatever their types; groups are transformed
 * through what they hold. Every kind of node keeps its own meaning: a wall's thickness and a
 * text's size scale with it, a parametric object has its lengths scaled rather than being
 * stretched, text and pictures move to their mirrored place but stay readable, and a paper stays
 * upright (a quarter turn swaps its sides).
 */
export function transformOps(doc: Document, nodes: Node[], t: Similarity, registry: Registry): Op[] {
  const s = t.scale ?? 1
  const turn = t.rotation ?? 0
  const flip = t.mirror ?? false
  const map = (p: Vec2): Vec2 => {
    const d = sub(p, t.pivot)
    const r = rotate(scale(flip ? { x: -d.x, y: d.y } : d, s), turn)
    return { x: tidy(t.pivot.x + r.x), y: tidy(t.pivot.y + r.y) }
  }
  /** The direction of something that pointed at `degrees`. A mirror reverses the sense of turning. */
  const angle = (degrees = 0) => turned((flip ? -degrees : degrees) + turn)
  /**
   * Where a box that cannot itself be mirrored (it has a top-left corner and a direction) ends
   * up: mirrored, its far top corner is the one that becomes its top-left.
   */
  const box = (node: { x: number; y: number; rotation?: number }, width: number) => map(flip ? add(node, rotate({ x: width, y: 0 }, node.rotation ?? 0)) : node)

  const patchOf = (node: Node): Record<string, unknown> | null => {
    switch (node.type) {
      case 'line':
      case 'divider':
        return { a: map(node.a), b: map(node.b) }
      case 'annotation':
        return {
          a: map(node.a),
          b: map(node.b),
          ...(node.size === undefined && s === 1 ? {} : { size: tidy((node.size ?? ANNOTATION_TEXT_SIZE) * s) }),
          ...(node.markerSize === undefined ? {} : { markerSize: tidy(node.markerSize * s) }),
          // Which side the leader bows to is a matter of handedness, which a mirror reverses.
          ...(flip ? { bend: -(node.bend ?? ANNOTATION_BEND) } : {}),
        }
      case 'room':
        return { ...map(node), ...(node.size === undefined && s === 1 ? {} : { size: tidy((node.size ?? 250) * s) }) }
      case 'wall':
        return { a: map(node.a), b: map(node.b), thickness: tidy(node.thickness * s) }
      case 'dimension':
        return {
          a: map(node.a),
          b: map(node.b),
          // The side its line stands on is a matter of handedness, which a mirror reverses.
          offset: tidy(node.offset * s * (flip ? -1 : 1)),
          ...(node.size === undefined ? {} : { size: tidy(node.size * s) }),
          ...(node.markerSize === undefined ? {} : { markerSize: tidy(node.markerSize * s) }),
          ...(node.extensionGap === undefined ? {} : { extensionGap: tidy(node.extensionGap * s) }),
        }
      case 'polyline':
        return { points: node.points.map(map) }
      case 'rect':
      case 'image':
        return { ...box(node, node.width), width: tidy(node.width * s), height: tidy(node.height * s), rotation: angle(node.rotation) }
      case 'paper': {
        const centre = map({ x: node.x + node.width / 2, y: node.y + node.height / 2 })
        const quarter = Math.abs((((turn % 180) + 180) % 180) - 90) < 1e-6
        const width = tidy((quarter ? node.height : node.width) * s)
        const height = tidy((quarter ? node.width : node.height) * s)
        return { x: tidy(centre.x - width / 2), y: tidy(centre.y - height / 2), width, height }
      }
      case 'ellipse': {
        const centre = map({ x: node.cx, y: node.cy })
        return { cx: centre.x, cy: centre.y, rx: tidy(node.rx * s), ry: tidy(node.ry * s), rotation: angle(node.rotation) }
      }
      case 'text':
        // Its width is not known exactly without the renderer's font; this matches the estimate used for picking.
        return { ...box(node, node.text.length * node.size * 0.55), size: tidy(node.size * s), rotation: angle(node.rotation) }
      case 'instance':
        return { ...map(node), rotation: angle(node.rotation), ...(flip ? { flipX: !node.flipX } : {}), ...(s === 1 ? {} : { scale: tidy((node.scale ?? 1) * s) }) }
      case 'parametric': {
        const patch: Record<string, unknown> = { ...map(node), rotation: angle(node.rotation), ...(flip ? { flipX: !node.flipX } : {}) }
        const kind = registry.parametric.get(node.kind)
        if (s !== 1 && kind) {
          // A door twice the size is a door with twice the width, not a stretched drawing of one.
          const props: Record<string, unknown> = { ...node.props }
          for (const param of kind.params) {
            if (param.unit !== 'length' || typeof param.default !== 'number') continue
            const value = props[param.key]
            props[param.key] = tidy((typeof value === 'number' ? value : param.default) * s)
          }
          patch.props = props
        }
        return patch
      }
      default:
        return null
    }
  }

  /** A node's modifiers go where the node goes: their frames are placed things like any other. */
  const modifiersOf = (node: Node): Record<string, unknown> =>
    node.modifiers?.length
      ? {
          modifiers: node.modifiers.map((m) => {
            const frame = m.frame ?? { x: 0, y: 0 }
            return { ...m, frame: { ...map(frame), rotation: angle(frame.rotation), ...(flip ? { flipX: !frame.flipX } : frame.flipX ? { flipX: true } : {}), ...(s === 1 && frame.scale === undefined ? {} : { scale: tidy((frame.scale ?? 1) * s) }) } }
          }),
        }
      : {}

  // Groups have no geometry, but they are listed too: a group can carry modifiers of its own.
  const everything = (list: Node[]): Node[] => list.flatMap((n) => (n.type === 'group' ? [n, ...everything(childrenOf(doc, n.id))] : [n]))
  return everything(nodes).flatMap((node): Op[] => {
    const geometry = node.type === 'group' ? {} : patchOf(node)
    if (!geometry) return []
    const patch = { ...geometry, ...modifiersOf(node) }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: node.id, patch }] : []
  })
}
