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

describe('a sliding door', () => {
  const drawn = (props: Record<string, unknown>) => door.build(registry.resolveProps(door, { width: 800, ...props }), { wallThickness: 200 })
  const boxes = (props: Record<string, unknown>) => drawn(props).filter((p) => p.kind === 'path' && p.closed)
  const solid = (props: Record<string, unknown>) => boxes(props).filter((p) => p.kind === 'path' && !p.dash).map((p) => extent([p]))

  it('hangs in front of the wall, over the opening, and shows dashed where it slides to', () => {
    expect(solid({ type: 'Sliding on wall' })).toEqual([{ left: -50, right: 850, top: 110, bottom: 150 }])
    const goes = (slide: string) => extent(boxes({ type: 'Sliding on wall', slide }).filter((p) => p.kind === 'path' && p.dash))
    expect([goes('Right').left, goes('Left').right]).toEqual([750, 50])
    // On the other side of the wall with the other side.
    expect(solid({ type: 'Sliding on wall', flip: true })[0].bottom).toBe(-110)
  })

  it('parts in two when double, each leaf to its side', () => {
    expect(solid({ type: 'Double sliding on wall' }).map((b) => [b.left, b.right])).toEqual([[-50, 400], [400, 850]])
  })

  it('goes into the wall when it is a pocket door', () => {
    expect(solid({ type: 'Pocket' })).toEqual([{ left: 0, right: 800, top: -20, bottom: 20 }])
  })

  it('has its leaves on two rails in its frame when glazed, two to four of them', () => {
    const leaves = (n: unknown) => solid({ type: 'Sliding', leaves: n })
    expect([leaves(2).length, leaves(3).length, leaves(4).length, leaves(9).length, leaves(1).length]).toEqual([2, 3, 4, 4, 2])
    expect(leaves(2).every((b) => b.left >= 50 && b.right <= 750 && b.top > -100 && b.bottom < 100)).toBe(true)
  })

  it('asks for what moves it: no hinge or angle, which way it slides, how many leaves', () => {
    const shown = (type: string) => door.params.filter((p) => p.shown?.(registry.resolveProps(door, { type })) ?? true).map((p) => p.key)
    expect(shown('Single')).toEqual(['width', 'height', 'type', 'hinge', 'angle', 'flip'])
    expect(shown('Sliding on wall')).toEqual(['width', 'height', 'type', 'slide', 'flip'])
    expect(shown('Double sliding on wall')).toEqual(['width', 'height', 'type', 'flip'])
    expect(shown('Sliding')).toEqual(['width', 'height', 'type', 'leaves', 'flip'])
  })
})

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
    expect([middle('Sliding on wall'), middle('Double sliding on wall'), middle('Pocket')]).toEqual([false, true, false])
  })

  it('a window with a sill height that is not a number stands at the usual one rather than failing', () => {
    expect(extent(window.front!(registry.resolveProps(window, { sillHeight: 'high' as never }))).bottom).toBe(-900)
  })
})
