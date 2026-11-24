import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import furniture from '../../warehouse/extensions/furniture.json'
import { applyOps, buildScene, cameraPrompt, copyNodes, createComponent, hitTest, itemsInside, lookedAt, pasteNodes, viewsLookingAt, createDocument, frameHeight, MARK_LENGTH, declarativeExtension, kindOf, massing, nodePrimitives, parseDocument, printedScene, readDocument, Registry, serializeDocument, solidAt, toDXF, toPDF, toSVG, transformOps, type Document, type Op } from '../src'

/*
 * Viewpoints: the plan raised to its heights (`massing`), how a viewpoint is drawn and moved, and
 * what it says to an image model (`cameraPrompt`).
 */
const registry = new Registry().use(architecture).use(declarativeExtension(furniture))

const add = (doc: Document, ...nodes: Record<string, unknown>[]): Document => applyOps(doc, nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
const wall = (id: string, a: [number, number], b: [number, number], extra: Record<string, unknown> = {}) => ({ type: 'wall', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, ...extra })
/** A room 5 m by 4 m inside walls 200 thick, 2600 high, a window in the north wall and a door in the east one. */
const room = (): Document =>
  add(
    createDocument('Room'),
    wall('n', [0, 0], [5000, 0], { height: 2600 }),
    wall('e', [5000, 0], [5000, 4000], { height: 2600 }),
    wall('s', [5000, 4000], [0, 4000], { height: 2600 }),
    wall('w', [0, 4000], [0, 0], { height: 2600 }),
    { type: 'parametric', id: 'win', kind: 'arch.window', props: { width: 1200 }, x: 2500, y: 0 },
    { type: 'parametric', id: 'door', kind: 'arch.door', props: {}, x: 5000, y: 3000, rotation: 90 },
    { type: 'room', id: 'r', name: 'Kitchen', x: 2500, y: 2000 },
  )
/** Standing near the south wall, looking north at the window. */
const camera = { type: 'camera', id: 'c', a: { x: 2500, y: 3500 }, b: { x: 2500, y: 2500 } }

describe('the plan raised to its heights', () => {
  it('stands each wall as high as it is, with the wall above and below a window, and its glass', () => {
    const solids = massing(room(), 'page_1', registry)
    const north = solids.filter((s) => s.node === 'n')
    // Two stretches either side of the window, full height; over it and under its sill.
    expect(north.filter((s) => s.bottom === 0 && s.top === 2600)).toHaveLength(2)
    const sill = north.find((s) => s.bottom === 0 && s.top < 2600)!
    const over = north.find((s) => s.bottom > 0)!
    expect(sill.top).toBeGreaterThan(0)
    expect(over.top).toBe(2600)
    // Its two sashes, each with the two sheets of double glazing, within the opening.
    const glass = solids.filter((s) => s.role === 'glass')
    expect(glass).toHaveLength(4)
    expect(glass.every((g) => g.node === 'win' && g.bottom > sill.top && g.top < over.bottom)).toBe(true)
    // A door goes down to the floor: the wall over it, nothing under it, no glass.
    const east = solids.filter((s) => s.node === 'e')
    expect(east.filter((s) => s.bottom > 0)).toHaveLength(1)
    expect(solids.filter((s) => s.node === 'door' && s.role === 'glass')).toHaveLength(0)
  })

  it('makes a window of its frame, a sash for each pane with its glazing and handle, and its sill outside', () => {
    const win = (props: Record<string, unknown>) => massing(applyOps(room(), [{ op: 'update_node', id: 'win', patch: { props: { width: 1200, ...props } } }]), 'page_1', registry).filter((s) => s.node === 'win')
    const glass = (props: Record<string, unknown>) => win(props).filter((s) => s.role === 'glass').length
    expect([glass({ panes: 1, glazing: 'Single' }), glass({ panes: 3 }), glass({ panes: 2, glazing: 'Triple' })]).toEqual([1, 6, 6])
    expect(win({ panes: 3 }).filter((s) => s.finish === 'metal')).toHaveLength(3)
    // The sill reaches out of the north wall's outer face (Y = -100), 50 deep, under the window.
    const sill = win({}).find((s) => Math.min(...s.outline.map((p) => p.y)) < -100)!
    expect(Math.min(...sill.outline.map((p) => p.y))).toBeCloseTo(-150)
    expect(sill.top).toBe(900)
    expect(win({ sill: 0 }).some((s) => Math.min(...s.outline.map((p) => p.y)) < -100)).toBe(false)
    // Turned the other way, its sill is inside.
    expect(Math.max(...win({ flip: true }).flatMap((s) => s.outline.map((p) => p.y)))).toBeCloseTo(150)
  })

  it('makes a door of its lining and architraves and its leaves, as its type says', () => {
    const door = (props: Record<string, unknown>) => massing(applyOps(room(), [{ op: 'update_node', id: 'door', patch: { props } }]), 'page_1', registry).filter((s) => s.node === 'door')
    // Its leaf: up to under its lining's head.
    const tallest = (solids: ReturnType<typeof door>) => solids.filter((s) => s.bottom === 0 && s.top === 2010 && !s.finish)
    // The door in the east wall (X = 5000) turned 90°: its +Y is towards -X, into the room.
    const single = door({})
    expect(single.filter((s) => s.finish === 'metal')).toHaveLength(3)
    // Opened at 90°, its leaf stands out of the wall into the room, 0.9 m less its lining.
    const reach = (solids: ReturnType<typeof door>) => Math.min(...solids.flatMap((s) => s.outline.map((p) => p.x)))
    expect(reach(single)).toBeLessThan(5100 - 800)
    expect(reach(door({ angle: 30 }))).toBeGreaterThan(reach(single))
    expect(door({ type: 'Double' }).filter((s) => s.finish === 'metal')).toHaveLength(6)
    // Hinged on the right, its leaf is at the other end of the opening.
    const ys = (solids: ReturnType<typeof door>) => tallest(solids).flatMap((s) => s.outline.map((p) => p.y))
    expect(Math.min(...ys(door({ hinge: 'Right' })))).not.toBeCloseTo(Math.min(...ys(single)))
    // Sliding on the wall: a leaf in front of its face and its rail; a pocket door in the wall; a glazed sliding door, glass.
    expect(door({ type: 'Sliding on wall' }).some((s) => s.finish === 'metal' && s.bottom > 2040)).toBe(true)
    expect(door({ type: 'Sliding', leaves: 3 }).filter((s) => s.role === 'glass')).toHaveLength(6)
    expect(door({ type: 'Opening only' })).toEqual([])
    // Its leaf is seen from the side it opens to, not from the other, where it would seem to close the doorway.
    const from = (p: { x: number; y: number }) => massing(room(), 'page_1', registry, [], p).filter((s) => s.node === 'door')
    const leaves = (solids: ReturnType<typeof door>) => solids.filter((s) => s.bottom === 0 && s.top === 2010 && !s.finish).length
    expect(leaves(from({ x: 2500, y: 2000 }))).toBe(1)
    expect(leaves(from({ x: 6000, y: 3000 }))).toBe(0)
    expect(from({ x: 6000, y: 3000 }).filter((s) => s.finish === 'metal')).toHaveLength(0)
    // Raised on a threshold, it starts above the floor, and no glass is put across it.
    expect(Math.min(...door({ sillHeight: 20 }).map((s) => s.bottom))).toBe(20)
    expect(door({ sillHeight: 20 }).some((s) => s.role === 'glass')).toBe(false)
  })

  it('raises what has a height from its outline, and puts a ceiling over the room', () => {
    const doc = add(room(), { type: 'parametric', id: 'bed', kind: 'furn.bed', props: {}, x: 1000, y: 1000 })
    const solids = massing(doc, 'page_1', registry)
    const bed = solids.find((s) => s.node === 'bed')!
    expect(bed.role).toBe('object')
    expect(bed.bottom).toBe(0)
    expect(bed.top).toBeGreaterThan(0)
    const ceiling = solids.find((s) => s.role === 'ceiling')!
    expect(ceiling.bottom).toBe(2600)
    expect(ceiling.node).toBe('r')
    // Into the walls around it, 40 past their faces (at 100 and 4900, 100 and 3900).
    const xs = ceiling.outline.map((p) => p.x)
    const ys = ceiling.outline.map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(Math.round)).toEqual([60, 4940, 60, 3940])
  })

  it('raises a straight stair step by step to the floor above, through an opening in the ceiling', () => {
    // 12 steps of 270 from y = 3800 up the sheet, 900 wide, climbing 2600: 13 rises of 200.
    const doc = add(room(), { type: 'parametric', id: 'st', kind: 'arch.stair', props: { height: 2600 }, x: 3000, y: 3800 })
    const solids = massing(doc, 'page_1', registry)
    // In layers a rise thick, each from its step to the top of the flight, reaching 10 into the one under it.
    const layers = solids.filter((s) => s.node === 'st')
    expect(layers).toHaveLength(12)
    expect(layers.map((s) => [Math.round(s.bottom), Math.round(s.top)])).toEqual(Array.from({ length: 12 }, (_, k) => [Math.max(0, k * 200 - 10), (k + 1) * 200]))
    const ys = (s: (typeof layers)[number]) => s.outline.map((p) => Math.round(p.y))
    expect([Math.min(...ys(layers[0])), Math.max(...ys(layers[0]))]).toEqual([3800 - 12 * 270, 3800])
    expect([Math.min(...ys(layers[11])), Math.max(...ys(layers[11]))]).toEqual([3800 - 12 * 270, 3800 - 11 * 270])
    // The ceiling is open over the flight, and nowhere else.
    const ceiling = solids.find((s) => s.role === 'ceiling')!
    expect(ceiling.holes).toHaveLength(1)
    const hole = ceiling.holes![0]
    expect([Math.min(...hole.map((p) => p.x)), Math.max(...hole.map((p) => p.x)), Math.min(...hole.map((p) => p.y)), Math.max(...hole.map((p) => p.y))].map(Math.round)).toEqual([3000, 3900, 3800 - 12 * 270, 3800])
    expect(massing(room(), 'page_1', registry).find((s) => s.role === 'ceiling')!.holes).toBeUndefined()
  })

  it('lowers a stair that goes down from here, its top arriving at the floor, in a stairwell down to the floor below', () => {
    const doc = add(room(), { type: 'parametric', id: 'st', kind: 'arch.stair', props: { height: 2600, goes: 'Down' }, x: 3000, y: 3800 })
    const solids = massing(doc, 'page_1', registry)
    const layers = solids.filter((s) => s.node === 'st' && s.role === 'object')
    // The same flight 2600 lower: from the floor below, its top step a rise under this floor.
    expect(layers.map((s) => [Math.round(s.bottom), Math.round(s.top)])).toEqual(Array.from({ length: 12 }, (_, k) => [-2600 + Math.max(0, k * 200 - 10), -2600 + (k + 1) * 200]))
    // Walls round the flight down to the floor below, open over it, which the ground is cut by; and that floor at their foot.
    const shaft = solids.find((s) => s.node === 'st' && s.role === 'shaft')!
    expect(shaft.holes).toHaveLength(1)
    const hole = shaft.holes![0]
    expect([Math.min(...hole.map((p) => p.x)), Math.max(...hole.map((p) => p.x)), Math.min(...hole.map((p) => p.y)), Math.max(...hole.map((p) => p.y))].map(Math.round)).toEqual([3000, 3900, 3800 - 12 * 270, 3800])
    expect(shaft.bottom).toBeLessThan(-2600)
    expect(shaft.top).toBeLessThanOrEqual(0)
    const below = solids.find((s) => s.node === 'st' && s.role === 'wall')!
    expect(below.top).toBe(-2600)
    // It does not go up: the ceiling is whole.
    expect(solids.find((s) => s.role === 'ceiling')!.holes).toBeUndefined()
  })

  it('raises again only the objects an edit changed: the others keep the solids they had', () => {
    const doc = add(room(), { type: 'parametric', id: 'bed', kind: 'furn.bed', props: {}, x: 1000, y: 1000 }, { type: 'parametric', id: 'sink', kind: 'arch.sink', props: {}, x: 1000, y: 100 })
    const before = massing(doc, 'page_1', registry)
    const moved = applyOps(doc, [{ op: 'update_node', id: 'bed', patch: { x: 1500 } }])
    const after = massing(moved, 'page_1', registry)
    const of = (solids: typeof before, id: string) => solids.filter((s) => s.node === id)
    expect(of(after, 'sink')).toEqual(of(before, 'sink'))
    expect(of(after, 'sink').every((s, i) => s === of(before, 'sink')[i])).toBe(true)
    expect(of(after, 'bed')[0]).not.toBe(of(before, 'bed')[0])
    expect(of(after, 'bed')[0].outline[0].x - of(before, 'bed')[0].outline[0].x).toBeCloseTo(500)
    // With another set of extensions, nothing is taken from before.
    const other = new Registry().use(architecture).use(declarativeExtension(furniture))
    expect(of(massing(moved, 'page_1', other), 'sink')[0]).not.toBe(of(after, 'sink')[0])
  })

  it('raises, looked at from a point, only the building there: not another plan drawn beside it on the page', () => {
    // Another plan 3 m to the east of the room, a wall and a bed in it; a wall joined to the room by a gap of 100 mm.
    const doc = add(
      room(),
      wall('other', [8000, 0], [8000, 4000]),
      { type: 'parametric', id: 'far', kind: 'furn.bed', props: {}, x: 9000, y: 1000 },
      wall('near', [-100, 4100], [-100, 6000]),
      { type: 'parametric', id: 'bed', kind: 'furn.bed', props: {}, x: 1000, y: 1000 },
    )
    const nodes = (solids: ReturnType<typeof massing>) => new Set(solids.map((s) => s.node))
    const all = nodes(massing(doc, 'page_1', registry))
    expect(['other', 'far', 'near', 'bed'].every((id) => all.has(id))).toBe(true)
    const seen = nodes(massing(doc, 'page_1', registry, [], { x: 2500, y: 2000 }))
    expect(['n', 'e', 's', 'w', 'near', 'bed', 'r'].every((id) => seen.has(id))).toBe(true)
    expect(seen.has('other') || seen.has('far')).toBe(false)
    // Standing in the other plan, it is the room that is left out.
    expect(nodes(massing(doc, 'page_1', registry, [], { x: 8500, y: 2000 })).has('n')).toBe(false)
  })

  it('leaves out what the plan hides', () => {
    const doc = applyOps(room(), [{ op: 'update_node', id: 'n', patch: { visible: false } }])
    expect(massing(doc, 'page_1', registry).some((s) => s.node === 'n')).toBe(false)
  })
})

