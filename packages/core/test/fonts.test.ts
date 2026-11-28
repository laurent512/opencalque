import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, dxfOps, pdfFontCharacters, pdfFontNames, readTrueType, Registry, toDXF, toPDF, type NodeInput, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
const font = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../../fonts', name)))
const latin = font('NotoSans-Regular.ttf')
const chinese = font('NotoSansSC-Regular.ttf')
const sheet = (...texts: Record<string, unknown>[]) =>
  applyOps(createDocument(), [add({ type: 'paper', id: 'sheet', x: 0, y: 0, width: 21000, height: 29700, scale: 100 }), ...texts.map((text, i) => add({ type: 'text', id: `t${i}`, x: 1000, y: 1000 * (i + 1), size: 300, ...text }))])

describe('TrueType fonts', () => {
  it('finds the glyph of a character and its width', () => {
    const sc = readTrueType(chinese)
    expect(sc.name).toBe('NotoSansSC-Regular')
    expect(sc.glyph(0x623f)).toBeGreaterThan(0) // 房
    expect(sc.advance(sc.glyph(0x623f))).toBe(sc.unitsPerEm)
    expect(sc.glyph(0xd55c)).toBe(0) // 한: no Korean in this font
    const kr = readTrueType(font('NotoSansKR-Regular.ttf'))
    expect(kr.name).toBe('NotoSansKR-Regular')
    expect(kr.glyph(0xd55c)).toBeGreaterThan(0)
    expect(kr.glyph(0x3131)).toBeGreaterThan(0) // ㄱ
    expect(readTrueType(latin).glyph(0x141)).toBeGreaterThan(0) // Ł
  })

  it('cuts a font down to some glyphs, renumbered in order, with the parts of composite ones', () => {
    const sans = readTrueType(latin)
    // ệ is drawn from other glyphs: a letter and its two accents.
    const wanted = [...'Łệ'].map((char) => sans.glyph(char.codePointAt(0)!))
    const file = sans.subset(wanted)
    const cut = readTrueType(file)
    const view = new DataView(file.buffer)
    let sum = 0
    for (let at = 0; at < file.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
    expect(sum).toBe(0xb1b0afba)
    expect(cut.advance(1)).toBe(sans.advance(wanted[0]))
    expect(cut.advance(2)).toBe(sans.advance(wanted[1]))
    // The missing glyph, the two asked for, and what ệ is made of.
    expect(cut.glyphCount).toBeGreaterThan(3)
    expect(file.length).toBeLessThan(4000)
    expect(() => readTrueType(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0]))).toThrow(/CFF/)
  })
})

describe('letters the standard PDF fonts lack', () => {
  it('lists them, and none for Western European text', () => {
    expect(pdfFontCharacters(sheet({ text: 'Façade, cœur – 3 m²' }), registry)).toEqual([])
    expect(pdfFontCharacters(sheet({ text: '房间 1' }), registry)).toEqual(['房', '间'])
  })

  it('tries the Japanese or the Korean font before the Chinese one for a text in that language', () => {
    expect(pdfFontNames(['Ł'])).toEqual(['NotoSans', 'NotoSansSC'])
    expect(pdfFontNames(['直', '角'])).toEqual(['NotoSans', 'NotoSansSC'])
    expect(pdfFontNames(['直', '角'], 'ja')).toEqual(['NotoSans', 'NotoSansJP', 'NotoSansSC'])
    expect(pdfFontNames(['直', '角'], 'ko')).toEqual(['NotoSans', 'NotoSansKR', 'NotoSansSC'])
    expect(pdfFontNames(['거', '실'])).toEqual(['NotoSans', 'NotoSansKR', 'NotoSansSC'])
    expect(pdfFontNames(['ㄱ'])).toEqual(['NotoSans', 'NotoSansKR', 'NotoSansSC'])
    // Kana make a text Japanese, and the Korean font still prints its Hangul.
    expect(pdfFontNames(['か', '거'])).toEqual(['NotoSans', 'NotoSansJP', 'NotoSansKR', 'NotoSansSC'])
  })

  it('prints them in the first given font that has them, embedding only the glyphs used', () => {
    const doc = sheet({ text: 'Plain' }, { text: '房间 Łódź', bold: true, align: 'center' })
    const pdf = Buffer.from(toPDF(doc, registry, undefined, { fonts: [latin, chinese] })).toString('latin1')
    expect(pdf).toMatch(/\/F1 [\d.]+ Tf[^\n]*\(Plain\) Tj/)
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular /)
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansSC-Regular /)
    // Each run of the text goes in its own font, numbered after the twelve standard ones; bold outlines the letters.
    expect(pdf).toMatch(/2 Tr [^\n]*\/F14 [\d.]+ Tf <00010002> Tj \/F13 [\d.]+ Tf <[0-9a-f]+> Tj/)
    expect(pdf).toContain('<0001> <623f>')
    expect(pdf.length).toBeLessThan(30000)
  })

  it('leaves out a given font none of whose glyphs is used, and prints "?" with none given', () => {
    const doc = sheet({ text: 'Łódź' })
    const pdf = Buffer.from(toPDF(doc, registry, undefined, { fonts: [latin, chinese] })).toString('latin1')
    expect(pdf).toContain('NotoSans-Regular')
    expect(pdf).not.toContain('NotoSansSC')
    expect(Buffer.from(toPDF(doc, registry)).toString('latin1')).toContain('(?\\363d?) Tj')
  })
})

describe('letters beyond ASCII in a DXF', () => {
  it('writes them as \\U+ codes, which come back on import', () => {
    const doc = applyOps(createDocument(), [add({ type: 'text', id: 't', x: 0, y: 0, text: '房间 é', size: 300 })])
    const dxf = toDXF(doc, 'page_1', registry)
    expect(dxf).toContain('\\U+623F\\U+95F4 \\U+00E9')
    const { ops } = dxfOps(createDocument(), 'page_1', dxf)
    expect(ops.map((op) => (op.op === 'add_node' ? (op.node as { text?: string }).text : undefined))).toContain('房间 é')
  })
})
