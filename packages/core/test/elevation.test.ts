import { describe, expect, it } from 'vitest'
import { applyEdit, applyOps, createDocument, elevationItemAt, elevationMovePatch, elevationPrimitives, NewerFormatError, parseDocument, Registry, serializeDocument, shownInElevations, splitWallOps, transformOps, wallFaceAt, type Document, type NodeOf, type Op, type Primitive } from '../src'
import { viewNodes, viewOps, type ViewSpec } from './view-nodes'

/*
 * Elevations (elevation.ts): the face of a wall seen from in front, drawn from the plan each time.
 * A door that cuts the wall it is in, with a front drawing; a socket fixed on walls with none, drawn
 * as a small square; and a window that says nothing of its front, drawn as the box of its opening.
 */
const registry = new Registry().use({
  id: 'test.house',
  name: 'House',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({
      kind: 'test.door',
      label: 'Door',
      params: [
        { key: 'width', label: 'Width', type: 'number', default: 900 },
        { key: 'height', label: 'Height', type: 'number', default: 2000 },
      ],
      opening: ({ width }) => ({ from: 0, to: width }),
      build: ({ width }) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: width, y: 0 }] }],
      front: ({ width, height }) => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: -height }, { x: 0, y: -height }], closed: true }],
    })
    api.registerParametric({ kind: 'test.window', label: 'Window', params: [{ key: 'height', label: 'Height', type: 'number', default: 1200 }], opening: () => ({ from: 0, to: 1000 }), build: () => [] })
    api.registerParametric({ kind: 'test.socket', label: 'Socket', params: [], mount: { on: 'wall', height: 300 }, build: () => [{ kind: 'path', points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }] })
  },
})

/**
 * A wall 6 m long and 200 thick along y = 0, its lower face at y = 100; a wall across its start,
 * down from (0, 0); a door 1 m from its start, a socket on its lower face at 3 m, 450 high, and a
 * window 4.5 m along; and an elevation of that lower face as the tool makes it: its line 1 m in
 * front of the face, at y = 1100, from across the corner of the room at x = 100 to across the
 * wall's end, its far side on the face; drawn with its floor at (100, 10 000), so that a point of
 * the face is drawn at the x it has on the plan.
 */
