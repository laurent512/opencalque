// Generates examples/apartment.opencalque: a small furnished flat that shows most of what a
// drawing can hold (walls, openings, rooms with floor patterns, components from the libraries,
// dimensions, annotations and a paper). Run with `pnpm example` after changing it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, componentsOf, createDocument, importComponents, parseDocument, serializeDocument, type Document, type NodeInput, type Op } from '@opencalque/core'

const here = dirname(fileURLToPath(import.meta.url))
const library = (name: string) => parseDocument(JSON.parse(readFileSync(join(here, `../../../apps/web/src/warehouse/components/${name}.opencalque`), 'utf8')))

let doc: Document = applyOps(createDocument('Apartment'), [
  { op: 'update_node', id: 'page_1', patch: { name: 'Ground floor' } },
  { op: 'update_layer', id: 'layer_1', patch: { name: 'Walls' } },
  { op: 'add_layer', layer: { id: 'rooms', name: 'Rooms' } },
  { op: 'add_layer', layer: { id: 'furniture', name: 'Furniture', color: '#5b6472' } },
  { op: 'add_layer', layer: { id: 'notes', name: 'Dimensions and notes', color: '#1d4ed8' } },
])

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
const wall = (ax: number, ay: number, bx: number, by: number, thickness: number) => add({ type: 'wall', layer: 'layer_1', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
/** A door or window on a wall: `turn` is the wall's direction, 0 along the sheet and 90 down it. */
const opening = (kind: string, x: number, y: number, turn: number, props: Record<string, unknown>) => add({ type: 'parametric', layer: 'layer_1', kind, x, y, rotation: turn, props })
const room = (name: string, x: number, y: number, pattern?: Record<string, unknown>) =>
  add({ type: 'room', layer: 'rooms', name, x, y, size: 220, ...(pattern ? { modifiers: [{ type: 'hatch', frame: { x: 0, y: 0 }, params: pattern }] } : {}) })

doc = applyOps(doc, [
  { op: 'set_document', info: { address: '12 rue des Lilas\n75020 Paris', author: 'OpenCalque' } },
  // The sheet first: an A3 lying, at 1:50.
  add({ type: 'paper', name: 'Ground floor', x: -5500, y: -4200, width: 21000, height: 14850, scale: 50, titleBlock: { date: '{date}', number: '{page-number} / {pages}' } }),
  // Outside walls, then the partitions: a hall behind the entrance, serving the living room, the bedroom and the bathroom.
  wall(0, 0, 10000, 0, 250),
  wall(10000, 0, 10000, 7000, 250),
  wall(10000, 7000, 0, 7000, 250),
  wall(0, 7000, 0, 0, 250),
  wall(6000, 0, 6000, 7000, 100),
  wall(6000, 3800, 10000, 3800, 100),
  wall(7600, 3800, 7600, 7000, 100),
  // The kitchen is open on the living room: a corner of it, marked off without walls.
  add({ type: 'divider', layer: 'rooms', a: { x: 0, y: 4300 }, b: { x: 3700, y: 4300 } }),
  add({ type: 'divider', layer: 'rooms', a: { x: 3700, y: 4300 }, b: { x: 3700, y: 7000 } }),

  opening('arch.door', 6350, 7000, 0, { width: 950, flip: true }),
  opening('arch.door', 6000, 4350, 90, { width: 850 }),
  opening('arch.door', 6350, 3800, 0, { width: 850, flip: true }),
  opening('arch.door', 7600, 4900, 90, { width: 750, flip: true }),
  opening('arch.window', 1400, 0, 0, { width: 2200, panes: 3 }),
  opening('arch.window', 7200, 0, 0, { width: 1600 }),
  opening('arch.window', 0, 1600, 90, { width: 1500 }),
  opening('arch.window', 1200, 7000, 0, { width: 1400 }),
  opening('arch.window', 10000, 5000, 90, { width: 800, panes: 1 }),

  room('Living room', 3000, 3300, { pattern: 'Planks', spacing: 180 }),
  room('Kitchen', 1800, 5300, { pattern: 'Tiles', spacing: 400 }),
  room('Bedroom', 6950, 2500, { pattern: 'Planks', spacing: 180, angle: 90 }),
  room('Bathroom', 8750, 5200, { pattern: 'Tiles', spacing: 300 }),
  room('Hall', 6800, 5450),

  add({ type: 'dimension', layer: 'notes', a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, offset: -900, unit: 'm', decimals: 2, showUnit: true, size: 200 }),
  add({ type: 'dimension', layer: 'notes', a: { x: 0, y: 7000 }, b: { x: 0, y: 0 }, offset: -900, unit: 'm', decimals: 2, showUnit: true, size: 200 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 1300, y: 3700 }, b: { x: -2300, y: 4100 }, text: 'Oak floor, oiled', bend: 0.12, size: 220 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 2550, y: 6450 }, b: { x: 3300, y: 8300 }, text: 'Induction hob', bend: 0.15, size: 220 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 6825, y: 7200 }, b: { x: 8100, y: 8300 }, text: 'Entrance', bend: -0.2, size: 220 }),
  add({ type: 'text', layer: 'notes', x: -4700, y: -2900, text: 'Apartment, ground floor', size: 520 }),
  add({ type: 'text', layer: 'notes', x: -4700, y: -2250, text: '70 m², two rooms. Scale 1:50', size: 260 }),
])

/** Copies components out of a library and returns a function that places them by name. */
function furnish(name: string) {
  const source = library(name)
  const result = importComponents(doc, source)
  doc = result.doc
  return (component: string, x: number, y: number, rotation = 0): Op => {
    const found = componentsOf(source).find((c) => c.name === component)
    if (!found) throw new Error(`No component called "${component}" in the ${name} library`)
    return add({ type: 'instance', layer: 'furniture', component: result.imported[found.id], x, y, rotation })
  }
}
const furniture = furnish('furniture')
const bathroom = furnish('bathroom')
const kitchen = furnish('kitchen')

doc = applyOps(doc, [
  furniture('Sofa, two seats', 500, 500),
  furniture('Coffee table, round', 850, 1650),
  furniture('Armchair', 2700, 1550, 90),
  furniture('Dining table, six chairs', 3500, 600),
  furniture('Double bed', 7800, 250),
  furniture('Wardrobe', 8050, 3100),
  kitchen('Fridge', 250, 6200),
  kitchen('Sink unit', 950, 6250),
  kitchen('Hob', 2250, 6250),
  kitchen('Base unit', 2950, 6250),
  bathroom('Washbasin', 7850, 3900),
  bathroom('Toilet', 8950, 3950),
  bathroom('Shower tray', 8950, 5950),
])

const out = join(here, '../../../examples/apartment.opencalque')
writeFileSync(out, serializeDocument(doc))
console.log(`Wrote ${Object.keys(doc.nodes).length} nodes to ${out}`)
