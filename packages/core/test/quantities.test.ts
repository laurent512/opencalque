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
    // Round it, along the faces of its walls: 2 × (4.8 + 3.8).
    expect(q.rooms).toEqual([{ id: 'r', name: 'Living room', area: 18.24, perimeter: 17.2, material: '', materialId: '' }])
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

  it('counts what a component placed on the page holds, once for each placement, at the size it is drawn', () => {
    // The hut drawn as a component, a floor of a building, placed as it is, at twice its size, and stretched twice as wide and turned.
    const inside = (op: Op): Op => (op.op === 'add_node' ? { ...op, node: { ...op.node, parent: 'level' } as NodeInput } : op)
    const built = applyOps(createDocument('Building'), [
      { op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } },
      { op: 'add_node', node: { type: 'component', id: 'level', parent: null, name: 'Level' } as NodeInput },
      ...[
        wall('top', 0, 0, 5000, 0),
        wall('right', 5000, 0, 5000, 4000),
        wall('bottom', 5000, 4000, 0, 4000),
        wall('left', 0, 4000, 0, 0),
        add({ type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 500, y: 0 }),
        add({ type: 'room', id: 'r', name: 'Living room', x: 2500, y: 2000 }),
      ].map(inside),
      add({ type: 'instance', id: 'as-is', component: 'level', x: 0, y: 0 }),
      add({ type: 'instance', id: 'twice', component: 'level', x: 20000, y: 0, scale: 2 }),
      add({ type: 'instance', id: 'wide', component: 'level', x: 0, y: 20000, scaleX: 2, rotation: 90 }),
    ])
    const q = quantities(built, 'page_1', registry)
    expect(q.rooms.map((r) => r.area)).toEqual([18.24, 72.96, 36.48])
    // Stretched twice along the room's 4.8 m side: 2 × (9.6 + 3.8).
    expect(q.rooms.map((r) => r.perimeter)).toEqual([17.2, 34.4, 26.8])
    // Stretched along its own X: its level walls twice as long, as thick as they were; its upright ones as long, twice as thick.
    const [top, , , left] = q.walls.slice(8)
    expect(top).toMatchObject({ length: 10, thickness: 200, gross: 25 })
    expect(left).toMatchObject({ length: 4, thickness: 400 })
    expect(q.walls.slice(4, 8).map((w) => [w.length, w.thickness])).toEqual([[10, 400], [8, 400], [10, 400], [8, 400]])
    // The door: as drawn, twice as wide twice over.
    expect(q.openings.map((o) => [o.width, o.count])).toEqual([[1, 1], [2, 2]])
    // Doors make the building, and have a table of their own: the objects placed leave them out.
    expect(q.objects.map((o) => [o.name, o.count])).toEqual([['Level', 3]])
    // Hidden where it is placed, a component counts for nothing.
    const hidden = applyOps(built, [{ op: 'update_node', id: 'wide', patch: { visible: false } }])
    expect(quantities(hidden, 'page_1', registry).rooms).toHaveLength(2)
  })

  it('writes a table a spreadsheet opens, in the way of the country it is opened in', () => {
    const tall = applyOps(room, [{ op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } }])
    const english = quantitiesCsv(quantities(tall, 'page_1', registry)).replace('﻿', '').split('\r\n')
    expect(english[0]).toBe('Rooms')
    expect(english[1]).toBe('Name,Area (m²),Perimeter (m)')
    expect(english[2]).toBe('Living room,18.24,17.2')
    expect(english).toContain('Total,,18,,,3.6,2,45,3.8,41.2,8.24')
    expect(english).toContain('Door,1,2,1')
    const french = quantitiesCsv(quantities(tall, 'page_1', registry), { separator: ';', decimal: ',' })
    expect(french.startsWith('﻿')).toBe(true)
    expect(french).toContain('Living room;18,24;17,2')
    // A name with the separator or a quote in it is quoted.
    const awkward = applyOps(room, [{ op: 'update_node', id: 'r', patch: { name: 'Salon, "ouvert"' } }])
    expect(quantitiesCsv(quantities(awkward, 'page_1', registry))).toContain('"Salon, ""ouvert""",18.24')
  })
})

describe('walls of a material', () => {
  const made = applyOps(room, [
    { op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#efc7b4' } },
    { op: 'update_node', id: 'top', patch: { material: 'brick' } },
    { op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } },
  ])
  const prims = (id: string) => buildScene(made, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && p.closed)

  it('are drawn in its colour, cut at openings', () => {
    // Three stretches: either side of the door and of the window.
    expect(prims('top').map((p) => p.fill)).toEqual(['#efc7b4', '#efc7b4', '#efc7b4'])
  })

  it('are counted under it, at their thickness', () => {
    const q = quantities(made, 'page_1', registry)
    expect(q.walls.map((w) => w.material)).toEqual(['Brick', '', '', ''])
    expect(q.materials).toContainEqual(expect.objectContaining({ material: 'Brick', thickness: q.walls[0].thickness, length: 5, area: q.walls[0].net }))
    const csv = quantitiesCsv(q)
    expect(csv).toContain(`,Brick,5,${q.walls[0].thickness},`)
    expect(csv).toContain('Walls by material')
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
