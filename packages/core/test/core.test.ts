import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildScene,
  childrenOf,
  componentPlacements,
  componentsOf,
  createComponent,
  createDocument,
  detachInstance,
  freeComponentName,
  hitTest,
  groupNodes,
  importComponents,
  moveOps,
  ungroupNode,
  ordersAt,
  replaceWithOps,
  cloneOps,
  compileExpression,
  copyNodes,
  declarativeExtension,
  pasteNodes,
  toDXF,
  paintOrder,
  withoutAssets,
  snapOpeningToWall,
  parseDocument,
  Registry,
  serializeDocument,
  toSVG,
  unusedComponents,
  type Document,
  type Extension,
  type Op,
} from '../src'

const boxes: Extension = {
  id: 'test.boxes',
  name: 'Boxes',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({
      kind: 'test.box',
      label: 'Box',
      params: [{ key: 'size', label: 'Size', type: 'number', default: 100 }],
      build: ({ size }) => [
        { kind: 'path', closed: true, points: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }] },
      ],
    })
    api.registerParametric({
      kind: 'test.gap',
      label: 'Gap',
      params: [{ key: 'width', label: 'Width', type: 'number', default: 900 }],
      opening: ({ width }) => ({ from: 0, to: width }),
      build: ({ width }, env) => [{ kind: 'text', x: 0, y: 0, text: `${width}/${env.wallThickness}`, size: 10 }],
    })
  },
}
const registry = new Registry().use(boxes)
const wall = (id: string, ax: number, ay: number, bx: number, by: number): Op => ({
  op: 'add_node',
  node: { type: 'wall', id, parent: 'page_1', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 },
})

describe('operations', () => {
  it('adds nodes on top of their siblings and leaves the input untouched', () => {
    const doc = createDocument()
    const next = applyOps(doc, [wall('w1', 0, 0, 1000, 0), wall('w2', 0, 0, 0, 1000)])
    expect(childrenOf(next, 'page_1').map((n) => n.id)).toEqual(['w1', 'w2'])
    expect(childrenOf(doc, 'page_1')).toEqual([])
  })

  it('is all or nothing', () => {
    const doc = createDocument()
    expect(() => applyOps(doc, [wall('w1', 0, 0, 1000, 0), { op: 'remove_node', id: 'missing' }])).toThrow(/Unknown node/)
  })

  it('patches properties, removes them with null, and rejects invalid results', () => {
    let doc = applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0)])
    doc = applyOps(doc, [{ op: 'update_node', id: 'w1', patch: { name: 'North', thickness: 300 } }])
    expect(doc.nodes.w1).toMatchObject({ name: 'North', thickness: 300 })
    doc = applyOps(doc, [{ op: 'update_node', id: 'w1', patch: { name: null } }])
    expect('name' in doc.nodes.w1).toBe(false)
    expect(() => applyOps(doc, [{ op: 'update_node', id: 'w1', patch: { thickness: -1 } }])).toThrow(/Invalid node/)
    expect(() => applyOps(doc, [{ op: 'update_node', id: 'w1', patch: { type: 'line' } }])).toThrow(/cannot be changed/)
  })

  it('removes a component together with its children and instances', () => {
    let doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'component', id: 'c' } },
      { op: 'add_node', node: { type: 'rect', id: 'r', parent: 'c', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add_node', node: { type: 'instance', id: 'i', parent: 'page_1', component: 'c', x: 0, y: 0 } },
    ])
    doc = applyOps(doc, [{ op: 'remove_node', id: 'c' }])
    expect(Object.keys(doc.nodes)).toEqual(['page_1'])
  })

  it('refuses a component that would contain itself', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'component', id: 'a' } },
      { op: 'add_node', node: { type: 'component', id: 'b' } },
      { op: 'add_node', node: { type: 'instance', parent: 'a', component: 'b', x: 0, y: 0 } },
    ])
    const loop: Op = { op: 'add_node', node: { type: 'instance', parent: 'b', component: 'a', x: 0, y: 0 } }
    expect(() => applyOps(doc, [loop])).toThrow(/instance of itself/)
  })

  it('moves the nodes of a removed layer to the first remaining one', () => {
    let doc = applyOps(createDocument(), [
      { op: 'add_layer', layer: { id: 'l2', name: 'Two' } },
      { op: 'add_node', node: { type: 'line', id: 'n', parent: 'page_1', layer: 'l2', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } },
    ])
    doc = applyOps(doc, [{ op: 'remove_layer', id: 'l2' }])
    expect(doc.nodes.n.layer).toBe('layer_1')
    expect(() => applyOps(doc, [{ op: 'remove_layer', id: 'layer_1' }])).toThrow(/last layer/)
  })
})

describe('documents', () => {
  it('round-trips through JSON', () => {
    const doc = applyOps(createDocument('Plan'), [wall('w1', 0, 0, 1000, 0)])
    expect(parseDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc)
  })

  it('puts a node whose parent is missing on the first page', () => {
    const doc = applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0)])
    const broken = { ...doc, nodes: { ...doc.nodes, w1: { ...doc.nodes.w1, parent: 'nope' } } }
    expect(parseDocument(broken).nodes.w1.parent).toBe('page_1')
  })
})

