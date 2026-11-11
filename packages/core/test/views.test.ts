import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import electrical from '../../warehouse/extensions/electrical.json'
import furniture from '../../warehouse/extensions/furniture.json'
import { applyOps, elevationWall, farSide, keepViewsOps, lineOf, moveViewCorner, moveViewEdge, parseDocument, readDocument, transformOps, viewOfFace, viewsOf, type Vec2, checkDrawing, copyNodes, createDocument, declarativeExtension, depthThrough, elevationItemAt, elevationMovePatch, applyEdit, heightAboveFloor, heightText, kindOf, mountAt, mountedOn, nodePrimitives, pasteNodes, Registry, seenArea, snapMountToWall, wallFaceAt, type Document, type NodeOf, type Op, type Primitive } from '../src'
import { viewNodes, type ViewSpec } from './view-nodes'

/*
 * Views of the plan with what ships with the app: the doors and windows of the built-in extension,
 * the electrical symbols, the adjustable furniture. Elevations with their dimensions and what stands
 * in front of the face, sections, heights written on the plan, what a check says of a socket beside
 * a wall, and views pasted with their walls.
 */
const registry = new Registry().use(architecture).use(declarativeExtension(electrical)).use(declarativeExtension(furniture))

/** Nodes added on the first page; a view described by what it sees and where it is drawn comes as its line, `v`, and the view of it, `vv` (`viewNodes`). */
const add = (doc: Document, ...nodes: Record<string, unknown>[]): Document =>
  applyOps(
    doc,
    nodes.flatMap((node) => (node.type === 'elevation' && 'a' in node ? viewNodes(node as never as ViewSpec) : [node])).map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  )
const wall = (id: string, a: [number, number], b: [number, number], extra: Record<string, unknown> = {}) => ({ type: 'wall', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, ...extra })
/** A room 5 m by 4 m inside walls 200 thick drawn by their middles: its inside faces at x = 100 and 4900, y = 100 and 3900. */
const room = (): Document => add(createDocument('Room'), wall('n', [0, 0], [5000, 0]), wall('e', [5000, 0], [5000, 4000]), wall('s', [5000, 4000], [0, 4000]), wall('w', [0, 4000], [0, 0]))
/** An elevation of the inside of the north wall, from the corner at x = 100: its line 1 m in front of the face, its far side on it; drawn so that x in the view is x on the plan. */
const north = { type: 'elevation', id: 'v', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000 }
const drawn = (doc: Document, id = 'vv') => nodePrimitives(doc.nodes[id], { doc, registry, depth: 0 })
const texts = (prims: Primitive[]) => prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []))
const boxes = (prims: Primitive[]) =>
  prims.flatMap((p) => {
    if (p.kind !== 'path' || !p.closed || p.texture) return []
    const xs = p.points.map((q) => Math.round(q.x))
    const ys = p.points.map((q) => Math.round(q.y))
    return [[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]]
  })
const socketAt = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ type: 'parametric', id, kind: 'elec.socket', props: {}, x, y: 100, ...extra })

describe('the dimensions of an elevation', () => {
  it('chain the sockets along the floor from the corner, and give each its height', () => {
    const doc = add(room(), socketAt('s1', 1100), socketAt('s2', 3100, { z: 1100 }), north)
    // From the corner at 100 to 1100, on to 3100, on to the corner at 4900; heights 300 and 1100.
    expect(texts(drawn(doc))).toEqual(expect.arrayContaining(['1000', '2000', '1800', '300', '1100']))
  })

  it('are left out when the elevation says so, or when nothing is fixed on its face', () => {
    expect(texts(drawn(add(room(), socketAt('s1', 1100), { ...north, dimensions: false })))).toEqual([])
    // Nor is its name written.
    expect(texts(drawn(add(room(), { ...north, name: 'North' })))).toEqual([])
  })
})

describe('the height of a socket written on the plan', () => {
  it('in metres, beside it on the side of the room, upright however it is turned', () => {
    const doc = add(room(), socketAt('s1', 1100, { showHeight: true, z: 1100 }), socketAt('s2', 2000, { y: 3900, rotation: 180, showHeight: true }))
    const one = drawn(doc, 's1').find((p) => p.kind === 'text')!
    expect(one).toMatchObject({ text: 'h 1.10', align: 'center' })
    expect(one.kind === 'text' && one.y).toBeGreaterThan(290)
    const turned = drawn(doc, 's2').find((p) => p.kind === 'text')!
    expect(turned).toMatchObject({ text: 'h 0.30' })
    expect(turned.kind === 'text' && (turned.rotation ?? 0)).toBe(0)
    expect(turned.kind === 'text' && turned.y).toBeLessThan(3700)
  })

  it('not without being asked, and in inches for a drawing in feet, with the drawing’s decimal mark', () => {
    expect(texts(drawn(add(room(), socketAt('s1', 1100)), 's1'))).toEqual([])
    expect(heightText(300, { system: 'imperial' })).toBe('h 12"')
    expect(heightText(1100, { decimal: ',' })).toBe('h 1,10')
  })
})

