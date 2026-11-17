import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, Registry, toPDF, type Op } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
// The same reader the app uses to import PDFs, here to check that what is exported is a real one.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
// A tiny valid JPEG header is enough for a reader to list the picture: 3 × 2 pixels, three channels.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]).toString('base64')

const doc = applyOps(createDocument('House'), [
  { op: 'add_asset', asset: { id: 'scan', mime: 'image/jpeg', data: jpeg, width: 3, height: 2 } },
  add({ type: 'paper', id: 'a3', name: 'Ground floor', x: 0, y: 0, width: 21000, height: 14850, scale: 50, titleBlock: { author: 'Zoé', number: '01' } }),
  add({ type: 'paper', id: 'a4', name: 'Detail', x: 30000, y: 0, width: 2100, height: 2970, scale: 10 }),
  add({ type: 'wall', a: { x: 2000, y: 2000 }, b: { x: 8000, y: 2000 }, thickness: 200 }),
  add({ type: 'wall', a: { x: 8000, y: 2000 }, b: { x: 8000, y: 6000 }, thickness: 200, joins: { a: 'round' } }),
  add({ type: 'ellipse', cx: 4000, cy: 4000, rx: 600, ry: 300, rotation: 30, style: { fill: 'rgba(96, 125, 170, 0.13)' } }),
  add({ type: 'text', x: 3000, y: 5000, text: 'Séjour 24,32 m² (été)', size: 220 }),
  add({ type: 'image', asset: 'scan', x: 10000, y: 2000, width: 3000, height: 2000, opacity: 0.6 }),
  add({ type: 'line', a: { x: 30500, y: 500 }, b: { x: 31500, y: 2500 }, modifiers: [{ type: 'crop', frame: { x: 30400, y: 400 }, params: { width: 600, height: 600 } }] }),
])

const open = async (bytes: Uint8Array) => getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false } as any).promise