describe('scene', () => {
  it('lengthens walls that share an endpoint so the corner closes', () => {
    const doc = applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0), wall('w2', 1000, 0, 1000, 1000)])
    const [w1] = buildScene(doc, 'page_1', registry)
    expect(w1.bounds).toEqual({ minX: 0, minY: -100, maxX: 1100, maxY: 100 })
  })

  it('mitres walls meeting at an angle so they tile the joint', () => {
    const doc = applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0), wall('w2', 1000, 0, 2000, 1000)])
    const [w1, w2] = buildScene(doc, 'page_1', registry)
    const points = (item: typeof w1) => (item.prims[0].kind === 'path' ? item.prims[0].points : [])
    const near = (p: { x: number; y: number }, x: number, y: number) => Math.hypot(p.x - x, p.y - y) < 1e-6
    // Both outlines pass through the joint and share the same inner and outer corners.
    const k = 100 * Math.tan(Math.PI / 8)
    for (const [x, y] of [[1000, 0], [1000 + k, -100], [1000 - k, 100]]) {
      expect(points(w1).some((p) => near(p, x, y))).toBe(true)
      expect(points(w2).some((p) => near(p, x, y))).toBe(true)
    }
  })

  it('joins three walls at one point without overlap', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 1000, 0), wall('e', 1000, 0, 2000, 0), wall('s', 1000, 0, 1000, 1000)])
    const [w, , s] = buildScene(doc, 'page_1', registry)
    expect(w.bounds).toEqual({ minX: 0, minY: -100, maxX: 1000, maxY: 100 })
    expect(s.bounds).toEqual({ minX: 900, minY: 0, maxX: 1100, maxY: 1000 })
  })

  it('cuts a wall where an opening sits on it and tells the opening the wall thickness', () => {
    const gap = (x: number, y: number): Op => ({
      op: 'add_node',
      node: { type: 'parametric', parent: 'page_1', kind: 'test.gap', props: {}, x, y },
    })
    const doc = applyOps(createDocument(), [wall('w1', 0, 0, 3000, 0), gap(1000, 0), gap(1000, 500)])
    const [w1, on, off] = buildScene(doc, 'page_1', registry)
    expect(w1.prims.map((p) => (p.kind === 'path' ? [p.points[0].x, p.points[2].x] : null))).toEqual([[0, 1000], [1900, 3000]])
    expect(on.prims[0]).toMatchObject({ text: '900/200' })
    expect(off.prims[0]).toMatchObject({ text: '900/undefined' })
  })

  it('snaps an opening onto the nearest wall, centred, turned along it and facing the cursor', () => {
    const doc = applyOps(createDocument(), [wall('w1', 0, 0, 0, 3000)])
    const node = { kind: 'test.gap', props: {} }
    expect(snapOpeningToWall(doc, 'page_1', registry, node, { x: 60, y: 1512 }, 50, 100)).toEqual({ x: 0, y: 2000, rotation: 270 })
    expect(snapOpeningToWall(doc, 'page_1', registry, node, { x: -60, y: 1512 }, 50, 100)).toEqual({ x: 0, y: 1100, rotation: 90 })
    expect(snapOpeningToWall(doc, 'page_1', registry, node, { x: 400, y: 1500 }, 50, 100)).toBeNull()
  })

  it('hit-tests the topmost unlocked object', () => {
    let doc = applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0), wall('w2', 0, 0, 1000, 0)])
    expect(hitTest(buildScene(doc, 'page_1', registry), { x: 500, y: 50 }, 1)?.id).toBe('w2')
    doc = applyOps(doc, [{ op: 'update_node', id: 'w2', patch: { locked: true } }])
    expect(hitTest(buildScene(doc, 'page_1', registry), { x: 500, y: 50 }, 1)?.id).toBe('w1')
    expect(hitTest(buildScene(doc, 'page_1', registry), { x: 500, y: 500 }, 1)).toBeNull()
  })

  it('hit-tests what is nearest the point before what is drawn over it a little way off', () => {
    // A wall, and over it a line that passes 4 mm above its top face: within reach of a click on the face.
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 1000, 0), { op: 'add_node', node: { type: 'line', id: 'l', parent: 'page_1', a: { x: 0, y: -104 }, b: { x: 1000, y: -104 } } }])
    const scene = buildScene(doc, 'page_1', registry)
    expect(hitTest(scene, { x: 500, y: -100 }, 5)?.id).toBe('w')
    expect(hitTest(scene, { x: 500, y: -50 }, 5)?.id).toBe('w')
    expect(hitTest(scene, { x: 500, y: -104 }, 5)?.id).toBe('l')
    // Seen in the same place, within a fifth of the reach of each other, the one on top is taken.
    expect(hitTest(scene, { x: 500, y: -102 }, 5)?.id).toBe('l')
  })

  it('picks an object by its inside even when it is only an outline, and a plain shape by its line', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'rect', id: 'frame', parent: 'page_1', x: -500, y: -500, width: 1000, height: 1000 } },
      { op: 'add_node', node: { type: 'parametric', id: 'box', parent: 'page_1', kind: 'test.box', props: {}, x: 0, y: 0 } },
    ])
    const scene = buildScene(doc, 'page_1', registry)
    const box = scene.find((item) => item.id === 'box')!.bounds!
    const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
    expect(hitTest(scene, middle, 1)?.id).toBe('box')
    // The unfilled rectangle around it is picked by its edge only.
    expect(hitTest(scene, { x: -400, y: -400 }, 1)).toBeNull()
    expect(hitTest(scene, { x: -500, y: -400 }, 1)?.id).toBe('frame')
  })

  it('draws parametric objects from extensions and keeps unknown kinds as placeholders', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'parametric', id: 's', parent: 'page_1', kind: 'test.box', props: {}, x: 50, y: 0, rotation: 90 } },
      { op: 'add_node', node: { type: 'parametric', id: 'u', parent: 'page_1', kind: 'other.thing', props: {}, x: 0, y: 0 } },
    ])
    const [box, unknown] = buildScene(doc, 'page_1', registry)
    expect(box.bounds?.minX).toBeCloseTo(-50)
    expect(box.bounds?.maxY).toBeCloseTo(100)
    expect(unknown.prims.some((p) => p.kind === 'text' && p.text === 'other.thing')).toBe(true)
  })
})

