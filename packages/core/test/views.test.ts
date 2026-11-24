import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import electrical from '../../warehouse/extensions/electrical.json'
import furniture from '../../warehouse/extensions/furniture.json'
import { applyOps, sheetScaleAt, coveredInScene, buildScene, childrenOf, placeInOps, relocateClip, withPlacement, viewPlacement, toSVG, elevationWall, farSide, keptViewPatch, viewScale, lineOf, moveOps, moveViewCorner, moveViewEdge, parseDocument, readDocument, serializeDocument, transformOps, viewOfFace, type Vec2, checkDrawing, copyNodes, createDocument, declarativeExtension, depthThrough, elevationHeightOps, elevationItemAt, elevationItemsOf, elevationMovePatch, elevationSplitOps, elevationSplits, applyEdit, heightAboveFloor, heightText, kindOf, mountAt, mountedOn, nodePrimitives, pasteNodes, Registry, seenArea, snapMountToWall, wallFaceAt, type Document, type NodeOf, type Op, type Primitive } from '../src'
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

  it('are left out when the elevation says so', () => {
    expect(texts(drawn(add(room(), socketAt('s1', 1100), { ...north, dimensions: false })))).toEqual([])
  })

  it('give the face from end to end and its height, with nothing on it; and its name is not written', () => {
    // The face from 100 to 4900, 2500 high (the height walls are given when they say none).
    expect(texts(drawn(add(room(), { ...north, name: 'North' }))).sort()).toEqual(['2500', '4800'])
  })

  it('chain the sides of the doors, windows and furniture under the sockets and cabinets, and give a window its sill and top', () => {
    const doc = add(
      room(),
      { type: 'parametric', id: 'win', kind: 'arch.window', props: { width: 1200 }, x: 1000, y: 0 },
      { type: 'parametric', id: 'u1', kind: 'arch.baseunit', props: { width: 600 }, x: 2600, y: 100 },
      { type: 'parametric', id: 'c1', kind: 'arch.wallcabinet', props: { width: 600 }, x: 3200, y: 100 },
      north,
    )
    expect(texts(drawn(doc)).sort()).toEqual(
      [
        // The wall cabinet is fixed on the wall, as a socket: from the corner to it, on to the other, and its underside.
        '3100', '1700', '1450',
        // Then the window and the unit along the floor: 900 to the window, its 1200, 400 on, the unit's 600, 1700 to the corner.
        '900', '1200', '400', '600', '1700',
        // The window's sill, 900, and on to its top, 1250 higher.
        '900', '1250',
        // The face, from end to end, and its height.
        '4800', '2500',
      ].sort(),
    )
  })
})

describe('what covers a view', () => {
  it('is a filled shape stacked over it, in the order of the list, that meets it; not one under it, nor one only outlined', () => {
    const box = { minX: 100, minY: 7500, maxX: 4900, maxY: 10000 }
    const rect = (fill?: string, x = 0) => ({ type: 'rect', id: 'r', x, y: 7000, width: 6000, height: 4000, style: { fill: fill ?? 'none' } })
    // Added after the view, it is on top of it; before, under it.
    const covers = (...nodes: Record<string, unknown>[]) => coveredInScene(buildScene(add(room(), ...nodes), 'page_1', registry), 'vv', box)
    expect(covers(north, rect('#1144aa'))).toBe(true)
    expect(covers(rect('#1144aa'), north)).toBe(false)
    expect(covers(north, rect())).toBe(false)
    // Beside it, not over it.
    expect(covers(north, rect('#1144aa', 20000))).toBe(false)
  })
})

describe('the scale a view is drawn at', () => {
  it("is read against the sheet under it, the one on top, on its own page; on none, 1:100", () => {
    const sheets = add(
      room(),
      { type: 'paper', id: 'p50', x: 0, y: 8000, width: 42000, height: 29700, scale: 50, order: 'a1' },
      { type: 'paper', id: 'p20', x: 0, y: 9000, width: 8400, height: 5940, scale: 20, order: 'a2' },
    )
    const second = applyOps(sheets, [{ op: 'add_node', node: { type: 'page', id: 'page_2', parent: null } as never }])
    expect(sheetScaleAt(second, 'page_1', { x: 20000, y: 20000 })).toBe(50)
    // Two sheets under it: the one drawn over the other.
    expect(sheetScaleAt(second, 'page_1', { x: 100, y: 10000 })).toBe(20)
    // Beside every sheet, or on a page where they are not.
    expect(sheetScaleAt(second, 'page_1', { x: -5000, y: 0 })).toBe(100)
    expect(sheetScaleAt(second, 'page_2', { x: 20000, y: 20000 })).toBe(100)
  })
})

