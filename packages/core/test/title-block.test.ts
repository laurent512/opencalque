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

describe('title block down the right edge', () => {
  // The same A3 lying at 1:50, in a drawing whose sheets have their block as a strip: 70 mm wide inside the 10 mm border, the whole height of it.
  const layout = (titleBlock: Record<string, unknown> | null): Op => ({ op: 'set_document', settings: { titleBlock } } as Op)
  const strip = (titleBlock: Record<string, unknown> = {}, labels?: Record<string, string>): Op[] => [layout({ layout: 'strip', ...(labels ? { labels } : {}) }), sheet(titleBlock)]
  const words = (doc: Document) => prims(doc).flatMap((p) => (p.kind === 'text' ? [{ text: p.text, x: p.x / 50, y: p.y / 50, size: p.size / 50 }] : []))
  const find = (doc: Document, text: string) => words(doc).find((word) => word.text === text)!

  it('names each entry over what it says, from the project at the top to the sheet number at the bottom', () => {
    const doc = drawing([...strip({ number: 'A-101', date: '2026-11-17' }), { op: 'set_document', info: { project: 'House on Elm St', client: 'J. Smith', author: 'KL' } }])
    expect(texts(doc)).toEqual(['Project', 'House on Elm St', 'Client', 'J. Smith', 'Drawn by', 'KL', 'Date', '2026-11-17', 'Sheet title', 'Ground floor', 'Scale', '1:50', 'Format', 'A3', 'Sheet no.', 'A-101'])
    const box = boundsOf([prims(doc).filter((p) => p.kind === 'path' && p.closed && !p.backdrop)[1]])!
    expect([box.minX / 50, box.maxX / 50, box.minY / 50, box.maxY / 50]).toEqual([340, 410, 10, 287])
    // Captions in small letters at the left of each cell, the values under them; the sheet number large, at the bottom.
    expect(find(doc, 'Project')).toMatchObject({ x: 343, size: 2 })
    expect(find(doc, 'House on Elm St').y).toBeGreaterThan(find(doc, 'Project').y)
    expect(find(doc, 'A-101')).toMatchObject({ size: 9 })
    expect(find(doc, 'A-101').y).toBeGreaterThan(280)
    expect(find(doc, 'Ground floor').y).toBeGreaterThan(200)
    expect(find(doc, 'Drawn by').y).toBeLessThan(80)
  })

  it('draws the strip on a new sheet of the drawing, with nothing set on the sheet itself', () => {
    // As the Paper tool makes it: "titleBlock": {}.
    const doc = drawing([layout({ layout: 'strip' }), add({ type: 'paper', id: 'sheet', name: 'Second floor', x: 0, y: 0, width: 21000, height: 14850, scale: 50, titleBlock: {} })])
    expect(doc.nodes.sheet).toMatchObject({ titleBlock: {} })
    expect(texts(doc)).toEqual(['Project', 'House', 'Sheet title', 'Second floor', 'Scale', '1:50', 'Format', 'A3'])
  })

  it('lists the revisions in columns under the project, as many as there is room for', () => {
    const doc = drawing(strip({ revisions: '1 | 2026-10-02 | Issued for review\n\n2 | 2026-11-17 | Issued for permit\nRevised stair' }))
    expect(texts(doc).slice(0, 10)).toEqual(['Project', 'House', 'Revisions', '1', '2026-10-02', 'Issued for review', '2', '2026-11-17', 'Issued for permit', 'Revised stair'])
    // The mark, the date and the description each in its column; a line with no '|' is a description.
    expect([find(doc, '2').x, find(doc, '2026-11-17').x, find(doc, 'Issued for permit').x, find(doc, 'Revised stair').x]).toEqual([341.5, 349.5, 367.5, 367.5])
    // A hundred revisions on the sheet: twenty are drawn, and the strip stays inside the border.
    const hundred = Array.from({ length: 100 }, (_, i) => `${i + 1} | | Change ${i + 1}`).join('\n')
    const many = drawing(strip({ revisions: hundred }))
    expect(texts(many).filter((text) => text.startsWith('Change'))).toHaveLength(20)
    expect(Math.max(...words(many).map((word) => word.y))).toBeLessThan(287)
    // On a sheet with room for fewer, fewer: an A5 lying holds 128 mm of strip.
    const small = applyOps(createDocument('House'), [layout({ layout: 'strip' }), add({ type: 'paper', id: 'sheet', name: 'Detail', x: 0, y: 0, width: 10500, height: 7400, scale: 50, titleBlock: { revisions: hundred } })])
    const listed = texts(small).filter((text) => text.startsWith('Change')).length
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(20)
    expect(Math.max(...words(small).map((word) => word.y))).toBeLessThan(138)
  })

  it('takes its captions from the drawing, and leaves out what is hidden or empty', () => {
    const labels = { project: 'Projet', sheet: 'Titre de la feuille', scale: 'Échelle', format: 'Format', number: 'N° de feuille' }
    const doc = drawing(strip({ hide: ['page', 'format'], number: '3' }, labels))
    expect(texts(doc)).toEqual(['Projet', 'House', 'Titre de la feuille', 'Ground floor', 'Échelle', '1:50', 'N° de feuille', '3'])
    // With everything hidden, the border alone, as in the corner.
    const none = drawing(strip({ hide: ['project', 'sheet', 'page', 'scale', 'format'] }))
    expect(texts(none)).toEqual([])
    expect(blockHeight(none)).toBe(0)
  })

  it('draws no caption where the drawing left one empty, and still draws what the entry says', () => {
    const doc = drawing(strip({ number: 'A-101', revisions: '1 | 2026-11-17 | Issued for permit' }, { project: '', revisions: ' ', number: 'Sheet' }))
    expect(texts(doc)).not.toContain('')
    expect(texts(doc)).toEqual(['House', '1', '2026-11-17', 'Issued for permit', 'Sheet title', 'Ground floor', 'Scale', '1:50', 'Format', 'A3', 'Sheet', 'A-101'])
  })

  it('leaves the block in the corner as it was for a drawing that does not ask for the strip', () => {
    const corner = drawing([sheet({ revisions: '1 | today | Issued' })])
    expect(texts(corner)).toEqual(['House', 'Ground floor', '1:50', 'A3'])
    expect(corner.settings).toBeUndefined()
    expect(texts(drawing([layout({ layout: 'corner' }), sheet({ revisions: '1 | today | Issued' })]))).toEqual(['House', 'Ground floor', '1:50', 'A3'])
    // Back in the corner, the drawing says nothing of its title blocks.
    expect(drawing([...strip(), layout(null)]).settings).toBeUndefined()
  })

  it('refuses a layout it does not know', () => {
    expect(() => drawing([layout({ layout: 'left' })])).toThrow(/corner" or "strip/)
    expect(() => drawing([layout({ layout: 'strip', labels: { project: 3 } })])).toThrow(/labels/)
  })
})
