import { describe, expect, it } from 'vitest'
import { declarativeExtension, dist, Registry, roundCorners, type Vec2 } from '../src'

const square = (size: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: size, y: 0 },
  { x: size, y: size },
  { x: 0, y: size },
]
const bounds = (points: Vec2[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
})
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

describe('rounding the corners of a path', () => {
  it('replaces each corner by an arc touching its two sides, the outline reaching as far as before', () => {
    const rounded = roundCorners(square(100), 10)
    const b = bounds(rounded)
    ;[b.minX, b.minY].forEach((v) => close(v, 0))
    ;[b.maxX, b.maxY].forEach((v) => close(v, 100))
    // No corner is left, and what is near the top left corner lies on a circle of 10 round (10, 10).
    expect(rounded.some((p) => dist(p, { x: 0, y: 0 }) < 1)).toBe(false)
    for (const p of rounded.filter((q) => q.x < 10 && q.y < 10)) close(dist(p, { x: 10, y: 10 }), 10)
  })

  it('makes a radius smaller where the sides are too short to hold it', () => {
    // A square of 40 with corners of 100 is a circle of 20.
    for (const p of roundCorners(square(40), 100)) close(dist(p, { x: 20, y: 20 }), 20)
  })

  it('rounds only the corners given a radius', () => {
    const rounded = roundCorners(square(100), [0, 10, 0, 0])
    expect(rounded[0]).toEqual({ x: 0, y: 0 })
    expect(rounded.slice(-2)).toEqual([
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ])
    expect(rounded.some((p) => p.x === 100 && p.y === 0)).toBe(false)
  })

  it('keeps the ends of an open path, the corner next to an end free to use the whole side', () => {
    const rounded = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
      ],
      50,
      false,
    )
    expect(rounded[0]).toEqual({ x: 0, y: 0 })
    close(rounded[rounded.length - 1].x, 30)
    close(rounded[rounded.length - 1].y, 30)
    for (const p of rounded) close(dist(p, { x: 0, y: 30 }), 30)
  })

  it('leaves alone a path with no radius, and points in a straight line', () => {
    expect(roundCorners(square(100), 0)).toEqual(square(100))
    const straight = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(roundCorners(straight, 20, false)).toEqual(straight)
  })
})

describe('a rounded path in an extension written as data', () => {
  const registry = new Registry().use(
    declarativeExtension({
      format: 'opencalque-extension',
      formatVersion: 1,
      id: 'test.cushion',
      name: 'Cushion',
      version: '1.0.0',
      objects: [
        {
          kind: 'test.cushion',
          label: 'Cushion',
          params: [
            { key: 'size', label: 'Size', type: 'number', default: 500, unit: 'length' },
            { key: 'soft', label: 'Softness', type: 'number', default: 60, unit: 'length' },
          ],
          draw: [{ closed: true, radius: 'soft', path: [[0, 0], ['size', 0], ['size', 'size'], [0, 'size']] }],
        },
      ],
    }),
  )
  const outline = (props: Record<string, unknown>) => {
    const kind = registry.parametric.get('test.cushion')!
    const [path] = kind.build(registry.resolveProps(kind, props), {})
    return path as { kind: string; closed?: boolean; points: Vec2[] }
  }

  it('is one closed shape with its corners rounded by the expression, as large as before', () => {
    const cushion = outline({})
    expect(cushion.closed).toBe(true)
    expect(cushion.points.length).toBeGreaterThan(4)
    const b = bounds(cushion.points)
    close(b.maxX, 500)
    close(b.maxY, 500)
    for (const p of cushion.points.filter((q) => q.x < 60 && q.y < 60)) close(dist(p, { x: 60, y: 60 }), 60)
  })

  it('has its four corners when the radius comes to nothing', () => {
    expect(outline({ soft: 0 }).points).toEqual(square(500))
  })

  it('keeps the ends of a path that does not say it is closed', () => {
    const arch = declarativeExtension({
      format: 'opencalque-extension',
      formatVersion: 1,
      id: 'test.arch',
      name: 'Arch',
      version: '1.0.0',
      objects: [{ kind: 'test.arch', label: 'Arch', params: [], draw: [{ radius: 1000, path: [[0, 0], [50, -30], [100, 0]] }] }],
    })
    const [path] = new Registry().use(arch).parametric.get('test.arch')!.build({}, {}) as { points: Vec2[] }[]
    // Left closed by default, it lost both ends and curled back on itself between them.
    for (const [p, q] of [[path.points[0], { x: 0, y: 0 }], [path.points.at(-1)!, { x: 100, y: 0 }]]) expect(dist(p, q)).toBeLessThan(1e-6)
    expect(path.points.slice(1).every((p, i) => p.x > path.points[i].x)).toBe(true)
  })
})
