import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, nodePrimitives, parseDocument, planDimensions, Registry, serializeDocument, type Document, type Op } from '../src'

/*
 * The dimensions a plan draws by itself round its building (`plandimensions`): from its walls each
 * time, the whole of each side or its outer walls piece by piece with their doors and windows.
 */
const registry = new Registry().use({
  id: 'test.house',
  name: 'House',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({ kind: 'test.door', label: 'Door', params: [], opening: () => ({ from: 0, to: 900 }), build: () => [] })
  },
})

/** A room of 5 by 3 m, its walls 200 thick on their lines, a door 900 wide in the bottom wall from 600 along. */
const house = (more: Record<string, unknown> = {}): Document =>
  applyOps(
    createDocument('Plan'),
    [
      { type: 'wall', id: 'top', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200 },
      { type: 'wall', id: 'right', a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 }, thickness: 200 },
      { type: 'wall', id: 'bottom', a: { x: 0, y: 3000 }, b: { x: 5000, y: 3000 }, thickness: 200 },
      { type: 'wall', id: 'left', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200 },
      { type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 600, y: 3000 },
      { type: 'plandimensions', id: 'dims', ...more },
    ].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  )
const dims = (doc: Document) => planDimensions(doc, doc.nodes.dims as never, registry)
const lengths = (list: ReturnType<typeof dims>, where: (d: ReturnType<typeof dims>[number]) => boolean) =>
  list.filter(where).map((d) => Math.round(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)))

describe('the dimensions a plan draws by itself', () => {
  it('give the whole above and on the left, the outer walls piece by piece below and on the right, 800 mm out', () => {
    const list = dims(house())
    // Above: the building from end to end, its line 800 above its top.
    expect(lengths(list, (d) => d.a.y === -100 && d.b.y === -100)).toEqual([5200])
    expect(list.find((d) => d.a.y === -100)!.offset).toBe(-800)
    // On the left, the same, up and down.
    expect(lengths(list, (d) => d.a.x === -100 && d.b.x === -100)).toEqual([3200])
    // Below: up to the door, the door, and the rest.
    expect(lengths(list, (d) => d.a.y === 3100 && d.b.y === 3100)).toEqual([700, 900, 3600])
    expect(list.find((d) => d.a.y === 3100)!.offset).toBe(800)
    // On the right, one wall with nothing in it: one piece.
    expect(lengths(list, (d) => d.a.x === 5100 && d.b.x === 5100)).toEqual([3200])
  })

  it('give a side both rows, the detailed one nearer, or nothing, as they say', () => {
    const list = dims(house({ bottom: 'both', top: 'none', left: 'none', right: 'none' }))
    expect(list.map((d) => d.offset)).toEqual([800, 800, 800, 1400])
    expect(lengths(list, (d) => d.offset === 1400)).toEqual([5200])
  })

  it('are drawn as dimensions, and none while the plan has no wall', () => {
    const doc = house()
    expect(nodePrimitives(doc.nodes.dims, { doc, registry, depth: 0 }).some((p) => p.kind === 'text' && p.text === '900')).toBe(true)
    const bare = applyOps(createDocument('Plan'), [{ op: 'add_node', node: { type: 'plandimensions', id: 'dims', parent: 'page_1' } as never }])
    expect(dims(bare)).toEqual([])
  })

  it('make a drawing of version 7, which reads back as it was', () => {
    const doc = house({ right: 'none' })
    const saved = JSON.parse(serializeDocument(doc))
    expect(saved.version).toBe(7)
    expect(parseDocument(saved).nodes.dims).toEqual(doc.nodes.dims)
    // A drawing without them stays of the version before.
    const without = applyOps(doc, [{ op: 'remove_node', id: 'dims' }])
    expect(JSON.parse(serializeDocument(without)).version).toBeLessThan(7)
  })

  it('refuse a dimension style the drawing does not have', () => {
    expect(() => house({ dimensionStyle: 'nope' })).toThrow(/dimension style/)
  })
})