describe('a check of a socket beside a wall', () => {
  const problems = (doc: Document) => checkDrawing(doc, registry).filter((p) => p.kind === 'fixed-off-wall')

  it('says a socket 50 mm off a face, or in a wall, is on no wall', () => {
    expect(problems(add(room(), socketAt('s1', 1100, { y: 150 })))).toMatchObject([{ nodes: ['n', 's1'] }])
    expect(problems(add(room(), socketAt('s1', 1100, { y: 0 })))[0].message).toMatch(/inside wall "n"/)
  })

  it('says nothing of a socket on a face, of one far from any wall, or of what is not fixed on walls', () => {
    expect(problems(add(room(), socketAt('s1', 1100)))).toEqual([])
    expect(problems(add(room(), socketAt('s1', 2000, { y: 2000 })))).toEqual([])
    expect(problems(add(room(), { type: 'parametric', id: 'l', kind: 'elec.light', props: {}, x: 2000, y: 150 }))).toEqual([])
  })
})

describe('a window dragged up and down in an elevation', () => {
  it('goes up by its sill height; a door does not', () => {
    const doc = add(room(), { type: 'parametric', id: 'win', kind: 'arch.window', props: {}, x: 2000, y: 0 }, { type: 'parametric', id: 'door', kind: 'arch.door', props: {}, x: 500, y: 0 }, north)
    const view = doc.nodes.vv as NodeOf<'elevation'>
    expect(elevationItemAt(view, doc, registry, { x: 2600, y: 10000 - 1500 })).toMatchObject({ role: 'opening', raises: true, node: { id: 'win' } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.win as NodeOf<'parametric'>, 0, 200)).toEqual({ x: 2000, y: 0, props: { sillHeight: 1100 } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.win as NodeOf<'parametric'>, 0, -2000)).toEqual({ x: 2000, y: 0, props: { sillHeight: 0 } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.door as NodeOf<'parametric'>, 0, 200)).toEqual({ x: 500, y: 0 })
  })
})

describe('what stands in front of the face', () => {
  /** A bed of 1600 by 2000 (500 high) with its head against the north wall from x = 1000, and a component placed in the room. */
  const furnished = (extra: Record<string, unknown>[] = [], height?: number) =>
    add(
      add(room(), { type: 'component', id: 'chest', parent: null, name: 'Chest', ...(height ? { height } : {}) }),
      { type: 'rect', id: 'chest_1', parent: 'chest', x: 0, y: 0, width: 800, height: 400 },
      { type: 'parametric', id: 'bed', kind: 'furn.bed', props: {}, x: 1000, y: 100 },
      ...extra,
      north,
    )

  it('is drawn as boxes of its width and height: the bed, and a component that says how tall it is', () => {
    const doc = furnished([{ type: 'instance', id: 'c', component: 'chest', x: 3500, y: 150 }], 900)
    expect(boxes(drawn(doc))).toEqual(expect.arrayContaining([[1000, 9500, 2600, 10000], [3500, 9100, 4300, 10000]]))
    expect(elevationItemAt(doc.nodes.vv as NodeOf<'elevation'>, doc, registry, { x: 3900, y: 9500 })).toMatchObject({ role: 'standing', node: { id: 'c' } })
  })

  it('is left out when further than the depth, or when nothing says how tall it is', () => {
    const doc = furnished([{ type: 'instance', id: 'c', component: 'chest', x: 3500, y: 150 }])
    expect(boxes(drawn(doc))).not.toContainEqual([3500, 9100, 4300, 10000])
    // The bed reaches 2.1 m into the room, and starts at its head: a depth of 50 still takes it; past the bed, nothing.
    const far = furnished([{ type: 'instance', id: 'c', component: 'chest', x: 3500, y: 2500 }], 900)
    expect(boxes(drawn(far))).not.toContainEqual([3500, 9100, 4300, 10000])
  })

  it('slides across the view when dragged there', () => {
    const doc = furnished()
    expect(elevationMovePatch(doc.nodes.vv as NodeOf<'elevation'>, doc, registry, doc.nodes.bed as NodeOf<'parametric'>, 300, 0)).toEqual({ x: 1300, y: 100 })
  })
})

