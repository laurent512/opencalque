import { applyOps, dimensionChainOps, extendWallOps, flipWallOps, newId, splitWallOps, trimWallOps, wallContains, wallEndsAt, wallMiddle, type Node, type Op } from '@opencalque/core'
import { drawing } from '../canvas/drawing'
import { registry } from '../extensions'
import { t } from '../i18n'
import { apply, selectCorner, useStore } from '../store'
import { toast } from '../windows'
import { dimensionToolLook } from './edit'

/* What is done to the selected walls: dimension them, split one, extend or trim them, turn them round, flip them over. */

const get = useStore.getState

/** Dimensions the selected walls: a chain along each, through its doors and windows, on the outside of the plan. */
export function dimensionWalls(): void {
  const { doc, selection } = get()
  const walls = selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : []))
  if (walls.length === 0) return toast(t('Select the walls to dimension first.'))
  apply(dimensionChainOps(doc, walls, registry, dimensionToolLook(), t('Dimensions')))
}

/** The walls an extend or a trim is about, and which of their ends: the selected wall end, or else every free end of the selected walls. */
function wallsToFit(): { walls: Extract<Node, { type: 'wall' }>[]; end?: 'a' | 'b' } {
  const { doc, scope, selection, corner } = get()
  const ends = corner ? wallEndsAt(doc, scope, corner) : []
  if (ends.length === 1) return { walls: [ends[0].wall], end: ends[0].end }
  return { walls: selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : [])) }
}

export const canFitWalls = () => wallsToFit().walls.length > 0

/** The one wall that is selected, if that is all that is. */
const oneWall = (): Extract<Node, { type: 'wall' }> | null => {
  const { doc, selection } = get()
  const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  return node?.type === 'wall' ? node : null
}

export const canSplitWall = () => oneWall() !== null

/**
 * Makes the selected wall two, with a corner between them: where it was right-clicked when the
 * command comes from that menu, otherwise in its middle. Split twice, the part in between is a
 * wall of its own, to delete or to change.
 */
export function splitWall(): void {
  const wall = oneWall()
  if (!wall) return
  const { menuPoint } = get()
  // A right-click made elsewhere, earlier, says nothing about this wall.
  const at = menuPoint && wallContains(wall, menuPoint, 1) ? menuPoint : wallMiddle(wall)
  useStore.setState({ menuPoint: null })
  const split = splitWallOps(wall, at, newId())
  if (!split) return toast(t('A wall cannot be split at one of its ends.'))
  if (apply(split.ops)) selectCorner(split.at)
}

/** Lengthens the selected walls, or the selected wall end, to the next wall in their way; or cuts back what sticks out past a wall. */
export function fitWalls(how: 'extend' | 'trim'): void {
  const { doc, corner } = get()
  const { walls, end } = wallsToFit()
  const ops = how === 'extend' ? extendWallOps(doc, walls, end) : trimWallOps(doc, walls, end)
  if (ops.length === 0) return toast(how === 'extend' ? t('No wall lies ahead to extend to.') : t('Nothing sticks out past another wall to trim.'))
  if (!apply(ops)) return
  // The end that was selected has moved: select it where it is now.
  if (corner && end) {
    const moved = get().doc.nodes[walls[0].id]
    if (moved?.type === 'wall') selectCorner(moved[end])
  }
}

/** The other of the two values a parameter of a parametric kind offers (a door's hinge), or null when it does not offer exactly two. */
function otherOption(kind: string, key: string, value: unknown): string | null {
  const param = registry.parametric.get(kind)?.params.find((p) => p.key === key)
  if (!param?.options || param.options.length !== 2) return null
  const now = value ?? param.default
  return param.options.find((option) => option !== now) ?? null
}

/** What flipping turns over now: the wall being drawn, the door being placed, or the selected walls, doors and windows. */
function flippable(): 'wall tool' | 'placing' | 'selection' | null {
  const { tool, placing, doc, selection } = get()
  if (tool === 'wall') return 'wall tool'
  if (tool === 'place') return placing?.type === 'parametric' && otherOption(placing.kind, 'hinge', placing.props?.hinge) !== null ? 'placing' : null
  if (tool !== 'select') return null
  return selection.some((id) => {
    const node = doc.nodes[id]
    return node?.type === 'wall' || (node?.type === 'parametric' && Boolean(registry.parametric.get(node.kind)?.opening))
  })
    ? 'selection'
    : null
}

export const canFlipSide = () => flippable() !== null

/**
 * Turns over what is being drawn or is selected, as the space bar does in Revit: the wall being
 * drawn goes to the other side of the points clicked, the door being placed is hinged on its other
 * side, a selected wall drawn by a face goes over to the other side of that face, its corners
 * staying, and a selected door changes hinge (a window, with none, changes the side its sill is on).
 */
export function flipSide(): void {
  const { doc, selection, placing, wallJustify } = get()
  const what = flippable()
  if (what === 'wall tool') {
    if (wallJustify === 'center') return toast(t('A wall drawn by its middle lies on both sides of the points: choose a face in the bar to draw it on one side.'))
    useStore.setState({ wallJustify: wallJustify === 'left' ? 'right' : 'left' })
    drawing.refresh?.()
  } else if (what === 'placing' && placing?.type === 'parametric') {
    useStore.setState({ placing: { ...placing, props: { ...placing.props, hinge: otherOption(placing.kind, 'hinge', placing.props?.hinge) } } })
    drawing.refresh?.()
  } else if (what === 'selection') {
    // Each wall from the drawing the one before left, so that the doors moved across with one are where the next sees them.
    let now = doc
    const ops: Op[] = []
    let centred = 0
    for (const id of selection) {
      const node = now.nodes[id]
      let step: Op[] = []
      if (node?.type === 'wall') {
        step = flipWallOps(now, node, registry)
        if (step.length === 0) centred++
      } else if (node?.type === 'parametric' && registry.parametric.get(node.kind)?.opening) {
        const hinge = otherOption(node.kind, 'hinge', node.props.hinge)
        step = [{ op: 'update_node', id, patch: { props: hinge ? { ...node.props, hinge } : { ...node.props, flip: !node.props.flip } } }]
      }
      if (step.length === 0) continue
      now = applyOps(now, step)
      ops.push(...step)
    }
    if (ops.length > 0) apply(ops)
    if (centred > 0) toast(t('A wall drawn by its middle has nothing to flip: give it a face as its reference line first.'))
  }
}
