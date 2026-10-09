import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, cornerJoin, cornerJoinOps, createDocument, moveCornerOps, Registry, roomAt, splitWallOps, wallEndsAt, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })
// An L: one wall along the top, one down the right, meeting at (4000, 0).
const ell = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('side', 4000, 0, 4000, 3000), wall('apart', 9000, 0, 9000, 3000)])
const corner = { x: 4000, y: 0 }
const outline = (doc: Document, id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims[0] as any
const reach = (doc: Document, id: string) => boundsOf([outline(doc, id)])!
const joined = (join: 'miter' | 'round' | 'bevel' | 'butt', through = 0) => applyOps(ell, cornerJoinOps(wallEndsAt(ell, 'page_1', corner), join, through))

describe('wall corners', () => {
  it('are the wall ends that share a point', () => {
    expect(wallEndsAt(ell, 'page_1', corner).map((e) => `${e.wall.id}.${e.end}`)).toEqual(['top.b', 'side.a'])
    expect(wallEndsAt(ell, 'page_1', { x: 0, y: 0 }).map((e) => e.wall.id)).toEqual(['top'])
    expect(wallEndsAt(ell, 'page_1', { x: 2000, y: 0 })).toEqual([])
  })

  it('move as one: every wall that ends there follows', () => {
    const moved = applyOps(ell, moveCornerOps(ell, 'page_1', corner, { x: 5000, y: -500 }))
    expect((moved.nodes.top as any).b).toEqual({ x: 5000, y: -500 })
    expect((moved.nodes.side as any).a).toEqual({ x: 5000, y: -500 })
    expect(moved.nodes.apart).toBe(ell.nodes.apart)
  })

  it('are mitred to a sharp point unless told otherwise', () => {
    expect(cornerJoin(wallEndsAt(ell, 'page_1', corner))).toBe('miter')
    // The outer corner of the L is the point (4100, -100).
    expect(reach(ell, 'top')).toMatchObject({ maxX: 4100, minY: -100 })
    expect(outline(ell, 'top').points).toContainEqual({ x: 4100, y: -100 })
  })

  it('can be rounded: the outer corner becomes an arc around the joint', () => {
    const doc = joined('round')
    expect(cornerJoin(wallEndsAt(doc, 'page_1', corner))).toBe('round')
    const points: { x: number; y: number }[] = [...outline(doc, 'top').points, ...outline(doc, 'side').points]
    expect(points).not.toContainEqual({ x: 4100, y: -100 })
    // Every point of the outer side is 100 from the joint, where the sharp corner was 141 away.
    const outer = points.filter((p) => p.x > 4000 && p.y < 0)
    expect(outer.length).toBeGreaterThan(3)
    for (const p of outer) expect(Math.hypot(p.x - 4000, p.y)).toBeCloseTo(100, 3)
  })

  it('can be cut off straight', () => {
    const doc = joined('bevel')
    const points = outline(doc, 'top').points
    expect(points).not.toContainEqual({ x: 4100, y: -100 })
    // The cut runs between the two square corners, through their middle.
    expect(points).toContainEqual({ x: 4050, y: -50 })
  })

  it('can let one wall run through while the other stops against it', () => {
    // The top wall passes: it runs on to the far face of the side wall, which stops at its near face.
    const topPasses = joined('butt', 0)
    expect((topPasses.nodes.top as any).joins).toEqual({ b: 'through' })
    expect((topPasses.nodes.side as any).joins).toEqual({ a: 'butt' })
    expect(reach(topPasses, 'top')).toMatchObject({ maxX: 4100, minY: -100, maxY: 100 })
    expect(reach(topPasses, 'side')).toMatchObject({ minY: 100, minX: 3900, maxX: 4100 })
    // The wall that stops shows the line of its end, which the merged painting of walls would otherwise hide.
    const drawn = buildScene(topPasses, 'page_1', registry)
    expect(drawn.find((item) => item.id === 'side')!.prims.map((p: any) => p.closed ?? false)).toEqual([true, false])
    expect(drawn.find((item) => item.id === 'top')!.prims).toHaveLength(1)
    // Swapped, it is the side wall that passes.
    const sidePasses = joined('butt', 1)
    expect(reach(sidePasses, 'side')).toMatchObject({ minY: -100 })
    expect(reach(sidePasses, 'top')).toMatchObject({ maxX: 3900 })
    expect(cornerJoin(wallEndsAt(sidePasses, 'page_1', corner))).toBe('butt')
  })

  it('go back to a mitre, leaving nothing behind on the walls', () => {
    const round = joined('round')
    const back = applyOps(round, cornerJoinOps(wallEndsAt(round, 'page_1', corner), 'miter'))
    expect((back.nodes.top as any).joins).toBeUndefined()
    expect(outline(back, 'top').points).toEqual(outline(ell, 'top').points)
  })

  it('can be added in the middle of a wall, which becomes two', () => {
    const split = splitWallOps(ell.nodes.top, { x: 1500, y: 80 }, 'second')!
    expect(split.at).toEqual({ x: 1500, y: 0 })
    const doc = applyOps(ell, split.ops)
    expect(doc.nodes.top).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 1500, y: 0 } })
    expect(doc.nodes.second).toMatchObject({ a: { x: 1500, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 })
    expect(wallEndsAt(doc, 'page_1', split.at)).toHaveLength(2)
    // Not at an end, where there is a corner already.
    expect(splitWallOps(ell.nodes.top, { x: 0, y: 0 }, 'x')).toBeNull()
  })

  it('do not change the rooms: those are found from the centerlines', () => {
    const room = (doc: Document) => roomAt(applyOps(doc, [wall('w3', 4000, 3000, 0, 3000), wall('w4', 0, 3000, 0, 0)]), 'page_1', { x: 2000, y: 1500 })!.area
    expect(room(joined('round'))).toBe(room(ell))
    expect(room(joined('butt'))).toBe(room(ell))
  })
})
