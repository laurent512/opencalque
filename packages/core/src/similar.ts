import type { Registry } from './registry'
import type { Node } from './schema'
import { variantKey } from './variants'

/**
 * How things are found alike to those selected, to be selected with them:
 * - `similar`: what a plan calls the same thing. Walls of one material and thickness, floors of one
 *   material, placements of one component, parametric objects of one model (kind and parameters),
 *   dimensions of one style, and otherwise things of one type on one layer with the same look.
 * - `type`: of the same type (a parametric object, of the same kind).
 * - `layer`: on the same layer.
 * - `material`: walls of the same material (the default one included), floors of the same material.
 */
export type Likeness = 'similar' | 'type' | 'layer' | 'material'

/** What makes a node alike to others in the way said, or null when it has nothing to be alike by (a floor of no material, by material). */
export function likenessKey(node: Node, by: Likeness, registry: Registry): string | null {
  switch (by) {
    case 'type':
      return node.type === 'parametric' ? `parametric ${node.kind}` : node.type
    case 'layer':
      return `layer ${node.layer ?? ''}`
    case 'material':
      if (node.type === 'wall') return `wall ${node.material ?? ''}`
      return node.type === 'room' && node.material ? `room ${node.material}` : null
    case 'similar':
      switch (node.type) {
        case 'wall':
          return `wall ${node.material ?? ''} ${node.thickness}`
        case 'room':
          return `room ${node.material ?? ''}`
        case 'instance':
          return `instance ${node.component}`
        case 'parametric':
          return `parametric ${variantKey(node, registry)}`
        case 'dimension':
          return `dimension ${node.dimensionStyle ?? ''}`
        default:
          return `${node.type} ${node.layer ?? ''} ${JSON.stringify(node.style ?? {})}`
      }
  }
}

/** Those of `candidates` alike, in the way said, to one of `chosen`, which are among them. */
export function alikeTo(chosen: Node[], candidates: Node[], by: Likeness, registry: Registry): Node[] {
  const keys = new Set(chosen.map((node) => likenessKey(node, by, registry)).filter((key): key is string => key !== null))
  return candidates.filter((node) => {
    const key = likenessKey(node, by, registry)
    return key !== null && keys.has(key)
  })
}
