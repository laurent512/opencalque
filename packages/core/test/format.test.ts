import { describe, expect, it } from 'vitest'
import { viewOps } from './view-nodes'
import { applyOps, checkIntegrity, childrenOf, createDocument, FORMAT_VERSION, isOrderKey, NewerFormatError, parseDocument, readDocument, removeOps, serializeDocument, unknownProperties, type Document, type NodeInput, type Op } from '../src'

/** A drawing as its file holds it, to be spoilt the way a hand, a script or another program might. */
const file = (doc: Document = createDocument('Plan')): any => JSON.parse(serializeDocument(doc))
const wall = (id: string, extra: Record<string, unknown> = {}): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200, ...extra } as any })
/** Whether the drawing can still be worked on: a new node can be put on top of its first page. */
const editable = (doc: Document) => applyOps(doc, [{ op: 'add_node', node: { type: 'line', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } as any }])

describe('drawings from other versions', () => {
  it('keeps what it does not know, at any depth, through reading, editing and saving', () => {
    const raw = file(applyOps(createDocument(), [wall('w')]))
    raw.levels = [{ name: 'Ground floor' }]
    raw.nodes.w.finish = 'plaster'
    raw.nodes.w.style = { stroke: 'red', opacity: 0.5 }
    raw.nodes.w.a.z = 300
    const doc = parseDocument(raw) as any
    expect(doc.levels).toEqual([{ name: 'Ground floor' }])
    const moved = applyOps(doc, [{ op: 'update_node', id: 'w', patch: { thickness: 300 } }]) as any
    expect(moved.nodes.w).toMatchObject({ thickness: 300, finish: 'plaster', style: { stroke: 'red', opacity: 0.5 }, a: { x: 0, y: 0, z: 300 } })
    const again = file(moved)
    expect(again.levels).toEqual([{ name: 'Ground floor' }])
    expect(again.nodes.w.finish).toBe('plaster')
  })

  it('refuses a drawing of a newer format, saying so', () => {
    const raw = { ...file(), version: FORMAT_VERSION + 1 }
    expect(() => parseDocument(raw)).toThrow(NewerFormatError)
    expect(() => parseDocument(raw)).toThrow(/newer version of OpenCalque/)
  })

  it('names a type of node it does not know', () => {
    const raw = file()
    raw.nodes.c = { id: 'c', type: 'column', parent: 'page_1', order: 'a1' }
    expect(() => parseDocument(raw)).toThrow(/node "c" is a "column"/)
  })

  it('says what is wrong with something that is not a drawing', () => {
    expect(() => parseDocument([1, 2])).toThrow(/not a JSON object/)
    expect(() => parseDocument({ ...file(), format: 'svg' })).toThrow(/"format" is "svg"/)
    expect(() => parseDocument({ ...file(), version: 'one' })).toThrow(/"version"/)
  })
})

