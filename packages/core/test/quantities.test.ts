import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, createDocument, dimensionChainOps, quantities, quantitiesCsv, Registry, type Document, type Extension, type NodeInput, type Op } from '../src'

// A stand-in for doors and windows: something that cuts a wall over its width and may have a height.
const openings: Extension = {
  id: 'test.openings',
  name: 'Openings',
  version: '1.0.0',
  activate(api) {
    for (const [kind, label, height] of [['test.door', 'Door', 2000], ['test.window', 'Window', 1200]] as const) {
      api.registerParametric({
        kind,
        label,
        params: [
          { key: 'width', label: 'Width', type: 'number', default: 1000 },
          { key: 'height', label: 'Height', type: 'number', default: height },
        ],
        opening: ({ width }) => ({ from: 0, to: width }),
        build: () => [],
      })
    }
  },
}
const registry = new Registry().use(openings)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })

// A room of 5 × 4 m between wall middle lines, with a door and a window in its top wall.
const room = applyOps(createDocument('Hut'), [
  wall('top', 0, 0, 5000, 0),
  wall('right', 5000, 0, 5000, 4000),
  wall('bottom', 5000, 4000, 0, 4000),
  wall('left', 0, 4000, 0, 0),
  add({ type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 500, y: 0 }),
  add({ type: 'parametric', id: 'window', kind: 'test.window', props: { width: 1500 }, x: 2500, y: 0 }),
  add({ type: 'room', id: 'r', name: 'Living room', x: 2500, y: 2000 }),
])

describe('quantities', () => {
  it('measures rooms and walls, and leaves out what needs a height nobody gave', () => {
    const q = quantities(room, 'page_1', registry)
    // The floor inside the walls: (5 - 0.2) × (4 - 0.2).
    expect(q.rooms).toEqual([{ name: 'Living room', area: 18.24 }])
    expect(q.walls.map((w) => [w.id, w.length, w.footprint, w.openings])).toEqual([
      ['top', 5, 1, 2],
      ['right', 4, 0.8, 0],
      ['bottom', 5, 1, 0],
      ['left', 4, 0.8, 0],
    ])
    expect(q.walls[0]).toMatchObject({ height: null, gross: null, cut: null, net: null, volume: null })
    expect(q.openings).toEqual([
      { kind: 'test.door', label: 'Door', width: 1, height: 2, count: 1 },
      { kind: 'test.window', label: 'Window', width: 1.5, height: 1.2, count: 1 },
    ])
  })

  it('takes doors and windows out of the face of a wall once the page says how high walls stand', () => {
    const tall = applyOps(room, [{ op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } }, { op: 'update_node', id: 'left', patch: { height: 3000 } }])
    const [top, , , left] = quantities(tall, 'page_1', registry).walls
    // 5 × 2.5 = 12.5, less a door of 1 × 2 and a window of 1.5 × 1.2.
    expect(top).toMatchObject({ height: 2.5, gross: 12.5, cut: 3.8, net: 8.7, volume: 1.74 })
    // A wall with a height of its own does not take the page's.
    expect(left).toMatchObject({ height: 3, gross: 12, cut: 0, net: 12 })
  })

  it('writes a table a spreadsheet opens, in the way of the country it is opened in', () => {
    const tall = applyOps(room, [{ op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } }])
    const english = quantitiesCsv(quantities(tall, 'page_1', registry)).replace('﻿', '').split('\r\n')
    expect(english[0]).toBe('Rooms')
    expect(english[2]).toBe('Living room,18.24')
    expect(english).toContain('Total,,18,,,3.6,2,45,3.8,41.2,8.24')
    expect(english).toContain('Door,1,2,1')
    const french = quantitiesCsv(quantities(tall, 'page_1', registry), { separator: ';', decimal: ',' })
    expect(french.startsWith('﻿')).toBe(true)
    expect(french).toContain('Living room;18,24')
    // A name with the separator or a quote in it is quoted.
    const awkward = applyOps(room, [{ op: 'update_node', id: 'r', patch: { name: 'Salon, "ouvert"' } }])
    expect(quantitiesCsv(quantities(awkward, 'page_1', registry))).toContain('"Salon, ""ouvert""",18.24')
  })
})

