import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import {
  applyOps,
  boundsOfPoints,
  createDocument,
  Registry,
  roomAt,
  snapOpeningToWall,
  transformOps,
  wallEdgeLines,
  flipWallOps,
  wallJustifyOps,
  wallPolygons,
  wallThicknessOps,
  type Document,
  type NodeOf,
  type Op,
} from '../src'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })
const get = (doc: Document, id: string) => doc.nodes[id] as NodeOf<'wall'>
const box = (doc: Document, id: string) => boundsOfPoints(wallPolygons(get(doc, id), doc, registry).flat())!
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6

// A 4 × 3 m room drawn clockwise on screen (Y down), so that the inside is on the right of every
// wall. Drawn by their inner faces, the walls have their right face on the line and lie to its left.
const room = (justify: 'left' | 'right', thickness = 200) =>
  applyOps(createDocument(), [
    wall('top', 0, 0, 4000, 0, { justify, thickness }),
    wall('right', 4000, 0, 4000, 3000, { justify, thickness }),
    wall('bottom', 4000, 3000, 0, 3000, { justify, thickness }),
    wall('left', 0, 3000, 0, 0, { justify, thickness }),
  ])

describe('a wall drawn by one of its faces', () => {
  it('lies all to the other side of its line', () => {
    // Running east, its left is north (smaller y): drawn by its left face, it lies south of its line.
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0, { justify: 'left' }), wall('v', 0, 1000, 4000, 1000, { justify: 'right' })])
    expect(box(doc, 'w')).toMatchObject({ minY: 0, maxY: 200 })
    expect(box(doc, 'v')).toMatchObject({ minY: 800, maxY: 1000 })
  })

  it('meets the next one at its line: inner faces meet at the corner, outer faces mitred', () => {
    const doc = room('right')
    // The outer corner is a thickness off both lines; the inner one is the corner itself.
    const top = wallPolygons(get(doc, 'top'), doc, registry)[0]
    expect(top.some((p) => near(p, { x: -200, y: -200 }))).toBe(true)
    expect(top.some((p) => near(p, { x: 0, y: 0 }))).toBe(true)
    expect(box(doc, 'top')).toMatchObject({ minX: -200, maxX: 4200, minY: -200, maxY: 0 })
  })

  it('bounds a room by the faces it is drawn by', () => {
    expect(roomAt(room('right'), 'page_1', { x: 2000, y: 1500 })!.area).toBeCloseTo(4000 * 3000)
    // Drawn by their outer faces, the walls take their whole thickness from the room.
    expect(roomAt(room('left'), 'page_1', { x: 2000, y: 1500 })!.area).toBeCloseTo(3600 * 2600)
  })

  it('keeps a face flush with the next wall of another thickness', () => {
    const doc = applyOps(createDocument(), [wall('thick', 0, 0, 3000, 0, { justify: 'right', thickness: 300 }), wall('thin', 3000, 0, 6000, 0, { justify: 'right', thickness: 100 })])
    expect(box(doc, 'thick')).toMatchObject({ minY: -300, maxY: 0, maxX: 3000 })
    expect(box(doc, 'thin')).toMatchObject({ minY: -100, maxY: 0, minX: 3000 })
  })

  it('grows away from its line when it gets thicker', () => {
    const doc = applyOps(room('right'), [{ op: 'update_node', id: 'top', patch: { thickness: 350 } }])
    expect(box(doc, 'top')).toMatchObject({ minY: -350, maxY: 0 })
    expect(roomAt(doc, 'page_1', { x: 2000, y: 1500 })!.area).toBeCloseTo(4000 * 3000)
  })

  it('moves nothing when the face it is not drawn by is dragged', () => {
    const doc = room('right')
    // The outer face of the top wall is its left.
    const ops = wallThicknessOps(doc, get(doc, 'top'), 400, 'left', registry)!
    expect(ops).toEqual([{ op: 'update_node', id: 'top', patch: { thickness: 400 } }])
  })

  it('moves its line, and the corners on it, when the face it is drawn by is dragged', () => {
    const doc = room('right')
    // The inner face of the top wall, its right, goes 100 mm into the room: its line goes with it.
    const after = applyOps(doc, wallThicknessOps(doc, get(doc, 'top'), 300, 'right', registry)!)
    expect(get(after, 'top')).toMatchObject({ a: { x: 0, y: 100 }, b: { x: 4000, y: 100 }, thickness: 300 })
    expect(get(after, 'left').b).toEqual({ x: 0, y: 100 })
    expect(box(after, 'top')).toMatchObject({ minY: -200, maxY: 100 })
  })

  it('leaves a wall that carries straight on where it is, rather than turning it', () => {
    const doc = applyOps(createDocument(), [wall('one', 0, 0, 3000, 0), wall('two', 3000, 0, 6000, 0)])
    const after = applyOps(doc, wallThicknessOps(doc, get(doc, 'one'), 400, 'left', registry)!)
    expect(get(after, 'two')).toEqual(get(doc, 'two'))
    // The thicker wall's right face still carries on from the other's.
    expect(get(after, 'one')).toMatchObject({ a: { x: 0, y: -100 }, b: { x: 3000, y: -100 } })
    expect(box(after, 'one').maxY).toBeCloseTo(box(after, 'two').maxY)
  })

  it('takes doors and windows in the middle of its thickness', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0, { justify: 'left' })])
    const at = snapOpeningToWall(doc, 'page_1', registry, { kind: 'arch.door', props: { width: 900 } }, { x: 2000, y: 150 }, 50, 1)!
    // A door's insertion point is at one end of its opening: what matters is that it is across the middle of the wall.
    expect(at.y).toBeCloseTo(100)
  })

  it('stays where it is, with its doors, when drawn by another line: its line goes onto that face', () => {
    const start = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0), add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900 }, x: 1000, y: 0, rotation: 0 })])
    const doc = applyOps(start, wallJustifyOps(start, get(start, 'w'), 'left', registry))
    // Running east, its left face is north of its middle line, 100 mm up.
    expect(get(doc, 'w')).toMatchObject({ a: { x: 0, y: -100 }, b: { x: 4000, y: -100 }, justify: 'left' })
    expect(doc.nodes.door).toMatchObject({ x: 1000, y: 0 })
    expect(box(doc, 'w')).toMatchObject({ minY: -100, maxY: 100 })
    // Made thicker then, it grows away from that face.
    const thicker = applyOps(doc, [{ op: 'update_node', id: 'w', patch: { thickness: 300 } }])
    expect(box(thicker, 'w')).toMatchObject({ minY: -100, maxY: 200 })
    // And back to its middle, with nothing left saying otherwise.
    const back = applyOps(doc, wallJustifyOps(doc, get(doc, 'w'), 'center', registry))
    expect(get(back, 'w')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
    expect(get(back, 'w').justify).toBeUndefined()
    expect(back.nodes.door).toMatchObject({ x: 1000, y: 0 })
  })

  it('flips over its line: its corners stay, it lies on the other side with its doors, the look of the face on the line kept', () => {
    const start = applyOps(createDocument(), [
      wall('w', 0, 0, 4000, 0, { justify: 'left', edges: { left: { stroke: '#ff0000' }, a: { show: true } } }),
      // Running east by its left face, the wall lies south of its line: its door in the middle of it.
      add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900 }, x: 1000, y: 100, rotation: 0 }),
    ])
    expect(box(start, 'w')).toMatchObject({ minY: 0, maxY: 200 })
    const doc = applyOps(start, flipWallOps(start, get(start, 'w'), registry))
    expect(get(doc, 'w')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, justify: 'right', edges: { right: { stroke: '#ff0000' }, a: { show: true } } })
    expect(get(doc, 'w').edges?.left).toBeUndefined()
    expect(box(doc, 'w')).toMatchObject({ minY: -200, maxY: 0 })
    expect(doc.nodes.door).toMatchObject({ x: 1000, y: -100 })
    // Flipped again, it is as it was.
    const back = applyOps(doc, flipWallOps(doc, get(doc, 'w'), registry))
    expect(back.nodes.w).toEqual(start.nodes.w)
    expect(back.nodes.door).toMatchObject({ x: 1000, y: 100 })
    // A wall drawn by its middle lies on both sides of its line: there is nothing to flip.
    const middle = applyOps(createDocument(), [wall('m', 0, 0, 4000, 0)])
    expect(flipWallOps(middle, get(middle, 'm'), registry)).toEqual([])
  })

  it('takes the walls joined to it along, so that a room drawn by the middles of its walls, drawn by their inner faces after, is the same room', () => {
    const middles = applyOps(createDocument(), [
      wall('top', 0, 0, 4000, 0),
      wall('right', 4000, 0, 4000, 3000),
      wall('bottom', 4000, 3000, 0, 3000),
      wall('left', 0, 3000, 0, 0),
    ])
    let doc = middles
    for (const id of ['top', 'right', 'bottom', 'left']) doc = applyOps(doc, wallJustifyOps(doc, get(doc, id), 'right', registry))
    // Every wall is where it was, its corners now its inner corners, still shared.
    for (const id of ['top', 'right', 'bottom', 'left']) expect(box(doc, id)).toEqual(box(middles, id))
    expect(get(doc, 'top')).toMatchObject({ a: { x: 100, y: 100 }, b: { x: 3900, y: 100 }, justify: 'right' })
    expect(get(doc, 'left').b).toEqual(get(doc, 'top').a)
    expect(roomAt(doc, 'page_1', { x: 2000, y: 1500 })!.area).toBeCloseTo(roomAt(middles, 'page_1', { x: 2000, y: 1500 })!.area)
  })

  it('is drawn by the same face, on the other hand, once mirrored', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0, { justify: 'left', edges: { left: { show: false } } })])
    const mirrored = applyOps(doc, transformOps(doc, [get(doc, 'w')], { pivot: { x: 2000, y: 0 }, mirror: true }, registry))
    // Running west now, the face that was on its left is on its right; the wall still lies south of its line.
    expect(get(mirrored, 'w')).toMatchObject({ justify: 'right', edges: { right: { show: false } } })
    expect(box(mirrored, 'w')).toMatchObject({ minY: 0, maxY: 200 })
  })

  it('tells its faces apart for their own looks, the one on its line included', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0, { justify: 'left' })])
    const left = wallEdgeLines(get(doc, 'w'), doc, registry, 'left').flat()
    const right = wallEdgeLines(get(doc, 'w'), doc, registry, 'right').flat()
    expect(left.length).toBeGreaterThan(0)
    expect(left.every((p) => Math.abs(p.y) < 1e-6)).toBe(true)
    expect(right.every((p) => Math.abs(p.y - 200) < 1e-6)).toBe(true)
  })
})
