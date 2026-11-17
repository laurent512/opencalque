import { describe, expect, it } from 'vitest'
import {
  applyOps,
  paperRescaled,
  buildScene,
  createDocument,
  hitTest,
  moveOps,
  paintOrder,
  PAPER_FORMATS,
  paperContents,
  paperFormat,
  paperScaleTo,
  paperSize,
  Registry,
  wallEndFollowOps,
  wallFollowOps,
  type Extension,
  type Op,
} from '../src'

const doors: Extension = {
  id: 'test.doors',
  name: 'Doors',
  version: '1',
  activate: (api) =>
    api.registerParametric({
      kind: 'test.door',
      label: 'Door',
      params: [{ key: 'width', label: 'Width', type: 'number', default: 900 }],
      opening: (props) => ({ from: 0, to: props.width }),
      build: (props) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: props.width, y: 0 }] }],
    }),
}
const registry = new Registry().use(doors)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })

describe('paper', () => {
  const doc = applyOps(createDocument(), [
    add({ type: 'rect', id: 'inside', x: 1000, y: 1000, width: 500, height: 500 }),
    add({ type: 'rect', id: 'across', x: 41000, y: 1000, width: 5000, height: 500 }),
    add({ type: 'rect', id: 'outside', x: 60000, y: 0, width: 500, height: 500 }),
    add({ type: 'paper', id: 'sheet', name: 'Paper 01', x: 0, y: 0, width: 42000, height: 29700, scale: 100 }),
  ])
  const scene = buildScene(doc, 'page_1', registry)

  it('knows the standard sheets at a drawing scale', () => {
    expect(paperSize('A3', true, 100)).toEqual({ width: 42000, height: 29700 })
    expect(paperSize('A4', false, 50)).toEqual({ width: 10500, height: 14850 })
    expect(paperFormat({ width: 42000, height: 29700, scale: 100 })).toEqual({ name: 'A3', landscape: true })
    expect(paperFormat({ width: 29700, height: 42000 })).toEqual({ name: 'A3', landscape: false })
    expect(paperFormat({ width: 30000, height: 20000, scale: 100 })).toBeNull()
  })

  it('knows the US sheets, ARCH and ANSI, to the tenth of a millimetre', () => {
    const inches = (name: string) => {
      const sheet = PAPER_FORMATS.find((f) => f.name === name)!
      return [sheet.short / 25.4, sheet.long / 25.4].map((n) => Math.round(n * 1000) / 1000)
    }
    expect(['ARCH A', 'ARCH B', 'ARCH C', 'ARCH D', 'ARCH E1', 'ARCH E'].map(inches)).toEqual([[9, 12], [12, 18], [18, 24], [24, 36], [30, 42], [36, 48]])
    expect(['ANSI A', 'ANSI B', 'ANSI C', 'ANSI D', 'ANSI E'].map(inches)).toEqual([[8.5, 11], [11, 17], [17, 22], [22, 34], [34, 44]])
    // A 24 × 36 lying at 1/4" = 1'-0" (1:48) is 914.4 × 609.6 mm of paper, 48 times that in the drawing.
    const archD = paperSize('ARCH D', true, 48)!
    expect(archD.width).toBeCloseTo(43891.2, 6)
    expect(archD.height).toBeCloseTo(29260.8, 6)
    expect(paperFormat({ ...archD, scale: 48 })).toEqual({ name: 'ARCH D', landscape: true })
    // A sheet drawn to that size by hand, to the millimetre, is still one.
    expect(paperFormat({ width: 24 * 25.4 * 50 + 10, height: 36 * 25.4 * 50, scale: 50 })).toEqual({ name: 'ARCH D', landscape: false })
  })

  it('tells every standard sheet from every other, either way up', () => {
    expect(new Set(PAPER_FORMATS.map((f) => f.name)).size).toBe(PAPER_FORMATS.length)
    for (const sheet of PAPER_FORMATS)
      for (const landscape of [false, true]) expect(paperFormat({ ...paperSize(sheet.name, landscape, 100)!, scale: 100 })).toEqual({ name: sheet.name, landscape })
    // Each series smallest first, as the formats are offered.
    for (const series of ['ISO', 'ARCH', 'ANSI']) {
      const longs = PAPER_FORMATS.filter((f) => f.series === series).map((f) => f.long)
      expect(longs).toEqual([...longs].sort((a, b) => a - b))
    }
  })

  it('changes scale, not shape, when a corner is pulled', () => {
    const sheet = { x: 0, y: 0, width: 42000, height: 29700, scale: 100 }
    // The bottom right corner pulled out, off the diagonal: the top left stays, the sheet is still an A3.
    const larger = paperScaleTo(sheet, 2, { x: 84500, y: 50000 })
    expect(larger).toEqual({ x: 0, y: 0, width: 84000, height: 59400, scale: 200 })
    expect(paperFormat(larger)).toEqual({ name: 'A3', landscape: true })
    // The top left corner pulled in: the bottom right stays.
    expect(paperScaleTo(sheet, 0, { x: 21000, y: 14850 })).toEqual({ x: 21000, y: 14850, width: 21000, height: 14850, scale: 50 })
    // Pulled past the opposite corner, it stops at 1:1 rather than turning inside out.
    expect(paperScaleTo(sheet, 2, { x: -5000, y: -5000 }).scale).toBe(1)
  })

  it('given a scale, covers more or less of the drawing about its middle, whatever its size', () => {
    // A sheet of no standard size, 200 × 100 mm at 1:50: at 1:100 it is the same sheet, twice as large in the drawing.
    expect(paperRescaled({ x: 0, y: 0, width: 10000, height: 5000, scale: 50 }, 100)).toEqual({ x: -5000, y: -2500, width: 20000, height: 10000, scale: 100 })
    // As pulling a corner does, but with the middle staying.
    const a3 = { x: 0, y: 0, width: 42000, height: 29700, scale: 100 }
    const typed = paperRescaled(a3, 200)
    expect([typed.width, typed.height]).toEqual([paperScaleTo(a3, 2, { x: 84000, y: 59400 }).width, paperScaleTo(a3, 2, { x: 84000, y: 59400 }).height])
    expect(paperFormat(typed)).toEqual({ name: 'A3', landscape: true })
  })

  it('holds what lies entirely on it, by position', () => {
    expect(paperContents(scene, 'sheet')).toEqual(['inside'])
    expect(paperContents(scene, 'inside')).toEqual([])
  })

  it('is painted beneath everything, even though it was added last', () => {
    const [first] = paintOrder(scene.flatMap((item) => item.prims))
    expect(first.prim.backdrop).toBe(true)
  })

  it('is picked by its edge, while a click inside it reaches what is drawn there or nothing', () => {
    expect(hitTest(scene, { x: 20000, y: 0 }, 50)?.id).toBe('sheet')
    expect(hitTest(scene, { x: 20000, y: 15000 }, 50)).toBeNull()
    expect(hitTest(scene, { x: 1000, y: 1200 }, 50)?.id).toBe('inside')
  })
})

