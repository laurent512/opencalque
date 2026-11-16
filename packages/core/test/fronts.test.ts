import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { standardRegistry } from '../../warehouse/src'
import { applyOps, createDocument, elevationPrimitives, primitiveBounds, Registry, seenFrom, type Document, type NodeOf, type Op, type Primitive } from '../src'
import { viewOps } from './view-nodes'

/*
 * Furniture and kitchen units in elevations (`front`, `side`, `back` of their kinds): what the
 * kinds draw, and which of the three an elevation takes as the object faces it, from in front,
 * from the side or from behind.
 */
const registry = standardRegistry()
const kindOf = (kind: string) => registry.parametric.get(kind)!
const front = (kind: string, props: Record<string, unknown> = {}) => kindOf(kind).front!(registry.resolveProps(kindOf(kind), props))
const side = (kind: string, props: Record<string, unknown> = {}) => kindOf(kind).side!(registry.resolveProps(kindOf(kind), props))
const box = (prims: Primitive[]) => {
  const all = prims.map(primitiveBounds).filter((b) => b !== null)
  return { minX: Math.round(Math.min(...all.map((b) => b.minX))), maxX: Math.round(Math.max(...all.map((b) => b.maxX))), minY: Math.round(Math.min(...all.map((b) => b.minY))), maxY: Math.round(Math.max(...all.map((b) => b.maxY))) }
}
/** The handles drawn: bars heavier than the fronts. */
const handles = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.strokeWidth === 2).length

describe('what an elevation takes of an object', () => {
  it('is its front within 45° of facing the viewer, its back past 135°, its side between', () => {
    const viewer = { x: 0, y: 1 }
    expect(seenFrom({ x: 0, y: 1 }, viewer)).toBe('front')
    expect(seenFrom({ x: 1, y: 1.01 }, viewer)).toBe('front')
    expect(seenFrom({ x: 1, y: 0.99 }, viewer)).toBe('side')
    expect(seenFrom({ x: -1, y: 0 }, viewer)).toBe('side')
    expect(seenFrom({ x: 0, y: -1 }, viewer)).toBe('back')
  })

  /** A kind of box that draws a mark of its own from each side: a circle in front, a square from the side, a triangle from behind. */
  const marked = (back: boolean) =>
    new Registry().use({
      id: 'test.marked',
      name: 'Marked',
      version: '1.0.0',
      activate(api) {
        api.registerParametric({
          kind: 'test.marked',
          label: 'Marked',
          params: [],
          height: () => 1000,
          build: () => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }], closed: true }],
          front: () => [{ kind: 'ellipse', cx: 300, cy: -500, rx: 100, ry: 100 }],
          side: () => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: -1000 }, { x: 0, y: -1000 }], closed: true }],
          ...(back ? { back: () => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 300, y: -1000 }], closed: true }] } : {}),
        })
      },
    })
  /** The object turned by `rotation` about its insertion point at (2000, 1000), seen from the south by a view along y = 3000, looking north. */
  const seen = (rotation: number, back = true) => {
    const reg = marked(back)
    const doc = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'parametric', id: 'm', parent: 'page_1', kind: 'test.marked', props: {}, x: 2000, y: 1000, rotation } as never },
      ...viewOps({ id: 'l', a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 }, depth: 3000, x: 0, y: 10000 }),
    ])
    return elevationPrimitives(doc.nodes.lv as NodeOf<'elevation'>, doc, reg)
  }
  it('draws the front of what faces the viewer, the side of what is turned a quarter, the back of what is turned away', () => {
    expect(seen(0).filter((p) => p.kind === 'ellipse')).toHaveLength(1)
    // Turned a quarter, its front towards -X: seen from the side, drawn along the way it faces, from its insertion point back.
    const turned = seen(90).filter((p) => p.kind === 'path' && p.closed)
    expect(turned.map(primitiveBounds)).toContainEqual({ minX: 1600, maxX: 2000, minY: 9000, maxY: 10000 })
    expect(seen(-90).map(primitiveBounds)).toContainEqual({ minX: 2000, maxX: 2400, minY: 9000, maxY: 10000 })
    // From behind, its own X runs to the viewer's left: the back is mirrored, from 2000 to 1400.
    expect(seen(180).map(primitiveBounds)).toContainEqual({ minX: 1400, maxX: 2000, minY: 9000, maxY: 10000 })
    expect(seen(180).some((p) => p.kind === 'path' && p.points.length === 3)).toBe(true)
  })

  it('draws a box where the kind draws nothing from that side', () => {
    const behind = seen(180, false).filter((p) => p.kind === 'path' && p.closed)
    expect(behind.map(primitiveBounds)).toContainEqual({ minX: 1400, maxX: 2000, minY: 9000, maxY: 10000 })
    expect(behind.every((p) => p.kind === 'path' && p.points.length === 4)).toBe(true)
  })

  it('draws furniture lighter than walls, unless the kind gives a line its own weight', () => {
    const doc: Document = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'parametric', id: 'u', parent: 'page_1', kind: 'arch.baseunit', props: {}, x: 0, y: 0 } as never },
      ...viewOps({ id: 'l', a: { x: -100, y: 1000 }, b: { x: 1000, y: 1000 }, depth: 1000, x: 0, y: 10000 }),
    ] as Op[])
    const prims = elevationPrimitives(doc.nodes.lv as NodeOf<'elevation'>, doc, registry)
    expect(prims.filter((p) => p.kind === 'path' && p.strokeWidth === undefined)).toEqual([])
    expect(prims.some((p) => p.kind === 'path' && p.strokeWidth === 0.6)).toBe(true)
  })
})

