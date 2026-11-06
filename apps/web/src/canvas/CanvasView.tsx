import { useWindows } from '../windows'
import { stopBrowsing } from '../actions/instances'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type NodeOf, type Primitive, dist, gridlineBubbles, wallEndState, boundsFrame, buildScene, connectedWalls, frameContains, frameGrips, hitTest, kindOf, modifierKind, modifierParams, newId, placedScene, resizeFrame, rotate, sceneBounds, turnedBox, wallEdgeLines, wallLength, wallMiddle } from '@opencalque/core'
import { finishTextEdit, zoomToFit } from '../actions'
import { commandFor, onCommand } from '../commands'
import { registry, useExtensions } from '../extensions'
import { editComponent, forgetTrail } from '../navigation'
import { usePrefs } from '../prefs'
import { apply, commit, preview, select, setTool, useStore } from '../store'
import { useTheme } from '../theme'
import { formatLength, formatNumber, unitSuffix } from '../units'
import { toWorld } from '../view'
import { trackedPoints } from './aim'
import { DARK_AROUND_CANVAS, DARK_CANVAS, drawScene, LIGHT_CANVAS, MAX_LINKED_WALLS, onPictureReady, onRepaint, type Overlay, type SizeLabel, type WallLinks } from './draw'
import { drawing } from './drawing'
import { TURNING, type Gesture, type PointerAt } from './gesture'
import { DRAW_PRESS, MOVES, PRESSES, RELEASES } from './gestures'
import { aim, finishArc, finishPoly, finishShape, polyPoint } from './gestures/drawTools'
import { finishOffset } from './gestures/offset'
import { finishTurn } from './gestures/turn'
import { shownClearances, useClearances, type ScreenBox } from './clearances'
import { lockedAmong, titleAt } from './picking'
import { get, local, reset, syncStep, type Canvas, type Move, type Release, type Shown } from './runtime'
import { boxLabels, paperLabel, polyline, roomsOnly, sizes, snapName, wallOps } from './shapes'

/**
 * The drawing area. It works out what to show from the store, paints it (`draw.ts`), and hands
 * the pointer to the gesture of the tool in use (`gestures/`), through the `Canvas` they share.
 */
/**
 * What is drawn of a node whose words are being typed: all but its text, which the box shows; of a
 * grid line, all but the label of the bubble being typed in (its labels are drawn bubble by bubble).
 */
