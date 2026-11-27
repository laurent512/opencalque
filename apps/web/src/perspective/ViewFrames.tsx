import { sceneOf } from '../scenes'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Lock } from 'lucide-react'
import { buildScene, coveredInScene, fovOf, hitTest, isLocked, isVisible, leavesOf, lookAround, solidAt, stepAside, type Camera } from '@opencalque/core'
import { t } from '../i18n'
import { usePrefs } from '../prefs'
import { commit, preview, select, useStore } from '../store'
import type { PerspectiveView } from './render'
import { camerasOf, framesOf, later, useSeen, type Frame, type Look } from './seen'
import { viewPainted, viewPictures } from '../canvas/draw'
import { nameBox } from '../canvas/ElevationLabels'
import { registry } from '../extensions'

/*
 * The views of the viewpoints, each in a frame of its own on the plan (ARCHITECTURE, "Viewpoints"):
 * placed in the drawing (`frame` of the camera node), they pan and zoom with it, but are drawn by the
 * editor only, never printed. A frame is moved by its name above it and sized by its corner. A
 * first click on a view selects it, its viewpoint, as a first click on a group does; the view is
 * then entered, and a click in it selects what is under the pointer, the plan's own object
 * (`solidAt`), or the viewpoint where nothing is. It stays entered while its viewpoint is selected,
 * or what was picked in it, and only a view entered moves in 3D (unless its camera is fixed), so that a
 * press on a view, or working on the plan, never turns it by mistake (a drag in a view not entered
 * selects its viewpoint, and does no more): a drag looks around, the middle button or Shift moves where it stands, the
 * wheel walks and, with Ctrl, changes the lens. Over any other frame the wheel zooms the plan, as
 * everywhere on it; with a drawing tool, the frames let the plan have the pointer.
 */

/** How far ahead what follows the pointer is, when the view is dragged to move where it stands, in mm: across a room. */
const GRAB_DEPTH = 3000
/** How far a turn of the wheel walks, in mm for each pixel it scrolls (a notch is about 100: 25 cm), how much it changes the lens with Ctrl, and how long it is still before its turns are one step of undo, in ms. */
const WALK_PER_PIXEL = 2.5
const LENS_PER_PIXEL = 0.002
const WHEEL_PAUSE = 400
/**
 * How long the plan must stay still (not zoomed nor panned) before views do anything heavy, in ms:
 * meanwhile each keeps its last picture, stretched, and the plan moves as smoothly as with none.
 */
const SETTLE = 250
/** The most views that keep a renderer (a WebGL context) at once: past it, those seen least lately give theirs back. */
const MOST_RENDERERS = 8
/** Below this width on screen, in pixels, a frame's view is not drawn again: its last picture is shrunk. */
const SMALLEST = 60
/** The most pixels a view is drawn across: the largest frame on the largest screen, drawn twice for smooth lines. */
const MOST_PIXELS = 3200
/** The least width of a frame, in mm. */
const NARROWEST = 500
/** How far the pointer may go, in pixels, for a press and release to be a click rather than a drag. */
const CLICK = 4

/** Where a frame is taken to be sized: its corners and the middles of its sides, by the compass. */
type Grip = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const GRIPS: Grip[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * A frame sized by `grip`, dragged `dx`, `dy` mm: the sides it holds move, the others stay, never
 * under `NARROWEST` either way. A corner with `keep` grows both ways alike, by the more it was dragged.
 */
function sized(frame: Frame, grip: Grip, dx: number, dy: number, keep: boolean): Frame {
  const [west, east, north, south] = [grip.includes('w'), grip.includes('e'), grip.includes('n'), grip.includes('s')]
  let width = frame.width + (east ? dx : west ? -dx : 0)
  let height = frame.height + (south ? dy : north ? -dy : 0)
  if (keep && (west || east) && (north || south)) {
    const scale = Math.max(width / frame.width, height / frame.height)
    ;[width, height] = [frame.width * scale, frame.height * scale]
  }
  width = Math.round(Math.max(NARROWEST, width))
  height = Math.round(Math.max(NARROWEST, height))
  return { x: west ? frame.x + frame.width - width : frame.x, y: north ? frame.y + frame.height - height : frame.y, width, height }
}

/** The accent colour of the page, what is selected is lit in. */
const accentColour = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f80ed'

/** Three.js and the renderer, loaded once, when the first view is drawn. */
let loading: Promise<typeof import('./render')> | null = null
const renderer = () => (loading ??= import('./render'))

/**
 * The views that hold a renderer, the one seen last at the end: a view keeps its renderer and its
 * last picture when it goes out of sight or is zoomed small, so that it is back at once, until more
 * than `MOST_RENDERERS` hold one (a browser allows few WebGL contexts), when those seen least lately
 * give theirs back.
 */
const holding: { id: string; release: () => void }[] = []
function seenNow(id: string, release: () => void): void {
  const at = holding.findIndex((one) => one.id === id)
  if (at >= 0) holding.splice(at, 1)
  holding.push({ id, release })
  while (holding.length > MOST_RENDERERS) holding.shift()!.release()
}
function letGo(id: string): void {
  const at = holding.findIndex((one) => one.id === id)
  if (at >= 0) holding.splice(at, 1)
}

/** Whether the plan has stood still for `SETTLE` ms: false while it is zoomed or panned. */
function useSettled(): boolean {
  const view = useStore((s) => s.view)
  const [settled, setSettled] = useState(true)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSettled(false)
    const id = window.setTimeout(() => setSettled(true), SETTLE)
    return () => window.clearTimeout(id)
  }, [view.zoom, view.x, view.y])
  return settled
}