describe('kitchen units in elevations', () => {
  it('stand as high as their worktop, their plinth under their fronts', () => {
    expect(box(front('arch.baseunit'))).toEqual({ minX: 0, maxX: 600, minY: -900, maxY: 0 })
    expect(box(side('arch.baseunit'))).toEqual({ minX: 0, maxX: 600, minY: -900, maxY: 0 })
    expect(box(front('arch.tallunit'))).toEqual({ minX: 0, maxX: 600, minY: -2150, maxY: 0 })
  })

  it('have the fronts they are asked for: doors, drawers, a drawer over doors, an oven', () => {
    expect(handles(front('arch.baseunit', { doors: 2 }))).toBe(2)
    expect(handles(front('arch.baseunit', { fronts: 'Drawers', drawers: 4 }))).toBe(4)
    expect(handles(front('arch.baseunit', { fronts: 'Door and drawer', doors: 2 }))).toBe(3)
    // The oven's handle and the drawer's under it.
    expect(handles(front('arch.baseunit', { fronts: 'Oven' }))).toBe(2)
  })

  it('draw no more fronts than a dozen, whatever number is typed', () => {
    expect(handles(front('arch.baseunit', { doors: 1e9 }))).toBe(12)
    expect(handles(front('arch.baseunit', { fronts: 'Drawers', drawers: 1e9 }))).toBe(12)
    expect(handles(front('arch.chest', { drawers: 1e9 }))).toBeLessThanOrEqual(12)
  })

  it('set the hob and the sink in the unit asked for, an oven under the hob unless said otherwise', () => {
    // The hob's glass and the oven under it; the sink's tap standing over its worktop.
    expect(front('arch.hob').filter((p) => p.kind === 'path' && p.strokeWidth === 2)).toHaveLength(2)
    expect(handles(front('arch.hob', { below: 'None' }))).toBe(0)
    expect(box(front('arch.sink')).minY).toBeLessThan(-1100)
  })

  it('put a tall unit’s oven and microwave at a height the hand reaches, and leave out what has no room', () => {
    const prims = front('arch.tallunit')
    // Its oven from 850 to 1445 above the floor, the microwave over it.
    expect(prims.filter((p) => p.kind === 'path' && p.closed && p.strokeWidth === undefined).map((p) => box([p]))).toEqual(
      expect.arrayContaining([
        { minX: 0, maxX: 600, minY: -1445, maxY: -853 },
        { minX: 0, maxX: 600, minY: -1835, maxY: -1448 },
      ]),
    )
    expect(() => front('arch.tallunit', { height: 300 })).not.toThrow()
    expect(box(front('arch.tallunit', { height: 300 })).minY).toBe(-300)
  })

  it('hang the hood and the wall cabinet from their underside, and the splashback’s tiles inside it', () => {
    expect(box(front('arch.hood'))).toEqual({ minX: 0, maxX: 600, minY: -1050, maxY: 0 })
    expect(box(side('arch.hood', { style: 'Flat' }))).toEqual({ minX: 0, maxX: 500, minY: -150, maxY: 0 })
    expect(box(front('arch.splashback', { width: 2000, height: 600 }))).toEqual({ minX: 0, maxX: 2000, minY: -600, maxY: 0 })
    // At most 60 rows of at most 60 joints, however large it is made.
    expect(front('arch.splashback', { width: 1e7, height: 1e7 }).length).toBeLessThan(60 * 62)
  })
})