describe('a wall cabinet in 3D', () => {
  const cabinet = (props: Record<string, unknown>) => ({ type: 'parametric', id: 'k', kind: 'arch.wallcabinet', props, x: 1700, y: 100 })
  const heights = (doc: Document) => massing(doc, 'page_1', registry).filter((s) => s.node === 'k').map((s) => [s.bottom, s.top])

  it('stands from its underside as high as it is', () => {
    expect(heights(add(room(), cabinet({})))).toEqual([[1450, 2150]])
  })

  it('up to the ceiling, goes to the top of the wall behind it, and follows it when that wall is made higher', () => {
    const doc = add(room(), cabinet({ ceiling: true }))
    expect(heights(doc)).toEqual([[1450, 2600]])
    expect(heights(applyOps(doc, [{ op: 'update_node', id: 'n', patch: { height: 2800 } }]))).toEqual([[1450, 2800]])
  })
})

describe('a viewpoint', () => {
  it('is drawn on the plan as a dot and the lines of what it sees, and moves and turns with the plan', () => {
    const doc = add(room(), camera)
    const prims = nodePrimitives(doc.nodes.c, { doc, registry, depth: 0 })
    expect(prims.some((p) => p.kind === 'ellipse')).toBe(true)
    const turned = applyOps(doc, transformOps(doc, [doc.nodes.c], { pivot: { x: 2500, y: 3500 }, rotation: 90 }, registry))
    const node = turned.nodes.c
    // Turned a quarter clockwise about where it stands, it looks east.
    expect(node.type === 'camera' && node.b).toEqual({ x: 3500, y: 3500 })
  })

  it('is drawn to work with only: the exports leave out its eye, and the line of an elevation, but not the elevation', () => {
    const plain = room()
    const doc = add(
      plain,
      camera,
      { type: 'elevation', id: 'view', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 0, y: 8000 },
    )
    expect(nodePrimitives(doc.nodes.c, { doc, registry, depth: 0 }).every((p) => p.screen)).toBe(true)
    // Its line, on the plan, is drawn to work with; the view is printed.
    const view = nodePrimitives(doc.nodes.view, { doc, registry, depth: 0 })
    expect(view.some((p) => p.screen) && view.some((p) => !p.screen)).toBe(true)
    // The same drawing without the viewpoint: what is printed is the same.
    const printed = add(plain, { type: 'elevation', id: 'view', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 0, y: 8000 })
    expect(toSVG(doc, 'page_1', registry)).toBe(toSVG(printed, 'page_1', registry))
    // The elevation is printed, its face and window with it (a view of nothing draws only its floor); the eye and the line are not.
    const scene = printedScene(buildScene(doc, 'page_1', registry))
    expect(scene.find((item) => item.id === 'view')?.prims.length).toBeGreaterThan(2)
    expect(scene.some((item) => item.id === 'c')).toBe(false)
    expect(scene.find((item) => item.id === 'view')!.prims.some((p) => p.screen)).toBe(false)
    expect(toDXF(doc, 'page_1', registry)).toBe(toDXF(printed, 'page_1', registry))
    const paper = { type: 'paper', id: 'sheet', x: -1000, y: -1000, width: 42000, height: 29700, scale: 100 }
    expect(toPDF(add(doc, paper), registry).length).toBe(toPDF(add(printed, paper), registry).length)
    // Asked for (Viewpoints and view lines, in the export window), they are exported as drawn on screen.
    const marked = printedScene(buildScene(doc, 'page_1', registry), true)
    expect(marked.some((item) => item.id === 'c')).toBe(true)
    expect(marked.find((item) => item.id === 'view')!.prims.some((p) => p.screen)).toBe(true)
    expect(toSVG(doc, 'page_1', registry, { marks: true }).length).toBeGreaterThan(toSVG(doc, 'page_1', registry).length)
    expect(toDXF(doc, 'page_1', registry, { marks: true }).length).toBeGreaterThan(toDXF(doc, 'page_1', registry).length)
    expect(toPDF(add(doc, paper), registry, undefined, { marks: true }).length).toBeGreaterThan(toPDF(add(doc, paper), registry).length)
  })

  it('prints the picture it keeps of its view in its frame, on a white sheet, and never its eye', () => {
    // A picture of one pixel, as the editor keeps a larger one (`keepViewPictures`).
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
    const withAsset = applyOps(room(), [{ op: 'add_asset', asset: { id: 'shot', mime: 'image/png', data: png, width: 1, height: 1 } }])
    const framed = { ...camera, frame: { x: 6000, y: 0, width: 4000, height: 2500 } }
    const doc = add(withAsset, { ...framed, picture: 'shot' })
    const scene = printedScene(buildScene(doc, 'page_1', registry))
    const kept = scene.find((item) => item.id === 'c')!
    expect(kept.prims.map((p) => p.kind)).toEqual(['path', 'image'])
    expect(kept.prims[1]).toMatchObject({ kind: 'image', x: 6000, y: 0, width: 4000, height: 2500 })
    expect(kept.bounds).toEqual({ minX: 6000, minY: 0, maxX: 10000, maxY: 2500 })
    const svg = toSVG(doc, 'page_1', registry)
    expect(svg).toContain('<image')
    expect(svg).toContain(png)
    const paper = { type: 'paper', id: 'sheet', x: -1000, y: -1000, width: 42000, height: 29700, scale: 100 }
    expect(toPDF(add(doc, paper), registry).length).toBeGreaterThan(toPDF(add(add(withAsset, framed), paper), registry).length)
    // Without a frame of its own, or without a picture, nothing is printed of it.
    expect(toSVG(add(withAsset, { ...camera, picture: 'shot' }), 'page_1', registry)).not.toContain('<image')
    expect(toSVG(add(withAsset, framed), 'page_1', registry)).not.toContain('<image')
    // Its file keeps the picture; a picture no viewpoint keeps any more is left out.
    expect(parseDocument(JSON.parse(serializeDocument(doc))).assets?.shot?.data).toBe(png)
    expect(JSON.parse(serializeDocument(add(withAsset, framed))).assets).toBeUndefined()
    // A picture that is not in the drawing is refused.
    expect(() => add(room(), { ...framed, picture: 'nothing' })).toThrow(/Unknown asset/)
    // Copied into another drawing, it takes its picture along.
    const into = pasteNodes(room(), copyNodes(doc, ['c']), 'page_1', { x: 0, y: 0 }).doc
    const pasted = Object.values(into.nodes).find((n) => n.type === 'camera')!
    expect(pasted.type === 'camera' && pasted.picture && into.assets?.[pasted.picture]?.data).toBe(png)
    // Read from a file that lost it, the viewpoint is kept, without it, and says so.
    const lost = JSON.parse(serializeDocument(doc))
    delete lost.assets
    const { doc: read, repairs } = readDocument(lost)
    expect(read.nodes.c).toMatchObject({ type: 'camera' })
    expect(read.nodes.c).not.toHaveProperty('picture')
    expect(repairs.join(' ')).toMatch(/kept a picture/)
  })

  it('stays on the page when what is around it is made into a component, and goes in none', () => {
    const doc = add(room(), camera)
    // The room and its viewpoint selected: the walls go in the component, the viewpoint stays, with its view.
    const made = createComponent(doc, registry, ['n', 'e', 's', 'w', 'c'], 'Room')
    expect(made.doc.nodes.c).toMatchObject({ parent: 'page_1', a: camera.a, b: camera.b })
    expect(made.doc.nodes.n.parent).toBe(made.componentId)
    // Alone, it is not made into one: it would see nothing there and show nowhere.
    expect(() => createComponent(doc, registry, ['c'], 'Eye')).toThrow(/viewpoint stays on the page/)
    expect(() => applyOps(made.doc, [{ op: 'update_node', id: 'c', patch: { parent: made.componentId, layer: null } }])).toThrow(/viewpoint goes on a page/)
  })

  it('has a frame of the shape its width and height give, 16:9 when it gives no height', () => {
    expect(frameHeight({ width: 1600, height: 1200 })).toBe(1200)
    expect(frameHeight({ width: 1600 })).toBe(900)
  })

  it('makes a drawing of version 6, which reads back', () => {
    const doc = add(room(), { ...camera, fov: 80, eyeHeight: 1600 })
    const text = serializeDocument(doc)
    expect(JSON.parse(text).version).toBe(6)
    expect(parseDocument(JSON.parse(text)).nodes.c).toMatchObject({ type: 'camera', fov: 80, eyeHeight: 1600 })
    // Without one, older versions still open it.
    expect(JSON.parse(serializeDocument(room())).version).toBeLessThan(6)
  })

  it('says for an image model what to make and keep, the scene, its style and light, and the photograph; not what is in view, which the picture shows', () => {
    const doc = add(room(), camera, { type: 'parametric', id: 'bed', kind: 'furn.bed', props: {}, x: 1000, y: 1000 })
    const prompt = cameraPrompt(doc, doc.nodes.c as never, { style: 'Scandinavian', details: 'a bowl of fruit on the table', light: 'soft morning sun' })
    expect(prompt.split('\n')[0]).toBe('Photorealistic architectural interior render, based on the attached view of a 3D model.')
    expect(prompt).toContain('Preserve the exact layout, camera angle, proportions and placement')
    // The scene in the person's words, made a sentence, then the style and the light.
    expect(prompt).toContain('\na bowl of fruit on the table.\nInterior style: Scandinavian.\nLighting: soft morning sun, realistic global illumination')
    // The photograph as the viewpoint takes it: from its eye, through its lens (70° is a 26 mm lens), level.
    expect(prompt).toContain('shot from eye level 1.50 m above the floor with a 26 mm lens (70° horizontal field of view), f/5.6, the camera level so that vertical lines stay vertical')
    expect(prompt).not.toMatch(/Kitchen|Window|Double bed|In view/)
    // Tilted down, it says so; with no wishes, daylight and no style.
    const down = applyOps(doc, [{ op: 'update_node', id: 'c', patch: { pitch: -12 } }])
    const tilted = cameraPrompt(down, down.nodes.c as never)
    expect(tilted).toContain('f/5.6, the camera tilted 12° down,')
    expect(tilted).toContain('Lighting: natural daylight through the windows')
    expect(tilted).not.toContain('Interior style:')
  })
})