export function ViewFrames() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const view = useStore((s) => s.view)
  const drawing = useStore((s) => s.tool !== 'select')
  const viewport = useStore((s) => s.viewport)
  const selection = useStore((s) => s.selection)
  const cameras = useMemo(() => camerasOf(doc, scope).filter((c) => isVisible(doc, c)), [doc, scope])
  // The view last clicked, and what it picked: in hand while that stays the selection.
  const [held, setHeld] = useState<{ camera: string; picked: string } | null>(null)
  const frames = useMemo(() => framesOf(doc, cameras), [doc, cameras])
  // What is stacked over a view hides its frame, as it hides its picture; and where its name is, its name.
  const scene = useMemo(() => (cameras.length > 0 ? sceneOf(doc, scope) : []), [doc, scope, cameras])
  const covered = useMemo(() => {
    const out = new Map<string, { frame: boolean; name: boolean }>()
    for (const camera of cameras) {
      const f = frames.get(camera.id)!
      const box = { minX: f.x, minY: f.y, maxX: f.x + f.width, maxY: f.y + f.height }
      out.set(camera.id, { frame: coveredInScene(scene, camera.id, box), name: coveredInScene(scene, camera.id, nameBox(box, view.zoom)) })
    }
    return out
  }, [scene, cameras, frames, view.zoom])
  const settled = useSettled()
  return (
    <>
      {cameras.map((camera) => {
        const frame = frames.get(camera.id)!
        const box = { left: frame.x * view.zoom + view.x, top: frame.y * view.zoom + view.y, width: frame.width * view.zoom, height: frame.height * view.zoom }
        // Out of sight, it is not drawn again, but kept, with its last picture, to be back at once.
        const off = box.left > viewport.width || box.top > viewport.height || box.left + box.width < 0 || box.top + box.height < 0
        const active = selection.includes(camera.id)
        const picked = held?.camera === camera.id && selection.length === 1 && selection[0] === held.picked
        return <ViewFrame key={camera.id} camera={camera} frame={frame} box={box} off={off} settled={settled} active={active} covered={active ? undefined : covered.get(camera.id)} inHand={active || picked} hold={(id) => setHeld({ camera: camera.id, picked: id })} passive={drawing} zoom={view.zoom} />
      })}
    </>
  )
}