describe('bedroom furniture in elevations', () => {
  it('has its drawers in two columns from 1.2 m wide, its doors hinged or sliding', () => {
    expect(handles(front('arch.chest'))).toBe(4)
    expect(handles(front('arch.chest', { width: 1400 }))).toBe(8)
    expect(handles(front('arch.wardrobe', { doors: 3 }))).toBe(3)
    expect(handles(front('arch.wardrobe', { doors: 3, opening: 'Sliding' }))).toBe(3)
  })

  it('draws the bed with its headboard over its mattress, from the foot and from the side', () => {
    expect(box(front('furn.bed'))).toEqual({ minX: 0, maxX: 1600, minY: -1000, maxY: 0 })
    expect(box(side('furn.bed'))).toEqual({ minX: 0, maxX: 2000, minY: -1000, maxY: 0 })
  })

  it('gives everything that stands in elevations a front and a side, so that none is left a box', () => {
    const plain = new Registry().use(architecture)
    for (const kind of [...registry.parametric.values(), ...plain.parametric.values()]) {
      if (!kind.height || kind.mount?.on === 'wall') continue
      expect(kind.front, kind.kind).toBeDefined()
      expect(kind.side, kind.kind).toBeDefined()
    }
  })
})

describe('seats, desks and the bathroom in elevations', () => {
  it('draw a sofa with a line between its seats, as many as it has', () => {
    const between = (seats: number) => front('arch.sofa', { width: 2300, seats }).filter((p) => p.kind === 'path' && !p.closed && p.strokeWidth === 0.5).length
    expect(between(3)).toBe(4)
    expect(between(1e9)).toBe(22)
    expect(box(front('arch.armchair'))).toEqual({ minX: 0, maxX: 850, minY: -850, maxY: 0 })
  })

  it('draw a corner sofa with the arm of its return at its corner, mirrored for a corner on the right', () => {
    const left = box(front('arch.sofa.corner'))
    expect(left).toEqual({ minX: 0, maxX: 2600, minY: -850, maxY: 0 })
    expect(box(front('arch.sofa.corner', { corner: 'Right' }))).toEqual(left)
    expect(box(side('arch.sofa.corner'))).toEqual({ minX: 0, maxX: 1800, minY: -850, maxY: 0 })
  })

  it('draw a chair the same from behind as from in front, and a desk with its office chair or without', () => {
    const chair = kindOf('arch.chair')
    expect(chair.back!(registry.resolveProps(chair, {}))).toEqual(chair.front!(registry.resolveProps(chair, {})))
    expect(front('arch.desk').length).toBeGreaterThan(front('arch.desk', { chair: false }).length)
    expect(box(side('arch.desk')).maxX).toBeGreaterThan(700)
    expect(box(side('arch.desk', { chair: false })).maxX).toBe(700)
  })

  it('hang a washbasin’s vanity unit under its counter when asked, and stand a radiator off the floor', () => {
    expect(handles(front('arch.washbasin'))).toBe(0)
    expect(handles(front('arch.washbasin', { below: 'Drawers' }))).toBe(2)
    expect(box(front('arch.washbasin', { below: 'Drawers' })).maxY).toBe(-300)
    expect(box(front('arch.radiator'))).toMatchObject({ minY: -750 })
    expect(box(front('arch.bathtub'))).toMatchObject({ minX: 0, maxX: 1700, maxY: 0 })
  })
})
