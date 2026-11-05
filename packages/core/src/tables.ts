import { rootOf, settingsOf } from './document'
import { unionBounds, type Bounds } from './geometry'
import { primitiveBounds, transformPrimitive, type Primitive } from './primitives'
import { objectLabel, quantities, quantitiesIn, type Quantities } from './quantities'
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'

/*
 * Tables of quantities placed on the drawing (`table` nodes): what a page holds, counted and
 * measured as `quantities` does, worked out again each time the table is drawn, so that it never
 * goes stale. A table says what it counts (its schedule), which fields it shows and with what
 * words: those are written in the language of whoever made it, as the names of layers are, since
 * the drawing must look the same wherever it is opened.
 */

/** What a table can count. */
export const SCHEDULES = ['objects', 'floors', 'rooms', 'walls', 'openings'] as const
export type Schedule = (typeof SCHEDULES)[number]

/**
 * Every row a table could show, whether it shows it or not, by its key, with what it is called:
 * what a table chooses its rows among (`only`).
 */
export function tableItems(node: NodeOf<'table'>, doc: Document, registry: Registry): { key: string; label: string }[] {
  if (!isSchedule(node.schedule)) return []
  const source = tableSource(doc, node)
  if (!source) return []
  const system = node.system ?? settingsOf(doc).system
  const translations = node.language ? registry.translations[node.language] : undefined
  const none = node.labels?.none ?? tableWord('none', system)
  const metric = measured(doc, source, registry)
  const rows = rowsOf(node.schedule, metric, quantitiesIn(metric, system), (label) => translations?.[label] ?? label, none)
  const label = (row: Row) =>
    node.schedule === 'walls' ? `${row.material} ${row.thickness}` : node.schedule === 'openings' ? `${row.kind} ${row.width} × ${row.height ?? '—'}` : String(row.name ?? row.material ?? row.kind ?? row.key)
  // A room placed several times is one row to choose; two rooms of one name are told apart by their area.
  const items = new Map<string, { key: string; label: string; area?: unknown }>()
  for (const row of rows) if (!items.has(row.key)) items.set(row.key, { key: row.key, label: label(row), area: row.area })
  const list = [...items.values()]
  const named = new Map<string, number>()
  for (const item of list) named.set(item.label, (named.get(item.label) ?? 0) + 1)
  const area = UNITS[system].area
  return list.slice(0, MAX_ROWS).map(({ key, label: text, area: value }) => ({
    key,
    label: node.schedule === 'rooms' && (named.get(text) ?? 0) > 1 && typeof value === 'number' ? `${text} (${value.toFixed(2)} ${area})` : text,
  }))
}

/** How a field is written: a name, a number of things, a measure in the unit of the table, or the drawing of what is counted. */
type Unit = 'text' | 'count' | 'length' | 'area' | 'volume' | 'thickness' | 'symbol'

/** The fields of each schedule, in the order offered, with how each is written and whether the last row adds it up. */
export const SCHEDULE_FIELDS: Record<Schedule, Record<string, { unit: Unit; total?: boolean }>> = {
  objects: { symbol: { unit: 'symbol' }, name: { unit: 'text' }, count: { unit: 'count', total: true } },
  floors: { material: { unit: 'text' }, rooms: { unit: 'count', total: true }, area: { unit: 'area', total: true } },
  rooms: { name: { unit: 'text' }, material: { unit: 'text' }, area: { unit: 'area', total: true }, perimeter: { unit: 'length', total: true } },
  walls: { material: { unit: 'text' }, thickness: { unit: 'thickness' }, count: { unit: 'count', total: true }, length: { unit: 'length', total: true }, area: { unit: 'area', total: true }, volume: { unit: 'volume', total: true } },
  openings: { kind: { unit: 'text' }, width: { unit: 'length' }, height: { unit: 'length' }, count: { unit: 'count', total: true } },
}

/** The fields a table of each schedule shows when it does not say. */
export const SCHEDULE_COLUMNS: Record<Schedule, string[]> = {
  objects: ['name', 'count'],
  floors: ['material', 'area'],
  rooms: ['name', 'area'],
  walls: ['material', 'thickness', 'length', 'area'],
  openings: ['kind', 'width', 'height', 'count'],
}