const plan = (extra: Record<string, unknown>[] = []): Document =>
  applyOps(
    createDocument('Plan'),
    [
      { type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
      { type: 'wall', id: 'side', a: { x: 0, y: 0 }, b: { x: 0, y: 4000 }, thickness: 200 },
      { type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 1000, y: 0 },
      { type: 'parametric', id: 'socket', kind: 'test.socket', props: {}, x: 3000, y: 100, z: 450 },
      { type: 'parametric', id: 'window', kind: 'test.window', props: {}, x: 4500, y: 0 },
      { type: 'elevation', id: 'e', a: { x: 100, y: 1100 }, b: { x: 6000, y: 1100 }, depth: 1000, x: 100, y: 10000, name: 'Kitchen, north wall' },
      ...extra,
    ]
      .flatMap((node) => (node.type === 'elevation' ? viewNodes(node as never as ViewSpec) : [node]))
      .map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  )

const view = (doc: Document) => elevationPrimitives(doc.nodes.ev as NodeOf<'elevation'>, doc, registry)
const boxes = (prims: Primitive[]) =>
  prims.flatMap((p) => {
    if (p.kind !== 'path' || !p.closed || p.texture) return []
    const xs = p.points.map((q) => Math.round(q.x))
    const ys = p.points.map((q) => Math.round(q.y))
    return [[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]]
  })
const line = (doc: Document) => {
  const { a, b } = doc.nodes.e as NodeOf<'viewline'>
  return [a, b].map((p) => [Math.round(p.x), Math.round(p.y)])
}
const edited = (doc: Document, ops: Op[]) => applyEdit(doc, ops, registry).doc

describe('elevations', () => {
  it('look at the face of the wall beside the pointer, from that side, so that what is on its left is on the left of the view', () => {
    // Inside the room, from its corner at x = 100, not from inside the wall across the start.
    expect(wallFaceAt(plan(), 'page_1', { x: 3000, y: 400 }, 500)).toMatchObject({ face: 'right', a: { x: 100, y: 100 }, b: { x: 6000, y: 100 } })
    // Outside, round the corner to x = -100.
    expect(wallFaceAt(plan(), 'page_1', { x: 3000, y: -400 }, 500)).toMatchObject({ face: 'left', a: { x: 6000, y: -100 }, b: { x: -100, y: -100 } })
    expect(wallFaceAt(plan(), 'page_1', { x: 3000, y: 2000 }, 500)).toBeNull()
  })

  it('draw the face, its door and window, what is fixed on it at its height, the wall it runs into cut, and the floor', () => {
    const prims = view(plan())
    // Heights go up the sheet from the floor at y = 10 000: the face 2500 high (no height given),
    // the door's front 2 m, the window as the box of its opening, the socket a square at 450.
    expect(boxes(prims)).toEqual([
      [100, 7500, 6000, 10000],
      [1000, 8000, 1900, 10000],
      [4500, 8800, 5500, 10000],
      [2960, 9510, 3040, 9590],
      // The wall across its start, which the face runs into: cut through, its whole thickness.
      [-100, 7500, 100, 10000],
    ])
    // Its name is not written on the drawing.
    expect(prims.some((p) => p.kind === 'text')).toBe(false)
    // The floor runs under the wall cut through too.
    expect(prims).toContainEqual(expect.objectContaining({ kind: 'path', points: [{ x: -100, y: 10000 }, { x: 6000, y: 10000 }] }))
  })

  it('stand as high as the wall or its page says', () => {
    const doc = applyOps(plan(), [
      { op: 'update_node', id: 'page_1', patch: { wallHeight: 2700 } },
      { op: 'update_node', id: 'side', patch: { height: 3000 } },
    ])
    expect(boxes(view(doc))).toContainEqual([100, 7300, 6000, 10000])
    expect(boxes(view(doc))).toContainEqual([-100, 7000, 100, 10000])
  })

  it('show nothing of the other face, and nothing of a wall away from the line', () => {
    const doc = applyOps(plan(), [{ op: 'update_node', id: 'e', patch: { a: { x: 6000, y: -1100 }, b: { x: 0, y: -1100 } } }])
    // Seen from above the wall: the door and window go through it, the socket is on the other face.
    expect(boxes(view(doc))).toHaveLength(3)
    const away = applyOps(plan(), [{ op: 'update_node', id: 'e', patch: { a: { x: 0, y: 3500 }, b: { x: 6000, y: 3500 } } }])
    // The wall across, which it runs through, from 100 mm before its start to 100 mm after.
    expect(boxes(view(away))).toEqual([[0, 7500, 200, 10000]])
  })

  it('follow their wall moved, made thicker, longer or shorter, and stay whole across a wall cut in two', () => {
    const doc = plan()
    // Moved down 1 m, its start still in the wall across it, which it now stops against: from x = 100 still.
    expect(line(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } }]))).toEqual([[100, 2100], [6000, 2100]])
    // Moved clear of it, its face runs from its end.
    expect(line(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 5000 }, b: { x: 6000, y: 5000 } } }]))).toEqual([[0, 6100], [6000, 6100]])
    expect(line(edited(doc, [{ op: 'update_node', id: 'w', patch: { thickness: 300 } }]))).toEqual([[100, 1150], [6000, 1150]])
    expect(line(edited(doc, [{ op: 'update_node', id: 'w', patch: { b: { x: 8000, y: 0 } } }]))).toEqual([[100, 1100], [8000, 1100]])
    expect(line(edited(doc, [{ op: 'update_node', id: 'w', patch: { b: { x: 4000, y: 0 } } }]))).toEqual([[100, 1100], [4000, 1100]])
    const split = splitWallOps(doc.nodes.w as never, { x: 3000, y: 0 }, 'w2')!
    expect(edited(doc, split.ops).nodes.e).toBe(doc.nodes.e)
    // Turned round, the wall's faces are where they were: the view has not moved.
    expect(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 6000, y: 0 }, b: { x: 0, y: 0 } } }]).nodes.e).toBe(doc.nodes.e)
  })

  it('make a drawing of version 3, which says version 2 while it has none, for the versions before them', () => {
    expect(JSON.parse(serializeDocument(plan())).version).toBe(3)
    const without = applyOps(plan(), [{ op: 'remove_node', id: 'e' }])
    expect(JSON.parse(serializeDocument(without)).version).toBe(2)
    expect(parseDocument(JSON.parse(serializeDocument(without))).version).toBe(3)
    expect(parseDocument(JSON.parse(serializeDocument(plan()))).nodes.e).toEqual(plan().nodes.e)
  })
})