describe('repairing a drawing', () => {
  it('reads a drawing the app wrote without changing anything', () => {
    const doc = applyOps(createDocument(), [wall('w'), { op: 'add_layer', layer: { name: 'Walls' } }])
    const { doc: read, repairs } = readDocument(file(doc))
    expect(repairs).toEqual([])
    expect(read).toEqual(doc)
  })

  it('takes out what a drawing of this version says of wall types (a development build wrote it), says so, and can be edited and copied', () => {
    const raw = file(applyOps(createDocument(), [wall('w')]))
    raw.nodes.w.wallType = 'gone'
    raw.nodes.w.overrides = ['thickness']
    const { doc, repairs } = readDocument(raw)
    expect(repairs).toHaveLength(1)
    expect(doc.nodes.w).toMatchObject({ thickness: 200 })
    expect(doc.nodes.w).not.toHaveProperty('wallType')
    expect(() => editable(doc)).not.toThrow()
    expect(applyOps(doc, [{ op: 'update_node', id: 'w', patch: { thickness: 300 } }]).nodes.w).toMatchObject({ thickness: 300 })
    expect(applyOps(doc, [{ op: 'add_node', node: { ...doc.nodes.w, id: 'copy' } as NodeInput }]).nodes.copy).toMatchObject({ thickness: 200 })
  })

  it('drops a dimension style that is not there', () => {
    const raw = file()
    raw.nodes.d = { id: 'd', type: 'dimension', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, offset: 300, dimensionStyle: 'gone' }
    const { doc, repairs } = readDocument(raw)
    expect(repairs).toHaveLength(1)
    expect(applyOps(doc, [{ op: 'update_node', id: 'd', patch: { offset: 500 } }]).nodes.d).toMatchObject({ offset: 500 })
  })

  it('gives new order keys, in the same order, where some cannot be sorted between', () => {
    const raw = file()
    raw.nodes.x = { id: 'x', type: 'line', parent: 'page_1', order: 'top', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    raw.nodes.y = { id: 'y', type: 'line', parent: 'page_1', order: 'a5', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    raw.layers.layer_1.order = '1'
    const { doc, repairs } = readDocument(raw)
    expect(repairs).toHaveLength(2)
    expect(childrenOf(doc, 'page_1').map((n) => n.id)).toEqual(['y', 'x'])
    expect(Object.values(doc.nodes).every((n) => isOrderKey(n.order))).toBe(true)
    expect(childrenOf(editable(doc), 'page_1')).toHaveLength(3)
  })

  it('brings back onto the first page what is outside every page, including groups inside each other', () => {
    const raw = file()
    raw.nodes.lost = { id: 'lost', type: 'line', parent: 'nowhere', order: 'a1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    raw.nodes.g1 = { id: 'g1', type: 'group', parent: 'g2', order: 'a1' }
    raw.nodes.g2 = { id: 'g2', type: 'group', parent: 'g1', order: 'a1' }
    raw.nodes.inline = { id: 'inline', type: 'line', parent: 'lost', order: 'a1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
    const { doc, repairs } = readDocument(raw)
    expect(doc.nodes.lost.parent).toBe('page_1')
    expect([doc.nodes.g1.parent, doc.nodes.g2.parent]).toContain('page_1')
    expect(doc.nodes.inline.parent).toBe('page_1')
    expect(repairs.length).toBeGreaterThanOrEqual(3)
    expect(checkIntegrity(doc)).toEqual([])
  })

  it('takes away what can no longer be drawn, and keeps the rest', () => {
    const raw = file()
    raw.layers = {}
    raw.nodes.pic = { id: 'pic', type: 'image', parent: 'page_1', order: 'a1', asset: 'missing', x: 0, y: 0, width: 10, height: 10 }
    raw.nodes.chair = { id: 'chair', type: 'instance', parent: 'page_1', order: 'a2', component: 'missing', x: 0, y: 0 }
    raw.nodes.text = { id: 'text', type: 'text', parent: 'page_1', order: 'a3', layer: 'missing', x: 0, y: 0, text: 'Hall', size: 200 }
    raw.nodes.mismatch = { id: 'other', type: 'text', parent: 'page_1', order: 'a4', x: 0, y: 0, text: 'Hall', size: 200 }
    const { doc, repairs } = readDocument(raw)
    expect(Object.keys(doc.layers)).toHaveLength(1)
    expect(doc.nodes.pic).toBeUndefined()
    expect(doc.nodes.chair).toBeUndefined()
    expect(doc.nodes.text).not.toHaveProperty('layer')
    expect(doc.nodes.mismatch.id).toBe('mismatch')
    expect(repairs).toHaveLength(5)
  })

  it('adds a page to a drawing that has none', () => {
    const raw = file()
    delete raw.nodes.page_1
    raw.nodes.c = { id: 'c', type: 'component', parent: null, order: 'a0', name: 'Chair' }
    const { doc } = readDocument(raw)
    expect(Object.values(doc.nodes).filter((n) => n.type === 'page')).toHaveLength(1)
  })

  it('breaks a component that contains itself', () => {
    const raw = file()
    raw.nodes.A = { id: 'A', type: 'component', parent: null, order: 'a1' }
    raw.nodes.B = { id: 'B', type: 'component', parent: null, order: 'a2' }
    raw.nodes.iA = { id: 'iA', type: 'instance', parent: 'B', order: 'a0', component: 'A', x: 0, y: 0 }
    raw.nodes.iB = { id: 'iB', type: 'instance', parent: 'A', order: 'a0', component: 'B', x: 0, y: 0 }
    const { doc, repairs } = readDocument(raw)
    expect(repairs).toHaveLength(1)
    expect(checkIntegrity(doc)).toEqual([])
  })
})

describe('operations', () => {
  it('refuses an order that cannot be sorted between, and says what to give instead', () => {
    expect(() => applyOps(createDocument(), [wall('w', { order: 'top' })])).toThrow(/not an order key.*leave "order" out/)
    expect(() => applyOps(createDocument(), [{ op: 'add_layer', layer: { name: 'L', order: 'first' } }])).toThrow(/not an order key/)
    expect(() => applyOps(createDocument(), [{ op: 'update_node', id: 'page_1', patch: { order: '2' } }])).toThrow(/not an order key/)
  })

  it('puts each node added without an order on top of its siblings, in a long list too', () => {
    const ops = Array.from({ length: 300 }, (_, i): Op => ({ op: 'add_node', node: { type: 'line', id: `l${i}`, parent: 'page_1', a: { x: i, y: 0 }, b: { x: i, y: 1 } } as any }))
    const doc = applyOps(createDocument(), [...ops.slice(0, 100), { op: 'update_node', id: 'l99', patch: { parent: 'page_1' } }, ...ops.slice(100)])
    expect(childrenOf(doc, 'page_1').map((n) => n.id)).toEqual(ops.map((_, i) => `l${i}`))
  })

  it('removes nodes one after the other: a page that is the last, or a node already taken along, is an error', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { id: 'p2', type: 'page' } as any },
      { op: 'add_node', node: { id: 'g', type: 'group', parent: 'page_1' } as any },
      { op: 'add_node', node: { id: 'in', type: 'line', parent: 'g', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as any },
      { op: 'add_node', node: { id: 'c', type: 'component' } as any },
      { op: 'add_node', node: { id: 'i', type: 'instance', parent: 'p2', component: 'c', x: 0, y: 0 } as any },
    ])
    expect(() => applyOps(doc, [{ op: 'remove_node', id: 'g' }, { op: 'remove_node', id: 'in' }])).toThrow(/Unknown node "in"/)
    expect(() => applyOps(doc, [{ op: 'remove_node', id: 'page_1' }, { op: 'remove_node', id: 'p2' }])).toThrow(/last page/)
    const left = applyOps(doc, [{ op: 'remove_node', id: 'g' }, { op: 'remove_node', id: 'c' }])
    expect(Object.keys(left.nodes).sort()).toEqual(['p2', 'page_1'])
  })

  it('leaves out of a deletion what another node deleted with it takes along, in any order', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { id: 'vl', type: 'component' } as any },
      { op: 'add_node', node: { id: 'vlv', type: 'instance', parent: 'page_1', component: 'vl', x: 0, y: 0 } as any },
      { op: 'add_node', node: { id: 'g', type: 'group', parent: 'page_1' } as any },
      { op: 'add_node', node: { id: 'in', type: 'line', parent: 'g', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as any },
      { op: 'add_node', node: { id: 'out', type: 'line', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as any },
    ])
    expect(removeOps(doc, ['vlv', 'vl', 'in', 'g', 'gone'])).toEqual([
      { op: 'remove_node', id: 'vl' },
      { op: 'remove_node', id: 'g' },
    ])
    const left = applyOps(doc, removeOps(doc, ['vl', 'vlv', 'out']))
    expect(Object.keys(left.nodes).sort()).toEqual(['g', 'in', 'page_1'])
  })

  it('handles twenty thousand objects added and removed in one go in a fraction of a second', () => {
    const ops = Array.from({ length: 20000 }, (_, i): Op => ({ op: 'add_node', node: { type: 'line', parent: 'page_1', a: { x: i, y: 0 }, b: { x: i, y: 1 } } as any }))
    const start = performance.now()
    const doc = applyOps(createDocument(), ops)
    applyOps(doc, Object.keys(doc.nodes).filter((id) => id !== 'page_1').map((id): Op => ({ op: 'remove_node', id })))
    // About 0.15 s on a laptop; it took 40 s when each addition looked through the whole drawing.
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it('tells which properties written in operations mean nothing, and keeps them', () => {
    const doc = applyOps(createDocument(), [wall('w')])
    const ops: Op[] = [
      { op: 'add_node', node: { type: 'wall', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, thickness: 100, hieght: 2500 } as any },
      { op: 'update_node', id: 'w', patch: { style: { colour: 'red' }, height: 2500 } },
      { op: 'add_layer', layer: { name: 'Doors', colour: 'blue' } as any },
      { op: 'add_node', node: { id: 'r', type: 'rect', parent: 'page_1', x: 0, y: 0, width: 10, height: 10 } as any },
      { op: 'update_node', id: 'r', patch: { radius: 5 } },
    ]
    expect(unknownProperties(doc, ops)).toEqual(['new wall: "hieght"', 'wall "w": "style.colour"', 'new layer "Doors": "colour"', 'rect "r": "radius"'])
    expect(unknownProperties(doc, [wall('w2'), { op: 'update_node', id: 'w', patch: { thickness: 300, wallType: null } }])).toEqual([])
  })
})
