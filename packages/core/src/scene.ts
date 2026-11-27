import { count, profiling, span } from './perf'
import { childrenOf, isLocked, isVisible, leavesOf } from './document'
import { applyTransform, boundsContain, boundsContainPoint, boundsOfPoints, boundsTouch, pointInPolygon, unionBounds, type Bounds, type Vec2 } from './geometry'
import { drawnSolid, kindOf, nodePrimitives, objectBacking, PAPER_EDGE, PAPER_FILL } from './kinds'
import { mergedOutlines } from './merge'
import { distToPrimitive, insidePrimitive, primitiveBounds, primitiveTouches, printedPrims, transformPrimitive, type Primitive } from './primitives'
import type { Registry } from './registry'
import type { Document, Node, NodeOf } from './schema'
import { hostWall } from './walls/openings'
import { viewPlacement, viewsLookingAt } from './elevation'

/** One visible child of the container being shown, ready to paint and hit-test. */
export interface SceneItem {
  id: string
  node: Node
  prims: Primitive[]
  bounds: Bounds | null
  /** Where it can be picked, when that is more than its box: a view's line on the plan, drawn only to work with, is not part of its box but is clicked. */
  reach?: Bounds
  /**
   * The mark of a view on another page that looks at this one (`viewsLookingAt`): clicked, it
   * selects that view; a box drawn round the plan, or Select all, does not take it.
   */
  foreign?: boolean
  locked: boolean
  /**
   * Outlines where it is picked up although nothing may be drawn there, never painted: the gap a
   * door or window cuts in its wall (`openingArea`), which an opening drawn as nothing but the
   * hole would otherwise leave impossible to click.
   */
  area?: Vec2[][]
}

/**
 * One visible node as an item of the scene. A group is picked up wherever what it holds is, so it
 * takes the gaps of the doors and windows in it, however deeply grouped (their points are the
 * drawing's: a group moves nothing).
 */
function itemOf(node: Node, doc: Document, registry: Registry, prims: Primitive[]): SceneItem {
  const held = node.type === 'group' ? leavesOf(doc, node.id).filter((leaf) => isVisible(doc, leaf)) : [node]
  const area = held.flatMap((leaf) => openingArea(doc, leaf, registry) ?? [])
  // A view's line on the plan, drawn only to work with, and its marker there (`aside`) are not part of its box, which is its drawing: picked by them, the view is not taken by a box drawn round the plan.
  const solid = prims.filter((p) => !p.screen && !p.aside)
  const boxed = solid.length > 0 && solid.length < prims.length ? solid : prims
  const bounds = area.reduce((b, outline) => unionBounds(b, boundsOfPoints(outline)), boundsOf(boxed))
  const reach = boxed !== prims ? unionBounds(bounds, boundsOf(prims)) : null
  return { id: node.id, node, prims, bounds, ...(reach ? { reach } : {}), locked: isLocked(doc, node), ...(area.length > 0 ? { area } : {}) }
}

/** The gap a door or window cuts in the wall it is set in, as world points; none for any other node, or an opening in no wall. */
export function openingArea(doc: Document, node: Node, registry: Registry): [Vec2[]] | null {
  if (node.type !== 'parametric') return null
  const kind = registry.parametric.get(node.kind)
  const span = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!span) return null
  const host = hostWall(doc, node, registry)
  if (!host) return null
  // An opening sits in the middle of its wall's thickness.
  const half = host.thickness / 2
  const corners = [
    { x: span.from, y: -half },
    { x: span.to, y: -half },
    { x: span.to, y: half },
    { x: span.from, y: half },
  ]
  return [corners.map((p) => applyTransform(p, node))]
}

/** Everything visible in a page or component, bottom to top. */
/**
 * Whether something painted after the item `id` (stacked over it, in the order of the Structure
 * list) hides part of `box`: a filled shape or a picture whose box meets it. What the editor shows
 * over a view, its name and its frame, would otherwise show through what covers it.
 */
export function coveredInScene(scene: SceneItem[], id: string, box: Bounds): boolean {
  const at = scene.findIndex((item) => item.id === id)
  if (at < 0) return false
  for (let i = at + 1; i < scene.length; i++) {
    const item = scene[i]
    if (item.foreign || !item.bounds || !boundsTouch(item.bounds, box)) continue
    const hides = item.prims.some((p) => !p.screen && (p.kind === 'image' || ((p.kind === 'ellipse' || (p.kind === 'path' && p.closed)) && p.fill !== undefined && p.fill !== 'none')))
    if (hides) return true
  }
  return false
}

