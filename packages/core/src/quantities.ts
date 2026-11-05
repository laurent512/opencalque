import { applyTransform, len, sub, type Vec2 } from './geometry'
import type { Registry } from './registry'
import { roomAt } from './rooms'
import type { Document, Node, NodeOf } from './schema'
import { childrenOf, isVisible, leavesOf } from './document'
import { listedAsModel, variantLabel, variantsOf, type VariantDetail } from './variants'
import { wallLength, wallOpenings } from './walls'

/** One room of the plan: its name and the floor inside its walls, in m², and the material of that floor ('' for none). */
export interface RoomQuantity {
  /** The room's id: a room placed several times, in a component, is listed once for each placement under the same id. */
  id: string
  name: string
  area: number
  /** In metres: round its floor, along the faces of its walls, doors included, not round what stands inside it. */
  perimeter: number
  material: string
  /** The id of that material, or '' for none. */
  materialId: string
}

/** The floors of one material, added up over the rooms: '' for the floors of no material. */
export interface FloorQuantity {
  /** The material's id, or '' for none. */
  id: string
  material: string
  rooms: number
  area: number
}

/**
 * The walls of one material and one thickness: how long they run (m), their face (m², the net
 * face of the walls) and their volume (m³). What needs a height is null when one of them has
 * none. The material is '' for walls of the default material.
 */
export interface MaterialQuantity {
  material: string
  /** In mm. */
  thickness: number
  length: number
  area: number | null
  volume: number | null
}

/** A thing placed on the plan, and how many times: each component, and each kind of parametric object. */
export interface ObjectQuantity {
  kind: 'component' | 'parametric'
  /** The component's id, or the key of the parametric object's model: its kind and parameters (`variantKey`). */
  id: string
  /** The component's name, or the parametric kind's label, in English. */
  name: string
  count: number
  /** For a parametric object: its kind, its parameters, and those that tell it apart from the other models of its kind counted. */
  of?: string
  props?: Record<string, unknown>
  detail?: VariantDetail[]
}

/** What a thing counted is called: a component by its name, a parametric object by its kind and what tells its model apart (`variantLabel`), in the words `translate` gives. */
export function objectLabel(o: ObjectQuantity, translate: (text: string) => string = (text) => text): string {
  return o.kind === 'parametric' ? variantLabel(o.name, o.detail ?? [], translate) : o.name
}

/**
 * One wall, measured along its middle line. Lengths are in metres, the thickness in millimetres.
 * What needs a height (the area of its face, what its openings take out of it, its volume) is
 * null when the wall has none: a number that is not known is left out rather than guessed.
 */
