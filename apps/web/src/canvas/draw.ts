import { gridStep } from '../view'
import { boundsFrame, frameGrips, paintOrder, primitiveBounds, rotate, sceneBounds, type Bounds, type MoveGuides, type PaintStep, type Primitive, type ResizeFrame, type SceneItem, type Snap, type Vec2 } from '@opencalque/core'

// Pictures decode asynchronously. Until one is ready it is simply not drawn, and the canvas is
// told to repaint when it arrives.
const pictures = new Map<string, HTMLImageElement>()
let pictureReady = () => {}
/** How many pictures have arrived: the drawing kept under the overlay (`base`) is painted again when one does. */
let arrived = 0

export function onPictureReady(listener: () => void): void {
  pictureReady = listener
}

/** Asks the canvas to paint again once the view has stopped moving, to paint sharp what was stretched meanwhile. */
let repaint = () => {}

export function onRepaint(listener: () => void): void {
  repaint = listener
}

function pictureFor(href: string): HTMLImageElement | null {
  let picture = pictures.get(href)
  if (!picture) {
    picture = new Image()
    picture.onload = () => {
      arrived++
      pictureReady()
    }
    picture.src = href
    pictures.set(href, picture)
  }
  return picture.complete && picture.naturalWidth > 0 ? picture : null
}
import type { View } from '../view'
import { formatAngle, formatLength, formatNumber } from '../units'

const ACCENT = '#0d99ff'
const CROSSING = '#16a34a'
/** The colour of what the pointer snaps to and of the guides shown while something is moved. */
const SNAP = '#e5008a'
/** The colour of what belongs to a modifier rather than to the object. */
const MODIFIER = '#f08c00'
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** The colours of the canvas itself, as opposed to those of the drawing. */
export interface CanvasPalette {
  /** Behind a drawing without sheets of paper. */
  surface: string
  /** Around sheets of paper. */
  desk: string
  grid: [minor: string, major: string]
  axes: [x: string, y: string]
  title: string
  label: { fill: string; text: string }
  guide: string
  /** What every colour of the drawing goes through on screen. Exports never use it. */
  ink: (color: string, line?: boolean) => string
}

const same = (color: string) => color

export const LIGHT_CANVAS: CanvasPalette = {
  surface: '#ffffff',
  desk: '#f3f4f6',
  grid: ['rgb(0 0 0 / 5.5%)', 'rgb(0 0 0 / 11%)'],
  axes: ['#f0b4b4', '#a9d8b0'],
  title: '#8b9099',
  label: { fill: '#dbe7ff', text: '#1d4ed8' },
  guide: 'rgb(29 78 216 / 40%)',
  ink: same,
}

export const DARK_CANVAS: CanvasPalette = {
  // White paper as `darkInk` turns it.
  surface: '#1f1f1f',
  desk: '#141414',
  grid: ['rgb(255 255 255 / 5%)', 'rgb(255 255 255 / 10%)'],
  axes: ['#7a3a3a', '#3a6b44'],
  title: '#8b9099',
  label: { fill: '#1d3a6b', text: '#c6d8ff' },
  guide: 'rgb(110 160 255 / 50%)',
  ink: darkInk,
}

/** A dark theme around a drawing that keeps its paper colours. */
export const DARK_AROUND_CANVAS: CanvasPalette = { ...LIGHT_CANVAS, desk: '#1a1a1a' }

// Colours are normalised by the browser, which reads every CSS colour syntax there is.
let normaliser: CanvasRenderingContext2D | null = null
const inked = new Map<string, string>()

/**
 * A drawing's colour as it shows on a dark canvas: its lightness turned over, its hue and
 * saturation kept, so black ink reads light, white paper dark, and red stays red. Lightness is
 * folded into 12–92 % so that nothing is quite black or quite white. Lines and words are kept at
 * least 62 % light, or a dark blue line would stay dark on the dark ground.
 */
export function darkInk(color: string, line = false): string {
  const key = line ? `line ${color}` : color
  const known = inked.get(key)
  if (known !== undefined) return known
  normaliser ??= document.createElement('canvas').getContext('2d')
  if (!normaliser) return color
  normaliser.fillStyle = '#000'
  normaliser.fillStyle = color
  const value = String(normaliser.fillStyle)
  const parts = value.startsWith('#') ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) : (value.match(/[\d.]+/g) ?? []).map(Number)
  const [r, g, b] = parts.slice(0, 3).map((v) => v / 255)
  const alpha = parts[3] ?? 1
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const lightness = line ? Math.max(0.62, 0.92 - l * 0.8) : 0.92 - l * 0.8
  const result = `hsl(${Math.round(hue * 60)} ${Math.round(sat * 100)}% ${Math.round(lightness * 1000) / 10}% / ${alpha})`
  inked.set(key, result)
  return result
}