export function buildScene(doc: Document, containerId: string, registry: Registry, previous?: { doc: Document; scene: SceneItem[] }): SceneItem[] {
  return span('scene', () => sceneOf(doc, containerId, registry, previous))
}

/**
 * What else in the drawing each type of thing is drawn from, by type: a wall from the walls it
 * meets, a room from the walls and dividers round it, a door or anything placed from the wall it is
 * in or against; a sheet from the pages, sheets and components it shows names of; a text from the
 * pages it may name; a link from what it joins; a table of quantities from what it counts. Not
 * listed: drawn from itself alone. A view is drawn from all of the plan it looks at (`ANYTHING`).
 */
const WALLS = ['wall', 'divider', 'parametric']
const DRAWN_FROM: Record<string, string[]> = {
  wall: WALLS,
  room: WALLS,
  divider: WALLS,
  parametric: WALLS,
  paper: ['page', 'paper', 'component'],
  text: ['page'],
  link: ['parametric', 'instance'],
  // What it counts: walls, floors, doors and windows, objects placed, and what holds or hides them.
  table: ['wall', 'divider', 'room', 'parametric', 'instance', 'group', 'component', 'page', 'paper'],
}
const ANYTHING = new Set(['elevation', 'camera', 'autodimensions'])

/** The types of the nodes that differ between two states of the drawing, the one before and the one after alike. */
function changedTypes(before: Document, after: Document): Set<string> {
  const types = new Set<string>()
  for (const id of Object.keys(after.nodes)) {
    const [was, now] = [before.nodes[id], after.nodes[id]]
    if (was !== now) {
      types.add(now.type)
      if (was) types.add(was.type)
    }
  }
  for (const id of Object.keys(before.nodes)) if (!after.nodes[id]) types.add(before.nodes[id].type)
  return types
}

/**
 * Whether the item of `node` in the scene of `before` is still right in `after`: the drawing's
 * settings, layers, styles, materials and the rest as they were; the node, all it holds and the
 * components it places the same objects (the drawing is immutable: what an edit leaves alone is
 * the same object); and nothing of a type they are drawn from changed (`DRAWN_FROM`, `changed`).
 */
function keepsItem(before: Document, after: Document, node: Node, changed: Set<string>): boolean {
  if (before.nodes[node.id] !== node) return false
  const seen = new Set<string>()
  const same = (id: string): boolean => {
    if (seen.has(id)) return true
    seen.add(id)
    const now = after.nodes[id]
    if (!now || before.nodes[id] !== now || ANYTHING.has(now.type)) return false
    if (DRAWN_FROM[now.type]?.some((type) => changed.has(type))) return false
    if (now.type === 'instance' && !same(now.component)) return false
    return childrenOf(after, id).every((child) => same(child.id)) && childrenOf(before, id).length === childrenOf(after, id).length
  }
  return same(node.id)
}

/** Whether all but the nodes of two states of the drawing are the same: settings, layers, styles, materials, colours. */
const sameSettings = (before: Document, after: Document) => Object.keys(after).every((key) => key === 'nodes' || (before as Record<string, unknown>)[key] === (after as Record<string, unknown>)[key])

function sceneOf(doc: Document, containerId: string, registry: Registry, previous?: { doc: Document; scene: SceneItem[] }): SceneItem[] {
  const ctx = { doc, registry, depth: 0 }
  // Kept only on the same page or group as it was: locked or hidden since, what it holds is not.
  const before = previous && previous.doc.nodes[containerId] === doc.nodes[containerId] && sameSettings(previous.doc, doc) ? new Map(previous.scene.map((item) => [item.id, item])) : undefined
  const changed = before ? changedTypes(previous!.doc, doc) : new Set<string>()
  // Each thing measured by its type (`draw wall`, `draw group`…), what it holds within it.
  const items = childrenOf(doc, containerId)
    .filter((node) => isVisible(doc, node))
    .map((node) => {
      const kept = before?.get(node.id)
      if (kept && keepsItem(previous!.doc, doc, node, changed)) {
        count('scene: kept as it was')
        return kept
      }
      const draw = () => itemOf(node, doc, registry, nodePrimitives(node, ctx))
      return profiling() ? span(`draw ${node.type}`, draw) : draw()
    })
  // The marks of the views shown on other pages that look at this one: on top, to be found.
  const foreign = viewsLookingAt(doc, containerId)
    .filter((node) => isVisible(doc, node))
    .map((node): SceneItem => ({ ...itemOf(node, doc, registry, nodePrimitives(node, { ...ctx, mark: true })), foreign: true }))
  const sheet = templateSheet(doc, containerId)
  // Inside a view, what it draws of the plan, in its coordinates: the ground what is drawn in it is
  // drawn on and snapped to, never picked (`viewBackdrop`).
  const container = doc.nodes[containerId]
  const backdrop = container?.type === 'elevation' ? [viewBackdrop(container, doc, registry)] : []
  return [...(sheet ? [sheet] : []), ...backdrop, ...items, ...foreign]
}

