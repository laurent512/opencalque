import { parseColor } from './colors'
import { rotate, type Vec2 } from './geometry'
import { decodePng } from './png'
import { isVisible, leavesOf, rootOf } from './document'
import { nodePrimitives } from './kinds'
import { PRINT_MM_PER_PIXEL, printedPrims, type Primitive } from './primitives'
import type { Registry } from './registry'
import { buildScene, paintOrder, printedScene, type PaintStep } from './scene'
import type { Document, NodeOf } from './schema'
import { readTrueType, type TrueTypeFont } from './truetype'

/**
 * Exports papers as PDF pages at their true size: an A3 at 1:50 comes out as an A3 on which one
 * metre of the plan measures 20 mm. The drawing stays vector, so it prints sharp at any size.
 *
 * The file is written here from scratch, with no library: a PDF is a list of numbered objects
 * followed by a table of where each one starts. Text uses the fonts every PDF reader has, so
 * nothing needs embedding: Helvetica, Times or Courier, each plain or bold, chosen from the
 * text's own font. Those know only Western European letters; a text with any other (Chinese,
 * Greek, Polish…) is printed in TrueType fonts given to `toPDF`, of which only the glyphs used are
 * embedded. JPEG pictures are taken as they are; PNG ones are read into plain pixels.
 */

/** The fonts a text can print in, in the order they are numbered (F1 to F6): a family, plain then bold. */
const FONTS = ['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Courier', 'Courier-Bold']

/** Which of the fonts stands for a CSS font family, and how wide its letters run compared with Helvetica's. */
function fontFor(family: string | undefined, bold: boolean | undefined): { index: number; fixed: boolean; widen: number } {
  const name = (family ?? '').toLowerCase()
  const mono = /mono|courier|consol/.test(name)
  const serif = !mono && /(^|[^-])\bserif|times|georgia|garamond/.test(name.replace(/sans-serif/g, ''))
  const narrow = /narrow|condensed/.test(name)
  // Only Helvetica's widths are known here; the others are told apart well enough to centre a text.
  return { index: (mono ? 4 : serif ? 2 : 0) + (bold ? 1 : 0), fixed: mono, widen: (serif ? 0.92 : 1) * (bold && !mono ? 1.06 : 1) * (narrow ? 0.82 : 1) }
}

/** Points per millimetre: a PDF measures in 1/72 of an inch. */
const POINT = 72 / 25.4
/** What one screen pixel of line weight becomes on paper, in points. */
const WEIGHT = PRINT_MM_PER_PIXEL * POINT

/** Widths of the printable ASCII characters in Helvetica, in thousandths of the font size. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
  667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500,
  722, 500, 500, 500, 334, 260, 334, 584,
]
/** Characters outside Latin-1 that the standard encoding has all the same, and where. */
const SPECIAL: Record<string, number> = { '€': 0x80, '…': 0x85, 'Œ': 0x8c, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, 'œ': 0x9c }

/** Whether the standard fonts have a sign for every character of a text. */
const printable = (text: string) => [...text].every((char) => SPECIAL[char] || (char >= ' ' && char <= '~') || (char >= ' ' && char <= 'ÿ'))

/** A text as the bytes Helvetica's standard encoding uses, with "?" for what it has no sign for. */
function encode(text: string): number[] {
  return [...text].map((char) => {
    const code = char.charCodeAt(0)
    if (SPECIAL[char]) return SPECIAL[char]
    return (code >= 32 && code < 127) || (code >= 160 && code < 256) ? code : 63
  })
}
/** How wide a text is in Helvetica at a given size. Accented letters are taken as about a lower-case letter wide. */
const textWidth = (bytes: number[], size: number) => bytes.reduce((sum, b) => sum + (b >= 32 && b < 127 ? WIDTHS[b - 32] : 556), 0) * (size / 1000)

const n = (value: number) => String(Math.round(value * 1000) / 1000)