export interface WallQuantity {
  id: string
  name: string
  /** The name of its material, or '' for the default one. */
  material: string
  /** The id of its material, or '' for the default one. */
  materialId: string
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

export interface Quantities {
  rooms: RoomQuantity[]
  walls: WallQuantity[]
  openings: OpeningQuantity[]
  floors: FloorQuantity[]
  materials: MaterialQuantity[]
  objects: ObjectQuantity[]
}

/** How deep placements of components inside components are counted, as they are drawn. */
const MAX_DEPTH = 8

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const sum = (values: (number | null)[]): number | null => (values.some((v) => v === null) ? null : round((values as number[]).reduce((a, b) => a + b, 0)))

/**
 * What a page holds, counted and measured: the rooms with their floor area, the walls with their
 * length and, when a height is known, the area of their face less the doors and windows in them,
 * the doors and windows by kind and size, the floors and the walls by material, and the
 * objects placed. It is the first step from a drawing to a budget.
 *
 * What the components placed on the page hold counts too, once for each placement and at the size
 * it is drawn: a floor of a building drawn as a component and placed on the page is measured with
 * the page. A wall's height is its own, or else the page's `wallHeight`. A wall is measured along
 * its middle line from end to end, so where two walls meet at a corner each counts to the corner's
 * middle point.
 */
export function quantities(doc: Document, pageId: string, registry: Registry): Quantities {
  const page = doc.nodes[pageId]
  const storey = page?.type === 'page' ? (page.wallHeight ?? null) : null
  const nodes = leavesOf(doc, pageId)
  const all = placedOn(doc, nodes)

  // A material is told by its id: two of one name are counted apart.
  const materialId = (id: string | undefined) => (id !== undefined && doc.materials?.[id] ? id : '')
  const materialName = (id: string | undefined) => (id === undefined ? '' : (doc.materials?.[id]?.name ?? ''))
  const rooms = all.flatMap(({ node: room, map }): RoomQuantity[] => {
    if (room.type !== 'room') return []
    const region = roomAt(doc, room.parent, room)
    // Round the outline as it is drawn where it is placed: stretched, a side is longer.
    const perimeter = region ? region.outline.reduce((total, p, i) => total + len(apply(map, sub(region.outline[(i + 1) % region.outline.length], p))), 0) : 0
    return [{ id: room.id, name: room.name ?? '', area: round(((region?.area ?? 0) * Math.abs(det(map))) / 1e6, 2), perimeter: round(perimeter / 1000, 2), material: materialName(room.material), materialId: materialId(room.material) }]
  })
  const floors = new Map<string, FloorQuantity>()
  for (const room of rooms) {
    const seen = floors.get(room.materialId)
    if (seen) {
      seen.rooms++
      seen.area = round(seen.area + room.area, 2)
    } else floors.set(room.materialId, { id: room.materialId, material: room.material, rooms: 1, area: room.area })
  }

  const kinds = new Map<string, OpeningQuantity>()
  const made = new Map<string, MaterialQuantity & { unknown: boolean }>()
  const walls = all
    .filter((one): one is { node: NodeOf<'wall'>; map: Linear } => one.node.type === 'wall')
    .map(({ node: wall, map }): WallQuantity => {
      // How much longer it is drawn than it is, where a component holding it is stretched (along its
      // chord, for a curved wall); its thickness is what keeps the area of its footprint as drawn.
      const along = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y }
      const chord = Math.hypot(along.x, along.y)
      const drawn = apply(map, along)
      const stretch = chord < 1e-9 ? Math.sqrt(Math.abs(det(map))) : Math.hypot(drawn.x, drawn.y) / chord
      const thick = stretch > 0 ? (wall.thickness * Math.abs(det(map))) / stretch : wall.thickness
      // Round the curve, for a curved wall.
      const length = (wallLength(wall) * stretch) / 1000
      const height = wall.height ?? storey
      const openings = wallOpenings(doc, wall, registry)
      let cut = 0
      for (const { node, from, to } of openings) {
        const kind = registry.parametric.get(node.kind)
        const props = kind ? registry.resolveProps(kind, node.props) : node.props
        const own = typeof props.height === 'number' && props.height > 0 ? props.height / 1000 : null
        const width = ((to - from) * stretch) / 1000
        // An opening taller than its wall takes no more than the wall has.
        if (height !== null) cut += width * Math.min(own ?? height / 1000, height / 1000)
        const key = `${node.kind} ${round(width)} ${own ?? ''}`
        const seen = kinds.get(key)
        if (seen) seen.count++
        else kinds.set(key, { kind: node.kind, label: kind?.label ?? node.kind, width: round(width), height: own === null ? null : round(own), count: 1 })
      }
      const gross = height === null ? null : (length * height) / 1000
      const net = gross === null ? null : Math.max(0, gross - cut)
      // What it is made of, at its thickness, over its face.
      const material = materialName(wall.material)
      const thickness = round(thick, 1)
      const key = `${materialId(wall.material)} ${thickness}`
      const seen = made.get(key) ?? { material, thickness, length: 0, area: 0, volume: 0, unknown: false }
      seen.length += length
      if (net === null) seen.unknown = true
      else {
        seen.area! += net
        seen.volume! += (net * thick) / 1000
      }
      made.set(key, seen)
      return {
        id: wall.id,
        name: wall.name ?? '',
        material,
        materialId: materialId(wall.material),
        length: round(length),
        thickness: round(thick, 1),
        height: height === null ? null : round(height / 1000),
        footprint: round((length * thick) / 1000),
        openings: openings.length,
        gross: gross === null ? null : round(gross),
        cut: gross === null ? null : round(cut),
        net: net === null ? null : round(net),
        volume: net === null ? null : round((net * thick) / 1000),
      }
    })

  const materials = [...made.values()]
    .map(({ unknown, ...layer }): MaterialQuantity => ({ ...layer, length: round(layer.length), area: unknown ? null : round(layer.area!), volume: unknown ? null : round(layer.volume!) }))
    .sort((a, b) => a.material.localeCompare(b.material) || a.thickness - b.thickness)

  return {
    rooms,
    walls,
    openings: [...kinds.values()].sort((a, b) => a.label.localeCompare(b.label) || a.width - b.width),
    floors: [...floors.values()].sort((a, b) => a.material.localeCompare(b.material)),
    materials,
    objects: objectsOn(doc, nodes, registry),
  }
}

