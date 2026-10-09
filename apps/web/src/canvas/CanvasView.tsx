import { useEffect, useMemo, useRef, useState } from 'react'
import {
  boundsOfPoints,
  buildScene,
  dist,
  hitTest,
  itemsInside,
  kindOf,
  len,
  moveOps,
  newId,
  norm,
  openingSpan,
  perp,
  snapOpeningToWall,
  snapPointsOf,
  sub,
  type Node,
  type NodeInput,
  type Op,
  type Vec2,
  PAPER_FORMATS,
  paperSize,
  type SceneItem,
  wallEndFollowOps,
  wallFollowOps,
  boundsContainPoint,
  sceneBounds,
  transformOps,
  modifierKind,
  modifierParams,
  type Modifier,
  roomAt,
} from '@opencalque/core'
import { finishTextEdit, zoomToFit, withPaperContents } from '../actions'
import { onCommand } from '../commands'
import { t } from '../i18n'
import { usePrefs } from '../prefs'
import { formatLength, formatNumber, unit } from '../units'
import { apply, cancel, commit, editComponent, preview, registry, select, setTool, useStore, type Tool, type View } from '../store'
import { drawScene, gridStep, onPictureReady, type AngleMark, type Overlay, type SizeLabel, boxGrips } from './draw'
import { drawing } from './drawing'

type Gesture =
  | { kind: 'idle' }
  /** Button down on an object: becomes a move once the pointer travels far enough. */
  | { kind: 'press'; at: Vec2; start: Vec2; nodes: Node[] }
  | { kind: 'move'; start: Vec2; nodes: Node[] }
  | { kind: 'handle'; node: Node; index: number }
  /** A corner of a crop being dragged; `fixed` is the opposite corner, which stays where it is. */
  | { kind: 'crop'; node: Node; index: number; fixed: Vec2 }
  /** A corner of the box around the selection being dragged: everything scales about the opposite corner. */
  | { kind: 'scale'; nodes: Node[]; pivot: Vec2; corner: Vec2 }
  /** The knob of that box being dragged: everything turns about the middle of the box. `from` is the angle the drag started at. */
  | { kind: 'rotate'; nodes: Node[]; pivot: Vec2; from: number }
  | { kind: 'marquee'; start: Vec2; keep: string[] }
  /**
   * A two-point shape whose first point is set. `press` is where and when the button went down,
   * until it is released. `origin`, `segments` and `since` describe the run of chained shapes this
   * one continues: where it began, how many are drawn, and when the last one was finished.
   */
  | { kind: 'draw'; id: string; start: Vec2; press: (Vec2 & { time: number }) | null; origin: Vec2; segments: number; since: number }
  /** A dimension whose two points are set; the pointer now chooses how far its line stands off. */
  | { kind: 'offset'; id: string; a: Vec2; b: Vec2 }
  /** A live reading from `start`. Nothing is added to the drawing. */
  | { kind: 'measure'; start: Vec2 }
  /** A polyline with the points clicked so far; `since` is when the last one was added. */
  | { kind: 'poly'; id: string; points: Vec2[]; since: number }

/** The parts of a pointer event the canvas uses. */
interface PointerAt {
  clientX: number
  clientY: number
  altKey: boolean
  shiftKey: boolean
}

const TWO_POINT: Tool[] = ['line', 'wall', 'divider', 'dimension', 'annotation', 'rect', 'ellipse', 'paper']
/** Tools whose two typed sizes are a width and a height. */
const BOXES: Tool[] = ['rect', 'ellipse', 'paper']
/** How close, in screen pixels, the pointer must come to a standard format's corner for a paper to take that format. */
const FORMAT_REACH = 14
const CHAINED: Tool[] = ['line', 'wall', 'divider']
/**
 * A press only counts as dragging out a shape when the pointer travelled this far (px) and the
 * button was held this long (ms). Anything less is a click whose hand slipped, and must not leave
 * a stub behind.
 */
const DRAG_DISTANCE = 12
const DRAG_TIME = 200

const get = useStore.getState
const toWorld = (p: Vec2, view: View): Vec2 => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom })
const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Applies the sizes typed in the quick bar to where a shape would end: a typed size wins over
 * the pointer, which still chooses the direction (and the size that was not typed).
 */
function constrain(tool: Tool, start: Vec2, p: Vec2, free = false): Vec2 {
  const { a, b } = get().drawLocks
  if (a === undefined && b === undefined) return tool === 'paper' && !free ? (paperFormats(start, p).find((f) => f.active)?.b ?? p) : p
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    return { x: start.x + (a === undefined ? d.x : d.x < 0 ? -a : a), y: start.y + (b === undefined ? d.y : d.y < 0 ? -b : b) }
  }
  // Angles are entered counter-clockwise, as on paper; Y grows downward in the drawing.
  const angle = b === undefined ? Math.atan2(d.y, d.x) : (-b * Math.PI) / 180
  const length = a ?? len(d)
  return { x: round(start.x + Math.cos(angle) * length), y: round(start.y + Math.sin(angle) * length) }
}

/**
 * The standard formats a paper could take while it is pulled from `start` towards `p`: upright
 * when the pointer is further down than across, lying otherwise, and on whichever side of the
 * first corner the pointer is. The one whose far corner the pointer is close to is `active`.
 */