function fromBase64(text: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let held = 0
  let at = 0
  for (const char of clean) {
    held = (held << 6) | alphabet.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (held >> bits) & 0xff
    }
  }
  return out.subarray(0, at)
}

/** The pixel size and number of colour channels of a JPEG, read from its header. */
function jpegInfo(bytes: Uint8Array): { width: number; height: number; channels: number } | null {
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    // The "start of frame" markers hold the size; C4, C8 and CC are other things.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], channels: bytes[i + 9] }
    }
    i += 2 + length
  }
  return null
}

type Paper = NodeOf<'paper'>

/** A font embedded for texts the standard fonts cannot print, and the glyphs used from it so far. */
interface Embedded {
  font: TrueTypeFont
  /** Each glyph used, by its number in the font; it is numbered in the PDF by its place here. Glyph 0, the "missing" one, is first. */
  glyphs: number[]
  numbers: Map<number, number>
  /** The character each glyph stands for, so the text can be searched and copied. */
  characters: string[]
}

/**
 * A text cut into runs, each drawn by the first of the fonts that has its characters: the font's
 * place in the list and the numbers its glyphs have in the PDF, which are added to those embedded
 * the first time. A character none of them has is the first font's "missing" glyph.
 */
function runsOf(fonts: Embedded[], text: string): { font: number; numbers: number[] }[] {
  const runs: { font: number; numbers: number[] }[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    const font = Math.max(0, fonts.findIndex((embedded) => embedded.font.glyph(code) !== 0))
    const embedded = fonts[font]
    const glyph = embedded.font.glyph(code)
    let number = embedded.numbers.get(glyph)
    if (number === undefined) {
      number = embedded.glyphs.push(glyph) - 1
      embedded.numbers.set(glyph, number)
      embedded.characters.push(char)
    }
    const last = runs[runs.length - 1]
    if (last?.font === font) last.numbers.push(number)
    else runs.push({ font, numbers: [number] })
  }
  return runs
}

/** Everything a page's drawing commands refer to by name. Shared by all the pages of a file. */
interface Resources {
  /** Opacities in use, as "fill stroke" keys, in the order they were first needed. */
  alphas: string[]
  /** A JPEG goes in as it is; anything else as plain pixels, three bytes each. */
  images: { bytes: Uint8Array; width: number; height: number; channels: number; jpeg: boolean }[]
  /** The picture already added for a data URL, so one used on several pages is stored once. */
  imageByHref: Map<string, number>
  /** The fonts given for what the standard ones cannot print, in the order they are tried. */
  fonts: Embedded[]
}

