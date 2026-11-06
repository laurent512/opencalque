import { describe, expect, it } from 'vitest'
import { applyOps, besideNode, besidePath, canOffset, createDocument, dist, offsetOps, parallelPath, smoothPoints, type Document, type Node, type Op, type Vec2 } from '../src'

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', id: 'source', ...node } }) as Op
const drawn = (node: Record<string, unknown>) => applyOps(createDocument(), [add(node)])
const source = (doc: Document) => doc.nodes.source
/** The drawing with the copy of `source` at `distance`, and that copy. */
function offset(node: Record<string, unknown>, distance: number): Node & Record<string, any> {
  const doc = drawn(node)
  const copy = offsetOps(doc, source(doc), distance)!
  return applyOps(doc, copy.ops).nodes[copy.id] as Node & Record<string, any>
}
const points = (...xy: number[]): Vec2[] => xy.flatMap((x, i) => (i % 2 === 0 ? [{ x, y: xy[i + 1] }] : []))
const close = (actual: Vec2[], expected: Vec2[]) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => expect(dist(p, expected[i])).toBeLessThan(1e-6))
}

describe('parallelPath', () => {
  it('moves a line to its right, or its left for a negative distance', () => {
    close(parallelPath(points(0, 0, 1000, 0), false, 100)!, points(0, 100, 1000, 100))
    close(parallelPath(points(0, 0, 1000, 0), false, -100)!, points(0, -100, 1000, -100))
  })

  it('joins the sides of a corner where they meet, keeping each at the distance', () => {
    close(parallelPath(points(0, 0, 1000, 0, 1000, 1000), false, 100)!, points(0, 100, 900, 100, 900, 1000))
    close(parallelPath(points(0, 0, 1000, 0, 1000, 1000), false, -100)!, points(0, -100, 1100, -100, 1100, 1000))
  })

  it('goes round a closed shape, and a concave one', () => {
    close(parallelPath(points(0, 0, 1000, 0, 1000, 1000, 0, 1000), true, 100)!, points(100, 100, 900, 100, 900, 900, 100, 900))
    const notched = points(0, 0, 3000, 0, 3000, 3000, 2000, 3000, 2000, 1000, 1000, 1000, 1000, 3000, 0, 3000)
    close(parallelPath(notched, true, 100)!, points(100, 100, 2900, 100, 2900, 2900, 2100, 2900, 2100, 900, 900, 900, 900, 2900, 100, 2900))
  })

  it('leaves a point on a straight run where it is along the run', () => {
    close(parallelPath(points(0, 0, 500, 0, 1000, 0), false, 100)!, points(0, 100, 500, 100, 1000, 100))
  })

  it('ignores a point given twice, and a closed shape repeating its first', () => {
    close(parallelPath(points(0, 0, 0, 0, 1000, 0), false, 100)!, points(0, 100, 1000, 100))
    close(parallelPath(points(0, 0, 1000, 0, 1000, 1000, 0, 0), true, 0)!, points(0, 0, 1000, 0, 1000, 1000))
  })

  it('refuses a shape taken in past its own width', () => {
    expect(parallelPath(points(0, 0, 1000, 0, 1000, 1000, 0, 1000), true, 600)).toBeNull()
  })

  it('refuses a side that would run backwards, in a notch closing up', () => {
    const notched = points(0, 0, 3000, 0, 3000, 3000, 2000, 3000, 2000, 1000, 1000, 1000, 1000, 3000, 0, 3000)
    expect(parallelPath(notched, true, -600)).toBeNull()
  })

  it('refuses a path that crosses itself only once it is moved', () => {
    // Two long arms close together, a narrow neck between two rooms: every side keeps its way, but the neck closes.
    const neck = points(0, 0, 2000, 0, 2000, 900, 3000, 900, 3000, 0, 5000, 0, 5000, 2000, 3000, 2000, 3000, 1100, 2000, 1100, 2000, 2000, 0, 2000)
    expect(parallelPath(neck, true, 50)).not.toBeNull()
    expect(parallelPath(neck, true, 150)).toBeNull()
  })

  it('leaves alone a path that crossed itself already', () => {
    expect(parallelPath(points(0, 0, 1000, 1000, 1000, 0, 0, 1000), false, 10)).not.toBeNull()
  })

  it('refuses a line that turns straight back', () => {
    expect(parallelPath(points(0, 0, 1000, 0, 0, 0), false, 100)).toBeNull()
  })

  it('gives nothing for a path of one point', () => {
    expect(parallelPath(points(5, 5), false, 100)).toBeNull()
    expect(parallelPath(points(5, 5, 5, 5), false, 0)).toBeNull()
  })

  it('moves the points of a curve straight out from it, so that it stays that far away at each', () => {
    const curve = points(0, 0, 1000, 500, 2000, 0, 3000, 500)
    const moved = parallelPath(curve, false, 100, true)!
    expect(moved).toHaveLength(4)
    moved.forEach((p, i) => expect(dist(p, curve[i])).toBeCloseTo(100))
    const line = smoothPoints(curve)
    // Between them it is not exact: on bends as tight as these, up to about 15% of the distance.
    for (const p of smoothPoints(moved)) expect(Math.abs(besidePath(line, false, p))).toBeGreaterThan(80)
    for (const p of smoothPoints(moved)) expect(Math.abs(besidePath(line, false, p))).toBeLessThan(120)
  })
})

