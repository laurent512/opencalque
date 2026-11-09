import { boundsOf, buildScene, inverseOf, transformPrimitive, type Document, type Node, type Registry, type SceneItem, type Transform } from '@opencalque/core'
import { scopePath } from './scopePath'

/** How the rest of the drawing is shown while editing inside a group, or a component: faded around it, or not at all. */
export type Surroundings = 'faded' | 'alone'

/**
 * What lies around the group or component being edited, as the canvas shows it faded under it:
 * going out from the scope, at each place on the way (`scopePath`), everything there but what
 * leads in, in the coordinates of the scope. It stops at the first group or component shown
 * alone, at a component reached by no known placement (opened from the Components panel or the
 * library), and at a placement no transform can undo (stretched and turned, `inverseOf`).
 *
 * The items are not picked up. They are snapped to: those of a group gone into on the page are
 * the drawing's own nodes, as they are; those seen through a placement are drawn where the
 * component's coordinates put them, and are snapped to by their drawn points and lines only.
 */
export function surroundings(
  doc: Document,
  page: string,
  scope: string,
  through: string[] | null,
  registry: Registry,
  show: { groups: Surroundings; components: Surroundings },
): SceneItem[] {
  if (scope === page) return []
  const { steps, through: way } = scopePath(doc, page, scope, through)
  const out: SceneItem[][] = []
  // Undoing the placements crossed so far, the outermost first: what is out there is placed by them.
  let undo: Transform[] = []
  for (let i = steps.length - 1; i > 0; i--) {
    const [outer, inner] = [steps[i - 1], steps[i]]
    const component = doc.nodes[inner.id]?.type === 'component'
    if ((component ? show.components : show.groups) !== 'faded') break
    let leading = inner.id
    if (component) {
      const placement = way && doc.nodes[way[outer.depth]]
      const back = placement?.type === 'instance' ? inverseOf(placement) : null
      if (!placement || !back) break
      undo = [back, ...undo]
      leading = placement.id
    }
    const items = buildScene(doc, outer.id, registry).filter((item) => item.id !== leading)
    out.unshift(undo.length === 0 ? items : items.map((item) => placedBack(item, undo)))
  }
  return out.flat()
}

/**
 * An item seen through placements, in the coordinates of what they place. It stands for no node
 * there: it is given a group's kind, which has no points or lines of its own, so that it is
 * snapped to by what it draws, and an id of its own, which nothing else has.
 */
function placedBack(item: SceneItem, undo: Transform[]): SceneItem {
  const prims = item.prims.map((prim) => undo.reduce((p, t) => transformPrimitive(p, t), prim))
  const node = { id: `around:${item.id}`, type: 'group', parent: null, order: 'a0' } as unknown as Node
  return { id: node.id, node, prims, bounds: boundsOf(prims), locked: item.locked }
}
