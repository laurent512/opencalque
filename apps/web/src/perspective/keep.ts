import { lookedAt, massing, newId, rootOf, type Camera, type Document, type Op, type Solid } from '@opencalque/core'
import { registry } from '../extensions'
import { t } from '../i18n'
import { usePrefs } from '../prefs'
import { keep, useStore } from '../store'
import { frameShown, type Look } from './seen'

/*
 * The picture each 3D view keeps of itself in the drawing (`picture` on its viewpoint, an asset):
 * what prints and exports in its frame, and what the CLI and an agent see of it, as none of them can
 * draw it. Made again before the drawing is saved or exported, when it changed since the last time.
 */

/** The long side of the picture a view keeps, in pixels: sharp on an A3 sheet, small enough to keep in the file. */
const KEPT_SIDE = 1600

/**
 * A view drawn on a canvas of its own, as a PNG `longSide` pixels on its long side, of the shape of
 * its frame (`r`, its width over its height): drawn `sharp` times as large, then made smaller, for
 * smooth lines (twice for a picture saved or copied; once for the one kept, made at each save).
 */
export async function viewPicture(doc: Document, camera: Camera, look: Look, r: number, longSide: number, sharp = 2, solids = seenBy(doc, camera)): Promise<{ blob: Blob; width: number; height: number }> {
  if (!solids) throw new Error(t('The picture could not be made.'))
  const { PerspectiveView: View } = await import('./render')
  const [width, height] = r >= 1 ? [longSide, Math.round(longSide / r)] : [Math.round(longSide * r), longSide]
  const big = document.createElement('canvas')
  const view = new View(big)
  try {
    view.setSolids(solids)
    view.render(camera, look, width * sharp, height * sharp, sharp)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const context = out.getContext('2d')!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(big, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error(t('The picture could not be made.'))
    return { blob, width, height }
  } finally {
    view.dispose()
  }
}

/** What a viewpoint sees: the plan it looks at raised to its heights; none when it looks at no page. */
function seenBy(doc: Document, camera: Camera): Solid[] | null {
  const page = rootOf(doc, lookedAt(doc, camera))
  return page ? massing(doc, page.id, registry, [camera.a], camera.a) : null
}

/** A blob's bytes in base64, as assets keep them. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** The state of the drawing the pictures were last made for, and in what look: nothing to make again while it is the same. */
let keptFor: { nodes: Document['nodes']; look: Look } | null = null
/** What each view's kept picture was made of (where it stands and looks, its shape, its look, what it sees), by its picture: not made again while that is the same. */
const madeOf = new Map<string, string>()

/**
 * Makes again the picture each 3D view of the drawing keeps (`picture`), and gives a view with no
 * frame of its own the one it is shown in, so that it prints there: outside the history (`keep`).
 * Nothing when the drawing did not change since, nor while a gesture is under way, nor when it
 * changes while the pictures are made (they would be of what it was). A view that cannot be drawn
 * (no WebGL) keeps what it had.
 */
export async function keepViewPictures(): Promise<void> {
  const { doc, base } = useStore.getState()
  const cameras = Object.values(doc.nodes).filter((node): node is Camera => node.type === 'camera')
  if (base || cameras.length === 0) return
  const look = usePrefs.getState().perspective.look as Look
  if (keptFor?.nodes === doc.nodes && keptFor.look === look) return
  const ops: Op[] = []
  for (const camera of cameras) {
    const frame = frameShown(doc, camera)
    const framed = camera.frame ? {} : { frame }
    const solids = seenBy(doc, camera)
    if (!solids) continue
    const r = frame.width / frame.height
    const of = JSON.stringify([camera.a, camera.b, camera.fov, camera.eyeHeight, camera.pitch, Math.round(r * 1000), look, solids])
    // Seeing what it saw when its picture was made, as it saw it: the picture it keeps is right.
    if (camera.picture && doc.assets?.[camera.picture] && madeOf.get(camera.picture) === of) {
      if (!camera.frame) ops.push({ op: 'update_node', id: camera.id, patch: framed })
      continue
    }
    let made: Awaited<ReturnType<typeof viewPicture>>
    try {
      made = await viewPicture(doc, camera, look, r, KEPT_SIDE, 1, solids)
    } catch {
      continue
    }
    const data = await base64(made.blob)
    if (camera.picture && doc.assets?.[camera.picture]?.data === data) {
      madeOf.set(camera.picture, of)
      if (!camera.frame) ops.push({ op: 'update_node', id: camera.id, patch: framed })
      continue
    }
    const id = newId('asset')
    madeOf.set(id, of)
    ops.push({ op: 'add_asset', asset: { id, mime: 'image/png', data, width: made.width, height: made.height } }, { op: 'update_node', id: camera.id, patch: { picture: id, ...framed } })
  }
  if (useStore.getState().doc !== doc) return
  if (ops.length > 0 && !keep(ops)) return
  keptFor = { nodes: useStore.getState().doc.nodes, look }
}
