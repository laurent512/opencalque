import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry } from '../src'

const registry = new Registry().use(architecture)
const window = registry.parametric.get('arch.window')!

describe('a window', () => {
  // Without a sill, drawn last, so that what an opened window adds is at the end.
  const plan = (props: Record<string, unknown>) => window.build(registry.resolveProps(window, { width: 1200, sill: 0, ...props }), { wallThickness: 200 })
  const solids = (props: Record<string, unknown>) => window.solids!(registry.resolveProps(window, { width: 1200, ...props }), { wallThickness: 200 })
  const shown = (props: Record<string, unknown>) => window.params.filter((p) => p.shown?.(registry.resolveProps(window, props)) ?? true).map((p) => p.key)

  it('opens on hinges unless said, shut as windows were always drawn', () => {
    expect(registry.resolveProps(window, {})).toMatchObject({ type: 'Casement', angle: 0 })
    expect(plan({})).toEqual(plan({ type: 'Casement', angle: 0 }))
    expect(plan({ type: 'Fixed' })).toEqual(plan({}))
  })

  it('swings its leaves inside by their angle, in pairs from where they meet, with the arc each goes along', () => {
    const swing = plan({ angle: 90 }).slice(plan({}).length)
    // A leaf and its arc for each of the two panes.
    expect(swing).toHaveLength(4)
    const leaves = swing.filter((_, i) => i % 2 === 0).map((p) => (p.kind === 'path' ? p.points : []))
    // Hinged at each jamb, on the inner side of the frame (35 mm into +Y), turned square into the room.
    expect(leaves.map(([hinge, tip]) => [hinge.x, hinge.y, Math.round(tip.x), Math.round(tip.y)])).toEqual([
      [50, 35, 50, 585],
      [1150, 35, 1150, 585],
    ])
    // On the other side with the other side.
    expect(plan({ angle: 90, flip: true }).slice(plan({ flip: true }).length).every((p) => p.kind === 'path' && p.points.every((q) => q.y <= 0))).toBe(true)
  })

  it('hinges the pane left over, of an odd number, on the side chosen', () => {
    const hinges = (hinge: string) => plan({ panes: 1, angle: 45, hinge }).slice(plan({ panes: 1 }).length).filter((_, i) => i === 0).map((p) => (p.kind === 'path' ? p.points[0].x : NaN))
    expect([hinges('Left'), hinges('Right')]).toEqual([[50], [1150]])
    expect(shown({ panes: 1 })).toContain('hinge')
    expect(shown({ panes: 2 })).not.toContain('hinge')
    expect(shown({ type: 'Fixed', panes: 1 })).not.toContain('angle')
  })

  it('has its panes as leaves on two rails when sliding, the first slid over the next as far as opened', () => {
    const leaves = (props: Record<string, unknown>) =>
      plan({ type: 'Sliding', ...props }).filter((p) => p.kind === 'path' && p.closed).map((p) => extent([p]))
    expect(leaves({}).length).toBe(2)
    expect(leaves({ panes: 3 }).length).toBe(3)
    expect(leaves({ opened: 100 })[0].left).toBe(leaves({})[1].left)
    expect(shown({ type: 'Sliding' })).toContain('opened')
    expect(shown({ type: 'Sliding' })).not.toContain('angle')
    // Seen from in front, a line between its leaves.
    expect(window.front!(registry.resolveProps(window, { type: 'Sliding', panes: 1 })).filter((p) => p.kind === 'path' && !p.closed)).toHaveLength(1)
  })

  it('slides its last leaf to the left over the one before it, when it slides to the left', () => {
    const leaves = (props: Record<string, unknown>) =>
      plan({ type: 'Sliding', ...props }).filter((p) => p.kind === 'path' && p.closed).map((p) => extent([p]))
    expect(shown({ type: 'Sliding' })).toContain('slide')
    expect(shown({})).not.toContain('slide')
    // Shut, it makes no difference; fully open, the right leaf lies over the left one, which stays.
    expect(leaves({ slide: 'Left' })).toEqual(leaves({}))
    const open = leaves({ opened: 100, slide: 'Left' })
    expect(open[0]).toEqual(leaves({})[0])
    expect(open[1].left).toBe(leaves({})[0].left)
    expect(open[1].right).toBe(leaves({})[0].right)
    // So in 3D: its right leaf has moved, its left one not.
    const panes = (props: Record<string, unknown>) => solids({ type: 'Sliding', ...props }).filter((s) => s.finish === 'glass').map((s) => Math.round(Math.min(...s.outline.map((q) => q.x))))
    expect(Math.min(...panes({ opened: 100, slide: 'Left' }))).toBe(Math.min(...panes({})))
    expect(panes({ opened: 100, slide: 'Left' })).not.toEqual(panes({}))
  })

  it('in 3D, has a handle on each leaf unless fixed, and its leaves swung by their angle', () => {
    const handles = (props: Record<string, unknown>) => solids(props).filter((s) => s.finish === 'metal').length
    expect([handles({}), handles({ type: 'Tilt and turn' }), handles({ type: 'Fixed' }), handles({ type: 'Sliding' })]).toEqual([2, 2, 0, 2])
    const inward = (props: Record<string, unknown>) => Math.max(...solids(props).flatMap((s) => s.outline.map((q) => q.y)))
    expect(inward({})).toBeLessThan(100)
    expect(inward({ angle: 90 })).toBeGreaterThan(500)
  })

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
    // Opened, its first leaf slides over the next, all the way at 100 per cent.
    const first = (opened: number) => solid({ type: 'Sliding', opened })[0].left
    expect(first(100)).toBe(solid({ type: 'Sliding' })[1].left)
    expect(first(50)).toBeCloseTo((first(0) + first(100)) / 2)
  })

  it('asks for what moves it: no hinge or angle, which way it slides, how many leaves', () => {
    const shown = (type: string) => door.params.filter((p) => p.shown?.(registry.resolveProps(door, { type })) ?? true).map((p) => p.key)
    expect(shown('Single')).toEqual(['width', 'height', 'sillHeight', 'type', 'hinge', 'angle', 'flip'])
    expect(shown('Sliding on wall')).toEqual(['width', 'height', 'sillHeight', 'type', 'slide', 'flip'])
    expect(shown('Double sliding on wall')).toEqual(['width', 'height', 'sillHeight', 'type', 'flip'])
    expect(shown('Sliding')).toEqual(['width', 'height', 'sillHeight', 'type', 'leaves', 'opened', 'slide', 'flip'])
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
