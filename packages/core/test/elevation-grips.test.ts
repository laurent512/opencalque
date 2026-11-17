import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, elevationEdges, elevationItemsOf, elevationSideOps, elevationSides, nearestEdge, Registry, type Document, type NodeOf, type Op } from '../src'
import { viewNodes, type ViewSpec } from './view-nodes'

/*
 * Editing an object by the sides of the box an elevation draws it in (elevation-grips.ts): a unit
 * resized as a box, a door stretched by its ends, a window with a sill, a placement of a component.
 */
const registry = new Registry().use({
  id: 'test.grips',
  name: 'Grips',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({
      kind: 'test.unit',
      label: 'Unit',
      params: [
        { key: 'width', label: 'Width', type: 'number', default: 600 },
        { key: 'depth', label: 'Depth', type: 'number', default: 500 },
        { key: 'height', label: 'Height', type: 'number', default: 900 },
      ],
      mount: { on: 'floor' },
      height: ({ height }) => height,
      box: {
        bounds: ({ width, depth }) => ({ left: 0, top: 0, right: width, bottom: depth }),
        resize: (_, size) => ({ ...(size.width === undefined ? {} : { width: size.width }), ...(size.height === undefined ? {} : { depth: size.height }) }),
      },
      build: ({ width, depth }) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], closed: true }],
    })
    api.registerParametric({
      kind: 'test.door',
      label: 'Door',
      params: [
        { key: 'width', label: 'Width', type: 'number', default: 900 },
        { key: 'height', label: 'Height', type: 'number', default: 2000 },
      ],
      size: { x: 'width' },
      opening: ({ width }) => ({ from: 0, to: width }),
      build: ({ width }) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: width, y: 0 }] }],
    })
    api.registerParametric({
      kind: 'test.window',
      label: 'Window',
      params: [
        { key: 'width', label: 'Width', type: 'number', default: 1000 },
        { key: 'height', label: 'Height', type: 'number', default: 1200 },
        { key: 'sill', label: 'Sill height', type: 'number', default: 900 },
      ],
      size: { x: 'width' },
      sill: 'sill',
      opening: ({ width }) => ({ from: 0, to: width }),
      build: ({ width }) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: width, y: 0 }] }],
    })
  },
})

/**
 * A wall 6 m long along y = 0, its lower face at y = 100: a unit against it from x = 2000 to 2600,
 * 900 high; a door from 500 to 1400; a window from 4000 to 5000, its sill 900 high; a placement of a
 * component 1 m tall, its box 400 × 300, from x = 3000. Seen by an elevation of that face drawn with
 * its floor at y = 10 000, a point of the face drawn at the x it has on the plan.
 */
