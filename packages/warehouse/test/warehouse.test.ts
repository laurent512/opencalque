import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument } from '@opencalque/core'
import { bundledExtensionFiles, bundledExtensions, standardRegistry } from '../src'

describe('the warehouse', () => {
  it('reads every extension in its folder', () => {
    const files = readdirSync(join(import.meta.dirname, '../extensions')).filter((file) => file.endsWith('.json'))
    expect(bundledExtensionFiles().sort()).toEqual(files.sort())
    expect(bundledExtensions()).toHaveLength(files.length)
  })

  it('draws the objects of the bundled extensions, not placeholders, with the standard registry', () => {
    const registry = standardRegistry()
    const table = registry.parametric.get('furn.table')
    expect(table).toBeDefined()
    const doc = applyOps(createDocument(), [{ op: 'add_node', node: { id: 't', type: 'parametric', parent: 'page_1', kind: 'furn.table', props: {}, x: 0, y: 0 } }])
    const [item] = buildScene(doc, 'page_1', registry)
    // A placeholder is a box with the kind's name written in it; a table is drawn with its chairs.
    expect(item.prims.some((prim) => prim.kind === 'text')).toBe(false)
    expect(item.prims.length).toBeGreaterThan(4)
  })
})

describe('the curtain', () => {
  const registry = standardRegistry()
  const curtain = registry.parametric.get('furn.curtain')!
  /** Where its fabric reaches along the rail on the plan: the waves, each a path of more than two points. */
  const fabric = (props: Record<string, unknown>) => {
    const waves = curtain.build(registry.resolveProps(curtain, props), {}).flatMap((prim) => (prim.kind === 'path' && prim.points.length > 2 ? [prim.points.map((p) => Math.round(p.x))] : []))
    return waves.map((xs) => [Math.min(...xs), Math.max(...xs)])
  }
  const reach = (spans: number[][]) => [Math.min(...spans.map(([a]) => a)), Math.max(...spans.map(([, b]) => b))]

  it('covers its whole rail when shut, one panel or two', () => {
    expect(reach(fabric({ length: 2000, opened: 0 }))).toEqual([0, 2000])
    expect(reach(fabric({ length: 2000, opened: 0, double: false }))).toEqual([0, 2000])
  })

  it('opened, gathers each panel at its end of the rail, as far as said', () => {
    // Two panels fully open: each bunched into 15 % of its half, at either end.
    const open = fabric({ length: 2000, opened: 100 })
    expect(reach(open.filter(([a]) => a < 1000))).toEqual([0, 150])
    expect(reach(open.filter(([a]) => a >= 1000))).toEqual([1850, 2000])
    // One panel half open, gathered towards its start: mirrored, towards the other end.
    expect(reach(fabric({ length: 2000, opened: 50, double: false }))).toEqual([0, 1150])
    // What is asked past shut or fully open is taken as one of them.
    expect(fabric({ length: 2000, opened: 250 })).toEqual(open)
  })

  it('keeps as many folds open as shut, deeper as they gather', () => {
    const depth = (props: Record<string, unknown>) => {
      const ys = curtain.build(registry.resolveProps(curtain, props), {}).flatMap((prim) => (prim.kind === 'path' && prim.points.length > 2 ? prim.points.map((p) => p.y) : []))
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(fabric({ opened: 100 })).toHaveLength(fabric({ opened: 0 }).length)
    expect(depth({ opened: 100 })).toBeGreaterThan(depth({ opened: 0 }) * 1.5)
  })
})
