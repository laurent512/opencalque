import { useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Lock } from 'lucide-react'
import { boundsOf, buildScene, coveredInScene, span, dist, isLocked, isVisible, keptViewPatch, leavesOf, moveOps, moveViewEnd, nodePrimitives, rootOf, viewScale, wallFollowOps, type Bounds, type Document, type NodeOf, type Op, type Vec2 } from '@opencalque/core'
import { registry } from '../extensions'
import { t } from '../i18n'
import { commit, preview, select, useStore } from '../store'
import { labelOf } from '../ui'
import { sceneOf } from '../scenes'
import { editComponent } from '../navigation'

/*
 * The elevations and sections of the page, each with a label as a 3D view has (ARCHITECTURE §10,
 * "Views"): its name above it, which selects it (locked too), moves it when dragged and opens its
 * menu; and, while it is selected, a grip at each corner, which draws it larger or smaller (`scale`),
 * the corner across staying where it is, and one in the middle of its left and right sides, which
 * shows more or less of what it looks at: its line made longer or shorter at that end, on the plan
 * too (`moveViewEnd`), what it still shows staying where it is drawn (`keptViewPatch`). What it draws stays on the plan, where what it shows is
 * picked and dragged: only the label and the grips take the pointer.
 */

/** The box of what each view of a page draws (not its line), kept with each state of the drawing. */
const drawnBoxes = new WeakMap<Document['nodes'], Map<string, { node: NodeOf<'elevation'>; box: Bounds }[]>>()
export function viewBoxes(doc: Document, pageId: string): { node: NodeOf<'elevation'>; box: Bounds }[] {
  let byPage = drawnBoxes.get(doc.nodes)
  if (!byPage) drawnBoxes.set(doc.nodes, (byPage = new Map()))
  let boxes = byPage.get(pageId)
  if (!boxes) {
    const ctx = { doc, registry, depth: 0 }
    boxes = leavesOf(doc, pageId).flatMap((node) => {
      if (node.type !== 'elevation' || !isVisible(doc, node)) return []
      const box = boundsOf(nodePrimitives(node, ctx).filter((p) => !p.screen && !p.aside))
      return box ? [{ node, box }] : []
    })
    byPage.set(pageId, boxes)
  }
  return boxes
}

/** The view a dimension from `a` to `b` is drawn on, both its ends within what the view draws: it belongs to it. */
export function viewUnder(doc: Document, pageId: string, a: Vec2, b: Vec2): NodeOf<'elevation'> | null {
  const inside = (box: Bounds, p: Vec2) => p.x >= box.minX - 1 && p.x <= box.maxX + 1 && p.y >= box.minY - 1 && p.y <= box.maxY + 1
  return viewBoxes(doc, pageId).find(({ box }) => inside(box, a) && inside(box, b))?.node ?? null
}

type Corner = 'nw' | 'ne' | 'se' | 'sw'
const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw']
/** The least and most a view is drawn, as a share of the plan. */
const [SMALLEST, LARGEST] = [0.05, 20]

export function ElevationLabels() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const view = useStore((s) => s.view)
  const viewport = useStore((s) => s.viewport)
  const selection = useStore((s) => s.selection)
  const drawing = useStore((s) => s.tool !== 'select')
  // Each view of the page and the box of what it draws (not of its line on the plan), worked out once for each state of the drawing.
  const views = useMemo(() => {
    const page = rootOf(doc, scope)
    // Inside a view, what is shown is in its coordinates, not the page's.
    return page && page.type === 'page' && doc.nodes[scope]?.type !== 'elevation' ? span('view labels: boxes', () => viewBoxes(doc, page.id)) : []
  }, [doc, scope])
  // What is stacked over a view where its name is hides its name, as it hides its drawing.
  const scene = useMemo(() => (views.length > 0 ? sceneOf(doc, rootOf(doc, scope)!.id) : []), [doc, scope, views])
  const covered = useMemo(() => new Set(views.filter(({ node, box }) => coveredInScene(scene, node.id, nameBox(box, view.zoom))).map(({ node }) => node.id)), [scene, views, view.zoom])
  return (
    <>
      {views.map(({ node, box }) => {
        const at = { left: box.minX * view.zoom + view.x, top: box.minY * view.zoom + view.y, width: (box.maxX - box.minX) * view.zoom, height: (box.maxY - box.minY) * view.zoom }
        if (at.left > viewport.width || at.top > viewport.height || at.left + at.width < 0 || at.top + at.height < 0) return null
        const taken = takenWith(doc, scope, node.id)
        return <Label key={node.id} node={node} taken={taken} box={box} at={at} active={selection.includes(taken)} covered={covered.has(node.id)} passive={drawing} zoom={view.zoom} />
      })}
    </>
  )
}

/**
 * What a press on a view's name takes, as a click on the drawing does: the group it is in (the
 * views of a room, the four sides), its outermost below what is being edited; the view itself when
 * it is in none.
 */
function takenWith(doc: Document, scope: string, id: string): string {
  let taken = id
  for (let parent = doc.nodes[id]?.parent; parent && parent !== scope && doc.nodes[parent]?.type === 'group'; parent = doc.nodes[parent]?.parent) taken = parent
  return taken
}

/** How high and how wide, at most, a view's name is, in pixels, at the top left corner of what it draws. */
const NAME_ROOM = { width: 160, height: 24 }

