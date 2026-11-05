import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, hitTest, moveOps, Registry, roomAt, roomRegions, segmentsInside, toDXF, wallFollowOps, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 200, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, ...extra })
const m2 = (area: number) => Math.round(area / 1e4) / 100

// A 6 × 4 m house (to the middle of its 200 mm walls), with a wall that stops against the top and
// bottom walls at x = 4 m, and a stub that leads nowhere. The stub stands in the left room: the
// floor it stands on, 200 × 1400 mm from the top wall's face to its end, is not the room's.
const STUB = 200 * 1400
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
    // Left: (4000 - 100 - 50) × (4000 - 200), less the stub. Right: (2000 - 50 - 100) × 3800.
    expect(regions.map((r) => m2(r.area)).sort()).toEqual([m2(3850 * 3800 - STUB), m2(1850 * 3800)].sort())
  })

  it('tells which room a point is in, and that outside there is none', () => {
    expect(m2(roomAt(house, 'page_1', { x: 2000, y: 2000 })!.area)).toBe(m2(3850 * 3800 - STUB))
    // On the stub itself, as in any wall, is no room.
    expect(roomAt(house, 'page_1', { x: 1000, y: 800 })).toBeNull()
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
    expect(m2(halves[0].area + halves[1].area)).toBe(m2(3850 * 3800 - STUB))
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
    expect(texts).toEqual(['Living room', '14.35 m²'])
    expect(item.bounds).toMatchObject({ minX: 100, minY: 100, maxX: 3950, maxY: 3900 })
  })

  it('writes its area in square feet, and with a decimal comma, when it says so', () => {
    const area = (patch: Record<string, unknown>) => {
      const doc = applyOps(withRoom(house), [{ op: 'update_node', id: 'living', patch }])
      return drawn(doc).prims.filter((p) => p.kind === 'text').map((p: any) => p.text)[1]
    }
    expect(area({ system: 'imperial' })).toBe('154.46 ft²')
    expect(area({ decimal: ',' })).toBe('14,35 m²')
    expect(area({ system: 'imperial', decimal: ',' })).toBe('154,46 ft²')
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

  it('colours its name with its stroke and its floor with its fill and pattern, the floor keeping no outline', () => {
    const doc = applyOps(withRoom(house), [{ op: 'update_node', id: 'living', patch: { style: { stroke: '#ff0000', fill: '#00ff00', pattern: { kind: 'Tiles' } } } }])
    const prims = drawn(doc).prims
    const floor = prims.find((p) => p.backdrop === 'floor' && !p.texture)!
    expect(floor).toMatchObject({ fill: '#00ff00', stroke: 'none' })
    expect(prims.filter((p) => p.kind === 'text').map((p) => p.stroke)).toEqual(['#ff0000', '#ff0000'])
    expect(prims.some((p) => p.texture && p.clip?.length === 1)).toBe(true)
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

describe('rooms along walls of different thicknesses', () => {
  // A room under two walls in line, 200 then 400 mm thick, closed on the right by a partition that
  // stops against the thicker one just past where they meet: its top is a step, not a slope.
  const plan = applyOps(createDocument(), [
    wall('left', 0, 4000, 0, 0),
    wall('thin', 0, 0, 3000, 0),
    wall('thick', 3000, 0, 6000, 0, 400),
    wall('right', 6000, 0, 6000, 4000),
    wall('bottom', 6000, 4000, 0, 4000),
    wall('stem', 3500, 4000, 3500, 0, 100),
  ])

  it('follows each wall face, with a step where the thickness changes', () => {
    const floor = roomAt(plan, 'page_1', { x: 1500, y: 2000 })!
    expect(m2(floor.area)).toBe(m2(2900 * 3800 + 450 * 3700))
    const has = (x: number, y: number) => floor.outline.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-6)
    expect(has(3000, 100)).toBe(true)
    expect(has(3000, 200)).toBe(true)
  })
})

describe('rooms along walls that butt without sharing a corner', () => {
  // As drawn by hand: two walls in line, 140 and 270 mm thick, ending at the same x with their
  // lines 66 mm apart (their outer faces flush), and a 467 mm wall that stops inside the thicker.
  const plan = applyOps(createDocument(), [
    wall('a', 8737, 2952, 4350, 2952, 140),
    wall('c', 17846, 3018, 8737, 3018, 270),
    wall('b', 8969, 3118, 8969, 8113, 467),
    wall('left', 4350, 8113, 4350, 2952),
    wall('bottom', 8969, 8113, 4350, 8113),
  ])

  it('follows each wall along its own line, with a step between them', () => {
    const floor = roomAt(plan, 'page_1', { x: 6000, y: 5000 })!
    // Under the thin wall the floor starts at its face, y = 3022, all the way to its end.
    const top = floor.outline.filter((p) => p.y < 3100)
    expect(top.length).toBeGreaterThan(0)
    expect(top.every((p) => Math.abs(p.y - 3022) < 1e-6)).toBe(true)
    // To the inner faces: 4450 to 8735.5 across, 3022 to 8013 down, less a sliver under the thicker wall.
    expect(floor.area / 1e6).toBeCloseTo((4285.5 * 4991) / 1e6, 1)
  })
})

describe('rooms at a corner drawn a little short', () => {
  // The top wall starts 50 mm right of the left wall's line, and the left wall stops 20 mm below
  // the top wall's line: their ends are close, at a right angle, without meeting.
  const plan = applyOps(createDocument(), [
    wall('top', 50, 0, 4000, 0),
    wall('right', 4000, 0, 4000, 3000),
    wall('bottom', 4000, 3000, 0, 3000),
    wall('left', 0, 3000, 0, 20),
  ])

  it('has its corner where the two walls would meet, the floor square in it', () => {
    const floor = roomAt(plan, 'page_1', { x: 2000, y: 1500 })!
    expect(floor.outline.every((p) => p.x > 100 - 1e-6 && p.x < 3900 + 1e-6 && p.y > 100 - 1e-6 && p.y < 2900 + 1e-6)).toBe(true)
    expect(m2(floor.area)).toBe(m2(3800 * 2800))
  })
})

describe('rooms where a thick wall stops close to the end of another', () => {
  // As drawn in a real plan: a 100 mm wall drawn by its top face ends at x = 8736; a 467 mm wall,
  // drawn by its middle, stops on that wall's top 233 mm further on; a 200 mm wall drawn by its
  // left face comes up under the first one's end. The thick wall's end is on the first wall's own
  // side, not a corner of its end.
  const plan = applyOps(createDocument(), [
    wall('top', 11136, 5842, 8736, 5842, 100, { justify: 'right' }),
    wall('thick', 8969, 4542, 8969, 5842, 467),
    wall('left', 8735, 6982, 8736, 5942, 200, { justify: 'left' }),
    wall('right', 11136, 5842, 11136, 6982),
    wall('bottom', 11136, 6982, 8735, 6982),
  ])

  it('runs along the first wall\'s face all the way to the corner', () => {
    const floor = roomAt(plan, 'page_1', { x: 10000, y: 6500 })!
    // Nothing of the floor goes up past that face, at y = 5942.
    expect(Math.min(...floor.outline.map((p) => p.y))).toBeCloseTo(5942, 0)
  })
})
