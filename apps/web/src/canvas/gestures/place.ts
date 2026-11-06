import { canSplit, hitTest, newId, roomAt, snapOpeningToWall, splitOps, splitPlace, trimOps, trimPlace, wallSides, type Document, type NodeInput, type Op, type Vec2 } from '@opencalque/core'
import { libraryOps, pickStyle } from '../../actions'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { apply, cancel, commit, layerHere, preview, select, setTool, useStore, type Placing } from '../../store'
import { formatLength } from '../../units'
import { gridStep } from '../../view'
import { snap } from '../aim'
import type { SizeLabel } from '../draw'
import { TWO_POINT, type Keys } from '../gesture'
import { get, type Canvas, type Move, type Press } from '../runtime'
import { offsetHover } from './offset'

/*
 * The tools that act where they are clicked, with nothing to drag: the eyedropper, putting down
 * what the place tool or the room tool holds (it follows the pointer as a preview), and the split
 * tool. With nothing in progress, the pointer also shows where a drawing tool's point would go.
 */

/** The look of what is clicked goes to the selection, or to what is drawn next. */
export const eyedropperDown: Press = (c, _e, _at, world) => {
  const source = hitTest(c.scene, world, 5 / get().view.zoom)
  if (source) pickStyle(source.node)
}

/**
 * What follows the pointer is put down, and the next one follows it. A library's component comes
 * in with the first: the next ones are placements of that same one, not further copies. A table of
 * quantities is put down once, and selected, to be set up.
 */
export const placeDown: Press = (c) => {
  const { base, placing } = get()
  if (!base) return
  if (placing?.type === 'table') {
    const id = c.placed
    commit()
    setTool('select')
    select([id])
    c.placed = newId()
    return
  }
  const brought = placing?.type === 'library' ? fromLibrary(base, placing).id : null
  commit()
  if (brought) useStore.setState({ placing: { type: 'instance', component: brought, carried: placing?.carried } })
  c.placed = newId()
}

/**
 * Where the split tool would cut, for a pointer at `world`: on the wall, line or polyline under
 * it, at the place another object lines up with, or else at a whole number of grid steps from
 * its start (Alt: exactly under the pointer).
 */
function splitAim(c: Canvas, world: Vec2, e: Keys) {
  const { view } = get()
  const hit = c.scene.filter((item) => canSplit(item.node)).find((item) => item === hitTest(c.scene.filter((other) => canSplit(other.node)), world, 6 / view.zoom))
  if (!hit) return null
  const snapped = e.altKey ? null : snap(c, world, e, [hit.id])
  const place = snapped?.marker ? splitPlace(hit.node, snapped.p) : splitPlace(hit.node, world, e.altKey ? undefined : gridStep(view.zoom))
  return place && { node: hit.node, place, marker: snapped?.marker ?? null }
}

export const splitDown: Press = (c, e, _at, world) => {
  const aim = splitAim(c, world, e)
  const ops = aim && splitOps(aim.node, aim.place, newId())
  if (ops) apply(ops)
  c.setOverlay({})
}

/** What the trim tool would take away for a pointer at `world`: the stretch of the wall, line or polyline under it between the nearest things crossing it. */
function trimAim(c: Canvas, world: Vec2) {
  const { view, doc } = get()
  const hit = hitTest(c.scene.filter((item) => canSplit(item.node)), world, 6 / view.zoom)
  const place = hit && trimPlace(doc, hit.node, world)
  return place && { node: hit.node, place }
}

export const trimDown: Press = (c, _e, _at, world) => {
  const aim = trimAim(c, world)
  const ops = aim && trimOps(aim.node, aim.place, newId())
  if (ops) apply(ops)
  c.setOverlay({})
}

/**
 * What brings a library's component into the drawing to be placed, worked out once for the drawing
 * as it is: the pointer moves over the same one until a placement is put down.
 */
let brought: { doc: Document; placing: Placing; ops: Op[]; id: string } | null = null

/** The operations that bring the component of a library placing into `doc`, a component of its own, and its id there. */
function fromLibrary(doc: Document, placing: Extract<Placing, { type: 'library' }>): { ops: Op[]; id: string } {
  if (brought?.doc !== doc || brought.placing !== placing) {
    const { ops, imported } = libraryOps(doc, placing.library, [placing.component], placing.names)
    brought = { doc, placing, ops, id: imported[placing.component] }
  }
  return brought
}

