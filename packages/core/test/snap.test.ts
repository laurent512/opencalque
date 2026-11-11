import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { alignables, alignMove, applyOps, buildScene, createDocument, moveGuides, Registry, snapTo, type Alignable, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const line = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'line', id, a: { x: ax, y: ay }, b: { x: bx, y: by } })
const sceneOf = (ops: Op[]) => buildScene(applyOps(createDocument(), ops), 'page_1', registry)
const near = (p: { x: number; y: number } | undefined, x: number, y: number) => expect(p && Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-6)

describe('snapping a point', () => {
  // A level line, and one crossing it on the slant.
  const cross = sceneOf([line('level', 0, 0, 4000, 0), line('slant', 1000, -1500, 2000, 500)])

  it('takes the end of a line, its middle, and the place where two lines cross', () => {
    expect(snapTo(cross, { x: 30, y: 40 }, 100)).toEqual({ p: { x: 0, y: 0 }, kind: 'point' })
    expect(snapTo(cross, { x: 1980, y: 30 }, 100)).toEqual({ p: { x: 2000, y: 0 }, kind: 'middle' })
    const crossing = snapTo(cross, { x: 1760, y: -20 }, 100)
    expect(crossing?.kind).toBe('crossing')
    near(crossing?.p, 1750, 0)
  })

  it('takes the foot of a perpendicular from where the line being drawn starts', () => {
    const scene = sceneOf([line('level', 0, 0, 4000, 0)])
    const foot = snapTo(scene, { x: 1230, y: 20 }, 100, { from: { x: 1200, y: 900 } })
    expect(foot).toEqual({ p: { x: 1200, y: 0 }, kind: 'perpendicular' })
    // Without a start there is no perpendicular to speak of: the line itself is all there is.
    expect(snapTo(scene, { x: 1230, y: 20 }, 100)).toEqual({ p: { x: 1230, y: 0 }, kind: 'edge' })
  })

  it('falls back on the nearest place on a line, by grid steps along it when the grid is on', () => {
    const scene = sceneOf([line('level', 0, 0, 4000, 0)])
    expect(snapTo(scene, { x: 1234, y: 40 }, 100, { gridded: { x: 1200, y: 0 } })).toEqual({ p: { x: 1200, y: 0 }, kind: 'edge' })
    expect(snapTo(scene, { x: 1234, y: 400 }, 100)).toBeNull()
    expect(snapTo(scene, { x: 30, y: 40 }, 100, { exclude: ['level'] })).toBeNull()
  })

  it('lines up with the points it is given: upright from one and level with another, where both are near', () => {
    // A level line from (0, 0) to (1000, 0), and an upright one from (3000, 2000) to (3000, 4000).
    const scene = sceneOf([line('a', 0, 0, 1000, 0), line('b', 3000, 2000, 3000, 4000)])
    const aligners = [{ x: 0, y: 0 }, { x: 3000, y: 2000 }]
    // Near x = 3000, upright from b, and y = 0, level with a, far from both lines.
    const both = snapTo(scene, { x: 3040, y: 30 }, 100, { aligners })
    expect(both).toMatchObject({ p: { x: 3000, y: 0 }, kind: 'aligned' })
    expect(both?.guides).toHaveLength(2)
    // Not with the points of the drawing it is not given: a full plan would have one lined up almost anywhere.
    expect(snapTo(scene, { x: 3040, y: 30 }, 100)).toBeNull()
    // Level with one point only: along that level, the grid says where.
    expect(snapTo(scene, { x: 2010, y: 1960 }, 100, { aligners, gridded: { x: 2000, y: 2000 } })).toMatchObject({ p: { x: 2000, y: 2000 }, kind: 'aligned' })
    // Level with where the line being drawn starts.
    expect(snapTo(scene, { x: 2010, y: 3030 }, 100, { from: { x: 0, y: 3000 } })).toMatchObject({ p: { x: 2010, y: 3000 }, kind: 'aligned' })
  })

  it('carries a line on past the end it is given, stopping where that meets a line or a level through a point', () => {
    // A line on the slant ending at (1000, 1000), carried on down and to the right; an upright line further on.
    const scene = sceneOf([line('slant', 0, 0, 1000, 1000), line('upright', 3000, 0, 3000, 5000)])
    const extensions = [{ from: { x: 1000, y: 1000 }, dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 } }]
    const on = snapTo(scene, { x: 2030, y: 1970 }, 100, { extensions })
    expect(on?.kind).toBe('extension')
    near(on?.p, 2000, 2000)
    expect(on?.guides).toEqual([[{ x: 1000, y: 1000 }, on!.p]])
    // Where it meets the upright line, that is taken rather than the place on the line.
    const meets = snapTo(scene, { x: 2960, y: 3000 }, 100, { extensions })
    expect(meets?.kind).toBe('extension')
    near(meets?.p, 3000, 3000)
    // And where it is level with a point rested on, with a guide from that point.
    const level = snapTo(scene, { x: 2510, y: 2480 }, 100, { extensions, aligners: [{ x: 0, y: 2500 }] })
    near(level?.p, 2500, 2500)
    expect(level?.guides).toHaveLength(2)
    // Behind its end, or far from its way, nothing.
    expect(snapTo(scene, { x: 500, y: 520 }, 100, { extensions, exclude: ['slant'] })).toBeNull()
    expect(snapTo(scene, { x: 2000, y: 1500 }, 100, { extensions })).toBeNull()
    // Along a level line carried on, by grid steps when the grid is on.
    const flat = sceneOf([line('level', 0, 0, 1000, 0)])
    expect(snapTo(flat, { x: 2034, y: 30 }, 100, { extensions: [{ from: { x: 1000, y: 0 }, dir: { x: 1, y: 0 } }], gridded: { x: 2000, y: 0 } })).toMatchObject({ p: { x: 2000, y: 0 }, kind: 'extension' })
    // A point of the drawing still wins over the line carried on.
    expect(snapTo(scene, { x: 3020, y: 20 }, 100, { extensions })).toEqual({ p: { x: 3000, y: 0 }, kind: 'point' })
  })

  it('takes the centre of a rectangle turned or not, of a circle, and of a closed shape, never of an open one', () => {
    const scene = sceneOf([
      add({ type: 'rect', id: 'box', x: 0, y: 0, width: 2000, height: 1000 }),
      add({ type: 'rect', id: 'turned', x: 5000, y: 0, width: 2000, height: 1000, rotation: 90 }),
      add({ type: 'ellipse', id: 'round', cx: 0, cy: 5000, rx: 500, ry: 500 }),
      // A triangle balances a third of the way up from its base, not halfway.
      add({ type: 'polyline', id: 'triangle', points: [{ x: 3000, y: 6000 }, { x: 6000, y: 6000 }, { x: 4500, y: 3000 }], closed: true }),
      add({ type: 'polyline', id: 'open', points: [{ x: 9000, y: 6000 }, { x: 12000, y: 6000 }, { x: 10500, y: 3000 }] }),
    ])
    expect(snapTo(scene, { x: 1030, y: 520 }, 100)).toEqual({ p: { x: 1000, y: 500 }, kind: 'centre' })
    // Turned a quarter clockwise about its corner, it hangs down to the left of it.
    const turned = snapTo(scene, { x: 4510, y: 990 }, 100)
    expect(turned?.kind).toBe('centre')
    near(turned?.p, 4500, 1000)
    // The centre of a circle is one of its points too, and is called its centre.
    expect(snapTo(scene, { x: 20, y: 5010 }, 100)).toEqual({ p: { x: 0, y: 5000 }, kind: 'centre' })
    const triangle = snapTo(scene, { x: 4520, y: 4980 }, 100)
    expect(triangle?.kind).toBe('centre')
    near(triangle?.p, 4500, 5000)
    expect(snapTo(scene, { x: 10500, y: 5000 }, 100)).toBeNull()
  })

  it('offers no middle along a curve, and none so short that its ends are as near', () => {
    const arc = sceneOf([add({ type: 'ellipse', id: 'arc', cx: 0, cy: 0, rx: 2000, ry: 2000, from: 0, to: 90 })])
    // Part of the way round the arc there are points the curve is drawn through, but each is only a place on the line.
    expect(snapTo(arc, { x: 1420, y: 1420 }, 60)?.kind).toBe('edge')
    expect(snapTo(sceneOf([line('short', 0, 0, 300, 0)]), { x: 150, y: 10 }, 100)?.kind).toBe('edge')
  })

  it('finds the faces of a wall, their corners and its middle line, but not the hatching of a fill', () => {
    const scene = sceneOf([add({ type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, style: { pattern: { kind: 'Lines', spacing: 50 } } })])
    expect(snapTo(scene, { x: 10, y: -95 }, 30)).toEqual({ p: { x: 0, y: -100 }, kind: 'point' })
    expect(snapTo(scene, { x: 2010, y: 5 }, 30)).toEqual({ p: { x: 2000, y: 0 }, kind: 'middle' })
    // Between the middle line and a face there is only hatching, which is not something to snap to.
    expect(snapTo(scene, { x: 1010, y: 50 }, 20)).toBeNull()
    expect(snapTo(scene, { x: 1010, y: 90 }, 20)).toEqual({ p: { x: 1010, y: 100 }, kind: 'edge' })
  })
})

