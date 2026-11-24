import { importComponents, transplantOps } from './components'
import { colorsOf } from './colors'
import { childrenOf, createDocument, layersOf, leavesOf, pagesOf, rootOf } from './document'
import { lookedAt } from './elevation'
import { unionBounds, type Bounds, type Transform, type Vec2 } from './geometry'
import { frameHeight } from './camera'
import { moveOps } from './kinds'
import { linksAt } from './networks'
import { applyOps, OpError, type Op } from './ops'
import type { Registry } from './registry'
import { buildScene, sceneBounds } from './scene'
import type { Document, Node } from './schema'
import { transformOps } from './transform'

/** The page in which clipboards made before 2.2 held the lines their views were of: such a clipboard still pastes. */
const LINES_PAGE = 'Lines of the views'

/**
 * Copies nodes into a small document of their own, together with the components, pictures and
 * layer names they need. That document is what goes on the clipboard: it is plain JSON, so it can
 * be pasted into another drawing, another window, or a text file.
 * A view holds its line; the clipboard says which page's plan each view copied looks at
 * (`meta.looking`, by the id of its copy: a page of the drawing, which the clipboard has not), so
 * that pasted alone, anywhere, it still looks where it did (`pasteNodes`).
 */
export function copyNodes(doc: Document, nodeIds: string[]): Document {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Nothing to copy')
  const nodes = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))

  // Everything the copies draw, to find which components and layers they rely on.
  const held = nodes.flatMap((n): Node[] => (n.type === 'group' ? leavesOf(doc, n.id) : [n]))
  // The links between two objects copied come along, picked or not: a switch and its lights copied together stay linked.
  const ends = new Set(held.map((n) => n.id))
  const joining = linksAt(doc, ends).filter((link) => ends.has(link.from) && ends.has(link.to) && !ends.has(link.id) && link.parent === first.parent)
  for (const link of joining) picked.add(link.id)
  nodes.push(...joining)
  // What a view holds (its dimensions, its notes) is copied with it, and needs its layers too.
  held.push(...held.flatMap((n) => (n.type === 'elevation' ? childrenOf(doc, n.id) : [])))
  const all = [...held, ...joining]
  const components = [...new Set(all.flatMap((n) => (n.type === 'instance' ? [n.component] : [])))]
  const layers = new Set(all.flatMap((n) => (n.layer ? [n.layer] : [])))

  let clip = createDocument('Clipboard')
  clip = applyOps(clip, [
    { op: 'update_layer', id: 'layer_1', patch: { name: '' } },
    // Shared colours go along whole: they are small, and a layer or a copied node may refer to any of them.
    ...colorsOf(doc).map((color): Op => ({ op: 'add_color', color })),
    ...layersOf(doc)
      .filter((l) => layers.has(l.id))
      .map((l): Op => ({ op: 'add_layer', layer: { name: l.name, color: l.color } })),
  ])
  const imported = importComponents(clip, doc, components)
  const options = { components: imported.imported }
  // Only the picked nodes are taken from their parent, not their unpicked siblings.
  const main = transplantOps(imported.doc, doc, first.parent, 'page_1', { ...options, only: picked })
  // The views look at the clipboard's own page there; which page of the drawing each looked at is said beside.
  const looking: Record<string, string> = {}
  for (const n of held) {
    const view = n.type === 'elevation' || n.type === 'camera'
    const copy = view ? main.ids.get(n.id) : undefined
    const page = view ? lookedAt(doc, n) : null
    if (copy && page) looking[copy] = page
  }
  const copied = applyOps(imported.doc, main.ops.map(withoutPage))
  return Object.keys(looking).length > 0 ? { ...copied, meta: { ...copied.meta, looking } } : copied
}

/** A view added looking at the page it is added on: the page it looked at is said apart (`meta.looking`). */
function withoutPage(op: Op): Op {
  if (op.op !== 'add_node' || (op.node.type !== 'elevation' && op.node.type !== 'camera') || !('page' in op.node)) return op
  const { page: _, ...node } = op.node
  return { ...op, node } as Op
}

/** Whether some JSON is a document produced by `copyNodes`. */
export function isClipboard(doc: Document): boolean {
  const pages = pagesOf(doc)
  return doc.name === 'Clipboard' && (pages.length === 1 || (pages.length === 2 && pages[1].name === LINES_PAGE))
}