describe('the automatic dimensions of a view', () => {
  /** The kitchen wall of the test above: a window, a base unit, a wall cabinet; its view's automatic dimensions set as `rows` say. */
  const kitchen = (rows: Record<string, unknown> = {}) =>
    applyOps(
      add(
        room(),
        { type: 'parametric', id: 'win', kind: 'arch.window', props: { width: 1200 }, x: 1000, y: 0 },
        { type: 'parametric', id: 'u1', kind: 'arch.baseunit', props: { width: 600 }, x: 2600, y: 100 },
        { type: 'parametric', id: 'c1', kind: 'arch.wallcabinet', props: { width: 600 }, x: 3200, y: 100 },
        north,
      ),
      [{ op: 'update_node', id: 'vvd', patch: rows }],
    )

  it('are what the view holds, listed under it: removed, the view draws none', () => {
    const doc = kitchen()
    expect(childrenOf(doc, 'vv').map((n) => n.type)).toEqual(['autodimensions'])
    expect(texts(drawn(applyOps(doc, [{ op: 'remove_node', id: 'vvd' }])))).toEqual([])
  })

  it('leave out each row they are told to', () => {
    const all = texts(drawn(kitchen())).sort()
    // Without what is fixed on the face: no 3100 to the cabinet, nor 1700 on to the corner of that row.
    expect(texts(drawn(kitchen({ fixed: false }))).sort()).toEqual(['900', '1200', '400', '600', '1700', '1450', '900', '1250', '4800', '2500'].sort())
    // Without the doors, windows and furniture along the floor.
    expect(texts(drawn(kitchen({ pieces: false }))).sort()).toEqual(['3100', '1700', '1450', '900', '1250', '4800', '2500'].sort())
    // Without the face from end to end and its height.
    expect(texts(drawn(kitchen({ overall: false }))).sort()).toEqual(all.filter((t, i, list) => !(t === '4800' || (t === '2500' && list.indexOf(t) === i))).sort())
    // Without the heights of what is on it: the chains, and the face's own height, which is of the face from end to end.
    expect(texts(drawn(kitchen({ heights: false }))).sort()).toEqual(['3100', '1700', '900', '1200', '400', '600', '1700', '4800', '2500'].sort())
  })

  it('give no underside to what stands on the floor, nor a dimension to the few millimetres between two units', () => {
    const doc = add(
      room(),
      // A unit raised 50 off the floor (its plinth), and another 8 mm from it.
      { type: 'parametric', id: 'u1', kind: 'arch.baseunit', props: { width: 600 }, x: 1000, y: 100, z: 50 },
      { type: 'parametric', id: 'u2', kind: 'arch.baseunit', props: { width: 600 }, x: 1608, y: 100 },
      north,
    )
    const said = texts(drawn(doc))
    expect(said).not.toContain('50')
    expect(said).not.toContain('8')
    // 900 to the first, its 600, then 608 to the end of the second (the 8 taken in), 2692 on to the corner.
    expect(said).toEqual(expect.arrayContaining(['900', '600', '608', '2692', '4800']))
  })

  it('are drawn in the dimension style they say, and go in a view only', () => {
    const styled = applyOps(kitchen(), [
      { op: 'add_dimension_style', dimensionStyle: { id: 'big', name: 'Big', size: 300 } } as never,
      { op: 'update_node', id: 'vvd', patch: { dimensionStyle: 'big' } },
    ])
    const sizes = drawn(styled).flatMap((p) => (p.kind === 'text' ? [p.size] : []))
    expect(new Set(sizes)).toEqual(new Set([300]))
    expect(() => applyOps(room(), [{ op: 'add_node', node: { type: 'autodimensions', parent: 'page_1' } as never }])).toThrow(/go in an elevation/)
  })

  it('are given to the views of a drawing of before 2.2 that drew them, not to one that said none', () => {
    const json = JSON.parse(JSON.stringify(room()))
    json.version = 5
    json.nodes.line = { id: 'line', type: 'viewline', parent: 'page_1', order: 'a8', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 }
    json.nodes.drew = { id: 'drew', type: 'elevation', parent: 'page_1', order: 'a9', line: 'line', x: 100, y: 10000 }
    json.nodes.none = { id: 'none', type: 'elevation', parent: 'page_1', order: 'aA', line: 'line', x: 100, y: 20000, dimensions: false }
    const doc = parseDocument(json)
    expect(childrenOf(doc, 'drew').map((n) => n.type)).toEqual(['autodimensions'])
    expect(childrenOf(doc, 'none')).toEqual([])
    expect(doc.nodes.none).not.toHaveProperty('dimensions')
    expect(texts(drawn(doc, 'drew'))).toEqual(expect.arrayContaining(['4800', '2500']))
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
  it('goes up by its sill height, and a door too, never below the floor', () => {
    const doc = add(room(), { type: 'parametric', id: 'win', kind: 'arch.window', props: {}, x: 2000, y: 0 }, { type: 'parametric', id: 'door', kind: 'arch.door', props: {}, x: 500, y: 0 }, north)
    const view = doc.nodes.vv as NodeOf<'elevation'>
    expect(elevationItemAt(view, doc, registry, { x: 2600, y: 10000 - 1500 })).toMatchObject({ role: 'opening', raises: true, node: { id: 'win' } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.win as NodeOf<'parametric'>, 0, 200)).toEqual({ x: 2000, y: 0, props: { sillHeight: 1100 } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.win as NodeOf<'parametric'>, 0, -2000)).toEqual({ x: 2000, y: 0, props: { sillHeight: 0 } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.door as NodeOf<'parametric'>, 0, 200)).toEqual({ x: 500, y: 0, props: { sillHeight: 200 } })
    expect(elevationMovePatch(view, doc, registry, doc.nodes.door as NodeOf<'parametric'>, 0, -200)).toEqual({ x: 500, y: 0, props: { sillHeight: 0 } })
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

  it('is drawn as its kind draws it seen from in front (the bed: its frame from 100 to 300 high), else as a box of its width and height (a component that says how tall it is)', () => {
    const doc = furnished([{ type: 'instance', id: 'c', component: 'chest', x: 3500, y: 150 }], 900)
    expect(boxes(drawn(doc))).toEqual(expect.arrayContaining([[1000, 9700, 2600, 9900], [3500, 9100, 4300, 10000]]))
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

describe('a view and its line', () => {
  const pasted = (doc: Document, ids: string[], offset = { x: 10000, y: 0 }, into = doc, parent = 'page_1') => pasteNodes(into, copyNodes(doc, ids), parent, offset)
  const views = (before: Document, after: Document) => Object.values(after.nodes).filter((n) => n.type === 'elevation' && !before.nodes[n.id]) as NodeOf<'elevation'>[]

  it('are one node: removed, nothing of it is left', () => {
    const doc = add(room(), north)
    const out = applyOps(doc, [{ op: 'remove_node', id: 'vv' }])
    expect(Object.keys(out.nodes).sort()).toEqual(Object.keys(room().nodes).sort())
    expect(lineOf(doc, doc.nodes.vv as NodeOf<'elevation'>)).toMatchObject({ a: north.a, b: north.b, depth: 1000, parent: 'page_1' })
  })

  it('pasted with its walls, looks at the walls pasted: its line moved as they are', () => {
    const doc = add(room(), north)
    const [view] = views(doc, pasted(doc, ['n', 'e', 's', 'w', 'vv']).doc)
    expect(view).toMatchObject({ a: { x: 10100, y: 1100 }, b: { x: 14900, y: 1100 }, x: 10100 })
    expect(view.page).toBeUndefined()
  })

  it('copied or cut alone, looks where it did, from another page too', () => {
    const doc = add(room(), north)
    const [view] = views(doc, pasted(doc, ['vv']).doc)
    expect(view).toMatchObject({ a: north.a, b: north.b, x: 10100 })
    expect(view.page).toBeUndefined()
    // Cut, and pasted on another page: it looks at the plan of the first.
    const clip = copyNodes(doc, ['vv'])
    const cut = applyOps(doc, [{ op: 'remove_node', id: 'vv' }, { op: 'add_node', node: { type: 'page', id: 'sheet', parent: null } }])
    const there = pasteNodes(cut, clip, 'sheet', { x: 0, y: 0 }).doc
    const [moved] = views(cut, there)
    expect(moved).toMatchObject({ parent: 'sheet', page: 'page_1', a: north.a, x: 100 })
    expect(lineOf(there, moved).parent).toBe('page_1')
    expect(boxes(drawn(there, moved.id))).toContainEqual([100, 7500, 4900, 10000])
    // Its line is drawn on the plan it looks at only: not on the sheet, which has no plan.
    expect(drawn(there, moved.id).some((p) => p.screen)).toBe(false)
    expect(drawn(doc).some((p) => p.screen)).toBe(true)
  })

  it('pasted alone into another drawing, looks at the page it is pasted on, from the same place', () => {
    const doc = add(room(), north)
    // A drawing without a page of the id it looked at (a page of the same id would be taken for it).
    const elsewhere = applyOps(createDocument('Other'), [{ op: 'add_node', node: { type: 'page', id: 'other', parent: null } }, { op: 'remove_node', id: 'page_1' }])
    const [view] = views(elsewhere, pasted(doc, ['vv'], { x: 0, y: 0 }, elsewhere, 'other').doc)
    expect(view).toMatchObject({ a: north.a, b: north.b, depth: 1000, parent: 'other' })
    expect(view.page).toBeUndefined()
  })

  it('looks at a page of the drawing, or is refused, and looks at its own once that page is gone', () => {
    const doc = add(room(), north)
    expect(() => applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { page: 'n' } }])).toThrow(/not a page/)
    const json = JSON.parse(JSON.stringify(doc))
    json.nodes.vv.page = 'gone'
    const { doc: read, repairs } = readDocument(json)
    expect(read.nodes.vv).not.toHaveProperty('page')
    expect(repairs.join()).toMatch(/looked at a page/)
  })

  it('moved with the walls it looks at, takes its line along; moved alone, only where it is drawn', () => {
    const doc = add(room(), north)
    const d = { x: 2000, y: 500 }
    const all = ['n', 'e', 's', 'w', 'vv'].flatMap((id) => moveOps(doc, doc.nodes[id], d))
    expect(applyEdit(doc, all, registry).doc.nodes.vv).toMatchObject({ a: { x: 2100, y: 1600 }, b: { x: 6900, y: 1600 }, x: 2100, y: 10500 })
    expect(applyEdit(doc, moveOps(doc, doc.nodes.vv, d), registry).doc.nodes.vv).toMatchObject({ a: north.a, b: north.b, x: 2100 })
  })

  it('of a section, goes with the plan moved whole, the view staying where it is drawn', () => {
    const doc = add(room(), { ...north, depth: 500 })
    const d = { x: 0, y: 3000 }
    const out = applyEdit(doc, ['n', 'e', 's', 'w'].flatMap((id) => moveOps(doc, doc.nodes[id], d)), registry).doc
    expect(out.nodes.vv).toMatchObject({ a: { x: 100, y: 4100 }, b: { x: 4900, y: 4100 }, x: 100, y: 10000 })
    // One wall moved alone is not the plan moved: the section stays where it cuts.
    expect(applyEdit(doc, moveOps(doc, doc.nodes.e, d), registry).doc.nodes.vv).toBe(doc.nodes.vv)
  })

  it('mirrored with its plan, sees what it saw mirrored: its ends change places; turned alone, looks where it did', () => {
    const doc = add(room(), north)
    const plan = ['n', 'e', 's', 'w', 'vv'].map((id) => doc.nodes[id])
    const mirrored = applyOps(doc, transformOps(doc, plan, { pivot: { x: 1000, y: 0 }, mirror: true }, registry)).nodes.vv
    expect(mirrored).toMatchObject({ a: { x: -2900, y: 1100 }, b: { x: 1900, y: 1100 } })
    const turned = applyOps(doc, transformOps(doc, [doc.nodes.vv], { pivot: { x: 0, y: 0 }, rotation: 90 }, registry)).nodes.vv
    expect(turned).toMatchObject({ a: north.a, b: north.b })
  })
})

describe('a view drawn larger or smaller than the plan', () => {
  it('is drawn about its corner (x, y), what it shows and its boxes alike, its dimensions saying the real lengths', () => {
    const doc = add(room(), socketAt('s1', 2000), north)
    const twice = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { scale: 2 } }])
    // The face, from 100 to 4900 and 2500 high, drawn from (100, 10000): twice as wide and high.
    expect(boxes(drawn(twice))).toContainEqual([100, 5000, 9700, 10000])
    const texts = (d: Document) => drawn(d).flatMap((p) => (p.kind === 'text' ? [p.text] : [])).sort()
    expect(texts(twice)).toEqual(texts(doc))
    // The socket, 1900 along the face, is where it is drawn, twice as far: and picked there.
    const view = twice.nodes.vv as NodeOf<'elevation'>
    expect(elevationItemAt(view, twice, registry, { x: 100 + 1900 * 2, y: 10000 - 300 * 2 })?.node.id).toBe('s1')
  })

  it('turns what is dragged in it into as much less on the plan, and a start dragged on the plan into as much more on the sheet', () => {
    const doc = applyOps(add(room(), socketAt('s1', 2000), north), [{ op: 'update_node', id: 'vv', patch: { scale: 2 } }])
    const view = doc.nodes.vv as NodeOf<'elevation'>
    // 1000 along and 400 up in the drawing: 500 along the wall and 200 up on the plan.
    expect(elevationMovePatch(view, doc, registry, doc.nodes.s1 as never, 1000, 400)).toMatchObject({ x: 2500, y: 100 })
    expect(keptViewPatch(view, { a: { x: 1100, y: 1100 } })).toEqual({ a: { x: 1100, y: 1100 }, x: 2100 })
    expect(viewScale({})).toBe(1)
  })
})

describe('what a view holds', () => {
  /** A view of the north face drawn twice as large, holding a dimension across 1000 of the face, 300 under its floor, in its own coordinates. */
  const holding = () =>
    applyOps(add(room(), north), [
      { op: 'update_node', id: 'vv', patch: { scale: 2 } },
      { op: 'add_node', node: { type: 'dimension', id: 'd', parent: 'vv', a: { x: 200, y: 300 }, b: { x: 1200, y: 300 }, offset: 100 } as never },
    ])
  const said = (prims: Primitive[]) => prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []))

  it('is drawn by the view, where it is and as large: a dimension says the real length', () => {
    const doc = holding()
    const own = drawn(doc).filter((p) => p.kind === 'text' && p.text === '1000')
    expect(own.length).toBeGreaterThan(0)
    // Its dimension line 100 under the points, 300 under the floor, all twice as large, from the view's corner (100, 10000).
    const lines = drawn(doc).flatMap((p) => (p.kind === 'path' && p.points.length === 2 && Math.abs(p.points[0].y - (10000 + 400 * 2)) < 1 ? [p.points] : []))
    expect(lines.some(([p, q]) => Math.abs(Math.abs(q.x - p.x) - 2000) < 1)).toBe(true)
    // Moved, the view takes it along: nothing of it changes.
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'vv', patch: { x: 600 } }], registry).doc
    expect(moved.nodes.d).toBe(doc.nodes.d)
    expect(said(drawn(moved))).toEqual(said(drawn(doc)))
  })

  it('goes with the view, removed or copied, and is listed under it', () => {
    const doc = holding()
    expect(applyOps(doc, [{ op: 'remove_node', id: 'vv' }]).nodes.d).toBeUndefined()
    const { doc: out, ids } = pasteNodes(doc, copyNodes(doc, ['vv']), 'page_1', { x: 0, y: 5000 })
    const view = ids.map((id) => out.nodes[id]).find((n) => n.type === 'elevation')!
    expect(childrenOf(out, view.id).filter((n) => n.type === 'dimension')).toMatchObject([{ a: { x: 200, y: 300 } }])
    expect(childrenOf(out, view.id).some((n) => n.type === 'autodimensions')).toBe(true)
  })

  it('holds what is drawn on it only: what is of the plan is refused there', () => {
    expect(() => applyOps(holding(), [{ op: 'add_node', node: { type: 'wall', parent: 'vv', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 100 } as never }])).toThrow(/cannot go in an elevation/)
  })

  /** Where the ends of dimension `id` are seen on the page: through the view that holds it, if one does. */
  const seen = (doc: Document, id: string) => {
    const node = doc.nodes[id] as NodeOf<'dimension'>
    const view = doc.nodes[node.parent!]
    if (view?.type !== 'elevation') return [node.a, node.b]
    const { x, y, scale } = viewPlacement(view)
    return [node.a, node.b].map((p) => ({ x: x + p.x * scale, y: y + p.y * scale }))
  }

  it('is brought into the view, or out of it, when moved there in Structure: where it is seen', () => {
    const doc = applyOps(holding(), [{ op: 'add_node', node: { type: 'dimension', id: 'loose', parent: 'page_1', a: { x: 1100, y: 10400 }, b: { x: 2100, y: 10400 }, offset: 100 } as never }])
    const into = applyOps(doc, placeInOps(doc, ['loose'], 'vv', undefined, registry))
    expect(into.nodes.loose).toMatchObject({ parent: 'vv', a: { x: 500, y: 200 }, b: { x: 1000, y: 200 }, offset: 50 })
    expect(seen(into, 'loose')).toEqual(seen(doc, 'loose'))
    // And out again, onto the page: where it was.
    const out = applyOps(into, placeInOps(into, ['loose'], 'page_1', undefined, registry))
    expect(out.nodes.loose).toMatchObject({ parent: 'page_1', a: { x: 1100, y: 10400 }, b: { x: 2100, y: 10400 }, offset: 100 })
  })

  it('is pasted into a view where it is seen, and copied out of one to where the view drew it', () => {
    const doc = holding()
    const view = viewPlacement(doc.nodes.vv as NodeOf<'elevation'>)
    // Copied from the view, pasted on the page in place: where the view drew it.
    const out = pasteNodes(doc, relocateClip(withPlacement(copyNodes(doc, ['d']), [view]), [view], [], registry), 'page_1', { x: 0, y: 0 })
    const pasted = out.doc.nodes[out.ids[0]] as NodeOf<'dimension'>
    expect([pasted.a, pasted.b]).toEqual(seen(doc, 'd'))
    // Copied from the page and pasted in the view in place: in its coordinates, seen where it was.
    const back = pasteNodes(out.doc, relocateClip(withPlacement(copyNodes(out.doc, [pasted.id]), []), [], [view], registry), 'vv', { x: 0, y: 0 })
    expect(seen(back.doc, back.ids[0])).toEqual(seen(doc, 'd'))
  })

  it('stays over what it measures when the start of the line moves along it, alone; not when the line moves whole', () => {
    const doc = holding()
    const view = doc.nodes.vv as NodeOf<'elevation'>
    // Its start dragged 500 further along, the view drawn as much further on, as its arrow does: the dimension seen where it was.
    const start = applyEdit(doc, [{ op: 'update_node', id: 'vv', patch: kindOf(view).moveHandle!(view, 1, { x: 600, y: 1100 }, registry) }], registry).doc
    expect(start.nodes.d).toMatchObject({ a: { x: -300, y: 300 }, b: { x: 700, y: 300 } })
    expect(seen(start, 'd')).toEqual(seen(doc, 'd'))
    // The line moved whole (with the plan, both ends alike): nothing moves in it.
    const whole = applyEdit(doc, [{ op: 'update_node', id: 'vv', patch: { a: { x: 100, y: 1600 }, b: { x: 4900, y: 1600 } } }], registry).doc
    expect(whole.nodes.d).toBe(doc.nodes.d)
  })

  it('stays over the face when the wall grows at the corner the line starts from', () => {
    // A single wall, its elevation from end to end: lengthened at its start, the view follows its face, and so does what it holds.
    const single = applyOps(add(createDocument('Wall'), wall('n', [0, 0], [5000, 0]), { ...north, a: { x: 0, y: 1100 }, b: { x: 5000, y: 1100 } }), [
      { op: 'add_node', node: { type: 'dimension', id: 'd', parent: 'vv', a: { x: 1000, y: 300 }, b: { x: 2000, y: 300 }, offset: 100 } as never },
    ])
    const grown = applyEdit(single, [{ op: 'update_node', id: 'n', patch: { a: { x: -1000, y: 0 } } }], registry).doc
    const view = grown.nodes.vv as NodeOf<'elevation'>
    expect(view.a.x).toBeLessThan(0)
    // Still over x = 1000 to 2000 of the plan: further along from the line's start, which is now at -1000.
    const dimension = grown.nodes.d as NodeOf<'dimension'>
    expect(view.a.x + dimension.a.x).toBeCloseTo(1000, 0)
    expect(view.a.x + dimension.b.x).toBeCloseTo(2000, 0)
  })

  it('is printed with the view, and what is hidden in it is not drawn', () => {
    const doc = holding()
    expect(toSVG(doc, 'page_1', registry)).toContain('>1000<')
    const hidden = applyOps(doc, [{ op: 'update_node', id: 'd', patch: { visible: false } }])
    expect(said(drawn(hidden))).not.toContain('1000')
  })

  it('is drawn on what the view shows of the plan, inside it: in its coordinates, seen and snapped to, not picked', () => {
    const scene = buildScene(holding(), 'vv', registry)
    const [backdrop] = scene
    expect(backdrop).toMatchObject({ id: 'vv:drawing', locked: true })
    // The face, from 0 to 4800 along, 2500 up.
    expect(boxes(backdrop.prims)).toContainEqual([0, -2500, 4800, 0])
    // What it holds, each an item to pick: its automatic dimensions, and the dimension drawn on it.
    expect(scene.slice(1).map((item) => item.node.type).sort()).toEqual(['autodimensions', 'dimension'])
  })
})

