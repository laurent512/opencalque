import { describe, expect, it } from 'vitest'
import { applyOps, hostWall, openingFollowOps, splitWallOps, type Document, type NodeOf, type Op } from '../src'
import { houseDoc, registry, wall } from './support/house'

/** A wall 6 m long, 200 thick, from (0, 0) to (6000, 0), with a door 900 wide starting 1 m from its start. */
const plan = houseDoc([wall('w', [0, 0], [6000, 0], 200), { type: 'parametric', id: 'door', kind: 'test.door', props: { width: 900 }, x: 1000, y: 0 }])

/** The drawing after `ops`, with the doors put back in their walls as the editor does it. */
function edited(ops: Op[], doc: Document = plan): Document {
  const next = applyOps(doc, ops)
  const ids = ops.flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
  return applyOps(next, openingFollowOps(doc, next, ids, registry))
}
const door = (doc: Document) => doc.nodes.door as NodeOf<'parametric'>
const where = (doc: Document) => {
  const { x, y, rotation } = door(doc)
  return { x: Math.round(x), y: Math.round(y), rotation: Math.round(rotation ?? 0) }
}

describe('doors and windows follow their wall', () => {
  it('keep their distance from the end that stayed', () => {
    // The start dragged back 1 m: the door keeps 4.1 m from the end, as it stood.
    expect(where(edited([{ op: 'update_node', id: 'w', patch: { a: { x: -1000, y: 0 } } }]))).toEqual({ x: 1000, y: 0, rotation: 0 })
    // The end dragged in: the door keeps its distance from the start.
    expect(where(edited([{ op: 'update_node', id: 'w', patch: { b: { x: 3000, y: 0 } } }]))).toEqual({ x: 1000, y: 0, rotation: 0 })
  })

  it('stay in a wall made shorter than where they were', () => {
    const doc = edited([{ op: 'update_node', id: 'w', patch: { b: { x: 1500, y: 0 } } }])
    // Pushed back so that its 900 mm end at the wall's end.
    expect(where(doc)).toEqual({ x: 600, y: 0, rotation: 0 })
    expect(hostWall(doc, door(doc), registry)?.id).toBe('w')
  })

  it('turn with a wall turned about its start, and move with a wall moved whole', () => {
    // A quarter turn about its start: from (0, 0) down to (0, 6000).
    const turned = edited([{ op: 'update_node', id: 'w', patch: { b: { x: 0, y: 6000 } } }])
    expect(where(turned)).toEqual({ x: 0, y: 1000, rotation: 90 })
    expect(hostWall(turned, door(turned), registry)?.id).toBe('w')
    const moved = edited([{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 2000 }, b: { x: 6000, y: 2000 } } }])
    expect(where(moved)).toEqual({ x: 1000, y: 2000, rotation: 0 })
  })

  it('leave alone what the edit placed itself, a wall turned round, and the other half of a wall split in two', () => {
    const moved: Op[] = [
      { op: 'update_node', id: 'w', patch: { b: { x: 3000, y: 0 } } },
      { op: 'update_node', id: 'door', patch: { x: 2000 } },
    ]
    expect(where(edited(moved))).toEqual({ x: 2000, y: 0, rotation: 0 })
    expect(edited([{ op: 'update_node', id: 'w', patch: { a: { x: 6000, y: 0 }, b: { x: 0, y: 0 } } }]).nodes.door).toBe(plan.nodes.door)
    const split = splitWallOps(plan.nodes.w, { x: 500, y: 0 }, 'w2')!
    const halves = edited(split.ops)
    expect(where(halves)).toEqual({ x: 1000, y: 0, rotation: 0 })
    expect(hostWall(halves, door(halves), registry)?.id).toBe('w2')
  })
})