describe('PDF export', () => {
  it('makes one page per paper, at the real size of the sheet', async () => {
    const pdf = await open(toPDF(doc, registry))
    expect(pdf.numPages).toBe(2)
    // An A3 lying is 420 × 297 mm, an A4 upright 210 × 297; a point is 1/72 inch.
    const a3 = (await pdf.getPage(1)).getViewport({ scale: 1 })
    expect([Math.round((a3.width * 25.4) / 72), Math.round((a3.height * 25.4) / 72)]).toEqual([420, 297])
    const a4 = (await pdf.getPage(2)).getViewport({ scale: 1 })
    expect([Math.round((a4.width * 25.4) / 72), Math.round((a4.height * 25.4) / 72)]).toEqual([210, 297])
  })

  it('prints the title block down the right edge with its captions and revisions', async () => {
    // A 36 × 24 inch sheet at 1:48 in a drawing whose blocks are strips, with the revisions of the sheet.
    const sheet = applyOps(createDocument('House'), [
      { op: 'set_document', info: { project: 'House on Elm St', author: 'KL' }, settings: { titleBlock: { layout: 'strip' } } },
      add({ type: 'paper', id: 'p', name: 'Floor plan', x: 0, y: 0, width: 36 * 25.4 * 48, height: 24 * 25.4 * 48, scale: 48, titleBlock: { number: 'A-101', revisions: '1 | 2026-10-02 | Issued for review\n2 | 2026-11-17 | Issued for permit' } }),
    ])
    const page = await (await open(toPDF(sheet, registry))).getPage(1)
    const words = (await page.getTextContent()).items.map((item: any) => item.str)
    for (const expected of ['Project', 'House on Elm St', 'Revisions', '2026-11-17', 'Issued for permit', 'Drawn by', 'KL', 'Sheet title', 'Floor plan', 'Scale', '1:48', 'Sheet no.', 'A-101']) expect(words).toContain(expected)
  })

  it('draws to scale: 6 m of wall at 1:50 is 120 mm on the sheet', async () => {
    const text = new TextDecoder('latin1').decode(toPDF(doc, registry, ['a3']))
    // The wall's centerline runs from x = 2000 to 8000 mm of drawing: 40 to 160 mm of paper, 113.386 to 453.543 points.
    // Its outline is 100 mm either side of that in the drawing, 2 mm on paper.
    const xs = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)].map((m) => Number(m[1]))
    expect(xs).toContain(113.386)
    expect(Math.min(...xs.filter((x) => x > 100 && x < 120))).toBeCloseTo(113.386, 2)
  })

  it('keeps the words, accents included, and the title block', async () => {
    const pdf = await open(toPDF(doc, registry, ['a3']))
    const words = (await (await pdf.getPage(1)).getTextContent()).items.map((item: any) => item.str)
    expect(words).toContain('Séjour 24,32 m² (été)')
    // The title block: the drawing's name, the sheet's, its scale and format, and what was filled in.
    for (const expected of ['House', 'Ground floor', '1:50', 'A3', 'Zoé', '01']) expect(words).toContain(expected)
  })

  it('is read without complaint: curves, clipping, opacity and a picture', async () => {
    const pdf = await open(toPDF(doc, registry))
    for (const number of [1, 2]) {
      const list = await (await pdf.getPage(number)).getOperatorList()
      expect(list.fnArray.length).toBeGreaterThan(5)
    }
    const text = new TextDecoder('latin1').decode(toPDF(doc, registry))
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain('/ca 0.13')
    expect(text).toContain('W n')
    expect(text).toMatch(/ c /)
  })

  it('prints letters the standard fonts lack in the fonts the app ships, and keeps them as text', async () => {
    const font = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../fonts', name)))
    const sheet = applyOps(createDocument('房子'), [
      add({ type: 'paper', id: 'p', name: '一层平面图', x: 0, y: 0, width: 21000, height: 14850, scale: 50, titleBlock: { author: '李明' } }),
      add({ type: 'text', x: 3000, y: 5000, text: '客厅 Łódź', size: 220, bold: true }),
    ])
    const pdf = await open(toPDF(sheet, registry, undefined, { fonts: [font('NotoSans-Regular.ttf'), font('NotoSansSC-Regular.ttf')] }))
    const page = await pdf.getPage(1)
    const words = (await page.getTextContent()).items.map((item: any) => item.str).join('|')
    for (const expected of ['客厅', 'Łódź', '房子', '一层平面图', '李明']) expect(words).toContain(expected)
    expect((await page.getOperatorList()).fnArray.length).toBeGreaterThan(5)
  })

  it('prints Korean in the Korean font', async () => {
    const font = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../fonts', name)))
    const sheet = applyOps(createDocument('우리 집'), [
      add({ type: 'paper', id: 'p', name: '1층 평면도', x: 0, y: 0, width: 21000, height: 14850, scale: 50, titleBlock: { author: '김민준' } }),
      add({ type: 'text', x: 3000, y: 5000, text: '거실 22.04 m²', size: 220 }),
      add({ type: 'text', x: 3000, y: 8000, text: '침실 · 安房', size: 220, bold: true, align: 'center' }),
    ])
    const bytes = toPDF(sheet, registry, undefined, { fonts: [font('NotoSans-Regular.ttf'), font('NotoSansKR-Regular.ttf')] })
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansKR-Regular /)
    const page = await (await open(bytes)).getPage(1)
    // The spaces, in a standard font, come back as pieces of their own.
    const words = (await page.getTextContent()).items.map((item: any) => item.str).join('')
    for (const expected of ['거실', '22.04', '침실', '安房', '우리 집', '1층 평면도', '김민준']) expect(words).toContain(expected)
  })

  it('exports only the papers asked for, and says so when there is none', () => {
    expect(new TextDecoder('latin1').decode(toPDF(doc, registry, ['a4']))).toContain('/Count 1')
    expect(() => toPDF(createDocument(), registry)).toThrow(/no paper/)
  })
})