/**
 * The components and parametric objects placed among `nodes`, with how many times each is: a
 * component placed inside another counts once for each placement of that other, as it is drawn.
 * Parametric objects count by model (`variantsOf`): a radiator of 80 cm apart from one of 1.20 m;
 * doors, windows, stairs and what is written on the plan are not counted here (`listedAsModel`).
 * What is hidden is not counted.
 */
function objectsOn(doc: Document, nodes: Node[], registry: Registry): ObjectQuantity[] {
  const found = new Map<string, ObjectQuantity>()
  const objects: NodeOf<'parametric'>[] = []
  const visit = (list: Node[], depth: number) => {
    for (const node of list) {
      if (!isVisible(doc, node)) continue
      if (node.type === 'parametric' && listedAsModel(node.kind, registry)) objects.push(node)
      if (node.type !== 'instance') continue
      const component = doc.nodes[node.component]
      if (component?.type !== 'component') continue
      const seen = found.get(component.id)
      if (seen) seen.count++
      else found.set(component.id, { kind: 'component', id: component.id, name: component.name ?? '', count: 1 })
      if (depth < MAX_DEPTH) visit(inside(doc, component.id), depth + 1)
    }
  }
  visit(nodes, 1)
  const models = variantsOf(objects, registry).map((v): ObjectQuantity => ({ kind: 'parametric', id: v.key, name: v.label, count: v.count, of: v.kind, props: v.props, detail: v.detail }))
  // By name, numbers by their value: a radiator of 800 before one of 1200.
  return [...found.values(), ...models].sort((a, b) => objectLabel(a).localeCompare(objectLabel(b), undefined, { numeric: true }))
}

/** A linear map of the plane, by the columns of its matrix: how what a component holds is turned, mirrored and stretched where it is placed. */
type Linear = [number, number, number, number]
const IDENTITY: Linear = [1, 0, 0, 1]
const apply = (m: Linear, v: Vec2): Vec2 => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y })
const det = (m: Linear) => m[0] * m[3] - m[2] * m[1]

/**
 * What lies among `nodes`, and what the components placed there hold, however deep, each with how
 * it is drawn there: once for each placement of the component that holds it. What a placement
 * hides is not counted.
 */
function placedOn(doc: Document, nodes: Node[]): { node: Node; map: Linear }[] {
  const out: { node: Node; map: Linear }[] = []
  const visit = (list: Node[], map: Linear, depth: number) => {
    for (const node of list) {
      if (depth > 1 && !isVisible(doc, node)) continue
      out.push({ node, map })
      if (node.type !== 'instance' || depth >= MAX_DEPTH || !isVisible(doc, node)) continue
      const component = doc.nodes[node.component]
      if (component?.type !== 'component') continue
      const placing = { x: 0, y: 0, rotation: node.rotation, flipX: node.flipX, scale: node.scale, scaleX: node.scaleX, scaleY: node.scaleY }
      const [u, v] = [apply(map, applyTransform({ x: 1, y: 0 }, placing)), apply(map, applyTransform({ x: 0, y: 1 }, placing))]
      visit(inside(doc, component.id), [u.x, u.y, v.x, v.y], depth + 1)
    }
  }
  visit(nodes, IDENTITY, 1)
  return out
}

/** What a component holds, with groups opened up. */
const inside = (doc: Document, id: string): Node[] => childrenOf(doc, id).flatMap((node) => (node.type === 'group' ? inside(doc, node.id) : [node]))

