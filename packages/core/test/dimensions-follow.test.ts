import { describe, expect, it } from 'vitest'
import { applyEdit, applyOps, createDocument, planDimensions, Registry, type Document, type NodeOf, type Op } from '../src'

/*
 * Dimensions follow what they measure, by position (`dimensionFollowOps`, in `applyEdit`): the end
 * of a dimension on a point of a wall, of a door or of anything drawn moves with that point.
 */
const registry = new Registry().use({
  id: 'test.house',
  name: 'House',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({ kind: 'test.door', label: 'Door', params: [], opening: () => ({ from: 0, to: 900 }), build: () => [] })
  },
})

/** A room of 5 by 3 m, its walls 200 thick on their lines, a door 900 wide in the bottom wall from 600 along. */
const house = (more: Record<string, unknown>[] = []): Document =>
  applyOps(
    createDocument('Plan'),
    [
      { type: 'wall', id: 'top', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200 },
      { type: 'wall', id: 'right', a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 }, thickness: 200 },
      { type: 'wall', id: 'bottom', a: { x: 0, y: 3000 }, b: { x: 5000, y: 3000 }, thickness: 200 },
      { type: 'wall', id: 'left', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200 },
      { type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 600, y: 3000 },
      ...more,
    ].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  )
const dim = (id: string, a: [number, number], b: [number, number]) => ({ type: 'dimension', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, offset: -800 })
const ends = (doc: Document, id: string) => {
  const d = doc.nodes[id] as NodeOf<'dimension'>
  return [d.a, d.b]
}

describe('dimensions that follow what they measure', () => {
  it('keep their ends on the corners of a wall moved, and of the walls meeting it', () => {
    const doc = house([dim('overall', [-100, -100], [5100, -100]), dim('loose', [1000, -500], [2000, -500])])
    // The right wall moved 1 m out, the walls meeting it stretched as dragging it does.
    const moved = applyEdit(
      doc,
      [
        { op: 'update_node', id: 'right', patch: { a: { x: 6000, y: 0 }, b: { x: 6000, y: 3000 } } },
        { op: 'update_node', id: 'top', patch: { b: { x: 6000, y: 0 } } },
        { op: 'update_node', id: 'bottom', patch: { b: { x: 6000, y: 3000 } } },
      ],
      registry,
    ).doc
    expect(ends(moved, 'overall')).toEqual([{ x: -100, y: -100 }, { x: 6100, y: -100 }])
    // One on no point of a wall stays where it is.
    expect(ends(moved, 'loose')).toEqual([{ x: 1000, y: -500 }, { x: 2000, y: -500 }])
  })

  it('keep their ends on the sides of a door slid along its wall', () => {
    const doc = house([dim('jambs', [600, 3100], [1500, 3100])])
    const slid = applyEdit(doc, [{ op: 'update_node', id: 'door', patch: { x: 1600 } }], registry).doc
    expect(ends(slid, 'jambs')).toEqual([{ x: 1600, y: 3100 }, { x: 2500, y: 3100 }])
  })

  it('leave a dimension moved in the same edit where the edit puts it', () => {
    const doc = house([dim('overall', [-100, -100], [5100, -100])])
    const both = applyEdit(
      doc,
      [
        { op: 'update_node', id: 'top', patch: { a: { x: 0, y: -1000 }, b: { x: 5000, y: -1000 } } },
        { op: 'update_node', id: 'overall', patch: { offset: -900 } },
      ],
      registry,
    ).doc
    expect(ends(both, 'overall')).toEqual([{ x: -100, y: -100 }, { x: 5100, y: -100 }])
  })
})

describe('the dimensions of a plan', () => {
  const lengths = (list: ReturnType<typeof planDimensions>, where: (d: ReturnType<typeof planDimensions>[number]) => boolean) =>
    list.filter(where).map((d) => Math.round(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)))

  it('give the whole above and on the left, the outer walls piece by piece below and on the right, 800 mm out, on the corners and the sides of the doors', () => {
    const list = planDimensions(house(), 'page_1', registry)
    expect(lengths(list, (d) => d.a.y === -100 && d.b.y === -100)).toEqual([5200])
    expect(list.find((d) => d.a.y === -100)!.offset).toBe(-800)
    expect(lengths(list, (d) => d.a.x === -100 && d.b.x === -100)).toEqual([3200])
    expect(lengths(list, (d) => d.a.y === 3100 && d.b.y === 3100)).toEqual([700, 900, 3600])
    expect(list.filter((d) => d.a.y === 3100).map((d) => d.a.x)).toEqual([-100, 600, 1500])
    expect(lengths(list, (d) => d.a.x === 5100 && d.b.x === 5100)).toEqual([3200])
  })

  it('give a side both rows, the detailed one nearer, or nothing, as asked', () => {
    const list = planDimensions(house(), 'page_1', registry, { bottom: 'both', top: 'none', left: 'none', right: 'none' })
    expect(list.map((d) => d.offset)).toEqual([800, 800, 800, 1400])
  })

  it('follow the walls once put down: their ends are on corners and the sides of doors', () => {
    const doc = applyOps(
      house(),
      planDimensions(house(), 'page_1', registry).map((d, i): Op => ({ op: 'add_node', node: { type: 'dimension', id: `d${i}`, parent: 'page_1', ...d } as never })),
    )
    const slid = applyEdit(doc, [{ op: 'update_node', id: 'door', patch: { x: 1600 } }], registry).doc
    const below = Object.values(slid.nodes).filter((n): n is NodeOf<'dimension'> => n.type === 'dimension' && n.a.y === 3100)
    expect(below.map((d) => [d.a.x, d.b.x]).sort((p, q) => p[0] - q[0])).toEqual([
      [-100, 1600],
      [1600, 2500],
      [2500, 5100],
    ])
  })
})
