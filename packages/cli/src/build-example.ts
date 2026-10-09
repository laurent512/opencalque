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
  // The sheet first: an A3 lying, at 1:50.
  add({ type: 'paper', name: 'Ground floor', x: -5500, y: -4200, width: 21000, height: 14850, scale: 50, titleBlock: { author: 'OpenCalque', date: '2026-10-09', number: '01' } }),
  // Outside walls, then the partitions.
  wall(0, 0, 10000, 0, 250),
  wall(10000, 0, 10000, 7000, 250),
  wall(10000, 7000, 0, 7000, 250),
  wall(0, 7000, 0, 0, 250),
  wall(6000, 0, 6000, 7000, 100),
  wall(6000, 3800, 10000, 3800, 100),
  wall(8000, 3800, 8000, 7000, 100),
  add({ type: 'divider', layer: 'rooms', a: { x: 0, y: 4300 }, b: { x: 6000, y: 4300 } }),

  opening('arch.door', 10000, 4700, 90, { width: 950 }),
  opening('arch.door', 6000, 1400, 90, { width: 850 }),
  opening('arch.door', 6000, 5000, 90, { width: 850, hinge: 'Right' }),
  opening('arch.door', 8000, 5000, 90, { width: 750 }),
  opening('arch.window', 1400, 0, 0, { width: 2200, panes: 3 }),
  opening('arch.window', 7200, 0, 0, { width: 1600 }),
  opening('arch.window', 0, 1600, 90, { width: 1500 }),
  opening('arch.window', 1800, 7000, 0, { width: 1400 }),

  room('Living room', 3100, 3300, { pattern: 'Planks', spacing: 180 }),
  room('Kitchen', 3000, 5300, { pattern: 'Tiles', spacing: 400 }),
  room('Bedroom', 8700, 2750, { pattern: 'Planks', spacing: 180, angle: 90 }),
  room('Bathroom', 6680, 5250, { pattern: 'Tiles', spacing: 300 }),
  room('Entry', 9000, 6100),

  add({ type: 'dimension', layer: 'notes', a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, offset: -900, unit: 'm', decimals: 2, showUnit: true, size: 200 }),
  add({ type: 'dimension', layer: 'notes', a: { x: 0, y: 7000 }, b: { x: 0, y: 0 }, offset: -900, unit: 'm', decimals: 2, showUnit: true, size: 200 }),
  add({ type: 'dimension', layer: 'notes', a: { x: 6000, y: 7000 }, b: { x: 10000, y: 7000 }, offset: 800, unit: 'm', decimals: 2, showUnit: true, size: 200 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 1300, y: 3700 }, b: { x: -2300, y: 4100 }, text: 'Oak floor, oiled', bend: 0.12, size: 220 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 2600, y: 6450 }, b: { x: 3400, y: 8500 }, text: 'Induction hob', bend: 0.15, size: 220 }),
  add({ type: 'annotation', layer: 'notes', a: { x: 9900, y: 5150 }, b: { x: 11200, y: 4200 }, text: 'Entrance', bend: 0.2, size: 220 }),
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
  furniture('Wardrobe', 6200, 3100),
  kitchen('Fridge', 250, 6200),
  kitchen('Sink unit', 950, 6250),
  kitchen('Hob', 2250, 6250),
  kitchen('Base unit', 2950, 6250),
  kitchen('Base unit', 3650, 6250),
  bathroom('Toilet', 6250, 3950),
  bathroom('Washbasin', 7150, 3900),
  bathroom('Shower tray', 6100, 6000),
])

const out = join(here, '../../../examples/apartment.opencalque')
writeFileSync(out, serializeDocument(doc))
console.log(`Wrote ${Object.keys(doc.nodes).length} nodes to ${out}`)