describe('lining up what is moved', () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number, points: { x: number; y: number }[] = []): Alignable => ({ bounds: { minX, minY, maxX, maxY }, points })

  it('brings a side or the middle onto that of another thing, each axis on its own', () => {
    const moving = box(0, 0, 1000, 500)
    const others = [box(3000, 2000, 5000, 3000)]
    // Its left side comes within reach of the other's left side; nothing is near along Y.
    expect(alignMove(moving, others, { x: 2970, y: 700 }, 50)).toEqual({ d: { x: 3000, y: 700 }, x: true, y: false })
    // Middles: (500, 250) moved to (4000, 2500).
    expect(alignMove(moving, others, { x: 3520, y: 2240 }, 50)).toEqual({ d: { x: 3500, y: 2250 }, x: true, y: true })
    expect(alignMove(moving, others, { x: 2800, y: 700 }, 50)).toEqual({ d: { x: 2800, y: 700 }, x: false, y: false })
  })

  it('lines points up with points, not with the sides of boxes', () => {
    const moving = box(0, -100, 2000, 100, [{ x: 0, y: 0 }, { x: 2000, y: 0 }])
    const others = [box(5000, 900, 7000, 1100, [{ x: 5000, y: 1000 }, { x: 7000, y: 1000 }])]
    // The ends of the moved wall come level with the ends of the other, by their middle line.
    expect(alignMove(moving, others, { x: 100, y: 1020 }, 50).d).toEqual({ x: 100, y: 1000 })
  })

  it('spaces it evenly: halfway between two neighbours, or as far from one as that one is from the next', () => {
    const moving = box(0, 0, 1000, 1000)
    const row = [box(0, 5000, 1000, 6000), box(1500, 5000, 2500, 6000)]
    // To the right of a pair 500 apart, level with them: 500 from the second.
    expect(alignMove(moving, row, { x: 3020, y: 5200 }, 50).d.x).toBe(3000)
    expect(moveGuides(moving, row, { x: 3000, y: 5200 }).gaps).toEqual([
      [{ x: 1000, y: 5700 }, { x: 1500, y: 5700 }],
      [{ x: 2500, y: 5700 }, { x: 3000, y: 5700 }],
    ])
    // Between two things 3000 apart, a thing 1000 wide stands 1000 from each.
    const pair = [box(0, 5000, 1000, 6000), box(4000, 5000, 5000, 6000)]
    expect(alignMove(moving, pair, { x: 2030, y: 5200 }, 50).d.x).toBe(2000)
    // Not level with them, it is not in their row.
    expect(alignMove(moving, pair, { x: 2030, y: 0 }, 50).x).toBe(false)
  })

  it('shows a line over everything that shares a side', () => {
    const { lines } = moveGuides(box(0, 0, 700, 500), [box(3000, 2000, 5000, 3000)], { x: 3000, y: 700 })
    expect(lines).toEqual([[{ x: 3000, y: 700 }, { x: 3000, y: 3000 }]])
  })
})

