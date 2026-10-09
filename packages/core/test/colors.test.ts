import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, colorRef, colorUses, copyNodes, createDocument, parseDocument, pasteNodes, Registry, serializeDocument, toSVG, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const base = applyOps(createDocument(), [
  { op: 'add_color', color: { id: 'brand', name: 'Brand', value: '#ff0000' } },
  add({ type: 'rect', id: 'a', x: 0, y: 0, width: 100, height: 100, style: { stroke: colorRef('brand'), fill: colorRef('brand') } }),
  add({ type: 'line', id: 'b', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, style: { stroke: colorRef('brand') } }),
  add({ type: 'line', id: 'plain', a: { x: 0, y: 50 }, b: { x: 100, y: 50 }, style: { stroke: '#00ff00' } }),
])
const drawn = (doc: Document, id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims[0]

describe('shared colours', () => {
  it('are painted where they are referred to', () => {
    expect(drawn(base, 'a')).toMatchObject({ stroke: '#ff0000', fill: '#ff0000' })
    expect(drawn(base, 'b').stroke).toBe('#ff0000')
    expect(drawn(base, 'plain').stroke).toBe('#00ff00')
    expect(toSVG(base, 'page_1', registry)).not.toContain('var(--')
  })

  it('change everything that refers to them, with one operation and nothing else touched', () => {
    const blue = applyOps(base, [{ op: 'update_color', id: 'brand', patch: { value: '#0000ff' } }])
    expect(drawn(blue, 'a')).toMatchObject({ stroke: '#0000ff', fill: '#0000ff' })
    expect(drawn(blue, 'b').stroke).toBe('#0000ff')
    expect(drawn(blue, 'plain').stroke).toBe('#00ff00')
    // The nodes still hold the reference, not the colour.
    expect(blue.nodes.a).toBe(base.nodes.a)
  })

  it('can colour a layer, and so everything on it', () => {
    const doc = applyOps(base, [
      { op: 'update_layer', id: 'layer_1', patch: { color: colorRef('brand') } },
      add({ type: 'line', id: 'c', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }),
    ])
    expect(drawn(doc, 'c').stroke).toBe('#ff0000')
    expect(colorUses(doc, 'brand')).toBe(3)
  })

  it('leave what used them looking the same when they are removed', () => {
    const removed = applyOps(base, [{ op: 'remove_color', id: 'brand' }])
    expect(removed.colors).toEqual({})
    expect((removed.nodes.a as any).style).toEqual({ stroke: '#ff0000', fill: '#ff0000' })
    expect(drawn(removed, 'b').stroke).toBe('#ff0000')
  })

  it('survive saving and opening, and come along when what uses them is copied to another drawing', () => {
    const reopened = parseDocument(JSON.parse(serializeDocument(base)))
    expect(reopened.colors).toEqual(base.colors)
    const pasted = pasteNodes(createDocument(), copyNodes(base, ['a']), 'page_1', { x: 0, y: 0 }, 'layer_1')
    expect(pasted.doc.colors?.brand).toMatchObject({ name: 'Brand', value: '#ff0000' })
    expect(drawn(pasted.doc, pasted.ids[0]).stroke).toBe('#ff0000')
  })

  it('refuse a colour that does not exist, and draw a missing reference in plain ink', () => {
    expect(() => applyOps(base, [{ op: 'update_color', id: 'nope', patch: { value: '#000000' } }])).toThrow(/Unknown colour/)
    const dangling = applyOps(base, [add({ type: 'line', id: 'd', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, style: { stroke: 'var(--gone)' } })])
    expect(drawn(dangling, 'd').stroke).toBe('#1f1f1f')
  })
})
