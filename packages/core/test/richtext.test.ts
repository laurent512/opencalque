import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildScene,
  charStyles,
  commonStyle,
  createDocument,
  formatSpans,
  normalSpans,
  primitiveBounds,
  primitiveNodes,
  readDocument,
  Registry,
  replaceText,
  respan,
  retextPatch,
  runWidth,
  styledLines,
  toPDF,
  toSVG,
  transformPrimitive,
  type Document,
  type Op,
  type TextPrim,
} from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const texts = (doc: Document, id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p): p is TextPrim => p.kind === 'text')

describe('rich text', () => {
  it('sets apart a range, joining what touches and leaving out what says nothing', () => {
    const bold = formatSpans('Hello world', undefined, 0, 5, { bold: true })
    expect(bold).toEqual([{ from: 0, to: 5, bold: true }])
    // Bold again on the next word, with a space between: one span, the space included.
    expect(formatSpans('Hello world', bold, 5, 11, { bold: true })).toEqual([{ from: 0, to: 11, bold: true }])
    // Taken away again, nothing is left.
    expect(formatSpans('Hello world', bold, 0, 5, { bold: null })).toBeUndefined()
    // A scale of 1 is no setting.
    expect(normalSpans('abc', [{ from: 0, to: 3, scale: 1 }])).toBeUndefined()
  })

  it('reads overlapping spans as written by hand: for each property the last one wins', () => {
    const styles = charStyles(4, [
      { from: 0, to: 4, color: '#ff0000', scale: 2 },
      { from: 2, to: 9, color: '#0000ff' },
    ])
    expect(styles.map((s) => s.color)).toEqual(['#ff0000', '#ff0000', '#0000ff', '#0000ff'])
    expect(styles.every((s) => s.scale === 2)).toBe(true)
  })

  it('types new letters in the style of the letter before, and deletes with what they had', () => {
    const spans = formatSpans('ab cd', undefined, 0, 2, { italic: true })
    // At the end of "ab": italic. After the space: as the space, plain.
    expect(replaceText('ab cd', spans, 2, 2, 'X')).toEqual({ text: 'abX cd', spans: [{ from: 0, to: 3, italic: true }] })
    expect(replaceText('ab cd', spans, 3, 3, 'X').spans).toEqual([{ from: 0, to: 2, italic: true }])
    // A style given wins.
    expect(replaceText('ab cd', spans, 5, 5, '!', { bold: true }).spans).toEqual([
      { from: 0, to: 2, italic: true },
      { from: 5, to: 6, bold: true },
    ])
    // Deleting the italic letters leaves nothing set apart.
    expect(replaceText('ab cd', spans, 0, 3, '')).toEqual({ text: 'cd', spans: undefined })
    // At the start of a line, the letters after give the style.
    const second = formatSpans('a\nbc', undefined, 2, 4, { bold: true })
    expect(replaceText('a\nbc', second, 2, 2, 'X').spans).toEqual([{ from: 2, to: 5, bold: true }])
  })

  it('keeps the spans over the words they were on when the words are changed by something that knows nothing of them', () => {
    const spans = formatSpans('The red door', undefined, 4, 7, { color: '#ff0000' })
    expect(respan('The red door', 'The old red door', spans)).toEqual([{ from: 8, to: 11, color: '#ff0000' }])
    expect(retextPatch({ text: 'The red door', spans }, 'The red')).toEqual({ text: 'The red', spans: [{ from: 4, to: 7, color: '#ff0000' }] })
    expect(retextPatch({ text: 'The red door', spans }, 'Door')).toEqual({ text: 'Door', spans: null })
    expect(retextPatch({ text: 'Plain' }, 'Plainer')).toEqual({ text: 'Plainer' })
  })

  it('says what a selection shares, and what is mixed', () => {
    const spans = formatSpans('abcd', undefined, 0, 2, { bold: true, scale: 2 })
    expect(commonStyle('abcd', spans, 0, 2)).toEqual({ bold: true, scale: 2 })
    expect(commonStyle('abcd', spans, 1, 3)).toEqual({})
  })

  it('cuts a text into lines and runs', () => {
    const spans = formatSpans('ab\ncd', undefined, 1, 4, { bold: true })
    expect(styledLines('ab\ncd', spans)).toEqual([
      [
        { text: 'a', style: {} },
        { text: 'b', style: { bold: true } },
      ],
      [
        { text: 'c', style: { bold: true } },
        { text: 'd', style: {} },
      ],
    ])
  })

  it('draws each line as one primitive of runs, lines spaced for their largest letters, fields filled in run by run', () => {
    const doc = applyOps(createDocument('Notes'), [
      add({
        type: 'text',
        id: 't',
        x: 100,
        y: 200,
        text: 'Big on {page}\nsmall',
        size: 100,
        spans: [
          { from: 0, to: 3, scale: 2, color: 'var(--layer)', bold: true },
          { from: 14, to: 19, italic: true, underline: true },
        ],
      }),
    ])
    const [first, second] = texts(doc, 't')
    expect(first.text).toBe('Big on Page 1')
    expect(first.runs).toEqual([
      { text: 'Big', scale: 2, color: expect.stringMatching(/^#/), bold: true },
      { text: ' on Page 1' },
    ])
    expect(first.y).toBe(200)
    // Under the large letters: the depth of the first line (a quarter of 200) and the height of the second (100).
    expect(second.y).toBeCloseTo(200 + 50 + 100)
    expect(second.runs).toEqual([{ text: 'small', italic: true, underline: true }])
    // Its box is as tall as its largest letters, and as wide as its runs, letter by letter at Helvetica's widths, bold a little wider.
    const box = primitiveBounds(first)!
    expect(box.minY).toBeCloseTo(0)
    const big = ((667 + 222 + 556) / 1000) * 200 * 1.08
    const rest = ((278 + 556 + 556 + 278 + 667 + 556 + 556 + 556 + 278 + 556) / 1000) * 100
    expect(box.maxX - box.minX).toBeCloseTo(big + rest)
    // A text with no spans is drawn as it always was.
    const plain = applyOps(doc, [{ op: 'update_node', id: 't', patch: { spans: null } }])
    expect(texts(plain, 't').every((p) => p.runs === undefined)).toBe(true)
  })

  it('scales its runs with it, and is kept by vectorizing', () => {
    const doc = applyOps(createDocument('Notes'), [add({ type: 'text', id: 't', x: 0, y: 0, text: 'ab', size: 10, spans: [{ from: 1, to: 2, scale: 3 }] })])
    const [prim] = texts(doc, 't')
    const scaled = transformPrimitive(prim, { x: 0, y: 0, scale: 2 }) as TextPrim
    expect(scaled.size).toBe(20)
    expect(scaled.runs).toEqual(prim.runs)
    const [node] = primitiveNodes([prim], 'page_1') as any[]
    expect(node.spans).toEqual([{ from: 1, to: 2, scale: 3 }])
  })

  it('exports runs to SVG as pieces of one line, and to PDF in their fonts', () => {
    const doc = applyOps(createDocument('Notes'), [
      add({ type: 'text', id: 't', x: 0, y: 0, text: 'Plain bold slanted', size: 100, spans: [
        { from: 6, to: 10, bold: true, color: '#ff0000' },
        { from: 11, to: 18, italic: true, strike: true, scale: 1.5 },
      ] }),
      add({ type: 'paper', id: 'p', x: -1000, y: -1000, width: 21000, height: 29700, scale: 100 }),
    ])
    const svg = toSVG(doc, 'page_1', registry)
    expect(svg).toContain('>Plain <tspan font-weight="bold" fill="#ff0000">bold</tspan> <tspan font-size="150" font-style="italic" text-decoration="line-through">slanted</tspan></text>')
    const pdf = Buffer.from(toPDF(doc, registry)).toString('latin1')
    expect(pdf).toContain('/BaseFont /Helvetica-Oblique')
    expect(pdf).toMatch(/1 0 0 rg \/F2 [\d.]+ Tf \(bold\) Tj/)
    expect(pdf).toMatch(/\/F7 [\d.]+ Tf \(slanted\) Tj/)
    // The line through, drawn as a bar where the run was set.
    expect(pdf).toMatch(/ re f/)
  })

  it('is kept by a drawing read back, and ignored by what does not know it', () => {
    const doc = applyOps(createDocument('Notes'), [add({ type: 'text', id: 't', x: 0, y: 0, text: 'ab', size: 10, spans: [{ from: 0, to: 1, bold: true }] })])
    const { doc: read } = readDocument(JSON.parse(JSON.stringify(doc)))
    expect((read.nodes.t as any).spans).toEqual([{ from: 0, to: 1, bold: true }])
    // Spans past the end of the words, as an older version could leave them, are drawn as far as the words go.
    const short = applyOps(doc, [{ op: 'update_node', id: 't', patch: { text: 'a', spans: [{ from: 0, to: 9, bold: true }] } }])
    expect(texts(short, 't')[0].runs).toEqual([{ text: 'a', bold: true }])
  })
})

describe('how wide a text is', () => {
  const prim = (text: string, extra: Partial<TextPrim> = {}): TextPrim => ({ kind: 'text', x: 0, y: 0, text, size: 100, ...extra })
  const width = (text: string, extra: Partial<TextPrim> = {}) => runWidth(prim(text, extra), { text })

  it('counts each letter at its own width, as the sans-serif it is drawn in has them', () => {
    // A space and an i are much narrower than an m: counted all alike, the box was wider than the words.
    expect(width('ii')).toBeCloseTo(44.4)
    expect(width('mm')).toBeCloseTo(166.6)
    expect(width('Chambre parentale')).toBeLessThan(17 * 100 * 0.55 * 0.95)
    expect(width('ab', { bold: true })).toBeGreaterThan(width('ab'))
  })

  it('takes a fixed-width font, a narrower family, and the letters of Chinese, Japanese and Korean as they are', () => {
    expect(width('il', { font: 'monospace' })).toBeCloseTo(120)
    expect(width('abc', { font: '"Arial Narrow", sans-serif' })).toBeLessThan(width('abc'))
    expect(width('房间')).toBeCloseTo(200)
  })
})