/**
 * What a view draws of the plan, brought into its own coordinates (along its line, up from its floor),
 * where what it holds is drawn: an item of its own id, locked, so that it is seen and snapped to but
 * not picked or moved.
 */
export function viewBackdrop(view: NodeOf<'elevation'>, doc: Document, registry: Registry): SceneItem {
  const { x, y, scale } = viewPlacement(view)
  const back = { x: -x / scale, y: -y / scale, scale: 1 / scale }
  const prims = nodePrimitives(view, { doc, registry, depth: 0, bare: true }).map((p) => transformPrimitive(p, back))
  return { id: `${view.id}:drawing`, node: view, prims, bounds: boundsOf(prims), locked: true }
}

/**
 * A scene as it is printed and exported: what is drawn only to work with in the editor (`screen`:
 * the eye of a viewpoint, the line of an elevation) left out, and an item that drew nothing else
 * with it, so that it neither shows nor counts in the box of what is drawn. With `marks`, the
 * person asked for them (Viewpoints and view lines, in the export window): kept, as on screen.
 */
export function printedScene(scene: SceneItem[], marks = false): SceneItem[] {
  if (marks || !scene.some((item) => item.prims.some((p) => p.screen))) return scene
  return scene.flatMap((item) => {
    const prims = printedPrims(item.prims)
    if (prims === item.prims) return [item]
    return prims.length === 0 ? [] : [{ ...item, prims, bounds: item.area ? item.area.reduce((b, outline) => unionBounds(b, boundsOfPoints(outline)), boundsOf(prims)) : boundsOf(prims) }]
  })
}

/**
 * The scene of a container after an edit that changed nothing but viewpoints in it, made from the
 * scene before (`buildScene` of `before`): a viewpoint's mark is drawn from itself alone, so only
 * those are drawn again, and dragging the view of one, which changes it at every step, does not
 * draw the whole plan again each time. Null when more changed: the scene is then built anew.
 */
export function sceneAfterViewpoints(before: Document, scene: SceneItem[], doc: Document, containerId: string, registry: Registry): SceneItem[] | null {
  if (before === doc) return scene
  // Everything but the nodes as it was: the layers, the colours, the materials, the settings.
  const keys = new Set([...Object.keys(before), ...Object.keys(doc)])
  for (const key of keys) if (key !== 'nodes' && (before as unknown as Record<string, unknown>)[key] !== (doc as unknown as Record<string, unknown>)[key]) return null
  const ids = Object.keys(doc.nodes)
  if (ids.length !== Object.keys(before.nodes).length) return null
  const changed = new Set<string>()
  for (const id of ids) {
    const [was, now] = [before.nodes[id], doc.nodes[id]]
    if (was === now) continue
    if (was?.type !== 'camera' || now.type !== 'camera' || was.parent !== now.parent || was.parent !== containerId || was.order !== now.order || was.visible !== now.visible || was.layer !== now.layer) return null
    changed.add(id)
  }
  if (changed.size === 0) return scene
  const ctx = { doc, registry, depth: 0 }
  let found = 0
  const out = scene.map((item) => {
    if (!changed.has(item.id)) return item
    found++
    const node = doc.nodes[item.id]
    return itemOf(node, doc, registry, nodePrimitives(node, ctx))
  })
  return found === changed.size ? out : null
}

/**
 * The scene of a component as its placements draw it, to show while it is being edited: what it
 * leaves unfilled is backed with white under all its lines (`objectBacking`), as one item that
 * cannot be picked up, so that what is see-through there is see-through where it is placed. The
 * scene of anything else is shown as it is.
 */