const elevation = (doc: Document) => doc.nodes.ev as NodeOf<'elevation'>
const socket = (doc: Document) => doc.nodes.socket as NodeOf<'parametric'>
/** The elevation of `doc` looking from another line, drawn at the same place. */
const looking = (doc: Document, a: [number, number], b: [number, number]) => applyOps(doc, [{ op: 'update_node', id: 'e', patch: { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } } }])

describe('what an elevation shows is the plan', () => {
  it('finds the object under a point of the view, what is fixed on the face before the door around it', () => {
    const doc = plan()
    // The socket at 3 m along, 450 high: (3000, 9550) in the view.
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 3000, y: 9550 })).toMatchObject({ role: 'fixed', node: { id: 'socket' } })
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 1400, y: 9000 })).toMatchObject({ role: 'opening', node: { id: 'door' } })
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 2500, y: 9000 })).toBeNull()
    // A socket put inside the door's box, 300 high at 1.2 m: it is the one taken.
    const inDoor = applyOps(doc, [{ op: 'update_node', id: 'socket', patch: { x: 1200, z: 300 } }])
    expect(elevationItemAt(elevation(inDoor), inDoor, registry, { x: 1200, y: 9700 })).toMatchObject({ node: { id: 'socket' } })
    // A little way off its box, within the margin given.
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 3045, y: 9550 })).toBeNull()
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 3045, y: 9550 }, 10)).toMatchObject({ node: { id: 'socket' } })
  })

  it('moves what is dragged in it on the plan: along the wall and up, within the wall and never below the floor', () => {
    const doc = plan()
    expect(elevationMovePatch(elevation(doc), doc, registry, socket(doc), 500, 200)).toEqual({ x: 3500, y: 100, rotation: 0, z: 650 })
    expect(elevationMovePatch(elevation(doc), doc, registry, socket(doc), 9000, -1000)).toEqual({ x: 6000, y: 100, rotation: 0, z: 0 })
    // A door goes along its wall only.
    expect(elevationMovePatch(elevation(doc), doc, registry, doc.nodes.door as NodeOf<'parametric'>, -300, 500)).toEqual({ x: 700, y: 0 })
  })

  it('moves the right way along a wall seen from its other side, where its start is on the right', () => {
    // A socket on the upper face, seen from above: across the view to the right is towards x = 0.
    const doc = looking(applyOps(plan(), [{ op: 'update_node', id: 'socket', patch: { y: -100, rotation: 180 } }]), [6000, -100], [0, -100])
    expect(elevationMovePatch(elevation(doc), doc, registry, socket(doc), 500, 0)).toEqual({ x: 2500, y: -100, rotation: 180, z: 450 })
    // In the view, the socket 3 m from x = 6000, drawn from x = 100.
    expect(elevationItemAt(elevation(doc), doc, registry, { x: 3100, y: 9550 })).toMatchObject({ node: { id: 'socket' } })
  })

  it('says where the elevations show what is selected, and nothing for what they do not show', () => {
    const doc = plan()
    expect(shownInElevations(doc, registry, ['socket'])).toEqual([{ view: elevation(doc), box: { minX: 2960, minY: 9510, maxX: 3040, maxY: 9590 } }])
    expect(shownInElevations(doc, registry, ['w', 'side'])).toEqual([])
    expect(shownInElevations(doc, registry, [])).toEqual([])
  })

  it('still shows what is taken off the face into what it sees, and stops showing it out of it', () => {
    // 300 off the face into the room: still in view, between the face and the line at y = 1100.
    const off = applyOps(plan(), [{ op: 'update_node', id: 'socket', patch: { y: 400 } }])
    expect(shownInElevations(off, registry, ['socket'])).toHaveLength(1)
    // Past the line, behind whoever looks: not in view.
    const behind = applyOps(plan(), [{ op: 'update_node', id: 'socket', patch: { y: 2000 } }])
    expect(shownInElevations(behind, registry, ['socket'])).toEqual([])
    const back = applyOps(behind, [{ op: 'update_node', id: 'socket', patch: { y: 100 } }])
    expect(shownInElevations(back, registry, ['socket'])).toHaveLength(1)
  })
})