export const TABLE_TEXT_SIZE = 200
/** A table lists at most this many rows: a drawing cannot ask for more. */
const MAX_ROWS = 500

const isSchedule = (value: string): value is Schedule => (SCHEDULES as readonly string[]).includes(value)

/** The unit each kind of measure is written in, by system. */
const UNITS: Record<'metric' | 'imperial', Record<'length' | 'area' | 'volume' | 'thickness', string>> = {
  metric: { length: 'm', area: 'm²', volume: 'm³', thickness: 'mm' },
  imperial: { length: 'ft', area: 'ft²', volume: 'ft³', thickness: 'in' },
}

/**
 * The English words of a table: the heading of a field, with its unit, or 'total' and 'none'.
 * `units` gives the words a translation is to put the unit in, as "Area ({unit})". A field one
 * schedule means otherwise has its own words there, as "walls.area": the area of a wall is that of
 * its face, upright, never to be read as one of a floor.
 */
export const TABLE_WORDS: Record<string, string> = {
  symbol: 'Symbol',
  name: 'Name',
  count: 'Count',
  material: 'Material',
  rooms: 'Rooms',
  area: 'Area ({unit})',
  perimeter: 'Perimeter ({unit})',
  thickness: 'Thickness ({unit})',
  length: 'Length ({unit})',
  volume: 'Volume ({unit})',
  kind: 'Kind',
  width: 'Width ({unit})',
  height: 'Height ({unit})',
  'walls.area': 'Face area ({unit})',
  total: 'Total',
  none: '—',
}

/** The unit a field is measured in, as written in a system ("m²"), or undefined for a field of words, counts or symbols. */
function unitOf(field: string, system: 'metric' | 'imperial'): string | undefined {
  const unit = Object.values(SCHEDULE_FIELDS).find((fields) => fields[field])?.[field]?.unit
  return unit && unit !== 'text' && unit !== 'count' && unit !== 'symbol' ? UNITS[system][unit] : undefined
}

/** The words of a field with the unit it is measured in put in place of "{unit}". */
export function withUnit(text: string, field: string, system: 'metric' | 'imperial'): string {
  const unit = unitOf(field, system)
  return unit ? text.replace('{unit}', unit) : text
}

/**
 * Words given to a field with the unit of `system` written in them ("Surface (m²)") made to say
 * "{unit}" there instead, so that they follow the drawing when it changes system. The unit is taken
 * where it stands alone, not inside a word, and the last time it does.
 */
export function unitless(text: string, field: string, system: 'metric' | 'imperial'): string {
  const unit = unitOf(field, system)
  if (!unit || text.includes('{unit}')) return text
  const alone = new RegExp(String.raw`(?<![\p{L}\p{N}])${unit}(?![\p{L}\p{N}²³])`, 'gu')
  const last = [...text.matchAll(alone)].pop()
  return last?.index === undefined ? text : `${text.slice(0, last.index)}{unit}${text.slice(last.index + unit.length)}`
}

/** The English words of a field, in a table of `schedule` when given, with the unit it is measured in filled in. */
export function tableWord(field: string, system: 'metric' | 'imperial' = 'metric', words: Record<string, string> = TABLE_WORDS, schedule?: string): string {
  return withUnit((schedule ? words[`${schedule}.${field}`] : undefined) ?? words[field] ?? field, field, system)
}

/** What a column of symbols draws in a row: a component, or a kind of parametric object with its parameters. */
export interface TableSymbol {
  kind: 'component' | 'parametric'
  /** The component's id, or the parametric kind. */
  id: string
  props?: Record<string, unknown>
}

/** A row of a table: its cells by field, and its `key`, by which a table chooses the rows it shows (`only`). */
type Row = Record<string, string | number | null> & { key: string }

/**
 * The rows a schedule lists for what a page holds, before they are written out: their numbers from
 * `q`, in the unit system of the table, and their keys from `metric`, the same quantities measured
 * in metres, so that a table keeps the rows chosen whatever its units. A key holds ids where it can
 * (of a room, of a material), so that renaming one keeps it chosen.
 */