describe('groups', () => {
  const two = (): Document => applyOps(createDocument(), [wall('w1', 0, 0, 1000, 0), wall('w2', 1000, 0, 1000, 1000), wall('w3', 5000, 0, 6000, 0)])
  const ids = (doc: Document, parent = 'page_1') => childrenOf(doc, parent).map((n) => n.id)

  it('groups nodes in place and ungroups them back in the same order', () => {
    const { doc, groupId } = groupNodes(two(), ['w2', 'w1'])
    expect(ids(doc)).toEqual([groupId, 'w3'])
    expect(ids(doc, groupId)).toEqual(['w1', 'w2'])
    const [group] = buildScene(doc, 'page_1', registry)
    expect(group.bounds).toEqual({ minX: 0, minY: -100, maxX: 1100, maxY: 1000 })
    expect(hitTest(buildScene(doc, 'page_1', registry), { x: 500, y: 0 }, 1)?.id).toBe(groupId)
    const back = ungroupNode(doc, groupId)
    expect(ids(back.doc)).toEqual(['w1', 'w2', 'w3'])
    expect(back.doc.nodes[groupId]).toBeUndefined()
  })

  it('ungroups, detaches and moves up or down among siblings that share an order key', () => {
    // Siblings may share a key (two people adding at once, an older drawing): nothing goes between two that do.
    const tied = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'rect', id: 'r1', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1', order: 'a1' } },
      { op: 'add_node', node: { type: 'rect', id: 'in', parent: 'g', x: 0, y: 0, width: 10, height: 10 } },
      { op: 'add_node', node: { type: 'rect', id: 'r2', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 10, height: 10 } },
    ])
    const back = ungroupNode(tied, 'g')
    expect(back.doc.nodes.in.parent).toBe('page_1')
    const { doc: placed, instanceId } = createComponent(tied, registry, ['r1'], 'Box')
    const moved = applyOps(placed, [{ op: 'update_node', id: instanceId, patch: { order: 'a1' } }])
    expect(() => detachInstance(moved, instanceId, registry)).not.toThrow()
    // Put just above a neighbour it shares its key with, and just under one.
    const siblings = childrenOf(tied, 'page_1')
    const [up] = ordersAt(siblings, 1, 1)
    const [down] = ordersAt(siblings, 1, 1, 'above')
    expect(up > 'a1' && down < 'a1').toBe(true)
  })

  it('keeps walls joined across a group boundary', () => {
    const { doc } = groupNodes(two(), ['w1'])
    const w2 = buildScene(doc, 'page_1', registry).find((item) => item.id === 'w2')!
    // w2 still mitres into w1 although w1 is now inside a group: its outline reaches the outer corner.
    expect(w2.bounds?.minY).toBe(-100)
  })

  it('moves, copies and removes a group with everything inside it, however nested', () => {
    const inner = groupNodes(two(), ['w1', 'w2'])
    const outer = groupNodes(inner.doc, [inner.groupId, 'w3'])
    const moved = applyOps(outer.doc, moveOps(outer.doc, outer.doc.nodes[outer.groupId], { x: 10, y: 20 }))
    expect(moved.nodes.w1).toMatchObject({ a: { x: 10, y: 20 } })
    expect(moved.nodes.w3).toMatchObject({ a: { x: 5010, y: 20 } })

    const copy = cloneOps(outer.doc, outer.groupId, { x: 0, y: 3000 })
    const copied = applyOps(outer.doc, copy.ops)
    expect(Object.values(copied.nodes).filter((n) => n.type === 'wall')).toHaveLength(6)
    expect(ids(copied)).toEqual([outer.groupId, copy.id])

    const removed = applyOps(copied, [{ op: 'remove_node', id: outer.groupId }])
    expect(Object.values(removed.nodes).filter((n) => n.type === 'wall')).toHaveLength(3)
    expect(parseDocument(JSON.parse(serializeDocument(removed)))).toEqual(removed)
  })

  it('refuses to put a group inside itself', () => {
    const inner = groupNodes(two(), ['w1'])
    const outer = groupNodes(inner.doc, [inner.groupId])
    const loop: Op = { op: 'update_node', id: outer.groupId, patch: { parent: inner.groupId } }
    expect(() => applyOps(outer.doc, [loop])).toThrow(/inside itself/)
  })

  it('turns a selection containing a group into a component, and imports it elsewhere whole', () => {
    const { doc, groupId } = groupNodes(two(), ['w1', 'w2'])
    const made = createComponent(doc, registry, [groupId, 'w3'], 'Set')
    expect(made.doc.nodes.w1).toMatchObject({ parent: groupId, a: { x: 0, y: 100 } })
    const imported = importComponents(createDocument(), made.doc)
    expect(Object.values(imported.doc.nodes).filter((n) => n.type === 'wall')).toHaveLength(3)
    expect(Object.values(imported.doc.nodes).filter((n) => n.type === 'group')).toHaveLength(1)
  })

  it('detaches an instance into copies drawn where it drew them, in its place in the order', () => {
    const made = createComponent(two(), registry, ['w1', 'w2'], 'Corner')
    const placed = applyOps(made.doc, [
      { op: 'update_node', id: made.instanceId, patch: { x: 3000, y: 2000, rotation: 90, flipX: true, scale: 2 } },
      { op: 'add_node', node: { type: 'line', id: 'top', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
    ])
    const before = buildScene(placed, 'page_1', registry).find((item) => item.id === made.instanceId)!.bounds!
    const { doc, ids: copies } = detachInstance(placed, made.instanceId, registry)
    expect(ids(doc)).toEqual([...copies, 'w3', 'top'])
    expect(doc.nodes[made.instanceId]).toBeUndefined()
    expect(componentsOf(doc)).toHaveLength(1)
    // Mirrored, doubled, then turned a quarter clockwise about the insertion point.
    expect(doc.nodes[copies[0]]).toMatchObject({ type: 'wall', a: { x: 2800, y: 2000 }, b: { x: 2800, y: 0 }, thickness: 400 })
    const after = buildScene(doc, 'page_1', registry).filter((item) => copies.includes(item.id)).map((item) => item.bounds!)
    expect(Math.min(...after.map((b) => b.minX))).toBeCloseTo(before.minX)
    expect(Math.min(...after.map((b) => b.minY))).toBeCloseTo(before.minY)
    expect(Math.max(...after.map((b) => b.maxX))).toBeCloseTo(before.maxX)
    expect(Math.max(...after.map((b) => b.maxY))).toBeCloseTo(before.maxY)
  })

  it('takes what goes into a component off its layer, groups and all, and puts the placement on it', () => {
    const start = applyOps(two(), [
      { op: 'add_layer', layer: { id: 'old', name: 'Existing', color: '#808080' } },
      { op: 'update_node', id: 'w1', patch: { layer: 'old' } },
      { op: 'update_node', id: 'w2', patch: { layer: 'old' } },
    ])
    const grouped = groupNodes(start, ['w2']).doc
    const group = childrenOf(grouped, 'page_1').find((n) => n.type === 'group')!
    const made = createComponent(applyOps(grouped, [{ op: 'update_node', id: group.id, patch: { layer: 'old' } }]), registry, ['w1', group.id], 'Corner')
    expect(made.doc.nodes[made.instanceId]).toMatchObject({ layer: 'old' })
    expect(['w1', 'w2', group.id].map((id) => made.doc.nodes[id].layer)).toEqual([undefined, undefined, undefined])
  })

  it('puts the copies of a detached instance on its layer, and keeps its modifiers on a group', () => {
    const made = createComponent(applyOps(two(), [{ op: 'add_layer', layer: { id: 'old', name: 'Existing', color: '#808080' } }, { op: 'update_node', id: 'w1', patch: { layer: 'old' } }]), registry, ['w1', 'w2'], 'Corner')
    const loose = detachInstance(made.doc, made.instanceId, registry)
    expect(loose.ids.map((id) => loose.doc.nodes[id].layer)).toEqual(['old', 'old'])
    const cropped = applyOps(made.doc, [{ op: 'update_node', id: made.instanceId, patch: { modifiers: [{ type: 'crop', frame: { x: 0, y: 0 }, params: { width: 500, height: 500 } }] } }])
    const { doc, ids: [groupId] } = detachInstance(cropped, made.instanceId, registry)
    expect(doc.nodes[groupId]).toMatchObject({ type: 'group', name: 'Corner', layer: 'old', modifiers: [{ type: 'crop' }] })
    expect(childrenOf(doc, groupId).map((n) => [n.type, n.layer])).toEqual([['wall', 'old'], ['wall', 'old']])
    expect(parseDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc)
  })
})