describe('elevations of every kind of wall', () => {
  it('draw the faces of both halves of a wall cut in two as one face', () => {
    const doc = plan()
    const halves = applyOps(doc, splitWallOps(doc.nodes.w as never, { x: 3000, y: 0 }, 'w2')!.ops)
    // Each half its own face, with what is on it drawn after it.
    expect(boxes(view(halves))).toContainEqual([100, 7500, 3000, 10000])
    expect(boxes(view(halves))).toContainEqual([3000, 7500, 6000, 10000])
  })

  it('look at a wall at an angle, as long as it is', () => {
    const doc = applyOps(createDocument('Plan'), [
      { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 }, thickness: 200 } },
    ])
    const face = wallFaceAt(doc, 'page_1', { x: 2000, y: 2000 }, 500)!
    const viewed = applyOps(doc, viewOps({ id: 'e', a: face.a, b: face.b, x: 0, y: 10000 }))
    expect(boxes(view(viewed))).toEqual([[0, 7500, 5000, 10000]])
  })

  it('look at the face of a wall drawn by its face, and at the lining laid on it rather than the wall under it', () => {
    const doc = applyOps(createDocument('Plan'), [
      { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200, justify: 'left' } },
      { op: 'add_node', node: { type: 'wall', id: 'lining', parent: 'page_1', a: { x: 0, y: 200 }, b: { x: 6000, y: 200 }, thickness: 20, justify: 'left' } },
    ])
    expect(wallFaceAt(doc, 'page_1', { x: 2000, y: 600 }, 500)).toMatchObject({ wall: { id: 'lining' }, a: { x: 0, y: 220 }, b: { x: 6000, y: 220 } })
  })

  it('cut a wall the line runs into plain grey, whatever it is made of', () => {
    const doc = applyOps(plan(), [
      { op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#efc7b4', pattern: { kind: 'Lines', spacing: 60 } } },
      { op: 'update_node', id: 'side', patch: { material: 'brick' } },
    ])
    const prims = view(doc)
    expect(prims).toContainEqual(expect.objectContaining({ kind: 'path', fill: '#e8ecf1', closed: true }))
    expect(prims.some((p) => p.kind === 'path' && (p.texture || p.fill === '#efc7b4'))).toBe(false)
  })

  it('show nothing of a curved wall, and nothing at all for a line of no length', () => {
    const curved = applyOps(plan(), [{ op: 'update_node', id: 'w', patch: { bulge: 400 } }])
    expect(wallFaceAt(curved, 'page_1', { x: 3000, y: -2000 }, 3000)?.wall.id).not.toBe('w')
    expect(view(looking(plan(), [100, 100], [100, 100]))).toEqual([])
  })

  it('see walls in groups', () => {
    const doc = applyOps(plan(), [
      { op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1' } },
      { op: 'update_node', id: 'w', patch: { parent: 'g' } },
    ])
    expect(boxes(view(doc))[0]).toEqual([100, 7500, 6000, 10000])
  })
})