function rowsOf(schedule: Schedule, metric: Quantities, q: Quantities, name: (label: string) => string, none: string): Row[] {
  switch (schedule) {
    case 'objects':
      return q.objects.map((o) => ({ key: `${o.kind}:${o.id}`, symbol: '', name: o.kind === 'parametric' ? objectLabel(o, name) : o.name || none, count: o.count }))
    case 'floors':
      return q.floors.map((f) => ({ key: `material:${f.id}`, material: f.material || none, rooms: f.rooms, area: f.area }))
    case 'rooms':
      return q.rooms.map((r) => ({ key: `room:${r.id}`, name: r.name || none, material: r.material || none, area: r.area, perimeter: r.perimeter }))
    case 'openings':
      return q.openings.map((o, i) => {
        const m = metric.openings[i]
        return { key: `${m.kind} ${m.width} ${m.height ?? ''}`.trim(), kind: name(o.label), width: o.width, height: o.height, count: o.count }
      })
    case 'walls': {
      // One row per material and thickness: an insulation of 100 mm apart from one of 160.
      const groups = new Map<string, Row>()
      for (const [i, w] of q.walls.entries()) {
        const m = metric.walls[i]
        const key = `material:${m.materialId} ${m.thickness}`
        const row = groups.get(key) ?? { key, material: w.material || none, thickness: w.thickness, count: 0, length: 0, area: 0, volume: 0 }
        row.count = (row.count as number) + 1
        row.length = (row.length as number) + w.length
        row.area = row.area === null || w.net === null ? null : (row.area as number) + w.net
        row.volume = row.volume === null || w.volume === null ? null : (row.volume as number) + w.volume
        groups.set(key, row)
      }
      return [...groups.values()]
    }
  }
}

/** The number a cell writes, with as many decimals as its kind of measure takes. */
function written(value: string | number | null, unit: Unit, system: 'metric' | 'imperial', decimal: string): string {
  if (value === null || unit === 'symbol') return ''
  if (typeof value === 'string') return value
  const decimals = unit === 'count' ? 0 : unit === 'thickness' ? (system === 'metric' ? 0 : 1) : 2
  return value.toFixed(decimals).replace('.', decimal)
}

/** What a table shows: its title, the headings of its columns, its rows of cells, and how each column is set (numbers to the right). */
export interface TableContent {
  title: string
  headings: string[]
  rows: string[][]
  numeric: boolean[]
  /** Whether the last row is the total. */
  total: boolean
  /** The column that draws what each row counts, and what each row counts (its component or kind of object), when the table has one. */
  symbols?: { column: number; objects: TableSymbol[] }
}

const counted = new WeakMap<Document['nodes'], { version: number; layers: Document['layers']; materials: Document['materials']; byPage: Map<string, Quantities> }>()

/** What a page holds, measured once for each state of the drawing however many tables count it. */
function measured(doc: Document, pageId: string, registry: Registry): Quantities {
  let entry = counted.get(doc.nodes)
  if (!entry || entry.version !== registry.version || entry.layers !== doc.layers || entry.materials !== doc.materials) {
    counted.set(doc.nodes, (entry = { version: registry.version, layers: doc.layers, materials: doc.materials, byPage: new Map() }))
  }
  let q = entry.byPage.get(pageId)
  if (!q) entry.byPage.set(pageId, (q = quantities(doc, pageId, registry)))
  return q
}

/** The page a table counts: the one it names, or the page (or component) it is on. */
export function tableSource(doc: Document, node: NodeOf<'table'>): string | null {
  if (node.source && doc.nodes[node.source]?.type === 'page') return node.source
  return rootOf(doc, node.parent)?.id ?? null
}