const plan = (): Document =>
  applyOps(createDocument('Plan'), [
    { op: 'add_node', node: { type: 'component', id: 'c', parent: null, height: 1000 } as never },
    { op: 'add_node', node: { type: 'rect', id: 'r', parent: 'c', x: 0, y: 0, width: 400, height: 300 } as never },
    ...[
      { type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
      { type: 'parametric', id: 'u', kind: 'test.unit', props: {}, x: 2000, y: 100 },
      { type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 500, y: 0 },
      { type: 'parametric', id: 'window', kind: 'test.window', props: {}, x: 4000, y: 0 },
      { type: 'instance', id: 'i', component: 'c', x: 3000, y: 150 },
      ...viewNodes({ id: 'e', a: { x: 0, y: 1100 }, b: { x: 6000, y: 1100 }, depth: 1000, x: 0, y: 10000 } as ViewSpec),
    ].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  ])

const shown = (doc: Document, id: string) => elevationItemsOf(doc, registry, id)[0]
const box = (doc: Document, id: string) => {
  const { minX, minY, maxX, maxY } = shown(doc, id).item.box
  return [minX, minY, maxX, maxY].map(Math.round)
}
const dragged = (doc: Document, id: string, side: 'left' | 'right' | 'top' | 'bottom', delta: number) => {
  const { view, item } = shown(doc, id)
  const ops = elevationSideOps(view, doc, registry, item, side, delta)
  expect(ops).not.toBeNull()
  return applyOps(doc, ops!)
}

describe('the sides of what an elevation shows', () => {
  it('are all dragged on a unit: its width by its left or right, the other staying, its height by its top, its underside by its bottom', () => {
    const doc = plan()
    expect(box(doc, 'u')).toEqual([2000, 9100, 2600, 10000])
    const { view, item } = shown(doc, 'u')
    expect(elevationSides(view, doc, registry, item)).toEqual(['left', 'right', 'top', 'bottom'])
    expect(box(dragged(doc, 'u', 'right', 100), 'u')).toEqual([2000, 9100, 2700, 10000])
    expect(box(dragged(doc, 'u', 'left', -100), 'u')).toEqual([1900, 9100, 2600, 10000])
    expect(box(dragged(doc, 'u', 'top', 200), 'u')).toEqual([2000, 8900, 2600, 10000])
    // Its bottom raised 300: 300 above the floor, its top where it was.
    const raised = dragged(doc, 'u', 'bottom', 300)
    expect(box(raised, 'u')).toEqual([2000, 9100, 2600, 9700])
    expect(raised.nodes.u).toMatchObject({ z: 300, props: { height: 600 } })
    // Never through the floor, nor past its own top.
    expect(box(dragged(doc, 'u', 'bottom', -500), 'u')).toEqual([2000, 9100, 2600, 10000])
    expect(box(dragged(doc, 'u', 'bottom', 5000), 'u')).toEqual([2000, 9100, 2600, 9101])
  })

  it('stretch a door along its wall by its ends and make it taller, its bottom staying on the floor', () => {
    const doc = plan()
    const { view, item } = shown(doc, 'door')
    expect(elevationSides(view, doc, registry, item)).toEqual(['left', 'right', 'top'])
    expect((dragged(doc, 'door', 'right', 100).nodes.door as NodeOf<'parametric'>).props.width).toBe(1000)
    expect(dragged(doc, 'door', 'left', -100).nodes.door).toMatchObject({ x: 400, props: { width: 1000 } })
  })

  it('raise the sill of a window by its bottom, its top staying', () => {
    const doc = plan()
    const raised = dragged(doc, 'window', 'bottom', 100)
    expect(raised.nodes.window).toMatchObject({ props: { sill: 1000, height: 1100 } })
  })

  it('stretch a placement of a component across and make the component taller', () => {
    const doc = plan()
    const { view, item } = shown(doc, 'i')
    expect(elevationSides(view, doc, registry, item)).toEqual(['left', 'right', 'top', 'bottom'])
    expect(box(dragged(doc, 'i', 'right', 200), 'i')).toEqual([3000, 9000, 3600, 10000])
    expect(dragged(doc, 'i', 'top', 100).nodes.c).toMatchObject({ height: 1100 })
    expect(dragged(doc, 'i', 'bottom', 100).nodes.i).toMatchObject({ z: 100 })
  })
})

describe('what an elevation leaves out', () => {
  it('is what the plan does not show: an object hidden, on a hidden layer or in a hidden group, a hidden wall', () => {
    const doc = applyOps(plan(), [
      { op: 'add_layer', layer: { id: 'kitchen', name: 'Kitchen', order: 'a5' } },
      { op: 'update_node', id: 'u', patch: { layer: 'kitchen' } },
    ])
    expect(shown(doc, 'u')).toBeDefined()
    expect(shown(applyOps(doc, [{ op: 'update_layer', id: 'kitchen', patch: { visible: false } }]), 'u')).toBeUndefined()
    expect(shown(applyOps(doc, [{ op: 'update_node', id: 'door', patch: { visible: false } }]), 'door')).toBeUndefined()
    const grouped = applyOps(doc, [
      { op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1', visible: false } as never },
      { op: 'update_node', id: 'i', patch: { parent: 'g' } },
    ])
    expect(shown(grouped, 'i')).toBeUndefined()
    // The wall hidden: its face, and the door and window in it, are not drawn.
    const bare = applyOps(doc, [{ op: 'update_node', id: 'w', patch: { visible: false } }])
    expect(shown(bare, 'door')).toBeUndefined()
    expect(shown(bare, 'window')).toBeUndefined()
  })
})

describe('lining up in an elevation', () => {
  it('offers the sides and tops of the other objects, the walls, the floor and the ends of the view', () => {
    const doc = plan()
    const edges = elevationEdges(shown(doc, 'u').view, doc, registry, 'u')
    expect(edges.xs).toEqual(expect.arrayContaining([500, 1400, 3000, 3400, 4000, 5000, 0, 6000]))
    expect(edges.xs).not.toContain(2600)
    expect(edges.ys).toEqual(expect.arrayContaining([10000, 9000, 8000]))
    expect(edges.middles).toEqual(expect.arrayContaining([3200]))
  })

  it('moves edges onto the nearest one within reach', () => {
    expect(nearestEdge([2000, 2600], [2990, 1400], 20)).toBeNull()
    expect(nearestEdge([2000, 2600], [2610, 1985], 20)).toEqual({ delta: 10, at: 2610 })
    expect(nearestEdge([2000, 2600], [2604, 1990], 20)).toEqual({ delta: 4, at: 2604 })
  })
})