/**
 * Adds the contents of a clipboard document under `parent`, moved by `offset`. Components come
 * along (or are reused when they were pasted before); nodes go to the layer of the same name, or
 * to `fallbackLayer` when the drawing has none. A view pasted with walls looks at them, its line
 * moved as they are; pasted alone, it looks where it did, at the plan of the page it was copied
 * from while the drawing has it, else at the page it is pasted on, from the same place.
 * Returns the new document, the operations that make it, and the ids of the pasted top-level nodes.
 */
export function pasteNodes(doc: Document, clip: Document, parent: string, offset: Vec2, fallbackLayer?: string): { doc: Document; ops: Op[]; ids: string[] } {
  const [page] = pagesOf(clip)
  if (!page) throw new OpError('Nothing to paste')
  const withComponents = importComponents(doc, clip)
  const options = { components: withComponents.imported, fallbackLayer, onTop: true }
  // What is pasted is new where it lands: on top, as anything drawn there next would be. A view
  // goes in looking at the page it is pasted on, and is told another below.
  const { ops: added, top, ids } = transplantOps(withComponents.doc, clip, page.id, parent, options)
  const ops = added.map(withoutPage)
  let pasted = applyOps(withComponents.doc, ops)
  const moves = top.flatMap((id) => moveOps(pasted, pasted.nodes[id], offset))
  pasted = applyOps(pasted, moves)
  const copied = leavesOf(clip, page.id)
  const withWalls = copied.some((n) => n.type === 'wall')
  const here = rootOf(pasted, parent)?.id
  const pages = (clip.meta?.looking ?? {}) as Record<string, unknown>
  const looking = copied.flatMap((view): Op[] => {
    const id = view.type === 'elevation' || view.type === 'camera' ? ids.get(view.id) : undefined
    if (!id || (view.type !== 'elevation' && view.type !== 'camera')) return []
    // A viewpoint's view is its frame, which lands where the paste does; its eye goes only with the walls.
    const frame = view.type === 'camera' && view.frame ? { frame: { ...view.frame, x: view.frame.x + offset.x, y: view.frame.y + offset.y } } : {}
    if (withWalls) return [{ op: 'update_node', id, patch: { a: { x: view.a.x + offset.x, y: view.a.y + offset.y }, b: { x: view.b.x + offset.x, y: view.b.y + offset.y }, ...frame } }]
    const page = pages[view.id]
    const elsewhere = typeof page === 'string' && page !== here && pasted.nodes[page]?.type === 'page' ? { page } : {}
    // Moved as everything pasted is, a viewpoint's eye goes back where it was: it looks where it did.
    const eye = view.type === 'camera' ? { a: view.a, b: view.b } : {}
    return Object.keys({ ...elsewhere, ...eye, ...frame }).length > 0 ? [{ op: 'update_node', id, patch: { ...elsewhere, ...eye, ...frame } }] : []
  })
  pasted = applyOps(pasted, looking)
  return { doc: pasted, ops: [...withComponents.ops, ...ops, ...moves, ...looking], ids: top }
}

/** A point that tells where a node is, to know whether two nodes of the same kind lie in the same place. */
function anchor(doc: Document, node: Node): Vec2 | null {
  if ('a' in node) return node.a
  if ('x' in node && 'y' in node) return { x: node.x, y: node.y }
  if (node.type === 'ellipse') return { x: node.cx, y: node.cy }
  if (node.type === 'polyline') return node.points[0]
  if (node.type === 'group') {
    const first = leavesOf(doc, node.id)[0]
    return first ? anchor(doc, first) : null
  }
  return null
}

/**
 * Where to paste what a clipboard holds, as the offset to move it by, so that it lands where the
 * person is looking:
 * - with `at` (a right-click on the drawing), its middle goes there;
 * - when the place it was copied from is in view (`visible`), it goes back there: a cut thing
 *   returns exactly to its place;
 * - otherwise its middle goes to the middle of the view.
 * Wherever that is, if it would lie exactly on the same things already there (the original of a
 * copy, an earlier paste), it is moved on by `step` along both axes until it does not. Offsets are
 * whole multiples of `step`, so what was on the grid stays on it.
 */
