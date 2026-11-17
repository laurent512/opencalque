import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, formatFeetInches, parseFeetInches, quantities, quantitiesCsv, Registry, type NodeInput, type Op } from '../src'

const inch = 25.4
const feet = (ft: number, inches = 0) => (ft * 12 + inches) * inch

describe('feet and inches', () => {
  it('writes a length the way a plan does, to the nearest fraction asked for', () => {
    expect(formatFeetInches(feet(7, 6))).toBe(`7' 6"`)
    expect(formatFeetInches(feet(7, 6.5))).toBe(`7' 6 1/2"`)
    expect(formatFeetInches(feet(7))).toBe(`7' 0"`)
    expect(formatFeetInches(feet(0, 6.5))).toBe(`6 1/2"`)
    expect(formatFeetInches(feet(0, 0.75))).toBe(`3/4"`)
    expect(formatFeetInches(feet(10, 0.25))).toBe(`10' 0 1/4"`)
    expect(formatFeetInches(0)).toBe(`0"`)
    expect(formatFeetInches(-feet(3, 2))).toBe(`-3' 2"`)
    // 2286 mm is 7.5 ft; a length in round millimetres comes out as the nearest sixteenth.
    expect(formatFeetInches(2286)).toBe(`7' 6"`)
    expect(formatFeetInches(1000)).toBe(`3' 3 3/8"`)
    // Rounding carries: just under a foot becomes the foot, not twelve inches.
    expect(formatFeetInches(feet(0, 11.99))).toBe(`1' 0"`)
    expect(formatFeetInches(feet(2, 3.3), 2)).toBe(`2' 3 1/2"`)
    expect(formatFeetInches(feet(2, 3.3), 32)).toBe(`2' 3 5/16"`)
  })

  it('rounds a length exactly half-way between two fractions up, every time', () => {
    // Stored in millimetres, these come back a hair above or below the tie; each must still round up.
    expect(formatFeetInches(feet(0, 3.375), 4)).toBe(`3 1/2"`)
    expect(formatFeetInches(feet(0, 3.625), 4)).toBe(`3 3/4"`)
    expect(formatFeetInches(feet(0, 6.625), 4)).toBe(`6 3/4"`)
    for (const denominator of [2, 4, 8, 16]) {
      for (let tie = 1; tie < 20 * 12 * denominator; tie++) {
        const mm = ((tie + 0.5) / denominator) * inch
        expect(formatFeetInches(mm, denominator)).toBe(formatFeetInches(((tie + 1) / denominator) * inch, denominator))
      }
    }
  })

  it('reads the ways people type it', () => {
    const read = (text: string, unmarked = false) => {
      const mm = parseFeetInches(text, unmarked)
      return mm === null ? null : Math.round((mm / inch) * 1000) / 1000
    }
    expect(read(`7'6"`)).toBe(90)
    expect(read(`7' 6"`)).toBe(90)
    expect(read(`7'-6"`)).toBe(90)
    expect(read(`7' 6 1/2"`)).toBe(90.5)
    expect(read(`7'6`)).toBe(90)
    expect(read(`7'`)).toBe(84)
    expect(read(`90"`)).toBe(90)
    expect(read(`6 1/2"`)).toBe(6.5)
    expect(read(`1/2"`)).toBe(0.5)
    expect(read(`3/4`)).toBe(0.75)
    expect(read('7 ft 6 in')).toBe(90)
    expect(read(`7’6”`)).toBe(90)
    expect(read(`-3' 2"`)).toBe(-38)
    expect(read(`7.5'`)).toBe(90)
    // A bare number is not feet and inches: the unit in use decides what it is.
    expect(read('7.5')).toBeNull()
    expect(read('7 6')).toBeNull()
    expect(read('7-6')).toBeNull()
    // Unless marks are optional, as when the unit is feet and inches.
    expect(read('7 6', true)).toBe(90)
    expect(read('7-6', true)).toBe(90)
    expect(read('7 6 1/2', true)).toBe(90.5)
    expect(read('7.5', true)).toBeNull()
    expect(read('walls')).toBeNull()
    expect(read(`1/0"`)).toBeNull()
    // What is written is read back as the same length.
    for (const mm of [feet(7, 6.5), feet(0, 0.75), feet(12), feet(3, 11.9375)]) expect(parseFeetInches(formatFeetInches(mm))).toBeCloseTo(mm, 6)
  })

  it('is a unit a dimension can show its length in', () => {
    const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
    const doc = applyOps(createDocument(), [
      add({ type: 'dimension', id: 'd', a: { x: 0, y: 0 }, b: { x: feet(7, 6.5), y: 0 }, offset: 300, unit: 'ft-in' }),
      add({ type: 'dimension', id: 'e', a: { x: 0, y: 1000 }, b: { x: feet(7, 6.3), y: 1000 }, offset: 300, unit: 'ft-in', fraction: 4 }),
    ])
    const text = (id: string) => buildScene(doc, 'page_1', new Registry()).find((item) => item.id === id)!.prims.find((p) => p.kind === 'text') as { text: string }
    expect(text('d').text).toBe(`7' 6 1/2"`)
    expect(text('e').text).toBe(`7' 6 1/4"`)
  })

  it('gives the quantities in feet, square feet and inches when asked', () => {
    const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
    // A wall ten feet long, eight inches thick, nine feet high.
    const doc = applyOps(createDocument(), [{ op: 'update_node', id: 'page_1', patch: { wallHeight: feet(9) } }, add({ type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: feet(10), y: 0 }, thickness: 8 * inch })])
    const csv = quantitiesCsv(quantities(doc, 'page_1', new Registry()), { system: 'imperial' })
    expect(csv).toContain('Length (ft)')
    expect(csv).toContain('Thickness (in)')
    expect(csv).toContain('Face area, net (ft²)')
    // Length 10 ft, thickness 8 in, height 9 ft, footprint 6.67 ft², no opening, face 90 ft², volume 60 ft³.
    // The figures are turned from metric ones already rounded, so they are held to a hundredth or so.
    const row = csv.split(/\r?\n/).find((line) => line.startsWith(',,'))!.split(',').slice(2).map(Number)
    const expected = [10, 8, 9, 6.67, 0, 90, 0, 90, 60]
    expected.forEach((value, i) => expect(Math.abs(row[i] - value)).toBeLessThan(0.05))
    // Metric stays what it was.
    expect(quantitiesCsv(quantities(doc, 'page_1', new Registry()))).toContain(',,3.048,203.2,2.743,')
  })
})