export interface Overlay {
  marquee?: { a: Vec2; b: Vec2; crossing: boolean }
  /** What the cursor snapped to, marked by a sign that tells its kind, with a word beside it for those that need one. */
  marker?: (Snap & { label?: string }) | null
  /** From what the pointer is on to where the line being drawn ends, when that end is only level with it. */
  link?: [Vec2, Vec2]
  /** The points the pointer rested on, which what is drawn lines up with: each a small cross. */
  tracked?: Vec2[]
  /** While something is moved: where it lines up with other things, and the gaps it keeps equal. */
  smart?: MoveGuides
  /** A line of a wall pointed at in the properties panel, in world coordinates. */
  edgeHover?: Vec2[][]
  /** The face of the selected wall that a press would drag, or that is being dragged, to change its thickness, as its stretches. */
  face?: Vec2[][]
  /** Where the split tool would cut: a point, the way the thing runs there, and how far the mark reaches to either side. */
  cut?: { at: Vec2; dir: Vec2; half: number; parts?: Vec2[][]; gap?: number }
  /** The object a tool would act on, lit up as if it were selected. */
  lit?: string
  /** What the trim tool would take away: the stretch of a wall or a line, along its line, and how wide to show it in pixels (a wall's thickness). */
  trim?: { piece: Vec2[]; width: number }
  /** Temporary dimensions of the one object selected: each line, and its length in a box on screen (`clearanceLabel`). */
  clearances?: { from: Vec2; to: Vec2; label: { x: number; y: number; width: number; height: number; text: string } }[]
  /** The one whose length the pointer is on: boxed, as a field to click. */
  clearanceHover?: number
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
  /** The selected wall corner: a point, drawn as a filled dot so it reads as a thing that is selected. */
  corner?: Vec2 | null
  /** Whether the box around the selection gets its grips: corners to scale by, a knob to turn by. */
  grips?: boolean
  /**
   * The box around the selection when it is turned, in world coordinates: a turned object's own
   * box, which turns with it, or the box of a selection being turned by its knob. Without it, the
   * box is the upright one around what is selected.
   */
  box?: ResizeFrame | null
  /** What is selected is shown by its own outline alone, with no box around it: rooms, whose floor may be any shape. */
  boxless?: boolean
  /**
   * The frame a single box-shaped object is resized by, in place of that box: its eight grips (four
   * corners, then the middles of the sides) in world coordinates, and the direction its knob stands
   * off the top side, turning with the object.
   */
  frame?: { grips: Vec2[]; up: Vec2 } | null
  /** A guide across the whole view through `at`, shown while the line being drawn is exactly horizontal or vertical. */
  axis?: { at: Vec2; vertical: boolean }
  /** An angle being read: its corner, a point along its first side and, once chosen, one along its second. */
  angleReading?: { vertex: Vec2; a?: Vec2; b?: Vec2; label?: string }
  /** The line something is being kept on while it is dragged: through a point, at an angle in radians, shown across the whole view. */
  guide?: { at: Vec2; angle: number }
  /** What the ends of the selected walls are joined to, and the walls joined to them (`WallLinks`). */
  wallLinks?: WallLinks | null
}

/** Ends of selected walls are shown as joined or not for at most this many walls: past that, the marks would hide the plan. */
export const MAX_LINKED_WALLS = 50

/**
 * The ends of the selected walls, each with what it is to the other walls there: `joined` to one
 * or more, `apart` (it touches some without being joined: it was set loose, or it is a lining that
 * stops against a wall), `near` the end of another without being at it (that end at `near`), or
 * `free`. And the walls joined to them that are not selected, by id, to light up faintly.
 */
export interface WallLinks {
  ends: { at: Vec2; kind: 'joined' | 'apart' | 'near' | 'free'; near?: Vec2 }[]
  joined: string[]
}

/** The colour of an end that nearly meets another without being joined to it: something to look at. */
const NEARLY = '#f59e0b'

/** The angle at `vertex` between the directions to `a` and to `b`, in degrees from 0 to 180, to one decimal. */
export function angleBetween(vertex: Vec2, a: Vec2, b: Vec2): number {
  const turn = Math.atan2(b.y - vertex.y, b.x - vertex.x) - Math.atan2(a.y - vertex.y, a.x - vertex.x)
  const degrees = Math.abs((Math.atan2(Math.sin(turn), Math.cos(turn)) * 180) / Math.PI)
  return Math.round(degrees * 10) / 10
}

/**
 * Where the box around a selection is on screen, a few pixels out from what it holds: its four
 * corners, clockwise from the top left as the box is turned, the middle of its top side, and the
 * knob that stands off it.
 */
export function boxGrips(box: ResizeFrame, view: View): { corners: Vec2[]; top: Vec2; knob: Vec2 } {
  const across = rotate({ x: 1, y: 0 }, box.rotation)
  const down = rotate({ x: 0, y: 1 }, box.rotation)
  // A box square to the screen sits on whole pixels, so that its sides are crisp.
  const crisp = (n: number) => (box.rotation % 90 === 0 ? Math.round(n) : n)
  const out = [
    [-3.5, -3.5],
    [3.5, -3.5],
    [3.5, 3.5],
    [-3.5, 3.5],
  ]
  const corners = frameGrips(box)
    .slice(0, 4)
    .map((p, i) => ({
      x: crisp(p.x * view.zoom + view.x) + across.x * out[i][0] + down.x * out[i][1],
      y: crisp(p.y * view.zoom + view.y) + across.y * out[i][0] + down.y * out[i][1],
    }))
  const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
  return { corners, top, knob: { x: top.x - down.x * 22, y: top.y - down.y * 22 } }
}

/** A size shown beside a shape: anchored at a world point, nudged by a few screen pixels. */
export interface SizeLabel {
  at: Vec2
  dx: number
  dy: number
  text: string
  /** Degrees the text is turned, clockwise: -90 for a height, or the direction of a line. */
  rotation?: number
  /** Written in the magenta of the measuring tools, beside a line of that colour, rather than as a size. */
  measure?: boolean
}

/** The angle of a line being drawn, shown as a wedge at its start, measured counter-clockwise from the right. */
export interface AngleMark {
  at: Vec2
  degrees: number
}