describe('sections', () => {
  /** A section across the room from west to east at y = 2000, seen from the south: looking north. Drawn from x = -500, so x in the view is x on the plan. */
  const across = { type: 'elevation', id: 'v', a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 }, x: -500, y: 10000 }

  it('cut the walls they cross, and see the face behind them', () => {
    const doc = add(room(), across)
    const found = boxes(drawn(doc))
    // The west and east walls cut through, 200 wide; the inside of the north wall seen behind, from corner to corner.
    expect(found).toEqual(expect.arrayContaining([[-100, 7500, 100, 10000], [4900, 7500, 5100, 10000], [100, 7500, 4900, 10000]]))
  })

  it('cut a wall above and below the window they go through, and above a door', () => {
    const doc = add(
      room(),
      { type: 'parametric', id: 'win', kind: 'arch.window', props: { width: 1200 }, x: 0, y: 1400, rotation: 90 },
      { type: 'parametric', id: 'door', kind: 'arch.door', props: {}, x: 5000, y: 1500, rotation: 90 },
      across,
    )
    const found = boxes(drawn(doc))
    // The west wall cut below the sill (900) and above the window (900 + 1250); the east wall above the door (2040).
    expect(found).toEqual(expect.arrayContaining([[-100, 9100, 100, 10000], [-100, 7500, 100, 7850], [4900, 7500, 5100, 7960]]))
    expect(found).not.toContainEqual([-100, 7500, 100, 10000])
  })

  it('see nothing beyond their depth, and the nearer of two faces in front of the further', () => {
    const shallow = add(room(), { ...across, depth: 1000 })
    expect(boxes(drawn(shallow))).not.toContainEqual([100, 7500, 4900, 10000])
    // A wall 1 m behind the line, from x = 1000 to 3000: drawn after the north wall, so over it.
    const doc = add(room(), wall('mid', [1000, 1000], [3000, 1000]), across)
    const order = boxes(drawn(doc)).map((b) => JSON.stringify(b))
    expect(order).toContain(JSON.stringify([1000, 7500, 3000, 10000]))
    expect(order.indexOf(JSON.stringify([100, 7500, 4900, 10000]))).toBeLessThan(order.indexOf(JSON.stringify([1000, 7500, 3000, 10000])))
  })
})

