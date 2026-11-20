import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, buildScene, createDocument, hitTest, itemsTouching, Registry, type Op } from '../src'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op

// A wall of 200 mm along X, and a door of 900 mm in it from x = 600, drawn as nothing but the hole.
const plan = (type: string) =>
  applyOps(createDocument(), [
    add({ type: 'wall', id: 'wall', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200 }),
    add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900, type }, x: 600, y: 0, rotation: 0 }),
  ])

describe('picking a door or a window', () => {
  it('takes it anywhere in the gap it cuts in its wall, even when it is only a hole', () => {
    const scene = buildScene(plan('Opening only'), 'page_1', registry)
    expect(hitTest(scene, { x: 1050, y: 0 }, 1)?.id).toBe('door')
    expect(hitTest(scene, { x: 700, y: 80 }, 1)?.id).toBe('door')
    // Beside the gap is the wall, and away from the wall nothing.
    expect(hitTest(scene, { x: 300, y: 0 }, 1)?.id).toBe('wall')
    expect(hitTest(scene, { x: 1050, y: 400 }, 1)).toBeNull()
  })

  it('is touched by a rectangle drawn across the gap', () => {
    const scene = buildScene(plan('Opening only'), 'page_1', registry)
    expect(itemsTouching(scene, { minX: 1000, minY: -20, maxX: 1100, maxY: 20 }).map((item) => item.id)).toEqual(['door'])
  })

  it('takes a door that opens in its gap as well as on its leaf', () => {
    const scene = buildScene(plan('Single'), 'page_1', registry)
    expect(hitTest(scene, { x: 1050, y: 0 }, 1)?.id).toBe('door')
  })

  it('takes the group it is in, from outside the group, anywhere in the gap', () => {
    const grouped = applyOps(createDocument(), [
      add({ type: 'group', id: 'outer' }),
      add({ type: 'group', id: 'inner', parent: 'outer' }),
      add({ type: 'wall', id: 'wall', parent: 'inner', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200 }),
      add({ type: 'parametric', id: 'door', parent: 'inner', kind: 'arch.door', props: { width: 900, type: 'Opening only' }, x: 600, y: 0, rotation: 0 }),
    ])
    const scene = buildScene(grouped, 'page_1', registry)
    expect(hitTest(scene, { x: 1050, y: 0 }, 1)?.id).toBe('outer')
    // And inside it, the door itself.
    expect(hitTest(buildScene(grouped, 'inner', registry), { x: 1050, y: 0 }, 1)?.id).toBe('door')
  })

  it('does not reach past the gap when the door stands in no wall', () => {
    const loose = applyOps(createDocument(), [add({ type: 'parametric', id: 'door', kind: 'arch.door', props: { width: 900, type: 'Opening only' }, x: 0, y: 0 })])
    expect(buildScene(loose, 'page_1', registry)[0].area).toBeUndefined()
  })
})
