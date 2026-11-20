import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, type NodeOf, type Primitive } from '../src'

const registry = new Registry().use(architecture)
const radiator = registry.parametric.get('arch.radiator')!
const drawn = (props: Record<string, unknown> = {}) => radiator.build(registry.resolveProps(radiator, props), {})
type Path = Extract<Primitive, { kind: 'path' }>
/** The lines across its body, between its sections. */
const sections = (prims: Primitive[]) => prims.filter((p): p is Path => p.kind === 'path' && !p.closed && p.strokeWidth !== undefined)
const valve = (prims: Primitive[]) => prims.find((p) => p.kind === 'ellipse') as { cx: number; rx: number }

describe('a radiator', () => {
  it('is in the object library under Heating, against the wall by its back, 80 cm long and 10 cm deep to begin with', () => {
    expect(radiator.category).toBe('heating')
    const body = drawn().find((p): p is Path => p.kind === 'path' && !!p.closed)!
    expect(body.points).toEqual([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 100 }, { x: 0, y: 100 }])
  })

  it('keeps the width of its sections as it is made longer', () => {
    expect(sections(drawn())).toHaveLength(12)
    expect(sections(drawn({ width: 1600 }))).toHaveLength(26)
    const gaps = sections(drawn({ width: 1600 })).map((p) => p.points[0].x)
    expect(gaps[1] - gaps[0]).toBeCloseTo(1600 / 27, 6)
  })

  it('has its valve beside the end it is fed from', () => {
    expect(valve(drawn()).cx).toBeGreaterThan(800)
    expect(valve(drawn({ valve: 'Left' })).cx).toBeLessThan(0)
  })

  it('is made longer or deeper by its frame, never shorter than 20 cm nor shallower than 4 cm', () => {
    const props = registry.resolveProps(radiator, {})
    expect(radiator.box!.resize(props, { width: 1234.4, height: 120 })).toEqual({ width: 1234, depth: 120 })
    expect(radiator.box!.resize(props, { width: 50, height: 10 })).toEqual({ width: 200, depth: 40 })
  })

  it('cannot be made to draw without end', () => {
    expect(sections(drawn({ width: 1e9 })).length).toBeLessThan(200)
    const node = { id: 'r', type: 'parametric', parent: 'page_1', order: 'a0', kind: 'arch.radiator', props: { width: Number.NaN }, x: 0, y: 0, rotation: 0 } as NodeOf<'parametric'>
    expect(() => radiator.build(registry.resolveProps(radiator, node.props), {})).not.toThrow()
  })
})

describe('a fireplace', () => {
  const fireplace = registry.parametric.get('arch.fireplace')!
  const props = (given: Record<string, unknown> = {}) => registry.resolveProps(fireplace, given)
  const closed = (prims: Primitive[]) => prims.filter((p): p is Path => p.kind === 'path' && !!p.closed)
  const ys = (p: Path) => p.points.map((q) => q.y)

  it('stands against the wall by its back, under Heating, a cassette in a breast of 1 m by 50 cm to begin with', () => {
    expect([fireplace.category, fireplace.mount?.on, props().style]).toEqual(['heating', 'floor', 'Cassette'])
    const [breast, cassette] = closed(fireplace.build(props(), {}))
    expect(breast.points).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }])
    // The cassette is in the breast, flush with its front.
    expect(Math.max(...ys(cassette))).toBe(500)
    expect(Math.min(...cassette.points.map((q) => q.x))).toBeGreaterThan(0)
  })

  it('has, as an open hearth, its firebox open to the room and its slab on the floor in front', () => {
    const [masonry, slab] = closed(fireplace.build(props({ style: 'Open hearth' }), {}))
    // The firebox goes into the breast from its front.
    expect(Math.min(...ys(masonry).filter((y) => y > 0))).toBe(125)
    expect([Math.min(...ys(slab)), Math.max(...ys(slab))]).toEqual([500, 900])
    expect(closed(fireplace.build(props({ style: 'Open hearth', hearth: 0 }), {}))).toHaveLength(1)
  })

  it('asks for its hearth only when it is open', () => {
    const shown = (style: string) => fireplace.params.filter((p) => p.shown?.(props({ style })) ?? true).map((p) => p.key)
    expect(shown('Cassette')).not.toContain('hearth')
    expect(shown('Open hearth')).toContain('hearth')
  })

  it('is drawn in elevations as high as its breast, the cassette above the floor, the open hearth under its mantel', () => {
    const top = (prims: Primitive[]) => Math.min(...prims.flatMap((p) => (p.kind === 'path' ? ys(p) : [])))
    expect(top(fireplace.front!(props()))).toBe(-2500)
    expect(top(fireplace.front!(props({ style: 'Open hearth' })))).toBe(-2500)
    expect(top(fireplace.side!(props({ style: 'Open hearth', height: 1000 })))).toBe(-1000)
  })
})