describe('views and their lines', () => {
  const pasted = (doc: Document, ids: string[], offset = { x: 10000, y: 0 }, into = doc) => pasteNodes(into, copyNodes(doc, ids), 'page_1', offset)
  const added = (before: Document, after: Document, type: 'viewline' | 'elevation') => Object.values(after.nodes).filter((n) => n.type === type && !before.nodes[n.id]) as NodeOf<typeof type>[]

  it('pasted with their walls and their line, look from the line pasted at the walls pasted', () => {
    const doc = add(room(), north)
    const out = pasted(doc, ['n', 'e', 's', 'w', 'v', 'vv']).doc
    const [line] = added(doc, out, 'viewline') as NodeOf<'viewline'>[]
    const [view] = added(doc, out, 'elevation') as NodeOf<'elevation'>[]
    expect(line).toMatchObject({ a: { x: 10100, y: 1100 }, b: { x: 14900, y: 1100 } })
    expect(view).toMatchObject({ line: line.id, x: 10100 })
  })

  it('copied or cut alone, are views of the same line, which stays where it is', () => {
    const doc = add(room(), north)
    const out = pasted(doc, ['vv']).doc
    expect(added(doc, out, 'viewline')).toEqual([])
    expect(added(doc, out, 'elevation')).toMatchObject([{ line: 'v', x: 10100 }])
    expect(out.nodes.v).toBe(doc.nodes.v)
    // Cut, and pasted on another page: the line on the plan, the view on the other page.
    const clip = copyNodes(doc, ['vv'])
    const cut = applyOps(doc, [{ op: 'remove_node', id: 'vv' }, { op: 'add_node', node: { type: 'page', id: 'sheet', parent: null } }])
    expect(cut.nodes.v).toBe(doc.nodes.v)
    const there = pasteNodes(cut, clip, 'sheet', { x: 0, y: 0 }).doc
    expect(added(cut, there, 'elevation')).toMatchObject([{ line: 'v', parent: 'sheet', x: 100 }])
  })

  it('pasted alone into a drawing without their line, bring it where it was', () => {
    const doc = add(room(), north)
    const elsewhere = createDocument('Other')
    const out = pasted(doc, ['vv'], { x: 10000, y: 0 }, elsewhere).doc
    const [line] = added(elsewhere, out, 'viewline') as NodeOf<'viewline'>[]
    expect(line).toMatchObject({ a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 })
    expect(added(elsewhere, out, 'elevation')).toMatchObject([{ line: line.id, x: 10100 }])
    // A clipboard with a line referred to reads as one.
    expect(parseDocument(JSON.parse(JSON.stringify(copyNodes(doc, ['vv'])))).nodes.v).toMatchObject({ type: 'viewline' })
  })

  it('come along with their line copied alone: a new line, with views of its own', () => {
    const doc = add(room(), north)
    const out = pasted(doc, ['v']).doc
    const [line] = added(doc, out, 'viewline') as NodeOf<'viewline'>[]
    expect(line).toMatchObject({ a: { x: 10100, y: 1100 } })
    expect(added(doc, out, 'elevation')).toMatchObject([{ line: line.id, x: 10100 }])
    expect(viewsOf(out, 'v').map((v) => v.id)).toEqual(['vv'])
  })

  it('go with their line when it is removed; the line stays when they are', () => {
    const doc = add(room(), north)
    expect(applyOps(doc, [{ op: 'remove_node', id: 'v' }]).nodes.vv).toBeUndefined()
    expect(applyOps(doc, [{ op: 'remove_node', id: 'vv' }]).nodes.v).toBe(doc.nodes.v)
  })

  it('are of a line of the drawing, or are refused, and taken out of a drawing read without it', () => {
    const doc = add(room(), north)
    expect(() => applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { line: 'n' } }])).toThrow(/view line/)
    const json = JSON.parse(JSON.stringify(doc))
    delete json.nodes.v
    expect(parseDocument(json).nodes.vv).toBeUndefined()
    expect(lineOf(doc, doc.nodes.vv as NodeOf<'elevation'>)?.id).toBe('v')
  })

  it('are of another line once it is chosen, drawn where they were', () => {
    const doc = add(room(), north, { type: 'viewline', id: 'across', a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 } })
    const other = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { line: 'across' } }])
    // Now a section across the room: the west and east walls cut through.
    expect(boxes(drawn(other))).toEqual(expect.arrayContaining([[-100, 7500, 100, 10000]].map(([x0, y0, x1, y1]) => [x0 + 600, y0, x1 + 600, y1])))
  })

  it('saved by a development version with their own line, open with a line of their own', () => {
    const doc = add(room())
    const json = JSON.parse(JSON.stringify(doc))
    json.nodes.old = { id: 'old', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000, obstructions: false }
    const { doc: read, repairs } = readDocument(json)
    // Saying whether it shows walls as it is now said.
    expect(read.nodes.old).toEqual({ id: 'old', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', line: 'old_line', x: 100, y: 10000, walls: false })
    expect(read.nodes.old_line).toEqual({ id: 'old_line', type: 'viewline', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North, line', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 })
    expect(repairs[0]).toMatch(/development version/)
    // It still draws the north face.
    expect(boxes(drawn(read, 'old'))).toContainEqual([100, 7500, 4900, 10000])
  })

  it('see what their line, mirrored, sees mirrored: its ends change places', () => {
    const doc = add(room(), north)
    const ops = transformOps(doc, [doc.nodes.v], { pivot: { x: 2500, y: 0 }, mirror: true }, registry)
    expect(applyOps(doc, ops).nodes.v).toMatchObject({ a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 } })
  })
})

describe('what a view sees, on the plan', () => {
  it('is beyond its line, the way it looks, as deep as it says: for an elevation, up to the face', () => {
    expect(seenArea(north)).toEqual([{ x: 100, y: 1100 }, { x: 4900, y: 1100 }, { x: 4900, y: 100 }, { x: 100, y: 100 }])
    expect(farSide(north)).toEqual([{ x: 100, y: 100 }, { x: 4900, y: 100 }])
    // A section across at y = 2000 seen from the south, looking north: 6 m beyond it by default.
    expect(seenArea({ a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 } })[2]).toEqual({ x: 5500, y: -4000 })
  })

  it('is set by dragging the handle in the middle of its far side, never below nothing', () => {
    const doc = add(room(), north)
    const view = doc.nodes.v as NodeOf<'viewline'>
    const kind = kindOf(view)
    // On the face, the middle of its far side.
    expect(kind.handles!(view, registry)[0]).toEqual({ x: 2500, y: 100 })
    expect(kind.moveHandle!(view, 0, { x: 2600, y: 600 }, registry)).toEqual({ depth: 500 })
    expect(kind.moveHandle!(view, 0, { x: 2600, y: 1600 }, registry)).toEqual({ depth: 0 })
    expect(depthThrough({ a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 } }, { x: 0, y: 500 })).toBe(1500)
  })

  it('is an elevation while its far side is on a face, and a section once it is not', () => {
    const doc = add(room(), north)
    expect(elevationWall(doc, doc.nodes.v as NodeOf<'viewline'>)?.wall.id).toBe('n')
    const shallower = applyOps(doc, [{ op: 'update_node', id: 'v', patch: { depth: 500 } }])
    expect(elevationWall(shallower, shallower.nodes.v as NodeOf<'viewline'>)).toBeNull()
    // A section no longer follows the wall.
    const moved = applyEdit(shallower, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }], registry).doc
    expect(moved.nodes.v).toBe(shallower.nodes.v)
  })

  it('is made of a face by the tool: its line 1 m in front of it, seeing up to it', () => {
    expect(viewOfFace({ a: { x: 100, y: 100 }, b: { x: 4900, y: 100 } })).toEqual({ a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 })
  })
})

