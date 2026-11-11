import { describe, expect, it } from 'vitest'
import { applyOps, arcOf, createDocument, extendOps, extendPlace, filletOps, type Document, type NodeOf, type Op } from '../src'

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const line = (id: string, ax: number, ay: number, bx: number, by: number, more: Record<string, unknown> = {}) => add({ type: 'line', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, ...more })
const extended = (doc: Document, id: string, x: number, y: number) => {
  const place = extendPlace(doc, doc.nodes[id], { x, y })
  return place && applyOps(doc, extendOps(doc.nodes[id], place)!)
}
const filleted = (doc: Document, first: string, at1: [number, number], second: string, at2: [number, number], radius: number) => {
  const ops = filletOps(doc.nodes[first] as NodeOf<'line'>, { x: at1[0], y: at1[1] }, doc.nodes[second] as NodeOf<'line'>, { x: at2[0], y: at2[1] }, radius, 'arc')
  return ops && applyOps(doc, ops)
}

describe('extending', () => {
  // A line stopping short of an upright line, a grid line beyond it, and a wall below.
  const doc = applyOps(createDocument(), [
    line('short', 0, 0, 1000, 0),
    line('upright', 3000, -2000, 3000, 2000),
    add({ type: 'gridline', id: 'axis', a: { x: 5000, y: -3000 }, b: { x: 5000, y: 3000 }, label: 'A' }),
    add({ type: 'wall', id: 'w', a: { x: -2000, y: 4000 }, b: { x: 6000, y: 4000 }, thickness: 200 }),
    line('down', 2000, 1000, 2000, 2000),
    add({ type: 'polyline', id: 'p', points: [{ x: -500, y: -1000 }, { x: 0, y: -1000 }, { x: 0, y: -500 }] }),
  ])

  it('runs the end nearer the pointer on to the first thing in its way, and goes on from there', () => {
    expect(extendPlace(doc, doc.nodes.short, { x: 900, y: 0 })).toEqual({ end: 'b', from: { x: 1000, y: 0 }, to: { x: 3000, y: 0 } })
    const once = extended(doc, 'short', 900, 0)!
    expect(once.nodes.short).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } })
    // Touching the upright line now, it goes on to the grid line.
    expect(extended(once, 'short', 2900, 0)!.nodes.short).toMatchObject({ b: { x: 5000, y: 0 } })
  })

  it('stops at the near face of a wall, and leaves alone an end with nothing ahead', () => {
    expect(extended(doc, 'down', 2000, 1900)!.nodes.down).toMatchObject({ a: { x: 2000, y: 1000 }, b: { x: 2000, y: 3900 } })
    // Upwards, nothing crosses its way.
    expect(extendPlace(doc, doc.nodes.down, { x: 2000, y: 1100 })).toBeNull()
  })

  it('extends the last stretch of a polyline, keeping its corners', () => {
    const out = extended(doc, 'p', 0, -600)!
    expect((out.nodes.p as NodeOf<'polyline'>).points).toEqual([{ x: -500, y: -1000 }, { x: 0, y: -1000 }, { x: 0, y: 0 }])
  })

  it('extends a free wall end to the line of the next wall', () => {
    const walls = applyOps(createDocument(), [
      add({ type: 'wall', id: 'a', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, thickness: 200 }),
      add({ type: 'wall', id: 'b', a: { x: 4000, y: -2000 }, b: { x: 4000, y: 2000 }, thickness: 200 }),
    ])
    expect(extended(walls, 'a', 1800, 50)!.nodes.a).toMatchObject({ b: { x: 4000, y: 0 } })
    expect(extendPlace(walls, walls.nodes.a, { x: 200, y: 0 })).toBeNull()
  })
})

describe('filleting', () => {
  // Two lines that do not reach each other, and one that runs past the other.
  const doc = applyOps(createDocument(), [line('across', 0, 0, 3000, 0, { style: { stroke: '#c00' } }), line('up', 4000, 1000, 4000, 3000), line('past', 1000, -1000, 1000, 2000)])

  it('with no radius, carries both lines on to where they cross', () => {
    const out = filleted(doc, 'across', [1500, 0], 'up', [4000, 2000], 0)!
    expect(out.nodes.across).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
    expect(out.nodes.up).toMatchObject({ a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } })
    expect(out.nodes.arc).toBeUndefined()
  })

  it('keeps the part of each line on the side it was clicked, cutting the rest', () => {
    const out = filleted(doc, 'across', [2000, 0], 'past', [1000, 1500], 0)!
    expect(out.nodes.across).toMatchObject({ a: { x: 1000, y: 0 }, b: { x: 3000, y: 0 } })
    expect(out.nodes.past).toMatchObject({ a: { x: 1000, y: 0 }, b: { x: 1000, y: 2000 } })
  })

  it('with a radius, joins them by an arc touching both, in the first line’s look', () => {
    const out = filleted(doc, 'across', [1500, 0], 'up', [4000, 2000], 500)!
    expect(out.nodes.across).toMatchObject({ b: { x: 3500, y: 0 } })
    expect(out.nodes.up).toMatchObject({ a: { x: 4000, y: 500 } })
    const arc = out.nodes.arc as NodeOf<'ellipse'>
    expect(arc).toMatchObject({ type: 'ellipse', cx: 3500, cy: 500, rx: 500, ry: 500, style: { stroke: '#c00' } })
    expect(arcOf(arc)).toBeTruthy()
    // The arc is the quarter between the two lines, not the rest of the circle.
    const sweep = (((arc.to! - arc.from!) % 360) + 360) % 360
    expect(sweep).toBeCloseTo(90)
  })

  it('refuses lines side by side, and a radius the lines are too short for', () => {
    const parallel = applyOps(doc, [line('beside', 0, 500, 3000, 500)])
    expect(filleted(parallel, 'across', [1000, 0], 'beside', [1000, 500], 0)).toBeNull()
    expect(filleted(doc, 'across', [1500, 0], 'up', [4000, 2000], 5000)).toBeNull()
  })
})
