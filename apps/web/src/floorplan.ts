import { buildScene, boundsContainPoint, childrenOf, dist, layersOf, newId, orderBefore, type Op, type Vec2 } from '@opencalque/core'
import { guarded, zoomToFit } from './actions'
import { showPanel } from './dock'
import { t } from './i18n'
import { platform } from './platform'
import { registry } from './extensions'
import { apply, layerHere, select, setTool, useStore } from './store'
import { visibleArea } from './view'
import { toast } from './windows'

/**
 * Largest side, in pixels, of a plan to trace kept in the drawing, then the size to fall back to
 * where a browser cannot hold a canvas that large (Safari on an iPad, around 4096 × 4096). Bigger
 * scans are scaled down. 8192 keeps an A1 sheet at about 250 dpi, small writing readable.
 */
const PLAN_PIXELS = [8192, 4096]
/** Largest side, in pixels, of a pasted picture (a screenshot, an image from a browser). */
const PICTURE_PIXELS = 4096

/** A page of a PDF or a picture, opened once and drawn at the size asked for. */
interface Source {
  /** The picture with its longer side at most `max` pixels, or null when the browser cannot make a canvas that large. */
  draw(max: number): Promise<HTMLCanvasElement | null>
  /** A first guess at the width the picture covers, in mm. Calibration replaces it. */
  width: number
}

function blankCanvas(width: number, height: number, see = false): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  // Null when the canvas is larger than the browser allows.
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Plans are stored as JPEG, which has no transparency: anything see-through becomes white paper.
  if (!see) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  return [canvas, ctx]
}

/**
 * A page of a PDF: its only page, or the one the user asks for. Null when they give up. A PDF
 * knows its paper size, so the guess assumes it was drawn at 1:100.
 */
async function fromPdf(bytes: Uint8Array): Promise<Source | null> {
  // Loaded on demand: the PDF library is larger than the rest of the app.
  const pdfjs = await import('pdfjs-dist')
  // Running the "worker" code on this thread avoids a separate worker file, which a desktop app
  // loaded from disk cannot always start. Rendering one page is quick enough.
  ;(globalThis as any).pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.mjs')
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  let number = 1
  if (pdf.numPages > 1) {
    const answer = window.prompt(t('This PDF has {n} pages. Which one do you want to import?', { n: pdf.numPages }), '1')
    if (answer === null) return null
    number = Math.min(pdf.numPages, Math.max(1, Math.round(Number(answer)) || 1))
  }
  const page = await pdf.getPage(number)
  const paper = page.getViewport({ scale: 1 })
  return {
    width: ((paper.width * 25.4) / 72) * 100,
    async draw(max) {
      // At most 4 times the PDF's own 72 dpi: 288 dpi is sharper than any screen shows a plan.
      const viewport = page.getViewport({ scale: Math.min(4, max / Math.max(paper.width, paper.height)) })
      const blank = blankCanvas(viewport.width, viewport.height)
      if (!blank) return null
      const [canvas, ctx] = blank
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      return canvas
    },
  }
}

async function fromImage(bytes: Uint8Array, see = false): Promise<Source> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  return {
    width: 10000,
    async draw(max) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
      const blank = blankCanvas(bitmap.width * scale, bitmap.height * scale, see)
      if (!blank) return null
      const [canvas, ctx] = blank
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return canvas
    },
  }
}

/**
 * A plan drawn at the largest of `PLAN_PIXELS` the browser can hold, as JPEG. A browser that
 * cannot hold a canvas so large may also make one that stays empty, whose JPEG is then nothing.
 */
async function planJpeg(source: Source): Promise<{ data: string; width: number; height: number }> {
  for (const max of PLAN_PIXELS) {
    const canvas = await source.draw(max)
    const data = canvas?.toDataURL('image/jpeg', 0.85).split(',')[1]
    if (canvas && data) return { data, width: canvas.width, height: canvas.height }
  }
  throw new Error(t('This picture is too large to open here.'))
}

/** Whether any of a picture is see-through. */
function seeThrough(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/**
 * Puts a picture pasted from another program (a screenshot, an image copied in a browser) where
 * the person is looking, as any pasted thing goes: centred on `at` or on the view, on top of the
 * drawing, on the layer in use, selected. It is as big as it is on the screen it came from, made
 * smaller to fit most of the view. Unlike a plan to trace, it leaves the view and the tool alone.
 * Kept as JPEG, or as PNG when some of it is see-through (a logo), so that it stays so.
 */
export async function placePicture(bytes: Uint8Array, at?: Vec2): Promise<void> {
  const canvas = await (await fromImage(bytes, true)).draw(PICTURE_PIXELS)
  if (!canvas) throw new Error(t('This picture is too large to open here.'))
  const see = seeThrough(canvas)
  const { scope, view, viewport } = useStore.getState()
  const area = visibleArea(view, viewport) ?? { minX: 0, minY: 0, maxX: 10000, maxY: 10000 }
  // A pixel of the picture on a pixel of the screen, as it was where it was copied.
  const natural = 1 / ((window.devicePixelRatio || 1) * view.zoom)
  const each = natural * Math.min(1, (0.8 * (area.maxX - area.minX)) / (canvas.width * natural), (0.8 * (area.maxY - area.minY)) / (canvas.height * natural))
  const tidy = (mm: number) => Math.round(mm * 10) / 10
  const [width, height] = [tidy(canvas.width * each), tidy(canvas.height * each)]
  const centre = at ?? { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 }
  const asset = newId('asset')
  const node = newId()
  const mime = see ? 'image/png' : 'image/jpeg'
  const ops: Op[] = [
    { op: 'add_asset', asset: { id: asset, mime, data: canvas.toDataURL(mime, 0.85).split(',')[1], width: canvas.width, height: canvas.height } },
    { op: 'add_node', node: { type: 'image', id: node, name: t('Pasted picture'), parent: scope, ...layerHere(), asset, x: tidy(centre.x - width / 2), y: tidy(centre.y - height / 2), width, height } },
  ]
  if (apply(ops)) select([node])
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
    const source = /\.pdf$/i.test(file.name) ? await fromPdf(file.bytes) : await fromImage(file.bytes)
    if (!source) return
    const picture = await planJpeg(source)
    const { width } = source
    const height = (width * picture.height) / picture.width
    const { doc, scope, view, viewport } = useStore.getState()
    const reference = t('Reference')
    // On a layer of its own, but on none inside a component, whose placements give theirs.
    const placed = layerHere({ doc, scope, activeLayer: layersOf(doc).find((l) => l.name === reference)?.id ?? newId('layer') })
    const asset = newId('asset')
    const node = newId()
    const ops: Op[] = [
      ...(!placed.layer || doc.layers[placed.layer] ? [] : [{ op: 'add_layer', layer: { id: placed.layer, name: reference } } as Op]),
      { op: 'add_asset', asset: { id: asset, mime: 'image/jpeg', ...picture } },
      {
        op: 'add_node',
        node: {
          type: 'image',
          id: node,
          name: file.name,
          parent: scope,
          ...placed,
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
  toast(t('Scale set. The plan is locked so you can trace over it; unlock it in the Structure panel to move it.'))
}