describe('walls in the way of a view', () => {
  /** A wall along y = 0 and a wall going off from its start at 45°, into what an elevation of its lower face sees. */
  const slanted = () => add(createDocument('Slanted'), wall('w', [0, 0], [4000, 0]), wall('side', [0, 0], [2000, 2000]))
  /** The walls a view draws in front of its faces, cut or in the way: plain grey. */
  const grey = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.closed && p.fill === '#e8ecf1')

  it('are drawn grey over the width of the face they hide, as far as the depth reaches, with where they are cut', () => {
    const doc = slanted()
    const face = wallFaceAt(doc, 'page_1', { x: 3000, y: 400 }, 500)!
    // The face starts where the wall at 45° meets it, 141 mm off the corner (100 × √2) plus the half thickness.
    expect(face.a.x).toBeCloseTo(241, 0)
    const viewed = add(doc, { type: 'elevation', id: 'v', ...viewOfFace(face), x: face.a.x, y: 10000 })
    // Seen from 1 m in front of the face, at y = 1100: the slanted wall crosses that line from x = 959
    // to 1241, where it is cut; between the cut and the face, from the corner at 241 to 959, it hides
    // the face. One wall: one grey block, from 241 to 1241.
    const hidden = boxes(grey(drawn(viewed)))
    expect(hidden).toHaveLength(1)
    expect(hidden[0][0]).toBeCloseTo(241, -1)
    expect(hidden[0][2]).toBeCloseTo(1241, -1)
    // Seen from closer, at 400 in front, it is cut nearer the corner, up to 641.
    const near = add(doc, { type: 'elevation', id: 'v', ...viewOfFace(face, 400), x: face.a.x, y: 10000 })
    expect(boxes(grey(drawn(near)))[0][2]).toBeCloseTo(641, -1)
  })

  it('are left out when the view says so, to see the whole face', () => {
    const doc = slanted()
    const face = wallFaceAt(doc, 'page_1', { x: 3000, y: 400 }, 500)!
    expect(grey(drawn(add(doc, { type: 'elevation', id: 'v', ...viewOfFace(face), x: 0, y: 10000, walls: false })))).toEqual([])
  })

  it('are only the walls at the corners in a room of square corners, beside the face, and none over a face seen from on it', () => {
    // The north face from 100 to 4900; the walls at its corners cut beside it.
    const corners = boxes(grey(drawn(add(room(), north))))
      .map((b) => [b[0], b[2]])
      .sort((p, q) => p[0] - q[0])
    expect(corners).toEqual([[-100, 100], [4900, 5100]])
    const doc = slanted()
    const face = wallFaceAt(doc, 'page_1', { x: 3000, y: 400 }, 500)!
    const onIt = add(doc, { type: 'elevation', id: 'v', ...viewOfFace(face, 0), x: face.a.x, y: 10000 })
    expect(boxes(grey(drawn(onIt))).every((b) => b[2] <= face.a.x + 1)).toBe(true)
  })

  it('are drawn in a section behind its line, a nearer one over the faces behind it', () => {
    // Looking north across the room from y = 3000: a wall at an angle in the room, behind the line.
    const doc = add(room(), wall('slant', [1000, 1000], [2000, 2000]), { type: 'elevation', id: 'v', a: { x: -500, y: 3000 }, b: { x: 5500, y: 3000 }, x: -500, y: 10000 })
    const prims = drawn(doc)
    const slant = grey(prims).find((p) => boxes([p])[0][0] > 800 && boxes([p])[0][0] < 1100)!
    // The north face first, then the slanted wall over it.
    expect(slant).toBeDefined()
    const face = prims.findIndex((p) => p.kind === 'path' && p.closed && p.fill === '#ffffff' && p.points.some((q) => Math.round(q.x) === 100))
    expect(face).toBeGreaterThanOrEqual(0)
    expect(face).toBeLessThan(prims.indexOf(slant))
  })
})

