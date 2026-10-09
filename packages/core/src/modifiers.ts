import { applyTransform, pointInPolygon, sub, type Transform, type Vec2 } from './geometry'
import type { Primitive } from './primitives'
import type { ParamDef, Registry } from './registry'
import type { Modifier, Node } from './schema'

/**
 * A modifier changes how a node is drawn without changing the node: it takes the primitives the
 * node would draw and returns others. A node's modifiers apply one after the other, in the order
 * of its list, each working on what the one before produced; a group's or an instance's apply to
 * everything it holds, after the modifiers of the things inside.
 *
 * A modifier is pure: it sees primitives and its own parameters, never the document.
 */
export interface ModifierKind {
  type: string
  label: string
  description?: string
  params: ParamDef[]
  /**
   * `frame` places the modifier on the drawing: positions among the parameters are relative to
   * it. Moving, turning or scaling the node moves the frame, so no kind has to know how.
   */
  apply(prims: Primitive[], params: Record<string, any>, frame: Transform): Primitive[]
  /** The outline, in drawing coordinates, an editor can show and let the user drag, if the kind has one. */
  outline?(params: Record<string, any>, frame: Transform): Vec2[]
}

const ORIGIN: Transform = { x: 0, y: 0 }

/** The corners of a crop, clockwise from its frame's origin. */
export function cropOutline(params: Record<string, any>, frame: Transform = ORIGIN): Vec2[] {
  const { width, height } = params
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((p) => applyTransform(p, frame))
}

/**
 * Shows only what lies inside a rectangle. Nothing is cut: every primitive is given the rectangle
 * as a clip outline, which renderers honour (and which the DXF export cuts lines against).
 */
export const cropModifier: ModifierKind = {
  type: 'crop',
  label: 'Crop',
  description: 'Shows only the part inside a rectangle.',
  params: [
    { key: 'width', label: 'Width', type: 'number', default: 1000, unit: 'length' },
    { key: 'height', label: 'Height', type: 'number', default: 1000, unit: 'length' },
  ],
  apply: (prims, params, frame) => {
    const outline = cropOutline(params, frame)
    return prims.map((prim) => ({ ...prim, clip: [...(prim.clip ?? []), outline] }))
  },
  outline: cropOutline,
}

/** Patterns a hatch can draw. The names are what is stored, and what is translated for display. */
export const HATCH_PATTERNS = ['Lines', 'Planks', 'Tiles'] as const
const HATCH_INK = '#9aa3b2'
/** A hatch never draws more strokes than this; a spacing too fine for the shape is widened to fit. */
const HATCH_LIMIT = 600

/** The strokes of a pattern covering a shape, as pairs of points, before they are clipped to it. */
function hatchStrokes(shape: Vec2[], params: Record<string, any>, frame: Transform): [Vec2, Vec2][] {
  const turn = (((frame.rotation ?? 0) + params.angle) * Math.PI) / 180
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  // The pattern is laid out from the frame, in its own direction: u runs along the strokes, v across them.
  const local = shape.map((p) => ({ u: (p.x - frame.x) * cos + (p.y - frame.y) * sin, v: -(p.x - frame.x) * sin + (p.y - frame.y) * cos }))
  const world = (u: number, v: number): Vec2 => ({ x: frame.x + u * cos - v * sin, y: frame.y + u * sin + v * cos })
  const us = local.map((p) => p.u)
  const vs = local.map((p) => p.v)
  const [minU, maxU, minV, maxV] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]
  let step = Math.max(1, params.spacing * (frame.scale ?? 1))
  const count = (size: number) => (maxV - minV) / size + (params.pattern === 'Tiles' ? (maxU - minU) / size : params.pattern === 'Planks' ? ((maxV - minV) / size) * ((maxU - minU) / (size * 8) + 1) : 0)
  while (count(step) > HATCH_LIMIT) step *= 2

  const strokes: [Vec2, Vec2][] = []
  for (let row = Math.ceil(minV / step); row * step <= maxV; row++) strokes.push([world(minU, row * step), world(maxU, row * step)])
  if (params.pattern === 'Tiles') {
    for (let column = Math.ceil(minU / step); column * step <= maxU; column++) strokes.push([world(column * step, minV), world(column * step, maxV)])
  } else if (params.pattern === 'Planks') {
    // Boards eight widths long, their ends staggered from one row to the next.
    const board = step * 8
    for (let row = Math.floor(minV / step); row * step < maxV; row++) {
      const shift = (((row % 3) + 3) % 3) * (board / 3)
      for (let end = Math.ceil((minU - shift) / board); end * board + shift <= maxU; end++) strokes.push([world(end * board + shift, row * step), world(end * board + shift, (row + 1) * step)])
    }
  }
  return strokes
}

/**
 * Covers every closed shape of what it is given with a pattern of strokes: plain lines, floor
 * boards, or tiles. The strokes are clipped to the shape they cover, so nothing is cut and the
 * pattern follows the shape when it changes, as a room's floor does when its walls move.
 */
