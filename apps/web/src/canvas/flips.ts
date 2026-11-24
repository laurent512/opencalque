import { applyTransform, hostWall, type Document, type Node, type Registry, type Vec2 } from '@opencalque/core'

/**
 * A control drawn by the one selected door or window: a double-headed arrow which, clicked, turns
 * it over, as Revit's flip controls do. `side` opens it to the other side of its wall (its `flip`),
 * `hinge` hangs it on its other hinge (the other of the two values of its `hinge`). In screen pixels.
 */
export interface FlipArrow {
  what: 'side' | 'hinge'
  from: Vec2
  to: Vec2
}

/** How far, in screen pixels, the controls stand off the face of the wall, and how long they are. */
const OFF_FACE = 22          // clear of the width written beside the door
const LENGTH = 26
const LOOSE_WALL = 200

const unit = (v: Vec2): Vec2 | null => {
  const length = Math.hypot(v.x, v.y)
  return length < 1e-9 ? null : { x: v.x / length, y: v.y / length }
}

/**
 * The flip controls of `node` on screen: for an object that cuts walls (`opening`) and has a
 * boolean `flip` parameter, the `side` arrow, across its wall; for one whose `hinge` offers two
 * values and is shown for its parameters (a single door, not a double one), the `hinge` arrow,
 * along it. Both stand on the side it does not open to, beyond the face of its wall, at its middle,
 * so they cover neither its leaf nor its swing. Worked out from its parameters, never from its kind.
 */
export function flipArrows(doc: Document, node: Node | undefined, registry: Registry, toScreen: (p: Vec2) => Vec2): FlipArrow[] {
  if (node?.type !== 'parametric') return []
  const kind = registry.parametric.get(node.kind)
  if (!kind?.opening) return []
  const props = registry.resolveProps(kind, node.props)
  const hinge = kind.params.find((p) => p.key === 'hinge')
  const canHinge = Boolean(hinge?.options && hinge.options.length === 2 && (hinge.shown?.(props) ?? true))
  const canSide = kind.params.some((p) => p.key === 'flip' && p.type === 'boolean')
  if (!canHinge && !canSide) return []
  const { from, to } = kind.opening(props)
  const half = (hostWall(doc, node, registry)?.thickness ?? LOOSE_WALL) / 2
  // It opens towards its own +Y, or -Y turned over: the controls go on the other side.
  const away = props.flip ? 1 : -1
  const middle = (from + to) / 2
  const centre = toScreen(applyTransform({ x: middle, y: 0 }, node))
  const face = toScreen(applyTransform({ x: middle, y: away * half }, node))
  const ahead = toScreen(applyTransform({ x: middle + 1, y: 0 }, node))
  const along = unit({ x: ahead.x - centre.x, y: ahead.y - centre.y })
  if (!along) return []
  // Out of the wall on that side; a wall too thin to see on screen gives the way from its line.
  const across = applyTransform({ x: middle, y: away }, node)
  const out = unit({ x: face.x - centre.x, y: face.y - centre.y }) ?? unit({ x: toScreen(across).x - centre.x, y: toScreen(across).y - centre.y })
  if (!out) return []
  const at = (base: Vec2, way: Vec2, by: number) => ({ x: base.x + way.x * by, y: base.y + way.y * by })
  const arrows: FlipArrow[] = []
  const start = at(face, out, OFF_FACE)
  if (canSide) arrows.push({ what: 'side', from: start, to: at(start, out, LENGTH) })
  if (canHinge) {
    const middleOf = at(start, out, canSide ? LENGTH + 16 : LENGTH / 2)
    arrows.push({ what: 'hinge', from: at(middleOf, along, -LENGTH / 2), to: at(middleOf, along, LENGTH / 2) })
  }
  return arrows
}

/** The distance from `p` to the segment `a`-`b`. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const k = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy)
}

/** Which of `arrows` a point of the screen is on, within 8 px of it, or null. */
export function flipArrowAt(arrows: FlipArrow[], at: Vec2): FlipArrow['what'] | null {
  return arrows.find((arrow) => toSegment(at, arrow.from, arrow.to) < 8)?.what ?? null
}

/**
 * The patch of a door's or window's `props` that a flip control makes: `side` turns `flip` over,
 * `hinge` takes the other of the two values its kind offers. Null when it has nothing to change.
 */
export function flipPatch(node: Node, what: FlipArrow['what'], registry: Registry): Record<string, unknown> | null {
  if (node.type !== 'parametric') return null
  const kind = registry.parametric.get(node.kind)
  if (!kind) return null
  const props = registry.resolveProps(kind, node.props)
  if (what === 'side') return { ...node.props, flip: !props.flip }
  const hinge = kind.params.find((p) => p.key === 'hinge')
  const other = hinge?.options?.length === 2 ? hinge.options.find((option) => option !== props.hinge) : undefined
  return other === undefined ? null : { ...node.props, hinge: other }
}