/** What a table shows, worked out from the page it counts. */
export function tableContent(node: NodeOf<'table'>, doc: Document, registry: Registry): TableContent {
  const system = node.system ?? settingsOf(doc).system
  // Its own words say "{unit}" where the unit goes, so that they follow the drawing's system.
  const words = (field: string) => (node.labels?.[field] !== undefined ? withUnit(node.labels[field], field, system) : tableWord(field, system, TABLE_WORDS, node.schedule))
  const title = node.title ?? ''
  if (!isSchedule(node.schedule)) return { title, headings: [], rows: [], numeric: [], total: false }
  const fields = SCHEDULE_FIELDS[node.schedule]
  const columns = (node.columns ?? SCHEDULE_COLUMNS[node.schedule]).filter((field) => fields[field])
  const source = tableSource(doc, node)
  const metric = source ? measured(doc, source, registry) : null
  const q = metric ? quantitiesIn(metric, system) : null
  const translations = node.language ? registry.translations[node.language] : undefined
  const name = (label: string) => translations?.[label] ?? label
  const listed = metric && q ? rowsOf(node.schedule, metric, q, name, words('none')) : []
  const rows = (node.only ? listed.filter((row) => node.only!.includes(row.key)) : listed).slice(0, MAX_ROWS)
  const decimal = node.decimal ?? settingsOf(doc).decimal
  const cells = rows.map((row) => columns.map((field) => written(row[field] ?? null, fields[field].unit, system, decimal)))
  const total = node.totals !== false && rows.length > 0 && columns.some((field) => fields[field].total)
  if (total) {
    cells.push(
      columns.map((field, i) => {
        if (fields[field].total) {
          const values = rows.map((row) => row[field])
          return values.some((value) => typeof value !== 'number') ? '' : written(values.reduce<number>((sum, value) => sum + (value as number), 0), fields[field].unit, system, decimal)
        }
        // The word goes in the first column of words, not in one of drawings.
        return i === columns.findIndex((one) => fields[one].unit !== 'symbol') ? words('total') : ''
      }),
    )
  }
  const symbol = node.schedule === 'objects' && q ? columns.indexOf('symbol') : -1
  return {
    title,
    headings: columns.map(words),
    rows: cells,
    numeric: columns.map((field) => fields[field].unit !== 'text' && fields[field].unit !== 'symbol'),
    total,
    ...(symbol >= 0 ? { symbols: { column: symbol, objects: rows.flatMap((row): TableSymbol[] => {
      const o = q!.objects.find((one) => `${one.kind}:${one.id}` === row.key)
      return o ? [o.kind === 'parametric' ? { kind: 'parametric', id: o.of!, props: o.props } : { kind: 'component', id: o.id }] : []
    }) } } : {}),
  }
}

/** How wide a text is drawn, roughly: the renderers have the fonts, not the core. */
const textWidth = (text: string, size: number, bold = false) => text.length * size * (bold ? 0.6 : 0.56)

/** How tall a row is that draws what it counts, and how wide that drawing's column is, as parts of the size of the text. */
const SYMBOL_ROW = 3
const SYMBOL_WIDTH = 4

/** The space between two blocks of a table, as a part of the size of its text. */
const BLOCK_GAP = 1.5

/**
 * The box a table fills, from its top-left corner, given what it shows: its columns, and its rows
 * in blocks side by side of at most `perBlock` each (all in one when it is not given), each block
 * with its headings, the total at the end of the last.
 */
export function tableLayout(content: TableContent, size: number, perBlock?: number) {
  const pad = size * 0.5
  // Rows are taller where they draw what they count, for the drawing to be read.
  const rowHeight = size * (content.symbols ? SYMBOL_ROW : 1.7)
  const widths = content.headings.map((heading, i) =>
    i === content.symbols?.column
      ? Math.max(size * SYMBOL_WIDTH, textWidth(heading, size, true) + 2 * pad)
      : Math.max(textWidth(heading, size, true), ...content.rows.map((row) => textWidth(row[i], size, content.total && row === content.rows[content.rows.length - 1]))) + 2 * pad,
  )
  const titleHeight = content.title ? size * 2.2 : 0
  const body = content.rows.length - (content.total ? 1 : 0)
  const per = perBlock !== undefined && perBlock >= 1 ? Math.floor(perBlock) : Math.max(1, body)
  const blocks: number[][] = []
  for (let start = 0; start < body; start += per) blocks.push(Array.from({ length: Math.min(per, body - start) }, (_, k) => start + k))
  if (blocks.length === 0) blocks.push([])
  if (content.total) blocks[blocks.length - 1].push(content.rows.length - 1)
  const gap = size * BLOCK_GAP
  const block = widths.reduce((sum, w) => sum + w, 0)
  const width = Math.max(blocks.length * block + (blocks.length - 1) * gap, textWidth(content.title, size * 1.3, true))
  return { pad, rowHeight, widths, titleHeight, width, height: titleHeight + rowHeight * (1 + Math.max(...blocks.map((rows) => rows.length))), blocks, gap }
}