export const hatchModifier: ModifierKind = {
  type: 'hatch',
  label: 'Hatch',
  description: 'Covers closed shapes with a pattern: lines, floor boards or tiles.',
  params: [
    { key: 'pattern', label: 'Pattern', type: 'string', default: 'Lines', options: [...HATCH_PATTERNS] },
    { key: 'spacing', label: 'Spacing', type: 'number', default: 150, unit: 'length' },
    { key: 'angle', label: 'Angle', type: 'number', default: 0 },
  ],
  apply: (prims, params, frame) => [
    ...prims,
    ...prims.flatMap((prim): Primitive[] =>
      prim.kind === 'path' && prim.closed && prim.points.length >= 3
        ? hatchStrokes(prim.points, params, frame).map((points): Primitive => ({ kind: 'path', points, stroke: HATCH_INK, strokeWidth: 0.6, backdrop: prim.backdrop, clip: [...(prim.clip ?? []), prim.points] }))
        : [],
    ),
  ],
}

/** The modifiers every drawing can use, whatever extensions are in use. */
export const BUILT_IN_MODIFIERS: ReadonlyMap<string, ModifierKind> = new Map([
  [cropModifier.type, cropModifier],
  [hatchModifier.type, hatchModifier],
])

export const modifierKind = (registry: Registry, type: string): ModifierKind | undefined => registry.modifiers.get(type) ?? BUILT_IN_MODIFIERS.get(type)

/** Every modifier kind available: the built-in ones, then those of the extensions in use. */
export const modifierKinds = (registry: Registry): ModifierKind[] => [...BUILT_IN_MODIFIERS.values(), ...registry.modifiers.values()]

/** The parameters of a modifier completed with its kind's defaults. */
export function modifierParams(kind: ModifierKind, params: Record<string, unknown> = {}): Record<string, any> {
  const out: Record<string, unknown> = {}
  for (const p of kind.params) {
    const value = params[p.key]
    out[p.key] = typeof value === typeof p.default && (!p.options || p.options.includes(value as string)) ? value : p.default
  }
  return out
}

/**
 * Runs a node's modifiers over its primitives, in order. One that is switched off, or whose kind
 * is not known here (its extension is not installed), is skipped and left in the document.
 */
export function applyModifiers(node: Node, prims: Primitive[], registry: Registry): Primitive[] {
  let out = prims
  for (const modifier of node.modifiers ?? []) {
    if (modifier.enabled === false) continue
    const kind = modifierKind(registry, modifier.type)
    if (kind) out = kind.apply(out, modifierParams(kind, modifier.params), modifier.frame ?? ORIGIN)
  }
  return out
}

/** The patch that carries a node's modifiers along when the node is moved by `d`, or nothing when it has none. */
export function movedModifiers(node: Node, d: Vec2): { modifiers?: Modifier[] } {
  if (!node.modifiers?.length) return {}
  return { modifiers: node.modifiers.map((m) => ({ ...m, frame: { ...m.frame, x: (m.frame?.x ?? 0) + d.x, y: (m.frame?.y ?? 0) + d.y } })) }
}

/**
 * The part of a segment that lies inside a convex outline, or null when none does. Used where a
 * clip outline cannot be left to the renderer, as in DXF.
 */
export function clipSegment(a: Vec2, b: Vec2, outline: Vec2[]): [Vec2, Vec2] | null {
  const cross = (u: Vec2, v: Vec2) => u.x * v.y - u.y * v.x
  // Which side is inside depends on the way round the outline is listed.
  let area = 0
  outline.forEach((p, i) => (area += cross(p, outline[(i + 1) % outline.length])))
  const side = area >= 0 ? 1 : -1
  const d = sub(b, a)
  let from = 0
  let to = 1
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const edge = sub(outline[(i + 1) % outline.length], p)
    const inside = cross(edge, sub(a, p)) * side
    const towards = cross(edge, d) * side
    if (Math.abs(towards) < 1e-12) {
      if (inside < 0) return null
      continue
    }
    const t = -inside / towards
    if (towards > 0) from = Math.max(from, t)
    else to = Math.min(to, t)
    if (from > to) return null
  }
  return [
    { x: a.x + d.x * from, y: a.y + d.y * from },
    { x: a.x + d.x * to, y: a.y + d.y * to },
  ]
}

/**
 * The parts of a segment that lie inside an outline of any shape, hollow corners included: it is
 * cut wherever it crosses the outline, and the pieces whose middle is inside are kept.
 */
export function segmentsInside(a: Vec2, b: Vec2, outline: Vec2[]): [Vec2, Vec2][] {
  const d = sub(b, a)
  const cuts = [0, 1]
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const edge = sub(outline[(i + 1) % outline.length], p)
    const denominator = d.x * edge.y - d.y * edge.x
    if (Math.abs(denominator) < 1e-12) continue
    const between = sub(p, a)
    const t = (between.x * edge.y - between.y * edge.x) / denominator
    const u = (between.x * d.y - between.y * d.x) / denominator
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
  }
  cuts.sort((p, q) => p - q)
  const point = (t: number): Vec2 => ({ x: a.x + d.x * t, y: a.y + d.y * t })
  const pieces: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (cuts[i + 1] - cuts[i] < 1e-9 || !pointInPolygon(point((cuts[i] + cuts[i + 1]) / 2), outline)) continue
    // Pieces that touch end to end are one piece.
    const last = pieces[pieces.length - 1]
    if (last && Math.abs(cuts[i] - (last as any).to) < 1e-9) {
      last[1] = point(cuts[i + 1])
      ;(last as any).to = cuts[i + 1]
    } else {
      const piece: [Vec2, Vec2] = [point(cuts[i]), point(cuts[i + 1])]
      ;(piece as any).to = cuts[i + 1]
      pieces.push(piece)
    }
  }
  return pieces.map(([from, to]) => [from, to])
}
