import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, cameraSun, createComponent, drawnAltitude, createDocument, kindOf, nodePrimitives, onlySunsMoved, parseDocument, pointInPolygon, readDocument, Registry, serializeDocument, SHADE_FILL, SOFT_LAYERS, sunFor, sunlight, sunOf, sunSpot, timeNear, type Document, type NodeOf, type Op } from '../src'

/*
 * The sun (ARCHITECTURE, "The sun"): the shade it casts on the plan, the floors it lights through the
 * openings, and how a sun is drawn, moved through the day and saved.
 */
const registry = new Registry().use(architecture)

const add = (doc: Document, ...nodes: Record<string, unknown>[]): Document => applyOps(doc, nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
const wall = (id: string, a: [number, number], b: [number, number]) => ({ type: 'wall', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, height: 2600 })
/** A room 5 m by 4 m inside walls 200 thick and 2600 high, a window 1200 wide in its north wall, from X = 2500. */
const room = (): Document =>
  add(
    createDocument('Room'),
    wall('n', [0, 0], [5000, 0]),
    wall('e', [5000, 0], [5000, 4000]),
    wall('s', [5000, 4000], [0, 4000]),
    wall('w', [0, 4000], [0, 0]),
    { type: 'parametric', id: 'win', kind: 'arch.window', props: { width: 1200 }, x: 2500, y: 0 },
    { type: 'room', id: 'r', name: 'Living', x: 2500, y: 2000 },
  )

const area = (outline: { x: number; y: number }[]) => Math.abs(outline.reduce((sum, p, i) => sum + p.x * outline[(i + 1) % outline.length].y - outline[(i + 1) % outline.length].x * p.y, 0)) / 2
const total = (outlines: { x: number; y: number }[][]) => outlines.reduce((sum, outline) => sum + area(outline), 0)
const FROM_NORTH = { x: 0, y: -1 }
const FROM_SOUTH = { x: 0, y: 1 }

describe('the shade of the sun on the plan', () => {
  it('lights the floor through a window the sun shines into, behind it and as wide', () => {
    const light = sunlight(room(), 'page_1', registry, FROM_NORTH, 45)!
    expect(light.lit.length).toBeGreaterThan(0)
    const points = light.lit.flat()
    // Within the room, south of the window, no wider than the window.
    expect(Math.min(...points.map((p) => p.x))).toBeGreaterThan(2500 - 1)
    expect(Math.max(...points.map((p) => p.x))).toBeLessThan(3700 + 1)
    expect(Math.min(...points.map((p) => p.y))).toBeGreaterThan(100)
    expect(Math.max(...points.map((p) => p.y))).toBeLessThan(4000)
    // At 45°, about as deep as the window is high, less the thickness of the wall it goes through.
    expect(total(light.lit)).toBeGreaterThan(0.3 * 1200 * 1000)
    expect(total(light.lit)).toBeLessThan(1200 * 1500)
  })

  it('lights one patch through a window of two panes, smooth, its frame and the bar between its panes casting nothing', () => {
    const light = sunlight(room(), 'page_1', registry, FROM_NORTH, 45)!
    expect(light.lit).toHaveLength(1)
    // Its corners rounded, and its edge fading through narrower layers.
    expect(light.lit[0].length).toBeGreaterThan(8)
    // From a little wider than it to a little narrower: the patch exactly among them, its middle in all.
    const areas = light.layers.map((layer) => total(layer.lit))
    expect(areas).toEqual([...areas].sort((a, b) => b - a))
    expect(areas[0]).toBeGreaterThan(total(light.lit))
    expect(areas.at(-1)!).toBeLessThan(total(light.lit))
    expect(areas.at(-1)!).toBeGreaterThan(0)
    // The shade, wider, stays out from under the ceiling: nothing of it inside the room.
    expect(light.layers[0].shade.flat().some((p) => p.x > 200 && p.x < 4800 && p.y > 200 && p.y < 3800)).toBe(false)
  })

  it('reaches further into the room when the sun is lower', () => {
    const high = sunlight(room(), 'page_1', registry, FROM_NORTH, 60)!
    const low = sunlight(room(), 'page_1', registry, FROM_NORTH, 30)!
    const deepest = (light: typeof high) => Math.max(...light.lit.flat().map((p) => p.y))
    expect(deepest(low)).toBeGreaterThan(deepest(high))
  })

  it('lights nothing inside when the sun is behind the wall with the window', () => {
    expect(total(sunlight(room(), 'page_1', registry, FROM_SOUTH, 45)!.lit)).toBeLessThan(1000)
  })

  it('casts the shade of the building on the ground away from the sun, as long as it is high at 45°', () => {
    const light = sunlight(room(), 'page_1', registry, FROM_SOUTH, 45)!
    const ys = light.shade.flat().map((p) => p.y)
    // North of the north face (Y = -100), by the height of the walls and of the ceiling on them.
    expect(Math.min(...ys)).toBeLessThan(-100 - 2550)
    expect(Math.min(...ys)).toBeGreaterThan(-100 - 2700)
    // None of it inside, which the ceiling covers: in there it is what is lit that is drawn.
    expect(light.shade.flat().some((p) => p.x > 200 && p.x < 4800 && p.y > 200 && p.y < 3800)).toBe(false)
  })

  it('casts nothing at night', () => {
    expect(sunlight(room(), 'page_1', registry, FROM_SOUTH, -2)).toBeNull()
  })

  it('puts a ceiling over a space the walls close with no room named there, and none over a room open to the sky', () => {
    // A hall north of the room, named nothing, its window the one between them: the hall is roofed,
    // and the sun does not come down into it and on through that window.
    const hall = add(room(), wall('hn', [0, -3000], [5000, -3000]), wall('he', [5000, -3000], [5000, 0]), wall('hw', [0, 0], [0, -3000]))
    expect(total(sunlight(hall, 'page_1', registry, FROM_NORTH, 45)!.lit)).toBe(0)
    // Without its room, the room is still under a ceiling, the sun coming in by its window only.
    const unnamed = applyOps(room(), [{ op: 'remove_node', id: 'r' }])
    expect(total(sunlight(unnamed, 'page_1', registry, FROM_NORTH, 45)!.lit)).toBeCloseTo(total(sunlight(room(), 'page_1', registry, FROM_NORTH, 45)!.lit), -3)
    // Open to the sky, a courtyard: its floor is open ground, which only its walls shade, as far as they are high.
    const open = applyOps(room(), [{ op: 'update_node', id: 'r', patch: { open: true } }])
    const light = sunlight(open, 'page_1', registry, FROM_NORTH, 45)!
    expect(light.lit).toEqual([])
    const shaded = (p: { x: number; y: number }) => light.shade.some((outline) => pointInPolygon(p, outline))
    expect(shaded({ x: 1000, y: 2000 })).toBe(true)
    expect(shaded({ x: 1000, y: 3500 })).toBe(false)
  })

  it('shades the floor lit through a window with what stands in the way', () => {
    // A wall 6 m high 3 m north of the window, as the other wing of an L would be.
    const wing = add(room(), { ...wall('wing', [1000, -3000], [5000, -3000]), height: 6000 })
    const shaded = total(sunlight(wing, 'page_1', registry, FROM_NORTH, 45)!.lit)
    const free = total(sunlight(room(), 'page_1', registry, FROM_NORTH, 45)!.lit)
    expect(shaded).toBeLessThan(free * 0.5)
  })

  it('keeps the plan it raised while only suns and viewpoints change', () => {
    const doc = add(room(), { type: 'sun', id: 'sun', x: 8000, y: 0, date: '2026-06-21', time: '15:00' })
    const later = applyOps(doc, [{ op: 'update_node', id: 'sun', patch: { time: '16:00' } }])
    expect(onlySunsMoved(doc.nodes, later.nodes)).toBe(true)
    expect(onlySunsMoved(doc.nodes, applyOps(doc, [{ op: 'update_node', id: 'n', patch: { height: 3000 } }]).nodes)).toBe(false)
  })
})

describe('a sun', () => {
  const withSun = (patch: Record<string, unknown> = {}) => add(room(), { type: 'sun', id: 'sun', x: 8000, y: 0, date: '2026-06-21', time: '15:00', ...patch })
  const sunNode = (doc: Document) => doc.nodes.sun as NodeOf<'sun'>

  it('is in the south-west in Paris on a summer afternoon, and the plan turned turns it', () => {
    const doc = withSun()
    const { position, towards } = sunOf(doc, sunNode(doc))!
    expect(position.azimuth).toBeGreaterThan(200)
    expect(position.azimuth).toBeLessThan(260)
    // North up: the south-west is at the bottom left.
    expect(towards.x).toBeLessThan(0)
    expect(towards.y).toBeGreaterThan(0)
    const turned = applyOps(doc, [{ op: 'update_node', id: 'page_1', patch: { north: 180 } }])
    expect(sunOf(turned, sunNode(turned))!.towards.x).toBeCloseTo(-towards.x)
  })

  it('draws its shade and lit floors under all else and out of its box', () => {
    const doc = withSun({ time: '13:00' })
    const prims = nodePrimitives(sunNode(doc), { doc, registry, depth: 0 })
    const shade = prims.filter((p) => p.kind === 'path' && p.backdrop === 'floor')
    expect(shade.length).toBeGreaterThan(0)
    expect(shade.every((p) => p.aside)).toBe(true)
    expect(nodePrimitives(sunNode(withSun({ time: '13:00', shadows: false })), { doc: withSun({ shadows: false }), registry, depth: 0 }).some((p) => p.backdrop === 'floor')).toBe(false)
    // In the colours it gives, a shared colour followed; else see-through ones of its own.
    // Drawn in layers, each narrower and as see-through as it takes for all of them over one another to be of the colour: the edges fade.
    const layered = (fills: (string | undefined)[], colour: string) => {
      expect(fills.every((fill) => fill?.slice(0, 7) === colour.slice(0, 7))).toBe(true)
      const each = parseInt(fills[0]!.slice(7, 9), 16) / 255
      expect(1 - (1 - each) ** SOFT_LAYERS).toBeCloseTo(parseInt(colour.slice(7, 9), 16) / 255, 1)
    }
    layered(shade.map((p) => p.fill), SHADE_FILL)
    const coloured = applyOps(withSun({ time: '13:00', shade: 'var(--dusk)', sunlit: '#ff000080' }), [{ op: 'add_color', color: { id: 'dusk', name: 'Dusk', value: '#20304080' } } as never])
    layered(nodePrimitives(sunNode(coloured), { doc: coloured, registry, depth: 0 }).filter((p) => p.backdrop === 'floor').map((p) => p.fill), '#20304080')
    // At night, the sun is drawn on the horizon, with no shade.
    const night = withSun({ time: '23:30' })
    expect(nodePrimitives(sunNode(night), { doc: night, registry, depth: 0 }).some((p) => p.backdrop === 'floor')).toBe(false)
  })

  it('casts its shade as far as its length says, the sun drawn lower, on the plan and in a view', () => {
    const farthest = (doc: Document) => {
      const prims = nodePrimitives(sunNode(doc), { doc, registry, depth: 0 }).filter((p) => p.backdrop === 'floor' && p.kind === 'path')
      return Math.max(...prims.flatMap((p) => (p.kind === 'path' ? p.points.map((q) => Math.hypot(q.x - 2500, q.y - 2000)) : [])))
    }
    const real = farthest(withSun({ time: '18:00' }))
    const twice = farthest(withSun({ time: '18:00', reach: 2 }))
    expect(twice).toBeGreaterThan(real * 1.5)
    expect(drawnAltitude(45, 2)).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI)
    expect(drawnAltitude(45)).toBe(45)
    const viewed = add(withSun({ reach: 2 }), { type: 'camera', id: 'c', a: { x: 2500, y: 3500 }, b: { x: 2500, y: 2500 } })
    expect(cameraSun(viewed, viewed.nodes.c as NodeOf<'camera'>)!.altitude).toBeCloseTo(drawnAltitude(sunOf(viewed, sunNode(viewed))!.position.altitude, 2))
  })

  it('changes its hour when the sun is dragged along its path', () => {
    const doc = withSun()
    const sun = sunNode(doc)
    const kind = kindOf(sun)
    const handles = kind.handles!(sun, registry, doc)
    expect(handles[1]).toEqual(sunSpot(doc, sun))
    const morning = applyOps(doc, [{ op: 'update_node', id: 'sun', patch: { time: '09:00' } }])
    const there = sunSpot(morning, sunNode(morning))
    expect(kind.moveHandle!(sun, 1, there, registry, doc)).toEqual({ time: '09:00' })
    expect(timeNear(doc, sun, there)).toBe('09:00')
    // Its centre moves it.
    expect(kind.moveHandle!(sun, 0, { x: 9000, y: 500 }, registry, doc)).toEqual({ x: 9000, y: 500 })
  })

  it('lights the views of its page, the one a viewpoint names or else the first', () => {
    const doc = add(withSun(), { type: 'sun', id: 'sun2', x: 9000, y: 0, date: '2026-12-21', time: '12:00' }, { type: 'camera', id: 'c', a: { x: 2500, y: 3500 }, b: { x: 2500, y: 2500 } })
    const camera = doc.nodes.c as NodeOf<'camera'>
    expect(sunFor(doc, camera, 'page_1')?.id).toBe('sun')
    expect(sunFor(doc, { ...camera, sun: 'sun2' }, 'page_1')?.id).toBe('sun2')
    expect(sunFor(doc, { ...camera, sun: 'gone' }, 'page_1')?.id).toBe('sun')
  })

  it('stays on its page: no component holds one', () => {
    const doc = withSun()
    expect(() => createComponent(doc, registry, ['sun'], 'Plan')).toThrow(/sun stays on the page/)
    const component = createComponent(doc, registry, ['n', 'sun'], 'Plan')
    expect(Object.values(component.doc.nodes).find((n) => n.type === 'sun')?.parent).toBe('page_1')
  })

  it('is saved in version 8 of the format, which a drawing without one does not need', () => {
    expect(JSON.parse(serializeDocument(withSun())).version).toBe(8)
    expect(JSON.parse(serializeDocument(room())).version).toBeLessThan(8)
    expect(parseDocument(JSON.parse(serializeDocument(withSun()))).nodes.sun.type).toBe('sun')
    // Version 7 drawings come up unchanged.
    const old = { ...JSON.parse(serializeDocument(room())), version: 7 }
    expect(readDocument(old).doc.nodes.n).toEqual(room().nodes.n)
  })

  it('refuses a day or an hour that is not written as one', () => {
    expect(() => withSun({ date: '21/06/2026' })).toThrow()
    expect(() => withSun({ time: '3pm' })).toThrow()
  })
})
