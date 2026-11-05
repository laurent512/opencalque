import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, clearanceOps, clearances, createDocument, Registry, type Clearance, type Op } from '../src'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })

// A plan 6 × 4 m between axes, walls of 200 mm, with a partition at 2 m standing against the top
// and bottom walls, a door in the top wall left of it, and a table in the room on the right.
const plan = applyOps(createDocument(), [
  wall('top', 0, 0, 6000, 0),
  wall('right', 6000, 0, 6000, 4000),
  wall('bottom', 6000, 4000, 0, 4000),
  wall('left', 0, 4000, 0, 0),
  wall('partition', 2000, 0, 2000, 4000),
  add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900 }, x: 600, y: 0, rotation: 0 }),
  add({ type: 'rect', id: 'table', x: 3000, y: 1000, width: 1000, height: 800 }),
])
const lengths = (list: Clearance[]) => list.map((c) => Math.round(c.length)).sort((p, q) => p - q)

describe('temporary dimensions', () => {
  it('measure a wall from each face to the wall it faces', () => {
    expect(lengths(clearances(plan, plan.nodes.partition, registry))).toEqual([1800, 3800])
  })

  it('measure a door along its wall to the faces of the walls on either side', () => {
    expect(lengths(clearances(plan, plan.nodes.door, registry))).toEqual([400, 500])
  })

  it('measure any other object from each side of its box', () => {
    expect(lengths(clearances(plan, plan.nodes.table, registry))).toEqual([900, 900, 1900, 2100])
  })

  it('move what they measure when a length is typed, joined walls following', () => {
    const left = clearances(plan, plan.nodes.partition, registry).find((c) => Math.round(c.length) === 1800)!
    const doc = applyOps(plan, clearanceOps(plan, plan.nodes.partition, left, 1500, registry))
    expect(doc.nodes.partition).toMatchObject({ a: { x: 1700, y: 0 }, b: { x: 1700, y: 4000 } })
    expect(lengths(clearances(doc, doc.nodes.partition, registry))).toEqual([1500, 4100])
    const before = clearances(plan, plan.nodes.door, registry).find((c) => Math.round(c.length) === 500)!
    const moved = applyOps(plan, clearanceOps(plan, plan.nodes.door, before, 300, registry))
    expect(moved.nodes.door).toMatchObject({ x: 400, y: 0 })
  })
})