export function placedScene(doc: Document, containerId: string, scene: SceneItem[]): SceneItem[] {
  const container = doc.nodes[containerId]
  if (!container || !drawnSolid(doc, containerId)) return scene
  const prims = objectBacking(scene.flatMap((item) => item.prims))
  return prims.length === 0 ? scene : [{ id: `${containerId}:backing`, node: container, prims, bounds: boundsOf(prims), locked: true }, ...scene]
}

/**
 * What a group of the scene draws, each visible thing in it an item of its own, however deeply
 * it is grouped: for what must see inside groups, as lining a moved thing up with one wall of a
 * plan whose walls were grouped together, which the group's own box does not show.
 */
export function heldItems(doc: Document, groupId: string, registry: Registry): SceneItem[] {
  const ctx = { doc, registry, depth: 0 }
  const walk = (id: string): SceneItem[] =>
    childrenOf(doc, id)
      .filter((node) => isVisible(doc, node))
      .flatMap((node) => {
        if (node.type === 'group') return walk(node.id)
        return [itemOf(node, doc, registry, nodePrimitives(node, ctx))]
      })
  return walk(groupId)
}

/**
 * The sheet that what is on every sheet was drawn on, as it is in the hand, in millimetres, its
 * corner at the origin. It lies under that component while it is being edited, to show where
 * things fall on the sheet; it cannot be picked up.
 */
function templateSheet(doc: Document, componentId: string): SceneItem | null {
  const component = doc.nodes[componentId]
  if (component?.type !== 'component' || !component.sheet) return null
  const { width, height } = component.sheet
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  const prims: Primitive[] = [{ kind: 'path', points: corners, closed: true, fill: PAPER_FILL, stroke: PAPER_EDGE, backdrop: true }]
  return { id: `${componentId}:sheet`, node: component, prims, bounds: boundsOf(prims), locked: true }
}

export function boundsOf(prims: Primitive[]): Bounds | null {
  return prims.reduce<Bounds | null>((b, p) => unionBounds(b, primitiveBounds(p)), null)
}

export function sceneBounds(scene: SceneItem[]): Bounds | null {
  return scene.reduce<Bounds | null>((b, item) => unionBounds(b, item.bounds), null)
}

/** A component or an object is a thing, not a set of lines: inside one of its closed shapes is on it. */
const isSolid = (item: SceneItem) => item.node.type === 'instance' || item.node.type === 'parametric'

/** How far an item is from a point, as a click finds it: 0 on it or inside what it fills. */
function distToItem(item: SceneItem, p: Vec2): number {
  const solid = isSolid(item)
  let best = Infinity
  for (const prim of item.prims) {
    if (solid && insidePrimitive(prim, p)) return 0
    best = Math.min(best, distToPrimitive(prim, p))
    if (best === 0) return 0
  }
  return item.area?.some((outline) => pointInPolygon(p, outline)) ? 0 : best
}

/**
 * The unlocked item within `tolerance` of the point that is nearest it, the topmost of those as
 * near: a wall the pointer is on, not the words of a note a few pixels off, which are drawn over
 * it. What lies under must be nearer by a fifth of the tolerance to win, so that of two things
 * seen in the same place, the one on top is taken.
 */
export function hitTest(scene: SceneItem[], p: Vec2, tolerance: number): SceneItem | null {
  let best: SceneItem | null = null
  let nearest = Infinity
  for (let i = scene.length - 1; i >= 0 && nearest > 0; i--) {
    const item = scene[i]
    const box = item.reach ?? item.bounds
    if (item.locked || !box || !boundsContainPoint(box, p, tolerance)) continue
    const off = distToItem(item, p)
    if (off <= tolerance && (best === null || off < nearest - tolerance / 5)) {
      best = item
      nearest = off
    }
  }
  return best
}

/** Unlocked items lying entirely inside the rectangle. */
export function itemsInside(scene: SceneItem[], rect: Bounds): SceneItem[] {
  return scene.filter((item) => !item.locked && !item.foreign && item.bounds && boundsContain(rect, item.bounds))
}

/**
 * Unlocked items the rectangle touches: what a click somewhere in it would pick up (`hitTest`). It
 * goes by what is drawn, not by the box around it: a long diagonal line is not touched by a
 * rectangle in a corner of its box, nor a sheet by a rectangle on it.
 */
