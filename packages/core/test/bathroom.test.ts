import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, resizePatch, type NodeOf } from '../src'

const registry = new Registry().use(architecture)
const place = (kind: string, props: Record<string, unknown> = {}) => ({ id: 'w', type: 'parametric', parent: 'page_1', order: 'a0', kind, props, x: 0, y: 0, rotation: 0 }) as NodeOf<'parametric'>
const drawn = (node: NodeOf<'parametric'>) => {
  const kind = registry.parametric.get(node.kind)!
  return kind.build(registry.resolveProps(kind, node.props), {})
}
/** The rims of its bowls: the slope inside each is drawn in a thin line. */
const bowls = (node: NodeOf<'parametric'>) => drawn(node).filter((p) => p.kind === 'ellipse' && p.rx > 20 && p.strokeWidth === undefined) as { cx: number; rx: number; ry: number }[]

describe('a washbasin', () => {
  it('keeps the size of its bowl when its counter is made longer or deeper', () => {
    const single = place('arch.washbasin')
    expect(bowls(single).map((b) => [b.rx, b.ry])).toEqual([[210, 150]])
    // Its right side pulled out to 900 mm, then its front to 600: the bowl stays, in the middle.
    const longer = { ...single, ...resizePatch(single, 5, { x: 900, y: 200 }, false, registry) } as NodeOf<'parametric'>
    expect(longer.props).toMatchObject({ width: 900 })
    expect(bowls(longer).map((b) => [b.cx, b.rx, b.ry])).toEqual([[450, 210, 150]])
    const deeper = { ...longer, ...resizePatch(longer, 6, { x: 450, y: 600 }, false, registry) } as NodeOf<'parametric'>
    expect(deeper.props).toMatchObject({ width: 900, depth: 600 })
    expect(bowls(deeper).map((b) => [b.rx, b.ry])).toEqual([[210, 150]])
  })

  it('has two bowls and two taps when double, each in the middle of its half', () => {
    const double = place('arch.washbasin.double')
    expect(bowls(double).map((b) => b.cx)).toEqual([300, 900])
    expect(drawn(double).filter((p) => p.kind === 'ellipse' && p.rx === 20)).toHaveLength(2)
    expect(bowls(place('arch.washbasin.double', { width: 2000 })).map((b) => [b.cx, b.rx])).toEqual([[500, 210], [1500, 210]])
  })

  it('makes its bowls smaller only when their share of the counter cannot hold them', () => {
    expect(bowls(place('arch.washbasin', { width: 400 }))[0].rx).toBe(160)
  })
})

describe('a bathtub', () => {
  /** Its basin, as the corners of the rectangle its rounded outline fills, and its drain. */
  const parts = (node: NodeOf<'parametric'>) => {
    const [, basin, drain] = drawn(node) as [unknown, { points: { x: number; y: number }[] }, { cx: number; cy: number; rx: number }]
    const xs = basin.points.map((p) => Math.round(p.x))
    const ys = basin.points.map((p) => Math.round(p.y))
    return {
      basin: [
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
      ],
      drain: [drain.cx, drain.cy, drain.rx],
    }
  }

  it('keeps the thickness of its rim and the size of its drain when it is made longer or wider', () => {
    const tub = place('arch.bathtub')
    expect(parts(tub)).toEqual({ basin: [{ x: 60, y: 60 }, { x: 1640, y: 690 }], drain: [200, 375, 25] })
    // Its right side pulled out to 2000 mm, then its front to 900: the rim stays 60, the drain where it was from the end.
    const longer = { ...tub, ...resizePatch(tub, 5, { x: 2000, y: 300 }, false, registry) } as NodeOf<'parametric'>
    expect(longer.props).toMatchObject({ length: 2000 })
    const wider = { ...longer, ...resizePatch(longer, 6, { x: 1000, y: 900 }, false, registry) } as NodeOf<'parametric'>
    expect(wider.props).toMatchObject({ length: 2000, width: 900 })
    expect(parts(wider)).toEqual({ basin: [{ x: 60, y: 60 }, { x: 1940, y: 840 }], drain: [200, 450, 25] })
  })

  it('is not made smaller than 500 mm by its sides, and keeps a basin however thick its rim is typed', () => {
    const tub = place('arch.bathtub')
    expect({ ...tub, ...resizePatch(tub, 5, { x: 100, y: 300 }, false, registry) }.props).toMatchObject({ length: 500 })
    expect(parts(place('arch.bathtub', { rim: 500 })).basin).toEqual([{ x: 350, y: 350 }, { x: 1350, y: 400 }])
  })
})

describe('a parametric object resized from a corner', () => {
  it('keeps its proportions when asked, as a shape does, and only then', () => {
    const desk = place('arch.desk', { width: 1200, depth: 600 })
    const corner = { x: 1800, y: 700 }
    const kept = resizePatch(desk, 2, corner, true, registry)!.props as { width: number; depth: number }
    expect(kept.width).toBeGreaterThan(1200)
    expect(kept.width / kept.depth).toBeCloseTo(2, 3)
    const free = resizePatch(desk, 2, corner, false, registry)!.props as { width: number; depth: number }
    expect(free.width / free.depth).not.toBeCloseTo(2, 3)
    // A side changes one size only, kept or not.
    const side = resizePatch(desk, 5, corner, true, registry)!.props as { width: number; depth: number }
    expect(side.depth).toBe(600)
  })
})