function paperFormats(start: Vec2, p: Vec2): NonNullable<Overlay['ghosts']> {
  const { paperScale, view } = get()
  const d = sub(p, start)
  const landscape = Math.abs(d.x) >= Math.abs(d.y)
  let nearest = FORMAT_REACH / view.zoom
  let active = ''
  const formats = PAPER_FORMATS.map((format) => {
    const size = paperSize(format.name, landscape, paperScale)!
    const b = { x: start.x + (d.x < 0 ? -size.width : size.width), y: start.y + (d.y < 0 ? -size.height : size.height) }
    if (dist(b, p) < nearest) {
      nearest = dist(b, p)
      active = format.name
    }
    return { a: start, b, label: format.name }
  })
  return formats.map((format) => ({ ...format, active: format.label === active }))
}

/**
 * `p` brought onto the nearest of the eight directions from `from` (across, up and down, and the
 * diagonals), at the same distance. Used where nothing else is snapped to, as on a scanned plan.
 */
function straighten(from: Vec2, p: Vec2): Vec2 {
  const d = sub(p, from)
  const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: round(from.x + Math.cos(angle) * len(d)), y: round(from.y + Math.sin(angle) * len(d)) }
}

/** The two sizes of a shape from `start` to `p`, as the quick bar shows them, and the labels drawn beside it. */
function sizes(tool: Tool, start: Vec2, p: Vec2): { live: { a: number; b: number }; labels: SizeLabel[]; angle?: AngleMark } {
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(d.x), height: Math.abs(d.y) }
    return { live: { a: box.width, b: box.height }, labels: boxLabels(box) }
  }
  const angle = (Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10 + 360) % 360
  if (len(d) < 1e-6) return { live: { a: 0, b: 0 }, labels: [] }
  // The length runs along the line, on its upper side and the right way up.
  let turn = (Math.atan2(d.y, d.x) * 180) / Math.PI
  if (turn > 90 || turn <= -90) turn += 180
  const up = { x: Math.sin((turn * Math.PI) / 180), y: -Math.cos((turn * Math.PI) / 180) }
  const length: SizeLabel = { at: { x: (start.x + p.x) / 2, y: (start.y + p.y) / 2 }, dx: up.x * 16, dy: up.y * 16, text: formatLength(len(d)), rotation: turn }
  return { live: { a: len(d), b: angle }, labels: [length], angle: { at: start, degrees: angle } }
}

/** A width under a box and a height to its right. */
function boxLabels(box: { x: number; y: number; width: number; height: number }): SizeLabel[] {
  return [
    { at: { x: box.x + box.width / 2, y: box.y + box.height }, dx: 0, dy: 18, text: formatLength(box.width) },
    { at: { x: box.x + box.width, y: box.y + box.height / 2 }, dx: 18, dy: 0, text: formatLength(box.height), rotation: -90 },
  ]
}