describe('elevations follow every edit of their wall', () => {
  it('keep a view of part of a face where it is on a wall made longer, and take it along on a wall moved', () => {
    const part = looking(plan(), [1000, 1100], [4000, 1100])
    expect(edited(part, [{ op: 'update_node', id: 'w', patch: { b: { x: 9000, y: 0 } } }]).nodes.e).toBe(part.nodes.e)
    expect(line(edited(part, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 500 }, b: { x: 6000, y: 500 } } }]))).toEqual([[1000, 1600], [4000, 1600]])
  })

  it('keep the start of the view at the start of a wall whose start is dragged in', () => {
    expect(line(edited(plan(), [{ op: 'update_node', id: 'w', patch: { a: { x: 1500, y: 0 } } }]))).toEqual([[1500, 1100], [6000, 1100]])
  })

  it('turn with a wall turned about its start, the view still of the same face', () => {
    // A quarter turn down to (0, 6000): its right face is now at x = -100, the view 1 m off it running down.
    expect(line(edited(plan(), [{ op: 'update_node', id: 'w', patch: { b: { x: 0, y: 6000 } } }]))).toEqual([[-1100, 0], [-1100, 6000]])
  })

  it('leave a line the edit changed itself, and one of a wall taken away', () => {
    const doc = plan()
    const moved = edited(doc, [
      { op: 'update_node', id: 'w', patch: { thickness: 300 } },
      { op: 'update_node', id: 'e', patch: { depth: 1000 } },
    ])
    expect(line(moved)).toEqual([[100, 1100], [6000, 1100]])
    expect(edited(doc, [{ op: 'remove_node', id: 'w' }]).nodes.e).toBe(doc.nodes.e)
  })

  it('stay upright and keep looking at the plan when the drawing is turned round them', () => {
    const doc = plan()
    const ops = transformOps(doc, [doc.nodes.ev], { pivot: { x: 100, y: 10000 }, rotation: 90 }, registry)
    const turned = applyOps(doc, ops)
    expect(elevation(turned)).toMatchObject({ x: 100, y: 10000 })
    expect(turned.nodes.e).toBe(doc.nodes.e)
    expect(boxes(view(turned))[0]).toEqual([100, 7500, 6000, 10000])
  })
})

describe('drawings with elevations from other versions', () => {
  it('are refused by a version that reads only up to version 2, which a drawing without one still is', () => {
    const json = JSON.parse(serializeDocument(plan()))
    expect(() => parseDocument({ ...json, version: 4 })).toThrow(NewerFormatError)
    // A drawing of version 2 with no elevation opens, and is of version 3 once read.
    const old = JSON.parse(serializeDocument(applyOps(plan(), [{ op: 'remove_node', id: 'e' }])))
    expect(old.version).toBe(2)
    expect(parseDocument(old).nodes.door).toBeDefined()
  })
})

describe('elevations look at the face as it is drawn', () => {
  it('keep a socket dragged in them on the face, not inside the wall at the corner', () => {
    const doc = plan()
    // Dragged 5 m to the left from 3 m along: it stops at the corner of the room, x = 100.
    expect(elevationMovePatch(elevation(doc), doc, registry, socket(doc), -5000, 0)).toMatchObject({ x: 100, y: 100 })
  })

  it('show the walls at both corners of a room, and none past them', () => {
    // A room 4 m by 3 m of walls 200 thick drawn by their middles, and a wall 1 m past its right side.
    const doc = applyOps(createDocument('Plan'), [
      ...[
        ['n', [0, 0], [4000, 0]],
        ['e2', [4000, 0], [4000, 3000]],
        ['s', [4000, 3000], [0, 3000]],
        ['w2', [0, 3000], [0, 0]],
        ['far', [5000, -1000], [5000, 4000]],
      ].map(([id, a, b]): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x: (a as number[])[0], y: (a as number[])[1] }, b: { x: (b as number[])[0], y: (b as number[])[1] }, thickness: 200 } as never })),
    ])
    const face = wallFaceAt(doc, 'page_1', { x: 2000, y: 400 }, 500)!
    expect(face).toMatchObject({ a: { x: 100, y: 100 }, b: { x: 3900, y: 100 } })
    const viewed = applyOps(doc, viewOps({ id: 'e', a: face.a, b: face.b, x: 100, y: 10000 }))
    // The face from corner to corner, and the walls at both corners cut through; the far wall is not in it.
    expect(boxes(view(viewed))).toEqual([
      [100, 7500, 3900, 10000],
      [3900, 7500, 4100, 10000],
      [-100, 7500, 100, 10000],
    ])
  })

  it('keep the view from corner to corner when a side of the room is moved', () => {
    const doc = plan()
    // The wall across the start moved 500 to the right, the start of the face with it (as when dragged, both ends of a corner follow).
    const moved = edited(doc, [
      { op: 'update_node', id: 'side', patch: { a: { x: 500, y: 0 }, b: { x: 500, y: 4000 } } },
      { op: 'update_node', id: 'w', patch: { a: { x: 500, y: 0 } } },
    ])
    expect(line(moved)).toEqual([[600, 1100], [6000, 1100]])
  })
})
