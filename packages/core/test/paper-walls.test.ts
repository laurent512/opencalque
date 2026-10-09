import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildScene,
  createDocument,
  hitTest,
  moveOps,
  paintOrder,
  paperContents,
  paperFormat,
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