/** The node a two-point tool makes from its two points. */
function shape(tool: Tool, id: string, a: Vec2, b: Vec2, offset = 0): NodeInput {
  const { scope, activeLayer, wallThickness, dimensionTemplate, annotationTemplate, drawColor, paperScale, base, doc } = get()
  const common = { id, parent: scope, layer: activeLayer, ...(drawColor && tool !== 'dimension' && tool !== 'paper' ? { style: { stroke: drawColor } } : {}) }
  switch (tool) {
    case 'paper': {
      // Counted in the drawing as it was before this paper started to be drawn.
      const count = Object.values((base ?? doc).nodes).filter((n) => n.type === 'paper').length
      const name = t('Paper {n}', { n: String(count + 1).padStart(2, '0') })
      return { ...common, type: 'paper', name, scale: paperScale, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    case 'wall':
      return { ...common, type: 'wall', a, b, thickness: wallThickness }
    case 'divider':
      return { id, parent: scope, layer: activeLayer, type: 'divider', a, b }
    case 'annotation':
      // The tip is the first point clicked, the text goes at the second; the words are typed afterwards.
      return { ...annotationTemplate, ...common, type: 'annotation', a, b, text: '' } as NodeInput
    case 'dimension':
      // New dimensions read in the unit the user works in, unless the tool's settings say otherwise.
      return { unit: unit(), ...dimensionTemplate, ...common, type: 'dimension', a, b, offset } as NodeInput
    case 'rect':
      return { ...common, type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    case 'ellipse':
      return { ...common, type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 }
    default:
      return { ...common, type: 'line', a, b }
  }
}

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const view = useStore((s) => s.view)
  const viewport = useStore((s) => s.viewport)
  const tool = useStore((s) => s.tool)
  const placing = useStore((s) => s.placing)
  const [overlay, setOverlay] = useState<Overlay>({})
  const showGrid = usePrefs((p) => p.showGrid)
  const editingId = useStore((s) => s.editingText?.id)
  // Bumped when an imported picture finishes decoding, to paint it.
  const [pictures, setPictures] = useState(0)
  useEffect(() => {
    onPictureReady(() => setPictures((n) => n + 1))
  }, [])

  const extensionsVersion = useStore((s) => s.extensionsVersion)
  const scene = useMemo(() => buildScene(doc, scope, registry), [doc, scope, extensionsVersion])
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  const gesture = useRef<Gesture>({ kind: 'idle' })
  const pan = useRef<{ at: Vec2; view: View } | null>(null)
  const lastPointer = useRef<PointerAt | null>(null)
  /** Where the pointer last was, for finishing a shape from the keyboard. */
  const lastWorld = useRef({ world: { x: 0, y: 0 }, altKey: false, shiftKey: false })
  const space = useRef(false)
  /** Id of the object following the cursor while the place tool is active. */
  const placed = useRef(newId())

  const handles = useMemo(() => {
    const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return node ? (kindOf(node).handles?.(node) ?? []) : []
  }, [doc, selection])

  // The sizes of the one selected shape, shown beside it while nothing is being drawn.
  const selectionLabels = useMemo((): SizeLabel[] => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    if ((node?.type === 'rect' && !node.rotation) || node?.type === 'paper') return boxLabels(node)
    if (node?.type === 'ellipse') return boxLabels({ x: node.cx - node.rx, y: node.cy - node.ry, width: node.rx * 2, height: node.ry * 2 })
    if (node?.type === 'line' || node?.type === 'wall') return sizes('line', node.a, node.b).labels
    return []
  }, [doc, selection, tool])

  // The name of each paper, written above its corner. It is a label of the editor, not part of the drawing.
  const titles = useMemo(
    () => scene.flatMap((item) => (item.node.type === 'paper' ? [{ id: item.id, at: { x: item.node.x, y: item.node.y }, text: item.node.name ?? '', selected: selection.includes(item.id) }] : [])),
    [scene, selection],
  )
  const titlesRef = useRef(titles)
  titlesRef.current = titles
  /** The paper whose name is under a point of the canvas, so a paper can be picked up by its name. */
  const titleAt = (at: Vec2): SceneItem | null => {
    const { view } = get()
    const title = titlesRef.current.find((title) => {
      const x = title.at.x * view.zoom + view.x
      const y = title.at.y * view.zoom + view.y
      return at.x >= x - 2 && at.x <= x + Math.max(30, title.text.length * 6.5) && at.y >= y - 20 && at.y <= y - 2
    })
    return (title && sceneRef.current.find((item) => item.id === title.id && !item.locked)) ?? null
  }

  // The outlines of the modifiers of the one selected object, to show and, for a plain crop, to drag by the corners.
  const frames = useMemo(() => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return (node?.modifiers ?? []).flatMap((modifier, index) => {
      const kind = modifierKind(registry, modifier.type)
      if (!kind?.outline || modifier.enabled === false) return []
      const frame = modifier.frame ?? { x: 0, y: 0 }
      // Dragging corners keeps the rectangle upright, so it is offered only for one that is.
      const handles = modifier.type === 'crop' && !frame.rotation && !frame.flipX && (frame.scale ?? 1) === 1
      return [{ index, outline: kind.outline(modifierParams(kind, modifier.params), frame), handles }]
    })
  }, [doc, selection, tool, extensionsVersion])
  const framesRef = useRef(frames)
  framesRef.current = frames
  /** The corner of a draggable modifier outline under a point of the canvas. */
  const frameCornerAt = (at: Vec2): { index: number; corner: number; outline: Vec2[] } | null => {
    const { view } = get()
    for (const frame of framesRef.current) {
      if (!frame.handles) continue
      const corner = frame.outline.findIndex((p) => dist({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }, at) < 7)
      if (corner >= 0) return { index: frame.index, corner, outline: frame.outline }
    }
    return null
  }

  /** The box around the selection, when it is one that carries grips: a single object with handles of its own has none. */
  const gripBox = () => {
    const s = get()
    if (s.tool !== 'select' || s.selection.length === 0 || (s.selection.length === 1 && handles.length > 0)) return null
    return sceneBounds(sceneRef.current.filter((item) => s.selection.includes(item.id)))
  }
  /** Which grip of that box is under a point of the canvas: a corner (0 to 3), the knob, or none. */
  const gripAt = (at: Vec2): { box: NonNullable<ReturnType<typeof gripBox>>; corner: number | 'knob' } | null => {
    const box = gripBox()
    if (!box) return null
    const { corners, knob } = boxGrips(box, get().view)
    if (dist(knob, at) < 8) return { box, corner: 'knob' }
    const corner = corners.findIndex((p) => dist(p, at) < 8)
    return corner >= 0 ? { box, corner } : null
  }
  /** The pointer shown over a grip, so it says what dragging there does. */
  const [gripCursor, setGripCursor] = useState<string | null>(null)

  /** Tells the rest of the interface how far the shape in progress has got. Called after anything that may have changed it. */
  const syncStep = () => {
    const g = gesture.current
    const step = g.kind === 'draw' ? 1 + g.segments : g.kind === 'poly' ? g.points.length : g.kind === 'offset' ? 2 : g.kind === 'measure' ? 1 : 0
    if (get().drawStep !== step) useStore.setState({ drawStep: step })
  }

  const reset = () => {
    cancel()
    gesture.current = { kind: 'idle' }
    setOverlay({})
    syncStep()
  }

  // Switching tool or container abandons whatever was in progress.
  useEffect(() => {
    // A polyline in progress is kept as far as it got; anything else half-done is dropped.
    if (gesture.current.kind === 'poly') finishPoly(gesture.current, false)
    else reset()
    placed.current = newId()
  }, [tool, placing, scope])

  useEffect(() => {
    const canvas = canvasRef.current!
    const observer = new ResizeObserver(() => {
      useStore.setState({ viewport: { width: canvas.clientWidth, height: canvas.clientHeight } })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // Frame the drawing whenever a different document is shown, once the canvas has a size.
  const sized = viewport.width > 0
  useEffect(() => {
    if (sized) zoomToFit()
  }, [doc.id, sized])

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== viewport.width * dpr || canvas.height !== viewport.height * dpr) {
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
    }
    // The words being typed are shown by their editor instead; the rest of the object stays drawn.
    drawScene(canvas.getContext('2d')!, { ...viewport, dpr }, view, editingId ? scene.map((item) => (item.id === editingId ? { ...item, prims: item.prims.filter((p) => p.kind !== 'text') } : item)) : scene, selection, handles, { ...overlay, labels: overlay.labels ?? selectionLabels, titles, frames, grips: tool === 'select' }, showGrid)
  }, [scene, view, viewport, selection, handles, selectionLabels, titles, frames, overlay, showGrid, pictures, editingId, tool])

  /**
   * Where a point lands after snapping: on a nearby point of existing geometry, else on the grid.
   * Shift constrains to 45° steps from `from`; Alt turns snapping off.
   */
  const snap = (world: Vec2, e: { altKey: boolean; shiftKey: boolean }, exclude: string[], from?: Vec2) => {
    const { zoom } = get().view
    const { snapToGrid, snapToObjects } = usePrefs.getState()
    if (e.altKey) return { p: world, marker: null }
    const step = gridStep(zoom)
    if (e.shiftKey && from) {
      const d = sub(world, from)
      const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
      const length = Math.round(len(d) / step) * step
      return { p: { x: round(from.x + Math.cos(angle) * length), y: round(from.y + Math.sin(angle) * length) }, marker: null }
    }
    let best: Vec2 | null = null
    let reach = 10 / zoom
    for (const item of snapToObjects ? sceneRef.current : []) {
      if (exclude.includes(item.id)) continue
      for (const q of snapPointsOf(item)) {
        const d = dist(q, world)
        if (d < reach) {
          best = q
          reach = d
        }
      }
    }
    if (best) return { p: best, marker: best }
    if (!snapToGrid) return { p: world, marker: null }
    return { p: { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step }, marker: null }
  }

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Completes the shape being drawn at `p`. Chained tools then start the next one from there. */
  const finishShape = (g: Extract<Gesture, { kind: 'draw' }>, end: Vec2, chain: boolean) => {
    let p = end
    const { tool } = get()
    if (dist(g.start, p) < 1e-6) {
      // Clicking the last corner again ends the run. As a double-click on a run of walls, it also
      // closes the run back to where it started.
      const closes = tool === 'wall' && g.segments >= 2 && performance.now() - g.since < 500 && dist(g.start, g.origin) > 1e-6
      reset()
      if (closes) apply([{ op: 'add_node', node: shape('wall', newId(), g.start, g.origin) }])
      return
    }
    p = constrain(tool, g.start, p, lastWorld.current.altKey)
    useStore.setState({ drawLocks: {}, drawLive: null })
    if (tool === 'dimension') {
      // Not done yet: the next click places the dimension line.
      preview([{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])
      gesture.current = { kind: 'offset', id: g.id, a: g.start, b: p }
      return
    }
    if (tool === 'annotation') {
      // Not added yet: it stays a preview while its note is typed in place, then both are kept together.
      const create = shape(tool, g.id, g.start, p) as NodeInput & { id: string }
      if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: g.id, create } })
      else cancel()
      gesture.current = { kind: 'idle' }
      setOverlay({})
      return
    }
    if (preview([{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])) commit()
    else cancel()
    // A run that arrives back at its first point is complete.
    const continues = chain && CHAINED.includes(tool) && !(g.segments >= 1 && dist(p, g.origin) < 1e-6)
    gesture.current = continues
      ? { kind: 'draw', id: newId(), start: p, press: null, origin: g.origin, segments: g.segments + 1, since: performance.now() }
      : { kind: 'idle' }
  }

  const polyline = (id: string, points: Vec2[], closed: boolean): NodeInput => {
    const { scope, activeLayer, drawColor } = get()
    return { id, type: 'polyline', parent: scope, layer: activeLayer, points, closed, ...(drawColor ? { style: { stroke: drawColor } } : {}) }
  }

  /** Where the next point of a polyline goes: on its own first point when the pointer is near it (to close), else snapped and constrained. */
  const polyPoint = (g: Extract<Gesture, { kind: 'poly' }>, world: Vec2, e: { altKey: boolean; shiftKey: boolean }): Vec2 => {
    const last = g.points[g.points.length - 1]
    if (g.points.length >= 3 && dist(world, g.points[0]) * get().view.zoom < 10) return g.points[0]
    return constrain('polyline', last, snap(world, e, [g.id], last).p)
  }

  /** Ends the polyline being drawn, keeping it when it has at least one segment. */
  const finishPoly = (g: Extract<Gesture, { kind: 'poly' }>, closed: boolean) => {
    if (g.points.length >= 2 && preview([{ op: 'add_node', node: polyline(g.id, g.points, closed) }])) commit()
    else cancel()
    gesture.current = { kind: 'idle' }
    setOverlay({})
    useStore.setState({ drawLocks: {}, drawLive: null })
    syncStep()
  }

  // Lets the quick bar finish the shape in progress with the sizes typed there.
  useEffect(() => {
    drawing.commit = () => {
      const g = gesture.current
      const { world, ...keys } = lastWorld.current
      if (g.kind === 'draw') finishShape(g, snap(world, keys, [g.id], g.start).p, true)
      else if (g.kind === 'poly') {
        g.points.push(polyPoint(g, world, keys))
        g.since = performance.now()
        useStore.setState({ drawLocks: {} })
        preview([{ op: 'add_node', node: polyline(g.id, g.points, false) }])
      }
      syncStep()
    }
    drawing.refresh = () => lastPointer.current && moveTo(lastPointer.current)
    return () => {
      drawing.commit = null
      drawing.refresh = null
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.button === 1 || (e.button === 0 && (s.tool === 'hand' || space.current))) {
      pan.current = { at: { x: e.clientX, y: e.clientY }, view: s.view }
      return
    }
    if (e.button === 2) {
      // While drawing, the right button stops; otherwise it opens the menu for what is under it.
      if (s.tool !== 'select' || gesture.current.kind !== 'idle') return reset()
      const under = titleAt(at) ?? hitTest(sceneRef.current, world, 5 / s.view.zoom)
      // Anywhere in the box around the selection is a click on the selection, not beside it.
      const box = sceneBounds(sceneRef.current.filter((item) => s.selection.includes(item.id)))
      const onSelection = !under && box !== null && boundsContainPoint(box, world, 6 / s.view.zoom)
      if (!onSelection && (under ? !s.selection.includes(under.id) : s.selection.length > 0)) select(under ? [under.id] : [])
      useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } })
      return
    }
    if (e.button !== 0) return
    const g = gesture.current
    // A click while a text is being typed ends the typing and does nothing else.
    if (s.editingText) return finishTextEdit()

    if (s.tool === 'select') {
      const cropped = frameCornerAt(at)
      if (cropped) {
        gesture.current = { kind: 'crop', node: s.doc.nodes[s.selection[0]], index: cropped.index, fixed: cropped.outline[(cropped.corner + 2) % 4] }
        return
      }
      const grip = gripAt(at)
      if (grip) {
        const { box, corner } = grip
        const nodes = withPaperContents(s.selection).map((id) => s.doc.nodes[id])
        const points = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
        const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
        if (corner === 'knob') setGripCursor('grabbing')
        gesture.current =
          corner === 'knob'
            ? { kind: 'rotate', nodes, pivot: middle, from: Math.atan2(world.y - middle.y, world.x - middle.x) }
            : { kind: 'scale', nodes, pivot: points[(corner + 2) % 4], corner: points[corner] }
        return
      }
      const index = handles.findIndex((h) => dist({ x: h.x * s.view.zoom + s.view.x, y: h.y * s.view.zoom + s.view.y }, at) < 7)
      if (index >= 0) {
        gesture.current = { kind: 'handle', node: s.doc.nodes[s.selection[0]], index }
        return
      }
      const hit = titleAt(at) ?? hitTest(sceneRef.current, world, 5 / s.view.zoom)
      // On the drawing there is no "in between", so Shift and Ctrl (or Cmd) both add to or take from the selection.
      const adding = e.shiftKey || e.ctrlKey || e.metaKey
      if (!hit) {
        if (!adding) select([])
        gesture.current = { kind: 'marquee', start: world, keep: adding ? s.selection : [] }
        return
      }
      let ids = s.selection
      if (adding) ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id]
      else if (!ids.includes(hit.id)) ids = [hit.id]
      select(ids)
      // A paper is moved with everything that lies on it.
      if (ids.includes(hit.id)) gesture.current = { kind: 'press', at, start: world, nodes: withPaperContents(ids).map((id) => s.doc.nodes[id]) }
    } else if (s.tool === 'text') {
      // The text starts empty and is typed in place; see TextEditor.
      const { p } = snap(world, e, [])
      const create: NodeInput & { id: string } = { id: newId(), type: 'text', parent: s.scope, layer: s.activeLayer, x: p.x, y: p.y, text: '', size: 200, ...(s.drawColor ? { style: { stroke: s.drawColor } } : {}) }
      if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: create.id, create } })
    } else if (s.tool === 'place' || s.tool === 'room') {
      if (s.base) {
        commit()
        placed.current = newId()
      }
    } else if (s.tool === 'measure' || s.tool === 'calibrate') {
      // First click starts a reading, the second freezes it on screen until the next one.
      // Calibration picks points on a picture, which has nothing to snap to.
      // A picture has nothing to snap to, but its second point can still be held level, upright or on a diagonal.
      const p = s.tool === 'calibrate' ? (e.shiftKey && g.kind === 'measure' ? straighten(g.start, world) : world) : snap(world, e, [], g.kind === 'measure' ? g.start : undefined).p
      const reading = { a: g.kind === 'measure' ? g.start : p, b: p }
      setOverlay({ measure: reading })
      gesture.current = g.kind === 'measure' ? { kind: 'idle' } : { kind: 'measure', start: p }
      if (s.tool === 'calibrate') useStore.setState({ calibration: g.kind === 'measure' ? reading : null })
    } else if (s.tool === 'polyline') {
      if (g.kind !== 'poly') {
        gesture.current = { kind: 'poly', id: newId(), points: [snap(world, e, []).p], since: performance.now() }
        return
      }
      const p = polyPoint(g, world, e)
      const last = g.points[g.points.length - 1]
      // Clicking the last point again ends the line; coming back to the first one closes it.
      if (dist(p, last) < 1e-6) return finishPoly(g, false)
      if (g.points.length >= 3 && p === g.points[0]) return finishPoly(g, true)
      g.points.push(p)
      g.since = performance.now()
      useStore.setState({ drawLocks: {} })
    } else if (g.kind === 'offset') {
      commit()
      gesture.current = { kind: 'idle' }
    } else if (g.kind === 'draw') {
      finishShape(g, snap(world, e, [g.id], CHAINED.includes(s.tool) || s.tool === 'dimension' ? g.start : undefined).p, true)
    } else {
      const start = snap(world, e, []).p
      if (s.tool === 'paper') {
        // Sheets are large next to what is usually on screen. Step back, keeping the clicked corner
        // where it is, until an A3 fits in half the width, so the formats on offer can be seen.
        const fits = (0.5 * s.viewport.width) / (paperSize('A3', true, s.paperScale)!.width)
        if (s.view.zoom > fits) useStore.setState({ view: { zoom: fits, x: at.x - start.x * fits, y: at.y - start.y * fits } })
      }
      const drawn: Extract<Gesture, { kind: 'draw' }> = { kind: 'draw', id: newId(), start, press: { ...at, time: performance.now() }, origin: start, segments: 0, since: 0 }
      gesture.current = drawn
      // A box whose width and height were both typed needs no second point: one click places it.
      const { a, b } = s.drawLocks
      if (BOXES.includes(s.tool) && a !== undefined && b !== undefined) finishShape(drawn, { x: start.x + 1, y: start.y + 1 }, false)
    }
  }

  /** The guide to show for a line from `from` to `to`: none unless it is exactly horizontal or vertical. */
  const axisOf = (from: Vec2, to: Vec2): Overlay['axis'] => {
    const flat = Math.abs(to.y - from.y) < 1e-6
    const upright = Math.abs(to.x - from.x) < 1e-6
    return flat === upright ? undefined : { at: from, vertical: upright }
  }

  /** Everything that follows the pointer. Also called without it having moved, to redraw after a size is typed. */
  const moveTo = (e: PointerAt) => {
    lastPointer.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey }
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    if (pan.current) {
      const { view, at: from } = pan.current
      useStore.setState({ view: { ...view, x: view.x + e.clientX - from.x, y: view.y + e.clientY - from.y } })
      return
    }
    const g = gesture.current
    lastWorld.current = { world, altKey: e.altKey, shiftKey: e.shiftKey }
    let marker: Vec2 | null = null
    let labels: SizeLabel[] | undefined
    let angle: AngleMark | undefined
    let axis: Overlay['axis']
    let ghosts: Overlay['ghosts']
    let live: { a: number; b: number } | null = null
    let measure: Overlay['measure']
    let status = `${formatNumber(world.x)}, ${formatNumber(world.y)} ${unit()}`
    let previewed = true
    switch (g.kind) {
      case 'press':
        if (dist(at, g.at) > 3) gesture.current = { kind: 'move', start: g.start, nodes: g.nodes }
        break
      case 'move': {
        const step = e.altKey ? 0.001 : gridStep(s.view.zoom)
        const d = { x: Math.round((world.x - g.start.x) / step) * step, y: Math.round((world.y - g.start.y) / step) * step }
        // A single door or window slides along walls instead of moving freely.
        const only = g.nodes.length === 1 ? g.nodes[0] : null
        const span = only && !e.altKey ? openingSpan(only, registry) : null
        if (only?.type === 'parametric' && span) {
          const target = { x: (span[0].x + span[1].x) / 2 + world.x - g.start.x, y: (span[0].y + span[1].y) / 2 + world.y - g.start.y }
          const onWall = snapOpeningToWall(s.base ?? s.doc, s.scope, registry, only, target, 10 / s.view.zoom, step, only.rotation ?? 0)
          if (onWall) {
            previewed = preview([{ op: 'update_node', id: only.id, patch: onWall }])
            break
          }
        }
        const before = s.base ?? s.doc
        // Walls joined to the ones being moved stretch to stay joined, and openings follow their wall. Alt moves only what was picked.
        previewed = preview([...g.nodes.flatMap((n) => moveOps(before, n, d)), ...(e.altKey ? [] : wallFollowOps(before, g.nodes, d, registry))])
        break
      }
      case 'handle': {
        const target = snap(world, e, [g.node.id])
        marker = target.marker
        // The other walls that end at a wall's corner come along with it, unless Alt is held.
        const joined = e.altKey ? [] : wallEndFollowOps(s.base ?? s.doc, g.node, g.index, target.p)
        previewed = preview([{ op: 'update_node', id: g.node.id, patch: kindOf(g.node).moveHandle!(g.node, g.index, target.p) }, ...joined])
        break
      }
      case 'crop': {
        const target = snap(world, e, [g.node.id])
        marker = target.marker
        const width = Math.max(1, Math.abs(target.p.x - g.fixed.x))
        const height = Math.max(1, Math.abs(target.p.y - g.fixed.y))
        const modifiers = (g.node.modifiers ?? []).map((m, i): Modifier => (i === g.index ? { ...m, params: { ...m.params, width, height }, frame: { x: Math.min(target.p.x, g.fixed.x), y: Math.min(target.p.y, g.fixed.y) } } : m))
        previewed = preview([{ op: 'update_node', id: g.node.id, patch: { modifiers } }])
        status = `${formatNumber(width)} × ${formatLength(height)}`
        break
      }
      case 'scale': {
        // How far along the box's diagonal the pointer is, measured from the corner that stays put.
        const diagonal = sub(g.corner, g.pivot)
        const along = ((world.x - g.pivot.x) * diagonal.x + (world.y - g.pivot.y) * diagonal.y) / (diagonal.x ** 2 + diagonal.y ** 2 || 1)
        // In steps of 5% unless Alt is held; never down to nothing.
        const factor = Math.max(0.05, e.altKey ? along : Math.round(along * 20) / 20)
        previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, scale: factor }, registry))
        status = t('Scale {percent} %', { percent: String(Math.round(factor * 1000) / 10) })
        break
      }
      case 'rotate': {
        const raw = ((Math.atan2(world.y - g.pivot.y, world.x - g.pivot.x) - g.from) * 180) / Math.PI
        // Whole degrees; Shift keeps to steps of 15, Alt turns freely.
        const step = e.shiftKey ? 15 : e.altKey ? 0.01 : 1
        const degrees = Math.round(raw / step) * step
        previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, rotation: degrees }, registry))
        status = t('Rotation {degrees}°', { degrees: String(Math.round((((degrees % 360) + 360) % 360) * 100) / 100) })
        break
      }
      case 'draw': {
        const constrained = CHAINED.includes(s.tool) || s.tool === 'dimension'
        const target = snap(world, e, [g.id], constrained ? g.start : undefined)
        marker = target.marker
        const end = constrain(s.tool, g.start, target.p, e.altKey)
        // The formats on offer follow the pointer itself, so one stays lit while the paper is held on it.
        if (s.tool === 'paper' && s.drawLocks.a === undefined && s.drawLocks.b === undefined && !e.altKey) ghosts = paperFormats(g.start, target.p)
        previewed = preview([{ op: 'add_node', node: shape(s.tool, g.id, g.start, end) }])
        const d = sub(end, g.start)
        if (constrained) axis = axisOf(g.start, end)
        status = constrained ? t('Length {value}', { value: formatLength(len(d)) }) : `${formatNumber(Math.abs(d.x))} × ${formatLength(Math.abs(d.y))}`
        if (s.tool !== 'dimension' && s.tool !== 'annotation') ({ live, labels, angle } = sizes(s.tool, g.start, end))
        break
      }
      case 'poly': {
        const last = g.points[g.points.length - 1]
        const end = polyPoint(g, world, e)
        previewed = preview([{ op: 'add_node', node: polyline(g.id, [...g.points, end], false) }])
        status = t('Length {value}', { value: formatLength(dist(last, end)) })
        axis = axisOf(last, end)
        ;({ live, labels, angle } = sizes('polyline', last, end))
        break
      }
      case 'offset': {
        const n = perp(norm(sub(g.b, g.a)))
        const step = e.altKey ? 1 : gridStep(s.view.zoom)
        const offset = Math.round(((world.x - g.a.x) * n.x + (world.y - g.a.y) * n.y) / step) * step
        previewed = preview([{ op: 'add_node', node: shape('dimension', g.id, g.a, g.b, offset) }])
        status = t('Offset {value}', { value: formatLength(Math.abs(offset)) })
        break
      }
      case 'measure': {
        const target = s.tool === 'calibrate' ? { p: e.shiftKey ? straighten(g.start, world) : world, marker: null } : snap(world, e, [], g.start)
        marker = target.marker
        measure = { a: g.start, b: target.p }
        axis = axisOf(g.start, target.p)
        const d = sub(target.p, g.start)
        const angle = Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10
        status = `${t('Distance {value}', { value: formatLength(len(d)) })} · ΔX ${formatNumber(Math.abs(d.x))} · ΔY ${formatNumber(Math.abs(d.y))} · ${angle}°`
        break
      }
      case 'idle':
        {
          // The pointer says what a press here would do: resize along a diagonal, turn, or move a point.
          const grip = frameCornerAt(at) ?? gripAt(at)
          const own = s.tool === 'select' ? handles.findIndex((h) => dist({ x: h.x * s.view.zoom + s.view.x, y: h.y * s.view.zoom + s.view.y }, at) < 7) : -1
          const boxed = ['rect', 'paper'].includes(s.doc.nodes[s.selection[0]]?.type ?? '')
          const diagonal = (corner: number) => (corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize')
          const pointer = grip ? (grip.corner === 'knob' ? 'grab' : diagonal(grip.corner)) : own >= 0 ? (boxed ? diagonal(own) : 'move') : null
          if (pointer !== gripCursor) setGripCursor(pointer)
        }
        if (s.tool === 'room') {
          // A room is offered wherever the pointer is inside closed walls, as it would be: floor, name and area.
          const before = s.base ?? s.doc
          if (roomAt(before, s.scope, world)) {
            const count = Object.values(before.nodes).filter((n) => n.type === 'room').length
            const name = t('Room {n}', { n: String(count + 1).padStart(2, '0') })
            previewed = preview([{ op: 'add_node', node: { id: placed.current, type: 'room', parent: s.scope, layer: s.activeLayer, name, x: Math.round(world.x), y: Math.round(world.y) } }])
          } else {
            cancel()
            status = t('No closed space here: the walls around it must meet all the way round')
          }
        } else if (s.tool === 'place' && s.placing) {
          const target = snap(world, e, [placed.current])
          marker = target.marker
          const common = { id: placed.current, rotation: s.placingRotation, parent: s.scope, layer: s.activeLayer, x: target.p.x, y: target.p.y }
          // Doors and windows jump onto the wall under the cursor and turn to follow it.
          const onWall =
            s.placing.type === 'parametric' && !e.altKey
              ? snapOpeningToWall(s.base ?? s.doc, s.scope, registry, { kind: s.placing.kind, props: {} }, world, 10 / s.view.zoom, gridStep(s.view.zoom))
              : null
          if (onWall) marker = null
          const node: NodeInput =
            s.placing.type === 'instance'
              ? { ...common, type: 'instance', component: s.placing.component }
              : { ...common, ...onWall, type: 'parametric', kind: s.placing.kind, props: {} }
          previewed = preview([{ op: 'add_node', node }])
        } else if (TWO_POINT.includes(s.tool) || s.tool === 'measure') {
          marker = snap(world, e, []).marker
        }
    }
    // A finished measurement stays on screen until the next one starts.
    if (g.kind === 'marquee') {
      // Show what the box would select while it is being dragged, not only on release.
      const inside = itemsInside(sceneRef.current, boundsOfPoints([g.start, world])!).map((item) => item.id)
      const next = [...new Set([...g.keep, ...inside])]
      if (next.length !== s.selection.length || next.some((id, i) => id !== s.selection[i])) select(next)
    }
    setOverlay((o) => ({ marker, labels, angle, axis, ghosts, marquee: g.kind === 'marquee' ? { a: g.start, b: world } : undefined, measure: measure ?? o.measure }))
    // A failed preview has put its reason in the status bar; keep it there.
    if (previewed) useStore.setState({ status, drawLive: live })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => moveTo(e)

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pan.current) {
      pan.current = null
      return
    }
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    const g = gesture.current
    switch (g.kind) {
      case 'press':
        gesture.current = { kind: 'idle' }
        break
      case 'move':
      case 'handle':
      case 'crop':
      case 'scale':
      case 'rotate':
        // The box has changed under the pointer; the next movement works out what is there now.
        setGripCursor(null)
        commit()
        gesture.current = { kind: 'idle' }
        setOverlay({})
        break
      case 'marquee': {
        const inside = itemsInside(sceneRef.current, boundsOfPoints([g.start, world])!).map((item) => item.id)
        select([...new Set([...g.keep, ...inside])])
        gesture.current = { kind: 'idle' }
        setOverlay({})
        break
      }
      case 'draw':
        // Dragging from the first point to the second sets both at once; a plain click waits for the next click.
        if (g.press && dist(at, g.press) > DRAG_DISTANCE && performance.now() - g.press.time > DRAG_TIME) {
          finishShape(g, snap(world, e, [g.id], CHAINED.includes(s.tool) || s.tool === 'dimension' ? g.start : undefined).p, true)
        } else g.press = null
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = get()
    if (s.tool !== 'select') return
    const hit = hitTest(sceneRef.current, toWorld(local(e), s.view), 5 / s.view.zoom)
    if (hit?.node.type === 'instance') editComponent(hit.node.component)
    else if (hit?.node.type === 'group') editComponent(hit.id)
    else if (hit?.node.type === 'text' || hit?.node.type === 'annotation') useStore.setState({ editingText: { id: hit.id } })
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view } = get()
      const at = local(e)
      const zoom = Math.min(20, Math.max(0.002, view.zoom * Math.exp(-e.deltaY * 0.0015)))
      const world = toWorld(at, view)
      useStore.setState({ view: { zoom, x: at.x - world.x * zoom, y: at.y - world.y * zoom } })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Commands such as undo replace the document, so a half-finished gesture no longer applies.
  useEffect(() => onCommand((command) => command.interrupts && reset()), [])

  // Rebindable shortcuts are handled by the command registry. These three stay with the canvas
  // because what they do depends on the gesture in progress.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const s = get()
      if (e.key === ' ') {
        space.current = true
        e.preventDefault()
      } else if (/^[0-9]$/.test(e.key) && !e.shiftKey && document.querySelector('.quickbar .quick-size')) {
        // Typing a number while drawing goes to the first size field; the digit lands in it.
        document.querySelector<HTMLInputElement>('.quickbar .quick-size input')?.focus()
      } else if ((e.key === 'Escape' || e.key === 'Enter') && gesture.current.kind === 'poly') {
        // A polyline is finished, not thrown away, by Esc or Enter.
        finishPoly(gesture.current, false)
      } else if (e.key === 'Escape') {
        if (gesture.current.kind !== 'idle') reset()
        else if (s.tool !== 'select') setTool('select')
        else if (s.selection.length > 0) select([])
        else if (s.scope !== s.page) editComponent(null)
      } else if (e.key === 'Enter') reset()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const cursor = tool === 'hand' ? 'grab' : tool === 'select' ? (gripCursor ?? 'default') : 'crosshair'
  return (
    <canvas
      ref={canvasRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={(e) => (onPointerDown(e), syncStep())}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => (onPointerUp(e), syncStep())}
      onDoubleClick={(e) => (onDoubleClick(e), syncStep())}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