describe('besidePath', () => {
  const corner = points(0, 0, 1000, 0, 1000, 1000)

  it('is positive on the side parallelPath goes to', () => {
    expect(besidePath(corner, false, { x: 500, y: 100 })).toBeCloseTo(100)
    expect(besidePath(corner, false, { x: 500, y: -100 })).toBeCloseTo(-100)
    expect(besidePath(corner, false, { x: 900, y: 500 })).toBeCloseTo(100)
    expect(besidePath(corner, false, { x: 1100, y: 500 })).toBeCloseTo(-100)
  })

  it('tells the side out past a corner, where both sides are as near', () => {
    expect(besidePath(corner, false, { x: 1100, y: -100 })).toBeLessThan(0)
    const square = points(0, 0, 1000, 0, 1000, 1000, 0, 1000)
    for (const p of points(-100, -100, 1100, -100, 1100, 1100, -100, 1100)) expect(besidePath(square, true, p)).toBeLessThan(0)
  })

  it('is on the same side round a whole closed shape', () => {
    const square = points(0, 0, 1000, 0, 1000, 1000, 0, 1000)
    for (const p of points(500, 100, 900, 500, 500, 900, 100, 500)) expect(besidePath(square, true, p)).toBeCloseTo(100)
  })
})

describe('offsetOps', () => {
  it('makes a parallel copy of a line, leaving the line', () => {
    const empty = createDocument()
    const layer = Object.keys(empty.layers)[0]
    const doc = applyOps(empty, [add({ type: 'line', layer, a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, style: { stroke: '#ff0000' } })])
    const copy = offsetOps(doc, source(doc), 200)!
    const after = applyOps(doc, copy.ops)
    expect(after.nodes.source).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } })
    expect(after.nodes[copy.id]).toMatchObject({ type: 'line', a: { x: 0, y: 200 }, b: { x: 1000, y: 200 }, style: { stroke: '#ff0000' }, layer, parent: 'page_1' })
  })

  it('keeps a polyline closed and a curve a curve', () => {
    const polygon = offset({ type: 'polyline', closed: true, points: points(0, 0, 1000, 0, 1000, 1000, 0, 1000) }, 100)
    expect(polygon).toMatchObject({ closed: true })
    close(polygon.points, points(100, 100, 900, 100, 900, 900, 100, 900))
    const curve = offset({ type: 'polyline', smooth: true, points: points(0, 0, 1000, 500, 2000, 0) }, 100)
    expect(curve.smooth).toBe(true)
    expect(curve.points).toHaveLength(3)
  })

  it('makes a rectangle larger or smaller about its middle', () => {
    expect(offset({ type: 'rect', x: 0, y: 0, width: 1000, height: 600 }, 100)).toMatchObject({ x: 100, y: 100, width: 800, height: 400 })
    expect(offset({ type: 'rect', x: 0, y: 0, width: 1000, height: 600 }, -100)).toMatchObject({ x: -100, y: -100, width: 1200, height: 800 })
  })

  it('keeps a turned rectangle round the same middle', () => {
    const copy = offset({ type: 'rect', x: 0, y: 0, width: 1000, height: 600, rotation: 90 }, 100)
    expect(copy).toMatchObject({ width: 800, height: 400, rotation: 90 })
    expect(copy.x).toBeCloseTo(-100)
    expect(copy.y).toBeCloseTo(100)
  })

  it('refuses a rectangle taken in past its middle', () => {
    const doc = drawn({ type: 'rect', x: 0, y: 0, width: 1000, height: 600 })
    expect(offsetOps(doc, source(doc), 300)).toBeNull()
    expect(offsetOps(doc, source(doc), 299)).not.toBeNull()
  })

  it('changes the radius of a circle and of an arc, which keeps its angles', () => {
    expect(offset({ type: 'ellipse', cx: 0, cy: 0, rx: 500, ry: 500 }, 100)).toMatchObject({ cx: 0, cy: 0, rx: 600, ry: 600 })
    expect(offset({ type: 'ellipse', cx: 0, cy: 0, rx: 500, ry: 500, from: 10, to: 80 }, -100)).toMatchObject({ rx: 400, ry: 400, from: 10, to: 80 })
  })

  it('refuses a circle taken in to nothing', () => {
    const doc = drawn({ type: 'ellipse', cx: 0, cy: 0, rx: 500, ry: 500 })
    expect(offsetOps(doc, source(doc), -500)).toBeNull()
  })

  it('has no copy of an ellipse that is no circle, a wall or a text', () => {
    for (const node of [
      { type: 'ellipse', cx: 0, cy: 0, rx: 500, ry: 300 },
      { type: 'wall', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200 },
      { type: 'text', x: 0, y: 0, text: 'Hall', size: 200 },
    ]) {
      const doc = drawn(node)
      expect(canOffset(source(doc))).toBe(false)
      expect(offsetOps(doc, source(doc), 100)).toBeNull()
    }
  })

  it('reads a side so that the copy goes to it, whatever the object', () => {
    const towards = { x: 700, y: 300 }
    for (const node of [
      { type: 'line', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
      { type: 'line', a: { x: 1000, y: 0 }, b: { x: 0, y: 0 } },
      { type: 'polyline', points: points(0, 0, 500, 0, 1000, 0) },
      { type: 'polyline', smooth: true, points: points(0, 0, 500, 0, 1000, 0) },
      { type: 'rect', x: 0, y: 0, width: 1000, height: 1000 },
      { type: 'ellipse', cx: 700, cy: 0, rx: 100, ry: 100 },
    ]) {
      const doc = drawn(node)
      const beside = besideNode(source(doc), towards)
      const copy = offsetOps(doc, source(doc), beside)!
      const after = applyOps(doc, copy.ops)
      // Now lying on the point the pointer gave, the copy has it at no distance.
      expect(besideNode(after.nodes[copy.id], towards)).toBeCloseTo(0)
    }
  })

  it('is one undoable list that a drawing can be rebuilt from', () => {
    const doc = drawn({ type: 'line', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } })
    const { ops } = offsetOps(doc, source(doc), 100)!
    expect(ops.map((op) => op.op)).toEqual(['add_node', 'update_node'])
  })
})