function withoutTyped(prims: Primitive[], bubble: number | undefined): Primitive[] {
  let label = -1
  return prims.filter((p) => p.kind !== 'text' || (bubble !== undefined && ++label !== bubble))
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
  /** The pointer shown over a grip, so it says what dragging there does. */
  const [gripCursor, setGripCursor] = useState<string | null>(null)
  const showGrid = usePrefs((p) => p.showGrid)
  const palette = useTheme((s) => (s.darkCanvas ? DARK_CANVAS : s.dark ? DARK_AROUND_CANVAS : LIGHT_CANVAS))
  const editingId = useStore((s) => s.editingText?.id)
  const editingBubble = useStore((s) => s.editingText?.bubble)
  const corner = useStore((s) => s.corner)
  // The line of a wall pointed at in the properties panel, shown on the drawing so it is known which one it is.
  const edgeHover = useStore((s) => s.edgeHover)
  const edgeLines = useMemo(() => {
    const wall = edgeHover && doc.nodes[edgeHover.wall]
    return wall?.type === 'wall' ? wallEdgeLines(wall, doc, registry, edgeHover!.edge) : undefined
  }, [edgeHover, doc])
  // Bumped when an imported picture finishes decoding, to paint it.
  const [pictures, setPictures] = useState(0)
  useEffect(() => {
    onPictureReady(() => setPictures((n) => n + 1))
    // Once the view stops moving, the drawing stretched meanwhile is painted sharp.
    onRepaint(() => setPictures((n) => n + 1))
  }, [])

  const extensionsVersion = useExtensions((s) => s.version)
  const scene = useMemo(() => buildScene(doc, scope, registry), [doc, scope, extensionsVersion])
  // A component being edited is drawn as it is where it is placed, its unfilled shapes backed with white.
  const shown = useMemo(() => placedScene(doc, scope, scene), [doc, scope, scene])

  const handles = useMemo(() => {
    const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return node && !lockedAmong(doc, selection) ? (kindOf(node).handles?.(node, registry) ?? []) : []
  }, [doc, selection])

  /**
   * What the ends of the selected walls are joined to, shown on them: a corner is a place where
   * wall ends meet, not a thing, and nothing else tells which ends hold together, which were set
   * loose, and which only nearly meet another. The walls joined to them are lit up faintly.
   */
  const wallLinks = useMemo((): WallLinks | null => {
    if (tool !== 'select') return null
    const walls = selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as NodeOf<'wall'>] : []))
    if (walls.length === 0 || walls.length > MAX_LINKED_WALLS) return null
    const ends: WallLinks['ends'] = []
    const joined = new Set<string>()
    for (const wall of walls) {
      for (const end of ['a', 'b'] as const) {
        const state = wallEndState(doc, wall, end)
        for (const other of state.joined) if (!selection.includes(other.id)) joined.add(other.id)
        const kind = state.joined.length > 0 ? 'joined' : state.touching.length > 0 ? 'apart' : state.near ? 'near' : 'free'
        ends.push({ at: wall[end], kind, ...(state.near && kind === 'near' ? { near: state.near.at } : {}) })
      }
    }
    return { ends, joined: [...joined] }
  }, [doc, selection, tool])

  /**
   * The frame a single box-shaped object (a rectangle, an ellipse) is resized by, turning with it:
   * its eight grips on the drawing and where its knob is. It takes the place of the selection box.
   */
  const frame = useMemo(() => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    const box = node && !lockedAmong(doc, selection) ? resizeFrame(node, registry, doc) : null
    if (!node || !box) return null
    const grips = frameGrips(box)
    // The knob stands off the middle of the top side, away from the box, at the same distance on screen at any zoom.
    const up = rotate({ x: 0, y: -1 }, box.rotation)
    return { node, box, grips, corners: grips.slice(0, 4), centre: { x: (grips[0].x + grips[2].x) / 2, y: (grips[0].y + grips[2].y) / 2 }, up }
  }, [doc, selection, tool])

  /**
   * The box around one selected object that turns but has no frame to be resized by (a text, a
   * picture, a compass): the box it fills unturned, turned with it. It keeps its shape as the
   * object turns, its knob stays under the pointer, and the object turns about its own middle.
   */
  const ownBox = useMemo(() => {
    const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return node && TURNING.includes(node.type) ? turnedBox(doc, node, registry) : null
  }, [doc, selection, extensionsVersion])

  // The sizes of the one selected shape, shown beside it while nothing is being drawn.
  const selectionLabels = useMemo((): SizeLabel[] => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    if (node?.type === 'paper') return paperLabel(node)
    if (node?.type === 'rect' && !node.rotation) return boxLabels(node)
    // An object resized as a box, a stair, has its sizes written beside it like a rectangle.
    if ((node?.type === 'parametric' || node?.type === 'instance') && frame && !frame.box.rotation) return boxLabels({ ...frame.box.origin, width: frame.box.width, height: frame.box.height })
    if (node?.type === 'ellipse') return boxLabels({ x: node.cx - node.rx, y: node.cy - node.ry, width: node.rx * 2, height: node.ry * 2 })
    // A curved wall is as long as its curve, which is written at the top of it.
    if (node?.type === 'wall' && node.bulge) return [{ at: wallMiddle(node), dx: 0, dy: -18, text: formatLength(wallLength(node)) }]
    if (node?.type === 'line' || node?.type === 'wall') return sizes('line', node.a, node.b).labels
    // A door or a window: the width its two ends stretch.
    if (node?.type === 'parametric' && handles.length === 2) return sizes('line', handles[0], handles[1]).labels
    return []
  }, [doc, selection, tool, handles, frame])

  // How far the one object selected stands from the walls around it, with each length where it is written.
  // Those worth showing, each length where it covers neither the object nor its sizes.
  const measured = useClearances()
  const clearanceLines = useMemo(() => {
    if (!measured) return undefined
    // A slanting wall's box would take in the very places its lengths go: only an object's is kept clear.
    const bounds = measured.node.type === 'wall' ? null : scene.find((item) => item.id === measured.node.id)?.bounds
    const own: ScreenBox[] = bounds ? [{ x: bounds.minX * view.zoom + view.x, y: bounds.minY * view.zoom + view.y, width: (bounds.maxX - bounds.minX) * view.zoom, height: (bounds.maxY - bounds.minY) * view.zoom }] : []
    const sizes = selectionLabels.map((label): ScreenBox => {
      // As the canvas writes them: 11 px text in a box 18 high, upright for a height.
      const [width, height] = [label.text.length * 6.5 + 12, 18]
      const [w, h] = Math.abs(Math.abs(label.rotation ?? 0) - 90) < 1 ? [height, width] : [width, height]
      const x = label.at.x * view.zoom + view.x + label.dx
      const y = label.at.y * view.zoom + view.y + label.dy
      return { x: x - w / 2, y: y - h / 2, width: w, height: h }
    })
    return shownClearances(measured.node, measured.list, view, [...own, ...sizes])
  }, [measured, view, scene, selectionLabels])

  // The name of each paper, written above its corner. It is a label of the editor, not part of the drawing.
  const titles = useMemo(
    () => scene.flatMap((item) => (item.node.type === 'paper' ? [{ id: item.id, at: { x: item.node.x, y: item.node.y }, text: item.node.name ?? '', selected: selection.includes(item.id) }] : [])),
    [scene, selection],
  )

  // The outlines of the modifiers of the one selected object, to show and, for a plain crop, to drag by the corners.
  const frames = useMemo(() => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return (node?.modifiers ?? []).flatMap((modifier, index) => {
      const kind = modifierKind(registry, modifier.type)
      if (!kind?.outline || modifier.enabled === false) return []
      const frame = modifier.frame ?? { x: 0, y: 0 }
      // Dragging corners keeps the rectangle upright, so it is offered only for one that is.
      const handles = modifier.type === 'crop' && !frame.rotation && !frame.flipX && (frame.scale ?? 1) === 1 && !lockedAmong(doc, selection)
      return [{ index, outline: kind.outline(modifierParams(kind, modifier.params), frame), handles }]
    })
  }, [doc, selection, tool, extensionsVersion])

  // What the gestures work with, for the life of the canvas; what this render worked out is put in it.
  const runtime = useRef<Canvas | null>(null)
  runtime.current ??= {
    gesture: { kind: 'idle' },
    pan: null,
    lastPointer: null,
    lastWorld: { world: { x: 0, y: 0 }, altKey: false, shiftKey: false },
    space: false,
    spaceTap: null,
    ended: null,
    lastClick: null,
    endedLine: null,
    placed: newId(),
    tracked: { tool: 'select', points: [], resting: null },
    scene: [],
    titles: [],
    frames: [],
    handles: [],
    frame: null,
    ownBox: null,
    clearanceLabels: [],
    gripCursor: null,
    element: () => canvasRef.current!,
    setOverlay,
    setGripCursor,
  }
  const c = runtime.current
  Object.assign(c, { scene, titles, frames, handles, frame, ownBox, gripCursor, clearanceLabels: clearanceLines?.map((line) => line.label) ?? [] })

  // Switching tool or container abandons whatever was in progress.
  useEffect(() => {
    // A polyline in progress is kept as far as it got; anything else half-done is dropped.
    if (c.gesture.kind === 'poly') finishPoly(c, c.gesture, false)
    else reset(c)
    c.placed = newId()
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

  // What is painted: while a text is typed in place, without that text. Kept from one paint to the
  // next, so that the painter can keep the drawing it painted from it (`drawScene`).
  const drawnScene = useMemo(
    () => (editingId ? shown.map((item) => (item.id === editingId ? { ...item, prims: withoutTyped(item.prims, editingBubble) } : item)) : shown),
    [shown, editingId, editingBubble],
  )

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== viewport.width * dpr || canvas.height !== viewport.height * dpr) {
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
    }
    // The words being typed are shown by their editor instead; the rest of the object stays drawn.
    drawScene(canvas.getContext('2d')!, { ...viewport, dpr }, view, drawnScene, selection, handles, { ...overlay, labels: overlay.labels ?? selectionLabels, titles, frames, corner, grips: tool === 'select' && !roomsOnly(doc, selection) && !lockedAmong(doc, selection), boxless: roomsOnly(doc, selection), frame: frame && { grips: frame.grips, up: frame.up }, box: overlay.box ?? ownBox, edgeHover: edgeLines, wallLinks, clearances: clearanceLines }, showGrid, palette)
  }, [drawnScene, view, viewport, selection, handles, frame, ownBox, selectionLabels, titles, frames, corner, overlay, showGrid, palette, pictures, tool, edgeLines, wallLinks, clearanceLines])

  // Lets the quick bar finish the shape in progress with the sizes typed there.
  useEffect(() => {
    drawing.commit = () => {
      const g = c.gesture
      const { world, ...keys } = c.lastWorld
      if (g.kind === 'draw') finishShape(c, g, aim(c, g, world, keys).p, true)
      else if (g.kind === 'arc') finishArc(c, g, world, keys)
      else if (g.kind === 'parallel') finishOffset(c, g, world, keys)
      else if (g.kind === 'turn' && g.from) finishTurn(c, g, world, keys)
      else if (g.kind === 'poly') {
        g.points.push(polyPoint(c, g, world, keys))
        g.since = performance.now()
        useStore.setState({ drawLocks: {}, axisLock: null })
        preview([{ op: 'add_node', node: polyline(g.id, g.points, false) }])
      }
      syncStep(c)
    }
    drawing.refresh = () => c.lastPointer && moveTo(c.lastPointer)
    return () => {
      drawing.commit = null
      drawing.refresh = null
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = get()
    const at = local(c, e)
    const world = toWorld(at, s.view)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.button === 1 || (e.button === 0 && (s.tool === 'hand' || c.space))) {
      if (c.space && c.spaceTap) c.spaceTap.used = true
      c.pan = { at: { x: e.clientX, y: e.clientY }, view: s.view }
      return
    }
    if (e.button === 2) {
      // While drawing, the right button stops; otherwise it opens the menu for what is under it.
      if (s.tool !== 'select' || c.gesture.kind !== 'idle') return reset(c)
      const under = titleAt(c, at) ?? hitTest(c.scene, world, 5 / s.view.zoom)
      // Anywhere in the box around the selection is a click on the selection, not beside it. Rooms have none: their floor is not clickable.
      const bounds = roomsOnly(s.doc, s.selection) ? null : sceneBounds(c.scene.filter((item) => s.selection.includes(item.id)))
      const box = bounds && (c.ownBox ?? boundsFrame(bounds))
      const onSelection = !under && box !== null && frameContains(box, world, 6 / s.view.zoom)
      if (!onSelection && (under ? !s.selection.includes(under.id) : s.selection.length > 0)) select(under ? [under.id] : [])
      useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY }, menuPoint: world })
      return
    }
    if (e.button !== 0) return
    // A click while a text is being typed ends the typing and does nothing else.
    if (s.editingText) return finishTextEdit()
    ;(PRESSES[s.tool] ?? DRAW_PRESS)(c, e, at, world)
  }

  /** Everything that follows the pointer. Also called without it having moved, to redraw after a size is typed. */
  const moveTo = (e: PointerAt) => {
    c.lastPointer = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }
    const s = get()
    const at = local(c, e)
    const world = toWorld(at, s.view)
    if (c.pan) {
      const { view, at: from } = c.pan
      useStore.setState({ view: { ...view, x: view.x + e.clientX - from.x, y: view.y + e.clientY - from.y } })
      return
    }
    const g = c.gesture
    c.lastWorld = { world, altKey: e.altKey, shiftKey: e.shiftKey }
    const out: Shown = { marker: null, live: null, status: `${formatNumber(world.x)}, ${formatNumber(world.y)} ${unitSuffix()}`.trim(), previewed: true }
    ;(MOVES[g.kind] as Move<Gesture['kind']>)(c, g, e, at, world, out)
    // A finished measurement stays on screen until the next one starts.
    const { marker } = out
    const tracked = trackedPoints(c)
    setOverlay((o) => ({ tracked: tracked.length > 0 ? tracked : undefined, cut: out.cut, trim: out.trim, lit: out.lit, face: out.face, box: out.turning, marker: marker && { ...marker, label: snapName(marker.kind) }, smart: out.smart ?? (marker?.guides ? { lines: marker.guides, gaps: [] } : undefined), link: out.link, labels: out.labels, angle: out.angle, axis: out.axis, guide: out.guide, ghosts: out.ghosts, marquee: out.marquee, clearanceHover: out.clearanceHover, measure: out.measure ?? o.measure, angleReading: out.angleReading ?? o.angleReading }))
    // A failed preview has put its reason in the status bar; keep it there.
    if (out.previewed) useStore.setState({ status: out.status, drawLive: out.live })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (c.pan) {
      c.pan = null
      return
    }
    const s = get()
    const at = local(c, e)
    const world = toWorld(at, s.view)
    // Dragged here from the object library: it is put down where it is let go, once, and selected.
    if (s.tool === 'place' && s.placing?.carried && s.base) {
      const id = c.placed
      commit()
      setTool('select')
      select([id])
      return
    }
    const g = c.gesture
    ;(RELEASES[g.kind] as Release<Gesture['kind']> | undefined)?.(c, g, e, at, world)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = get()
    const line = c.endedLine
    const drawn = line && s.doc.nodes[line.id]
    if ((s.tool === 'line' || s.tool === 'curve') && line && drawn?.type === 'polyline' && performance.now() - line.time < 1500 && c.gesture.kind === 'idle') {
      // The line ended by the second click of this double-click: close it into a shape.
      c.endedLine = null
      apply([{ op: 'update_node', id: line.id, patch: { closed: true } }])
      return
    }
    const run = c.ended
    if (s.tool === 'wall' && run && performance.now() - run.time < 1500 && c.gesture.kind === 'idle') {
      // The run of walls ended by the second click of this double-click: close it back to where it started.
      c.ended = null
      apply(wallOps(newId(), run.start, run.origin))
      return
    }
    if (s.tool !== 'select') return
    const hit = hitTest(c.scene, toWorld(local(c, e), s.view), 5 / s.view.zoom)
    // A double-click goes inside what was clicked (a component, a group, the words of a text), or,
    // on a wall, takes in the walls joined to it end to end: its run, then, once that is selected,
    // every wall that holds together with it. Cutting a wall in two is the Split tool's.
    if (hit?.node.type === 'wall') {
      const run = connectedWalls(s.doc, hit.node)
      const whole = run.every((id) => s.selection.includes(id)) && s.selection.length === run.length
      select(whole ? connectedWalls(s.doc, hit.node, true) : run)
    } else if (hit?.node.type === 'instance') editComponent(hit.node.component, hit.node)
    else if (hit?.node.type === 'group') editComponent(hit.id)
    else if (hit?.node.type === 'text' || hit?.node.type === 'annotation') useStore.setState({ editingText: { id: hit.id } })
    else if (hit?.node.type === 'gridline') {
      // Its label is typed in the bubble nearest where it was double-clicked; with no bubble it has nowhere to be typed.
      const at = toWorld(local(c, e), s.view)
      const bubbles = gridlineBubbles(hit.node)
      const nearest = bubbles.reduce((best, b, i) => (dist(b.centre, at) < dist(bubbles[best].centre, at) ? i : best), 0)
      if (bubbles.length > 0) useStore.setState({ editingText: { id: hit.id, bubble: nearest } })
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view } = get()
      const at = local(c, e)
      const zoom = Math.min(20, Math.max(0.002, view.zoom * Math.exp(-e.deltaY * 0.0015)))
      const world = toWorld(at, view)
      useStore.setState({ view: { zoom, x: at.x - world.x * zoom, y: at.y - world.y * zoom } })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Commands such as undo replace the document, so a half-finished gesture no longer applies.
  useEffect(() => onCommand((command) => command.interrupts && reset(c)), [])

  // Rebindable shortcuts are handled by the command registry. These three stay with the canvas
  // because what they do depends on the gesture in progress. Space held moves the view; a tap on
  // it puts the drawing down and goes back to selecting, which is what usually follows.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const s = get()
      // Space with Shift flips what is drawn or selected (a command, which can be given plain Space
      // too): a key a command takes neither pans nor finishes the drawing.
      if (e.key === ' ' && commandFor(e)) return
      if (e.key === ' ') {
        c.space = true
        if (!e.repeat) c.spaceTap = { at: performance.now(), used: false }
        e.preventDefault()
      } else if (/^[0-9]$/.test(e.key) && !e.shiftKey && document.querySelector('.quickbar .quick-size')) {
        // Typing a number while drawing goes to the first size field; the digit lands in it.
        document.querySelector<HTMLInputElement>('.quickbar .quick-size input')?.focus()
      } else if ((e.key === 'Escape' || e.key === 'Enter') && c.gesture.kind === 'poly') {
        // A polyline is finished, not thrown away, by Esc or Enter.
        finishPoly(c, c.gesture, false)
      } else if (e.key === 'Escape') {
        if (c.gesture.kind !== 'idle') reset(c)
        else if (s.tool !== 'select') setTool('select')
        // Going through the placements of a component: Escape stops, leaving the one shown selected.
        else if (useWindows.getState().browsing) stopBrowsing()
        else if (s.selection.length > 0 || s.corner) select([])
        else if (s.scope !== s.page) editComponent(null)
        // Out on the page with nothing to let go of but the places just left.
        else if (s.trail) forgetTrail()
      } else if (e.key === 'Enter') reset(c)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      c.space = false
      const tap = c.spaceTap
      c.spaceTap = null
      if (!tap || tap.used || performance.now() - tap.at > 300) return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      // Not in the middle of dragging something: only a drawing being made is put down, as Esc does.
      const g = c.gesture
      if (g.kind === 'poly') finishPoly(c, g, false)
      else if (['draw', 'offset', 'arc', 'parallel', 'measure', 'angle', 'turn'].includes(g.kind)) reset(c)
      else if (g.kind !== 'idle') return
      if (get().tool !== 'select') setTool('select')
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
      onPointerDown={(e) => (onPointerDown(e), syncStep(c))}
      // A press that has just opened words to type in place (a text, a note) leaves the focus in
      // them: the browser would otherwise move it as the mouse goes down, after the box took it.
      onMouseDown={(e) => e.button === 0 && get().editingText && e.preventDefault()}
      onPointerMove={moveTo}
      onPointerUp={(e) => (onPointerUp(e), syncStep(c))}
      onPointerLeave={() => {
        // A face pointed at is no longer once the pointer has gone, to the panels or elsewhere.
        if (c.gesture.kind !== 'idle' || !get().wallFace) return
        useStore.setState({ wallFace: null })
        setOverlay((o) => ({ ...o, face: undefined }))
      }}
      onDoubleClick={(e) => (onDoubleClick(e), syncStep(c))}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