describe('views of a line, as drawings before 2.2 saved them', () => {
  /** A drawing of version 5 with a line, two views of it (one on another page), a line of none, and a view of no line. */
  const before = () => {
    const json = JSON.parse(JSON.stringify(room()))
    json.version = 5
    json.nodes.sheet = { id: 'sheet', type: 'page', parent: null, order: 'a5', name: 'Sheet' }
    json.nodes.line = { id: 'line', type: 'viewline', parent: 'page_1', order: 'a8', layer: 'layer_1', name: 'View line 1', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 }
    json.nodes.one = { id: 'one', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', line: 'line', x: 100, y: 10000, walls: false }
    json.nodes.two = { id: 'two', type: 'elevation', parent: 'sheet', order: 'a0', layer: 'layer_1', name: 'North again', line: 'line', x: 0, y: 0 }
    json.nodes.alone = { id: 'alone', type: 'viewline', parent: 'page_1', order: 'aA', layer: 'layer_1', name: 'Reference', a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 }, visible: false }
    json.nodes.lost = { id: 'lost', type: 'elevation', parent: 'page_1', order: 'aB', line: 'nowhere', x: 0, y: 0 }
    return json
  }

  it('open with each view holding a copy of its line, looking at its page from another', () => {
    const { doc, repairs } = readDocument(before())
    expect(repairs).toEqual([])
    expect(doc.nodes.one).toEqual({ id: 'one', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000, walls: false })
    expect(doc.nodes.two).toMatchObject({ parent: 'sheet', page: 'page_1', a: { x: 100, y: 1100 }, depth: 1000 })
    expect(doc.nodes.line).toBeUndefined()
    // A view of a line that was not there drew nothing: it is not kept.
    expect(doc.nodes.lost).toBeUndefined()
    // Both still draw the north face.
    expect(boxes(drawn(doc, 'one'))).toContainEqual([100, 7500, 4900, 10000])
    expect(boxes(drawn(doc, 'two'))).toContainEqual([0, -2500, 4800, 0])
  })

  it('keep a line with no view as a line of dashes and dots where it was, with what it had', () => {
    const { doc } = readDocument(before())
    expect(doc.nodes.alone).toEqual({ id: 'alone', type: 'polyline', parent: 'page_1', order: 'aA', layer: 'layer_1', name: 'Reference', visible: false, points: [{ x: -500, y: 2000 }, { x: 5500, y: 2000 }], style: { dash: [14, 4, 2, 4] } })
  })

  it('saved by a development version of 2.2 with their lines apart, open the same, saying so', () => {
    const { doc, repairs } = readDocument({ ...before(), version: 6 })
    expect(doc.nodes.two).toMatchObject({ page: 'page_1', a: { x: 100, y: 1100 } })
    expect(repairs[0]).toMatch(/development version/)
  })

  it('saved by a development version of 1.9 saying obstructions, say walls', () => {
    const json = JSON.parse(JSON.stringify(room()))
    json.version = 3
    json.nodes.old = { id: 'old', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000, obstructions: false }
    const read = parseDocument(json)
    expect(read.nodes.old).toEqual({ id: 'old', type: 'elevation', parent: 'page_1', order: 'a9', layer: 'layer_1', name: 'North', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000, walls: false })
    expect(boxes(drawn(read, 'old'))).toContainEqual([100, 7500, 4900, 10000])
  })

  it('are written as version 6, which 2.1 refuses rather than misread', () => {
    expect(JSON.parse(serializeDocument(add(room(), north))).version).toBe(6)
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
    const view = doc.nodes.vv as NodeOf<'elevation'>
    const kind = kindOf(view)
    // On the face, the middle of its far side.
    expect(kind.handles!(view, registry)[0]).toEqual({ x: 2500, y: 100 })
    expect(kind.moveHandle!(view, 0, { x: 2600, y: 600 }, registry)).toEqual({ depth: 500 })
    expect(kind.moveHandle!(view, 0, { x: 2600, y: 1600 }, registry)).toEqual({ depth: 0 })
    expect(depthThrough({ a: { x: -500, y: 2000 }, b: { x: 5500, y: 2000 } }, { x: 0, y: 500 })).toBe(1500)
  })

  it('is an elevation while its far side is on a face, and a section once it is not', () => {
    const doc = add(room(), north)
    expect(elevationWall(doc, doc.nodes.vv as NodeOf<'elevation'>)?.wall.id).toBe('n')
    const shallower = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { depth: 500 } }])
    expect(elevationWall(shallower, shallower.nodes.vv as NodeOf<'elevation'>)).toBeNull()
    // A section no longer follows the wall.
    const moved = applyEdit(shallower, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }], registry).doc
    expect(moved.nodes.vv).toBe(shallower.nodes.vv)
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

  it('are none in a room of square corners seen from corner to corner, and none over a face seen from on it', () => {
    // The north face from 100 to 4900: the walls at its corners are past the ends of the line, and not drawn.
    expect(grey(drawn(add(room(), north)))).toEqual([])
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
    const view = doc.nodes.vv as NodeOf<'elevation'>
    const kind = kindOf(view)
    expect(kind.handles!(view, registry).slice(1, 3)).toEqual([view.a, view.b])
    // Its start dragged to x = 1100 (wherever across the line): drawn from 1000 further right.
    const start = kind.moveHandle!(view, 1, { x: 1100, y: 1120 }, registry)!
    // Its view drawn 1000 further right, in the same patch.
    expect(start).toEqual({ a: { x: 1100, y: 1100 }, x: 1100 })
    expect(keptViewPatch(view, { a: { x: 1100, y: 1100 } })).toEqual(start)
    const shorter = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: start }])
    // The socket at x = 2000 is drawn where it was: at x = 2000 on the sheet.
    expect(elevationItemAt(shorter.nodes.vv as NodeOf<'elevation'>, shorter, registry, { x: 2000, y: 9700 })).toMatchObject({ node: { id: 's1' } })
    // The face from 1100 only.
    expect(boxes(drawn(shorter))[0]).toEqual([1100, 7500, 4900, 10000])
    expect(kind.moveHandle!(view, 2, { x: 3000, y: 1090 }, registry)).toEqual({ b: { x: 3000, y: 1100 } })
  })

  it('cannot have its ends cross: it stays 100 long', () => {
    const view = add(room(), north).nodes.vv as NodeOf<'elevation'>
    expect(kindOf(view).moveHandle!(view, 1, { x: 6000, y: 1100 }, registry)).toEqual({ a: { x: 4800, y: 1100 }, x: 4800 })
    expect(kindOf(view).moveHandle!(view, 2, { x: -500, y: 1100 }, registry)).toEqual({ b: { x: 200, y: 1100 } })
  })

  it('keeps its ends where they are along the wall when the wall is moved', () => {
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'vv', patch: { a: { x: 1100, y: 1100 }, b: { x: 3000, y: 1100 } } }])
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }], registry).doc
    expect(moved.nodes.vv).toMatchObject({ a: { x: 1100, y: 1150 }, b: { x: 3000, y: 1150 } })
  })

  it('turns into a section when an end is dragged well off its line, which then follows no wall', () => {
    const view = add(room(), north).nodes.vv as NodeOf<'elevation'>
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

describe('a wall cabinet up to the ceiling, or a tall unit with a filler', () => {
  // Against the north wall, 2500 high as the page's walls are unless it says otherwise.
  const cabinet = { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: { ceiling: true }, x: 1700, y: 100 }
  const tall = { type: 'parametric', id: 't', kind: 'arch.tallunit', props: { sections: [{ type: 'Door', height: 750 }, { type: 'Filler' }] }, x: 3000, y: 100 }

  it('goes from its underside up to the top of the wall behind it, and follows that wall', () => {
    const doc = add(room(), cabinet, tall, north)
    // From 1450 to 2500, the tall unit from the floor, its filler over its door.
    expect(boxes(drawn(doc))).toContainEqual([1700, 7500, 2300, 8550])
    expect(boxes(drawn(doc))).toContainEqual([3000, 7500, 3600, 10000])
    // The wall made 2700 high, they go up with it, and so does the cabinet hung lower.
    const higher = applyOps(doc, [
      { op: 'update_node', id: 'n', patch: { height: 2700 } },
      { op: 'update_node', id: 'c', patch: { z: 1350 } },
    ])
    expect(boxes(drawn(higher))).toContainEqual([1700, 7300, 2300, 8650])
    expect(boxes(drawn(higher))).toContainEqual([3000, 7300, 3600, 10000])
  })

  it('keeps its own height when it is not set so; a tall unit with no filler is as high as its sections', () => {
    const doc = add(room(), { ...cabinet, props: { ceiling: false } }, { ...tall, props: { sections: [{ type: 'Door', height: 750 }, { type: 'Oven', height: 600 }] } }, north)
    expect(boxes(drawn(doc))).toContainEqual([1700, 7850, 2300, 8550])
    expect(boxes(drawn(doc))).toContainEqual([3000, 8550, 3600, 10000])
  })

  it('made taller or shorter in an elevation, is that high and no longer up to the ceiling; a tall unit of sections is not', () => {
    const doc = add(room(), cabinet, tall, north)
    expect(elevationHeightOps(doc, registry, doc.nodes.c as NodeOf<'parametric'>, -100)).toEqual([{ op: 'update_node', id: 'c', patch: { props: { ceiling: false, height: 950 } } }])
    expect(elevationHeightOps(doc, registry, doc.nodes.t as NodeOf<'parametric'>, -100)).toBeNull()
  })
})

describe('the lines between the sections of a tall unit, in an elevation', () => {
  const sections = [
    { type: 'Drawer', height: 720 },
    { type: 'Oven', height: 600 },
    { type: 'Open', height: 380 },
    { type: 'Filler' },
  ]

  it('are where the view draws them, and dragged, move only the sections either side', () => {
    const doc = add(room(), { type: 'parametric', id: 't', kind: 'arch.tallunit', props: { sections }, x: 3000, y: 100 }, north)
    const [{ view, item }] = elevationItemsOf(doc, registry, 't')
    // The floor of the view at y = 10000: lines at 820, 1420 and 1800 above it.
    expect(elevationSplits(view, doc, registry, item)).toEqual([9180, 8580, 8200])
    // The line over the drawers taken to 900: they are 800, the oven 520; its filler up to the ceiling still.
    const ops = elevationSplitOps(view, doc, registry, item, 0, 9100)!
    const after = applyOps(doc, ops).nodes.t as NodeOf<'parametric'>
    expect(after.props).toMatchObject({ sections: [{ height: 800 }, { height: 520 }, { height: 380 }, { type: 'Filler' }] })
    expect(after.props.height).toBeUndefined()
  })

  it('are none for what has no sections to move', () => {
    const doc = add(room(), { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: {}, x: 1700, y: 100 }, north)
    const [{ view, item }] = elevationItemsOf(doc, registry, 'c')
    expect(elevationSplits(view, doc, registry, item)).toEqual([])
    expect(elevationSplitOps(view, doc, registry, item, 0, 9000)).toBeNull()
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
    const shallow = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { depth: 500 } }])
    expect(boxes(drawn(shallow))).not.toContainEqual([1700, 7850, 2300, 8550])
  })
})

