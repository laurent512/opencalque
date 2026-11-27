import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, roomsAfterEdit, type Document, type Op } from '../src'

/*
 * Rooms added by themselves when walls close a space (`roomsAfterEdit`): the editor puts a room at
 * each spot it gives after an edit, when the person has not turned that off.
 */
const wall = (id: string, a: [number, number], b: [number, number]): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 } as never })
const room = (id: string, x: number, y: number): Op => ({ op: 'add_node', node: { type: 'room', id, parent: 'page_1', name: id, x, y } as never })
/** Three sides of a room of 5 by 3 m, its walls on their lines. */
const open = (): Document => applyOps(createDocument('Plan'), [wall('top', [0, 0], [5000, 0]), wall('right', [5000, 0], [5000, 3000]), wall('bottom', [5000, 3000], [0, 3000])])
const spots = (before: Document, ops: Op[]) => roomsAfterEdit(before, applyOps(before, ops), 'page_1', ops).spots

describe('rooms added when walls close a space', () => {
  it('puts one in the middle of the space the last wall closes', () => {
    expect(spots(open(), [wall('left', [0, 3000], [0, 0])])).toEqual([{ x: 2500, y: 1500 }])
  })

  it('puts none while the walls close nothing, nor for an edit of anything else', () => {
    expect(spots(open(), [wall('more', [6000, 0], [8000, 0])])).toEqual([])
    const closed = applyOps(open(), [wall('left', [0, 3000], [0, 0])])
    expect(spots(closed, [room('r', 2500, 1500)])).toEqual([])
  })

  it('puts one in the part a wall drawn across a room splits off, not in the part the room is in', () => {
    const roomed = applyOps(open(), [wall('left', [0, 3000], [0, 0]), room('r', 1000, 1500)])
    const found = spots(roomed, [wall('across', [2500, 0], [2500, 3000])])
    expect(found).toHaveLength(1)
    expect(found[0].x).toBeGreaterThan(2500)
  })

  it('leaves a space whose room was deleted without one when its walls change', () => {
    const roomless = applyOps(open(), [wall('left', [0, 3000], [0, 0])])
    expect(spots(roomless, [{ op: 'update_node', id: 'right', patch: { a: { x: 5500, y: 0 }, b: { x: 5500, y: 3000 } } }])).toEqual([])
  })

  it('moves a room a wall is drawn over into the larger part of its space, and puts one in the other', () => {
    // The room in the middle; a divider down the middle, a little to the left, covers it.
    const roomed = applyOps(open(), [wall('left', [0, 3000], [0, 0]), room('r', 2500, 1500)])
    const ops: Op[] = [{ op: 'add_node', node: { type: 'divider', id: 'd', parent: 'page_1', a: { x: 2490, y: 0 }, b: { x: 2490, y: 3000 } } as never }]
    const after = applyOps(roomed, ops)
    const { moved, spots: found } = roomsAfterEdit(roomed, after, 'page_1', ops)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ id: 'r' })
    expect(moved[0].x).toBeGreaterThan(2490)
    expect(found).toHaveLength(1)
    expect(found[0].x).toBeLessThan(2490)
  })

  it('puts none in a space smaller than a square metre', () => {
    const closet = applyOps(createDocument('Plan'), [wall('a', [0, 0], [900, 0]), wall('b', [900, 0], [900, 900]), wall('c', [900, 900], [0, 900])])
    expect(spots(closet, [wall('d', [0, 900], [0, 0])])).toEqual([])
  })
})
