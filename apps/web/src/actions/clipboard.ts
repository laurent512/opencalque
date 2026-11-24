import { buildScene, viewPlacement, clipPlacement, copyNodes, isClipboard, paperContents, parseDocument, pasteNodes, pasteOffset, relocateClip, removeOps, rootOf, sceneBounds, toSVG, withPlacement, type Document, type Node, type Op, type Transform } from '@opencalque/core'
import { registry } from '../extensions'
import { placePicture } from '../floorplan'
import { t } from '../i18n'
import { apply, select, useStore } from '../store'
import { gridStep, visibleArea } from '../view'
import { toast } from '../windows'
import { guarded } from './common'
import { svgToCanvas } from './file'

/* Cut, copy and paste, through the system clipboard. */

const get = useStore.getState

// Kept as well as the system clipboard, which a browser may refuse to let a page read.
let lastCopy = ''
// The copy still being written to the system clipboard (its picture takes a moment), and whether
// it is still being written: a paste meanwhile takes `lastCopy`, which is what is going there.
let writing: Promise<void> = Promise.resolve()
let pending = false

/**
 * The given objects plus everything lying on any paper among them. A paper is copied, cut and
 * duplicated with what is on it; moving or transforming it leaves the drawing where it is.
 */
export function withPaperContents(ids: string[]): string[] {
  const { doc, scope } = get()
  if (!ids.some((id) => doc.nodes[id]?.type === 'paper')) return ids
  const scene = buildScene(doc, scope, registry)
  return [...new Set(ids.flatMap((id) => [id, ...paperContents(scene, id)]))]
}

/**
 * The component placements, outermost first, through which what is being edited is seen on its
 * page: none on a page (or in a group on one); for a component opened by double-clicking one of its
 * placements, that placement and the ones it is inside. Null for a component opened some other
 * way (from the library), which is seen nowhere in particular.
 */
function scopePlacement(): Transform[] | null {
  const { doc, scope, through } = get()
  // Inside a view: placed where the view draws what it holds, and as large.
  const inside = doc.nodes[scope]
  if (inside?.type === 'elevation') return [viewPlacement(inside)]
  if (rootOf(doc, scope)?.type === 'page') return []
  const chain = (through ?? []).map((id) => doc.nodes[id])
  if (chain.length === 0 || chain.some((node) => node?.type !== 'instance')) return null
  return chain.map((node) => {
    const { x, y, rotation, flipX, scale } = node as Extract<Node, { type: 'instance' }>
    return { x, y, rotation, flipX, scale }
  })
}

/** The size, in pixels along its longer side, of the picture a copy puts on the clipboard. */
const COPY_PIXELS = 2000

/**
 * A picture of what a clipboard document holds, drawn as the PNG export draws a page: on white,
 * with a margin; pictures alone are cropped to themselves, so a photo copied comes out as it is.
 */
async function pictureOf(clip: Document): Promise<Blob> {
  const page = 'page_1'
  const top = Object.values(clip.nodes).filter((node) => node.parent === page)
  const area = top.length > 0 && top.every((node) => node.type === 'image') ? (sceneBounds(buildScene(clip, page, registry)) ?? undefined) : undefined
  const canvas = await svgToCanvas(toSVG(clip, page, registry, { area }), COPY_PIXELS)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The copied picture could not be made.')
  return blob
}

/**
 * The drawing's own format on the clipboard: a web custom format, which other programs do not
 * read, so that a copy pasted into a chat, a mail or a document is the picture alone.
 */
const DRAWING_TYPE = 'web application/x-opencalque'

/**
 * Puts a copy on the system clipboard: the drawing in its own format (`DRAWING_TYPE`), which
 * pastes into another drawing or another window, and a picture of it for every other program. A
 * browser without custom formats (Firefox, Safari) gets the drawing as text beside the picture,
 * since a picture alone would paste back as a picture; one that takes no picture, the text alone.
 */
async function writeClipboard(clip: Document, text: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard) return
  // The picture is given as a promise, so that the browser still counts the write as asked for by the key or the menu.
  const picture = pictureOf(clip)
  picture.catch(() => {})
  // Each blob's type must be the format it is given as.
  const as = (type: string) => new Blob([text], { type })
  const tries: Record<string, Blob | Promise<Blob>>[] = typeof ClipboardItem === 'undefined' || !clipboard.write ? [] : [{ [DRAWING_TYPE]: as(DRAWING_TYPE), 'image/png': picture }, { 'text/plain': as('text/plain'), 'image/png': picture }]
  for (const items of tries) if (await clipboard.write([new ClipboardItem(items)]).then(() => true, () => false)) return
  await clipboard.writeText(text).catch(() => {})
}