describe('wall types', () => {
  const typed = applyOps(room, [
    { op: 'add_wall_type', wallType: { id: 'outer', name: 'Outer wall', thickness: 1, fill: '#d6d3d1', layers: [{ name: 'Plaster', thickness: 15 }, { name: 'Brick', thickness: 200 }, { name: 'Insulation', thickness: 120 }] } },
    { op: 'update_node', id: 'top', patch: { wallType: 'outer' } },
    { op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } },
  ])
  const top = (doc: Document) => doc.nodes.top as any

  it('give their thickness to their walls, and keep giving it when they change', () => {
    // The thickness of a type with layers is their sum, whatever was written.
    expect(typed.wallTypes!.outer.thickness).toBe(335)
    expect(top(typed).thickness).toBe(335)
    const thicker = applyOps(typed, [{ op: 'update_wall_type', id: 'outer', patch: { layers: [{ name: 'Brick', thickness: 300 }] } }])
    expect(top(thicker).thickness).toBe(300)
    // A wall given another thickness is an exception to its type: it keeps it, and is marked as one.
    const odd = applyOps(typed, [{ op: 'update_node', id: 'top', patch: { thickness: 50 } }])
    expect(top(odd)).toMatchObject({ thickness: 50, overrides: ['thickness'] })
    expect(top(applyOps(odd, [{ op: 'update_wall_type', id: 'outer', patch: { layers: [{ name: 'Brick', thickness: 300 }] } }])).thickness).toBe(50)
    // Taking the exception away brings the wall back to its type; so does giving it a type again.
    expect(top(applyOps(odd, [{ op: 'update_node', id: 'top', patch: { overrides: null } }])).thickness).toBe(335)
    expect(top(applyOps(odd, [{ op: 'update_node', id: 'top', patch: { wallType: 'outer' } }]))).toMatchObject({ thickness: 335 })
    expect(() => applyOps(room, [{ op: 'update_node', id: 'top', patch: { wallType: 'nope' } }])).toThrow(/Unknown wall type/)
    // Removed, the type leaves its walls as they were.
    const removed = applyOps(typed, [{ op: 'remove_wall_type', id: 'outer' }])
    expect(top(removed)).toMatchObject({ thickness: 335 })
    expect(top(removed).wallType).toBeUndefined()
  })

  it('are drawn with their fill and a line between each layer, cut at openings', () => {
    const prims = buildScene(typed, 'page_1', registry).find((item) => item.id === 'top')!.prims
    expect(prims.filter((p) => p.kind === 'path' && p.closed).every((p) => p.fill === '#d6d3d1')).toBe(true)
    const lines = prims.filter((p) => p.kind === 'path' && !p.closed && p.strokeWidth === 0.5)
    // Two lines between three layers, each in three stretches: either side of the door and of the window.
    expect(lines).toHaveLength(6)
    // They stay inside the wall: 15 and 215 mm in from the face at y = -167.5 (the left of a wall drawn towards +x is up the sheet).
    const levels = [...new Set(lines.map((p) => Math.round(boundsOf([p])!.minY * 10) / 10))].sort((a, b) => a - b)
    expect(levels).toEqual([-152.5, 47.5].map((y) => -y).sort((a, b) => a - b))
  })

  it('define only what they give a value to, and a wall may still say otherwise', () => {
    // A type that is no more than a material and a look: it leaves thickness and height to each wall.
    const doc = applyOps(room, [
      { op: 'add_wall_type', wallType: { id: 'board', name: 'Plasterboard', stroke: '#b91c1c', strokeWidth: 2, height: 2400, layers: [{ name: 'Gypsum board' }] } },
      { op: 'update_node', id: 'top', patch: { wallType: 'board' } },
      { op: 'update_node', id: 'left', patch: { wallType: 'board', height: 1000, style: { stroke: '#000000' } } },
    ])
    expect(doc.wallTypes!.board.thickness).toBeUndefined()
    expect(top(doc).thickness).toBe(200)
    const outline = (id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.find((p) => p.kind === 'path' && p.closed)!
    // The outline follows the type; a wall with a colour of its own keeps it, and still takes the weight.
    expect(outline('top')).toMatchObject({ stroke: '#b91c1c', strokeWidth: 2 })
    expect(outline('left')).toMatchObject({ stroke: '#000000', strokeWidth: 2 })
    expect(outline('right')).toMatchObject({ strokeWidth: 1 })
    // Heights: the type's, unless the wall has its own; a wall of no type has none here.
    const q = quantities(doc, 'page_1', registry)
    expect(q.walls.map((w) => w.height)).toEqual([2.4, null, null, 1])
    expect(q.types[0]).toMatchObject({ name: 'Plasterboard', thickness: null, layers: [{ name: 'Gypsum board', thickness: null, volume: null }] })
  })

  it('are added up in the quantities, layer by layer', () => {
    const q = quantities(typed, 'page_1', registry)
    expect(q.walls[0]).toMatchObject({ type: 'Outer wall', thickness: 335, net: 8.7 })
    expect(q.types).toEqual([
      {
        name: 'Outer wall',
        thickness: 335,
        length: 5,
        net: 8.7,
        // 8.7 m² of a wall 335 mm thick.
        volume: q.walls[0].volume,
        layers: [
          { name: 'Plaster', thickness: 15, area: 8.7, volume: 0.131 },
          { name: 'Brick', thickness: 200, area: 8.7, volume: 1.74 },
          { name: 'Insulation', thickness: 120, area: 8.7, volume: 1.044 },
        ],
      },
    ])
    expect(q.walls[0].volume).toBeCloseTo(2.9145, 2)
    expect(quantitiesCsv(q)).toContain('Outer wall,Brick,200,,8.7,1.74')
  })
})

describe('dimension chains', () => {
  it('measure a wall from end to end through each side of its openings, on the outside', () => {
    const doc = applyOps(room, dimensionChainOps(room, [room.nodes.top as any], registry))
    const group = Object.values(doc.nodes).find((node) => node.type === 'group')!
    const chain = Object.values(doc.nodes).filter((node) => node.type === 'dimension' && node.parent === group.id) as any[]
    // 0 – door – door – window – window – end, then the whole wall beyond.
    expect(chain.map((d) => [d.a.x, d.b.x])).toEqual([[0, 500], [500, 1500], [1500, 2500], [2500, 4000], [4000, 5000], [0, 5000]])
    // The top wall of the room is dimensioned above it (away from the middle of the plan), the whole length further out.
    const above = (d: any) => boundsOf(buildScene(doc, 'page_1', registry).find((item) => item.id === group.id)!.prims)!.minY < 0 && d.offset
    expect(chain.every((d) => Math.sign(above(d)) === Math.sign(chain[0].offset))).toBe(true)
    expect(Math.abs(chain[5].offset)).toBeGreaterThan(Math.abs(chain[0].offset))
    expect(chain[0]).toMatchObject({ extensionGap: 100 })
    // A wall with no opening gets one dimension, and nothing beyond it.
    const plain = applyOps(room, dimensionChainOps(room, [room.nodes.right as any], registry))
    expect(Object.values(plain.nodes).filter((node) => node.type === 'dimension')).toHaveLength(1)
  })
})
