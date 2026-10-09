import { arcPoints, distToSegment, pointInPolygon, type Vec2 } from './geometry'
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

  // Walls are drawn as polygons that touch or overlap, and read as one shape: the parts of an
  // outline that lie inside another wall, or along its edge, are inside the wall and must not
  // appear. That covers a corner, where two walls share an edge, and a wall ending against the
  // middle of another, whose end is hidden and which opens the side it meets.
  const scene = buildScene(doc, containerId, registry)
  const walls = scene.flatMap((item) => item.prims.flatMap((prim) => (prim.kind === 'path' && prim.union && prim.points.length > 2 ? [prim.points] : [])))
  const NEAR = 0.01
  const onEdge = (p: Vec2, polygon: Vec2[]) => polygon.some((q, i) => distToSegment(p, q, polygon[(i + 1) % polygon.length]) < NEAR)
  const outside = (a: Vec2, b: Vec2, own: Vec2[]): [Vec2, Vec2][] => {
    const d = { x: b.x - a.x, y: b.y - a.y }
    const length = Math.hypot(d.x, d.y)
    if (length < 1e-9) return []
    // Every place along the edge where another wall's outline crosses it or has a corner on it.
    const cuts = [0, 1]
    for (const other of walls) {
      if (other === own) continue
      other.forEach((c, i) => {
        const e = other[(i + 1) % other.length]
        const along = ((c.x - a.x) * d.x + (c.y - a.y) * d.y) / (length * length)
        if (along > 0 && along < 1 && distToSegment(c, a, b) < NEAR) cuts.push(along)
        const cross = d.x * (e.y - c.y) - d.y * (e.x - c.x)
        if (Math.abs(cross) < 1e-9) return
        const t = ((c.x - a.x) * (e.y - c.y) - (c.y - a.y) * (e.x - c.x)) / cross
        const u = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / cross
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
      })
    }
    cuts.sort((x, y) => x - y)
    const at = (t: number) => ({ x: a.x + d.x * t, y: a.y + d.y * t })
    const parts: [Vec2, Vec2][] = []
    for (let i = 0; i + 1 < cuts.length; i++) {
      if ((cuts[i + 1] - cuts[i]) * length < NEAR) continue
      const middle = at((cuts[i] + cuts[i + 1]) / 2)
      if (walls.some((other) => other !== own && (onEdge(middle, other) || pointInPolygon(middle, other)))) continue
      // Stretches that follow one another are one line.
      const last = parts[parts.length - 1]
      if (last && Math.hypot(last[1].x - at(cuts[i]).x, last[1].y - at(cuts[i]).y) < NEAR) last[1] = at(cuts[i + 1])
      else parts.push([at(cuts[i]), at(cuts[i + 1])])
    }
    return parts
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
          if (prim.union && prim.points.length > 2) for (const [from, to] of outside(a, b, prim.points)) line(layer, from, to, prim.clip)
          else line(layer, a, b, prim.clip)
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