describe('a viewpoint moved, as dragging its view does at every step', () => {
  it('leaves the layers, the materials and the colours the same objects, as any edit that does not change them', () => {
    const doc = add(room(), camera)
    const moved = applyOps(doc, [{ op: 'update_node', id: 'c', patch: { b: { x: 2600, y: 2500 } } }])
    expect(moved.layers).toBe(doc.layers)
    expect(moved.materials).toBe(doc.materials)
    const renamed = applyOps(doc, [{ op: 'update_layer', id: Object.keys(doc.layers)[0], patch: { name: 'Plan' } }])
    expect(renamed.layers).not.toBe(doc.layers)
  })

  it('draws again only its mark, keeping the rest of the scene as it was', async () => {
    const { buildScene, sceneAfterViewpoints } = await import('../src')
    const doc = add(room(), camera)
    const scene = buildScene(doc, 'page_1', registry)
    const moved = applyOps(doc, [{ op: 'update_node', id: 'c', patch: { b: { x: 2600, y: 2500 } } }])
    const after = sceneAfterViewpoints(doc, scene, moved, 'page_1', registry)!
    expect(after).toEqual(buildScene(moved, 'page_1', registry))
    expect(after.filter((item, i) => item === scene[i]).length).toBe(scene.length - 1)
    // Anything else changed, the scene is built anew.
    const wall = applyOps(moved, [{ op: 'update_node', id: 'n', patch: { thickness: 300 } }])
    expect(sceneAfterViewpoints(moved, after, wall, 'page_1', registry)).toBeNull()
  })
})

