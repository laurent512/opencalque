import { paintOrder, sceneBounds, type PaintStep, type SceneItem, type Vec2 } from '@opencalque/core'

// Pictures decode asynchronously. Until one is ready it is simply not drawn, and the canvas is
// told to repaint when it arrives.
const pictures = new Map<string, HTMLImageElement>()
let pictureReady = () => {}

export function onPictureReady(listener: () => void): void {
  pictureReady = listener
}

function pictureFor(href: string): HTMLImageElement | null {
  let picture = pictures.get(href)
  if (!picture) {
    picture = new Image()
    picture.onload = () => pictureReady()
    picture.src = href
    pictures.set(href, picture)
  }
  return picture.complete && picture.naturalWidth > 0 ? picture : null
}
import type { View } from '../store'
import { formatLength } from '../units'

const ACCENT = '#0d99ff'
const DESK = '#f3f4f6'
/** The colour of what belongs to a modifier rather than to the object. */
const MODIFIER = '#f08c00'
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export interface Overlay {
  marquee?: { a: Vec2; b: Vec2 }
  /** A point the cursor snapped to. */
  marker?: Vec2 | null
  /** The measure tool's reading, in world coordinates. It is not part of the drawing. */
  measure?: { a: Vec2; b: Vec2 }
  /** Sizes written next to the shape being drawn or selected. */
  labels?: SizeLabel[]
  angle?: AngleMark
  /** Outlines offered while a paper is being sized: the standard formats from its first corner. */
  ghosts?: { a: Vec2; b: Vec2; label: string; active: boolean }[]
  /** Names written above the top-left corner of papers, in screen-size text. */
  titles?: { at: Vec2; text: string; selected: boolean }[]
  /** The outlines of the selected object's modifiers (a crop's rectangle), with corner handles on those that can be dragged. */
  frames?: { outline: Vec2[]; handles: boolean }[]
  /** Whether the box around the selection gets its grips: corners to scale by, a knob to turn by. */
  grips?: boolean
  /** A guide across the whole view through `at`, shown while the line being drawn is exactly horizontal or vertical. */
  axis?: { at: Vec2; vertical: boolean }
}

/**
 * Where the grips of the box around a selection are on screen: its four corners, clockwise from
 * the top left, and the knob above the middle of its top side.
 */
export function boxGrips(box: { minX: number; minY: number; maxX: number; maxY: number }, view: View): { corners: Vec2[]; knob: Vec2 } {
  const left = Math.round(box.minX * view.zoom + view.x) - 3.5
  const top = Math.round(box.minY * view.zoom + view.y) - 3.5
  const right = Math.round(box.maxX * view.zoom + view.x) + 3.5
  const bottom = Math.round(box.maxY * view.zoom + view.y) + 3.5
  return {
    corners: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    knob: { x: (left + right) / 2, y: top - 22 },
  }
}

/** A size shown beside a shape: anchored at a world point, nudged by a few screen pixels. */
export interface SizeLabel {
  at: Vec2
  dx: number
  dy: number
  text: string
  /** Degrees the text is turned, clockwise: -90 for a height, or the direction of a line. */
  rotation?: number
}

/** The angle of a line being drawn, shown as a wedge at its start, measured counter-clockwise from the right. */
export interface AngleMark {
  at: Vec2
  degrees: number
}

/** Grid spacing in mm: the smallest "nice" step that stays at least 8 px apart on screen. */
export function gridStep(zoom: number): number {
  for (const step of [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]) if (step * zoom >= 8) return step
  return 100000
}

/** Paints one step, inside the outlines its primitive is clipped to, if any. */
function paint(ctx: CanvasRenderingContext2D, step: PaintStep, zoom: number): void {
  const clip = step.prim.clip
  if (!clip?.length) return paintWhole(ctx, step, zoom)
  ctx.save()
  // Each clip narrows the last, so what shows is inside all of them.
  for (const outline of clip) {
    ctx.beginPath()
    outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.clip()
  }
  paintWhole(ctx, step, zoom)
  ctx.restore()
}