describe('declarative extensions', () => {
  const socket = {
    format: 'opencalque-extension',
    formatVersion: 1,
    id: 'test.elec',
    name: 'Electrical',
    version: '1.0.0',
    objects: [
      {
        kind: 'test.rail',
        label: 'Rail',
        params: [
          { key: 'length', label: 'Length', type: 'number', default: 1000 },
          { key: 'posts', label: 'Posts', type: 'number', default: 3 },
          { key: 'style', label: 'Style', type: 'string', default: 'Plain', options: ['Plain', 'Capped'] },
        ],
        draw: [
          { path: [[0, 0], ['length', 0]] },
          { repeat: { count: 'posts' }, ellipse: { cx: 'i * length / (posts - 1)', cy: 0, rx: 20, ry: 20 } },
          { when: "style == 'Capped'", path: [[0, -50], ['length', -50]] },
        ],
      },
    ],
  }

  it('evaluates expressions over parameters and nothing else', () => {
    expect(compileExpression('width / 2 - 50')({ width: 900 })).toBe(400)
    expect(compileExpression("type == 'Double' ? max(2, n) : 1")({ type: 'Double', n: 5 })).toBe(5)
    expect(compileExpression('!(a > 1) || b')({ a: 3, b: false })).toBe(false)
    expect(compileExpression('round(cos(60) * 100)')({})).toBe(50)
    expect(() => compileExpression('constructor')({})).toThrow(/Unknown name/)
    expect(() => compileExpression('alert(1)')).toThrow(/Unknown function/)
    expect(() => compileExpression('1 +')).toThrow()
  })

  it('draws an object from data, with repeats and conditions', () => {
    const local = new Registry().use(declarativeExtension(socket))
    const place = (props: object): Op => ({ op: 'add_node', node: { type: 'parametric', parent: 'page_1', kind: 'test.rail', props: props as Record<string, unknown>, x: 0, y: 0 } })
    const [plain] = buildScene(applyOps(createDocument(), [place({})]), 'page_1', local)
    // Under its lines, an object has a white backing for each closed shape, so that it hides what it stands on.
    const lines = plain.prims.filter((p) => p.stroke !== 'none')
    expect(lines.map((p) => p.kind)).toEqual(['path', 'ellipse', 'ellipse', 'ellipse'])
    expect(lines[3]).toMatchObject({ cx: 1000 })
    expect(plain.prims.filter((p) => p.stroke === 'none').map((p) => [p.kind, p.fill])).toEqual([['ellipse', '#ffffff'], ['ellipse', '#ffffff'], ['ellipse', '#ffffff']])
    expect(plain.prims.findIndex((p) => p.stroke !== 'none')).toBe(3)
    const [capped] = buildScene(applyOps(createDocument(), [place({ style: 'Capped', posts: 2, length: 400 })]), 'page_1', local)
    expect(capped.prims.filter((p) => p.stroke !== 'none')).toHaveLength(4)
    expect(capped.bounds).toEqual({ minX: -20, minY: -50, maxX: 420, maxY: 20 })
  })

  it('rejects an extension that is malformed or refers to a name that does not exist', () => {
    expect(() => declarativeExtension({ ...socket, id: 'Not Valid' })).toThrow(/Not a valid extension/)
    const broken = { ...socket, objects: [{ ...socket.objects[0], draw: [{ path: [[0, 0], ['lenght', 0]] }] }] }
    expect(() => declarativeExtension(broken)).toThrow(/Unknown name "lenght"/)
  })
})