/** Where a view's name is on the drawing, at `zoom`, for a view drawn in `box`: what covers it there hides it. */
export function nameBox(box: Bounds, zoom: number): Bounds {
  return { minX: box.minX, maxX: Math.min(box.maxX, box.minX + NAME_ROOM.width / zoom), minY: box.minY - NAME_ROOM.height / zoom, maxY: box.minY + NAME_ROOM.height / zoom }
}

function Label(props: { node: NodeOf<'elevation'>; taken: string; box: Bounds; at: { left: number; top: number; width: number; height: number }; active: boolean; covered: boolean; passive: boolean; zoom: number }) {
  const { node, taken, box, at, active, zoom } = props
  const locked = useStore((s) => isLocked(s.doc, s.doc.nodes[node.id] ?? node))

  /** Follows a drag from a press, in millimetres of the drawing, as one step of undo. */
  const drag = (e: ReactPointerEvent<HTMLElement>, patch: (dx: number, dy: number, shift: boolean) => Record<string, unknown>) =>
    dragOps(e, (dx, dy, shift) => [{ op: 'update_node', id: node.id, patch: patch(dx, dy, shift) }])
  const dragOps = (e: ReactPointerEvent<HTMLElement>, ops: (dx: number, dy: number, shift: boolean) => Op[]) => {
    const start = { x: e.clientX, y: e.clientY }
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (event: PointerEvent) => preview(ops((event.clientX - start.x) / zoom, (event.clientY - start.y) / zoom, event.shiftKey))
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

  // Its name: a press selects it; dragged, it moves where it is drawn (its line stays on the plan).
  // Selected with other things, it takes them all along, as a drag of anything selected does.
  const pressName = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (!active) select([taken])
    if (locked) return
    const { doc, selection } = useStore.getState()
    // Its group, or several things selected with it: they move together, as on the drawing.
    const moving = active ? selection : [taken]
    if (moving.length > 1 || taken !== node.id) {
      const nodes = moving.flatMap((id) => (doc.nodes[id] && !isLocked(doc, doc.nodes[id]) ? [doc.nodes[id]] : []))
      return dragOps(e, (dx, dy) => {
        const d = { x: Math.round(dx), y: Math.round(dy) }
        return [...nodes.flatMap((n) => moveOps(doc, n, d)), ...wallFollowOps(doc, nodes, d, registry)]
      })
    }
    drag(e, (dx, dy) => ({ x: Math.round(node.x + dx), y: Math.round(node.y + dy) }))
  }

  // Double-clicked, as on the drawing: into the group it is in (the views of a room), the view
  // selected there; a view in no group, into the view, to draw on it.
  const enter = () => {
    if (taken !== node.id && node.parent) {
      editComponent(node.parent)
      select([node.id])
    } else editComponent(node.id)
  }

  // A corner: drawn larger or smaller, the corner across staying where it is.
  const pressCorner = (corner: Corner) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const s = viewScale(node)
    const anchor = { x: corner.includes('w') ? box.maxX : box.minX, y: corner.includes('n') ? box.maxY : box.minY }
    const [width, height] = [box.maxX - box.minX, box.maxY - box.minY]
    drag(e, (dx, dy) => {
      const grown = Math.max((width + (corner.includes('e') ? dx : -dx)) / width, (height + (corner.includes('s') ? dy : -dy)) / height)
      const next = Math.round(Math.min(LARGEST, Math.max(SMALLEST, s * grown)) * 100) / 100
      const k = next / s
      return { scale: Math.abs(next - 1) < 1e-9 ? null : next, x: Math.round(anchor.x + (node.x - anchor.x) * k), y: Math.round(anchor.y + (node.y - anchor.y) * k) }
    })
  }

  // Its left or right side: it shows more or less, its line longer or shorter at that end.
  const pressSide = (side: 'w' | 'e') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const length = dist(node.a, node.b)
    if (length < 1e-6) return
    const d = { x: (node.b.x - node.a.x) / length, y: (node.b.y - node.a.y) / length }
    const s = viewScale(node)
    const end = side === 'e' ? node.b : node.a
    drag(e, (dx) => keptViewPatch(node, moveViewEnd(node, side === 'e' ? 'b' : 'a', { x: end.x + (d.x * dx) / s, y: end.y + (d.y * dx) / s })))
  }

  // A right-click on its name opens its menu, as on what it draws.
  const openMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!active) select([taken])
    useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY }, menuPoint: null })
  }

  return (
    <div className={`view-label${active ? ' active' : ''}${props.covered && !active ? ' covered' : ''}${locked ? ' locked' : ''}${props.passive ? ' passive' : ''}`} style={at}>
      <div className="view-frame-name" title={locked ? t('Locked: click to select the view; unlock it in Properties to move it') : t('Click to select the view, drag to move it on the plan')} onPointerDown={pressName} onDoubleClick={enter} onContextMenu={openMenu}>
        {locked && <Lock size={10} aria-hidden />}
        {labelOf(useStore.getState().doc, node)}
      </div>
      {active &&
        !locked &&
        CORNERS.map((corner) => <div key={corner} className={`view-frame-grip ${corner}`} title={t('Drag to make it larger or smaller')} onPointerDown={pressCorner(corner)} />)}
      {active &&
        !locked &&
        (['w', 'e'] as const).map((side) => <div key={side} className={`view-frame-grip ${side}`} title={t('Drag to show more or less of what it looks at, its line longer or shorter')} onPointerDown={pressSide(side)} />)}
    </div>
  )
}
