import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, createDocument, Registry, titleBlockValues, type Document, type NodeInput, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
// An A3 lying at 1:50, on a page called "Level 0" of a drawing called "House".
const sheet = (titleBlock: Record<string, unknown> = {}) => add({ type: 'paper', id: 'sheet', name: 'Ground floor', x: 0, y: 0, width: 21000, height: 14850, scale: 50, titleBlock })
const drawing = (ops: Op[]) => applyOps(createDocument('House'), [{ op: 'update_node', id: 'page_1', patch: { name: 'Level 0' } }, ...ops])

const prims = (doc: Document) => buildScene(doc, 'page_1', registry).find((item) => item.id === 'sheet')!.prims
const texts = (doc: Document) => prims(doc).flatMap((p) => (p.kind === 'text' ? [p.text] : []))
/** How tall the block is on the printed sheet, in mm: its box is the second closed outline, after the border. */
const blockHeight = (doc: Document) => {
  const boxes = prims(doc).filter((p) => p.kind === 'path' && p.closed && !p.backdrop)
  if (boxes.length < 2) return 0
  const box = boundsOf([boxes[1]])!
  return (box.maxY - box.minY) / 50
}

describe('title block', () => {
  it('shows what there is to say and nothing else', () => {
    const doc = drawing([sheet()])
    // The project is the drawing's name; the page is left out unless asked for; author, date and number are empty.
    expect(texts(doc)).toEqual(['House', 'Ground floor', '1:50', 'A3'])
    expect(blockHeight(doc)).toBe(30)
  })

  it('takes the project, client, address and author from the drawing, on every sheet', () => {
    const doc = drawing([sheet(), { op: 'set_document', info: { project: 'Villa Mona', client: 'M. Dupont', address: '12 rue des Lilas\n75020 Paris', author: 'Zoé' } }])
    expect(doc.name).toBe('House')
    expect(texts(doc)).toEqual(['Villa Mona', 'M. Dupont', '12 rue des Lilas', '75020 Paris', 'Ground floor', 'Zoé', '1:50', 'A3'])
    // Three more lines under the project make the heading taller.
    expect(blockHeight(doc)).toBe(45)
    // Emptied, an entry is gone from the drawing and from the block.
    const cleared = applyOps(doc, [{ op: 'set_document', info: { client: '', address: null } }])
    expect(cleared.info).toEqual({ project: 'Villa Mona', author: 'Zoé' })
    expect(blockHeight(cleared)).toBe(30)
    expect(() => applyOps(doc, [{ op: 'set_document', info: { colour: 'red' } }])).toThrow(/Unknown document information/)
  })

  it('leaves out the entries a sheet hides, and shrinks to what is left', () => {
    const everything = drawing([sheet({ hide: [], date: '{page-number} / {pages}', number: 'A-01' })])
    expect(texts(everything)).toEqual(['House', 'Ground floor · Level 0', '1:50', 'A3', '1 / 1', 'A-01'])
    const cellsOnly = drawing([sheet({ hide: ['project', 'client', 'address', 'sheet', 'page', 'author'] })])
    expect(texts(cellsOnly)).toEqual(['1:50', 'A3'])
    expect(blockHeight(cellsOnly)).toBe(9)
    // With everything hidden the sheet keeps its border and has no block.
    const none = drawing([sheet({ hide: ['project', 'client', 'address', 'sheet', 'page', 'author', 'scale', 'format', 'date', 'number'] })])
    expect(texts(none)).toEqual([])
    expect(blockHeight(none)).toBe(0)
  })

  it('names the sheet once when its page has the same name, and still reads what a sheet says for itself', () => {
    const same = drawing([sheet({ hide: [] }), { op: 'update_node', id: 'page_1', patch: { name: 'Ground floor' } }])
    expect(texts(same)).toContain('Ground floor')
    expect(texts(same).some((text) => text.includes('·'))).toBe(false)
    // An older file may give a project and an author on the sheet itself: they win over the drawing's.
    const own = drawing([sheet({ project: 'Annex', author: 'Léa' }), { op: 'set_document', info: { project: 'Villa Mona', author: 'Zoé' } }])
    expect(titleBlockValues(own.nodes.sheet as any, own)).toMatchObject({ project: 'Annex', author: 'Léa', page: 'Level 0', scale: '1:50', format: 'A3' })
  })

  it('sets a text too long for its place smaller rather than letting it run out of the block', () => {
    const doc = applyOps(createDocument('A very long name for a drawing that would never fit in a title block at full size'), [sheet()])
    const project = prims(doc).find((p) => p.kind === 'text')!
    if (project.kind !== 'text') throw new Error('no text')
    // 5 mm at 1:50 is 250; it is set smaller, but not below half of that.
    expect(project.size).toBeLessThan(250)
    expect(project.size).toBeGreaterThanOrEqual(125)
  })
})
