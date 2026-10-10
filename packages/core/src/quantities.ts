import { dist } from './geometry'
import type { Registry } from './registry'
import { roomAt } from './rooms'
import type { Document, NodeOf } from './schema'
import { leavesOf } from './document'
import { wallOpenings } from './walls'

/** One room of the plan: its name and the floor inside its walls, in m². */
export interface RoomQuantity {
  name: string
  area: number
}

/**
 * One wall, measured along its middle line. Lengths are in metres, the thickness in millimetres.
 * What needs a height (the area of its face, what its openings take out of it, its volume) is
 * null when the wall has none: a number that is not known is left out rather than guessed.
 */
export interface WallQuantity {
  id: string
  name: string
  /** The name of its wall type, or '' for a wall of no type. */
  type: string
  length: number
  thickness: number
  height: number | null
  /** The ground it stands on: length × thickness, in m². */
  footprint: number
  openings: number
  /** One face, openings included: length × height, in m². */
  gross: number | null
  /** What its doors and windows take out of that face, in m². An opening with no height takes its width over the whole height. */
  cut: number | null
  net: number | null
  /** Net face × thickness, in m³. */
  volume: number | null
}

/** A kind and size of door or window, and how many there are of it. */
export interface OpeningQuantity {
  kind: string
  label: string
  width: number
  height: number | null
  count: number
}

/** What a wall type adds up to over the plan, and each layer of its build-up with it. */
export interface WallTypeQuantity {
  name: string
  /** What the type says, or null when it leaves the thickness to each wall. */
  thickness: number | null
  length: number
  net: number | null
  /** Of its walls as they are, exceptions included. */
  volume: number | null
  layers: { name: string; thickness: number | null; area: number | null; volume: number | null }[]
}

