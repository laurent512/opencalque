import { describe, expect, it } from 'vitest'
import { annotationCurve, applyOps, buildScene, childrenOf, createDocument, duplicatePageOps, fillFields, hitTest, kindOf, movePageOps, pagesOf, Registry, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const prims = (doc: Document, page: string, id: string) => buildScene(doc, page, registry).find((item) => item.id === id)!.prims as any[]

describe('pages', () => {
  const doc = applyOps(createDocument('House'), [
    { op: 'update_node', id: 'page_1', patch: { name: 'Ground floor' } },
    { op: 'add_layer', layer: { id: 'frame', name: 'Frame', shared: true } },
    add({ type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 }),
    add({ type: 'group', id: 'g' }),
    add({ type: 'line', id: 'in', parent: 'g', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }),
    add({ type: 'text', id: 'title', layer: 'frame', x: 0, y: -500, text: 'Sheet {page-number} of {pages}: {page}', size: 200 }),
  ])

  it('are duplicated with everything on them, groups included, right after the original', () => {
    const copy = duplicatePageOps(doc, 'page_1', 'First floor')
    const next = applyOps(doc, [...copy.ops, { op: 'add_node', node: { type: 'page', id: 'last', name: 'Roof' } }])
    expect(pagesOf(next).map((p) => p.name)).toEqual(['Ground floor', 'First floor', 'Roof'])
    const copied = childrenOf(next, copy.id)
    expect(copied.map((n) => n.type).sort()).toEqual(['group', 'wall'])
    // New objects, not the same ones: changing a copy leaves the original alone.
    expect(copied.every((n) => !doc.nodes[n.id])).toBe(true)
    expect(childrenOf(next, copied.find((n) => n.type === 'group')!.id)).toHaveLength(1)
  })

  it('show what is on a shared layer on every page, where it cannot be picked up', () => {
    const copy = duplicatePageOps(doc, 'page_1', 'First floor')
    const next = applyOps(doc, copy.ops)
    // The title was not copied: it shows on the new page because its layer is shared.
    expect(childrenOf(next, copy.id).some((n) => n.type === 'text')).toBe(false)
    const there = buildScene(next, copy.id, registry).find((item) => item.id === 'title')!
    expect(there).toMatchObject({ foreign: true, locked: true })
    expect(hitTest(buildScene(next, copy.id, registry), { x: 300, y: -550 }, 20)).toBeNull()
    expect(hitTest(buildScene(next, 'page_1', registry), { x: 300, y: -550 }, 20)?.id).toBe('title')
    // Unshared, it is only on its own page again.
    const unshared = applyOps(next, [{ op: 'update_layer', id: 'frame', patch: { shared: false } }])
    expect(buildScene(unshared, copy.id, registry).some((item) => item.id === 'title')).toBe(false)
  })

  it('can be reordered', () => {
    const three = applyOps(doc, [
      { op: 'add_node', node: { type: 'page', id: 'p2', name: 'B' } },
      { op: 'add_node', node: { type: 'page', id: 'p3', name: 'C' } },
    ])
    const moved = applyOps(three, movePageOps(three, 'p3', -1))
    expect(pagesOf(moved).map((p) => p.name)).toEqual(['Ground floor', 'C', 'B'])
    expect(movePageOps(three, 'page_1', -1)).toEqual([])
  })

  it('fill in the fields of a text: page name, number and count', () => {
    expect(prims(doc, 'page_1', 'title')[0].text).toBe('Sheet 1 of 1: Ground floor')
    expect(fillFields('{document}, {nothing}', doc, 'page_1')).toBe('House, {nothing}')
    expect(fillFields('{date}', doc, 'page_1')).toBe(new Date().toLocaleDateString())
  })
})

describe('text, leaders and line ends', () => {
  const doc = applyOps(createDocument(), [
    add({ type: 'text', id: 't', x: 0, y: 0, text: 'Kitchen\n\nOak floor', size: 200 }),
    add({ type: 'text', id: 'turned', x: 0, y: 0, text: 'a\nb', size: 200, rotation: 90 }),
    add({ type: 'annotation', id: 'note', a: { x: 0, y: 1000 }, b: { x: 2000, y: 0 }, text: 'First\nSecond', shape: 'elbow' }),
    add({ type: 'line', id: 'arrow', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, endMarker: 'arrow' }),
    add({ type: 'polyline', id: 'path', points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }], startMarker: 'dot', endMarker: 'open-arrow' }),
  ])

  it('writes a text on as many lines as it has, one line height apart', () => {
    const lines = prims(doc, 'page_1', 't')
    expect(lines.map((p) => p.text)).toEqual(['Kitchen', 'Oak floor'])
    // The empty line between them still takes its place.
    expect(lines.map((p) => p.y)).toEqual([0, 500])
    // Turned a quarter, the next line is to the left, not below.
    expect(prims(doc, 'page_1', 'turned').map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [-250, 0]])
  })

  it('draws an elbow leader level from the text, then square to the tip', () => {
    expect(annotationCurve(doc.nodes.note as any)).toEqual([{ x: 0, y: 1000 }, { x: 0, y: 0 }, { x: 2000, y: 0 }])
    const drawn = prims(doc, 'page_1', 'note')
    expect(drawn[0].points).toHaveLength(3)
    expect(drawn.filter((p) => p.kind === 'text').map((p) => p.text)).toEqual(['First', 'Second'])
    // Nothing to pull on in the middle of an elbow.
    expect((kindOf(doc.nodes.note) as any).handles(doc.nodes.note)).toHaveLength(2)
    expect(annotationCurve({ a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, shape: 'elbow' })).toHaveLength(2)
  })

  it('puts arrows and other symbols at the ends of lines that ask for them', () => {
    const arrow = prims(doc, 'page_1', 'arrow')
    expect(arrow).toHaveLength(2)
    // The arrow's point is the end of the line.
    expect(arrow[1]).toMatchObject({ closed: true })
    expect(arrow[1].points[0]).toEqual({ x: 1000, y: 0 })
    expect(prims(doc, 'page_1', 'path').map((p) => p.kind)).toEqual(['path', 'ellipse', 'path'])
    // A plain line draws nothing more than itself.
    expect(prims(applyOps(doc, [add({ type: 'line', id: 'plain', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })]), 'page_1', 'plain')).toHaveLength(1)
  })
})
