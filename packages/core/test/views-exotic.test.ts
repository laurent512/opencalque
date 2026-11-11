import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import electrical from '../../warehouse/extensions/electrical.json'
import { applyOps, childrenOf, createDocument, declarativeExtension, elevationItemAt, nodePrimitives, shownInElevations, Registry, transformOps, viewOfFace, wallFaceAt, type Document, type NodeOf, type Op, type Primitive } from '../src'
import { viewNodes } from './view-nodes'

/*
 * Views of plans that are not square: walls at sharp angles crossing what a view sees, a line
 * that crosses a wall near a corner of walls of two thicknesses, things standing behind and in
 * front of walls in the way. Whatever is drawn, what is in front covers what is behind it.
 */
const registry = new Registry().use(architecture).use(declarativeExtension(electrical))

const add = (doc: Document, ...nodes: Record<string, unknown>[]): Document => applyOps(doc, nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
const wall = (id: string, a: [number, number], b: [number, number], extra: Record<string, unknown> = {}) => ({ type: 'wall', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, ...extra })
const drawn = (doc: Document, id = 'vv') => nodePrimitives(doc.nodes[id], { doc, registry, depth: 0 })

interface Box {
  index: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  fill?: string
  weight?: number
}
/** The closed paths a view draws, as boxes, in the order they are painted. */
const boxes = (prims: Primitive[]): Box[] =>
  prims.flatMap((p, index) => {
    if (p.kind !== 'path' || !p.closed || p.texture) return []
    const xs = p.points.map((q) => q.x)
    const ys = p.points.map((q) => q.y)
    return [{ index, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), fill: p.fill, weight: p.strokeWidth }]
  })
const filled = (box: Box) => box.fill !== undefined && box.fill !== 'none'
/** A face seen, white. */
const seenSurface = (box: Box) => box.fill === '#ffffff'
/** The walls in front of the faces, cut by the line or in the way: plain grey, all alike. */
const ways = (all: Box[]) => all.filter((box) => box.fill === '#e8ecf1')
const standing = (box: Box) => box.weight === 0.6

/** Whether filled boxes cover the stretch from `from` to `to` (to within 1 mm), and from `top` down to `bottom` on the sheet when given. */
function covers(over: Box[], from: number, to: number, top = Infinity, bottom = -Infinity): boolean {
  const spans = over
    .filter((b) => b.minY <= top + 1 && b.maxY >= bottom - 1)
    .map((b) => [b.minX, b.maxX])
    .sort((p, q) => p[0] - q[0])
  let reached = from
  for (const [x0, x1] of spans) {
    if (x0 > reached + 1) break
    reached = Math.max(reached, x1)
  }
  return reached >= to - 1
}
/** Whether what a box draws is all covered by filled boxes painted after it. */
const hidden = (all: Box[], box: Box) => covers(all.filter((b) => b.index > box.index && filled(b)), box.minX, box.maxX, box.minY, box.maxY)

/**
 * A room of five walls with no square corner (a plan put right after it went wrong, kept as numbers):
 * its bottom wall from (2997, 1111) to (0, 0), the walls up from its ends meeting it at about 64° and
 * 81°, a corner of walls 200 and 175 thick on the right; a view across it, its line crossing both
 * sides, the left one just below the corner where it turns, looking down at the bottom wall.
 */
