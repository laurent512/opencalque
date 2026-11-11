import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry } from '../src'

const registry = new Registry().use(architecture)
const window = registry.parametric.get('arch.window')!

describe('a window', () => {
  it('draws a line for each pane of glass: single, double or triple', () => {
    // The glass runs between the two sides of the frame, 50 mm in from each end.
    const panes = (glazing: string) =>
      window.build(registry.resolveProps(window, { width: 1200, panes: 1, sill: 0, glazing }), { wallThickness: 200 }).filter((p) => p.kind === 'path' && p.points.length === 2 && p.points[0].x === 50 && p.points[1].x === 1150).length
    expect([panes('Single'), panes('Double'), panes('Triple')]).toEqual([1, 2, 3])
  })
})

const door = registry.parametric.get('arch.door')!
const extent = (prims: ReturnType<NonNullable<typeof window.front>>) => {
  const points = prims.flatMap((p) => (p.kind === 'path' ? p.points : []))
  return { left: Math.min(...points.map((q) => q.x)), right: Math.max(...points.map((q) => q.x)), top: Math.min(...points.map((q) => q.y)), bottom: Math.max(...points.map((q) => q.y)) }
}

describe('doors and windows seen from in front', () => {
  it('a window stands on its sill height, 900 unless said, as high as it is', () => {
    expect(extent(window.front!(registry.resolveProps(window, {})))).toEqual({ left: 0, right: 1200, top: -2150, bottom: -900 })
    expect(extent(window.front!(registry.resolveProps(window, { sillHeight: 0, height: 2000, width: 800 })))).toEqual({ left: 0, right: 800, top: -2000, bottom: 0 })
    // A line between each pane, inside its frame.
    const lines = (panes: number) => window.front!(registry.resolveProps(window, { panes })).filter((p) => p.kind === 'path' && !p.closed).length
    expect([lines(1), lines(2), lines(3)]).toEqual([0, 1, 2])
  })

  it('a door stands on the floor, its leaves split down the middle when it has two', () => {
    expect(extent(door.front!(registry.resolveProps(door, {})))).toEqual({ left: 0, right: 900, top: -2040, bottom: 0 })
    const middle = (type: string) => door.front!(registry.resolveProps(door, { type })).some((p) => p.kind === 'path' && p.points.every((q) => q.x === 450))
    expect([middle('Single'), middle('Double'), middle('Sliding'), middle('Opening only')]).toEqual([false, true, true, false])
  })

  it('a window with a sill height that is not a number stands at the usual one rather than failing', () => {
    expect(extent(window.front!(registry.resolveProps(window, { sillHeight: 'high' as never }))).bottom).toBe(-900)
  })
})
