import { arcPoints, pointInPolygon, type Vec2 } from './geometry'
import { segmentsInside } from './modifiers'
import type { Registry } from './registry'
import { buildScene } from './scene'
import type { Document } from './schema'

const n = (value: number) => String(Math.round(value * 1000) / 1000)
/** DXF layer names allow few characters; anything else becomes an underscore. */
const layerName = (name: string | undefined) => (name ?? '0').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 31) || '0'

/**
 * Exports a page or component as an ASCII DXF (R12 entities), the exchange format every CAD
 * program reads. Geometry is written as lines, circles and text on layers named after the
 * drawing's layers, in millimetres, with Y turned to point up as CAD expects. Fills, line weights
 * and pictures are not carried over.
 */
export function toDXF(doc: Document, containerId: string, registry: Registry): string {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES']
  const entity = (type: string, layer: string, codes: (string | number)[]) => out.push('0', type, '8', layer, ...codes.map(String))
  // DXF has nothing like a clip outline, so a line is cut down to the part inside every one of them.
  const line = (layer: string, a: Vec2, b: Vec2, clip: Vec2[][] = []) => {
    let parts: [Vec2, Vec2][] = [[a, b]]
    for (const outline of clip) parts = parts.flatMap(([from, to]) => segmentsInside(from, to, outline))
    for (const [from, to] of parts) entity('LINE', layer, [10, n(from.x), 20, n(-from.y), 11, n(to.x), 21, n(-to.y)])
  }

  // Walls are drawn as touching polygons; the edges two of them share are inside the wall and
  // must not appear. An edge is shared when it occurs twice, in either direction.
  const key = (a: Vec2, b: Vec2) => [`${n(a.x)},${n(a.y)}`, `${n(b.x)},${n(b.y)}`].sort().join('|')
  const scene = buildScene(doc, containerId, registry)
  const merged = new Map<string, number>()
  for (const item of scene) {
    for (const prim of item.prims) {
      if (prim.kind !== 'path' || !prim.union) continue
      prim.points.forEach((p, i) => {
        const k = key(p, prim.points[(i + 1) % prim.points.length])
        merged.set(k, (merged.get(k) ?? 0) + 1)
      })
    }
  }

  for (const item of scene) {
    const layer = layerName(item.node.layer ? doc.layers[item.node.layer]?.name : undefined)
    for (const prim of item.prims) {
      if (prim.kind === 'path') {
        if (prim.stroke === 'none') continue
        const count = prim.closed ? prim.points.length : prim.points.length - 1
        for (let i = 0; i < count; i++) {
          const a = prim.points[i]
          const b = prim.points[(i + 1) % prim.points.length]
          if (prim.union && (merged.get(key(a, b)) ?? 0) > 1) continue
          line(layer, a, b, prim.clip)
        }
      } else if (prim.kind === 'ellipse') {
        if (Math.abs(prim.rx - prim.ry) < 1e-6 && !prim.clip?.length) entity('CIRCLE', layer, [10, n(prim.cx), 20, n(-prim.cy), 40, n(prim.rx)])
        else {
          // R12 has no ellipse: approximate with segments.
          const ring = arcPoints({ x: 0, y: 0 }, 1, 0, 360, 72).map((p) => {
            const r = ((prim.rotation ?? 0) * Math.PI) / 180
            const x = p.x * prim.rx
            const y = p.y * prim.ry
            return { x: prim.cx + x * Math.cos(r) - y * Math.sin(r), y: prim.cy + x * Math.sin(r) + y * Math.cos(r) }
          })
          for (let i = 0; i < ring.length - 1; i++) line(layer, ring[i], ring[i + 1], prim.clip)
        }
      } else if (prim.kind === 'text') {
        // A text is kept whole or left out, by where it starts.
        if (prim.clip?.some((outline) => !pointInPolygon(prim, outline))) continue
        const codes: (string | number)[] = [10, n(prim.x), 20, n(-prim.y), 40, n(prim.size), 1, prim.text.replace(/\r?\n/g, ' '), 50, n(-(prim.rotation ?? 0))]
        // Centred text needs its alignment point repeated in the second point.
        if (prim.align === 'center' || prim.align === 'right') codes.push(72, prim.align === 'center' ? 1 : 2, 11, n(prim.x), 21, n(-prim.y))
        entity('TEXT', layer, codes)
      }
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF')
  return out.join('\n') + '\n'
}
