import { applyTransform, pointInPolygon, sub, type Transform, type Vec2 } from './geometry'
import { transformPrimitive, type Primitive } from './primitives'
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
export const HATCH_PATTERNS = ['Lines', 'Cross', 'Planks', 'Tiles', 'Dots', 'Zigzag'] as const
export const HATCH_INK = '#9aa3b2'
/** The spacing in mm and the angle in degrees each pattern has when a fill does not say. */
export const PATTERN_DEFAULTS: Record<string, { spacing: number; angle: number }> = {
  Lines: { spacing: 100, angle: 45 },
  Cross: { spacing: 150, angle: 45 },
  Planks: { spacing: 150, angle: 0 },
  Tiles: { spacing: 300, angle: 0 },
  Dots: { spacing: 120, angle: 0 },
  Zigzag: { spacing: 100, angle: 0 },
}
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
  const grid = params.pattern === 'Tiles' || params.pattern === 'Cross'
  const filled = params.pattern === 'Dots' || params.pattern === 'Zigzag'
  const count = (size: number) =>
    filled
      ? ((maxV - minV) / size + 1) * ((maxU - minU) / size + 1) * (params.pattern === 'Zigzag' ? 2 : 1)
      : (maxV - minV) / size + (grid ? (maxU - minU) / size : params.pattern === 'Planks' ? ((maxV - minV) / size) * ((maxU - minU) / (size * 8) + 1) : 0)
  while (count(step) > HATCH_LIMIT) step *= 2

  const strokes: [Vec2, Vec2][] = []
  if (params.pattern === 'Dots') {
    // Short dashes on a staggered grid: the speckle that stands for concrete.
    const dot = step * 0.09
    for (let row = Math.ceil(minV / step); row * step <= maxV; row++) {
      const shift = row % 2 === 0 ? 0 : step / 2
      for (let column = Math.floor((minU - shift) / step); column * step + shift <= maxU; column++) strokes.push([world(column * step + shift - dot, row * step), world(column * step + shift + dot, row * step)])
    }
    return strokes
  }
  if (params.pattern === 'Zigzag') {
    // Bands of zigzag from edge to edge: the sign for insulation.
    for (let row = Math.floor(minV / step); row * step < maxV; row++) {
      for (let column = Math.floor(minU / step); column * step < maxU; column++) {
        const [u, v] = [column * step, row * step]
        strokes.push([world(u, v + step), world(u + step / 2, v)], [world(u + step / 2, v), world(u + step, v + step)])
      }
    }
    return strokes
  }
  for (let row = Math.ceil(minV / step); row * step <= maxV; row++) strokes.push([world(minU, row * step), world(maxU, row * step)])
  if (grid) {
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
 * The strokes of a fill pattern over one closed shape, before they are cut to it. The pattern is
 * laid from the origin of the drawing, so shapes side by side (the walls around a room) carry it
 * as one, without a break where they meet.
 */
export function patternStrokes(shape: Vec2[], pattern: { kind: string; spacing?: number; angle?: number }): [Vec2, Vec2][] {
  const usual = PATTERN_DEFAULTS[pattern.kind]
  if (!usual || shape.length < 3) return []
  return hatchStrokes(shape, { pattern: pattern.kind, spacing: pattern.spacing ?? usual.spacing, angle: pattern.angle ?? usual.angle }, ORIGIN)
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

/** A repeat never draws more copies than this, whatever is typed. */
const MAX_COPIES = 400

/**
 * Draws what it is given again and again at a steady step: a row of copies, or rows and columns.
 * The copies are drawn, not made: they are one object, and follow it when it changes.
 */
export const arrayModifier: ModifierKind = {
  type: 'array',
  label: 'Repeat',
  description: 'Draws copies at a steady step: in a row, or in rows and columns.',
  params: [
    { key: 'count', label: 'Across', type: 'number', default: 3 },
    { key: 'dx', label: 'Step across', type: 'number', default: 1000, unit: 'length' },
    { key: 'rows', label: 'Rows', type: 'number', default: 1 },
    { key: 'dy', label: 'Step down', type: 'number', default: 1000, unit: 'length' },
  ],
  apply: (prims, params, frame) => {
    const whole = (value: unknown) => Math.max(1, Math.round(Number(value) || 1))
    const columns = Math.min(whole(params.count), MAX_COPIES)
    const rows = Math.min(whole(params.rows), Math.max(1, Math.floor(MAX_COPIES / columns)))
    // The steps turn and scale with the object, so a turned row stays a row of the object.
    const origin = applyTransform({ x: 0, y: 0 }, frame)
    const across = sub(applyTransform({ x: Number(params.dx) || 0, y: 0 }, frame), origin)
    const down = sub(applyTransform({ x: 0, y: Number(params.dy) || 0 }, frame), origin)
    const out: Primitive[] = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const by = { x: across.x * column + down.x * row, y: across.y * column + down.y * row }
        out.push(...(row === 0 && column === 0 ? prims : prims.map((prim) => transformPrimitive(prim, by))))
      }
    }
    return out
  },
}

/** The modifiers every drawing can use, whatever extensions are in use. */
export const BUILT_IN_MODIFIERS: ReadonlyMap<string, ModifierKind> = new Map([
  [cropModifier.type, cropModifier],
  [hatchModifier.type, hatchModifier],
  [arrayModifier.type, arrayModifier],
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