/** Copies the selection, so it can be pasted into another drawing or another window, and as a picture anywhere else. */
export const copySelection = () =>
  guarded(async () => {
    const { doc, selection } = get()
    if (selection.length === 0) return
    // It says where it was seen, so that pasted elsewhere (out of a component, onto the page) it lands there.
    const clip = withPlacement(copyNodes(doc, withPaperContents(selection)), scopePlacement())
    lastCopy = JSON.stringify(clip)
    pending = true
    const thisOne = (writing = writeClipboard(clip, lastCopy).finally(() => {
      if (writing === thisOne) pending = false
    }))
    await writing
  })

export const cutSelection = () =>
  guarded(async () => {
    // What was copied is what goes: a paper is cut together with what is on it. It goes at once:
    // only the system clipboard is waited for, and a key pressed meanwhile (Esc, to leave a
    // component) must not find it still there, nor change what is cut.
    const ids = withPaperContents(get().selection)
    if (ids.length === 0) return
    const writing = copySelection()
    apply(removeOps(get().doc, ids))
    await writing
  })

/**
 * What the system clipboard holds: its text, and the picture on it when there is one (copied from
 * a web page, or a screenshot). Both empty when the browser does not let the page read it.
 */
async function readClipboard(): Promise<{ text: string; picture: Blob | null }> {
  const clipboard = navigator.clipboard
  if (!clipboard) return { text: '', picture: null }
  // All of it at once, which asks once; a browser that will not is asked for the text alone.
  const items = await clipboard.read?.().catch(() => null)
  if (!items) return { text: await clipboard.readText().catch(() => ''), picture: null }
  let text = ''
  let picture: Blob | null = null
  for (const item of items) {
    if (item.types.includes(DRAWING_TYPE) && !text) text = await item.getType(DRAWING_TYPE).then((blob) => blob.text(), () => '')
    const image = item.types.find((type) => type.startsWith('image/'))
    if (image && !picture) picture = await item.getType(image).catch(() => null)
    if (item.types.includes('text/plain') && !text) text = await item.getType('text/plain').then((blob) => blob.text(), () => '')
  }
  return { text, picture }
}

/** The clipboard document a text holds, or null when it is not one. */
function clipOf(text: string): Document | null {
  try {
    const clip = parseDocument(JSON.parse(text))
    return isClipboard(clip) ? clip : null
  } catch {
    return null
  }
}

/**
 * Pastes what is on the clipboard where the person is looking (see `pasteOffset`): where it was
 * when that is in view, beside it when the original is still there, else in the middle of the
 * view; chosen from the right-click menu, where the menu was opened. `inPlace` puts it exactly
 * where it was copied from, in view or not, which carries a thing to the same place on another page.
 * A picture copied in another program is pasted as it is (`placePicture`), at the same place.
 */
export const paste = (inPlace = false) => {
  // Read now, before the clipboard is: the menu that set it is gone by the time that answers.
  const at = get().menuPoint ?? undefined
  return guarded(async () => {
    // A copy made just before is on the clipboard only once its picture is, which on a slow
    // computer takes seconds: meanwhile what is going there is pasted, without waiting for it.
    const { text, picture } = pending ? { text: lastCopy, picture: null } : await readClipboard()
    if (!clipOf(text) && picture) return placePicture(new Uint8Array(await picture.arrayBuffer()), at)
    let clip = clipOf(text || lastCopy)
    if (!clip) return toast(t('There is nothing from OpenCalque on the clipboard.'))
    // Taken from where it was seen to the same place as seen from here: out of a component it was cut from, onto the page.
    const from = clipPlacement(clip)
    const to = scopePlacement()
    if (from && to) clip = relocateClip(clip, from, to, registry)
    const { doc, scope, activeLayer, view, viewport } = get()
    const visible = visibleArea(view, viewport)
    // A step that shows at any zoom (two grid steps are at least 16 pixels) and keeps the grid.
    const offset = inPlace ? { x: 0, y: 0 } : pasteOffset(doc, clip, scope, registry, { visible, step: 2 * gridStep(view.zoom, doc.settings?.grid), at })
    const result = pasteNodes(doc, clip, scope, offset, activeLayer)
    if (apply(result.ops)) select(result.ids)
  })
}