function paintWhole(ctx: CanvasRenderingContext2D, { prim, stroke, fill, widthScale, widthExtra, seam }: PaintStep, zoom: number): void {
  if (prim.kind === 'image') {
    const picture = pictureFor(prim.href)
    if (!picture) return
    ctx.save()
    ctx.translate(prim.x, prim.y)
    if (prim.rotation) ctx.rotate((prim.rotation * Math.PI) / 180)
    ctx.globalAlpha = prim.opacity ?? 1
    ctx.drawImage(picture, 0, 0, prim.width, prim.height)
    ctx.restore()
    return
  }
  if (prim.kind === 'text') {
    ctx.save()
    ctx.translate(prim.x, prim.y)
    if (prim.rotation) ctx.rotate((prim.rotation * Math.PI) / 180)
    ctx.font = `${prim.size}px ${prim.font ?? FONT}`
    ctx.textAlign = prim.align ?? 'left'
    ctx.fillStyle = prim.stroke ?? 'black'
    ctx.fillText(prim.text, 0, 0)
    ctx.restore()
    return
  }
  ctx.beginPath()
  if (prim.kind === 'ellipse') {
    ctx.ellipse(prim.cx, prim.cy, prim.rx, prim.ry, ((prim.rotation ?? 0) * Math.PI) / 180, 0, Math.PI * 2)
  } else {
    prim.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (prim.closed) ctx.closePath()
  }
  if (fill && prim.fill && prim.fill !== 'none') {
    ctx.fillStyle = prim.fill
    ctx.fill()
    if (seam > 0) {
      ctx.strokeStyle = prim.fill
      ctx.lineWidth = seam / zoom
      ctx.setLineDash([])
      ctx.stroke()
    }
  }
  if (stroke && prim.stroke !== 'none') {
    ctx.strokeStyle = prim.stroke ?? 'black'
    ctx.lineWidth = ((prim.strokeWidth ?? 1) * widthScale + widthExtra) / zoom
    // Merged outlines turn sharply at joints; a mitre there would spike out past the corner.
    ctx.lineJoin = widthExtra > 0 ? 'round' : 'miter'
    ctx.setLineDash((prim.dash ?? []).map((d) => d / zoom))
    ctx.stroke()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, view: View): void {
  const minor = gridStep(view.zoom)
  // Translucent, so the grid reads the same over the desk and over a sheet of paper.
  for (const [step, color] of [[minor, 'rgb(0 0 0 / 5.5%)'], [minor * 10, 'rgb(0 0 0 / 11%)']] as const) {
    ctx.beginPath()
    for (let x = Math.ceil(-view.x / view.zoom / step) * step; x * view.zoom + view.x < width; x += step) {
      const sx = Math.round(x * view.zoom + view.x) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
    }
    for (let y = Math.ceil(-view.y / view.zoom / step) * step; y * view.zoom + view.y < height; y += step) {
      const sy = Math.round(y * view.zoom + view.y) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
  }
  // Axes through the origin, which is also the insertion point when editing a component.
  ctx.lineWidth = 1
  for (const [color, horizontal] of [['#f0b4b4', true], ['#a9d8b0', false]] as const) {
    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(0, Math.round(view.y) + 0.5)
      ctx.lineTo(width, Math.round(view.y) + 0.5)
    } else {
      ctx.moveTo(Math.round(view.x) + 0.5, 0)
      ctx.lineTo(Math.round(view.x) + 0.5, height)
    }
    ctx.strokeStyle = color
    ctx.stroke()
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number; dpr: number },
  view: View,
  scene: SceneItem[],
  selection: string[],
  handles: Vec2[],
  overlay: Overlay,
  showGrid: boolean,
): void {
  const { width, height, dpr } = size
  const toScreen = (p: Vec2) => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y })
  const world = () => ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y)
  const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  screen()
  ctx.setLineDash([])
  const steps = paintOrder(scene.flatMap((item) => item.prims))
  const sheets = steps.filter((step) => step.prim.backdrop === true)
  // Once there are sheets of paper, what surrounds them is the desk they lie on.
  ctx.fillStyle = sheets.length > 0 ? DESK : '#ffffff'
  ctx.fillRect(0, 0, width, height)
  world()
  for (const step of sheets) paint(ctx, step, view.zoom)
  screen()
  if (showGrid) drawGrid(ctx, width, height, view)

  world()
  for (const step of steps) if (step.prim.backdrop !== true) paint(ctx, step, view.zoom)

  const selected = scene.filter((item) => selection.includes(item.id))
  for (const item of selected) {
    for (const prim of item.prims) {
      if (prim.kind === 'text' || prim.kind === 'image') continue
      paint(ctx, { prim: { ...prim, stroke: ACCENT, strokeWidth: 1.5, dash: undefined }, stroke: true, fill: false, widthScale: 1, widthExtra: 0, seam: 0 }, view.zoom)
    }
  }

  screen()
  ctx.setLineDash([])
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  // One box around everything selected: it shows the selection as a whole, and is the area where
  // a right-click is about the selection. A single object with draggable handles needs none.
  const box = selected.length === 1 && handles.length > 0 ? null : sceneBounds(selected)
  if (box) {
    const a = toScreen({ x: box.minX, y: box.minY })
    const b = toScreen({ x: box.maxX, y: box.maxY })
    ctx.strokeRect(Math.round(a.x) - 3.5, Math.round(a.y) - 3.5, Math.round(b.x - a.x) + 7, Math.round(b.y - a.y) + 7)
    if (overlay.grips) {
      const { corners, knob } = boxGrips(box, view)
      ctx.beginPath()
      ctx.moveTo(knob.x, knob.y)
      ctx.lineTo(knob.x, corners[0].y)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      for (const p of corners) {
        ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7)
        ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7)
      }
      ctx.beginPath()
      ctx.arc(knob.x, knob.y, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.fillStyle = '#ffffff'
  for (const h of handles) {
    const p = toScreen(h)
    ctx.fillRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
    ctx.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
  }
  if (overlay.marquee) {
    const a = toScreen(overlay.marquee.a)
    const b = toScreen(overlay.marquee.b)
    ctx.fillStyle = 'rgba(13, 153, 255, 0.08)'
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y)
  }
  for (const frame of overlay.frames ?? []) {
    const points = frame.outline.map(toScreen)
    ctx.strokeStyle = MODIFIER
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
    if (!frame.handles) continue
    ctx.fillStyle = '#ffffff'
    for (const p of points) {
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7)
      ctx.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
    }
  }
  ctx.font = `11px ${FONT}`
  ctx.textAlign = 'left'
  for (const title of overlay.titles ?? []) {
    const p = toScreen(title.at)
    ctx.fillStyle = title.selected ? ACCENT : '#8b9099'
    ctx.fillText(title.text, Math.round(p.x), Math.round(p.y) - 7)
  }
  for (const ghost of overlay.ghosts ?? []) {
    const a = toScreen(ghost.a)
    const b = toScreen(ghost.b)
    ctx.setLineDash([])
    ctx.lineWidth = ghost.active ? 1.5 : 1
    ctx.strokeStyle = ghost.active ? ACCENT : 'rgb(13 153 255 / 38%)'
    ctx.strokeRect(Math.round(Math.min(a.x, b.x)) + 0.5, Math.round(Math.min(a.y, b.y)) + 0.5, Math.round(Math.abs(b.x - a.x)), Math.round(Math.abs(b.y - a.y)))
    // The format's name sits just inside the corner the pointer is heading for.
    ctx.font = `${ghost.active ? '600 ' : ''}10px ${FONT}`
    ctx.fillStyle = ghost.active ? ACCENT : 'rgb(13 153 255 / 70%)'
    ctx.textAlign = b.x >= a.x ? 'right' : 'left'
    ctx.fillText(ghost.label, b.x + (b.x >= a.x ? -6 : 6), b.y + (b.y >= a.y ? -6 : 14))
  }
  ctx.textAlign = 'left'
  if (overlay.axis) {
    const p = toScreen(overlay.axis.at)
    ctx.strokeStyle = 'rgb(29 78 216 / 40%)'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    if (overlay.axis.vertical) {
      ctx.moveTo(Math.round(p.x) + 0.5, 0)
      ctx.lineTo(Math.round(p.x) + 0.5, height)
    } else {
      ctx.moveTo(0, Math.round(p.y) + 0.5)
      ctx.lineTo(width, Math.round(p.y) + 0.5)
    }
    ctx.stroke()
  }
  if (overlay.measure) {
    const a = toScreen(overlay.measure.a)
    const b = toScreen(overlay.measure.b)
    const mm = Math.hypot(overlay.measure.b.x - overlay.measure.a.x, overlay.measure.b.y - overlay.measure.a.y)
    ctx.strokeStyle = '#e5008a'
    ctx.fillStyle = '#e5008a'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
    for (const p of [a, b]) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    const label = formatLength(mm)
    ctx.font = `600 12px ${FONT}`
    const width = ctx.measureText(label).width + 12
    const x = (a.x + b.x) / 2
    const y = (a.y + b.y) / 2 - 16
    ctx.beginPath()
    ctx.roundRect(x - width / 2, y - 10, width, 20, 5)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x, y + 0.5)
    ctx.textBaseline = 'alphabetic'
  }
  if (overlay.angle) {
    const p = toScreen(overlay.angle.at)
    const end = (-overlay.angle.degrees * Math.PI) / 180
    ctx.fillStyle = 'rgb(29 78 216 / 18%)'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    // Counter-clockwise on screen, from the horizontal up to the line.
    ctx.arc(p.x, p.y, 44, 0, end, true)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(p.x, p.y, 44, 0, end, true)
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 56, p.y)
    ctx.stroke()
  }
  const angleLabel: SizeLabel[] = overlay.angle ? [{ at: overlay.angle.at, dx: -8, dy: 24, text: `${Math.round(overlay.angle.degrees * 10) / 10}°` }] : []
  for (const label of [...(overlay.labels ?? []), ...angleLabel]) {
    const p = toScreen(label.at)
    ctx.save()
    ctx.translate(Math.round(p.x + label.dx), Math.round(p.y + label.dy))
    if (label.rotation) ctx.rotate((label.rotation * Math.PI) / 180)
    ctx.font = `600 11px ${FONT}`
    const width = ctx.measureText(label.text).width + 12
    ctx.fillStyle = '#dbe7ff'
    ctx.beginPath()
    ctx.roundRect(-width / 2, -9, width, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#1d4ed8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.text, 0, 0.5)
    ctx.restore()
  }
  ctx.textBaseline = 'alphabetic'
  if (overlay.marker) {
    const p = toScreen(overlay.marker)
    ctx.strokeStyle = '#e5008a'
    ctx.lineWidth = 1.5
    ctx.strokeRect(p.x - 5, p.y - 5, 10, 10)
  }
}
