import { describe, expect, it } from 'vitest'
import { applyOps, arcMiddleOfRadius, arcThrough, buildScene, createDocument, dist, ellipseArc, itemsInside, itemsTouching, Registry, segmentTouchesBounds, type Bounds, type Op } from '../src'

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY })

const sceneOf = (...ops: Op[]) => buildScene(applyOps(createDocument(), ops), 'page_1', new Registry())
const touched = (scene: ReturnType<typeof sceneOf>, rect: Bounds) => itemsTouching(scene, rect).map((item) => item.id)

describe('a box dragged leftwards', () => {
  it('goes by the line drawn, not the box around it', () => {
    const scene = sceneOf(add({ type: 'line', id: 'diagonal', a: { x: 0, y: 0 }, b: { x: 1000, y: 1000 } }))
    expect(touched(scene, box(800, 0, 900, 100))).toEqual([])
    expect(touched(scene, box(400, 400, 600, 600))).toEqual(['diagonal'])
    // Across the line with neither of its ends inside.
    expect(touched(scene, box(450, 0, 550, 1000))).toEqual(['diagonal'])
  })

  it('picks up what lies wholly inside it too, where the other box would', () => {
    const scene = sceneOf(add({ type: 'line', id: 'short', a: { x: 100, y: 100 }, b: { x: 200, y: 100 } }))
    expect(touched(scene, box(0, 0, 500, 500))).toEqual(['short'])
    expect(itemsInside(scene, box(0, 0, 500, 500)).map((item) => item.id)).toEqual(['short'])
  })

  it('touches the outline of an empty shape, and all of a filled one, as a click does', () => {
    const scene = sceneOf(
      add({ type: 'rect', id: 'empty', x: 0, y: 0, width: 1000, height: 1000 }),
      add({ type: 'rect', id: 'filled', x: 2000, y: 0, width: 1000, height: 1000, style: { fill: '#888888' } }),
      add({ type: 'ellipse', id: 'circle', cx: 5000, cy: 500, rx: 500, ry: 500 }),
    )
    expect(touched(scene, box(400, 400, 600, 600))).toEqual([])
    expect(touched(scene, box(900, 400, 1100, 600))).toEqual(['empty'])
    expect(touched(scene, box(4900, 400, 5100, 600))).toEqual([])
    expect(touched(scene, box(5400, 400, 5600, 600))).toEqual(['circle'])
  })

  it('follows an arc round its curve, not along the circle it is cut from', () => {
    const scene = sceneOf(add({ type: 'ellipse', id: 'arc', cx: 0, cy: 0, rx: 1000, ry: 1000, from: 0, to: 90 }))
    expect(touched(scene, box(650, 650, 750, 750))).toEqual(['arc'])
    expect(touched(scene, box(-750, -750, -650, -650))).toEqual([])
  })

  it('takes no sheet from inside it, only across its edge', () => {
    const scene = sceneOf(add({ type: 'paper', id: 'sheet', x: 0, y: 0, width: 4000, height: 3000, name: 'Sheet' }))
    expect(touched(scene, box(1000, 1000, 2000, 2000))).toEqual([])
    expect(touched(scene, box(-100, 1000, 100, 2000))).toEqual(['sheet'])
  })

  it('leaves out what is locked', () => {
    const scene = sceneOf(add({ type: 'line', id: 'held', locked: true, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }))
    expect(touched(scene, box(-10, -10, 200, 10))).toEqual([])
  })
})

describe('segmentTouchesBounds', () => {
  const rect = box(0, 0, 100, 100)
  it('finds a segment that passes through, ends inside or lies on a side', () => {
    expect(segmentTouchesBounds({ x: -50, y: 50 }, { x: 150, y: 50 }, rect)).toBe(true)
    expect(segmentTouchesBounds({ x: 50, y: 50 }, { x: 500, y: 500 }, rect)).toBe(true)
    expect(segmentTouchesBounds({ x: 0, y: -10 }, { x: 0, y: 110 }, rect)).toBe(true)
  })
  it('misses one that passes by a corner or stops short', () => {
    expect(segmentTouchesBounds({ x: 90, y: -20 }, { x: 130, y: 20 }, rect)).toBe(false)
    expect(segmentTouchesBounds({ x: -50, y: 50 }, { x: -1, y: 50 }, rect)).toBe(false)
  })
})