describe('clipboard', () => {
  it('copies nodes with their groups, components and layers into another drawing', () => {
    let doc = applyOps(createDocument(), [
      { op: 'add_layer', layer: { id: 'f', name: 'Furniture', color: '#00f' } },
      { op: 'add_node', node: { type: 'rect', id: 'r', parent: 'page_1', layer: 'f', x: 100, y: 100, width: 50, height: 50 } },
      wall('w1', 0, 0, 1000, 0),
      wall('w2', 2000, 0, 3000, 0),
    ])
    const made = createComponent(doc, registry, ['r'], 'Chair')
    doc = groupNodes(made.doc, [made.instanceId, 'w1']).doc
    const groupId = childrenOf(doc, 'page_1').find((n) => n.type === 'group')!.id

    const clip = JSON.parse(JSON.stringify(copyNodes(doc, [groupId])))
    const target = applyOps(createDocument(), [{ op: 'add_layer', layer: { id: 'x', name: 'Furniture' } }])
    const pasted = pasteNodes(target, parseDocument(clip), 'page_1', { x: 0, y: 500 }, 'layer_1')

    expect(pasted.ids).toHaveLength(1)
    const inside = childrenOf(pasted.doc, pasted.ids[0])
    expect(inside.map((n) => n.type).sort()).toEqual(['instance', 'wall'])
    expect(inside.find((n) => n.type === 'wall')).toMatchObject({ a: { x: 0, y: 500 }, layer: 'layer_1' })
    expect(componentsOf(pasted.doc).map((c) => c.name)).toEqual(['Chair'])
    // The placement goes to the layer of the same name; what the component holds is on none.
    expect(inside.find((n) => n.type === 'instance')).toMatchObject({ layer: 'x' })
    const chair = childrenOf(pasted.doc, componentsOf(pasted.doc)[0].id)[0]
    expect(chair.type).toBe('rect')
    expect(chair.layer).toBeUndefined()
    // Pasting the same thing again reuses the component, and so does pasting another copy of it.
    expect(componentsOf(pasteNodes(pasted.doc, parseDocument(clip), 'page_1', { x: 0, y: 0 }).doc)).toHaveLength(1)
    const again = JSON.parse(JSON.stringify(copyNodes(doc, [groupId])))
    expect(componentsOf(pasteNodes(pasted.doc, parseDocument(again), 'page_1', { x: 0, y: 0 }).doc)).toHaveLength(1)
  })

  it('pastes a copy of an instance back into its own drawing as another instance of the same component', () => {
    const made = createComponent(applyOps(createDocument(), [{ op: 'add_node', node: { type: 'rect', id: 'r', parent: 'page_1', x: 0, y: 0, width: 50, height: 50 } }]), registry, ['r'], 'Chair')
    const clip = parseDocument(JSON.parse(JSON.stringify(copyNodes(made.doc, [made.instanceId]))))
    const once = pasteNodes(made.doc, clip, 'page_1', { x: 200, y: 200 })
    const twice = pasteNodes(once.doc, clip, 'page_1', { x: 400, y: 400 })
    expect(componentsOf(twice.doc)).toHaveLength(1)
    const component = (made.doc.nodes[made.instanceId] as any).component
    for (const id of [...once.ids, ...twice.ids]) expect(twice.doc.nodes[id]).toMatchObject({ type: 'instance', component })
  })
})

