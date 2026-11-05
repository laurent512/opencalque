import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, boundsOf, createDocument, nodePrimitives, Registry, stretchOps, wallAxesBounds, type Document, type Node, type NodeOf, type Op } from '../src'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })

// A room 6.5 × 5.5 m from axis to axis, 6.7 × 5.7 m outside, with a door in its right wall, a
// partition coming up against that wall in a T, and a garden wall carrying on from its top right
// corner, which is not selected.
const plan = applyOps(createDocument(), [
  wall('top', 0, 0, 6500, 0),
  wall('right', 6500, 0, 6500, 5500),
  wall('bottom', 6500, 5500, 0, 5500),
  wall('left', 0, 5500, 0, 0),
  wall('partition', 3000, 3000, 6400, 3000),
  wall('garden', 6500, 0, 9000, 0),
  add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900 }, x: 6500, y: 1000, rotation: 90 }),
  add({ type: 'rect', id: 'table', x: 1000, y: 1000, width: 1200, height: 800 }),
])
const ROOM = ['top', 'right', 'bottom', 'left', 'partition', 'door', 'table']
const nodes = (doc: Document, ids = ROOM) => ids.map((id) => doc.nodes[id])
const box = (doc: Document, ids = ROOM) => boundsOf(nodes(doc, ids).flatMap((node) => nodePrimitives(node, { doc, registry, depth: 0 })))!
const walls = (doc: Document) => nodes(doc, ['top', 'right', 'bottom', 'left']) as NodeOf<'wall'>[]
const stretched = (axis: 'x' | 'y', by: number) => applyOps(plan, stretchOps(plan, nodes(plan), axis, by, registry))
const at = (doc: Document, id: string) => doc.nodes[id] as Node & Record<string, unknown>

describe('stretching a selection', () => {
  it('measures walls from axis to axis as well as outside', () => {
    expect(box(plan)).toMatchObject({ minX: -100, maxX: 6600, minY: -100, maxY: 5600 })
    expect(wallAxesBounds(walls(plan))).toMatchObject({ minX: 0, maxX: 6500, minY: 0, maxY: 5500 })
  })

  it('moves its far side and lengthens what runs across, every wall keeping its thickness and staying joined', () => {
    const doc = stretched('x', 1000)
    expect(box(doc)).toMatchObject({ minX: -100, maxX: 7600 })
    expect(wallAxesBounds(walls(doc))).toMatchObject({ minX: 0, maxX: 7500 })
    expect(at(doc, 'right')).toMatchObject({ a: { x: 7500, y: 0 }, b: { x: 7500, y: 5500 }, thickness: 200 })
    expect(at(doc, 'top')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 7500, y: 0 } })
    expect(at(doc, 'bottom')).toMatchObject({ a: { x: 7500, y: 5500 }, b: { x: 0, y: 5500 } })
    expect(at(doc, 'left')).toEqual(plan.nodes.left)
    // The partition still comes up against the right wall; the garden wall stays joined to the corner.
    expect(at(doc, 'partition')).toMatchObject({ a: { x: 3000, y: 3000 }, b: { x: 7400, y: 3000 } })
    expect(at(doc, 'garden')).toMatchObject({ a: { x: 7500, y: 0 }, b: { x: 9000, y: 0 } })
    // The door goes with its wall; the table, away from the far side, stays.
    expect(at(doc, 'door')).toMatchObject({ x: 7500, y: 1000 })
    expect(at(doc, 'table')).toEqual(plan.nodes.table)
  })

  it('makes it smaller the same way, and works up and down', () => {
    const narrower = stretched('x', -500)
    expect(wallAxesBounds(walls(narrower))).toMatchObject({ minX: 0, maxX: 6000 })
    const lower = stretched('y', -1500)
    expect(wallAxesBounds(walls(lower))).toMatchObject({ minY: 0, maxY: 4000 })
    expect(at(lower, 'bottom')).toMatchObject({ a: { x: 6500, y: 4000 }, b: { x: 0, y: 4000 } })
    // The partition and the door are not along the bottom: they stay.
    expect(at(lower, 'partition')).toEqual(plan.nodes.partition)
    expect(at(lower, 'door')).toEqual(plan.nodes.door)
  })
})
