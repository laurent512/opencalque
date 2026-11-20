import { applyEdit, createDocument, svgBox, toSVG, type Document, type Op } from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'
import { renderPng } from '../../cli/src/render'

/*
 * The drawings the tasks start from, and the operations that solve some of them. Every id is
 * fixed, so that a task can name the wall it means and a grader can find it again. Walls run
 * clockwise round each room, top, right, bottom, left, so that the inside of a room is on the
 * right face of each of its walls.
 */

/** The objects the app ships, as the assistant has them. */
export const registry = standardRegistry()

export const PAGE = 'page_1'

const drawing = (ops: Op[], name = 'Plan'): Document => applyEdit(createDocument(name), ops, registry).doc

const wall = (id: string, a: [number, number], b: [number, number], thickness: number, more: Record<string, unknown> = {}): Op =>
  ({ op: 'add_node', node: { type: 'wall', id, parent: PAGE, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, ...more } }) as Op

export const room = (id: string, name: string, x: number, y: number): Op => ({ op: 'add_node', node: { type: 'room', id, parent: PAGE, name, x, y } }) as Op

export const object = (id: string, kind: string, x: number, y: number, rotation = 0, props: Record<string, unknown> = {}, more: Record<string, unknown> = {}): Op =>
  ({ op: 'add_node', node: { type: 'parametric', id, parent: PAGE, kind, props, x, y, ...(rotation ? { rotation } : {}), ...more } }) as Op

/** Four walls on the lines of a rectangle (their middles), clockwise from the top left: `<prefix>_top`, `_right`, `_bottom`, `_left`. */
export function box(prefix: string, x0: number, y0: number, x1: number, y1: number, thickness: number): Op[] {
  return [
    wall(`${prefix}_top`, [x0, y0], [x1, y0], thickness),
    wall(`${prefix}_right`, [x1, y0], [x1, y1], thickness),
    wall(`${prefix}_bottom`, [x1, y1], [x0, y1], thickness),
    wall(`${prefix}_left`, [x0, y1], [x0, y0], thickness),
  ]
}

export const empty = () => createDocument('Plan')

/** A kitchen 4.8 × 3.8 m inside (18.24 m²), walls of 200 mm on the lines of 5 × 4 m. */
export const kitchenOps = (): Op[] => [...box('k', 0, 0, 5000, 4000, 200), room('kitchen', 'Kitchen', 2500, 2000)]
export const kitchen = () => drawing(kitchenOps())

/** The same kitchen with a 90 cm door in the top wall, from x 600 to 1500, opening inwards. */
export const kitchenWithDoor = () => drawing([...kitchenOps(), object('door', 'arch.door', 600, 0)])

/** The kitchen with its right wall 250 mm short of the bottom one: the room has no floor. */
export const openKitchen = () =>
  drawing([
    wall('k_top', [0, 0], [5000, 0], 200),
    wall('k_right', [5000, 0], [5000, 3750], 200),
    wall('k_bottom', [5000, 4000], [0, 4000], 200),
    wall('k_left', [0, 4000], [0, 0], 200),
    room('kitchen', 'Kitchen', 2500, 2000),
  ])

/** An office 3.8 × 2.8 m inside (10.64 m²), its door in the bottom wall from x 500 to 1400. */
export const office = () => drawing([...box('o', 0, 0, 4000, 3000, 200), object('door', 'arch.door', 1400, 3000, 180), room('office', 'Office', 2000, 1500)])

/** Two rooms side by side, 2.85 × 3.8 m each inside, parted by a 100 mm wall. */
export const twoRooms = () => drawing([...box('w', 0, 0, 6000, 4000, 200), wall('mid', [3000, 0], [3000, 4000], 100), room('room_a', 'Room A', 1500, 2000), room('room_b', 'Room B', 4500, 2000)])

/** A bedroom 4 × 3.5 m inside, its door in the bottom wall from x 300 to 1200, opening inwards. */
export const bedroomOps = (): Op[] => [...box('b', 0, 0, 4200, 3700, 200), object('door', 'arch.door', 1200, 3700, 180), room('bedroom', 'Bedroom', 2100, 1850)]
export const bedroom = () => drawing(bedroomOps())

/** A bed against the top wall, a bedside table each side of it and a wardrobe against the right wall. */
export const bedroomFurnitureOps = (): Op[] => [
  object('bed', 'furn.bed', 1300, 100),
  object('bedside_left', 'arch.bedside', 800, 100),
  object('bedside_right', 'arch.bedside', 2950, 100),
  // Its back against the right wall's inner face (x 4100), facing left.
  object('wardrobe', 'arch.wardrobe', 4100, 1000, 90),
]
export const furnishedBedroom = () => drawing([...bedroomOps(), ...bedroomFurnitureOps()])

/**
 * A flat 10 × 8 m outside, walls of 250 mm outside and 100 mm inside: the living room across the
 * bottom (south) half, two bedrooms of the same size above it.
 */
export const flatOps = (): Op[] => [
  ...box('f', 125, 125, 9875, 7875, 250),
  wall('f_across', [125, 4000], [9875, 4000], 100),
  wall('f_between', [5000, 125], [5000, 4000], 100),
  room('living', 'Living room', 5000, 5900),
  room('bedroom_1', 'Bedroom 1', 2600, 2100),
  room('bedroom_2', 'Bedroom 2', 7400, 2100),
]
export const flat = () => drawing(flatOps(), 'Flat')

/** The flat drawn as a picture at its real size, as a scan to trace, and nothing else. */
export function scannedFlat(): Document {
  const svg = toSVG(flat(), PAGE, registry)
  const area = svgBox(svg)
  const { png, width, height } = renderPng(svg, 1600)
  return drawing(
    [
      { op: 'add_asset', asset: { id: 'scan', mime: 'image/png', data: png.toString('base64'), width, height } },
      { op: 'add_node', node: { type: 'image', id: 'plan', name: 'Scanned plan', parent: PAGE, asset: 'scan', x: area.minX, y: area.minY, width: area.maxX - area.minX, height: area.maxY - area.minY, locked: true } },
    ] as Op[],
    'Scan',
  )
}
