import { rotate, type Vec2 } from './geometry'
import type { Primitive } from './primitives'
import type { Registry } from './registry'
import { buildScene, paintOrder, type PaintStep } from './scene'
import type { Document, NodeOf } from './schema'

/**
 * Exports papers as PDF pages at their true size: an A3 at 1:50 comes out as an A3 on which one
 * metre of the plan measures 20 mm. The drawing stays vector, so it prints sharp at any size.
 *
 * The file is written here from scratch, with no library: a PDF is a list of numbered objects
 * followed by a table of where each one starts. Text uses Helvetica, one of the fonts every PDF
 * reader has, so nothing needs embedding. Pictures are taken as they are when they are JPEGs.
 */

/** Points per millimetre: a PDF measures in 1/72 of an inch. */
const POINT = 72 / 25.4
/** What one screen pixel of line weight becomes on paper, in points. A 1 px line prints at 0.25 mm. */
const WEIGHT = 0.7

/** Widths of the printable ASCII characters in Helvetica, in thousandths of the font size. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
  667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500,
  722, 500, 500, 500, 334, 260, 334, 584,
]
/** Characters outside Latin-1 that the standard encoding has all the same, and where. */
const SPECIAL: Record<string, number> = { '€': 0x80, '…': 0x85, 'Œ': 0x8c, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, 'œ': 0x9c }

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

/** A CSS colour as red, green, blue (0 to 1) and opacity, or null for none. Hex and rgb() forms are understood. */
export function parseColor(color: string | undefined): { r: number; g: number; b: number; a: number } | null {
  if (!color || color === 'none' || color === 'transparent') return null
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const part = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
    return { r: part(0), g: part(2), b: part(4), a: full.length >= 8 ? part(6) : 1 }
  }
  const parts = /^rgba?\(([^)]+)\)$/i.exec(color.trim())?.[1].split(/[\s,/]+/).filter(Boolean)
  if (parts && parts.length >= 3) {
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return { r: parseFloat(parts[0]) / 255, g: parseFloat(parts[1]) / 255, b: parseFloat(parts[2]) / 255, a: alpha }
  }
  // Anything else (a colour name) prints as ink rather than being left out.
  return color === 'white' ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }
}

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

/** Everything a page's drawing commands refer to by name. Shared by all the pages of a file. */
interface Resources {
  /** Opacities in use, as "fill stroke" keys, in the order they were first needed. */
  alphas: string[]
  images: { bytes: Uint8Array; width: number; height: number; channels: number }[]
  /** The picture already added for a data URL, so one used on several pages is stored once. */
  imageByHref: Map<string, number>
}

/** The drawing commands for one paper: what lies on it, brought to the page's own measure. */
function pageContent(doc: Document, paper: Paper, registry: Registry, resources: Resources): { width: number; height: number; commands: string } {
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
      const bytes = encode(prim.text)
      const turn = ((prim.rotation ?? 0) * Math.PI) / 180
      // The page's Y runs up where the drawing's runs down, so a clockwise turn there is the opposite one here.
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
      const back = prim.align === 'center' ? textWidth(bytes, size) / 2 : prim.align === 'right' ? textWidth(bytes, size) : 0
      const x = (prim.x - paper.x) * perMm - back * cos
      const y = height - (prim.y - paper.y) * perMm + back * sin
      alpha(ink.a, 1)
      const literal = bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 127 ? String.fromCharCode(b) : `\\${b.toString(8)}`)).join('')
      out.push(`BT /F1 ${n(size)} Tf ${n(ink.r)} ${n(ink.g)} ${n(ink.b)} rg ${n(cos)} ${n(-sin)} ${n(sin)} ${n(cos)} ${n(x)} ${n(y)} Tm (${literal}) Tj ET`)
    } else if (prim.kind === 'image') {
      const data = /^data:image\/jpeg;base64,(.*)$/s.exec(prim.href)?.[1]
      let index = resources.imageByHref.get(prim.href)
      if (index === undefined && data) {
        const bytes = fromBase64(data)
        const info = jpegInfo(bytes)
        if (info) {
          index = resources.images.push({ bytes, ...info }) - 1
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

  // What is on the sheet, without the sheets themselves: the page is the paper.
  const prims: Primitive[] = buildScene(doc, paper.parent!, registry).flatMap((item) => (item.node.type === 'paper' && item.id !== paper.id ? [] : item.prims.filter((p) => p.backdrop !== true)))
  for (const step of paintOrder(prims)) paint(step)
  return { width: paper.width * perMm, height, commands: out.join('\n') }
}

/**
 * A PDF with one page per paper, each at the paper's real size and scale. Papers are taken in the
 * order given; with none given, every paper of the document, page by page.
 */
export function toPDF(doc: Document, registry: Registry, paperIds?: string[]): Uint8Array {
  const all = Object.values(doc.nodes).filter((node): node is Paper => node.type === 'paper')
  const papers = paperIds ? paperIds.flatMap((id) => all.filter((paper) => paper.id === id)) : all.sort((a, b) => (a.parent === b.parent ? (a.order < b.order ? -1 : 1) : 0))
  if (papers.length === 0) throw new Error('There is no paper to export. A paper sets the size and the scale of a printed sheet.')

  const resources: Resources = { alphas: [], images: [], imageByHref: new Map() }
  const pages = papers.map((paper) => pageContent(doc, paper, registry, resources))

  // Objects, in the order they are numbered: the catalog, the list of pages, the font, the
  // opacities, the pictures, then a page and its drawing commands for each paper.
  const chunks: (string | Uint8Array)[] = []
  const firstAlpha = 4
  const firstImage = firstAlpha + resources.alphas.length
  const firstPage = firstImage + resources.images.length
  const names = (prefix: string, first: number, count: number) => Array.from({ length: count }, (_, i) => `/${prefix}${i + 1} ${first + i} 0 R`).join(' ')
  const shared = `<< /Font << /F1 3 0 R >> /ExtGState << ${names('GS', firstAlpha, resources.alphas.length)} >> /XObject << ${names('Im', firstImage, resources.images.length)} >> >>`
  const objects: (string | [string, Uint8Array])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ...resources.alphas.map((key) => `<< /Type /ExtGState /ca ${key.split(' ')[0]} /CA ${key.split(' ')[1]} >>`),
    ...resources.images.map((image): [string, Uint8Array] => [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.channels === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
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
