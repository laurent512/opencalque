import { afterEach, describe, expect, it } from 'vitest'
import { applyEdit, applyOps, buildScene, createDocument, Registry, setProfiling, takeMeasures, type Document, type Op } from '../src'

/*
 * A scene built again after an edit keeps from the one before the items that did not change and
 * are drawn from nothing that changed (`keepsItem`), so that a drag redraws what it moves; and what
 * the app does is measured while profiling is on (`perf.ts`).
 */
const registry = new Registry().use({
  id: 'test.house',
  name: 'House',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({ kind: 'test.door', label: 'Door', params: [], opening: () => ({ from: 0, to: 900 }), build: () => [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: 900, y: 0 }] }] })
  },
})

const plan = (): Document =>
  applyOps(
    createDocument('Plan'),
    [
      { type: 'group', id: 'sofa', name: 'Sofa' },
      { type: 'rect', id: 'seat', parent: 'sofa', x: 0, y: 0, width: 2000, height: 900 },
      { type: 'line', id: 'line', a: { x: 0, y: 3000 }, b: { x: 1000, y: 3000 } },
      { type: 'wall', id: 'wall', a: { x: 0, y: 5000 }, b: { x: 5000, y: 5000 }, thickness: 200 },
      { type: 'parametric', id: 'door', kind: 'test.door', props: {}, x: 1000, y: 5000 },
    ].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })),
  )
const item = (scene: ReturnType<typeof buildScene>, id: string) => scene.find((i) => i.id === id)

describe('a scene built again', () => {
  it('keeps what an edit left alone, and draws again what it changed', () => {
    const doc = plan()
    const scene = buildScene(doc, 'page_1', registry)
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'line', patch: { b: { x: 2000, y: 3000 } } }], registry).doc
    const next = buildScene(moved, 'page_1', registry, { doc, scene })
    expect(item(next, 'sofa')).toBe(item(scene, 'sofa'))
    expect(item(next, 'line')).not.toBe(item(scene, 'line'))
    // The wall and the door too: a line is nothing they are drawn from.
    expect(item(next, 'wall')).toBe(item(scene, 'wall'))
    expect(item(next, 'door')).toBe(item(scene, 'door'))
  })

  it('draws again what is drawn from what changed: a door, when its wall moved', () => {
    const doc = plan()
    const scene = buildScene(doc, 'page_1', registry)
    const moved = applyEdit(doc, [{ op: 'update_node', id: 'wall', patch: { thickness: 300 } }], registry).doc
    const next = buildScene(moved, 'page_1', registry, { doc, scene })
    expect(item(next, 'wall')).not.toBe(item(scene, 'wall'))
    expect(item(next, 'door')).not.toBe(item(scene, 'door'))
    expect(item(next, 'sofa')).toBe(item(scene, 'sofa'))
  })

  it('draws a group again when what it holds changed', () => {
    const doc = plan()
    const scene = buildScene(doc, 'page_1', registry)
    const wider = applyEdit(doc, [{ op: 'update_node', id: 'seat', patch: { width: 2400 } }], registry).doc
    const next = buildScene(wider, 'page_1', registry, { doc, scene })
    expect(item(next, 'sofa')).not.toBe(item(scene, 'sofa'))
    expect(item(next, 'sofa')!.bounds!.maxX).toBe(2400)
  })

  it('draws everything again when the drawing’s layers or settings changed', () => {
    const doc = plan()
    const scene = buildScene(doc, 'page_1', registry)
    const recoloured = { ...doc, layers: { ...doc.layers } }
    expect(item(buildScene(recoloured, 'page_1', registry, { doc, scene }), 'sofa')).not.toBe(item(scene, 'sofa'))
  })
})

describe('the profiler', () => {
  afterEach(() => setProfiling(false))

  it('measures nothing while off, and what ran while on, nested', () => {
    applyEdit(plan(), [{ op: 'update_node', id: 'line', patch: { b: { x: 2000, y: 3000 } } }], registry)
    expect(takeMeasures().spans).toEqual([])
    setProfiling(true)
    const doc = plan()
    applyEdit(doc, [{ op: 'update_node', id: 'line', patch: { b: { x: 2000, y: 3000 } } }], registry)
    buildScene(doc, 'page_1', registry)
    const { spans } = takeMeasures()
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining(['edit', 'edit: apply operations', 'scene', 'draw group', 'draw wall']))
    expect(spans.find((s) => s.name === 'edit: apply operations')!.depth).toBeGreaterThan(spans.find((s) => s.name === 'edit')!.depth)
    // Taken, they are gone.
    expect(takeMeasures().spans).toEqual([])
  })
})
