import { boundsOf, buildScene, inverseOf, transformPrimitive, viewPlacement, type Document, type Node, type Registry, type SceneItem, type Transform } from '@opencalque/core'
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
/** Nothing around: one list, the same each time, so that the canvas sees nothing changed there. */
const NOTHING: SceneItem[] = []
/**
 * What was found around last time: the scene of each place on the way, which the next is built from
 * as the canvas builds its own (`buildScene`), what each item seen through placements became there,
 * and the list given, given again while every item in it is the same.
 */
let kept: { scenes: Map<string, { doc: Document; scene: SceneItem[] }>; version: number; items: SceneItem[] } = { scenes: new Map(), version: 0, items: NOTHING }
const placedItems = new WeakMap<SceneItem, { by: string; item: SceneItem }>()

export function surroundings(
  doc: Document,
  page: string,
  scope: string,
  through: string[] | null,
  registry: Registry,
  show: { groups: Surroundings; components: Surroundings },
  /** The version of the extensions in use (`useExtensions`): what was drawn with others is drawn again. */
  version = 0,
): SceneItem[] {
  if (scope === page) return NOTHING
  const { steps, through: way } = scopePath(doc, page, scope, through)
  const scenes = new Map<string, { doc: Document; scene: SceneItem[] }>()
  const out: SceneItem[][] = []
  // Undoing the placements crossed so far, the outermost first: what is out there is placed by them.
  let undo: Transform[] = []
  for (let i = steps.length - 1; i > 0; i--) {
    const [outer, inner] = [steps[i - 1], steps[i]]
    const component = doc.nodes[inner.id]?.type === 'component'
    if ((component ? show.components : show.groups) !== 'faded') break
    let leading = inner.id
    // A view (an elevation, a section) is gone into in its own coordinates: what is around it is
    // brought into them, as through a placement (`viewPlacement`).
    const view = doc.nodes[inner.id]
    if (view?.type === 'elevation') {
      const { x, y, scale } = viewPlacement(view)
      undo = [{ x: -x / scale, y: -y / scale, scale: 1 / scale }, ...undo]
    }
    if (component) {
      const placement = way && doc.nodes[way[outer.depth]]
      const back = placement?.type === 'instance' ? inverseOf(placement) : null
      if (!placement || !back) break
      undo = [back, ...undo]
      leading = placement.id
    }
    const scene = buildScene(doc, outer.id, registry, kept.version === version ? kept.scenes.get(outer.id) : undefined)
    scenes.set(outer.id, { doc, scene })
    const items = scene.filter((item) => item.id !== leading)
    const by = JSON.stringify(undo)
    out.unshift(undo.length === 0 ? items : items.map((item) => placedOnce(item, undo, by)))
  }
  const items = out.flat()
  const same = items.length === kept.items.length && items.every((item, i) => item === kept.items[i])
  kept = { scenes, version, items: same ? kept.items : items.length === 0 ? NOTHING : items }
  return kept.items
}

/** `placedBack`, worked out once for an item and the same placements. */
function placedOnce(item: SceneItem, undo: Transform[], by: string): SceneItem {
  const known = placedItems.get(item)
  if (known?.by === by) return known.item
  const placed = placedBack(item, undo)
  placedItems.set(item, { by, item: placed })
  return placed
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