describe('the lens of a viewpoint', () => {
  it('is named by its focal length on a full-frame camera', async () => {
    const { focalOf, fovOfFocal } = await import('../src')
    expect(focalOf(70)).toBeCloseTo(25.7, 1)
    expect(fovOfFocal(24)).toBeCloseTo(73.7, 1)
    expect(fovOfFocal(focalOf(55))).toBeCloseTo(55)
    // Kept within what a viewpoint allows.
    expect(fovOfFocal(1)).toBe(150)
    expect(fovOfFocal(1000)).toBe(10)
  })

  it('is made wider or narrower by dragging an end of the arc of what it sees, keeping the way it looks', () => {
    const doc = add(room(), camera)
    const kind = kindOf(doc.nodes.c)
    const handles = kind.handles!(doc.nodes.c as never)
    expect(handles).toHaveLength(4)
    // The right end of the arc, 1 m ahead, dragged 1 m to the right: 45° each side.
    expect(kind.moveHandle!(doc.nodes.c as never, 3, { x: 3500, y: 2500 })).toEqual({ fov: 90 })
    expect(kind.moveHandle!(doc.nodes.c as never, 2, { x: 1500, y: 2500 })).toEqual({ fov: 90 })
  })

  it('is marked on the plan as long whatever point it looks towards: its tip turns it, its eye moves it looking the same way', () => {
    // Looking north, towards a point 1 m ahead, or 5 m: the same mark, its tip 1.5 m ahead.
    const near = add(room(), camera).nodes.c
    const far = add(room(), { ...camera, b: { x: 2500, y: -1500 } }).nodes.c
    const marks = (node: typeof near) => nodePrimitives(node, { doc: add(room(), camera), registry, depth: 0 })
    expect(marks(far)).toEqual(marks(near))
    const kind = kindOf(near)
    expect(kind.handles!(near as never)[1]).toEqual({ x: 2500, y: 3500 - MARK_LENGTH })
    // Its tip dragged to the east: it looks east, nothing else changing.
    expect(kind.moveHandle!(near as never, 1, { x: 3000, y: 3500 })).toEqual({ b: { x: 3000, y: 3500 } })
    // Its eye dragged 1 m west: it stands there, looking north still.
    expect(kind.moveHandle!(near as never, 0, { x: 1500, y: 3500 })).toEqual({ a: { x: 1500, y: 3500 }, b: { x: 1500, y: 2500 } })
    // Its camera fixed, it has none to drag: where it stands and the way it looks are kept.
    expect(kind.handles!({ ...near, fixed: true } as never)).toEqual([])
  })
})

