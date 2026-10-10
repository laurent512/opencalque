import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildScene,
  clipSegment,
  cloneOps,
  createDocument,
  hitTest,
  moveOps,
  parseDocument,
  Registry,
  sceneBounds,
  serializeDocument,
  toDXF,
  toSVG,
  transformOps,
  type Document,
  type Extension,
  type Op,
} from '../src'

/** An extension with a modifier that pushes everything 1000 to the right, to see the order modifiers run in. */
const shifting: Extension = {
  id: 'test.shift',
  name: 'Shift',
  version: '1',
  activate: (api) =>
    api.registerModifier({
      type: 'test.shift',
      label: 'Shift',
      params: [{ key: 'by', label: 'By', type: 'number', default: 1000 }],
      apply: (prims, params) => prims.map((p) => (p.kind === 'path' ? { ...p, points: p.points.map((q) => ({ x: q.x + params.by, y: q.y })) } : p)),
    }),
}
const registry = new Registry().use(shifting)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const crop = (x: number, y: number, width: number, height: number) => ({ type: 'crop', frame: { x, y }, params: { width, height } })
const scene = (doc: Document) => buildScene(doc, 'page_1', registry)
const node = (doc: Document, id: string) => doc.nodes[id] as any

// A line from 0 to 4000, shown only between 1000 and 2000.
const base = applyOps(createDocument(), [add({ type: 'line', id: 'line', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, modifiers: [crop(1000, -500, 1000, 1000)] })])

