import { describe, expect, it } from 'vitest'
import electrical from '../../warehouse/extensions/electrical.json'
import { declarativeExtension, Registry, type Primitive } from '../src'

/* The electrical symbols that ship with the app (packages/warehouse/extensions/electrical.json), drawn in plan and from in front. */
const registry = new Registry().use(declarativeExtension(electrical))
const socket = registry.parametric.get('elec.socket')!
const props = (given: Record<string, unknown>) => registry.resolveProps(socket, given)
const arcs = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.points.length > 2)
/** The middles of the plates seen from in front: the boxes, closed and rounded. */
const plates = (prims: Primitive[]) =>
  prims
    .filter((p) => p.kind === 'path' && p.closed)
    .map((p) => {
      const points = (p as Extract<Primitive, { kind: 'path' }>).points
      const xs = points.map((q) => q.x)
      const ys = points.map((q) => q.y)
      return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) }
    })

describe('sockets', () => {
  it('side by side, as they always were: one symbol each, 240 apart, and their plates in a row', () => {
    expect(arcs(socket.build(props({ count: 3 }), {}))).toHaveLength(3)
    expect(socket.build(props({ count: 2 }), {})).toEqual(socket.build(props({ count: 2, layout: 'Side by side' }), {}))
    expect(plates(socket.front!(props({ count: 2 })))).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
    ])
  })

  it('stacked: one symbol in plan with a half circle for each, and their plates one above the other, the first at its height', () => {
    const plan = socket.build(props({ count: 3, layout: 'Stacked' }), {})
    expect(arcs(plan)).toHaveLength(3)
    // All on the one place along the wall.
    expect(plan.every((p) => p.kind !== 'path' || p.points.every((q) => Math.abs(q.x) <= 160))).toBe(true)
    expect(plates(socket.front!(props({ count: 3, layout: 'Stacked' })))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -80 },
      { x: 0, y: -160 },
    ])
  })

  it('stacked, draws no more than six rings however many it is said to hold', () => {
    expect(arcs(socket.build(props({ count: 50, layout: 'Stacked' }), {}))).toHaveLength(6)
  })

  it('is fixed on walls at 300, a switch at 1100 standing out the other way, a wall light at 1800, a ceiling light on none', () => {
    expect(socket.mount).toEqual({ on: 'wall', height: 300 })
    expect(registry.parametric.get('elec.switch')!.mount).toEqual({ on: 'wall', back: 60, out: 'up', height: 1100 })
    expect(registry.parametric.get('elec.walllight')!.mount).toMatchObject({ height: 1800 })
    expect(registry.parametric.get('elec.light')!.mount).toBeUndefined()
  })

  it('says its arrangement in every language the extension speaks', () => {
    for (const texts of Object.values(electrical.translations as Record<string, Record<string, string>>)) {
      for (const word of ['Arrangement', 'Side by side', 'Stacked']) expect(texts[word]).toBeTruthy()
    }
  })
})

describe('the electrical symbols', () => {
  it('all draw with their usual parameters, and those fixed on walls draw a front for elevations', () => {
    expect(registry.parametric.size).toBe(17)
    for (const kind of registry.parametric.values()) {
      const usual = registry.resolveProps(kind, {})
      expect(kind.build(usual, {}).length, kind.kind).toBeGreaterThan(0)
      if (kind.mount) expect(kind.front?.(usual).length, kind.kind).toBeGreaterThan(0)
      expect(kind.category).toBe('electrical')
    }
  })

  it('a switch of two circuits has two strokes on its lever and two rockers seen from in front', () => {
    const switchKind = registry.parametric.get('elec.switch')!
    const one = registry.resolveProps(switchKind, {})
    const two = registry.resolveProps(switchKind, { double: true })
    expect(switchKind.build(two, {}).length).toBe(switchKind.build(one, {}).length + 1)
    expect(switchKind.front!(two).filter((p) => p.kind === 'path' && p.closed).length).toBe(3)
  })

  it('the 32 A socket fills the half disc it ends in', () => {
    const big = registry.parametric.get('elec.socket32')!
    expect(big.build({}, {})).toContainEqual(expect.objectContaining({ kind: 'path', closed: true, fill: 'stroke' }))
  })

  it('a radiator is as long as it is pulled, its sections 100 apart, in plan and from in front', () => {
    const radiator = registry.parametric.get('elec.radiator')!
    expect(radiator.size).toEqual({ x: 'length' })
    expect(radiator.build({ length: 1000 }, {})).toHaveLength(10)
    expect(radiator.front!({ length: 600 })).toHaveLength(6)
  })
})
