import { buildScene, boundsContainPoint, childrenOf, dist, layersOf, newId, orderBefore, type Op, type Vec2 } from '@opencalque/core'
import { guarded, zoomToFit } from './actions'
import { showPanel } from './dock'
import { t } from './i18n'
import { platform } from './platform'
import { apply, registry, setTool, toast, useStore } from './store'

/** Largest side, in pixels, of the picture kept in the drawing. Bigger scans are scaled down. */
const MAX_PIXELS = 4096

interface Picture {
  canvas: HTMLCanvasElement
  /** A first guess at the width the picture covers, in mm. Calibration replaces it. */
  width: number
}

function blankCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const ctx = canvas.getContext('2d')!
  // Plans are stored as JPEG, which has no transparency: anything see-through becomes white paper.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return [canvas, ctx]
}

/** The first page of a PDF as a picture. A PDF knows its paper size, so the guess assumes it was drawn at 1:100. */
async function fromPdf(bytes: Uint8Array): Promise<Picture> {
  // Loaded on demand: the PDF library is larger than the rest of the app.
  const pdfjs = await import('pdfjs-dist')
  // Running the "worker" code on this thread avoids a separate worker file, which a desktop app
  // loaded from disk cannot always start. Rendering one page is quick enough.
  ;(globalThis as any).pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.mjs')
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const page = await pdf.getPage(1)
  const paper = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(4, MAX_PIXELS / Math.max(paper.width, paper.height)) })
  const [canvas, ctx] = blankCanvas(viewport.width, viewport.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  const pages = pdf.numPages
  if (pages > 1) toast(t('This PDF has {n} pages; the first one was imported.', { n: pages }))
  return { canvas, width: ((paper.width * 25.4) / 72) * 100 }
}

async function fromImage(bytes: Uint8Array): Promise<Picture> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  const scale = Math.min(1, MAX_PIXELS / Math.max(bitmap.width, bitmap.height))
  const [canvas, ctx] = blankCanvas(bitmap.width * scale, bitmap.height * scale)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { canvas, width: 10000 }
}

/** The kinds of file that can be brought in as a plan to trace, by extension. */
export const PLAN_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']

/** Asks for a picture or a PDF and brings it in as a plan to trace. */
export const importFloorPlan = () =>
  guarded(async () => {
    const file = await platform.openBytes(PLAN_EXTENSIONS)
    if (file) await placeFloorPlan(file)
  })

/**
 * Brings a scanned or exported plan into the drawing as a picture to trace over, then starts the
 * calibration tool so its scale can be set from a known distance. The picture is centred on `at`
 * (a point of the drawing, as when it was dropped there), or else on what is on screen.
 */
export async function placeFloorPlan(file: { name: string; bytes: Uint8Array }, at?: Vec2): Promise<void> {
  {
    const { canvas, width } = /\.pdf$/i.test(file.name) ? await fromPdf(file.bytes) : await fromImage(file.bytes)
    const height = (width * canvas.height) / canvas.width
    const { doc, scope, view, viewport } = useStore.getState()
    const reference = t('Reference')
    const layer = layersOf(doc).find((l) => l.name === reference)?.id ?? newId('layer')
    const asset = newId('asset')
    const node = newId()
    const ops: Op[] = [
      ...(doc.layers[layer] ? [] : [{ op: 'add_layer', layer: { id: layer, name: reference } } as Op]),
      { op: 'add_asset', asset: { id: asset, mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], width: canvas.width, height: canvas.height } },
      {
        op: 'add_node',
        node: {
          type: 'image',
          id: node,
          name: file.name,
          parent: scope,
          layer,
          asset,
          // Beneath everything already drawn.
          x: (at?.x ?? (viewport.width / 2 - view.x) / view.zoom) - width / 2,
          y: (at?.y ?? (viewport.height / 2 - view.y) / view.zoom) - height / 2,
          width,
          height,
          opacity: 0.6,
          order: orderBefore(childrenOf(doc, scope).map((n) => n.order)),
        },
      },
    ]
    if (!apply(ops)) return
    zoomToFit()
    setTool('calibrate')
    // The scale is typed in the properties panel, which may be closed or behind another tab.
    showPanel('properties')
    toast(t('Plan imported. Now set its scale: click two points whose real distance you know.'))
  }
}

/**
 * Rescales the picture under the two calibration points so that they are `real` mm apart, keeping
 * the first point where it is. The picture is then locked so tracing over it cannot move it.
 */
export function applyCalibration(real: number): void {
  const { doc, scope, calibration, selection } = useStore.getState()
  if (!calibration) return
  const measured = dist(calibration.a, calibration.b)
  const pictures = buildScene(doc, scope, registry).filter((item) => item.node.type === 'image')
  const under = [...pictures].reverse().find((item) => item.bounds && boundsContainPoint(item.bounds, calibration.a))
  // The picture the points are on; failing that the one that is selected, or the only one there is.
  const chosen = pictures.find((item) => selection.includes(item.id))
  const target = (under ?? chosen ?? (pictures.length === 1 ? pictures[0] : undefined))?.node
  if (target?.type !== 'image' || measured < 1e-6) return toast(t('Click the two points on the imported plan first.'))
  const factor = real / measured
  const { a } = calibration
  const patch = {
    x: a.x + (target.x - a.x) * factor,
    y: a.y + (target.y - a.y) * factor,
    width: target.width * factor,
    height: target.height * factor,
    locked: true,
  }
  if (!apply([{ op: 'update_node', id: target.id, patch }])) return
  useStore.setState({ calibration: null })
  setTool('select')
  zoomToFit()
  toast(t('Scale set. The plan is locked so you can trace over it; unlock it in the Objects list to move it.'))
}