export interface Quantities {
  rooms: RoomQuantity[]
  walls: WallQuantity[]
  openings: OpeningQuantity[]
  types: WallTypeQuantity[]
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const sum = (values: (number | null)[]): number | null => (values.some((v) => v === null) ? null : round((values as number[]).reduce((a, b) => a + b, 0)))

/**
 * What a page holds, counted and measured: the rooms with their floor area, the walls with their
 * length and, when a height is known, the area of their face less the doors and windows in them,
 * the doors and windows by kind and size, and the wall types with their layers. It is the first
 * step from a drawing to a budget.
 *
 * A wall's height is its own, or else its type's, or else the page's `wallHeight`. A wall is measured along its
 * middle line from end to end, so where two walls meet at a corner each counts to the corner's
 * middle point.
 */
export function quantities(doc: Document, pageId: string, registry: Registry): Quantities {
  const page = doc.nodes[pageId]
  const storey = page?.type === 'page' ? (page.wallHeight ?? null) : null
  const nodes = leavesOf(doc, pageId)

  const rooms = nodes
    .filter((node): node is NodeOf<'room'> => node.type === 'room')
    .map((room) => ({ name: room.name ?? '', area: round((roomAt(doc, room.parent, room)?.area ?? 0) / 1e6, 2) }))

  const kinds = new Map<string, OpeningQuantity>()
  const walls = nodes
    .filter((node): node is NodeOf<'wall'> => node.type === 'wall')
    .map((wall): WallQuantity => {
      const length = dist(wall.a, wall.b) / 1000
      const type = wall.wallType ? doc.wallTypes?.[wall.wallType] : undefined
      const height = wall.height ?? type?.height ?? storey
      const openings = wallOpenings(doc, wall, registry)
      let cut = 0
      for (const { node, from, to } of openings) {
        const kind = registry.parametric.get(node.kind)
        const props = kind ? registry.resolveProps(kind, node.props) : node.props
        const own = typeof props.height === 'number' && props.height > 0 ? props.height / 1000 : null
        const width = (to - from) / 1000
        // An opening taller than its wall takes no more than the wall has.
        if (height !== null) cut += width * Math.min(own ?? height / 1000, height / 1000)
        const key = `${node.kind} ${round(width)} ${own ?? ''}`
        const seen = kinds.get(key)
        if (seen) seen.count++
        else kinds.set(key, { kind: node.kind, label: kind?.label ?? node.kind, width: round(width), height: own === null ? null : round(own), count: 1 })
      }
      const gross = height === null ? null : (length * height) / 1000
      const net = gross === null ? null : Math.max(0, gross - cut)
      return {
        id: wall.id,
        name: wall.name ?? '',
        type: type?.name ?? '',
        length: round(length),
        thickness: wall.thickness,
        height: height === null ? null : round(height / 1000),
        footprint: round((length * wall.thickness) / 1000),
        openings: openings.length,
        gross: gross === null ? null : round(gross),
        cut: gross === null ? null : round(cut),
        net: net === null ? null : round(net),
        volume: net === null ? null : round((net * wall.thickness) / 1000),
      }
    })

  const types = Object.values(doc.wallTypes ?? {}).flatMap((type): WallTypeQuantity[] => {
    const of = walls.filter((wall) => wall.type === type.name)
    if (of.length === 0) return []
    const net = sum(of.map((wall) => wall.net))
    return [
      {
        name: type.name,
        thickness: type.thickness ?? null,
        length: round(of.reduce((total, wall) => total + wall.length, 0)),
        net,
        volume: sum(of.map((wall) => wall.volume)),
        layers: (type.layers ?? []).map((layer) => ({
          name: layer.name,
          thickness: layer.thickness ?? null,
          area: net,
          volume: net === null || layer.thickness === undefined ? null : round((net * layer.thickness) / 1000),
        })),
      },
    ]
  })

  return { rooms, walls, openings: [...kinds.values()].sort((a, b) => a.label.localeCompare(b.label) || a.width - b.width), types }
}

/** The words a quantities table is written with; an app passes them in the user's language. */
export interface QuantityLabels {
  rooms: string
  walls: string
  openings: string
  types: string
  layer: string
  name: string
  type: string
  kind: string
  count: string
  total: string
  area: string
  length: string
  thickness: string
  height: string
  width: string
  footprint: string
  gross: string
  cut: string
  net: string
  volume: string
}

export const QUANTITY_LABELS: QuantityLabels = {
  rooms: 'Rooms',
  walls: 'Walls',
  openings: 'Doors and windows',
  types: 'Wall types',
  layer: 'Layer',
  name: 'Name',
  type: 'Type',
  kind: 'Kind',
  count: 'Count',
  total: 'Total',
  area: 'Area (m²)',
  length: 'Length (m)',
  thickness: 'Thickness (mm)',
  height: 'Height (m)',
  width: 'Width (m)',
  footprint: 'Footprint (m²)',
  gross: 'Face area, gross (m²)',
  cut: 'Openings (m²)',
  net: 'Face area, net (m²)',
  volume: 'Volume (m³)',
}

/**
 * Quantities as a CSV file a spreadsheet opens: one table after another, each under its title.
 * `separator` and `decimal` follow what spreadsheets expect where the file will be opened (a
 * semicolon and a decimal comma in most of Europe). A value that is not known is an empty cell.
 */
export function quantitiesCsv(q: Quantities, options: { separator?: string; decimal?: string; labels?: QuantityLabels; name?: (kindLabel: string) => string } = {}): string {
  const { separator = ',', decimal = '.', labels: l = QUANTITY_LABELS, name = (label: string) => label } = options
  const cell = (value: string | number | null): string => {
    if (value === null) return ''
    if (typeof value === 'number') return String(value).replace('.', decimal)
    return /["\n\r]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value
  }
  const lines: string[] = []
  const table = (title: string, header: string[], rows: (string | number | null)[][]) => {
    if (lines.length > 0) lines.push('')
    lines.push(cell(title), header.map(cell).join(separator), ...rows.map((row) => row.map(cell).join(separator)))
  }
  table(l.rooms, [l.name, l.area], [...q.rooms.map((room) => [room.name, room.area]), [l.total, round(q.rooms.reduce((total, room) => total + room.area, 0), 2)]])
  table(
    l.walls,
    [l.name, l.type, l.length, l.thickness, l.height, l.footprint, l.count, l.gross, l.cut, l.net, l.volume],
    [
      ...q.walls.map((w) => [w.name, w.type, w.length, w.thickness, w.height, w.footprint, w.openings, w.gross, w.cut, w.net, w.volume]),
      [
        l.total,
        '',
        round(q.walls.reduce((total, w) => total + w.length, 0)),
        '',
        '',
        round(q.walls.reduce((total, w) => total + w.footprint, 0)),
        q.walls.reduce((total, w) => total + w.openings, 0),
        sum(q.walls.map((w) => w.gross)),
        sum(q.walls.map((w) => w.cut)),
        sum(q.walls.map((w) => w.net)),
        sum(q.walls.map((w) => w.volume)),
      ],
    ],
  )
  table(l.openings, [l.kind, l.width, l.height, l.count], [...q.openings.map((o) => [name(o.label), o.width, o.height, o.count]), [l.total, '', '', q.openings.reduce((total, o) => total + o.count, 0)]])
  if (q.types.length > 0) {
    table(
      l.types,
      [l.type, l.layer, l.thickness, l.length, l.net, l.volume],
      q.types.flatMap((type) => [
        [type.name, '', type.thickness, type.length, type.net, type.volume],
        ...type.layers.map((layer) => [type.name, layer.name, layer.thickness, '', layer.area, layer.volume]),
      ]),
    )
  }
  // The mark at the start tells a spreadsheet the file is in UTF-8, so accents and "²" come out right.
  return '﻿' + lines.join('\r\n') + '\r\n'
}