export function pasteOffset(doc: Document, clip: Document, scope: string, registry: Registry, place: { visible: Bounds | null; step: number; at?: Vec2 }): Vec2 {
  const page = pagesOf(clip)[0]
  // A viewpoint is where its view is, its frame: what a paste puts in sight.
  const box = page
    ? buildScene(clip, page.id, registry).reduce<Bounds | null>((all, item) => {
        const frame = item.node.type === 'camera' && item.node.frame
        return unionBounds(all, frame ? { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frameHeight(frame) } : item.bounds)
      }, null)
    : null
  if (!page || !box) return { x: 0, y: 0 }
  const { visible, step, at } = place
  const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const whole = (v: number) => Math.round(v / step) * step
  const seen = visible && middle.x >= visible.minX && middle.x <= visible.maxX && middle.y >= visible.minY && middle.y <= visible.maxY
  const target = at ?? (seen || !visible ? middle : { x: (visible.minX + visible.maxX) / 2, y: (visible.minY + visible.maxY) / 2 })
  const start = at || !seen ? { x: whole(target.x - middle.x), y: whole(target.y - middle.y) } : { x: 0, y: 0 }

  // What is already here, by kind and place.
  const here = childrenOf(doc, scope).flatMap((node) => {
    const p = anchor(doc, node)
    return p ? [{ type: node.type, p }] : []
  })
  const pasted = childrenOf(clip, page.id).flatMap((node) => {
    const p = anchor(clip, node)
    return p ? [{ type: node.type, p }] : []
  })
  const covered = (d: Vec2) =>
    pasted.length > 0 && pasted.every((item) => here.some((other) => other.type === item.type && Math.abs(other.p.x - item.p.x - d.x) < 0.5 && Math.abs(other.p.y - item.p.y - d.y) < 0.5))
  let d = start
  for (let tries = 0; tries < 50 && covered(d); tries++) d = { x: d.x + step, y: d.y + step }
  return d
}

/*
 * Where something was seen when it was copied. Inside a component opened from one of its
 * placements, what is drawn sits in the component's own terms; seen on the page, it is where that
 * placement (and the placements it is inside) put it. A clipboard says through which placements
 * its contents were seen, so that pasting puts them where they were seen: cut out of a component
 * and pasted on the page, a thing lands where the component drew it.
 */

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

/** The placements, outermost first, through which a clipboard's contents were seen: none when copied from a page, null when not known. */
export function clipPlacement(clip: Document): Transform[] | null {
  const placement = clip.meta?.placement
  if (!Array.isArray(placement)) return null
  const valid = placement.every((t) => typeof t === 'object' && t !== null && finite(t.x) && finite(t.y) && (t.rotation === undefined || finite(t.rotation)) && (t.scale === undefined || (finite(t.scale) && t.scale > 0)))
  return valid ? placement.map(({ x, y, rotation, flipX, scale }: Transform) => ({ x, y, rotation, flipX: flipX === true, scale })) : null
}

/** A clipboard that says through which placements its contents were seen. */
export function withPlacement(clip: Document, placement: Transform[] | null): Document {
  return placement ? { ...clip, meta: { ...clip.meta, placement } } : clip
}

const ORIGIN = { x: 0, y: 0 }

/** The clipboard's contents taken through one placement: out of the component onto where it is placed, or, `inverse`, back in. */
function carry(clip: Document, page: string, t: Transform, registry: Registry, inverse: boolean): Document {
  const top = (doc: Document) => childrenOf(doc, page)
  const shift = (doc: Document, d: Vec2) => applyOps(doc, top(doc).flatMap((node) => moveOps(doc, node, d)))
  if (!inverse) {
    // As an instance draws: mirrored, sized and turned about its insertion point, which is where the component's origin goes.
    const moved = shift(clip, { x: t.x, y: t.y })
    return applyOps(moved, transformOps(moved, top(moved), { pivot: { x: t.x, y: t.y }, mirror: t.flipX, rotation: t.rotation, scale: t.scale }, registry))
  }
  // The same undone, last step first: brought back to the origin, turned and sized back, then mirrored back.
  const back = shift(clip, { x: -t.x, y: -t.y })
  const turned = applyOps(back, transformOps(back, top(back), { pivot: ORIGIN, rotation: -(t.rotation ?? 0), scale: 1 / (t.scale ?? 1) }, registry))
  return t.flipX ? applyOps(turned, transformOps(turned, top(turned), { pivot: ORIGIN, mirror: true }, registry)) : turned
}

/**
 * What a clipboard holds, moved from where it was seen through the placements `from` to the same
 * place as seen through `to` (each outermost first): out of the components it was copied from,
 * then into the one it is pasted in.
 */
export function relocateClip(clip: Document, from: Transform[], to: Transform[], registry: Registry): Document {
  const page = pagesOf(clip)[0]
  if (!page) return clip
  let out = clip
  for (const t of [...from].reverse()) out = carry(out, page.id, t, registry, false)
  for (const t of to) out = carry(out, page.id, t, registry, true)
  return out
}
