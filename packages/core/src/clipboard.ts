import { importComponents, transplantOps } from './components'
import { colorsOf } from './colors'
import { childrenOf, createDocument, layersOf, leavesOf, pagesOf } from './document'
import { lineOf, viewsOf } from './elevation'
import type { Bounds, Transform, Vec2 } from './geometry'
import { moveOps } from './kinds'
import { applyOps, OpError, type Op } from './ops'
import type { Registry } from './registry'
import { buildScene, sceneBounds } from './scene'
import type { Document, Node, NodeOf } from './schema'
import { transformOps } from './transform'

/** The page of a clipboard that holds the lines its views are of, copied without them: they are not pasted, but referred to. */
const LINES_PAGE = 'Lines of the views'

/**
 * Copies nodes into a small document of their own, together with the components, pictures and
 * layer names they need. That document is what goes on the clipboard: it is plain JSON, so it can
 * be pasted into another drawing, another window, or a text file.
 * A view line takes its views along, wherever they are: the copy of a line is a line with views of
 * its own. A view copied without its line keeps referring to it: the line goes on a page of its
 * own (`LINES_PAGE`), under its own id, and the paste makes the new view a view of that line when
 * the drawing still has it, which stays where it is (copying a view, as cutting it, never moves
 * the line it is drawn from).
 */
export function copyNodes(doc: Document, nodeIds: string[]): Document {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Nothing to copy')
  const nodes = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))

  // Everything the copies draw, to find which components and layers they rely on.
  const drawn = nodes.flatMap((n): Node[] => (n.type === 'group' ? leavesOf(doc, n.id) : [n]))
  const copied = new Set(drawn.map((n) => n.id))
  const along = drawn.flatMap((n) => (n.type === 'viewline' ? viewsOf(doc, n.id).filter((view) => !copied.has(view.id)) : []))
  const referred = [...new Map([...drawn, ...along].flatMap((n): [string, NodeOf<'viewline'>][] => {
    const line = n.type === 'elevation' ? lineOf(doc, n) : null
    return line && !copied.has(line.id) ? [[line.id, line]] : []
  })).values()]
  const all = [...drawn, ...along, ...referred]
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
  // The lines referred to first, so that the views copied have them.
  const lines: Op[] = []
  if (referred.length > 0) {
    lines.push({ op: 'add_node', node: { id: 'lines', type: 'page', name: LINES_PAGE, parent: null } })
    for (const [parent, ids] of byParent(referred)) lines.push(...transplantOps(imported.doc, doc, parent, 'lines', { ...options, only: ids, keep: ids }).ops)
  }
  // Only the picked nodes are taken from their parent, not their unpicked siblings.
  const main = transplantOps(imported.doc, doc, first.parent, 'page_1', { ...options, only: picked })
  const views = [...byParent(along)].flatMap(([parent, ids]) => transplantOps(imported.doc, doc, parent, 'page_1', { ...options, only: ids, lines: main.ids }).ops)
  return applyOps(imported.doc, [...lines, ...main.ops, ...views])
}

/** Nodes by their parent, as the ids of those under each. */
function byParent(nodes: Node[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const node of nodes) {
    if (node.parent === null) continue
    const ids = out.get(node.parent) ?? new Set<string>()
    ids.add(node.id)
    out.set(node.parent, ids)
  }
  return out
}

/** Whether some JSON is a document produced by `copyNodes`. */
export function isClipboard(doc: Document): boolean {
  const pages = pagesOf(doc)
  return doc.name === 'Clipboard' && (pages.length === 1 || (pages.length === 2 && pages[1].name === LINES_PAGE))
}

/**
 * Adds the contents of a clipboard document under `parent`, moved by `offset`. Components come
 * along (or are reused when they were pasted before); nodes go to the layer of the same name, or
 * to `fallbackLayer` when the drawing has none. A view copied without its line is a view of that
 * line, where it is, when the drawing has it still; else the line comes too, where it was.
 * Returns the new document, the operations that make it, and the ids of the pasted top-level nodes.
 */
export function pasteNodes(doc: Document, clip: Document, parent: string, offset: Vec2, fallbackLayer?: string): { doc: Document; ops: Op[]; ids: string[] } {
  const [page, linesPage] = pagesOf(clip)
  if (!page) throw new OpError('Nothing to paste')
  const withComponents = importComponents(doc, clip)
  const options = { components: withComponents.imported, fallbackLayer, onTop: true }
  const lines = new Map<string, string>()
  const missing = new Set<string>()
  for (const line of linesPage?.name === LINES_PAGE ? childrenOf(clip, linesPage.id) : []) {
    if (withComponents.doc.nodes[line.id]?.type === 'viewline') lines.set(line.id, line.id)
    else missing.add(line.id)
  }
  const brought = missing.size > 0 ? transplantOps(withComponents.doc, clip, linesPage!.id, parent, { ...options, only: missing }) : { ops: [], ids: new Map<string, string>() }
  for (const [from, to] of brought.ids) lines.set(from, to)
  // What is pasted is new where it lands: on top, as anything drawn there next would be.
  const { ops, top } = transplantOps(withComponents.doc, clip, page.id, parent, { ...options, lines })
  let pasted = applyOps(withComponents.doc, [...brought.ops, ...ops])
  const moves = top.flatMap((id) => moveOps(pasted, pasted.nodes[id], offset))
  pasted = applyOps(pasted, moves)
  return { doc: pasted, ops: [...withComponents.ops, ...brought.ops, ...ops, ...moves], ids: top }
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
  const box = page ? sceneBounds(buildScene(clip, page.id, registry)) : null
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