describe('modifiers', () => {
  it('leave the node as it is and change only what is drawn', () => {
    expect(node(base, 'line')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
    const [item] = scene(base)
    expect(item.prims[0].clip).toHaveLength(1)
    // What is selected and framed is the part that shows.
    expect(sceneBounds(scene(base))).toMatchObject({ minX: 1000, maxX: 2000 })
  })

  it('make the hidden part impossible to click', () => {
    expect(hitTest(scene(base), { x: 1500, y: 0 }, 10)?.id).toBe('line')
    expect(hitTest(scene(base), { x: 3000, y: 0 }, 10)).toBeNull()
  })

  it('survive saving and opening, including kinds this version does not know', () => {
    const unknown = applyOps(base, [{ op: 'update_node', id: 'line', patch: { modifiers: [{ type: 'from.the.future', params: { amount: 3 } }, crop(0, -500, 500, 1000)] } }])
    const reopened = parseDocument(JSON.parse(serializeDocument(unknown)))
    expect(node(reopened, 'line').modifiers).toEqual(node(unknown, 'line').modifiers)
    // The unknown one is skipped; the crop after it still applies.
    expect(sceneBounds(scene(reopened))).toMatchObject({ minX: 0, maxX: 500 })
  })

  it('can be switched off without being removed', () => {
    const off = applyOps(base, [{ op: 'update_node', id: 'line', patch: { modifiers: [{ ...crop(1000, -500, 1000, 1000), enabled: false }] } }])
    expect(sceneBounds(scene(off))).toMatchObject({ minX: 0, maxX: 4000 })
  })

  it('apply in the order of the list, each to the result of the one before', () => {
    const shift = { type: 'test.shift' }
    const window = crop(1000, -500, 1000, 1000)
    const drawn = (modifiers: unknown[]) => scene(applyOps(base, [{ op: 'update_node', id: 'line', patch: { modifiers } }]))[0].prims[0] as any
    // Cropped then shifted: the line moves, the window it is seen through does not.
    const cropFirst = drawn([window, shift])
    expect(cropFirst.points[0].x).toBe(1000)
    expect(cropFirst.clip[0][0].x).toBe(1000)
    // Two crops leave what is inside both.
    const twice = applyOps(base, [{ op: 'update_node', id: 'line', patch: { modifiers: [window, crop(1500, -500, 2000, 1000)] } }])
    expect(sceneBounds(scene(twice))).toMatchObject({ minX: 1500, maxX: 2000 })
    expect(hitTest(scene(twice), { x: 1200, y: 0 }, 10)).toBeNull()
  })

  it('on a group apply to everything in it, after the modifiers of what is inside', () => {
    const grouped = applyOps(createDocument(), [
      add({ type: 'group', id: 'g', modifiers: [crop(0, -500, 3000, 1000)] }),
      add({ type: 'line', id: 'in', parent: 'g', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, modifiers: [crop(1000, -500, 5000, 1000)] }),
    ])
    expect(sceneBounds(scene(grouped))).toMatchObject({ minX: 1000, maxX: 3000 })
  })

  it('go with the node when it is moved, copied, turned or scaled', () => {
    const moved = applyOps(base, moveOps(base, base.nodes.line, { x: 500, y: 0 }))
    expect(node(moved, 'line').modifiers[0].frame).toMatchObject({ x: 1500, y: -500 })
    expect(sceneBounds(scene(moved))).toMatchObject({ minX: 1500, maxX: 2500 })

    const copy = cloneOps(base, 'line', { x: 0, y: 2000 })
    const copied = applyOps(base, copy.ops)
    expect(node(copied, copy.id).modifiers[0].frame).toMatchObject({ x: 1000, y: 1500 })

    const doubled = applyOps(base, transformOps(base, [base.nodes.line], { pivot: { x: 0, y: 0 }, scale: 2 }, registry))
    expect(sceneBounds(scene(doubled))).toMatchObject({ minX: 2000, maxX: 4000 })

    const turned = applyOps(base, transformOps(base, [base.nodes.line], { pivot: { x: 0, y: 0 }, rotation: 90 }, registry))
    const shown = sceneBounds(scene(turned))!
    expect([Math.round(shown.minY), Math.round(shown.maxY)]).toEqual([1000, 2000])
  })

  it('are honoured by the SVG export and cut into the DXF export', () => {
    const svg = toSVG(base, 'page_1', registry)
    expect(svg).toContain('<clipPath id="clip1">')
    expect(svg).toContain('clip-path="url(#clip1)"')
    const dxf = toDXF(base, 'page_1', registry).split('\n')
    const at = dxf.indexOf('LINE')
    // The one line runs from x 1000 to x 2000.
    expect(dxf.slice(at, at + 11).filter((_, i) => i === 4 || i === 8)).toEqual(['1000', '2000'])
  })

  it('cuts a segment to the part inside a convex outline, whichever way round it is listed', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    for (const outline of [square, [...square].reverse()]) {
      expect(clipSegment({ x: -5, y: 5 }, { x: 20, y: 5 }, outline)).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }])
      expect(clipSegment({ x: -5, y: 20 }, { x: 20, y: 20 }, outline)).toBeNull()
      expect(clipSegment({ x: 2, y: 2 }, { x: 8, y: 8 }, outline)).toEqual([{ x: 2, y: 2 }, { x: 8, y: 8 }])
    }
  })

  it('draws the pattern of a fill inside each closed shape, cut to it, and leaves the shape as it was', () => {
    const square = (style: Record<string, unknown>) => applyOps(createDocument(), [add({ type: 'rect', id: 'r', x: 0, y: 0, width: 1000, height: 1000, style })])
    const prims = (doc: ReturnType<typeof square>) => buildScene(doc, 'page_1', registry)[0].prims
    const plain = prims(square({ fill: '#ffffff' }))
    expect(plain).toHaveLength(1)
    // Lines a hundred apart, turned 45 degrees: the square itself, then its hatching.
    const lined = prims(square({ fill: '#ffffff', pattern: { kind: 'Lines' } }))
    expect(lined[0]).toMatchObject({ closed: true, fill: '#ffffff' })
    expect(lined.length).toBeGreaterThan(10)
    expect(lined.slice(1).every((p) => p.kind === 'path' && !p.closed && p.clip?.length === 1 && p.own)).toBe(true)
    // A wider spacing draws fewer strokes; a pattern nobody knows, or 'None', draws none.
    expect(prims(square({ pattern: { kind: 'Lines', spacing: 400 } })).length).toBeLessThan(lined.length)
    expect(prims(square({ pattern: { kind: 'None' } }))).toHaveLength(1)
    expect(prims(square({ pattern: { kind: 'From the future' } }))).toHaveLength(1)
    for (const kind of ['Cross', 'Planks', 'Tiles', 'Dots', 'Zigzag']) expect(prims(square({ pattern: { kind } })).length).toBeGreaterThan(5)
    // Its strokes take the colour given, or a soft grey.
    expect(prims(square({ pattern: { kind: 'Lines', stroke: '#b91c1c' } }))[1]).toMatchObject({ stroke: '#b91c1c' })
  })
})