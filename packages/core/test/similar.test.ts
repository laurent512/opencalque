import { describe, expect, it } from 'vitest'
import { alikeTo, applyOps, type Likeness, type Node, type Op } from '../src'
import { houseDoc, registry, wall } from './support/house'

/** Walls of brick 200 and 300 and of no material, two floors of oak and one of none, two chairs and a table, two radiators of two lengths and a third of the first, a rectangle on each of two layers. */
const doc = applyOps(houseDoc([]), [
  { op: 'add_material', material: { id: 'oak', name: 'Oak', fill: '#d9b98c' } },
  { op: 'add_layer', layer: { id: 'layer_2', name: 'Layer 2' } },
  ...[
    wall('b1', [0, 0], [5000, 0], 200, 'brick'),
    wall('b2', [5000, 0], [5000, 4000], 200, 'brick'),
    wall('b3', [5000, 4000], [0, 4000], 300, 'brick'),
    wall('d1', [0, 4000], [0, 0], 200),
    { type: 'room', id: 'r1', x: 1000, y: 1000, material: 'oak' },
    { type: 'room', id: 'r2', x: 3000, y: 1000, material: 'oak' },
    { type: 'room', id: 'r3', x: 3000, y: 3000 },
    { type: 'parametric', id: 'p1', kind: 'test.lamp', props: {}, x: 100, y: 100 },
    { type: 'parametric', id: 'p2', kind: 'test.door', props: { width: 800 }, x: 200, y: 100 },
    { type: 'parametric', id: 'p3', kind: 'test.door', props: { width: 900 }, x: 300, y: 100 },
    { type: 'parametric', id: 'p4', kind: 'test.door', props: { width: 800 }, x: 400, y: 100 },
    { type: 'rect', id: 's1', layer: 'layer_1', x: 0, y: 0, width: 10, height: 10 },
    { type: 'rect', id: 's2', layer: 'layer_2', x: 0, y: 0, width: 10, height: 10 },
    { type: 'rect', id: 's3', layer: 'layer_1', x: 0, y: 0, width: 10, height: 10, style: { fill: '#ff0000' } },
  ].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
])

const nodes = Object.values(doc.nodes).filter((node) => node.parent === 'page_1')
const alike = (ids: string[], by: Likeness) =>
  alikeTo(
    ids.map((id) => doc.nodes[id]),
    nodes,
    by,
    registry,
  )
    .map((node: Node) => node.id)
    .sort()

describe('selecting what is alike', () => {
  it('finds walls of one material and thickness, floors of one material, objects of one model', () => {
    expect(alike(['b1'], 'similar')).toEqual(['b1', 'b2'])
    expect(alike(['r1'], 'similar')).toEqual(['r1', 'r2'])
    expect(alike(['p2'], 'similar')).toEqual(['p2', 'p4'])
    // A plain shape is alike to those of its type, on its layer, with its look.
    expect(alike(['s1'], 'similar')).toEqual(['s1'])
  })

  it('finds by type, by layer, by material', () => {
    expect(alike(['p2'], 'type')).toEqual(['p2', 'p3', 'p4'])
    expect(alike(['s1'], 'type')).toEqual(['s1', 's2', 's3'])
    expect(alike(['s1'], 'layer')).toEqual(['s1', 's3'])
    expect(alike(['b1'], 'material')).toEqual(['b1', 'b2', 'b3'])
    // The default material is one too; a floor of none is alike to nothing by material.
    expect(alike(['d1'], 'material')).toEqual(['d1'])
    expect(alike(['r3'], 'material')).toEqual([])
  })

  it('adds up what is alike to each of several', () => {
    expect(alike(['b3', 'r1'], 'similar')).toEqual(['b3', 'r1', 'r2'])
  })
})
