import {
  boundsOf,
  checkDrawing,
  hostWall,
  leavesOf,
  mountedOn,
  nodePrimitives,
  openingSpan,
  roomAt,
  type Bounds,
  type Document,
  type DrawingProblem,
  type Node,
  type NodeOf,
  type Region,
  type Vec2,
} from '@opencalque/core'
import { PAGE, registry } from './plans'

/*
 * What graders read off a drawing. They measure with the core itself (roomAt, the openings in a
 * wall, what an object stands against, checkDrawing), so that a task passes when the drawing is
 * right as the app sees it, whatever operations made it.
 */

/** What a run left: the drawing before and after, and everything the model wrote to the person. */
export interface Outcome {
  start: Document
  doc: Document
  reply: string
}

/** One thing a task asks for. A soft check is reported but does not fail the task. */
export interface Check {
  name: string
  pass: boolean
  detail?: string
  soft?: boolean
}

export const check = (name: string, pass: boolean, detail?: string, soft = false): Check => ({ name, pass, ...(detail ? { detail } : {}), ...(soft ? { soft } : {}) })

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

/** Whether `value` is within `fraction` of `expected`. */
export const close = (value: number, expected: number, fraction: number) => Math.abs(value - expected) <= Math.abs(expected) * fraction

export interface RoomFound {
  node: NodeOf<'room'>
  name: string
  /** Floor area in m², 0 when the walls around it do not close. */
  area: number
  region: Region | null
}

/** The rooms of the page, with the floor each one has. */
export function roomsOf(doc: Document): RoomFound[] {
  return leavesOf(doc, PAGE)
    .filter((node): node is NodeOf<'room'> => node.type === 'room')
    .map((node) => {
      const region = roomAt(doc, PAGE, node)
      return { node, name: node.name ?? '', area: region ? region.area / 1e6 : 0, region }
    })
}

/** The one room whose name matches, or null when none or several do. */
export function roomNamed(doc: Document, pattern: RegExp): RoomFound | null {
  const found = roomsOf(doc).filter((room) => pattern.test(room.name))
  return found.length === 1 ? found[0] : null
}

export const wallsOf = (doc: Document) => leavesOf(doc, PAGE).filter((node): node is NodeOf<'wall'> => node.type === 'wall')

export const objectsOf = (doc: Document, kind: string | RegExp) =>
  leavesOf(doc, PAGE).filter((node): node is NodeOf<'parametric'> => node.type === 'parametric' && (typeof kind === 'string' ? node.kind === kind : kind.test(node.kind)))

/** The value a parametric object has for a parameter, its kind's default when it gives none. */
export function prop(node: NodeOf<'parametric'>, key: string): unknown {
  const kind = registry.parametric.get(node.kind)
  return kind ? registry.resolveProps(kind, node.props)[key] : node.props[key]
}

/** Where a node is drawn, as the app draws it. */
export const boundsOfNode = (doc: Document, node: Node): Bounds | null => boundsOf(nodePrimitives(node, { doc, registry, depth: 0 }))

export function unionOf(boxes: (Bounds | null)[]): Bounds | null {
  const real = boxes.filter((b): b is Bounds => b !== null)
  if (real.length === 0) return null
  return { minX: Math.min(...real.map((b) => b.minX)), minY: Math.min(...real.map((b) => b.minY)), maxX: Math.max(...real.map((b) => b.maxX)), maxY: Math.max(...real.map((b) => b.maxY)) }
}

/** The box round a room's floor, or null when it has none. */
export function floorBox(room: RoomFound | null): Bounds | null {
  const outline = room?.region?.outline
  if (!outline || outline.length === 0) return null
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

export const sizeOf = (b: Bounds) => ({ width: b.maxX - b.minX, height: b.maxY - b.minY })
export const centreOf = (b: Bounds): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })

/** How much two boxes overlap, as a share of the smaller one. */
export function overlapShare(a: Bounds, b: Bounds): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)
  if (w <= 0 || h <= 0) return 0
  const smaller = Math.min(sizeOf(a).width * sizeOf(a).height, sizeOf(b).width * sizeOf(b).height)
  return smaller > 0 ? (w * h) / smaller : 0
}

/** The gap between two boxes, 0 when they touch or overlap. */
export function gapBetween(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX))
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY))
  return Math.hypot(dx, dy)
}

function insidePolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Whether a box lies inside a room's floor, allowing `slack` mm at its corners. */
export function boxInRoom(box: Bounds, room: Region, slack = 20): boolean {
  const corners = [
    { x: box.minX + slack, y: box.minY + slack },
    { x: box.maxX - slack, y: box.minY + slack },
    { x: box.maxX - slack, y: box.maxY - slack },
    { x: box.minX + slack, y: box.maxY - slack },
  ]
  return corners.every((corner) => insidePolygon(corner, room.outline))
}

/** The wall a door or window is in, and where along it (mm from the wall's `a`), with its middle point. */
export function openingIn(doc: Document, node: Node) {
  const wall = hostWall(doc, node, registry)
  const span = openingSpan(node, registry)
  if (!wall || !span) return null
  const middle = { x: (span[0].x + span[1].x) / 2, y: (span[0].y + span[1].y) / 2 }
  return { wall, span, middle, width: Math.hypot(span[1].x - span[0].x, span[1].y - span[0].y) }
}

/** The wall and the face an object stands against or is fixed on, if any. */
export const mountOfNode = (doc: Document, node: Node) => mountedOn(doc, node, registry)

export const problemsOf = (doc: Document): DrawingProblem[] => checkDrawing(doc, registry)

/** No problem checkDrawing would report, with the first few named when there are some. */
export function noProblems(o: Outcome, soft = false): Check {
  const problems = problemsOf(o.doc)
  return check('the check finds nothing wrong', problems.length === 0, problems.length > 0 ? problems.slice(0, 3).map((p) => p.message).join(' | ') : undefined, soft)
}

/** JSON with its keys sorted, so that two nodes that say the same compare equal. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v))
}

/** The nodes of `ids` are in the drawing exactly as they were. */
export function unchanged(o: Outcome, ids: string[], name = 'what was not to change is as it was'): Check {
  const changed = ids.filter((id) => stable(o.start.nodes[id]) !== stable(o.doc.nodes[id]))
  return check(name, changed.length === 0, changed.length > 0 ? `changed: ${changed.join(', ')}` : undefined)
}

/** Nothing in the drawing changed. */
export function nothingChanged(o: Outcome): Check {
  const ids = new Set([...Object.keys(o.start.nodes), ...Object.keys(o.doc.nodes)])
  const changed = [...ids].filter((id) => stable(o.start.nodes[id]) !== stable(o.doc.nodes[id]))
  const layers = stable(o.start.layers) === stable(o.doc.layers)
  return check('the drawing was left as it was', changed.length === 0 && layers, changed.length > 0 ? `changed: ${changed.slice(0, 5).join(', ')}` : layers ? undefined : 'the layers changed')
}

/** The numbers written in a reply, a decimal comma read as a point. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')))
}

/** A short account of a number found, for a check's detail. */
export const said = (label: string, value: number | null | undefined, unit = '') => `${label} ${value === null || value === undefined ? 'none' : `${round(value)}${unit}`}`

/** Whether a colour is a grey, as #rgb, #rrggbb or a name. */
export function isGrey(color: string | undefined): boolean {
  if (!color) return false
  if (/^(gr[ae]y|silver|darkgr[ae]y|lightgr[ae]y|dimgr[ae]y|gainsboro)$/i.test(color)) return true
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!hex) return false
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return Math.max(r, g, b) - Math.min(r, g, b) <= 24 && r >= 0x40 && r <= 0xe0
}
