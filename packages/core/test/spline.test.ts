import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, nodePrimitives, parseDocument, Registry, serializeDocument, splinePoints, type Op, type Vec2 } from '../src'

/*
 * Splines pulled by their points (a polyline's `smooth` of 'spline'): the control points of a
 * clamped cubic B-spline, as CAD programs draw a spline; closed, a loop through none of them.
 */
const points: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1000, y: -1000 },
  { x: 2000, y: 1000 },
  { x: 3000, y: 0 },
]
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

describe('a spline pulled by its points', () => {
  it('starts on the first point and ends on the last, leaving the others', () => {
    const curve = splinePoints(points)
    expect(near(curve[0], points[0])).toBeLessThan(1e-9)
    expect(near(curve.at(-1)!, points[3])).toBeLessThan(1e-9)
    // It passes near the points between, not through them.
    for (const p of [points[1], points[2]]) expect(Math.min(...curve.map((q) => near(q, p)))).toBeGreaterThan(100)
    // Leaving the first point towards the second: its first steps go that way.
    const way = { x: curve[1].x - curve[0].x, y: curve[1].y - curve[0].y }
    expect(way.x * 1000 + way.y * -1000).toBeGreaterThan(0)
  })

  it('stays within the polygon of its points, as a B-spline does', () => {
    for (const p of splinePoints(points)) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(3000 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1000 - 1e-9)
      expect(p.y).toBeLessThanOrEqual(1000 + 1e-9)
    }
  })

  it('is a straight line with two points, a smooth curve with three, and a loop through none when closed', () => {
    expect(splinePoints(points.slice(0, 2))).toEqual(points.slice(0, 2))
    const three = splinePoints(points.slice(0, 3))
    expect(near(three[0], points[0])).toBeLessThan(1e-9)
    expect(near(three.at(-1)!, points[2])).toBeLessThan(1e-9)
    const loop = splinePoints(points, true)
    expect(Math.min(...points.flatMap((p) => loop.map((q) => near(q, p))))).toBeGreaterThan(50)
  })

  it('is drawn by a polyline that says so, and saved as version 7, read back as it was', () => {
    const doc = applyOps(createDocument('Plan'), [{ op: 'add_node', node: { type: 'polyline', id: 'hull', parent: 'page_1', points, smooth: 'spline' } as never } as Op])
    const [path] = nodePrimitives(doc.nodes.hull, { doc, registry: new Registry(), depth: 0 })
    // Four points: one cubic stretch, drawn in sixteen steps and its last point.
    expect(path.kind === 'path' && path.points.length).toBe(17)
    const saved = JSON.parse(serializeDocument(doc))
    expect(saved.version).toBe(7)
    expect(parseDocument(saved).nodes.hull).toEqual(doc.nodes.hull)
    // A curve through its points needs no more than before.
    const curved = applyOps(doc, [{ op: 'update_node', id: 'hull', patch: { smooth: true } }])
    expect(JSON.parse(serializeDocument(curved)).version).toBeLessThan(7)
  })
})