const pentagonDoc = (): Document =>
  add(
    applyOps(createDocument('Pentagon'), [{ op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#b84a13', pattern: { kind: 'Tiles' } } }]),
    wall('p1', [0, 0], [2012.56, -1934.05], { material: 'brick' }),
    wall('p2', [2012.56, -1934.05], [4000, -6500]),
    wall('p3', [4000, -6500], [3402.25, -856.38], { material: 'brick' }),
    wall('p4', [3402.25, -856.38], [2997.62, 1110.6], { thickness: 175, material: 'brick' }),
    wall('p5', [2997.62, 1110.6], [0, 0]),
    ...viewNodes({ id: 'v', a: { x: 4064.2, y: -1028.35 }, b: { x: 975.07, y: -2172.86 }, depth: 2276.27, x: 0, y: 10000 }),
  )

describe('a view across a room with no square corner', () => {
  it('hides a cooktop behind the wall at a sharp angle, which the line of sight reaches first', () => {
    // A cooktop in the corner of 64°, against the bottom wall.
    const doc = add(pentagonDoc(), { type: 'parametric', id: 'hob', kind: 'arch.hob', props: {}, x: 1145.1, y: 317.61, rotation: 200.329333 })
    const all = boxes(drawn(doc))
    const hob = all.find(standing)!
    expect(hob).toBeDefined()
    expect(hidden(all, hob)).toBe(true)
  })

  it('draws the walls in front of the face, cut or in the way, plain grey whatever they are made of, joined ones as one, with no gap and no line between', () => {
    const prims = drawn(pentagonDoc())
    const all = boxes(prims)
    // Brick or not, nothing is drawn in a material: no pattern, no colour but grey and white.
    expect(prims.some((p) => p.kind === 'path' && p.texture)).toBe(false)
    expect(all.filter(filled).every((b) => b.fill === '#ffffff' || b.fill === '#e8ecf1')).toBe(true)
    // Each side of the room: the wall the line cuts, and what of it and of the wall it turns into is in the way, one grey block.
    const found = ways(all)
      .map((b) => [Math.round(b.minX), Math.round(b.maxX)])
      .sort((p, q) => p[0] - q[0])
    expect(found).toHaveLength(2)
    expect(found[0][0]).toBeCloseTo(184, -1)
    expect(found[0][1]).toBeCloseTo(764, -1)
    expect(found[1][0]).toBeCloseTo(2193, -1)
    expect(found[1][1]).toBeCloseTo(3294, -1)
  })

  it('without its walls, shows the whole face: no wall drawn at all, and the cooktop behind the wall now seen', () => {
    const doc = applyOps(add(pentagonDoc(), { type: 'parametric', id: 'hob', kind: 'arch.hob', props: {}, x: 1145.1, y: 317.61, rotation: 200.329333 }), [{ op: 'update_node', id: 'vv', patch: { walls: false } }])
    const all = boxes(drawn(doc))
    expect(ways(all)).toEqual([])
    const face = all.find(seenSurface)!
    expect(covers(all.filter((b) => b.index > face.index && filled(b)), face.minX, face.maxX)).toBe(false)
    expect(hidden(all, all.find(standing)!)).toBe(false)
  })

  it('cuts the walls at the corners of a square room, beside the face, and none without its walls', () => {
    const square = (walls?: boolean) =>
      add(createDocument('Square'), wall('n', [0, 0], [5000, 0]), wall('e', [5000, 0], [5000, 4000]), wall('s', [5000, 4000], [0, 4000]), wall('w', [0, 4000], [0, 0]), ...viewNodes({ id: 'v', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 10000, ...(walls === undefined ? {} : { walls }) }))
    const corners = ways(boxes(drawn(square())))
      .map((b) => [Math.round(b.minX), Math.round(b.maxX)])
      .sort((p, q) => p[0] - q[0])
    expect(corners).toEqual([[-100, 100], [4900, 5100]])
    expect(ways(boxes(drawn(square(false))))).toEqual([])
  })

  it('looks at the wall it is nearly along, at a slant, as a face, white, with what is fixed on it; the walls at the sides grey', () => {
    // The line turned 7° off the bottom wall: a section, no longer an elevation of it.
    const doc = applyOps(add(pentagonDoc(), { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: {}, x: 2176.58, y: 699.76, rotation: 200.329333, z: 950 }), [
      { op: 'update_node', id: 'v', patch: { a: { x: 4130.67, y: 271.17 }, b: { x: 896.41, y: -1416.87 }, depth: 1591.53 } },
    ])
    const all = boxes(drawn(doc))
    const face = all.find(seenSurface)!
    expect(face.maxX - face.minX).toBeGreaterThan(2000)
    // Not hidden by the walls at the sides, and the cabinet on it is drawn.
    expect(hidden(all, face)).toBe(false)
    expect(all.some((b) => b.index > face.index && !filled(b) && b.maxX - b.minX > 500 && b.maxX - b.minX < 700)).toBe(true)
    expect(ways(all).length).toBeGreaterThan(0)
  })

  it('dimensions nothing a wall in front hides all of, and does not take it by a click in the view', () => {
    // A switch on the bottom wall all behind the walls at the left of the view, near the corner of the room, and one in view. (One only partly behind them is dimensioned still.)
    const switches = [
      { type: 'parametric', id: 'hidden', kind: 'elec.switch', props: {}, x: 2833.33, y: 879.09, rotation: 20.329333, z: 1100 },
      { type: 'parametric', id: 'seen', kind: 'elec.switch', props: {}, x: 1600, y: 597.3, rotation: 20.329333, z: 1200 },
    ]
    const doc = add(pentagonDoc(), ...switches)
    const texts = drawn(doc).flatMap((p) => (p.kind === 'text' ? [p.text] : []))
    expect(texts).toContain('1200')
    expect(texts).not.toContain('1100')
    const view = doc.nodes.vv as NodeOf<'elevation'>
    const hiddenOne = shownInElevations(doc, registry, ['hidden'])[0]
    expect(hiddenOne).toBeDefined()
    const middle = { x: (hiddenOne.box.minX + hiddenOne.box.maxX) / 2, y: (hiddenOne.box.minY + hiddenOne.box.maxY) / 2 }
    expect(elevationItemAt(view, doc, registry, middle)?.node.id).not.toBe('hidden')
    // Without its walls, it is seen, dimensioned and taken.
    const open = applyOps(doc, [{ op: 'update_node', id: 'vv', patch: { walls: false } }])
    expect(drawn(open).flatMap((p) => (p.kind === 'text' ? [p.text] : []))).toContain('1100')
    expect(elevationItemAt(open.nodes.vv as NodeOf<'elevation'>, open, registry, middle)?.node.id).toBe('hidden')
  })

  it('draws each wall in the way after the faces behind it', () => {
    const all = boxes(drawn(pentagonDoc()))
    const face = all.find((b) => b.fill === '#ffffff' && b.weight !== 2)!
    for (const way of ways(all).filter((b) => b.maxX > face.minX && b.minX < face.maxX)) expect(way.index).toBeGreaterThan(face.index)
  })
})

describe('a view of a plan turned', () => {
  it('is the same view, whichever way the plan and its line are turned', () => {
    const doc = add(pentagonDoc(), { type: 'parametric', id: 'hob', kind: 'arch.hob', props: {}, x: 1145.1, y: 317.61, rotation: 200.329333 }, { type: 'parametric', id: 'c', kind: 'arch.wallcabinet', props: {}, x: 2176.58, y: 699.76, rotation: 200.329333, z: 950 })
    // Each box where it is from the point the view is drawn from, in the order painted.
    const seen = (d: Document) => {
      const view = d.nodes.vv as NodeOf<'elevation'>
      return boxes(drawn(d)).map((b) => [b.fill, b.weight, b.minX - view.x, b.maxX - view.x, b.minY - view.y, b.maxY - view.y])
    }
    const before = seen(doc)
    for (const rotation of [17, 90, 145, 233, 300]) {
      const turned = applyOps(doc, transformOps(doc, childrenOf(doc, 'page_1'), { pivot: { x: 500, y: -700 }, rotation }, registry))
      const after = seen(turned)
      expect(after.map((b) => [b[0], b[1]])).toEqual(before.map((b) => [b[0], b[1]]))
      after.forEach((b, i) => b.slice(2).forEach((v, k) => expect(v as number).toBeCloseTo(before[i][k + 2] as number, 0)))
    }
  })
})

describe('what stands in front of and behind a wall at an angle', () => {
  /**
   * A room 6 m wide, a wall at 45° standing in it from (2000, 2000) to (3500, 3500), and an
   * elevation of the inside of its top wall seen from y = 4000, 3900 deep.
   */
  const slanted = (extra: Record<string, unknown>[]) => {
    const doc = add(createDocument('Slanted'), wall('n', [0, 0], [6000, 0]), wall('e', [6000, 0], [6000, 5000]), wall('s', [6000, 5000], [0, 5000]), wall('w', [0, 5000], [0, 0]), wall('x', [2000, 2000], [3500, 3500]), ...extra)
    const face = wallFaceAt(doc, 'page_1', { x: 3000, y: 300 }, 500)!
    const line = viewOfFace(face, 3900)
    return add(doc, ...viewNodes({ id: 'v', ...line, x: line.a.x, y: 10000 }))
  }
  const cabinet = (id: string, x: number, y: number) => ({ type: 'parametric', id, kind: 'arch.fridge', props: {}, x, y })

  it('hides what is behind it and not what is in front of it', () => {
    // A fridge behind the wall at an angle (between it and the top wall), and one in front of it.
    const doc = slanted([cabinet('behind', 2600, 1000), cabinet('front', 2200, 3600)])
    const all = boxes(drawn(doc))
    const [one, two] = all.filter(standing).sort((p, q) => p.minX - q.minX)
    const [way] = ways(all)
    // Both overlap the wall at an angle in the view; the one behind is covered, the one in front is drawn over it.
    expect(way.minX < one.maxX && way.maxX > one.minX).toBe(true)
    const behind = [one, two].find((b) => b.index < way.index)!
    const front = [one, two].find((b) => b.index > way.index)!
    expect(behind).toBeDefined()
    expect(front).toBeDefined()
    expect(hidden(all, behind)).toBe(true)
    expect(hidden(all, front)).toBe(false)
  })

  it('draws, of two things one behind the other, the further first', () => {
    const doc = slanted([cabinet('far', 4500, 300), cabinet('near', 4600, 1500)])
    const [first, second] = boxes(drawn(doc)).filter(standing)
    // The far one, against the top wall, starts 100 further left: it is painted first.
    expect(first.minX).toBeLessThan(second.minX)
  })

  it('hides a wall at an angle behind a wall nearer, parallel to the line', () => {
    // A short wall across, in front of the one at an angle, at y = 3800.
    const doc = slanted([wall('stub', [1500, 3800], [4000, 3800])])
    const all = boxes(drawn(doc))
    // The short wall, 100 behind the line, is a face seen, from 1500 to 4000; the wall at an angle is behind it, from about 1930.
    const stub = all.find((b) => seenSurface(b) && Math.abs(b.minX - 1500) < 5 && Math.abs(b.maxX - 4000) < 5)!
    const way = ways(all).find((b) => b.minX > 1800 && b.minX < 2100)!
    expect(stub).toBeDefined()
    expect(way).toBeDefined()
    expect(stub.index).toBeGreaterThan(way.index)
    expect(hidden(all, way)).toBe(true)
  })
})