export function itemsTouching(scene: SceneItem[], rect: Bounds): SceneItem[] {
  const corner = { x: rect.minX, y: rect.minY }
  const touches = (prim: Primitive, solid: boolean) => primitiveTouches(prim, rect) || (solid && insidePrimitive(prim, corner))
  return scene.filter(
    (item) =>
      !item.locked &&
      !item.foreign &&
      item.bounds &&
      boundsTouch(rect, item.bounds) &&
      (item.prims.some((prim) => touches(prim, isSolid(item))) || (item.area ?? []).some((points) => touches({ kind: 'path', points, closed: true }, true))),
  )
}

export function snapPointsOf(item: SceneItem): Vec2[] {
  const own = kindOf(item.node).snapPoints?.(item.node)
  if (own) return own
  return item.prims.flatMap((p) => (p.kind === 'path' && !p.texture ? p.points : []))
}

export interface PaintStep {
  prim: Primitive
  stroke: boolean
  fill: boolean
  /** Multiplier on the stroke width. */
  widthScale: number
  /** Screen pixels added to the stroke width after scaling. */
  widthExtra: number
  /** Width in screen pixels of an extra stroke in the fill color, drawn with the fill. 0 for none. */
  seam: number
}

/** Fills that touch edge to edge leave an antialiasing hairline between them; this much overlap hides it. */
const SEAM = 0.8

/**
 * The order in which to paint primitives, given bottom to top. Merged shapes (walls) are painted
 * together: their fills, grown by a seam so that two touching leave no hairline between them, with
 * the patterns laid on them, then the outline of the whole, as plain lines centred on their edges
 * with what lies inside the mass left out (`mergedOutlines`). A pattern is painted after the
 * fills of its own key that follow it, so that walls of one material run on into each other with
 * no seam across their hatch, but before the fill of any shape of another key stacked over it,
 * which hides it as it should. They go where the first of
 * them is in the stacking order: what is stacked under every wall is painted under them, the rest
 * over them. Pictures keep their place
 * in the stacking order like anything else; one stacked under every floor, as a plan to trace is,
 * stays under the floors too.
 */
export function paintOrder(prims: Primitive[]): PaintStep[] {
  const isMerged = (p: Primitive) => p.kind === 'path' && !!p.union && !p.backdrop
  const backdrops = prims.filter((p) => p.backdrop === true)
  const floors = prims.filter((p) => p.backdrop === 'floor')
  const merged = prims.filter(isMerged)
  const first = prims.findIndex(isMerged)
  const firstFloor = prims.findIndex((p) => p.backdrop === 'floor')
  const traced = (p: Primitive, i: number) => p.kind === 'image' && i < firstFloor
  const images = prims.filter((p, i) => !p.backdrop && traced(p, i))
  const rest = prims.flatMap((p, i) => (!(p.kind === 'path' && p.union) && !p.backdrop && !traced(p, i) ? [{ p, under: i < first }] : []))
  const plain = (prim: Primitive): PaintStep => ({ prim, stroke: prim.kind !== 'image', fill: prim.kind !== 'image', widthScale: 1, widthExtra: 0, seam: 0 })
  // The fills of the merged shapes, each pattern (which follows the shape it is laid on) kept back
  // until a fill of another key comes, and painted under it.
  const masses: PaintStep[] = []
  let waiting: { key: string; prim: Primitive }[] = []
  let key: string | undefined
  for (const p of prims) {
    if (isMerged(p)) {
      key = (p as { union: string }).union
      const shown = waiting.filter((one) => one.key !== key)
      if (shown.length > 0) {
        masses.push(...shown.map((one) => plain(one.prim)))
        waiting = waiting.filter((one) => one.key === key)
      }
      masses.push({ prim: p, stroke: false, fill: true, widthScale: 1, widthExtra: 0, seam: SEAM })
    } else if (p.merged && !p.backdrop && key !== undefined) waiting.push({ key, prim: p })
  }
  masses.push(...waiting.map((one) => plain(one.prim)))
  return [
    // Sheets of paper lie under everything that is drawn on them.
    ...backdrops.map(plain),
    ...images.map(plain),
    ...floors.map(plain),
    ...rest.filter((one) => one.under).map((one) => plain(one.p)),
    ...masses,
    ...mergedOutlines(merged).map(plain),
    ...rest.filter((one) => !one.under && !one.p.merged).map((one) => plain(one.p)),
  ]
}
