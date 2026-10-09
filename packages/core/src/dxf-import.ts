import type { Vec2 } from './geometry'
import { layersOf, newId } from './document'
import type { LayerInput, NodeInput, Op } from './ops'
import type { Document } from './schema'

/** Millimetres in one drawing unit, by the code a DXF gives in $INSUNITS. Anything else is taken as millimetres. */
const UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }

/** Past this many entities a file is cut short: an editor of plans is not meant for a survey of a city. */
export const DXF_LIMIT = 20000

interface Entity {
  type: string
  /** Every value of each code, in the order they came. */
  codes: Map<number, string[]>
  /** The points of an old-style polyline, which come as entities of their own after it. */
  vertices: Vec2[]
}

/**
 * Reads the geometry of an ASCII DXF as operations that add it to a page: lines, polylines,
 * circles, arcs, ellipses and text, each on a layer named as in the file. Y is turned to point
 * down and lengths are brought to millimetres. Blocks, hatches, dimensions and anything else
 * are left out; `skipped` says how many entities that was.
 */
export function dxfOps(doc: Document, parent: string, text: string): { ops: Op[]; added: number; skipped: number } {
  const lines = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1].trim()])
  if (!pairs.some(([code, value]) => code === 0 && value === 'SECTION')) throw new Error('This is not a DXF file in text form. A binary DXF or a DWG has to be saved as an ASCII DXF first.')

  let unit = 1
  let section = ''
  const entities: Entity[] = []
  let polyline: Entity | null = null
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]
    if (code === 9 && value === '$INSUNITS' && pairs[i + 1]?.[0] === 70) unit = UNITS[parseInt(pairs[i + 1][1], 10)] ?? 1
    if (code === 2 && pairs[i - 1]?.[0] === 0 && pairs[i - 1][1] === 'SECTION') section = value
    if (code !== 0 || section !== 'ENTITIES') continue
    const entity: Entity = { type: value, codes: new Map(), vertices: [] }
    for (let k = i + 1; k < pairs.length && pairs[k][0] !== 0; k++) entity.codes.set(pairs[k][0], [...(entity.codes.get(pairs[k][0]) ?? []), pairs[k][1]])
    if (value === 'POLYLINE') polyline = entity
    if (value === 'VERTEX' && polyline) polyline.vertices.push({ x: parseFloat(entity.codes.get(10)?.[0] ?? '0'), y: parseFloat(entity.codes.get(20)?.[0] ?? '0') })
    else if (value === 'SEQEND') polyline = null
    else if (value === 'ENDSEC') section = ''
    else entities.push(entity)
  }

  const ops: Op[] = []
  // Layers are matched by name, so importing twice does not double them.
  const layers = new Map(layersOf(doc).map((layer) => [layer.name, layer.id]))
  const layerOf = (entity: Entity): string | undefined => {
    const name = entity.codes.get(8)?.[0]
    if (!name || name === '0') return undefined
    if (!layers.has(name)) {
      const layer: LayerInput = { id: newId('layer'), name }
      ops.push({ op: 'add_layer', layer })
      layers.set(name, layer.id!)
    }
    return layers.get(name)
  }
  const number = (entity: Entity, code: number, fallback = 0) => {
    const value = parseFloat(entity.codes.get(code)?.[0] ?? '')
    return Number.isFinite(value) ? value : fallback
  }
  // Adding zero turns the "-0" a flipped zero would be into a plain one.
  const point = (x: number, y: number): Vec2 => ({ x: x * unit + 0, y: -y * unit + 0 })
  const turn = (degrees: number) => ((degrees % 360) + 360) % 360

  let added = 0
  let skipped = 0
  for (const entity of entities.slice(0, DXF_LIMIT)) {
    let node: Record<string, unknown> | null = null
    if (entity.type === 'LINE') {
      const [a, b] = [point(number(entity, 10), number(entity, 20)), point(number(entity, 11), number(entity, 21))]
      if (a.x !== b.x || a.y !== b.y) node = { type: 'line', a, b }
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const xs = entity.codes.get(10) ?? []
      const ys = entity.codes.get(20) ?? []
      const points = entity.type === 'POLYLINE' ? entity.vertices.map((p) => point(p.x, p.y)) : xs.map((x, i) => point(parseFloat(x), parseFloat(ys[i] ?? '0')))
      if (points.length >= 2) node = { type: 'polyline', points, ...(number(entity, 70) & 1 ? { closed: true } : {}) }
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const centre = point(number(entity, 10), number(entity, 20))
      const radius = number(entity, 40) * unit
      // An arc runs anticlockwise from its first angle to its second; with Y turned over, that is clockwise from minus the second.
      const arc = entity.type === 'ARC' ? { from: turn(-number(entity, 51)), to: turn(-number(entity, 50)) } : {}
      if (radius > 0) node = { type: 'ellipse', cx: centre.x, cy: centre.y, rx: radius, ry: radius, ...arc }
    } else if (entity.type === 'ELLIPSE') {
      const centre = point(number(entity, 10), number(entity, 20))
      const major = { x: number(entity, 11) * unit, y: -number(entity, 21) * unit }
      const rx = Math.hypot(major.x, major.y)
      if (rx > 0) node = { type: 'ellipse', cx: centre.x, cy: centre.y, rx, ry: rx * number(entity, 40, 1), rotation: turn((Math.atan2(major.y, major.x) * 180) / Math.PI) }
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
      // Formatting codes of a multi-line text are dropped; "\P" is its line break.
      const words = (entity.codes.get(3) ?? [])
        .concat(entity.codes.get(1) ?? [])
        .join('')
        .replace(/\\P/g, '\n')
        .replace(/\\[A-Za-z][^;\\]*;|[{}]/g, '')
      // A text that is centred or ends at its point gives that point second.
      const side = entity.type === 'TEXT' && entity.codes.has(11) ? number(entity, 72) : 0
      const align = side === 1 || side === 4 ? { align: 'center' } : side === 2 ? { align: 'right' } : {}
      const at = 'align' in align ? point(number(entity, 11), number(entity, 21)) : point(number(entity, 10), number(entity, 20))
      const size = number(entity, 40, 2.5) * unit
      if (words.trim() && size > 0) node = { type: 'text', x: at.x, y: at.y, text: words, size, ...align, ...(number(entity, 50) ? { rotation: turn(-number(entity, 50)) } : {}) }
    }
    if (!node) {
      skipped++
      continue
    }
    const layer = layerOf(entity)
    ops.push({ op: 'add_node', node: { ...node, parent, ...(layer ? { layer } : {}) } as NodeInput })
    added++
  }
  return { ops, added, skipped: skipped + Math.max(0, entities.length - DXF_LIMIT) }
}