/** The drawing commands for one paper: what lies on it, brought to the page's own measure. */
function pageContent(doc: Document, paper: Paper, registry: Registry, resources: Resources, marks = false): { width: number; height: number; commands: string } {
  const perMm = POINT / (paper.scale ?? 100)
  const height = paper.height * perMm
  const at = (p: Vec2) => `${n((p.x - paper.x) * perMm)} ${n(height - (p.y - paper.y) * perMm)}`
  const out: string[] = []
  const alpha = (fill: number, stroke: number) => {
    if (fill >= 1 && stroke >= 1) return
    const key = `${n(fill)} ${n(stroke)}`
    if (!resources.alphas.includes(key)) resources.alphas.push(key)
    out.push(`/GS${resources.alphas.indexOf(key) + 1} gs`)
  }
  const outline = (points: Vec2[], closed: boolean) => out.push(points.map((p, i) => `${at(p)} ${i === 0 ? 'm' : 'l'}`).join(' ') + (closed ? ' h' : ''))

  const paint = ({ prim, stroke, fill, widthScale, widthExtra, seam }: PaintStep) => {
    out.push('q')
    for (const clip of prim.clip ?? []) {
      outline(clip, true)
      out.push('W n')
    }
    if (prim.kind === 'text') {
      const ink = parseColor(prim.stroke) ?? { r: 0, g: 0, b: 0, a: 1 }
      const size = prim.size * perMm
      // A condensed face has no standard font: Helvetica is squeezed sideways instead.
      const narrow = /narrow|condensed/i.test(prim.font ?? '')
      const squeeze = narrow ? ' 82 Tz' : ''
      // How the text is set, then shown, and how wide it comes out.
      let setting = squeeze
      let shown: string
      let wide: number
      if (!printable(prim.text) && resources.fonts.length > 0) {
        // The given fonts stand for every family. Bold is made by outlining the letters in their own colour.
        const runs = runsOf(resources.fonts, prim.text)
        const advance = runs.reduce((sum, { font, numbers }) => {
          const embedded = resources.fonts[font]
          return sum + numbers.reduce((width, number) => width + embedded.font.advance(embedded.glyphs[number]), 0) / embedded.font.unitsPerEm
        }, 0)
        wide = advance * size * (narrow ? 0.82 : 1)
        if (prim.bold) setting += ` 2 Tr ${n(size * 0.035)} w ${n(ink.r)} ${n(ink.g)} ${n(ink.b)} RG`
        shown = runs.map(({ font, numbers }) => `/F${FONTS.length + font + 1} ${n(size)} Tf <${numbers.map((number) => number.toString(16).padStart(4, '0')).join('')}> Tj`).join(' ')
      } else {
        const bytes = encode(prim.text)
        const font = fontFor(prim.font, prim.bold)
        wide = font.fixed ? bytes.length * 0.6 * size : textWidth(bytes, size) * font.widen
        setting += ` /F${font.index + 1} ${n(size)} Tf`
        shown = `(${bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 127 ? String.fromCharCode(b) : `\\${b.toString(8)}`)).join('')}) Tj`
      }
      const turn = ((prim.rotation ?? 0) * Math.PI) / 180
      // The page's Y runs up where the drawing's runs down, so a clockwise turn there is the opposite one here.
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
      const back = prim.align === 'center' ? wide / 2 : prim.align === 'right' ? wide : 0
      const x = (prim.x - paper.x) * perMm - back * cos
      const y = height - (prim.y - paper.y) * perMm + back * sin
      // Letters drawn bold are outlined in their own colour, and see-through as they are.
      alpha(ink.a, ink.a)
      out.push(`BT${setting} ${n(ink.r)} ${n(ink.g)} ${n(ink.b)} rg ${n(cos)} ${n(-sin)} ${n(sin)} ${n(cos)} ${n(x)} ${n(y)} Tm ${shown} ET`)
    } else if (prim.kind === 'image') {
      const [, format, data] = /^data:image\/(jpeg|png);base64,(.*)$/s.exec(prim.href) ?? []
      let index = resources.imageByHref.get(prim.href)
      if (index === undefined && data) {
        const bytes = fromBase64(data)
        let image: Resources['images'][number] | null = null
        if (format === 'jpeg') {
          const info = jpegInfo(bytes)
          image = info && { bytes, ...info, jpeg: true }
        } else {
          // A PNG that cannot be read (damaged, or interlaced) is left out, like any other kind of picture.
          let pixels: ReturnType<typeof decodePng> = null
          try {
            pixels = decodePng(bytes)
          } catch {
            pixels = null
          }
          image = pixels && { bytes: pixels.rgb, width: pixels.width, height: pixels.height, channels: 3, jpeg: false }
        }
        if (image) {
          index = resources.images.push(image) - 1
          resources.imageByHref.set(prim.href, index)
        }
      }
      if (index !== undefined) {
        // A picture is drawn in a unit square whose corner is its bottom left: place that square on the picture.
        const across = rotate({ x: prim.width, y: 0 }, prim.rotation ?? 0)
        const down = rotate({ x: 0, y: prim.height }, prim.rotation ?? 0)
        const x = (prim.x + down.x - paper.x) * perMm
        const y = height - (prim.y + down.y - paper.y) * perMm
        alpha(prim.opacity ?? 1, 1)
        out.push(`${n(across.x * perMm)} ${n(-across.y * perMm)} ${n(-down.x * perMm)} ${n(down.y * perMm)} ${n(x)} ${n(y)} cm /Im${index + 1} Do`)
      }
    } else {
      const filled = fill ? parseColor(prim.fill) : null
      const inked = stroke ? parseColor(prim.stroke ?? '#000000') : null
      // Touching fills are grown by a hairline in their own colour, as on screen, so no gap shows between them.
      const edge = inked ?? (filled && seam > 0 ? filled : null)
      const weight = inked ? ((prim.strokeWidth ?? 1) * widthScale + widthExtra) * WEIGHT : seam * WEIGHT
      if (filled || edge) {
        alpha(filled?.a ?? 1, edge?.a ?? 1)
        if (filled) out.push(`${n(filled.r)} ${n(filled.g)} ${n(filled.b)} rg`)
        if (edge) out.push(`${n(edge.r)} ${n(edge.g)} ${n(edge.b)} RG ${n(weight)} w${widthExtra > 0 ? ' 1 j' : ''}${inked && prim.dash ? ` [${prim.dash.map((d) => n(d * WEIGHT * 1.5)).join(' ')}] 0 d` : ''}`)
        if (prim.kind === 'ellipse') {
          // Four curves; 0.5523 is how far their handles reach for a quarter of a circle.
          const k = 0.5523
          const point = (x: number, y: number) => at({ x: prim.cx + rotate({ x: x * prim.rx, y: y * prim.ry }, prim.rotation ?? 0).x, y: prim.cy + rotate({ x: x * prim.rx, y: y * prim.ry }, prim.rotation ?? 0).y })
          out.push(
            `${point(1, 0)} m ${point(1, k)} ${point(k, 1)} ${point(0, 1)} c ${point(-k, 1)} ${point(-1, k)} ${point(-1, 0)} c ${point(-1, -k)} ${point(-k, -1)} ${point(0, -1)} c ${point(k, -1)} ${point(1, -k)} ${point(1, 0)} c h`,
          )
        } else outline(prim.points, prim.closed ?? false)
        out.push(filled && edge ? 'B' : filled ? 'f' : 'S')
      }
    }
    out.push('Q')
  }

  for (const step of paintOrder(sheetPrimitives(doc, paper, registry, marks))) paint(step)
  return { width: paper.width * perMm, height, commands: out.join('\n') }
}