describe('a view on another page than its plan', () => {
  it('cut and pasted on a sheet, keeps looking at the plan: its eye stays there, drawn by the plan, its frame where the paste lands', () => {
    const doc = add(room(), { ...camera, frame: { x: 6000, y: 0, width: 4000, height: 2500 } })
    const clip = copyNodes(doc, ['c'])
    const cut = applyOps(doc, [{ op: 'remove_node', id: 'c' }, { op: 'add_node', node: { type: 'page', id: 'sheet', parent: null } }])
    const offset = { x: -6000, y: 1000 }
    const { doc: out, ids } = pasteNodes(cut, clip, 'sheet', offset)
    const view = out.nodes[ids[0]]
    expect(view).toMatchObject({ type: 'camera', parent: 'sheet', page: 'page_1', a: camera.a, b: camera.b, frame: { x: 0, y: 1000, width: 4000, height: 2500 } })
    // The sheet draws no eye; the plan draws it, as a view of another page, picked by a click, not by a box.
    expect(buildScene(out, 'sheet', registry).some((item) => item.id === view.id && item.prims.length > 0)).toBe(false)
    const mark = buildScene(out, 'page_1', registry).find((item) => item.id === view.id)!
    expect(mark.foreign).toBe(true)
    expect(mark.prims.some((p) => p.kind === 'ellipse')).toBe(true)
    expect(hitTest(buildScene(out, 'page_1', registry), camera.a, 10)?.id).toBe(view.id)
    expect(itemsInside(buildScene(out, 'page_1', registry), { minX: -1000, minY: -1000, maxX: 10000, maxY: 10000 }).some((item) => item.id === view.id)).toBe(false)
    expect(viewsLookingAt(out, 'page_1').map((n) => n.id)).toEqual([view.id])
    // What it sees is the plan's: the same solids as from the plan's own page.
    expect(massing(out, lookedAt(out, view as never)!, registry, [camera.a], camera.a).length).toBe(massing(doc, 'page_1', registry, [camera.a], camera.a).length)
  })

  it('pasted with the walls it looks at, looks at the walls pasted, its eye moved with them', () => {
    const doc = add(room(), { ...camera, frame: { x: 6000, y: 0, width: 4000, height: 2500 } })
    const { doc: out, ids } = pasteNodes(doc, copyNodes(doc, ['n', 'e', 's', 'w', 'c']), 'page_1', { x: 10000, y: 0 })
    const view = ids.map((id) => out.nodes[id]).find((n) => n.type === 'camera')!
    expect(view).toMatchObject({ a: { x: 12500, y: 3500 }, frame: { x: 16000 } })
    expect(view).not.toHaveProperty('page')
  })
})