describe('what a view sees, resized by its corners', () => {
  // The north elevation: its line at y = 1100 from x = 100 to 4900, its far side on the face at y = 100.
  const view = () => add(room(), north).nodes.vv as NodeOf<'elevation'>

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
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'vv', patch }])
    expect(elevationWall(doc, doc.nodes.vv as NodeOf<'elevation'>)?.wall.id).toBe('n')
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
    const turned = applyOps(add(room(), north), [{ op: 'update_node', id: 'vv', patch }])
    const area = seenArea(turned.nodes.vv as NodeOf<'elevation'>)
    // That corner where the pointer is, the area a rectangle 1000 deep, and no longer an elevation of the face.
    expect(area[2].x).toBeCloseTo(4900, 6)
    expect(area[2].y).toBeCloseTo(-1900, 6)
    expect(Math.hypot(area[3].x - area[0].x, area[3].y - area[0].y)).toBeCloseTo(1000, 6)
    expect((area[1].x - area[0].x) * (area[3].x - area[0].x) + (area[1].y - area[0].y) * (area[3].y - area[0].y)).toBeCloseTo(0, 3)
    expect(elevationWall(turned, turned.nodes.vv as NodeOf<'elevation'>)).toBeNull()
  })

  it('by an edge, taken anywhere along it, moves that edge across only, as a wall’s face is', () => {
    // The line brought 400 nearer the face, wherever along it: the far side stays on the face.
    const nearer = moveViewEdge(view(), 'line', { x: 3700, y: 700 })
    expect(nearer).toEqual({ a: { x: 100, y: 700 }, b: { x: 4900, y: 700 }, depth: 600 })
    const doc = applyOps(add(room(), north), [{ op: 'update_node', id: 'vv', patch: nearer }])
    expect(elevationWall(doc, doc.nodes.vv as NodeOf<'elevation'>)?.wall.id).toBe('n')
    // Never past its far side.
    expect(moveViewEdge(view(), 'line', { x: 2000, y: -300 })).toMatchObject({ depth: 0 })
    // Its far side, its sides at the start and the end.
    expect(moveViewEdge(view(), 'far', { x: 4000, y: 500 })).toEqual({ depth: 600 })
    expect(moveViewEdge(view(), 'start', { x: 900, y: 300 })).toEqual({ a: { x: 900, y: 1100 } })
    expect(moveViewEdge(view(), 'end', { x: 4000, y: 600 })).toEqual({ b: { x: 4000, y: 1100 } })
    expect(moveViewEdge(view(), 'end', { x: -3000, y: 600 })).toEqual({ b: { x: 200, y: 1100 } })
    // As handles: the middles of the line and of the sides at its ends, after the corners.
    expect(kindOf(view()).handles!(view(), registry).slice(7)).toEqual([{ x: 2500, y: 1100 }, { x: 100, y: 600 }, { x: 4900, y: 600 }])
    expect(kindOf(view()).moveHandle!(view(), 8, { x: 900, y: 300 }, registry)).toEqual({ a: { x: 900, y: 1100 }, x: 900 })
  })

  it('by a corner dragged nearly its way, only gets longer or shorter, still an elevation of its face', () => {
    // The far corner at the end brought back along the face to x = 3000: no turn at all.
    expect(kindOf(view()).moveHandle!(view(), 5, { x: 3000, y: 100 }, registry)).toEqual({ a: { x: 100, y: 1100 }, b: { x: 3000, y: 1100 }, depth: 1000 })
    // A little off the face, within a few degrees: the same.
    expect(kindOf(view()).moveHandle!(view(), 5, { x: 3000, y: 150 }, registry)).toMatchObject({ b: { x: 3000, y: 1100 }, depth: 1000 })
  })
})