/**
 * What is on a sheet, without the other sheets: the page is the paper. All that is on its page is
 * taken, the paper being in a group or not; a group that holds papers draws them, so what it holds
 * is taken one by one, without the papers but this one.
 */
function sheetPrimitives(doc: Document, paper: Paper, registry: Registry, marks = false): Primitive[] {
  const page = rootOf(doc, paper.parent)?.id ?? paper.parent!
  const ctx = { doc, registry, depth: 0 }
  const shown = (prims: Primitive[]) => (marks ? prims : printedPrims(prims)).filter((p) => p.backdrop !== true)
  return printedScene(buildScene(doc, page, registry), marks).flatMap((item) => {
    if (item.node.type === 'paper') return item.id === paper.id ? shown(item.prims) : []
    if (item.node.type !== 'group') return shown(item.prims)
    const held = leavesOf(doc, item.id).filter((leaf) => isVisible(doc, leaf))
    if (!held.some((leaf) => leaf.type === 'paper')) return shown(item.prims)
    return held.flatMap((leaf) => (leaf.type === 'paper' && leaf.id !== paper.id ? [] : shown(nodePrimitives(leaf, ctx))))
  })
}

/** The papers to export: those given, in that order, or every paper of the document, page by page. */
function papersOf(doc: Document, paperIds?: string[]): Paper[] {
  const all = Object.values(doc.nodes).filter((node): node is Paper => node.type === 'paper')
  return paperIds ? paperIds.flatMap((id) => all.filter((paper) => paper.id === id)) : all.sort((a, b) => (a.parent === b.parent ? (a.order < b.order ? -1 : 1) : 0))
}