describe('what is clicked in a view', () => {
  const doc = add(room(), camera)
  const solids = massing(doc, 'page_1', registry, [camera.a], camera.a)
  const at = (u: number, v: number, from = doc.nodes.c) => (from.type === 'camera' ? solidAt(solids, from, u, v, 16 / 9)?.solid.node : undefined)

  it('is the object nearest the eye along the line of sight through the point', () => {
    // A little right of ahead, at eye height: the window in the north wall (from 2500 to 3700, its middle 600 right of the eye, 3500 ahead).
    const u = 0.5 + 600 / 3500 / (2 * Math.tan((35 * Math.PI) / 180))
    expect(at(u, 0.5)).toBe('win')
    // Low down, the wall under its sill; high up, the ceiling of the room before the wall reaches it.
    expect(at(u, 0.95)).toBe('n')
    expect(at(u, 0.02)).toBe('r')
  })

  it('follows the way it looks and where it stands', () => {
    const east = add(room(), { type: 'camera', id: 'c', a: { x: 2500, y: 3000 }, b: { x: 3500, y: 3000 } })
    const seen = massing(east, 'page_1', registry, [{ x: 2500, y: 3000 }], { x: 2500, y: 3000 })
    const node = east.nodes.c
    expect(node.type === 'camera' && solidAt(seen, node, 0.5, 0.5, 16 / 9)?.solid.node).toBe('door')
    // Where it meets it, on the plan and above the floor: in the doorway, at eye height.
    const hit = node.type === 'camera' ? solidAt(seen, node, 0.5, 0.5, 16 / 9) : null
    expect(hit?.height).toBeCloseTo(1500, 0)
    expect(hit?.at.y).toBeCloseTo(3000, 0)
    expect(hit?.at.x).toBeGreaterThan(4700)
  })

  it('is nothing where nothing is in the way', () => {
    expect(solidAt([], doc.nodes.c as never, 0.5, 0.5, 16 / 9)).toBeNull()
  })
})