describe('arcThrough', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 2000, y: 0 }

  /** Whether the arc starts and ends at `a` and `b`, in either order, and passes through `p`. */
  const runsThrough = (arc: NonNullable<ReturnType<typeof arcThrough>>, p: { x: number; y: number }) => {
    const points = ellipseArc({ cx: arc.cx, cy: arc.cy, rx: arc.r, ry: arc.r, from: arc.from, to: arc.to })
    const ends = [points[0], points[points.length - 1]]
    expect(Math.min(dist(ends[0], a), dist(ends[1], a))).toBeLessThan(1e-6)
    expect(Math.min(dist(ends[0], b), dist(ends[1], b))).toBeLessThan(1e-6)
    expect(Math.min(...points.map((q) => dist(q, p)))).toBeLessThan(arc.r * 0.05)
  }

  it('makes a half circle on either side of the chord', () => {
    for (const p of [
      { x: 1000, y: 1000 },
      { x: 1000, y: -1000 },
    ]) {
      const arc = arcThrough(a, b, p)!
      expect(arc.cx).toBeCloseTo(1000)
      expect(arc.cy).toBeCloseTo(0)
      expect(arc.r).toBeCloseTo(1000)
      runsThrough(arc, p)
    }
  })

  it('goes the long way round when the point asks for it', () => {
    const p = { x: 1000, y: 3000 }
    const arc = arcThrough(a, b, p)!
    expect(arc.r).toBeGreaterThan(1000)
    runsThrough(arc, p)
    const sweep = (((arc.to - arc.from) % 360) + 360) % 360
    expect(sweep).toBeGreaterThan(180)
  })

  it('holds for a chord in any direction, and a point off the middle', () => {
    for (const [end, p] of [
      [{ x: -700, y: 1300 }, { x: 300, y: 900 }],
      [{ x: 0, y: -2500 }, { x: 800, y: -400 }],
      [{ x: -3000, y: -10 }, { x: -2000, y: 900 }],
    ]) {
      const arc = arcThrough(a, end, p)!
      expect(dist({ x: arc.cx, y: arc.cy }, a)).toBeCloseTo(arc.r)
      expect(dist({ x: arc.cx, y: arc.cy }, end)).toBeCloseTo(arc.r)
      expect(dist({ x: arc.cx, y: arc.cy }, p)).toBeCloseTo(arc.r)
    }
  })

  it('gives nothing for three points in line or two that are the same', () => {
    expect(arcThrough(a, b, { x: 1000, y: 0 })).toBeNull()
    expect(arcThrough(a, b, { x: 5000, y: 0 })).toBeNull()
    expect(arcThrough(a, a, { x: 0, y: 100 })).toBeNull()
  })
})

describe('arcMiddleOfRadius', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 2000, y: 0 }

  it('gives an arc of that radius on the side of the pointer', () => {
    for (const towards of [
      { x: 900, y: 200 },
      { x: 900, y: -200 },
    ]) {
      const p = arcMiddleOfRadius(a, b, 1500, towards)
      expect(arcThrough(a, b, p)!.r).toBeCloseTo(1500)
      expect(Math.sign(p.y)).toBe(Math.sign(towards.y))
    }
  })

  it('takes the long arc when the pointer is nearer its middle', () => {
    const short = arcMiddleOfRadius(a, b, 1500, { x: 1000, y: 100 })
    const long = arcMiddleOfRadius(a, b, 1500, { x: 1000, y: 2500 })
    expect(long.y).toBeGreaterThan(short.y)
    expect(arcThrough(a, b, long)!.r).toBeCloseTo(1500)
  })

  it('makes a half circle of a radius too small to reach', () => {
    const p = arcMiddleOfRadius(a, b, 10, { x: 1000, y: 100 })
    expect(p).toEqual({ x: 1000, y: 1000 })
  })
})