describe('walls that stay joined', () => {
  // A room, with a door in its top wall and one wall standing apart.
  const doc = applyOps(createDocument(), [
    wall('top', 0, 0, 4000, 0),
    wall('right', 4000, 0, 4000, 3000),
    wall('bottom', 4000, 3000, 0, 3000),
    wall('left', 0, 3000, 0, 0),
    wall('apart', 8000, 0, 8000, 3000),
    add({ type: 'parametric', id: 'door', kind: 'test.door', x: 1000, y: 0, props: {} }),
    add({ type: 'parametric', id: 'loose', kind: 'test.door', x: 1000, y: 6000, props: {} }),
  ])
  const node = (d: typeof doc, id: string) => d.nodes[id] as any

  it('stretches the walls that meet a moved wall, and takes its door along', () => {
    const d = { x: 0, y: -1000 }
    const moved = applyOps(doc, [...moveOps(doc, doc.nodes.top, d), ...wallFollowOps(doc, [doc.nodes.top], d, registry)])
    expect(node(moved, 'top').a).toEqual({ x: 0, y: -1000 })
    // The side walls keep their far ends and reach up to the moved corners.
    expect(node(moved, 'right')).toMatchObject({ a: { x: 4000, y: -1000 }, b: { x: 4000, y: 3000 } })
    expect(node(moved, 'left')).toMatchObject({ a: { x: 0, y: 3000 }, b: { x: 0, y: -1000 } })
    expect(node(moved, 'bottom')).toMatchObject(node(doc, 'bottom'))
    expect(node(moved, 'apart')).toMatchObject(node(doc, 'apart'))
    expect(node(moved, 'door')).toMatchObject({ x: 1000, y: -1000 })
    expect(node(moved, 'loose')).toMatchObject({ x: 1000, y: 6000 })
  })

  it('leaves alone what is being moved as well', () => {
    const all = ['top', 'right', 'bottom', 'left', 'door'].map((id) => doc.nodes[id])
    expect(wallFollowOps(doc, all, { x: 500, y: 0 }, registry)).toEqual([])
  })

  it('brings the walls that end at a dragged corner along with it', () => {
    const p = { x: 4500, y: -500 }
    // End `b` of the top wall is the corner it shares with the right wall.
    expect(wallEndFollowOps(doc, doc.nodes.top, 1, p)).toEqual([{ op: 'update_node', id: 'right', patch: { a: p } }])
    expect(wallEndFollowOps(doc, doc.nodes.apart, 0, p)).toEqual([])
  })
})