describe('looking around from a viewpoint', () => {
  it('turns the way it looks about where it stands, and tilts it up and down within ±60°', async () => {
    const { lookAround } = await import('../src')
    const doc = add(room(), camera)
    const c = doc.nodes.c as never
    // Looking north, a quarter to the right is east, as far ahead as before.
    expect(lookAround(c, 90, 0)).toEqual({ b: { x: 3500, y: 3500 }, pitch: undefined })
    expect(lookAround(c, -90, 10.4)).toEqual({ b: { x: 1500, y: 3500 }, pitch: 10 })
    expect(lookAround(c, 0, -200)!.pitch).toBe(-60)
    // Its eye stays where it is.
    const turned = applyOps(doc, [{ op: 'update_node', id: 'c', patch: lookAround(c, 45, -5)! }])
    expect(turned.nodes.c).toMatchObject({ a: { x: 2500, y: 3500 }, pitch: -5 })
  })

  it('steps aside, the way it looks kept, and raises or lowers its eye, not under 100 mm', async () => {
    const { stepAside } = await import('../src')
    const doc = add(room(), camera)
    const c = doc.nodes.c as never
    // Looking north, its right is east.
    expect(stepAside(c, 300, 200)).toEqual({ a: { x: 2800, y: 3500 }, b: { x: 2800, y: 2500 }, eyeHeight: 1700 })
    expect(stepAside(c, -300, -5000)).toEqual({ a: { x: 2200, y: 3500 }, b: { x: 2200, y: 2500 }, eyeHeight: 100 })
    // And forward, north, or back.
    expect(stepAside(c, 0, 0, 500)).toEqual({ a: { x: 2500, y: 3000 }, b: { x: 2500, y: 2000 }, eyeHeight: 1500 })
  })
})