describe('kitchen units and others standing against a wall', () => {
  const unitAt = (doc: Document, kind: string, p: { x: number; y: number }) => snapMountToWall(doc, 'page_1', registry, { kind, props: {} }, p, 500, 100)
  const round = (at: { x: number; y: number; rotation: number } | null) => at && { x: Math.round(at.x), y: Math.round(at.y), rotation: Math.round(at.rotation) }

  it('go with their back against the face beside the pointer, their middle under it, on either face', () => {
    // A hob 600 wide: its middle at x = 2000, so its corner at 1700, its back on the inside face at y = 100.
    expect(round(unitAt(room(), 'arch.hob', { x: 2030, y: 400 }))).toEqual({ x: 1700, y: 100, rotation: 0 })
    // On the outside of the north wall, turned round: its own X runs the other way, so its corner is at 2300.
    expect(round(unitAt(room(), 'arch.hob', { x: 2030, y: -400 }))).toEqual({ x: 2300, y: -100, rotation: 180 })
  })

  it('stay all on the face, stopping in the corner of the room when pushed towards it', () => {
    // A fridge 600 wide pushed into the north-west corner: its side against the west wall's face at x = 100.
    expect(round(unitAt(room(), 'arch.fridge', { x: 300, y: 250 }))).toEqual({ x: 100, y: 100, rotation: 0 })
  })

  it('follow their wall, are drawn standing in elevations, and have no height above the floor', () => {
    const doc = add(room(), { type: 'parametric', id: 'f', kind: 'arch.fridge', props: {}, ...unitAt(room(), 'arch.fridge', { x: 1000, y: 400 })! })
    expect(mountedOn(doc, doc.nodes.f, registry)).toMatchObject({ face: 'right' })
    expect(heightAboveFloor(doc.nodes.f, registry)).toBeNull()
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }], registry).doc
    expect((moved.nodes.f as NodeOf<'parametric'>).y).toBe(150)
    // The fridge stands 1850 high in front of the face: a box from 700 to 1300, as tall as that.
    const viewed = add(doc, north)
    expect(boxes(drawn(viewed))).toContainEqual([700, 8150, 1300, 10000])
    expect(elevationItemAt(viewed.nodes.vv as NodeOf<'elevation'>, viewed, registry, { x: 1000, y: 9000 })).toMatchObject({ role: 'standing' })
  })

  it('are not said to be off a wall when standing free, as an island is', () => {
    const doc = add(room(), { type: 'parametric', id: 'h', kind: 'arch.hob', props: {}, x: 2000, y: 200 })
    expect(checkDrawing(doc, registry).filter((p) => p.kind === 'fixed-off-wall')).toEqual([])
  })
})

describe('what stands against a slanted wall', () => {
  it('is drawn as wide as it is, two units side by side touching and not overlapping', () => {
    // A wall at 30°, and two hobs 600 wide against its lower face, one after the other along it.
    const doc0 = add(createDocument('Slanted'), wall('w', [0, 0], [4000, 2309.4]))
    const wallNode = doc0.nodes.w as NodeOf<'wall'>
    const hob = { kind: 'arch.hob', props: {} }
    const doc = add(doc0, { type: 'parametric', id: 'h1', ...hob, ...mountAt(hob, { on: 'floor' }, wallNode, 'right', 1000) }, { type: 'parametric', id: 'h2', ...hob, ...mountAt(hob, { on: 'floor' }, wallNode, 'right', 1600) })
    const face = wallFaceAt(doc, 'page_1', { x: 2000, y: 1600 }, 500)!
    const viewed = add(doc, { type: 'elevation', id: 'v', ...viewOfFace(face), x: 0, y: 10000 })
    // The hobs stand 900 high: their boxes are the two that reach 9100.
    const hobs = boxes(drawn(viewed)).filter((b) => b[1] === 9100).sort((p, q) => p[0] - q[0])
    expect(hobs).toHaveLength(2)
    expect(hobs[0][2] - hobs[0][0]).toBeCloseTo(600, -1)
    expect(hobs[1][2] - hobs[1][0]).toBeCloseTo(600, -1)
    expect(Math.abs(hobs[1][0] - hobs[0][2])).toBeLessThanOrEqual(1)
  })
})

describe('a view made shorter by its ends', () => {
  it('looks at part of the face only, what it still shows staying where it was on the sheet', () => {
    const doc = add(room(), socketAt('s1', 2000), north)
    const view = doc.nodes.v as NodeOf<'viewline'>
    const kind = kindOf(view)
    expect(kind.handles!(view, registry).slice(1, 3)).toEqual([view.a, view.b])
    // Its start dragged to x = 1100 (wherever across the line): drawn from 1000 further right.
    const start = kind.moveHandle!(view, 1, { x: 1100, y: 1120 }, registry)!
    expect(start).toEqual({ a: { x: 1100, y: 1100 } })
    // Its view drawn 1000 further right.
    expect(keepViewsOps(doc, view, start)).toEqual([{ op: 'update_node', id: 'vv', patch: { x: 1100 } }])
    const shorter = applyOps(doc, [{ op: 'update_node', id: 'v', patch: start }, ...keepViewsOps(doc, view, start)])
    // The socket at x = 2000 is drawn where it was: at x = 2000 on the sheet.
    expect(elevationItemAt(shorter.nodes.vv as NodeOf<'elevation'>, shorter, registry, { x: 2000, y: 9700 })).toMatchObject({ node: { id: 's1' } })
    // The face from 1100 only.
    expect(boxes(drawn(shorter))[0]).toEqual([1100, 7500, 4900, 10000])
    expect(kind.moveHandle!(view, 2, { x: 3000, y: 1090 }, registry)).toEqual({ b: { x: 3000, y: 1100 } })
  })

  it('cannot have its ends cross: it stays 100 long', () => {
    const view = add(room(), north).nodes.v as NodeOf<'viewline'>
    expect(kindOf(view).moveHandle!(view, 1, { x: 6000, y: 1100 }, registry)).toEqual({ a: { x: 4800, y: 1100 } })
    expect(kindOf(view).moveHandle!(view, 2, { x: -500, y: 1100 }, registry)).toEqual({ b: { x: 200, y: 1100 } })
  })

  it('keeps its ends where they are along the wall when the wall is moved', () => {
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'v', patch: { a: { x: 1100, y: 1100 }, b: { x: 3000, y: 1100 } } }])
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }], registry).doc
    expect(moved.nodes.v).toMatchObject({ a: { x: 1100, y: 1150 }, b: { x: 3000, y: 1150 } })
  })

  it('turns into a section when an end is dragged well off its line, which then follows no wall', () => {
    const view = add(room(), north).nodes.v as NodeOf<'viewline'>
    // Its end dragged 1 m off the line, 2 m back: far more than a few degrees.
    expect(kindOf(view).moveHandle!(view, 2, { x: 2900, y: 2100 }, registry)).toEqual({ b: { x: 2900, y: 2100 } })
  })
})


