import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, dimensionLabel, drawingSettingsOps, roomArea, settingsOf, tableContent, unitless, type Document, type NodeOf, type Op } from '../src'
import { houseDoc, registry, wall } from './support/house'

/** One room of 4.67 × 3.67 m between faces, a table of its rooms worded in French, and a dimension. */
const house: Document = applyOps(
  houseDoc([
    wall('n', [0, 0], [5000, 0], 330),
    wall('e', [5000, 0], [5000, 4000], 330),
    wall('s', [5000, 4000], [0, 4000], 330),
    wall('w', [0, 4000], [0, 0], 330),
    { type: 'room', id: 'room', name: 'Séjour', x: 2500, y: 2000 },
  ]),
  [
    { op: 'add_node', node: { type: 'table', id: 'table', parent: 'page_1', layer: 'layer_1', x: 7000, y: 0, schedule: 'rooms', labels: { name: 'Nom', area: 'Surface ({unit})' } } as never },
    { op: 'add_node', node: { type: 'dimension', id: 'dim', parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 1250, y: 0 }, offset: 500, unit: 'm' } as never },
  ],
)

const set = (doc: Document, ops: Op[]) => applyOps(doc, ops)
/** What the room writes under its name. */
const area = (doc: Document) =>
  buildScene(doc, 'page_1', registry)
    .find((item) => item.node.id === 'room')!
    .prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []))[1]
const table = (doc: Document) => tableContent(doc.nodes.table as NodeOf<'table'>, doc, registry)

describe('drawing settings', () => {
  it('are metric with a decimal point unless the drawing says otherwise', () => {
    expect(settingsOf(house)).toEqual({ system: 'metric', decimal: '.' })
    expect(area(house)).toBe('17.14 m²')
    expect(table(house).headings).toEqual(['Nom', 'Surface (m²)'])
  })

  it('give rooms, tables and dimensions their units and decimal mark', () => {
    const doc = set(house, [{ op: 'set_document', settings: { system: 'imperial', decimal: ',' } }])
    expect(area(doc)).toBe('184,48 ft²')
    expect(table(doc).headings).toEqual(['Nom', 'Surface (ft²)'])
    // A table converts the area it measured to the hundredth of a m² (17.14), hence a hundredth more.
    expect(table(doc).rows[0]).toEqual(['Séjour', '184,49'])
    expect(dimensionLabel({ unit: 'm' }, 1250, doc.settings)).toBe('1,25')
  })

  it('give way to what a room or a table says of its own', () => {
    const doc = set(house, [
      { op: 'set_document', settings: { decimal: ',' } },
      { op: 'update_node', id: 'room', patch: { decimal: '.' } },
    ])
    expect(area(doc)).toBe('17.14 m²')
    expect(roomArea({}, 17.14e6, doc.settings)).toBe('17,14 m²')
  })

  it('are stored only where they differ from the usual, and refuse what they cannot be', () => {
    const doc = set(house, [{ op: 'set_document', settings: { decimal: ',' } }])
    expect(set(doc, [{ op: 'set_document', settings: { decimal: null } }]).settings).toBeUndefined()
    expect(() => set(house, [{ op: 'set_document', settings: { decimal: ';' as never } }])).toThrow(/"\." or ","/)
    expect(() => set(house, [{ op: 'set_document', settings: { unit: 'ft' } as never }])).toThrow(/Unknown drawing setting/)
  })

  it('once changed, are followed by everything that wrote its numbers its own way', () => {
    // Rooms, tables and dimensions placed before 1.4 carried their own, and tables wrote their unit in their words.
    const before = set(house, [
      { op: 'update_node', id: 'room', patch: { system: 'metric', decimal: '.' } },
      { op: 'update_node', id: 'table', patch: { system: 'metric', decimal: '.', labels: { name: 'Nom', area: 'Surface (m²)' } } },
      { op: 'update_node', id: 'dim', patch: { decimal: '.' } },
      { op: 'add_dimension_style', dimensionStyle: { id: 'plan', name: 'Plan', decimal: '.' } },
    ])
    const doc = set(before, drawingSettingsOps(before, { system: 'imperial', decimal: ',' }))
    expect(doc.settings).toEqual({ system: 'imperial', decimal: ',' })
    expect(area(doc)).toBe('184,48 ft²')
    expect(doc.nodes.table).toMatchObject({ labels: { name: 'Nom', area: 'Surface ({unit})' } })
    expect(table(doc).headings).toEqual(['Nom', 'Surface (ft²)'])
    expect((doc.nodes.dim as NodeOf<'dimension'>).decimal).toBeUndefined()
    expect(doc.dimensionStyles?.plan.decimal).toBeUndefined()
    // Back to the usual, nothing is stored.
    expect(set(doc, drawingSettingsOps(doc, { system: 'metric', decimal: '.' })).settings).toBeUndefined()
  })

  it('leave alone what does not name a setting changed', () => {
    const doc = set(house, [{ op: 'update_node', id: 'room', patch: { system: 'imperial' } }])
    expect(drawingSettingsOps(doc, { decimal: ',' })).toEqual([{ op: 'set_document', settings: { decimal: ',' } }])
  })
})

describe('a room', () => {
  it('writes how far it is round its floor under its area when asked, in the units of the drawing', () => {
    const texts = (doc: Document) =>
      buildScene(doc, 'page_1', registry)
        .find((item) => item.node.id === 'room')!
        .prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []))
    const shown = set(house, [{ op: 'update_node', id: 'room', patch: { showPerimeter: true } }])
    // 2 × (4.67 + 3.67) m.
    expect(texts(shown)).toEqual(['Séjour', '17.14 m²', '16.68 m'])
    expect(texts(set(shown, [{ op: 'set_document', settings: { system: 'imperial', decimal: ',' } }]))).toEqual(['Séjour', '184,48 ft²', '54,72 ft'])
    expect(texts(set(shown, [{ op: 'update_node', id: 'room', patch: { showArea: false } }]))).toEqual(['Séjour', '16.68 m'])
  })
})

describe('the words of a table', () => {
  it('say "{unit}" where they named the unit, alone and the last time', () => {
    expect(unitless('Surface (m²)', 'area', 'metric')).toBe('Surface ({unit})')
    expect(unitless('Somme (m)', 'length', 'metric')).toBe('Somme ({unit})')
    expect(unitless('Longueur m ou m', 'length', 'metric')).toBe('Longueur m ou {unit}')
    // A unit inside a word, or with a power after it, is not the unit of a length.
    expect(unitless('Mètres m²', 'length', 'metric')).toBe('Mètres m²')
    expect(unitless('Nom', 'name', 'metric')).toBe('Nom')
  })
})