describe('furniture in 3D', () => {
  const slabsOf = (node: Record<string, unknown>) => massing(add(room(), { parent: 'page_1', id: 'o', x: 1000, y: 1000, ...node }), 'page_1', registry).filter((s) => s.node === 'o')

  it('stands a worktop as a slab, not a block down to the floor', () => {
    const slabs = slabsOf({ type: 'parametric', kind: 'arch.worktop', props: {} })
    expect(slabs.map((s) => [s.bottom, s.top])).toEqual([[862, 900]])
  })

  it('stands a base unit on its plinth set back, its worktop reaching past its fronts', () => {
    const [plinth, body, top] = slabsOf({ type: 'parametric', kind: 'arch.baseunit', props: {} })
    const deep = (s: { outline: { y: number }[] }) => Math.max(...s.outline.map((p) => p.y)) - 1000
    expect([plinth.top, body.top, top.top]).toEqual([100, 862, 900])
    expect([deep(plinth), deep(body), deep(top)]).toEqual([530, 580, 600])
  })

  it('puts a chair on four legs under its seat, its back above, and a high chair at a counter on a footrest', () => {
    const chair = slabsOf({ type: 'parametric', kind: 'arch.chair', props: {} })
    expect(chair.filter((s) => s.bottom === 0)).toHaveLength(4)
    expect(Math.max(...chair.map((s) => s.top))).toBe(880)
    const high = slabsOf({ type: 'parametric', kind: 'arch.chair.high', props: { height: 'Bar' } })
    expect(high.find((s) => s.bottom === 710)!.top).toBe(750)
    expect(high.filter((s) => s.bottom > 0 && s.top < 710)).toHaveLength(2)
    const stool = slabsOf({ type: 'parametric', kind: 'arch.chair.high', props: { back: false } })
    expect(Math.max(...stool.map((s) => s.top))).toBe(650)
  })

  it('makes a hood its canopy narrowing to its chimney, which goes up to the ceiling; boxed, its box up to the ceiling', () => {
    const hood = (style: string) => massing(add(room(), { type: 'parametric', id: 'o', kind: 'arch.hood', props: { style }, x: 1000, y: 100 }), 'page_1', registry).filter((s) => s.node === 'o')
    const chimney = hood('Chimney')
    // Its underside 65 cm over the worktop.
    expect(Math.min(...chimney.map((s) => s.bottom))).toBe(1548)
    const canopy = chimney.find((s) => s.upper)!
    expect(canopy.upper).toHaveLength(canopy.outline.length)
    expect(Math.max(...chimney.map((s) => s.top))).toBe(2600)
    const boxed = hood('Boxed')
    expect(boxed.find((s) => s.bottom === 1550)!.top).toBe(2600)
    expect(Math.max(...hood('Flat').map((s) => s.top))).toBe(1700)
  })

  it('gives the sink one door or two, a single one hinged on the side chosen', () => {
    const sink = registry.parametric.get('arch.sink')!
    const front = (props: Record<string, unknown>) => sink.front!(registry.resolveProps(sink, props))
    // A handle is a heavy line; one door has one, two have two.
    const handles = (prims: ReturnType<typeof front>) => prims.filter((p) => p.kind === 'path' && p.strokeWidth === 2 && p.points.length === 2 && p.points[0].x === p.points[1].x)
    expect(handles(front({}))).toHaveLength(2)
    const left = handles(front({ doors: 1 }))
    const right = handles(front({ doors: 1, hinge: 'Right' }))
    expect(left).toHaveLength(1)
    // Hinged on its left, it opens from its right, its handle there; hinged on the right, the other way.
    expect((left[0] as { points: { x: number }[] }).points[0].x).toBeGreaterThan(400)
    expect((right[0] as { points: { x: number }[] }).points[0].x).toBeLessThan(400)
    expect(sink.params.find((p) => p.key === 'hinge')!.shown!(registry.resolveProps(sink, { doors: 2 }))).toBe(false)
  })

  it('makes a table written as data of its slabs: its top on its legs, and its chairs', () => {
    const table = slabsOf({ type: 'parametric', kind: 'furn.table', props: {} })
    expect(table.filter((s) => s.top === 750)).toHaveLength(1)
    expect(table.filter((s) => s.top === 720)).toHaveLength(4)
    // Six chairs, each of four legs, a seat and a back.
    expect(table.filter((s) => s.top === 880)).toHaveLength(6)
    expect(table).toHaveLength(5 + 6 * 6)
  })
})

describe('the drawings painted on an object', () => {
  it('are its plan for its top and what its kind draws from the front and the side, placed as elevations place them', () => {
    const doc = add(room(), { type: 'parametric', id: 'sink', kind: 'arch.sink', props: {}, x: 1000, y: 100 })
    const sink = massing(doc, 'page_1', registry).find((s) => s.node === 'sink')!
    const drawings = sink.drawings!
    expect(drawings.top.length).toBeGreaterThan(0)
    expect(drawings.top.every((p) => p.kind === 'path' || p.kind === 'ellipse')).toBe(true)
    expect(drawings.front?.length).toBeGreaterThan(0)
    expect(drawings.side?.length).toBeGreaterThan(0)
    // Against the north wall, facing into the room: its own X runs east, it faces south, from the floor.
    expect(drawings.origin).toEqual({ x: 1000, y: 100 })
    expect(drawings.along).toEqual({ x: 1, y: 0 })
    expect(drawings.facing.y).toBeCloseTo(1)
    expect(drawings.base).toBe(0)
  })
})

describe('an object its kind gives a shape in 3D', () => {
  it('is made of its slabs where it stands: a sink its bowl sunk into the worktop and its tap standing over it', () => {
    const doc = add(room(), { type: 'parametric', id: 'sink', kind: 'arch.sink', props: {}, x: 1000, y: 100 })
    const slabs = massing(doc, 'page_1', registry).filter((s) => s.node === 'sink')
    // The worktop and the top of the unit under it, cut through by the bowl.
    const cut = slabs.filter((s) => (s.holes?.length ?? 0) > 0)
    expect(cut.map((s) => s.bottom)).toEqual([720, 862])
    const worktop = cut[1]
    expect(worktop.top).toBe(900)
    expect(worktop.holes).toHaveLength(1)
    // Every point of the bowl is within the sink, placed where the sink is.
    for (const p of worktop.holes![0]) expect(p.x > 1000 && p.x < 1800 && p.y > 100 && p.y < 700).toBe(true)
    const tap = slabs.filter((s) => s.finish === 'metal' && s.top > 900)
    expect(Math.max(...tap.map((s) => s.top))).toBe(1200)
  })
})