/** The order a scene is painted in, worked out once for each scene: it does not change with the view, the pointer or what is laid over it. */
const orders = new WeakMap<SceneItem[], { sheets: PaintStep[]; drawn: PaintStep[] }>()
function stepsOf(scene: SceneItem[]): { sheets: PaintStep[]; drawn: PaintStep[] } {
  let steps = orders.get(scene)
  if (!steps) {
    const all = paintOrder(scene.flatMap((item) => item.prims))
    orders.set(scene, (steps = { sheets: all.filter((step) => step.prim.backdrop === true), drawn: all.filter((step) => step.prim.backdrop !== true) }))
  }
  return steps
}

/** Whether two primitives are cut to the same outlines, the same ones and not only alike: those of one crop, or the shape one hatch is laid in. */
const sameClip = (a: Vec2[][] | undefined, b: Vec2[][] | undefined): boolean => (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((outline, i) => outline === b![i])

/** Whether two steps are lines of a hatch that can be stroked as one: same colour, weight and dash. */
const sameHatch = (a: PaintStep, b: PaintStep): boolean =>
  a.prim.kind === 'path' &&
  b.prim.kind === 'path' &&
  !!a.prim.texture &&
  !!b.prim.texture &&
  a.prim.stroke === b.prim.stroke &&
  a.prim.strokeWidth === b.prim.strokeWidth &&
  a.widthScale === b.widthScale &&
  a.widthExtra === b.widthExtra &&
  String(a.prim.dash ?? '') === String(b.prim.dash ?? '')

/** Where each primitive lies, worked out once: primitives never change. */
const extents = new WeakMap<Primitive, Bounds | null>()
function extentOf(prim: Primitive): Bounds | null {
  let bounds = extents.get(prim)
  if (bounds === undefined) extents.set(prim, (bounds = primitiveBounds(prim)))
  return bounds
}

/** Whether a step may show in `area`: what has no bounds (a text measured nowhere) is taken to. */
function seen(step: PaintStep, area: Bounds | null): boolean {
  if (!area) return true
  const b = extentOf(step.prim)
  return !b || (b.maxX >= area.minX && b.minX <= area.maxX && b.maxY >= area.minY && b.minY <= area.maxY)
}

/**
 * Paints steps in their order, as `paint` does one by one, with less work for the canvas: what
 * lies outside `area` (the view, in drawing coordinates) is left out, steps one after the other cut
 * to the same outlines (a crop, the shape a hatch is laid in) are painted inside one clip, and the
 * lines of a hatch one after the other as one stroke. A plan with hatched floors and cropped groups
 * had thousands of clips each time it was painted.
 */
function paintSteps(ctx: CanvasRenderingContext2D, all: PaintStep[], zoom: number, ink: CanvasPalette['ink'], area: Bounds | null = null): void {
  const steps = area ? all.filter((step) => seen(step, area)) : all
  for (let i = 0; i < steps.length; ) {
    const clip = steps[i].prim.clip
    let end = i + 1
    while (end < steps.length && sameClip(steps[end].prim.clip, clip)) end++
    if (clip?.length) {
      ctx.save()
      for (const outline of clip) {
        ctx.beginPath()
        outline.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
        ctx.closePath()
        ctx.clip()
      }
    }
    for (let k = i; k < end; ) {
      let last = k + 1
      while (last < end && sameHatch(steps[k], steps[last])) last++
      if (last - k > 1) strokeHatch(ctx, steps.slice(k, last), zoom, ink)
      else paintWhole(ctx, steps[k], zoom, ink)
      k = last
    }
    if (clip?.length) ctx.restore()
    i = end
  }
}

/** The lines of one hatch as one path, stroked once: as `paintWhole` strokes each of them. */
function strokeHatch(ctx: CanvasRenderingContext2D, steps: PaintStep[], zoom: number, ink: CanvasPalette['ink']): void {
  const [{ prim, widthScale, widthExtra }] = steps
  if (prim.kind !== 'path' || prim.stroke === 'none') return
  ctx.beginPath()
  for (const { prim: line } of steps) if (line.kind === 'path') line.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.strokeStyle = ink(prim.stroke ?? 'black', true)
  ctx.lineWidth = ((prim.strokeWidth ?? 1) * widthScale + widthExtra) / zoom
  ctx.lineJoin = widthExtra > 0 ? 'round' : 'miter'
  ctx.setLineDash((prim.dash ?? []).map((d) => d / zoom))
  ctx.stroke()
}

/** Paints one step, inside the outlines its primitive is clipped to, if any. */
function paint(ctx: CanvasRenderingContext2D, step: PaintStep, zoom: number, ink: CanvasPalette['ink'] = same): void {
  const clip = step.prim.clip
  if (!clip?.length) return paintWhole(ctx, step, zoom, ink)
  ctx.save()
  // Each clip narrows the last, so what shows is inside all of them.
  for (const outline of clip) {
    ctx.beginPath()
    outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.clip()
  }
  paintWhole(ctx, step, zoom, ink)
  ctx.restore()
}

function paintWhole(ctx: CanvasRenderingContext2D, { prim, stroke, fill, widthScale, widthExtra, seam }: PaintStep, zoom: number, ink: CanvasPalette['ink']): void {
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
    // Smaller than half a pixel on screen, it would not be seen. It is set at its own size and
    // scaled with the view, not at the size it is seen at: the browser keeps its letters at one
    // size, where every step of zoom would have asked for letters of a new size.
    const m = ctx.getTransform()
    if (prim.size * Math.hypot(m.a, m.b) < 0.5) return
    ctx.save()
    ctx.translate(prim.x, prim.y)
    if (prim.rotation) ctx.rotate((prim.rotation * Math.PI) / 180)
    ctx.font = `${prim.bold ? 'bold ' : ''}${prim.size}px ${prim.font ?? FONT}`
    ctx.textAlign = prim.align ?? 'left'
    ctx.fillStyle = ink(prim.stroke ?? 'black', true)
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
    ctx.fillStyle = ink(prim.fill)
    ctx.fill()
    if (seam > 0) {
      ctx.strokeStyle = ink(prim.fill)
      ctx.lineWidth = seam / zoom
      ctx.setLineDash([])
      ctx.stroke()
    }
  }
  if (stroke && prim.stroke !== 'none') {
    ctx.strokeStyle = ink(prim.stroke ?? 'black', true)
    ctx.lineWidth = ((prim.strokeWidth ?? 1) * widthScale + widthExtra) / zoom
    // Merged outlines turn sharply at joints; a mitre there would spike out past the corner.
    ctx.lineJoin = widthExtra > 0 ? 'round' : 'miter'
    ctx.setLineDash((prim.dash ?? []).map((d) => d / zoom))
    ctx.stroke()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, view: View, palette: CanvasPalette): void {
  const minor = gridStep(view.zoom)
  // Translucent, so the grid reads the same over the desk and over a sheet of paper.
  for (const [step, color] of [[minor, palette.grid[0]], [minor * 10, palette.grid[1]]] as const) {
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
  for (const [color, horizontal] of [[palette.axes[0], true], [palette.axes[1], false]] as const) {
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

let ring: HTMLCanvasElement | null = null
/** A spare canvas the size of the view, where an outline is drawn and hollowed before it is laid on the drawing. */
function ringCanvas(width: number, height: number): HTMLCanvasElement {
  ring ??= document.createElement('canvas')
  if (ring.width !== width || ring.height !== height) Object.assign(ring, { width, height })
  return ring
}

/**
 * The drawing as last painted, what it was painted from, the view it was painted in, and whether it
 * is sharp there (not moved by a fraction of a pixel, which blurs it a little).
 */
let base: { canvas: HTMLCanvasElement; key: unknown[]; view: View; sharp: boolean } | null = null
/** A canvas to move the kept drawing into, swapped with it each time. */
let spare: HTMLCanvasElement | null = null
/** The view of the last paint, to tell a view moving (panned, zoomed) from one that has stopped. */
let lastView: View | null = null
let settling: ReturnType<typeof setTimeout> | undefined
/** How long, in ms, the view stays still before what was stretched is painted sharp. */
const SETTLE = 120

/** A rectangle of the view, in CSS pixels. */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Paints the desk, the sheets, the grid and the drawing onto `into` (made the size of `like`), as
 * `drawScene` lays them under the rest; with `rect`, that part of the view only, leaving the rest
 * as it is.
 */
function paintBase(
  into: HTMLCanvasElement | undefined,
  like: HTMLCanvasElement,
  { width, height, dpr }: { width: number; height: number; dpr: number },
  view: View,
  scene: SceneItem[],
  showGrid: boolean,
  palette: CanvasPalette,
  rect: Rect = { x: 0, y: 0, w: width, h: height },
): HTMLCanvasElement {
  const canvas = into ?? document.createElement('canvas')
  if (canvas.width !== like.width || canvas.height !== like.height) Object.assign(canvas, { width: like.width, height: like.height })
  const ctx = canvas.getContext('2d')!
  const world = () => ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y)
  const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  screen()
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()
  ctx.setLineDash([])
  const { sheets, drawn } = stepsOf(scene)
  // What is in sight there, and a margin as wide as the thickest line or largest marker drawn around a shape.
  const margin = 40 / view.zoom
  const area = { minX: (rect.x - view.x) / view.zoom - margin, minY: (rect.y - view.y) / view.zoom - margin, maxX: (rect.x + rect.w - view.x) / view.zoom + margin, maxY: (rect.y + rect.h - view.y) / view.zoom + margin }
  // Once there are sheets of paper, what surrounds them is the desk they lie on.
  ctx.fillStyle = sheets.length > 0 ? palette.desk : palette.surface
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  world()
  paintSteps(ctx, sheets, view.zoom, palette.ink, area)
  screen()
  if (showGrid) drawGrid(ctx, width, height, view, palette)
  world()
  paintSteps(ctx, drawn, view.zoom, palette.ink, area)
  ctx.restore()
  return canvas
}

/**
 * Moves the kept drawing with the view, which was panned by less than its size: what was painted is
 * moved, and only the strips that come into sight are painted, so that what lies outside shows as
 * it comes in. False when the view moved too far for anything to be kept.
 */
function panBase(kept: NonNullable<typeof base>, size: { width: number; height: number; dpr: number }, view: View, scene: SceneItem[], showGrid: boolean, palette: CanvasPalette): boolean {
  const { width, height, dpr } = size
  // Moved by whole pixels of the canvas only: moved by a fraction, it would be blurred a little at
  // each step, more and more. It is then kept for a view a fraction of a pixel from the one shown,
  // which laying it down makes up for once (and painting it again when the view stops).
  const [sx, sy] = [Math.round((view.x - kept.view.x) * dpr), Math.round((view.y - kept.view.y) * dpr)]
  const [dx, dy] = [sx / dpr, sy / dpr]
  if (Math.abs(dx) >= width || Math.abs(dy) >= height) return false
  const at: View = { zoom: kept.view.zoom, x: kept.view.x + dx, y: kept.view.y + dy }
  if (sx !== 0 || sy !== 0) {
    spare ??= document.createElement('canvas')
    if (spare.width !== kept.canvas.width || spare.height !== kept.canvas.height) Object.assign(spare, { width: kept.canvas.width, height: kept.canvas.height })
    const moved = spare.getContext('2d')!
    moved.setTransform(1, 0, 0, 1, 0, 0)
    moved.clearRect(0, 0, spare.width, spare.height)
    moved.drawImage(kept.canvas, sx, sy)
    const was = kept.canvas
    kept.canvas = spare
    spare = was
    // The strips that came into sight, a pixel wider, so that no seam is left at their edge.
    const strips: Rect[] = []
    if (dx > 0) strips.push({ x: 0, y: 0, w: Math.ceil(dx) + 1, h: height })
    if (dx < 0) strips.push({ x: Math.floor(width + dx) - 1, y: 0, w: Math.ceil(-dx) + 2, h: height })
    if (dy > 0) strips.push({ x: 0, y: 0, w: width, h: Math.ceil(dy) + 1 })
    if (dy < 0) strips.push({ x: 0, y: Math.floor(height + dy) - 1, w: width, h: Math.ceil(-dy) + 2 })
    for (const strip of strips) paintBase(kept.canvas, kept.canvas, size, at, scene, showGrid, palette, strip)
  }
  kept.view = at
  kept.sharp = at.x === view.x && at.y === view.y
  return true
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
  palette: CanvasPalette = LIGHT_CANVAS,
): void {
  const { width, height, dpr } = size
  const toScreen = (p: Vec2) => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y })
  const world = () => ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y)
  const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // The drawing itself, painted again only when it or the way it is seen changes, and laid down
  // whole under what moves with the pointer: snaps, the selection, sizes, guides.
  // Panned, the drawing as last painted is moved and only what comes into sight is painted:
  // painting a whole plan at each step of a drag could not keep up. Zoomed, it is painted whole at
  // each step, sharp all the way: scaling the old one up and painting it sharp once the view had
  // stopped made it blur and come back into focus, which read as the plan loading again. What is
  // laid over it is always painted as it is.
  const key = [scene, width, height, dpr, showGrid, palette, arrived]
  const same = !!base && base.key.every((value, i) => value === key[i])
  const moving = lastView !== null && (lastView.zoom !== view.zoom || lastView.x !== view.x || lastView.y !== view.y)
  lastView = view
  clearTimeout(settling)
  const whole = () => (base = { canvas: paintBase(base?.canvas, ctx.canvas, size, view, scene, showGrid, palette), key, view, sharp: true })
  if (!base || !same || base.view.zoom !== view.zoom) whole()
  else {
    const off = base.view.x !== view.x || base.view.y !== view.y
    // Still, it is painted again where it is not exactly what the view shows.
    if (off && moving) {
      if (!panBase(base, size, view, scene, showGrid, palette)) whole()
    } else if (off || !base.sharp) whole()
  }
  // Kept for a view a fraction of a pixel off: painted exactly once the view has been still a moment.
  if (!base!.sharp) settling = setTimeout(repaint, SETTLE)
  const kept = base!
  // A canvas not laid out yet has no pixels, which a browser refuses to copy. It is laid down on
  // whole pixels, never blurred: a third of a pixel off at most, which no one sees.
  if (kept.canvas.width > 0 && kept.canvas.height > 0) {
    ctx.setTransform(1, 0, 0, 1, Math.round(dpr * (view.x - kept.view.x)), Math.round(dpr * (view.y - kept.view.y)))
    ctx.drawImage(kept.canvas, 0, 0)
  }
  world()

  // The walls joined to the selected ones, faintly: what follows when their corners are moved.
  if (overlay.wallLinks && overlay.wallLinks.joined.length > 0) {
    ctx.globalAlpha = 0.5
    for (const item of scene) {
      if (!overlay.wallLinks.joined.includes(item.id)) continue
      for (const prim of item.prims) {
        if (prim.kind !== 'path' || prim.texture || prim.stroke === 'none') continue
        paint(ctx, { prim: { ...prim, stroke: ACCENT, strokeWidth: 1, dash: [4, 3] }, stroke: true, fill: false, widthScale: 1, widthExtra: 0, seam: 0 }, view.zoom)
      }
    }
    ctx.globalAlpha = 1
  }

  const selected = scene.filter((item) => selection.includes(item.id))
  for (const item of scene.filter((item) => selection.includes(item.id) || item.id === overlay.lit)) {
    for (const prim of item.prims) {
      // The lines of a pattern are a surface, not an outline: lit up, they would hide the shape and what is under it.
      if (prim.kind === 'text' || prim.kind === 'image' || prim.texture) continue
      paint(ctx, { prim: { ...prim, stroke: ACCENT, strokeWidth: 1.5, dash: undefined }, stroke: true, fill: false, widthScale: 1, widthExtra: 0, seam: 0 }, view.zoom)
    }
  }

  screen()
  ctx.setLineDash([])
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  // One box around everything selected: it shows the selection as a whole, and is the area where
  // a right-click is about the selection. A single object with draggable handles needs none, and
  // nor do rooms, whose floor is outlined already and may be any shape: an arch in a rectangle.
  const bounds = (selected.length === 1 && (handles.length > 0 || overlay.frame)) || overlay.boxless ? null : sceneBounds(selected)
  const box = bounds && (overlay.box ?? boundsFrame(bounds))
  if (overlay.frame) {
    // The outline of the object is lit up already; its frame adds a grip at each corner and in the middle of each side, and the knob.
    const grips = overlay.frame.grips.map(toScreen)
    const top = grips[4]
    const knob = { x: top.x + overlay.frame.up.x * 22, y: top.y + overlay.frame.up.y * 22 }
    // The frame itself, thin: on a rectangle it is the outline, around an ellipse it ties the corner grips together.
    ctx.beginPath()
    grips.slice(0, 4).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(knob.x, knob.y)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    for (const p of grips) {
      ctx.fillRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
      ctx.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7)
    }
    ctx.beginPath()
    ctx.arc(knob.x, knob.y, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  if (box) {
    const { corners, top, knob } = boxGrips(box, view)
    ctx.beginPath()
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.stroke()
    if (overlay.grips) {
      ctx.beginPath()
      ctx.moveTo(knob.x, knob.y)
      ctx.lineTo(top.x, top.y)
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
  // The points of an object (the ends of a line or a wall, the corners of a shape) are round and
  // a little larger than the square grips of a selection box, which scale rather than move a point.
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.5
  for (const h of handles) {
    const p = toScreen(h)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // The ends of the selected walls, over their handles: filled where joined to another wall, struck
  // through where touching one without being joined, and in orange, tied by a dotted line to the
  // end it nearly meets, where they are a few millimetres apart. A free end keeps its plain handle.
  for (const end of overlay.wallLinks?.ends ?? []) {
    if (end.kind === 'free') continue
    const p = toScreen(end.at)
    ctx.setLineDash([])
    if (end.kind === 'near' && end.near) {
      const q = toScreen(end.near)
      ctx.strokeStyle = NEARLY
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = end.kind === 'joined' ? ACCENT : end.kind === 'near' ? NEARLY : '#ffffff'
    ctx.strokeStyle = end.kind === 'apart' ? ACCENT : '#ffffff'
    ctx.lineWidth = 1.5
    ctx.fill()
    ctx.stroke()
    if (end.kind === 'apart') {
      ctx.beginPath()
      ctx.moveTo(p.x - 3.5, p.y + 3.5)
      ctx.lineTo(p.x + 3.5, p.y - 3.5)
      ctx.stroke()
    }
  }
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  if (overlay.marquee) {
    const a = toScreen(overlay.marquee.a)
    const b = toScreen(overlay.marquee.b)
    // Green and dashed when it picks up what it touches, as in CAD: which of the two it is shows before letting go.
    const crossing = overlay.marquee.crossing
    ctx.fillStyle = crossing ? 'rgba(22, 163, 74, 0.08)' : 'rgba(13, 153, 255, 0.08)'
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.strokeStyle = crossing ? CROSSING : ACCENT
    ctx.setLineDash(crossing ? [5, 4] : [])
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y)
    ctx.strokeStyle = ACCENT
    ctx.setLineDash([])
  }
  if (overlay.corner) {
    const p = toScreen(overlay.corner)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgb(13 153 255 / 18%)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ACCENT
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
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
    ctx.fillStyle = title.selected ? ACCENT : palette.title
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
    ctx.strokeStyle = palette.guide
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
  if (overlay.guide) {
    const p = toScreen(overlay.guide.at)
    // Long enough to leave the view both ways from wherever the point is.
    const far = Math.hypot(width, height) + Math.hypot(p.x, p.y)
    const [dx, dy] = [Math.cos(overlay.guide.angle) * far, Math.sin(overlay.guide.angle) * far]
    ctx.strokeStyle = 'rgb(13 153 255 / 75%)'
    ctx.lineWidth = 1
    ctx.setLineDash([7, 4])
    ctx.beginPath()
    ctx.moveTo(p.x - dx, p.y - dy)
    ctx.lineTo(p.x + dx, p.y + dy)
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (overlay.angleReading?.a) {
    const { vertex, a, b, label: given } = overlay.angleReading
    const v = toScreen(vertex)
    const sides = [a, ...(b ? [b] : [])].map(toScreen)
    ctx.strokeStyle = '#e5008a'
    ctx.fillStyle = '#e5008a'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    for (const p of sides) {
      ctx.beginPath()
      ctx.moveTo(v.x, v.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const p of [v, ...sides]) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    if (b && sides.length === 2) {
      // An arc across the angle, the short way round, and the reading set on its bisector.
      const from = Math.atan2(sides[0].y - v.y, sides[0].x - v.x)
      let sweep = Math.atan2(sides[1].y - v.y, sides[1].x - v.x) - from
      if (sweep > Math.PI) sweep -= Math.PI * 2
      if (sweep < -Math.PI) sweep += Math.PI * 2
      const radius = Math.max(18, Math.min(42, Math.hypot(sides[0].x - v.x, sides[0].y - v.y) * 0.5, Math.hypot(sides[1].x - v.x, sides[1].y - v.y) * 0.5))
      ctx.beginPath()
      ctx.arc(v.x, v.y, radius, from, from + sweep, sweep < 0)
      ctx.stroke()
      const label = given ?? `${formatAngle(angleBetween(vertex, a, b))}°`
      ctx.font = `600 12px ${FONT}`
      const width = ctx.measureText(label).width + 12
      const x = v.x + Math.cos(from + sweep / 2) * (radius + 22)
      const y = v.y + Math.sin(from + sweep / 2) * (radius + 22)
      ctx.beginPath()
      ctx.roundRect(x - width / 2, y - 10, width, 20, 5)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x, y + 0.5)
      ctx.textBaseline = 'alphabetic'
    }
  }
  if (overlay.edgeHover && ctx.canvas.width > 0 && ctx.canvas.height > 0) {
    // A hollow outline round the line, in orange to stand out from the blue of the selection:
    // the line itself is left alone, so that what is being changed on it can be seen.
    const ring = ringCanvas(ctx.canvas.width, ctx.canvas.height)
    const rc = ring.getContext('2d')!
    rc.setTransform(1, 0, 0, 1, 0, 0)
    rc.clearRect(0, 0, ring.width, ring.height)
    rc.setTransform(ctx.getTransform())
    rc.lineCap = 'round'
    rc.lineJoin = 'round'
    for (const [width, colour, cut] of [[22, 'rgb(249 115 22 / 22%)', false], [17, '#f97316', false], [12, '#000', true]] as const) {
      rc.globalCompositeOperation = cut ? 'destination-out' : 'source-over'
      rc.strokeStyle = colour
      rc.lineWidth = width
      for (const line of overlay.edgeHover) {
        rc.beginPath()
        line.forEach((p, i) => {
          const q = toScreen(p)
          if (i === 0) rc.moveTo(q.x, q.y)
          else rc.lineTo(q.x, q.y)
        })
        rc.stroke()
      }
    }
    rc.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(ring, 0, 0)
    ctx.restore()
  }
  if (overlay.face) {
    // Drawn over the face in the colour of the selection, with a glow that sets it apart from the
    // selection's own outline, so it is clear which side moves.
    ctx.setLineDash([])
    ctx.lineCap = 'round'
    for (const [width, colour] of [[9, 'rgb(13 153 255 / 22%)'], [2.5, ACCENT]] as const) {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.beginPath()
      for (const line of overlay.face) line.map(toScreen).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }
    ctx.lineCap = 'butt'
  }
  if (overlay.clearances) {
    // Thin, grey and dashed, so as not to be taken for dimensions of the drawing, with a tick across
    // each end; the length on a light ground, boxed under the pointer, where a click opens it.
    ctx.lineWidth = 1
    ctx.strokeStyle = '#6b7a90'
    for (const { from, to } of overlay.clearances) {
      ctx.setLineDash([4, 3])
      const [a, b] = [toScreen(from), toScreen(to)]
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const n = { x: ((a.y - b.y) / l) * 5, y: ((b.x - a.x) / l) * 5 }
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      for (const p of [a, b]) {
        ctx.moveTo(p.x - n.x, p.y - n.y)
        ctx.lineTo(p.x + n.x, p.y + n.y)
      }
      ctx.stroke()
    }
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    overlay.clearances.forEach(({ label }, i) => {
      const hovered = i === overlay.clearanceHover
      ctx.fillStyle = hovered ? '#ffffff' : 'rgb(255 255 255 / 80%)'
      ctx.beginPath()
      ctx.roundRect(label.x, label.y, label.width, label.height, 4)
      ctx.fill()
      if (hovered) {
        ctx.strokeStyle = ACCENT
        ctx.stroke()
        ctx.strokeStyle = '#6b7a90'
      }
      ctx.fillStyle = hovered ? '#1f2937' : '#5b6576'
      ctx.fillText(label.text, label.x + label.width / 2, label.y + label.height / 2 + 0.5)
    })
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  if (overlay.trim) {
    // Struck through in the colour of the split tool's mark: what goes when clicked.
    const line = overlay.trim.piece.map(toScreen)
    ctx.setLineDash([])
    ctx.lineCap = 'butt'
    for (const [width, colour] of [[Math.max(8, overlay.trim.width), 'rgb(229 0 138 / 25%)'], [2, '#e5008a']] as const) {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.setLineDash(width === 2 ? [6, 4] : [])
      ctx.beginPath()
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }
    ctx.setLineDash([])
  }
  if (overlay.cut) {
    const { at, dir, half } = overlay.cut
    const n = { x: -dir.y * half, y: dir.x * half }
    const [a, b] = [toScreen({ x: at.x - n.x, y: at.y - n.y }), toScreen({ x: at.x + n.x, y: at.y + n.y })]
    ctx.strokeStyle = '#e5008a'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    const { parts, gap = 0 } = overlay.cut
    ctx.fillStyle = '#e5008a'
    ctx.lineWidth = 1
    for (const [k, part] of (parts ?? []).entries()) {
      // The part on screen, and the side the lengths are written on at each of its points.
      const on = part.map(toScreen)
      const sides = on.map((_, i) => {
        const [p, q] = [on[Math.max(0, i - 1)], on[Math.min(on.length - 1, i + 1)]]
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1
        return { x: -(q.y - p.y) / l, y: (q.x - p.x) / l }
      })
      const line = on.map((p, i) => ({ x: p.x + sides[i].x * gap, y: p.y + sides[i].y * gap }))
      if (Math.hypot(line[line.length - 1].x - line[0].x, line[line.length - 1].y - line[0].y) < 16) continue
      ctx.beginPath()
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
      // A dotted line from each end of the measuring line back to the point it measures from: the
      // node at the end of the thing (a wall's corner, in the middle of its thickness) or the cut.
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      for (const i of [0, on.length - 1]) {
        ctx.moveTo(on[i].x, on[i].y)
        ctx.lineTo(on[i].x + sides[i].x * (gap + 4), on[i].y + sides[i].y * (gap + 4))
      }
      ctx.stroke()
      ctx.setLineDash([])
      // The node itself, marked: the first part starts at one, the second ends at the other.
      const node = k === 0 ? on[0] : on[on.length - 1]
      ctx.beginPath()
      ctx.arc(node.x, node.y, 3, 0, Math.PI * 2)
      ctx.fill()
      // An arrow at each end, pointing at the end it measures to.
      for (const [tip, back] of [[line[0], line[1]], [line[line.length - 1], line[line.length - 2]]]) {
        const l = Math.hypot(tip.x - back.x, tip.y - back.y) || 1
        const [ux, uy] = [(tip.x - back.x) / l, (tip.y - back.y) / l]
        ctx.beginPath()
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(tip.x - ux * 7 - uy * 3, tip.y - uy * 7 + ux * 3)
        ctx.lineTo(tip.x - ux * 7 + uy * 3, tip.y - uy * 7 - ux * 3)
        ctx.closePath()
        ctx.fill()
      }
    }
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
    ctx.fillStyle = label.measure ? '#e5008a' : palette.label.fill
    ctx.beginPath()
    ctx.roundRect(-width / 2, -9, width, 18, 4)
    ctx.fill()
    ctx.fillStyle = label.measure ? '#ffffff' : palette.label.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.text, 0, 0.5)
    ctx.restore()
  }
  ctx.textBaseline = 'alphabetic'
  if (overlay.smart) {
    ctx.strokeStyle = SNAP
    ctx.fillStyle = SNAP
    ctx.lineWidth = 1
    ctx.setLineDash([])
    for (const [from, to] of overlay.smart.lines) {
      const a = toScreen(from)
      const b = toScreen(to)
      ctx.beginPath()
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5)
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5)
      ctx.stroke()
    }
    ctx.font = `600 10px ${FONT}`
    ctx.textAlign = 'center'
    for (const [from, to] of overlay.smart.gaps) {
      const a = toScreen(from)
      const b = toScreen(to)
      // A gap is a line across the empty space with a stop at each end, and its size written on it.
      const level = Math.abs(b.y - a.y) < Math.abs(b.x - a.x)
      const [tx, ty] = level ? [0, 4] : [4, 0]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      for (const p of [a, b]) {
        ctx.moveTo(p.x - tx, p.y - ty)
        ctx.lineTo(p.x + tx, p.y + ty)
      }
      ctx.stroke()
      ctx.fillText(formatLength(Math.hypot(to.x - from.x, to.y - from.y)), (a.x + b.x) / 2 + (level ? 0 : 20), (a.y + b.y) / 2 + (level ? -6 : 3))
    }
    ctx.textAlign = 'left'
  }
  if (overlay.link) {
    const a = toScreen(overlay.link[0])
    const b = toScreen(overlay.link[1])
    ctx.strokeStyle = SNAP
    ctx.fillStyle = SNAP
    ctx.lineWidth = 1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  if (overlay.tracked) {
    ctx.strokeStyle = SNAP
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    for (const q of overlay.tracked) {
      const p = toScreen(q)
      ctx.moveTo(p.x - 4, p.y)
      ctx.lineTo(p.x + 4, p.y)
      ctx.moveTo(p.x, p.y - 4)
      ctx.lineTo(p.x, p.y + 4)
    }
    ctx.stroke()
  }
  if (overlay.marker) {
    const p = toScreen(overlay.marker.p)
    ctx.strokeStyle = SNAP
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    // Each kind of snap has its sign, as in drafting programs: a square on a point, a triangle on
    // a middle, a cross where lines cross, a square corner for a perpendicular, a diamond on a
    // line, an upright cross where it lines up with points around.
    switch (overlay.marker.kind) {
      case 'aligned':
        ctx.moveTo(p.x, p.y - 6)
        ctx.lineTo(p.x, p.y + 6)
        ctx.moveTo(p.x - 6, p.y)
        ctx.lineTo(p.x + 6, p.y)
        break
      case 'middle':
        ctx.moveTo(p.x, p.y - 6)
        ctx.lineTo(p.x + 6, p.y + 5)
        ctx.lineTo(p.x - 6, p.y + 5)
        ctx.closePath()
        break
      case 'crossing':
        ctx.moveTo(p.x - 5, p.y - 5)
        ctx.lineTo(p.x + 5, p.y + 5)
        ctx.moveTo(p.x + 5, p.y - 5)
        ctx.lineTo(p.x - 5, p.y + 5)
        break
      case 'perpendicular':
        ctx.moveTo(p.x - 6, p.y - 6)
        ctx.lineTo(p.x - 6, p.y + 6)
        ctx.lineTo(p.x + 6, p.y + 6)
        ctx.moveTo(p.x - 6, p.y)
        ctx.lineTo(p.x, p.y)
        ctx.lineTo(p.x, p.y + 6)
        break
      case 'edge':
        ctx.moveTo(p.x, p.y - 6)
        ctx.lineTo(p.x + 6, p.y)
        ctx.lineTo(p.x, p.y + 6)
        ctx.lineTo(p.x - 6, p.y)
        ctx.closePath()
        break
      default:
        ctx.rect(p.x - 5, p.y - 5, 10, 10)
    }
    ctx.stroke()
    if (overlay.marker.label) {
      ctx.font = `600 10px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillStyle = SNAP
      ctx.fillText(overlay.marker.label, p.x + 11, p.y + 17)
    }
  }
}
