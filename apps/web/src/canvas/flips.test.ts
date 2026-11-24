import { describe, expect, it } from 'vitest'
import { architecture } from '@opencalque/ext-architecture'
import { applyOps, createDocument, Registry, type Node, type Op } from '@opencalque/core'
import { flipArrowAt, flipArrows, flipPatch } from './flips'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
// A wall of 200 mm along the X axis, a door of 900 in it from x = 600, opening down the screen (+Y).
const plan = (props: Record<string, unknown> = {}, kind = 'arch.door') =>
  applyOps(createDocument(), [
    add({ type: 'wall', id: 'wall', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 }),
    add({ type: 'parametric', id: 'door', kind, props: { width: 900, ...props }, x: 600, y: 0, rotation: 0 }),
  ])
/** A view of 0.1 pixel per millimetre, from the origin. */
const toScreen = (p: { x: number; y: number }) => ({ x: p.x * 0.1, y: p.y * 0.1 })
const arrowsOf = (props: Record<string, unknown> = {}, kind = 'arch.door') => {
  const doc = plan(props, kind)
  return flipArrows(doc, doc.nodes.door, registry, toScreen)
}

describe('flip controls of a door or window', () => {
  it('stand on the side it does not open to: across the wall to open it the other way, along it to change hinge', () => {
    const [side, hinge] = arrowsOf()
    expect(side.what).toBe('side')
    expect(hinge.what).toBe('hinge')
    // Opening down the screen, its controls are above the wall's top face (y = -100 mm, -10 px).
    for (const arrow of [side, hinge]) expect(Math.max(arrow.from.y, arrow.to.y)).toBeLessThan(-10 - 20)
    // Over the middle of the door (x 600..1500 mm: 105 px).
    expect(side.from.x).toBeCloseTo(105)
    expect(side.to.x).toBeCloseTo(105)
    expect(side.to.y).toBeLessThan(side.from.y)
    expect(hinge.from.y).toBeCloseTo(hinge.to.y)
    expect((hinge.from.x + hinge.to.x) / 2).toBeCloseTo(105)
  })

  it('go over to the other side once it opens the other way', () => {
    for (const arrow of arrowsOf({ flip: true })) expect(Math.min(arrow.from.y, arrow.to.y)).toBeGreaterThan(10 + 20)
  })

  it('offer no hinge where it has none to change: a double door, a window', () => {
    expect(arrowsOf({ type: 'Double' }).map((a) => a.what)).toEqual(['side'])
    expect(arrowsOf({}, 'arch.window').map((a) => a.what)).toEqual(['side'])
  })

  it('belong only to what cuts walls', () => {
    const doc = applyOps(createDocument(), [add({ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 })])
    expect(flipArrows(doc, doc.nodes.r, registry, toScreen)).toEqual([])
    expect(flipArrows(doc, undefined, registry, toScreen)).toEqual([])
  })

  it('are found under the pointer, and each changes what it says', () => {
    const arrows = arrowsOf()
    const [side, hinge] = arrows
    const middle = (a: { from: { x: number; y: number }; to: { x: number; y: number } }) => ({ x: (a.from.x + a.to.x) / 2, y: (a.from.y + a.to.y) / 2 })
    expect(flipArrowAt(arrows, middle(side))).toBe('side')
    expect(flipArrowAt(arrows, middle(hinge))).toBe('hinge')
    expect(flipArrowAt(arrows, { x: 300, y: 300 })).toBeNull()
    const door = plan({ hinge: 'Left' }).nodes.door as Node
    expect(flipPatch(door, 'hinge', registry)).toMatchObject({ hinge: 'Right', width: 900 })
    expect(flipPatch(door, 'side', registry)).toMatchObject({ flip: true, hinge: 'Left' })
    expect(flipPatch(plan({ flip: true }).nodes.door as Node, 'side', registry)).toMatchObject({ flip: false })
  })
})
