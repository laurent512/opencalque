import { describe, expect, it } from 'vitest'
import { annotationCurve, applyOps, buildScene, createDocument, kindOf, Registry, toSVG, transformOps, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const note = (extra: Record<string, unknown> = {}) => applyOps(createDocument(), [add({ type: 'annotation', id: 'note', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, text: 'Oak floor', ...extra })])
const prims = (doc: Document) => buildScene(doc, 'page_1', registry)[0].prims as any[]

describe('annotation', () => {
  it('draws a curved leader from the tip to the text, an arrow at the tip and nothing at the text by default', () => {
    const drawn = prims(note())
    const leader = drawn[0]
    expect(leader.points[0]).toEqual({ x: 0, y: 0 })
    expect(leader.points.at(-1)).toEqual({ x: 2000, y: 0 })
    // It bows away from the straight line, by a tenth of its length at the middle (half the bend of 0.2).
    expect(Math.abs(leader.points[10].y)).toBeCloseTo(200)
    expect(drawn.filter((p) => p.kind === 'path' && p.closed)).toHaveLength(1)
    expect(drawn.at(-1)).toMatchObject({ kind: 'text', text: 'Oak floor', align: 'left' })
  })

  it('is straight when its bend is 0, and takes the ends it is given', () => {
    const drawn = prims(note({ bend: 0, startMarker: 'dot', endMarker: 'open-arrow' }))
    expect(drawn[0].points).toHaveLength(2)
    expect(drawn.map((p) => p.kind)).toEqual(['path', 'ellipse', 'path', 'text'])
    expect(prims(note({ startMarker: 'none' })).map((p) => p.kind)).toEqual(['path', 'text'])
  })

  it('writes its text away from the tip: ending at the point when that is to the left of the tip', () => {
    const drawn = prims(note({ b: { x: -2000, y: 0 } }))
    expect(drawn.at(-1)).toMatchObject({ align: 'right' })
    expect(drawn.at(-1).x).toBeLessThan(-2000)
    expect(toSVG(note({ b: { x: -2000, y: 0 } }), 'page_1', registry)).toContain('text-anchor="end"')
  })

  it('is still an arrow when it has no words', () => {
    expect(prims(note({ text: '' })).map((p) => p.kind)).toEqual(['path', 'path'])
  })

  it('is bent by dragging the middle of its leader', () => {
    const doc = note()
    const kind = kindOf(doc.nodes.note) as any
    expect(kind.handles(doc.nodes.note)).toHaveLength(3)
    // Pulled 400 below the straight line: the curve's middle follows, so the bend is 2 × 400 / 2000.
    const bent = applyOps(doc, [{ op: 'update_node', id: 'note', patch: kind.moveHandle(doc.nodes.note, 2, { x: 1000, y: 400 }) }])
    expect((bent.nodes.note as any).bend).toBe(0.4)
    expect(annotationCurve(bent.nodes.note as any)[10]).toEqual({ x: 1000, y: 400 })
    const straight = applyOps(doc, [{ op: 'update_node', id: 'note', patch: kind.moveHandle(doc.nodes.note, 2, { x: 1000, y: 0 }) }])
    expect(annotationCurve(straight.nodes.note as any)).toHaveLength(2)
  })

  it('bows the other way when mirrored, and scales its text', () => {
    const doc = note()
    const mirrored = applyOps(doc, transformOps(doc, [doc.nodes.note], { pivot: { x: 0, y: 0 }, mirror: true }, registry))
    expect(mirrored.nodes.note).toMatchObject({ b: { x: -2000, y: 0 }, bend: -0.2 })
    const doubled = applyOps(doc, transformOps(doc, [doc.nodes.note], { pivot: { x: 0, y: 0 }, scale: 2 }, registry))
    expect(doubled.nodes.note).toMatchObject({ b: { x: 4000, y: 0 }, size: 400 })
  })
})