describe('dxf', () => {
  it('writes lines, circles and text, and leaves out the edges two joined walls share', () => {
    const doc = applyOps(createDocument(), [
      { op: 'update_layer', id: 'layer_1', patch: { name: 'Walls & co' } },
      { op: 'add_node', node: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200 } },
      { op: 'add_node', node: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: 1000, y: 0 }, b: { x: 1000, y: 1000 }, thickness: 200 } },
      { op: 'add_node', node: { type: 'ellipse', parent: 'page_1', cx: 500, cy: 500, rx: 100, ry: 100 } },
      { op: 'add_node', node: { type: 'text', parent: 'page_1', x: 0, y: 800, text: 'Room', size: 150 } },
    ])
    const dxf = toDXF(doc, 'page_1', registry)
    const count = (type: string) => dxf.split('\n0\n' + type + '\n').length - 1
    // Two mitred walls make one L-shaped outline: 6 edges, not 2 x 5.
    expect(count('LINE')).toBe(6)
    expect(count('CIRCLE')).toBe(1)
    expect(count('TEXT')).toBe(1)
    expect(dxf).toContain('Walls___co')
    expect(dxf).toContain('\n20\n-800\n')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
  })
})

describe('images', () => {
  const withImage = (): Document =>
    applyOps(createDocument(), [
      { op: 'add_asset', asset: { id: 'plan', mime: 'image/png', data: 'AAAA', width: 200, height: 100 } },
      { op: 'add_node', node: { type: 'image', id: 'i', parent: 'page_1', asset: 'plan', x: 0, y: 0, width: 2000, height: 1000 } },
      { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200 } },
    ])

  it('draws a picture from its asset, beneath what is stacked over it', () => {
    const scene = buildScene(withImage(), 'page_1', registry)
    expect(scene[0].prims[0]).toMatchObject({ kind: 'image', href: 'data:image/png;base64,AAAA', width: 2000 })
    expect(hitTest(scene, { x: 1500, y: 800 }, 1)?.id).toBe('i')
    expect(paintOrder(scene.flatMap((item) => item.prims))[0].prim.kind).toBe('image')
  })

  it('refuses an image without its asset', () => {
    const orphan: Op = { op: 'add_node', node: { type: 'image', parent: 'page_1', asset: 'nope', x: 0, y: 0, width: 1, height: 1 } }
    expect(() => applyOps(createDocument(), [orphan])).toThrow(/Unknown asset/)
  })

  it('saves only the assets still in use, and can be read without them', () => {
    const doc = withImage()
    expect(serializeDocument(doc)).toContain('"plan"')
    expect(serializeDocument(applyOps(doc, [{ op: 'remove_node', id: 'i' }]))).not.toContain('assets')
    expect(parseDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc)
    expect(withoutAssets(doc).assets).toBeUndefined()
  })
})

