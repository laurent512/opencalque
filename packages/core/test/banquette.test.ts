import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, type Primitive } from '../src'

const registry = new Registry().use(architecture)
const banquette = registry.parametric.get('arch.banquette')!
const props = (given: Record<string, unknown> = {}) => registry.resolveProps(banquette, given)
type Path = Extract<Primitive, { kind: 'path' }>
const closed = (prims: Primitive[]) => prims.filter((p): p is Path => p.kind === 'path' && !!p.closed)
const ys = (prims: Primitive[]) => prims.flatMap((p) => (p.kind === 'path' ? p.points.map((q) => q.y) : []))
/** Its seat cushions on the plan: the closed shapes that start past its back. */
const seats = (given: Record<string, unknown>) => closed(banquette.build(props(given), {})).filter((p) => Math.min(...p.points.map((q) => q.y)) > 100)

describe('a banquette', () => {
  it('stands against the wall by its back, among the dining furniture, 1.80 m long and 50 cm deep to begin with', () => {
    expect([banquette.category, banquette.mount?.on]).toEqual(['dining', 'floor'])
    const body = closed(banquette.build(props(), {}))[0]
    expect(body.points).toEqual([{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 500 }, { x: 0, y: 500 }])
  })

  it('takes a seat for about every 60 cm of its length, however long it is made', () => {
    expect([seats({}).length, seats({ width: 3000 }).length, seats({ width: 700 }).length]).toEqual([3, 5, 1])
    expect(seats({ width: 1e9 }).length).toBeLessThanOrEqual(30)
  })

  it('has back cushions, a panel or no back, and as high as its back says in elevations', () => {
    const backs = (back: string) => closed(banquette.build(props({ back }), {})).length
    expect([backs('Cushions'), backs('Panel'), backs('None')]).toEqual([7, 4, 4])
    expect(Math.min(...ys(banquette.front!(props())))).toBe(-900)
    expect(Math.min(...ys(banquette.front!(props({ back: 'None' }))))).toBe(-450)
    expect(banquette.height!(props({ back: 'None' }))).toBe(450)
    // Its height is asked only when it has a back.
    const shown = (back: string) => banquette.params.filter((p) => p.shown?.(props({ back })) ?? true).map((p) => p.key)
    expect(shown('None')).not.toContain('height')
  })

  it('shows its base in front: a drawer under each place, or legs', () => {
    const drawn = (base: string) => banquette.front!(props({ base, back: 'None' })).length
    expect(drawn('Drawers') - drawn('Closed')).toBe(3 * 2)
    expect(drawn('Legs')).toBeGreaterThan(drawn('Closed'))
  })

  it('is closed by a panel at the ends it is asked for, its seats between them', () => {
    const ends = (given: string) => banquette.front!(props({ ends: given, back: 'None' })).filter((p) => p.kind === 'path' && Math.min(...p.points.map((q) => q.y)) === -450 && p.points.some((q) => q.x === 0 || q.x === 1800) && p.points.every((q) => q.x <= 40 || q.x >= 1760))
    expect([ends('None').length, ends('Left').length, ends('Both').length]).toEqual([0, 1, 2])
    expect(Math.min(...seats({ ends: 'Both' }).flatMap((p) => p.points.map((q) => q.x)))).toBeGreaterThan(40)
  })
})
