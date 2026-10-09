import { importComponents, transplantOps } from './components'
import { colorsOf } from './colors'
import { childrenOf, createDocument, layersOf, leavesOf, pagesOf } from './document'
import type { Vec2 } from './geometry'
import { moveOps } from './kinds'
import { applyOps, OpError, type Op } from './ops'
import type { Document, Node } from './schema'

/**
 * Copies nodes into a small document of their own, together with the components, pictures and
 * layer names they need. That document is what goes on the clipboard: it is plain JSON, so it can
 * be pasted into another drawing, another window, or a text file.
 */
export function copyNodes(doc: Document, nodeIds: string[]): Document {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Nothing to copy')
  const nodes = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))

  // Everything the copies draw, to find which components and layers they rely on.
  const drawn = nodes.flatMap((n): Node[] => (n.type === 'group' ? leavesOf(doc, n.id) : [n]))
  const components = [...new Set(drawn.flatMap((n) => (n.type === 'instance' ? [n.component] : [])))]
  const layers = new Set(drawn.flatMap((n) => (n.layer ? [n.layer] : [])))

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
  // Only the picked nodes are taken from their parent, not their unpicked siblings.
  const { ops } = transplantOps(imported.doc, doc, first.parent, 'page_1', { components: imported.imported, only: picked })
  return applyOps(imported.doc, ops)
}

/** Whether some JSON is a document produced by `copyNodes`. */
export function isClipboard(doc: Document): boolean {
  return doc.name === 'Clipboard' && pagesOf(doc).length === 1
}

/**
 * Adds the contents of a clipboard document under `parent`, moved by `offset`. Components come
 * along (or are reused when they were pasted before); nodes go to the layer of the same name, or
 * to `fallbackLayer` when the drawing has none. Returns the ids of the pasted top-level nodes.
 */
export function pasteNodes(doc: Document, clip: Document, parent: string, offset: Vec2, fallbackLayer?: string): { doc: Document; ids: string[] } {
  const page = pagesOf(clip)[0]
  if (!page) throw new OpError('Nothing to paste')
  const withComponents = importComponents(doc, clip)
  const { ops, top } = transplantOps(withComponents.doc, clip, page.id, parent, { components: withComponents.imported, fallbackLayer })
  let pasted = applyOps(withComponents.doc, ops)
  pasted = applyOps(pasted, top.flatMap((id) => moveOps(pasted, pasted.nodes[id], offset)))
  return { doc: pasted, ids: top }
}