describe('a wall cabinet', () => {
  it('is drawn dashed on the plan, as what is above the cut is', () => {
    const cabinet = registry.parametric.get('arch.wallcabinet')!
    const plan = cabinet.build(registry.resolveProps(cabinet, {}), {})
    expect(plan.every((p) => p.kind === 'path' && p.dash)).toBe(true)
  })

  it('hangs against the wall beside the pointer, by its middle, its height that of its underside', () => {
    const at = snapMountToWall(room(), 'page_1', registry, { kind: 'arch.wallcabinet', props: {} }, { x: 2030, y: 400 }, 500, 100)
    expect(at && { x: Math.round(at.x), y: Math.round(at.y), rotation: Math.round(at.rotation) }).toEqual({ x: 1700, y: 100, rotation: 0 })
    const doc = add(room(), { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: { doors: 2 }, ...at! }, north)
    expect(heightAboveFloor(doc.nodes.c, registry)).toBe(1450)
    // In the elevation, from its underside at 1450 to its top at 2150, 600 wide, and dimensioned to its underside.
    const prims = drawn(doc)
    expect(boxes(prims)).toContainEqual([1700, 7850, 2300, 8550])
    expect(texts(prims)).toContain('1450')
    expect(elevationItemAt(doc.nodes.vv as NodeOf<'elevation'>, doc, registry, { x: 2000, y: 8200 })).toMatchObject({ role: 'fixed', raises: true, node: { id: 'c' } })
  })
})

describe('what is made to be fixed on a wall but stands in the room', () => {
  it('is drawn at its height when in view, and dragged there across the view and up and down', () => {
    // A section across the room at y = 3000, looking north 2 m deep, and a wall cabinet out in the room at y = 2000.
    const doc = add(room(), { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: {}, x: 1700, y: 2000 }, { type: 'elevation', id: 'v', a: { x: -500, y: 3000 }, b: { x: 5500, y: 3000 }, depth: 2000, x: -500, y: 10000 })
    // Its underside at 1450, its top at 2150, 600 wide from x = 1700.
    expect(boxes(drawn(doc))).toContainEqual([1700, 7850, 2300, 8550])
    const view = doc.nodes.vv as NodeOf<'elevation'>
    expect(elevationItemAt(view, doc, registry, { x: 2000, y: 8200 })).toMatchObject({ role: 'fixed', node: { id: 'c' } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.c as NodeOf<'parametric'>, 300, 100)).toEqual({ x: 2000, y: 2000, z: 1550 })
    // Beyond its depth, it is not drawn.
    const shallow = applyOps(doc, [{ op: 'update_node', id: 'v', patch: { depth: 500 } }])
    expect(boxes(drawn(shallow))).not.toContainEqual([1700, 7850, 2300, 8550])
  })
})