/** The words a quantities table is written with; an app passes them in the user's language. */
export interface QuantityLabels {
  rooms: string
  walls: string
  openings: string
  floors: string
  materials: string
  objects: string
  material: string
  /** What stands for no material. */
  none: string
  name: string
  kind: string
  count: string
  total: string
  area: string
  /** Round a room's floor. */
  perimeter: string
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
  floors: 'Floors',
  materials: 'Walls by material',
  objects: 'Objects',
  material: 'Material',
  none: '—',
  name: 'Name',
  kind: 'Kind',
  count: 'Count',
  total: 'Total',
  area: 'Area (m²)',
  perimeter: 'Perimeter (m)',
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

/** The same words for a table in feet and inches. */
export const IMPERIAL_QUANTITY_LABELS: QuantityLabels = {
  ...QUANTITY_LABELS,
  area: 'Area (ft²)',
  perimeter: 'Perimeter (ft)',
  length: 'Length (ft)',
  thickness: 'Thickness (in)',
  height: 'Height (ft)',
  width: 'Width (ft)',
  footprint: 'Footprint (ft²)',
  gross: 'Face area, gross (ft²)',
  cut: 'Openings (ft²)',
  net: 'Face area, net (ft²)',
  volume: 'Volume (ft³)',
}

/** Quantities as `quantities` measures them, or turned to feet, square feet, cubic feet and inches. */
export const quantitiesIn = (q: Quantities, system: 'metric' | 'imperial'): Quantities => (system === 'imperial' ? imperial(q) : q)

/** Quantities measured in metres, square metres, cubic metres and millimetres, turned to feet, square feet, cubic feet and inches. */
function imperial(q: Quantities): Quantities {
  const scaled = (factor: number, digits: number) => (value: number) => round(value * factor, digits)
  const maybe = (convert: (value: number) => number) => (value: number | null) => (value === null ? null : convert(value))
  const ft = scaled(1 / 0.3048, 2)
  const ft2 = scaled(1 / 0.3048 ** 2, 2)
  const ft3 = scaled(1 / 0.3048 ** 3, 2)
  const inches = scaled(1 / 25.4, 2)
  return {
    rooms: q.rooms.map((room) => ({ ...room, area: ft2(room.area), perimeter: ft(room.perimeter) })),
    walls: q.walls.map((w) => ({ ...w, length: ft(w.length), thickness: inches(w.thickness), height: maybe(ft)(w.height), footprint: ft2(w.footprint), gross: maybe(ft2)(w.gross), cut: maybe(ft2)(w.cut), net: maybe(ft2)(w.net), volume: maybe(ft3)(w.volume) })),
    openings: q.openings.map((o) => ({ ...o, width: ft(o.width), height: maybe(ft)(o.height) })),
    floors: q.floors.map((floor) => ({ ...floor, area: ft2(floor.area) })),
    materials: q.materials.map((m) => ({ ...m, thickness: inches(m.thickness), length: ft(m.length), area: maybe(ft2)(m.area), volume: maybe(ft3)(m.volume) })),
    objects: q.objects,
  }
}

/**
 * Quantities as a CSV file a spreadsheet opens: one table after another, each under its title.
 * `separator` and `decimal` follow what spreadsheets expect where the file will be opened (a
 * semicolon and a decimal comma in most of Europe). With `system: 'imperial'` the lengths are in
 * feet, the areas in square feet, the volumes in cubic feet and the thicknesses in inches. A value
 * that is not known is an empty cell.
 */
export function quantitiesCsv(
  given: Quantities,
  options: { separator?: string; decimal?: string; labels?: QuantityLabels; name?: (kindLabel: string) => string; system?: 'metric' | 'imperial' } = {},
): string {
  const { separator = ',', decimal = '.', name = (label: string) => label, system = 'metric' } = options
  const l = options.labels ?? (system === 'imperial' ? IMPERIAL_QUANTITY_LABELS : QUANTITY_LABELS)
  const q = system === 'imperial' ? imperial(given) : given
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
  table(
    l.rooms,
    [l.name, l.area, l.perimeter],
    [...q.rooms.map((room) => [room.name, room.area, room.perimeter]), [l.total, round(q.rooms.reduce((total, room) => total + room.area, 0), 2), round(q.rooms.reduce((total, room) => total + room.perimeter, 0), 2)]],
  )
  table(
    l.walls,
    [l.name, l.material, l.length, l.thickness, l.height, l.footprint, l.count, l.gross, l.cut, l.net, l.volume],
    [
      ...q.walls.map((w) => [w.name, w.material, w.length, w.thickness, w.height, w.footprint, w.openings, w.gross, w.cut, w.net, w.volume]),
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
  if (q.floors.some((floor) => floor.material !== '')) {
    table(l.floors, [l.material, l.rooms, l.area], [...q.floors.map((f) => [f.material || l.none, f.rooms, f.area]), [l.total, q.floors.reduce((total, f) => total + f.rooms, 0), round(q.floors.reduce((total, f) => total + f.area, 0), 2)]])
  }
  if (q.materials.length > 0) table(l.materials, [l.material, l.thickness, l.length, l.net, l.volume], q.materials.map((m) => [m.material || l.none, m.thickness, m.length, m.area, m.volume]))
  if (q.objects.length > 0) table(l.objects, [l.name, l.count], [...q.objects.map((o) => [objectLabel(o, name), o.count]), [l.total, q.objects.reduce((total, o) => total + o.count, 0)]])
  // The mark at the start tells a spreadsheet the file is in UTF-8, so accents and "²" come out right.
  return '﻿' + lines.join('\r\n') + '\r\n'
}