describe('lining up with what is inside a group', () => {
  const arch = new Registry().use(architecture)
  // A room whose walls are grouped together, as those of a traced plan often are, and inside it,
  // outside the group, a washbasin turned with its back (the top of its counter) to the left.
  // The group has too many points to line up by them: only its box, around the whole room.
  const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, parent: 'plan', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })
  const doc = applyOps(createDocument(), [
    add({ type: 'group', id: 'plan' }),
    wall('left', 0, 0, 0, 4000),
    wall('bottom', 0, 4000, 5000, 4000),
    wall('right', 5000, 4000, 5000, 0),
    wall('top', 5000, 0, 0, 0),
    add({ type: 'parametric', id: 'basin', kind: 'arch.washbasin', x: 1000, y: 2500, rotation: 270, props: {} }),
  ])
  const scene = buildScene(doc, 'page_1', arch)

  it('brings the back of a washbasin against the face of a grouped wall', () => {
    const { moving, others } = alignables(scene, doc, arch, new Set(['basin']))
    expect(moving!.bounds.minX).toBeCloseTo(1000)
    // The group, and each of its walls.
    expect(others).toHaveLength(5)
    // Its back brought 20 mm short of the wall's face, at x = 100: it goes against it.
    const fit = alignMove(moving!, others, { x: -880, y: 0 }, 50)
    expect(fit.x).toBe(true)
    expect(fit.d.x).toBeCloseTo(-900)
    // By the group's box alone, all there was to line up with before, the face could not be found.
    expect(alignMove(moving!, others.slice(0, 1), { x: -880, y: 0 }, 50).x).toBe(false)
  })

  it('leaves out what is moved, when it is inside the group', () => {
    // The wall picked in the Structure panel: the group and the other walls stay, with the washbasin.
    expect(alignables(scene, doc, arch, new Set(['left'])).others).toHaveLength(5)
    // The whole group moved: nothing it holds is lined up with.
    expect(alignables(scene, doc, arch, new Set(['plan'])).others).toHaveLength(1)
  })
})