/**
 * The characters, each once, of the texts on these papers that the standard fonts cannot print:
 * what the fonts given to `toPDF` should have. None means no font is needed. Fonts can be large:
 * this tells which to load, if any.
 */
export function pdfFontCharacters(doc: Document, registry: Registry, paperIds?: string[]): string[] {
  const texts = papersOf(doc, paperIds).flatMap((paper) => sheetPrimitives(doc, paper, registry).flatMap((prim) => (prim.kind === 'text' && !printable(prim.text) ? [prim.text] : [])))
  return [...new Set(texts.flatMap((text) => [...text]))].filter((char) => !printable(char))
}

/**
 * The fonts the app ships (`fonts/<name>-Regular.ttf`) that a PDF of these characters tries, in
 * order. Chinese, Japanese and Korean share many characters but draw them differently, so the
 * text's language decides which comes first: Japanese when it has kana or the interface is in
 * Japanese, Korean when it has Hangul or the interface is in Korean, Chinese otherwise.
 */
export function pdfFontNames(characters: string[], language?: string): string[] {
  const japanese = language === 'ja' || characters.some((char) => /[぀-ヿ]/.test(char))
  const korean = language === 'ko' || characters.some((char) => /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/.test(char))
  return ['NotoSans', ...(japanese ? ['NotoSansJP'] : []), ...(korean ? ['NotoSansKR'] : []), 'NotoSansSC']
}

export interface PdfOptions {
  /**
   * TrueType fonts (the bytes of `.ttf` files) for texts the standard fonts cannot print: Chinese,
   * Greek, Polish… Each character is taken from the first that has it, and only the glyphs used are
   * embedded. Without them, those characters print as "?".
   */
  fonts?: Uint8Array[]
  /** The marks drawn to work with (the eyes of viewpoints, the lines of views), printed too, as on screen. */
  marks?: boolean
}

/**
 * A PDF with one page per paper, each at the paper's real size and scale. Papers are taken in the
 * order given; with none given, every paper of the document, page by page.
 */