function ViewFrame(props: { camera: Camera; frame: Frame; box: { left: number; top: number; width: number; height: number }; off: boolean; settled: boolean; active: boolean; covered?: { frame: boolean; name: boolean }; inHand: boolean; hold: (picked: string) => void; passive: boolean; zoom: number }) {
  const { camera, frame, box, active, hold, zoom } = props
  // Locked (its own status or its layer's), the view stays where it is on the plan and as large: its frame is neither moved nor sized.
  const locked = useStore((s) => isLocked(s.doc, s.doc.nodes[camera.id] ?? camera))
  // Its camera fixed (`fixed`, apart from that lock), it keeps where it stands and the way it looks: no drag or wheel moves it, and the wheel over it is the plan's.
  const fixed = camera.fixed === true
  // Entered (its viewpoint selected, or what was picked in it), a click picks in it; and unless its camera is fixed, it moves.
  const entered = props.inHand
  const inHand = entered && !fixed
  const look = usePrefs((s) => s.perspective.look) as Look
  // Its own viewpoint being changed by a drag (in it, on the plan, a box scrubbed): drawn as large as shown, to keep up.
  const editing = useStore((s) => s.base !== null && s.base.nodes[camera.id] !== s.doc.nodes[camera.id])
  const small = box.width < SMALLEST
  // Drawn again only in sight, large enough, and with the plan still: while it is zoomed or panned,
  // nothing heavy is done, and the last picture is stretched.
  const shown = !props.off && !small && props.settled
  const seen = useSeen(camera, shown)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawer = useRef<PerspectiveView | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // Its renderer, made when it is first shown and the editor is idle, then kept (`seenNow`).
  const release = useRef(() => {
    drawer.current?.dispose()
    drawer.current = null
    given.current = null
    viewPictures.delete(camera.id)
    viewPainted()
    setReady(false)
  })
  useEffect(() => {
    if (!shown || ready || failed) return
    let live = true
    later(() => {
      if (!live || !canvas.current || drawer.current) return
      renderer().then(
        (module) => {
          if (!live || !canvas.current || drawer.current) return
          try {
            drawer.current = new module.PerspectiveView(canvas.current)
            // Its picture is painted with the plan, where its viewpoint is stacked (`viewPictures`).
            viewPictures.set(camera.id, canvas.current)
            setReady(true)
          } catch {
            setFailed(true)
          }
        },
        () => setFailed(true),
      )
    })
    return () => {
      live = false
    }
  }, [shown, ready, failed])
  useEffect(() => {
    if (shown && ready) seenNow(camera.id, release.current)
  }, [shown, ready, camera.id])
  useEffect(
    () => () => {
      letGo(camera.id)
      release.current()
    },
    [camera.id],
  )

  // Its slabs built, only while it is shown: never in the middle of a zoom, and not again for the same.
  const given = useRef<unknown>(null)
  useEffect(() => {
    if (!ready || !seen || !shown || given.current === seen.solids) return
    given.current = seen.solids
    drawer.current?.setSolids(seen.solids)
  }, [ready, seen?.solids, shown])

  // What is selected is lit where the view shows it, whether picked there or on the plan; a group, all it holds.
  const selection = useStore((s) => s.selection)
  const lit = useMemo(() => {
    const doc = useStore.getState().doc
    return selection.flatMap((id) => (doc.nodes[id]?.type === 'group' ? leavesOf(doc, id).map((n) => n.id) : [id])).sort().join(',')
  }, [selection])
  useEffect(() => {
    if (ready) drawer.current?.setSelected(lit ? lit.split(',') : [], accentColour())
  }, [ready, lit, seen?.solids])

  // Its size on screen, followed once the plan has stood still: meanwhile, the picture is stretched.
  const [drawn, setDrawn] = useState({ width: box.width, height: box.height })
  useEffect(() => {
    if (!props.settled || (Math.abs(drawn.width - box.width) < 1 && Math.abs(drawn.height - box.height) < 1)) return
    setDrawn({ width: box.width, height: box.height })
  }, [box.width, box.height, props.settled])

  useEffect(() => {
    if (!ready || !seen || !shown || drawn.width < 1) return
    // Drawn twice as large as shown, its lines two pixels apart: one on the screen, smooth; while
    // something is dragged, as large as shown, to keep up.
    const scale = Math.min(Math.min(2, window.devicePixelRatio || 1) * (editing ? 1 : 2), MOST_PIXELS / drawn.width)
    const id = requestAnimationFrame(() => {
      drawer.current?.render(camera, look, drawn.width * scale, drawn.height * scale, Math.max(1, Math.floor(scale)))
      viewPainted()
    })
    return () => cancelAnimationFrame(id)
  }, [ready, seen, camera, look, drawn, editing, lit, shown])

  /*
   * Clicked, it selects what is under the pointer. Dragged, if it is in hand, the view is taken
   * along as a photograph would be: what is under the pointer stays under it. With the left
   * button, it turns where it looks; with the middle one (the wheel), or the left one and Shift,
   * it moves where it stands, sideways and up and down, as what is `GRAB_DEPTH` away would follow
   * the pointer. A view not in hand is not turned by a drag: dragged, it is moved on the plan, as
   * anything else pressed and dragged there, unless it is locked (`framing`).
   */
  const grab = useRef<{ x: number; y: number; camera: Camera; frame: Frame; moving: boolean; looking: boolean; framing: boolean; moved: boolean } | null>(null)
  /**
   * Whether the plan has something stacked over the view where the pointer is: then the press is
   * the plan's (handed to it), as what is over the view is drawn over it.
   */
  const handed = useRef(false)
  const overIt = (e: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): boolean => {
    const plan = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')
    if (!plan) return false
    const { doc, scope, view } = useStore.getState()
    const rect = plan.getBoundingClientRect()
    const world = { x: (e.clientX - rect.left - view.x) / view.zoom, y: (e.clientY - rect.top - view.y) / view.zoom }
    const scene = buildScene(doc, scope, registry)
    const hit = hitTest(scene, world, 5 / view.zoom)
    if (!hit || hit.id === camera.id) return false
    const own = scene.findIndex((item) => item.id === camera.id)
    return own >= 0 && scene.indexOf(hit) > own
  }
  const startLooking = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Said again at each press: a right-click handed to the plan is told apart from one on the view.
    handed.current = false
    if (overIt(e)) {
      handed.current = e.button === 2
      document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')?.dispatchEvent(new PointerEvent('pointerdown', e.nativeEvent))
      e.preventDefault()
      return
    }
    const moving = e.button === 1 || (e.button === 0 && e.shiftKey)
    if (e.button !== 0 && !moving) return
    endWheeling()
    // The middle button would otherwise start the browser's scrolling by the pointer.
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    grab.current = { x: e.clientX, y: e.clientY, camera, frame, moving, looking: inHand, framing: !inHand && !moving && !locked, moved: false }
  }
  const lookAroundTo = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const from = grab.current
    const rect = e.currentTarget.getBoundingClientRect()
    if (!from || rect.width < 1 || rect.height < 1) return
    const [dx, dy] = [e.clientX - from.x, e.clientY - from.y]
    if (!from.moved && Math.hypot(dx, dy) < CLICK) return
    // A drag, not a click: the hand (or the arrows of moving) shows only now, as it takes the view along.
    if (!from.moved && from.looking) e.currentTarget.classList.add(from.moving ? 'moving' : 'dragging')
    if (!from.moved && from.framing) e.currentTarget.classList.add('carried')
    from.moved = true
    if (from.framing) {
      preview([{ op: 'update_node', id: from.camera.id, patch: { frame: { ...from.frame, x: Math.round(from.frame.x + dx / zoom), y: Math.round(from.frame.y + dy / zoom) } } }])
      return
    }
    if (!from.looking) return
    const across = fovOf(from.camera)
    let patch: Partial<Camera> | null
    if (from.moving) {
      // How many millimetres a pixel is, that far ahead.
      const mm = (2 * GRAB_DEPTH * Math.tan((across * Math.PI) / 360)) / rect.width
      patch = stepAside(from.camera, -dx * mm, dy * mm)
    } else {
      const up = (360 / Math.PI) * Math.atan(Math.tan((across * Math.PI) / 360) * (rect.height / rect.width))
      patch = lookAround(from.camera, (-dx * across) / rect.width, (dy * up) / rect.height)
    }
    if (patch && (dx !== 0 || dy !== 0)) preview([{ op: 'update_node', id: from.camera.id, patch }])
  }
  const stopLooking = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.classList.remove('moving', 'dragging', 'carried')
    const from = grab.current
    if (!from) return
    grab.current = null
    if (from.moved) {
      if (!from.looking && !active) select([camera.id])
      if (from.looking || from.framing) commit()
      return
    }
    if (e.type !== 'pointerup' || from.moving) return
    // The first click takes the view; once it is entered, a click picks what it shows.
    if (entered) pick(e)
    else select([camera.id])
  }
  /** Selects what the view shows under the pointer, as a click in an elevation does: the plan's own object, or the viewpoint where nothing is. */
  const pick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = seen && rect.width >= 1 && rect.height >= 1 ? solidAt(seen.solids, camera, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, rect.width / rect.height) : null
    const doc = useStore.getState().doc
    const node = hit ? doc.nodes[hit.solid.node] : undefined
    const id = node && !isLocked(doc, node) ? node.id : camera.id
    hold(id)
    select([id])
  }

  /*
   * The wheel over the view in hand walks forward or back the way it looks; with
   * Ctrl, or pinched on a touchpad, it takes a longer or a shorter lens. The turns that follow one
   * another are one step of undo, kept when the wheel has been still a moment (`WHEEL_PAUSE`). Over
   * any other, the wheel is the plan's: it is handed to the plan.
   */
  const latest = useRef({ camera, inHand })
  latest.current = { camera, inHand }
  const wheeling = useRef<{ camera: Camera; ahead: number; fov: number; timer: number } | null>(null)
  const endWheeling = () => {
    const was = wheeling.current
    if (!was) return
    window.clearTimeout(was.timer)
    wheeling.current = null
    commit()
  }
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = holder.current
    if (!element) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { camera: now, inHand: held } = latest.current
      if (!held) {
        const plan = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')
        plan?.dispatchEvent(new WheelEvent('wheel', e))
        return
      }
      if (grab.current) return
      const step = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
      const turn = wheeling.current?.camera.id === now.id ? wheeling.current : { camera: now, ahead: 0, fov: fovOf(now), timer: 0 }
      window.clearTimeout(turn.timer)
      if (e.ctrlKey) turn.fov = Math.min(150, Math.max(10, turn.fov * Math.exp(step * LENS_PER_PIXEL)))
      else turn.ahead -= step * WALK_PER_PIXEL
      const moved = stepAside(turn.camera, 0, 0, turn.ahead)
      const fov = Math.round(turn.fov * 10) / 10
      if (moved) preview([{ op: 'update_node', id: turn.camera.id, patch: { a: moved.a, b: moved.b, ...(fov !== fovOf(turn.camera) ? { fov } : {}) } }])
      turn.timer = window.setTimeout(endWheeling, WHEEL_PAUSE)
      wheeling.current = turn
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      endWheeling()
    }
  }, [])

  /*
   * The frame moved by its name, or sized by a side or a corner as a rectangle is on the plan, in
   * the drawing's millimetres: its width and height are the shape of its picture. With Shift, a
   * corner keeps its proportions. One step of undo each.
   */
  const handle = (grip: Grip | null) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // Its name is the view's own: a press there always selects it, locked or not (a click in the
    // view selects what it shows). Locked, it is not moved.
    if (!active) select([camera.id])
    if (locked) return
    const start = { x: e.clientX, y: e.clientY, frame }
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (event: PointerEvent) => {
      const [dx, dy] = [(event.clientX - start.x) / zoom, (event.clientY - start.y) / zoom]
      // Its proportions kept, by a corner, as the Properties panel keeps them (`keepProportions`), Shift doing the other, as for a shape on the plan.
      const keep = event.shiftKey !== usePrefs.getState().keepProportions
      const next = grip ? sized(start.frame, grip, dx, dy, keep) : { ...start.frame, x: Math.round(start.frame.x + dx), y: Math.round(start.frame.y + dy) }
      preview([{ op: 'update_node', id: camera.id, patch: { frame: next } }])
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      commit()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  /*
   * A right-click on it opens the menu of what it is, as on the plan: the viewpoint, or what was
   * picked in it while that is selected (Move to page, Cut, Copy…).
   */
  const openMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // A right-click handed to the plan (something over the view there) has opened its menu already.
    if (handed.current) {
      handed.current = false
      return
    }
    if (!props.inHand) select([camera.id])
    useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY }, menuPoint: null })
  }

  const name = camera.name || t('Viewpoint')
  return (
    <div ref={holder} className={`view-frame${active ? ' active' : ''}${props.covered?.frame ? ' covered' : ''}${props.covered?.name ? ' name-covered' : ''}${inHand ? ' in-hand' : ''}${locked ? ' locked' : ''}${fixed ? ' fixed' : ''}${props.passive ? ' passive' : ''}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} onContextMenu={openMenu}>
      <div className="view-frame-name" title={locked ? t('Locked: click to select the view; unlock it in Properties to move it') : t('Click to select the view, drag to move it on the plan')} onPointerDown={handle(null)}>
        {locked && <Lock size={10} aria-hidden />}
        {name}
      </div>
      {failed ? (
        <p className="hint warning">{t('This computer cannot draw the view: its graphics (WebGL) are not available.')}</p>
      ) : (
        <canvas
          ref={canvas}
          title={!entered ? t('Click to select the view, drag to move it; then click what it shows to select it, or drag to look around') : fixed ? t('Camera fixed: click to select what it shows, drag to move the view; the wheel zooms the plan') : t('Click to select · drag to look around · middle button: move · wheel: walk')}
          onPointerDown={startLooking}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onPointerMove={lookAroundTo}
          onPointerUp={stopLooking}
          onPointerCancel={stopLooking}
          onLostPointerCapture={stopLooking}
        />
      )}
      {GRIPS.map((grip) => (
        <div key={grip} className={`view-frame-grip ${grip}`} title={t('Drag to size the view')} onPointerDown={handle(grip)} />
      ))}
    </div>
  )
}
