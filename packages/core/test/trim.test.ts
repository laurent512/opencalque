import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, trimOps, trimPlace, wallEndsAt, type Document, type Op } from '../src'

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })
const trimmed = (doc: Document, id: string, x: number, y: number) => {
  const place = trimPlace(doc, doc.nodes[id], { x, y })
  return place && applyOps(doc, trimOps(doc.nodes[id], place, 'new')!)
}

// A wall running across two others, sticking out past both.
const crossed = applyOps(createDocument(), [wall('long', -1000, 0, 7000, 0), wall('one', 0, -2000, 0, 2000), wall('two', 5000, -2000, 5000, 2000)])

describe('trimming', () => {
  it('takes away the stretch under the pointer, from an end to the first wall crossing it', () => {
    const place = trimPlace(crossed, crossed.nodes.long, { x: -500, y: 30 })!
    expect(place).toMatchObject({ from: 0, to: 1000, length: 8000 })
    expect(place.piece[0]).toEqual({ x: -1000, y: 0 })
    const doc = trimmed(crossed, 'long', -500, 30)!
    // What is left ends on the other wall's line: a T, cut along its face as drawn.
    expect(doc.nodes.long).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 7000, y: 0 } })
    expect(wallEndsAt(doc, 'page_1', { x: 0, y: 0 })).toHaveLength(1)
  })

  it('takes a stretch between two crossings out of the middle, leaving two walls', () => {
    const doc = trimmed(crossed, 'long', 2500, 0)!
    expect(doc.nodes.long).toMatchObject({ a: { x: -1000, y: 0 }, b: { x: 0, y: 0 } })
    expect(doc.nodes.new).toMatchObject({ type: 'wall', a: { x: 5000, y: 0 }, b: { x: 7000, y: 0 }, thickness: 200 })
  })

  it('trims a line against the faces of a wall, and a polyline against a line', () => {
    const doc = applyOps(createDocument(), [
      wall('w', 0, -2000, 0, 2000),
      add({ type: 'line', id: 'l', a: { x: -1000, y: 0 }, b: { x: 1000, y: 0 } }),
      add({ type: 'polyline', id: 'p', points: [{ x: -1000, y: 500 }, { x: 1000, y: 500 }, { x: 1000, y: 1500 }] }),
      add({ type: 'line', id: 'cut', a: { x: 500, y: 0 }, b: { x: 500, y: 2000 } }),
    ])
    // The line is cut by the wall's faces, at -100 and 100, and by the other line at 500.
    expect(trimPlace(doc, doc.nodes.l, { x: 300, y: 0 })).toMatchObject({ from: 1100, to: 1500 })
    const line = trimmed(doc, 'l', -500, 0)!
    expect(line.nodes.l).toMatchObject({ a: { x: -100, y: 0 }, b: { x: 1000, y: 0 } })
    // Between the wall's far face and the line, the polyline loses that stretch and is left in two.
    const poly = trimmed(doc, 'p', 300, 500)!
    expect((poly.nodes.p as any).points).toEqual([{ x: -1000, y: 500 }, { x: 100, y: 500 }])
    expect((poly.nodes.new as any).points).toEqual([{ x: 500, y: 500 }, { x: 1000, y: 500 }, { x: 1000, y: 1500 }])
    // Past the last crossing, it loses all the rest, round its corner.
    expect((trimmed(doc, 'p', 1000, 1000)!.nodes.p as any).points).toEqual([{ x: -1000, y: 500 }, { x: 500, y: 500 }])
  })

  it('leaves alone what nothing crosses', () => {
    const doc = applyOps(createDocument(), [wall('alone', 0, 0, 4000, 0)])
    expect(trimPlace(doc, doc.nodes.alone, { x: 2000, y: 0 })).toBeNull()
  })
})