describe('dimensions', () => {
  const dimension = (extra: object): Op => ({
    op: 'add_node',
    node: { type: 'dimension', id: 'd', parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 2500, y: 0 }, offset: -400, ...extra },
  })
  const prims = (extra: object) => {
    const doc = applyOps(createDocument(), [{ op: 'update_layer', id: 'layer_1', patch: { color: 'red' } }, dimension(extra)])
    return buildScene(doc, 'page_1', registry)[0].prims
  }
  const text = (extra: object) => prims(extra).find((p) => p.kind === 'text')

  it('formats the measured value by unit, decimals and override', () => {
    expect(text({})).toMatchObject({ text: '2500' })
    expect(text({ unit: 'm', showUnit: true })).toMatchObject({ text: '2.50 m' })
    expect(text({ unit: 'cm', decimals: 0 })).toMatchObject({ text: '250' })
    expect(text({ text: 'clear width' })).toMatchObject({ text: 'clear width' })
  })

  it('styles the line, extension lines and text separately, each falling back to the line', () => {
    const [extension, , line] = prims({ style: { stroke: 'blue', dash: [6, 4] }, extension: { stroke: 'grey' }, textColor: 'black' })
    expect(extension).toMatchObject({ stroke: 'grey' })
    expect(extension.dash).toBeUndefined()
    expect(line).toMatchObject({ stroke: 'blue', dash: [6, 4] })
    expect(text({ style: { stroke: 'blue' }, textColor: 'black' })).toMatchObject({ stroke: 'black' })
    expect(text({ style: { stroke: 'blue' } })).toMatchObject({ stroke: 'blue' })
    expect(prims({})[0]).toMatchObject({ stroke: 'red' })
  })

  it('draws the chosen end markers, filled ones in the line color', () => {
    const arrows = prims({ startMarker: 'arrow', endMarker: 'none', style: { stroke: 'blue' } })
    expect(arrows.filter((p) => p.fill === 'blue')).toHaveLength(1)
    expect(prims({}).length - arrows.length).toBe(1)
  })
})

describe('components', () => {
  const drawn = (): Document =>
    applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'rect', id: 'r', parent: 'page_1', x: 100, y: 200, width: 50, height: 50 } },
      { op: 'add_node', node: { type: 'line', id: 'l', parent: 'page_1', a: { x: 100, y: 200 }, b: { x: 300, y: 400 } } },
    ])

  it('makes the placements of one component placements of another, where they are and as they are placed, but not inside that other', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'component', id: 'socket', parent: null, name: 'Socket' } },
      { op: 'add_node', node: { type: 'rect', parent: 'socket', x: 0, y: 0, width: 100, height: 100 } },
      { op: 'add_node', node: { type: 'component', id: 'twin', parent: null, name: 'Socket 2' } },
      { op: 'add_node', node: { type: 'rect', parent: 'twin', x: 0, y: 0, width: 100, height: 100 } },
      // A double socket made of two of the first.
      { op: 'add_node', node: { type: 'component', id: 'double', parent: null, name: 'Double' } },
      { op: 'add_node', node: { type: 'instance', id: 'left', parent: 'double', component: 'twin', x: 0, y: 0 } },
      { op: 'add_node', node: { type: 'instance', id: 'a', parent: 'page_1', component: 'twin', x: 100, y: 200, rotation: 90, scale: 2, flipX: true } },
      { op: 'add_node', node: { type: 'instance', id: 'b', parent: 'page_1', component: 'twin', x: 900, y: 200 } },
      { op: 'add_node', node: { type: 'instance', id: 'c', parent: 'page_1', component: 'socket', x: 500, y: 500 } },
      { op: 'add_node', node: { type: 'instance', id: 'd', parent: 'page_1', component: 'double', x: 0, y: 900 } },
    ] as Op[])
    const twins = Object.values(doc.nodes).flatMap((node) => (node.type === 'instance' && node.component === 'twin' ? [node.id] : []))
    const replaced = replaceWithOps(doc, twins, { kind: 'component', id: 'socket' })
    expect(replaced.skipped).toBe(0)
    const merged = applyOps(doc, replaced.ops)
    expect(merged.nodes.a).toMatchObject({ component: 'socket', x: 100, y: 200, rotation: 90, scale: 2, flipX: true })
    expect(merged.nodes.b).toMatchObject({ component: 'socket' })
    expect(merged.nodes.left).toMatchObject({ component: 'socket' })
    // Placed nowhere now, the twin is still there.
    expect(componentPlacements(merged).get('twin')).toBeUndefined()
    expect(merged.nodes.twin).toBeDefined()
    // The double cannot be put inside itself: the placement of the socket inside it stays a socket.
    const into = replaceWithOps(merged, ['left', 'c'], { kind: 'component', id: 'double' })
    expect(into.skipped).toBe(1)
    expect(applyOps(merged, into.ops).nodes.c).toMatchObject({ component: 'double' })
  })

  it('replaces the nodes with an instance that draws the same thing', () => {
    const before = buildScene(drawn(), 'page_1', registry)
    const { doc, componentId, instanceId } = createComponent(drawn(), registry, ['l', 'r'], 'Thing')
    expect(childrenOf(doc, 'page_1').map((n) => n.id)).toEqual([instanceId])
    expect(doc.nodes.r).toMatchObject({ parent: componentId, x: 0, y: 0 })
    expect(doc.nodes[instanceId]).toMatchObject({ x: 100, y: 200 })
    const [instance] = buildScene(doc, 'page_1', registry)
    expect(instance.bounds).toEqual({ minX: 100, minY: 200, maxX: 300, maxY: 400 })
    expect(instance.prims.filter((p) => p.stroke !== 'none').length).toBe(before.flatMap((i) => i.prims).length)
  })

  it('imports components from another document once, with their dependencies', () => {
    const inner = createComponent(drawn(), registry, ['r'], 'Inner')
    const outer = createComponent(inner.doc, registry, [inner.instanceId, 'l'], 'Outer')
    const first = importComponents(createDocument(), outer.doc, [outer.componentId])
    expect(componentsOf(first.doc).map((c) => c.name).sort()).toEqual(['Inner', 'Outer'])
    const again = importComponents(first.doc, outer.doc)
    expect(componentsOf(again.doc)).toHaveLength(2)
    expect(again.imported).toEqual(first.imported)
  })

  it('imports from a library a component of its own each time, its dependencies with it', () => {
    const inner = createComponent(drawn(), registry, ['r'], 'Inner')
    const outer = createComponent(inner.doc, registry, [inner.instanceId, 'l'], 'Outer')
    const take = (doc: Document) => importComponents(doc, outer.doc, [outer.componentId], { fresh: true })
    const first = take(createDocument())
    const again = take(first.doc)
    expect(componentsOf(again.doc)).toHaveLength(4)
    expect(again.imported[outer.componentId]).not.toBe(first.imported[outer.componentId])
    expect(again.imported[inner.componentId]).not.toBe(first.imported[inner.componentId])
    const instance = childrenOf(again.doc, again.imported[outer.componentId]).find((n) => n.type === 'instance')
    expect(instance).toMatchObject({ component: again.imported[inner.componentId] })
    // Nothing says where it came from, so that a paste takes it for no other.
    expect(componentsOf(again.doc).map((c) => c.meta?.source)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('names a component after another already there with the first number free', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'component', name: 'Socket' } },
      { op: 'add_node', node: { type: 'component', name: 'Socket 2' } },
    ])
    expect(freeComponentName(doc, 'Switch')).toBe('Switch')
    expect(freeComponentName(doc, 'Socket')).toBe('Socket 3')
    expect(freeComponentName(doc, 'Socket', new Set(['Socket 3']))).toBe('Socket 4')
  })
})

