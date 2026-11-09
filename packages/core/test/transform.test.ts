import { describe, expect, it } from 'vitest'
import { applyOps, applyTransform, inverseOf, inverseTransform, boundsOf, buildScene, createDocument, frameGrips, frameMiddle, Registry, transformOps, turnedBox, turnToOps, type Document, type Extension, type Op, type Similarity, type Transform } from '../src'

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

describe('turning to an angle typed in the properties panel', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_node', node: { id: 'chair', type: 'component' } },
    { op: 'add_node', node: { id: 'seat', type: 'rect', parent: 'chair', x: 1000, y: 500, width: 400, height: 200 } },
    add({ type: 'rect', id: 'box', x: 0, y: 0, width: 400, height: 200 }),
    add({ type: 'instance', id: 'placed', component: 'chair', x: 5000, y: 0, flipX: true }),
    add({ type: 'text', id: 'label', text: 'Hall', x: 0, y: 3000, size: 200 }),
  ] as Op[])
  const middle = (d: Document, id: string) => {
    const box = boundsOf(buildScene(d, 'page_1', registry).find((item) => item.id === id)!.prims)!
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  }
  const turn = (d: Document, id: string, degrees: number) => applyOps(d, turnToOps(d, [d.nodes[id]], degrees, registry))

  it('turns a rectangle about its middle, not its corner', () => {
    const doc30 = turn(doc, 'box', 30)
    expect((doc30.nodes.box as { rotation: number }).rotation).toBe(30)
    expect(middle(doc30, 'box').x).toBeCloseTo(200, 6)
    expect(middle(doc30, 'box').y).toBeCloseTo(100, 6)
  })

  it('turns a component about the middle of what it draws, mirrored or not, without drifting from one angle to the next', () => {
    const before = middle(doc, 'placed')
    let d = doc
    for (const degrees of [30, 75, 200, 0]) {
      d = turn(d, 'placed', degrees)
      expect((d.nodes.placed as { rotation?: number }).rotation ?? 0).toBeCloseTo(degrees, 6)
      expect((d.nodes.placed as { flipX?: boolean }).flipX).toBe(true)
    }
    // Back at 0° about a point that never moved, it is where it was, to a millionth of a millimetre a turn.
    expect((d.nodes.placed as { x: number }).x).toBeCloseTo(5000, 4)
    expect((d.nodes.placed as { y: number }).y).toBeCloseTo(0, 4)
    const after = turn(doc, 'placed', 90)
    expect(middle(after, 'placed').x).toBeCloseTo(before.x, 6)
    expect(middle(after, 'placed').y).toBeCloseTo(before.y, 6)
  })

  it('turns a text about its middle, and does nothing at the angle it already has', () => {
    const before = middle(doc, 'label')
    const d = turn(doc, 'label', 90)
    expect(middle(d, 'label').x).toBeCloseTo(before.x, 3)
    expect(middle(d, 'label').y).toBeCloseTo(before.y, 3)
    expect(turnToOps(d, [d.nodes.label], 450, registry)).toEqual([])
  })
})

describe('the box around a turned object', () => {
  // A mark whose insertion point is not its middle, as a compass with its letter above it.
  const marks = new Registry().use({
    id: 'test.marks',
    name: 'Marks',
    version: '1',
    activate: (api) =>
      api.registerParametric({
        kind: 'test.mark',
        label: 'Mark',
        params: [],
        build: () => [{ kind: 'path', closed: true, points: [{ x: -100, y: -300 }, { x: 100, y: -300 }, { x: 100, y: 100 }, { x: -100, y: 100 }] }],
      }),
  })
  const doc = applyOps(createDocument(), [add({ type: 'parametric', id: 'mark', kind: 'test.mark', props: {}, x: 1000, y: 1000 })])

  it('is the box the object fills while it is not turned', () => {
    expect(turnedBox(doc, doc.nodes.mark, marks)).toEqual({ origin: { x: 900, y: 700 }, rotation: 0, width: 200, height: 400 })
  })

  it('keeps its shape and its middle at any angle, its corners on the corners of the object', () => {
    for (const degrees of [30, 90, 200]) {
      const d = applyOps(doc, turnToOps(doc, [doc.nodes.mark], degrees, marks))
      const box = turnedBox(d, d.nodes.mark, marks)!
      expect(box.rotation).toBeCloseTo(degrees, 6)
      expect(box.width).toBeCloseTo(200, 4)
      expect(box.height).toBeCloseTo(400, 4)
      expect(frameMiddle(box).x).toBeCloseTo(1000, 4)
      expect(frameMiddle(box).y).toBeCloseTo(900, 4)
      const corner = applyTransform({ x: -100, y: -300 }, d.nodes.mark as { x: number; y: number; rotation?: number })
      expect(frameGrips(box)[0].x).toBeCloseTo(corner.x, 4)
      expect(frameGrips(box)[0].y).toBeCloseTo(corner.y, 4)
    }
  })
})

describe('undoing a placement', () => {
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 9)
    expect(a.y).toBeCloseTo(b.y, 9)
  }
  const points = [
    { x: 0, y: 0 },
    { x: 1200, y: -350 },
    { x: -40.5, y: 777 },
  ]

  it('brings back every point a placement moved, turned, mirrored or scaled', () => {
    const placements: Transform[] = [
      { x: 3000, y: 1500 },
      { x: -200, y: 40, rotation: 30 },
      { x: 10, y: 20, rotation: 135, flipX: true },
      { x: 500, y: -900, rotation: 270, scale: 2.5 },
      { x: 7, y: 8, flipX: true, scale: 0.5, rotation: 12 },
      // Stretched along its own axes, unturned or turned half round.
      { x: 100, y: 200, scaleX: 1.5, scaleY: 0.8 },
      { x: 100, y: 200, scaleX: 2, scale: 1.2, rotation: 180, flipX: true },
    ]
    for (const t of placements) {
      const back = inverseOf(t)!
      expect(back).not.toBeNull()
      for (const p of points) {
        near(applyTransform(applyTransform(p, t), back), p)
        near(applyTransform(p, back), inverseTransform(p, t))
      }
    }
  })

  it('has none for a placement stretched and turned, or squashed flat', () => {
    expect(inverseOf({ x: 0, y: 0, scaleX: 2, rotation: 30 })).toBeNull()
    expect(inverseOf({ x: 0, y: 0, scaleY: 0.5, rotation: 90 })).toBeNull()
    expect(inverseOf({ x: 0, y: 0, scale: 0 })).toBeNull()
  })
})