export function toPDF(doc: Document, registry: Registry, paperIds?: string[], options: PdfOptions = {}): Uint8Array {
  const papers = papersOf(doc, paperIds)
  if (papers.length === 0) throw new Error('There is no paper to export. A paper sets the size and the scale of a printed sheet.')

  const given = (options.fonts ?? []).map((bytes): Embedded => ({ font: readTrueType(bytes), glyphs: [0], numbers: new Map([[0, 0]]), characters: [''] }))
  const resources: Resources = { alphas: [], images: [], imageByHref: new Map(), fonts: given }
  const pages = papers.map((paper) => pageContent(doc, paper, registry, resources, options.marks))
  // A given font none of whose glyphs was used is left out; the others take five objects each.
  const used = given.flatMap((embedded, i) => (embedded.glyphs.length > 1 ? [{ embedded, name: `F${FONTS.length + i + 1}` }] : []))
  const fonts = used.flatMap(({ embedded }, i) => embeddedFont(embedded, 3 + FONTS.length + 5 * i))

  // Objects, in the order they are numbered: the catalog, the list of pages, the fonts, the
  // opacities, the pictures, then a page and its drawing commands for each paper.
  const chunks: (string | Uint8Array)[] = []
  const firstAlpha = 3 + FONTS.length + fonts.length
  const firstImage = firstAlpha + resources.alphas.length
  const firstPage = firstImage + resources.images.length
  const names = (prefix: string, first: number, count: number) => Array.from({ length: count }, (_, i) => `/${prefix}${i + 1} ${first + i} 0 R`).join(' ')
  const shared = `<< /Font << ${[names('F', 3, FONTS.length), ...used.map(({ name }, i) => `/${name} ${3 + FONTS.length + 5 * i} 0 R`)].join(' ')} >> /ExtGState << ${names('GS', firstAlpha, resources.alphas.length)} >> /XObject << ${names('Im', firstImage, resources.images.length)} >> >>`
  const objects: (string | [string, Uint8Array])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`,
    ...FONTS.map((name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
    ...fonts,
    ...resources.alphas.map((key) => `<< /Type /ExtGState /ca ${key.split(' ')[0]} /CA ${key.split(' ')[1]} >>`),
    ...resources.images.map((image): [string, Uint8Array] => [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.channels === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8${image.jpeg ? ' /Filter /DCTDecode' : ''} /Length ${image.bytes.length} >>`,
      image.bytes,
    ]),
    ...pages.flatMap((page, i): (string | [string, Uint8Array])[] => {
      const commands = Uint8Array.from([...page.commands].map((char) => char.charCodeAt(0) & 0xff))
      return [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources ${shared} /Contents ${firstPage + i * 2 + 1} 0 R >>`, [`<< /Length ${commands.length} >>`, commands]]
    }),
  ]

  let length = 0
  const offsets: number[] = []
  const write = (part: string | Uint8Array) => {
    chunks.push(part)
    length += part.length
  }
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  objects.forEach((object, i) => {
    offsets.push(length)
    write(`${i + 1} 0 obj\n`)
    if (typeof object === 'string') write(`${object}\n`)
    else {
      write(`${object[0]}\nstream\n`)
      write(object[1])
      write('\nendstream\n')
    }
    write('endobj\n')
  })
  const table = length
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`)
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`)

  const file = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    if (typeof chunk === 'string') for (let i = 0; i < chunk.length; i++) file[at++] = chunk.charCodeAt(i) & 0xff
    else {
      file.set(chunk, at)
      at += chunk.length
    }
  }
  return file
}

/** The bytes of a text that is only ASCII, as a PDF stream holds them. */
const ascii = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

/**
 * The objects of the embedded font, numbered from `first`: the font a page refers to, the glyphs
 * it is made of, their description, the font file cut down to them, and what each one stands for.
 */
function embeddedFont({ font, glyphs, characters }: Embedded, first: number): (string | [string, Uint8Array])[] {
  const file = font.subset(glyphs.slice(1))
  // A subset is named after its glyphs, behind six capitals, so two different ones are not taken for each other.
  let hash = 0
  for (const glyph of glyphs) hash = (Math.imul(hash, 31) + glyph) >>> 0
  const tag = Array.from({ length: 6 }, (_, i) => String.fromCharCode(65 + (Math.floor(hash / 26 ** i) % 26))).join('')
  const name = `${tag}+${font.name}`
  const scale = (value: number) => Math.round((value * 1000) / font.unitsPerEm)
  const widths = glyphs.map((glyph) => scale(font.advance(glyph))).join(' ')
  const utf16 = (text: string) => [...text].flatMap((char) => (char.length === 2 ? [char.charCodeAt(0), char.charCodeAt(1)] : [char.charCodeAt(0)])).map((unit) => unit.toString(16).padStart(4, '0')).join('')
  const pairs = characters.flatMap((char, number) => (number === 0 ? [] : [`<${number.toString(16).padStart(4, '0')}> <${utf16(char)}>`]))
  const blocks = Array.from({ length: Math.ceil(pairs.length / 100) }, (_, i) => pairs.slice(i * 100, i * 100 + 100))
  const unicode = ascii(
    [
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      ...blocks.map((block) => `${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`),
      'endcmap CMapName currentdict /CMap defineresource pop end end',
    ].join('\n'),
  )
  return [
    `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${first + 1} 0 R] /ToUnicode ${first + 4} 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${first + 2} 0 R /CIDToGIDMap /Identity /W [0 [${widths}]] >>`,
    `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${font.bbox.map(scale).join(' ')}] /ItalicAngle 0 /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.capHeight)} /StemV 80 /FontFile2 ${first + 3} 0 R >>`,
    [`<< /Length ${file.length} /Length1 ${file.length} >>`, file],
    [`<< /Length ${unicode.length} >>`, unicode],
  ]
}