describe('svg', () => {
  it('exports every primitive', () => {
    const doc = applyOps(createDocument(), [
      wall('w1', 0, 0, 1000, 0),
      { op: 'add_node', node: { type: 'text', parent: 'page_1', x: 0, y: 500, text: 'a < b', size: 100 } },
    ])
    const svg = toSVG(doc, 'page_1', registry)
    expect(svg).toContain('<path d="M0 -100 L0 100 L1000 100 L1000 -100 Z"')
    expect(svg).toContain('a &lt; b</text>')
  })
})

describe('drawings from before the rename', () => {
  it('opens a file whose format is the old name, and saves it under the new one', () => {
    const old = { ...JSON.parse(serializeDocument(createDocument('Plan'))), format: 'opencad' }
    const doc = parseDocument(old)
    expect(doc.format).toBe('opencalque')
    expect(doc.name).toBe('Plan')
  })
})

describe('placements of components', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_node', node: { type: 'component', id: 'chair', name: 'Chair' } },
    { op: 'add_node', node: { type: 'rect', parent: 'chair', x: 0, y: 0, width: 400, height: 400 } },
    { op: 'add_node', node: { type: 'component', id: 'table', name: 'Table' } },
    { op: 'add_node', node: { type: 'instance', parent: 'table', component: 'chair', x: 0, y: 0 } },
    { op: 'add_node', node: { type: 'instance', parent: 'table', component: 'chair', x: 500, y: 0 } },
    { op: 'add_node', node: { type: 'component', id: 'stool', name: 'Stool' } },
    { op: 'add_node', node: { type: 'component', id: 'shelf', name: 'Shelf' } },
    { op: 'add_node', node: { type: 'instance', parent: 'shelf', component: 'stool', x: 0, y: 0 } },
    { op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1' } },
    { op: 'add_node', node: { type: 'instance', parent: 'g', component: 'table', x: 0, y: 0 } },
    { op: 'add_node', node: { type: 'instance', parent: 'page_1', component: 'table', x: 2000, y: 0 } },
  ] as Op[])

  it('counts each placement where the drawing shows it, inside groups and components placed so', () => {
    // Placed twice in the table, the chair counts two, however many tables there are.
    expect(Object.fromEntries(componentPlacements(doc))).toEqual({ table: 2, chair: 2 })
  })

  it('finds the unused ones, with those placed only inside them', () => {
    expect(unusedComponents(doc).sort()).toEqual(['shelf', 'stool'])
    const cleared = applyOps(doc, unusedComponents(doc).map((id): Op => ({ op: 'remove_node', id })))
    expect(componentsOf(cleared).map((c) => c.id).sort()).toEqual(['chair', 'table'])
  })
})