/** With nothing in progress: what the tool in use would do where the pointer is, shown before any click. */
export const toolHover: Move<'idle'> = (c, _g, e, _at, world, out) => {
  const s = get()
  if (s.tool === 'room') {
    // A room is offered wherever the pointer is inside closed walls, as it would be: floor, name and area.
    const before = s.base ?? s.doc
    if (roomAt(before, s.scope, world)) {
      const count = Object.values(before.nodes).filter((n) => n.type === 'room').length
      const name = t('Room {n}', { n: String(count + 1).padStart(2, '0') })
      out.previewed = preview([{ op: 'add_node', node: { id: c.placed, type: 'room', parent: s.scope, ...layerHere(s), name, x: Math.round(world.x), y: Math.round(world.y) } }])
    } else {
      cancel()
      out.status = t('No closed space here: the walls around it must meet all the way round')
    }
  } else if (s.tool === 'place' && s.placing) {
    const target = snap(c, world, e, [c.placed])
    out.marker = target.marker
    const common = { id: c.placed, rotation: s.placingRotation, parent: s.scope, ...layerHere(s), x: target.p.x, y: target.p.y }
    // Doors and windows jump onto the wall under the cursor and turn to follow it.
    const onWall =
      s.placing.type === 'parametric' && !e.altKey
        ? snapOpeningToWall(s.base ?? s.doc, s.scope, registry, { kind: s.placing.kind, props: s.placing.props ?? {} }, world, 10 / s.view.zoom, gridStep(s.view.zoom))
        : null
    if (onWall) out.marker = null
    // A library's component comes in with its first placement, in the same step.
    const library = s.placing.type === 'library' ? fromLibrary(s.base ?? s.doc, s.placing) : null
    // A table is not turned: it stays upright to be read.
    const { rotation: _, ...upright } = common
    const node: NodeInput =
      s.placing.type === 'parametric'
        ? { ...common, ...onWall, type: 'parametric', kind: s.placing.kind, props: s.placing.props ?? {} }
        : s.placing.type === 'table'
          ? { ...upright, ...s.placing.table }
          : { ...common, type: 'instance', component: library ? library.id : s.placing.component }
    out.previewed = preview([...(library?.ops ?? []), { op: 'add_node', node }])
  } else if (TWO_POINT.includes(s.tool) || s.tool === 'measure' || s.tool === 'angle' || (s.tool === 'rotate' && s.selection.length > 0)) {
    out.marker = snap(c, world, e, []).marker
  } else if (s.tool === 'offset') {
    offsetHover(c, world, out)
  } else if (s.tool === 'trim') {
    const aim = trimAim(c, world)
    if (aim) out.trim = { piece: aim.place.piece, width: aim.node.type === 'wall' ? aim.node.thickness * s.view.zoom : 0 }
    else out.status = t('Point at a wall or a line where something crosses it')
  } else if (s.tool === 'split') {
    // A mark across where the cut would be, and the length of each part beside it.
    const aim = splitAim(c, world, e)
    if (aim) {
      out.marker = aim.marker
      const { place, node } = aim
      const half = (node.type === 'wall' ? Math.max(wallSides(node).left, wallSides(node).right) : 0) + 8 / s.view.zoom
      // Each length beside a line with arrows that runs along what it measures, from an end to the cut.
      const gap = half * s.view.zoom + 6
      out.cut = { at: place.at, dir: place.dir, half, parts: place.parts, gap }
      const side = (at: Vec2, length: number): SizeLabel => {
        const n = { x: -place.dir.y, y: place.dir.x }
        const turn = (Math.atan2(place.dir.y, place.dir.x) * 180) / Math.PI
        return { at, dx: n.x * (gap + 14), dy: n.y * (gap + 14), text: formatLength(length), rotation: Math.abs(turn) > 90 ? turn - 180 * Math.sign(turn) : turn, measure: true }
      }
      out.labels = [side(place.beforeMiddle, place.before), side(place.afterMiddle, place.after)]
    }
  }
}
