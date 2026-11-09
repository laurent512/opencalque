import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, inverseTransform, Registry, type Op, type SceneItem, type Vec2 } from '@opencalque/core'
import { surroundings } from './surroundings'

// On the page, a wall line and a kitchen group, which holds a counter and a placement of a sink,
// turned and doubled; the sink holds a rim and a basin group with a drain.
const doc = applyOps(createDocument(), [
  { op: 'add_node', node: { type: 'line', id: 'beside', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } } },
  { op: 'add_node', node: { type: 'group', id: 'kitchen', parent: 'page_1' } },
  { op: 'add_node', node: { type: 'line', id: 'counter', parent: 'kitchen', a: { x: 0, y: 600 }, b: { x: 2400, y: 600 } } },
  { op: 'add_node', node: { type: 'component', id: 'sink' } },
  { op: 'add_node', node: { type: 'instance', id: 'sink_1', parent: 'kitchen', component: 'sink', x: 1000, y: 500, rotation: 90, scale: 2 } },
  { op: 'add_node', node: { type: 'line', id: 'rim', parent: 'sink', a: { x: 0, y: 0 }, b: { x: 500, y: 0 } } },
  { op: 'add_node', node: { type: 'group', id: 'basin', parent: 'sink' } },
  { op: 'add_node', node: { type: 'line', id: 'drain', parent: 'basin', a: { x: 200, y: 100 }, b: { x: 300, y: 100 } } },
] as Op[])
const registry = new Registry()
const faded = { groups: 'faded', components: 'faded' } as const
const ids = (items: SceneItem[]) => items.map((item) => item.id)
const pathPoints = (item: SceneItem): Vec2[] => item.prims.flatMap((prim) => (prim.kind === 'path' ? prim.points : []))

describe('what is shown around what is being edited', () => {
  it('is the rest of the page around a group gone into, as it is', () => {
    const around = surroundings(doc, 'page_1', 'kitchen', [], registry, faded)
    expect(ids(around)).toEqual(['beside'])
    expect(around[0].node).toBe(doc.nodes.beside)
    // Gone into from the Structure list: the same.
    expect(ids(surroundings(doc, 'page_1', 'kitchen', null, registry, faded))).toEqual(['beside'])
  })

  it('is nothing on the page, nor around a group shown alone', () => {
    expect(surroundings(doc, 'page_1', 'page_1', [], registry, faded)).toEqual([])
    expect(surroundings(doc, 'page_1', 'kitchen', [], registry, { groups: 'alone', components: 'faded' })).toEqual([])
  })

  it('is placed back into a component gone into by a placement, outermost first', () => {
    const around = surroundings(doc, 'page_1', 'sink', ['sink_1'], registry, faded)
    expect(ids(around)).toEqual(['around:beside', 'around:counter'])
    const placement = doc.nodes.sink_1 as never
    expect(pathPoints(around[0])[1].x).toBeCloseTo(inverseTransform({ x: 1000, y: 0 }, placement).x, 9)
    expect(pathPoints(around[0])[1].y).toBeCloseTo(inverseTransform({ x: 1000, y: 0 }, placement).y, 9)
    // Snapped to by what it draws: it stands for no node of the component.
    expect(around[0].node.type).toBe('group')
  })

  it('stops at a component shown alone, opened without a placement, or placed stretched and turned', () => {
    expect(surroundings(doc, 'page_1', 'sink', ['sink_1'], registry, { groups: 'faded', components: 'alone' })).toEqual([])
    expect(surroundings(doc, 'page_1', 'sink', null, registry, faded)).toEqual([])
    const stretched = applyOps(doc, [{ op: 'update_node', id: 'sink_1', patch: { scaleX: 1.5, rotation: 30 } }] as Op[])
    expect(surroundings(stretched, 'page_1', 'sink', ['sink_1'], registry, faded)).toEqual([])
  })

  it('around a group inside a component, goes out as far as each place lets it', () => {
    // The rest of the component, as it is, then what is around its placement.
    expect(ids(surroundings(doc, 'page_1', 'basin', ['sink_1'], registry, faded))).toEqual(['around:beside', 'around:counter', 'rim'])
    expect(ids(surroundings(doc, 'page_1', 'basin', ['sink_1'], registry, { groups: 'faded', components: 'alone' }))).toEqual(['rim'])
  })
})