describe('what a view sees, resized by its corners', () => {
  // The north elevation: its line at y = 1100 from x = 100 to 4900, its far side on the face at y = 100.
  const view = () => add(room(), north).nodes.v as NodeOf<'viewline'>

  it('has a point at each corner, on its line and on its far side', () => {
    expect(kindOf(view()).handles!(view(), registry).slice(3, 7)).toEqual([{ x: 100, y: 1100 }, { x: 4900, y: 1100 }, { x: 4900, y: 100 }, { x: 100, y: 100 }])
  })

  it('with Shift, by a far corner, sees less far and starts further along, its line where it was, a rectangle still', () => {
    // The far corner at the start dragged to (1000, 500), whatever its slant: start at 1000, 600 deep.
    expect(moveViewCorner(view(), 3, { x: 1000, y: 500 }, 'stretch')).toEqual({ a: { x: 1000, y: 1100 }, depth: 600 })
    expect(moveViewCorner(view(), 2, { x: 3000, y: 300 }, 'stretch')).toEqual({ b: { x: 3000, y: 1100 }, depth: 800 })
  })

  it('with Shift, by a corner on its line, moves its line, its far side staying on the face: still an elevation of it', () => {
    const patch = moveViewCorner(view(), 1, { x: 3000, y: 600 }, 'stretch')
    expect(patch).toEqual({ a: { x: 100, y: 600 }, b: { x: 3000, y: 600 }, depth: 500 })
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'v', patch }])
    expect(elevationWall(doc, doc.nodes.v as NodeOf<'viewline'>)?.wall.id).toBe('n')
  })

  it('with Shift, stays 100 long, and sees no less than nothing', () => {
    expect(moveViewCorner(view(), 2, { x: -2000, y: 100 }, 'stretch')).toMatchObject({ b: { x: 200, y: 1100 } })
    expect(moveViewCorner(view(), 0, { x: 100, y: -500 }, 'stretch')).toMatchObject({ depth: 0 })
    expect(moveViewCorner(view(), 2, { x: 4900, y: 3000 }, 'stretch')).toMatchObject({ depth: 0 })
  })

  it('by a corner, turns about the corner across from it, keeping its depth, the corner dragged where the pointer is', () => {
    // The far corner at the end dragged 2 m up from the face: the area turns about its start, (100, 1100).
    const patch = kindOf(view()).moveHandle!(view(), 5, { x: 4900, y: -1900 }, registry) as { a: Vec2; b: Vec2; depth: number }
    expect(patch.a).toEqual({ x: 100, y: 1100 })
    expect(patch.depth).toBe(1000)
    const turned = applyOps(add(room(), north), [{ op: 'update_node', id: 'v', patch }])
    const area = seenArea(turned.nodes.v as NodeOf<'viewline'>)
    // That corner where the pointer is, the area a rectangle 1000 deep, and no longer an elevation of the face.
    expect(area[2].x).toBeCloseTo(4900, 6)
    expect(area[2].y).toBeCloseTo(-1900, 6)
    expect(Math.hypot(area[3].x - area[0].x, area[3].y - area[0].y)).toBeCloseTo(1000, 6)
    expect((area[1].x - area[0].x) * (area[3].x - area[0].x) + (area[1].y - area[0].y) * (area[3].y - area[0].y)).toBeCloseTo(0, 3)
    expect(elevationWall(turned, turned.nodes.v as NodeOf<'viewline'>)).toBeNull()
  })

  it('by an edge, taken anywhere along it, moves that edge across only, as a wall’s face is', () => {
    // The line brought 400 nearer the face, wherever along it: the far side stays on the face.
    const nearer = moveViewEdge(view(), 'line', { x: 3700, y: 700 })
    expect(nearer).toEqual({ a: { x: 100, y: 700 }, b: { x: 4900, y: 700 }, depth: 600 })
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'v', patch: nearer }])
    expect(elevationWall(doc, doc.nodes.v as NodeOf<'viewline'>)?.wall.id).toBe('n')
    // Never past its far side.
    expect(moveViewEdge(view(), 'line', { x: 2000, y: -300 })).toMatchObject({ depth: 0 })
    // Its far side, its sides at the start and the end.
    expect(moveViewEdge(view(), 'far', { x: 4000, y: 500 })).toEqual({ depth: 600 })
    expect(moveViewEdge(view(), 'start', { x: 900, y: 300 })).toEqual({ a: { x: 900, y: 1100 } })
    expect(moveViewEdge(view(), 'end', { x: 4000, y: 600 })).toEqual({ b: { x: 4000, y: 1100 } })
    expect(moveViewEdge(view(), 'end', { x: -3000, y: 600 })).toEqual({ b: { x: 200, y: 1100 } })
    // As handles: the middles of the line and of the sides at its ends, after the corners.
    expect(kindOf(view()).handles!(view(), registry).slice(7)).toEqual([{ x: 2500, y: 1100 }, { x: 100, y: 600 }, { x: 4900, y: 600 }])
    expect(kindOf(view()).moveHandle!(view(), 8, { x: 900, y: 300 }, registry)).toEqual({ a: { x: 900, y: 1100 } })
  })

  it('by a corner dragged nearly its way, only gets longer or shorter, still an elevation of its face', () => {
    // The far corner at the end brought back along the face to x = 3000: no turn at all.
    expect(kindOf(view()).moveHandle!(view(), 5, { x: 3000, y: 100 }, registry)).toEqual({ a: { x: 100, y: 1100 }, b: { x: 3000, y: 1100 }, depth: 1000 })
    // A little off the face, within a few degrees: the same.
    expect(kindOf(view()).moveHandle!(view(), 5, { x: 3000, y: 150 }, registry)).toMatchObject({ b: { x: 3000, y: 1100 }, depth: 1000 })
  })
})
