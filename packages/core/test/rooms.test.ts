import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, hitTest, moveOps, Registry, roomAt, roomRegions, segmentsInside, toDXF, wallFollowOps, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 200) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
const m2 = (area: number) => Math.round(area / 1e4) / 100

// A 6 × 4 m house (to the middle of its 200 mm walls), with a wall that stops against the top and
// bottom walls at x = 4 m, and a stub that leads nowhere.
const house = applyOps(createDocument(), [
  wall('top', 0, 0, 6000, 0),
  wall('right', 6000, 0, 6000, 4000),
  wall('bottom', 6000, 4000, 0, 4000),
  wall('left', 0, 4000, 0, 0),
  wall('partition', 4000, 0, 4000, 4000, 100),
  wall('stub', 1000, 0, 1000, 1500),
])

describe('rooms', () => {
  it('finds the spaces walls enclose, measured to the inner faces of the walls', () => {
    const regions = roomRegions(house, 'page_1')
    expect(regions).toHaveLength(2)
    // Left: (4000 - 100 - 50) × (4000 - 200). Right: (2000 - 50 - 100) × 3800.
    expect(regions.map((r) => m2(r.area)).sort()).toEqual([m2(3850 * 3800), m2(1850 * 3800)].sort())
  })

  it('tells which room a point is in, and that outside there is none', () => {
    expect(m2(roomAt(house, 'page_1', { x: 2000, y: 2000 })!.area)).toBe(m2(3850 * 3800))
    expect(m2(roomAt(house, 'page_1', { x: 5000, y: 2000 })!.area)).toBe(m2(1850 * 3800))
    expect(roomAt(house, 'page_1', { x: 9000, y: 2000 })).toBeNull()
  })

  it('needs the walls to meet all the way round', () => {
    const open = applyOps(house, [{ op: 'remove_node', id: 'right' }])
    expect(roomAt(open, 'page_1', { x: 5000, y: 2000 })).toBeNull()
    expect(roomAt(open, 'page_1', { x: 2000, y: 2000 })).not.toBeNull()
  })

  it('lets a divider split a space without a wall', () => {
    const split = applyOps(house, [add({ type: 'divider', id: 'd', a: { x: 0, y: 2000 }, b: { x: 4000, y: 2000 } })])
    expect(roomRegions(split, 'page_1')).toHaveLength(3)
    // The divider takes no room: the two halves add up to the whole.
    const halves = [roomAt(split, 'page_1', { x: 2000, y: 1000 })!, roomAt(split, 'page_1', { x: 2000, y: 3000 })!]
    expect(m2(halves[0].area + halves[1].area)).toBe(m2(3850 * 3800))
  })

  it('handles a room that is not a rectangle', () => {
    const ell = applyOps(createDocument(), [wall('a', 0, 0, 4000, 0, 0.001), wall('b', 4000, 0, 4000, 2000, 0.001), wall('c', 4000, 2000, 2000, 2000, 0.001), wall('d', 2000, 2000, 2000, 4000, 0.001), wall('e', 2000, 4000, 0, 4000, 0.001), wall('f', 0, 4000, 0, 0, 0.001)])
    expect(m2(roomAt(ell, 'page_1', { x: 1000, y: 3000 })!.area)).toBe(12)
  })

  const withRoom = (doc: Document) => applyOps(doc, [add({ type: 'room', id: 'living', name: 'Living room', x: 2000, y: 2000 })])
  const drawn = (doc: Document) => buildScene(doc, 'page_1', registry).find((item) => item.id === 'living')!

  it('draws a room node as the floor it is in, with its name and area', () => {
    const item = drawn(withRoom(house))
    const texts = item.prims.filter((p) => p.kind === 'text').map((p: any) => p.text)
    expect(texts).toEqual(['Living room', '14.63 m²'])
    expect(item.bounds).toMatchObject({ minX: 100, minY: 100, maxX: 3950, maxY: 3900 })
  })

  it('follows the walls: moving one changes the room, with nothing stored to update', () => {
    const doc = withRoom(house)
    const d = { x: -1000, y: 0 }
    const moved = applyOps(doc, [...moveOps(doc, doc.nodes.partition, d), ...wallFollowOps(doc, [doc.nodes.partition], d, registry)])
    expect(drawn(moved).bounds).toMatchObject({ minX: 100, maxX: 2950 })
    expect(moved.nodes.living).toEqual(doc.nodes.living)
  })

  it('is picked by its name, not by its floor, so what stands in the room stays clickable', () => {
    const scene = buildScene(withRoom(house), 'page_1', registry)
    expect(hitTest(scene, { x: 2000, y: 1950 }, 20)?.id).toBe('living')
    expect(hitTest(scene, { x: 3000, y: 3000 }, 20)).toBeNull()
  })

  it('shows only its name when its walls no longer close', () => {
    const open = applyOps(withRoom(house), [{ op: 'remove_node', id: 'left' }])
    expect(drawn(open).prims.map((p) => p.kind)).toEqual(['text'])
  })

  it('takes a floor pattern as a modifier, kept to the shape of the room', () => {
    const doc = applyOps(withRoom(house), [{ op: 'update_node', id: 'living', patch: { modifiers: [{ type: 'hatch', frame: { x: 0, y: 0 }, params: { pattern: 'Lines', spacing: 500 } }] } }])
    const lines = drawn(doc).prims.filter((p) => p.kind === 'path' && !p.closed)
    // One line every 500 mm down a floor 3800 mm deep, each clipped to the floor.
    expect(lines.length).toBeGreaterThanOrEqual(7)
    expect(lines.every((p) => p.clip?.length === 1)).toBe(true)
    // In the DXF the lines stop at the walls: none reaches past the inner face at x = 3950.
    const dxf = toDXF(doc, 'page_1', registry).split('\n')
    const xs = dxf.flatMap((line, i) => (dxf[i - 1] === '10' || dxf[i - 1] === '11' ? [Number(line)] : []))
    expect(Math.max(...xs.filter((x) => x < 5000))).toBeLessThanOrEqual(4050)
  })

  it('cuts a segment to the parts inside any outline, hollow corners included', () => {
    const ell = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }]
    // Across the notch at y = 3: only the left arm is inside.
    expect(segmentsInside({ x: -1, y: 3 }, { x: 5, y: 3 }, ell)).toEqual([[{ x: 0, y: 3 }, { x: 2, y: 3 }]])
    // One that starts inside and leaves through a side.
    expect(segmentsInside({ x: 1, y: 1 }, { x: 5, y: 1.5 }, ell)).toEqual([[{ x: 1, y: 1 }, { x: 4, y: 1.375 }]])
    expect(segmentsInside({ x: 5, y: 5 }, { x: 6, y: 6 }, ell)).toEqual([])
  })
})
