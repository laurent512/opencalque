import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, createDocument, Registry, transformOps, type Document, type Extension, type Op, type Similarity } from '../src'

const boxes: Extension = {
  id: 'test.boxes',
  name: 'Boxes',
  version: '1',
  activate: (api) =>
    api.registerParametric({
      kind: 'test.box',
      label: 'Box',
      params: [
        { key: 'width', label: 'Width', type: 'number', default: 1000, unit: 'length' },
        { key: 'steps', label: 'Steps', type: 'number', default: 4 },
      ],
      build: (props) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: props.width, y: 0 }] }],
    }),
}
const registry = new Registry().use(boxes)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const base = applyOps(createDocument(), [
  add({ type: 'line', id: 'line', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }),
  add({ type: 'wall', id: 'wall', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, thickness: 200 }),
  add({ type: 'rect', id: 'rect', x: 0, y: 0, width: 400, height: 200 }),
  add({ type: 'ellipse', id: 'oval', cx: 0, cy: 0, rx: 300, ry: 100 }),
  add({ type: 'text', id: 'label', x: 100, y: 100, text: 'ab', size: 100 }),
  add({ type: 'dimension', id: 'dim', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, offset: 300 }),
  add({ type: 'component', id: 'chair', parent: undefined, name: 'Chair' }),
  add({ type: 'rect', id: 'seat', parent: 'chair', x: 0, y: 0, width: 400, height: 400 }),
  add({ type: 'instance', id: 'placed', component: 'chair', x: 1000, y: 0 }),
  add({ type: 'parametric', id: 'box', kind: 'test.box', x: 500, y: 500, props: { width: 800 } }),
  add({ type: 'group', id: 'pair' }),
  add({ type: 'line', id: 'inner', parent: 'pair', a: { x: 0, y: 0 }, b: { x: 0, y: 1000 } }),
  add({ type: 'paper', id: 'sheet', x: 0, y: 0, width: 4200, height: 2970 }),
])
const node = (doc: Document, id: string) => doc.nodes[id] as any
const apply = (ids: string[], t: Similarity) => applyOps(base, transformOps(base, ids.map((id) => base.nodes[id]), t, registry))
const origin = { x: 0, y: 0 }

describe('transforming', () => {
  it('turns things clockwise about the pivot', () => {
    const doc = apply(['line', 'rect', 'oval', 'label', 'pair'], { pivot: origin, rotation: 90 })
    expect(node(doc, 'line')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 0, y: 1000 } })
    expect(node(doc, 'rect')).toMatchObject({ x: 0, y: 0, width: 400, height: 200, rotation: 90 })
    expect(node(doc, 'oval').rotation).toBe(90)
    expect(node(doc, 'label')).toMatchObject({ x: -100, y: 100, rotation: 90 })
    // A group is transformed through what it holds.
    expect(node(doc, 'inner')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: -1000, y: 0 } })
  })

  it('scales sizes that are part of the thing, and the lengths of a parametric object', () => {
    const doc = apply(['wall', 'label', 'placed', 'box', 'dim'], { pivot: origin, scale: 2 })
    expect(node(doc, 'wall')).toMatchObject({ b: { x: 4000, y: 0 }, thickness: 400 })
    expect(node(doc, 'label')).toMatchObject({ x: 200, y: 200, size: 200 })
    expect(node(doc, 'placed')).toMatchObject({ x: 2000, y: 0, scale: 2 })
    expect(node(doc, 'box')).toMatchObject({ x: 1000, y: 1000, props: { width: 1600 } })
    expect(node(doc, 'box').props.steps).toBeUndefined()
    expect(node(doc, 'dim')).toMatchObject({ b: { x: 2000, y: 0 }, offset: 600 })
  })

  it('draws a scaled instance at its new size', () => {
    const doc = apply(['placed'], { pivot: { x: 1000, y: 0 }, scale: 0.5 })
    const drawn = buildScene(doc, 'page_1', registry).find((item) => item.id === 'placed')!
    expect(boundsOf(drawn.prims)).toEqual({ minX: 1000, minY: 0, maxX: 1200, maxY: 200 })
  })

  it('mirrors left to right, keeping every shape where its reflection is', () => {
    const doc = apply(['rect', 'placed', 'dim', 'line'], { pivot: origin, mirror: true })
    expect(node(doc, 'line').b).toEqual({ x: -1000, y: 0 })
    // The rectangle covered x from 0 to 400; its reflection covers -400 to 0.
    expect(node(doc, 'rect')).toMatchObject({ x: -400, y: 0, width: 400, height: 200, rotation: 0 })
    expect(node(doc, 'placed')).toMatchObject({ x: -1000, y: 0, flipX: true })
    expect(node(doc, 'dim').offset).toBe(-300)
    // Twice is back where it started.
    const again = applyOps(doc, transformOps(doc, ['rect', 'placed'].map((id) => doc.nodes[id]), { pivot: origin, mirror: true }, registry))
    expect(node(again, 'rect')).toMatchObject({ x: 0, y: 0 })
    expect(node(again, 'placed')).toMatchObject({ x: 1000, flipX: false })
  })

  it('keeps a paper upright, swapping its sides on a quarter turn', () => {
    const doc = apply(['sheet'], { pivot: { x: 2100, y: 1485 }, rotation: 90 })
    expect(node(doc, 'sheet')).toMatchObject({ x: 615, y: -615, width: 2970, height: 4200 })
  })
})