/**
 * What a table draws: its title, a frame with a row of headings and a row per thing counted, and
 * the total. A column of symbols draws each thing counted as `symbol` draws it on its own (its
 * component, or its kind of object with the parameters it starts with), fitted in its cell, in
 * its own colours: the table is then a legend of the plan that keeps up with it.
 */
export function tablePrimitives(node: NodeOf<'table'>, doc: Document, registry: Registry, symbol?: (object: TableSymbol) => Primitive[]): Primitive[] {
  const size = node.size ?? TABLE_TEXT_SIZE
  const content = tableContent(node, doc, registry)
  const { pad, rowHeight, widths, titleHeight, blocks, gap } = tableLayout(content, size, node.rowsPerBlock)
  const out: Primitive[] = []
  const { x, y } = node
  if (content.title) out.push({ kind: 'text', x, y: y + size * 1.3, text: content.title, size: size * 1.3, bold: true })
  if (widths.length === 0) return out
  const top = y + titleHeight
  const width = widths.reduce((sum, w) => sum + w, 0)
  const line = (x0: number, y0: number, x1: number, y1: number, weight: number): Primitive => ({ kind: 'path', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], strokeWidth: weight, over: true })
  const isTotal = (row: number) => content.total && row === content.rows.length - 1
  blocks.forEach((indices, b) => {
    const start = x + b * (width + gap)
    const bottom = top + rowHeight * (1 + indices.length)
    // On white, so that it reads over what is drawn under it.
    out.push({ kind: 'path', closed: true, fill: '#ffffff', points: [{ x: start, y: top }, { x: start + width, y: top }, { x: start + width, y: bottom }, { x: start, y: bottom }] })
    // The headings stand apart from the rows, and so does the total.
    indices.forEach((row, k) => out.push(line(start, top + rowHeight * (k + 1), start + width, top + rowHeight * (k + 1), k === 0 || isTotal(row) ? 1 : 0.5)))
    let left = start
    for (let i = 0; i < widths.length; i++) {
      if (i > 0) out.push(line(left, top, left, bottom, 0.5))
      const cell = (text: string, row: number, bold: boolean) => {
        if (!text) return
        const baseline = top + rowHeight * row + rowHeight / 2 + size * 0.35
        const right = content.numeric[i]
        out.push({ kind: 'text', x: right ? left + widths[i] - pad : left + pad, y: baseline, text, size, ...(right ? { align: 'right' as const } : {}), ...(bold ? { bold: true } : {}) })
      }
      cell(content.headings[i], 0, true)
      indices.forEach((row, k) => cell(content.rows[row][i], k + 1, isTotal(row)))
      if (symbol && i === content.symbols?.column) {
        indices.forEach((row, k) => {
          const object = content.symbols!.objects[row]
          if (object) out.push(...fitted(symbol(object), left + pad, top + rowHeight * (k + 1) + pad * 0.6, widths[i] - 2 * pad, rowHeight - 1.2 * pad))
        })
      }
      left += widths[i]
    }
  })
  return out
}

/** Primitives scaled to fit a box, from its top-left corner, and centred in it; kept in their own look, whatever the table's. */
function fitted(prims: Primitive[], x: number, y: number, width: number, height: number): Primitive[] {
  const box = prims.map(primitiveBounds).reduce<Bounds | null>(unionBounds, null)
  if (!box || width <= 0 || height <= 0) return []
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const scale = Math.min(w > 0 ? width / w : Infinity, h > 0 ? height / h : Infinity)
  if (!Number.isFinite(scale) || scale <= 0) return []
  const at = { x: x + width / 2 - ((box.minX + box.maxX) / 2) * scale, y: y + height / 2 - ((box.minY + box.maxY) / 2) * scale, scale }
  return prims.map((p) => ({ ...transformPrimitive(p, at), own: true }))
}
