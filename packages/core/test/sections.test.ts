import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, createDocument, drawingGuide, massing, primitiveBounds, Registry, resolveParams, rowsOf, transformOps, variantLabel, variantsOf, type Document, type NodeOf, type Op, type ParamDef, type Primitive } from '../src'

/*
 * A list parameter (`ParamDef` of type 'list'), and the tall unit made of sections one over the
 * other from its plinth up: how they are read, laid out, drawn in elevations and in 3D, scaled,
 * told apart as models, and moved by the line between two.
 */
const registry = new Registry().use(architecture)
const tall = registry.parametric.get('arch.tallunit')!
const sections = tall.params.find((p) => p.key === 'sections')!
const props = (own: Record<string, unknown> = {}) => registry.resolveProps(tall, own)
const front = (own: Record<string, unknown> = {}) => tall.front!(props(own))
const box = (p: Primitive) => {
  const b = primitiveBounds(p)!
  return [Math.round(b.minY), Math.round(b.maxY)]
}
/** The closed shapes drawn at full weight: an oven's and a microwave's outlines, the unit's own. */
const outlines = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.closed && p.strokeWidth === undefined).map(box)
const handles = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.strokeWidth === 2).length
const add = (doc: Document, ...nodes: Record<string, unknown>[]): Document => applyOps(doc, nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))

describe('a list parameter', () => {
  const list: ParamDef = {
    key: 'rows',
    label: 'Rows',
    type: 'list',
    default: [],
    most: 3,
    items: [
      { key: 'type', label: 'Type', type: 'string', default: 'A', options: ['A', 'B'] },
      { key: 'size', label: 'Size', type: 'number', default: 0 },
    ],
  }

  it('keeps its rows that are objects, each completed with its fields, and no more than it says', () => {
    const rows = [{ type: 'B', size: 5 }, 'not a row', { type: 'C' }, null, { size: 'tall' }, { type: 'B' }]
    // Capped first, then what is not a row left out: a file of a million rows is not read through.
    expect(resolveParams([list], { rows }).rows).toEqual([{ type: 'B', size: 5 }, { type: 'A', size: 0 }])
    expect(resolveParams([list], { rows: 'nothing' }).rows).toEqual([])
  })
})

describe('a tall unit of sections', () => {
  const custom = [{ type: 'Drawer', height: 720 }, { type: 'Oven', height: 600 }, { type: 'Open', height: 380 }, { type: 'Filler' }]
  /** The thin closed shapes drawn: doors, a filler's panel, a niche's opening. */
  const thin = (prims: Primitive[]) => prims.filter((p) => p.kind === 'path' && p.closed && p.strokeWidth === 0.5).map(box)

  it('without sections of its own, has those its Contents says, drawn as before: the doors at the top as high as the others leave', () => {
    expect(rowsOf(sections, props())).toEqual([
      { type: 'Door', height: 750 },
      { type: 'Oven', height: 595 },
      { type: 'Microwave', height: 390 },
      { type: 'Door', height: 315 },
    ])
    expect(rowsOf(sections, props({ contents: 'Fridge' })).map((row) => row.type)).toEqual(['Freezer', 'Fridge'])
    // Its oven from 850 to 1445, its microwave over it, its doors up to its top, as it always was.
    expect(outlines(front())).toEqual(expect.arrayContaining([[-1445, -853], [-1835, -1448]]))
    expect(thin(front())).toContainEqual([-2147, -1838])
    expect(front({ sections: rowsOf(sections, props()) })).toEqual(front())
    // Up to the ceiling, its doors at the top go up with it.
    expect(rowsOf(sections, props({ height: 2600 })).at(-1)).toEqual({ type: 'Door', height: 765 })
  })

  it('stacks its sections from the plinth up, each as high as it says, a filler as high as what they leave', () => {
    const prims = front({ sections: custom })
    // The drawer's handle and the oven's; the open niche and the filler have none.
    expect(handles(prims)).toBe(2)
    // The oven from 820 to 1420; the niche, thin, between its sides; the filler from 1800 up to the top.
    expect(outlines(prims)).toContainEqual([-1420, -823])
    expect(thin(prims)).toEqual(expect.arrayContaining([[-1800, -1423], [-2147, -1803]]))
    expect(sections.laid!(props({ sections: custom })).map((row) => row.height)).toEqual([720, 600, 380, 350])
  })

  it('up to the ceiling, grows its filler only: the oven stays at the height of the hand', () => {
    const higher = front({ sections: custom, height: 2600 })
    expect(outlines(higher)).toContainEqual([-1420, -823])
    expect(thin(higher)).toContainEqual([-2597, -1803])
  })

  it('shares what is left among its fillers, wherever they are, and leaves it as a panel at the top when none takes it', () => {
    // A filler under the oven and one over it: 725 each.
    expect(outlines(front({ sections: [{ type: 'Filler' }, { type: 'Oven', height: 600 }, { type: 'Filler' }] }))).toContainEqual([-1425, -828])
    // No filler: the door as high as it says, a panel over it.
    expect(thin(front({ sections: [{ type: 'Oven', height: 600 }, { type: 'Door', height: 500 }] }))).toEqual(expect.arrayContaining([[-1200, -703], [-2147, -1203]]))
    // A door on a unit 80 cm wide or more is two leaves meeting in the middle.
    expect(handles(front({ sections: [{ type: 'Door', height: 2000 }], width: 900 }))).toBe(2)
    // What does not fit is cut at the top, and nothing throws.
    expect(outlines(front({ sections: [{ type: 'Oven', height: 3000 }, { type: 'Microwave', height: 400 }] }))).toEqual([[-2150, 0], [-2147, -103]])
  })

  it('is set into in 3D where a section is open, between its sides', () => {
    const doc = add(createDocument('R'), { type: 'parametric', id: 't', kind: 'arch.tallunit', props: { sections: custom }, x: 0, y: 0 })
    const slabs = massing(doc, 'page_1', registry).filter((s) => s.node === 't')
    const niche = slabs.filter((s) => s.bottom === 1420 && s.top === 1800)
    // Its back and its two sides; full depth under it and over it.
    expect(niche).toHaveLength(3)
    const under = slabs.filter((s) => s.bottom >= 100 && s.top <= 1420)
    expect([Math.min(...under.map((s) => s.bottom)), Math.max(...under.map((s) => s.top))]).toEqual([100, 1420])
    // The oven's window let into it, in its section (820 to 1420): glass, a dark recess behind.
    const glass = under.filter((s) => s.role === 'glass')
    expect(glass).toHaveLength(1)
    expect(glass[0].bottom).toBeGreaterThan(820)
    expect(glass[0].top).toBeLessThan(1420)
    expect(under.filter((s) => s.finish === 'dark')).toHaveLength(1)
    // Its filler up to the ceiling: 2500, the page's walls' height.
    expect(slabs.filter((s) => s.bottom === 1800 && s.top === 2500)).toHaveLength(1)
  })

  it('shows the window of an oven or a microwave as glass in 3D, on every unit that holds one, and none on the others', () => {
    const glassOf = (kind: string, props: Record<string, unknown>) => {
      const doc = add(createDocument('R'), { type: 'parametric', id: 'u', kind, props, x: 0, y: 0 })
      return massing(doc, 'page_1', registry).filter((s) => s.node === 'u' && s.role === 'glass')
    }
    // A base unit with an oven, the unit under a hob (an oven by default), a tall unit's microwave.
    expect(glassOf('arch.baseunit', { fronts: 'Oven' })).toHaveLength(1)
    expect(glassOf('arch.hob', {})).toHaveLength(1)
    expect(glassOf('arch.tallunit', { sections: [{ type: 'Microwave', height: 400 }] })).toHaveLength(1)
    // Doors, drawers, nothing under a hob: no glass.
    expect(glassOf('arch.baseunit', { fronts: 'Doors' })).toHaveLength(0)
    expect(glassOf('arch.hob', { below: 'Drawers' })).toHaveLength(0)
    expect(glassOf('arch.hob', { below: 'None' })).toHaveLength(0)
    // The glass flush with the unit's front, under the worktop, a dark recess behind it.
    const doc = add(createDocument('R'), { type: 'parametric', id: 'u', kind: 'arch.baseunit', props: { fronts: 'Oven' }, x: 0, y: 0 })
    const slabs = massing(doc, 'page_1', registry).filter((s) => s.node === 'u')
    const [pane] = slabs.filter((s) => s.role === 'glass')
    expect(Math.max(...pane.outline.map((p) => p.y))).toBe(Math.max(...slabs.filter((s) => s.top < 862).flatMap((s) => s.outline.map((p) => p.y))))
    expect(pane.top).toBeLessThan(862)
    expect(slabs.filter((s) => s.finish === 'dark')).toHaveLength(1)
  })

  it('scaled, has its sections scaled with it', () => {
    const doc = add(createDocument('R'), { type: 'parametric', id: 't', kind: 'arch.tallunit', props: { sections: custom }, x: 0, y: 0 })
    const scaled = applyOps(doc, transformOps(doc, [doc.nodes.t], { pivot: { x: 0, y: 0 }, scale: 2 }, registry))
    expect(((scaled.nodes.t as NodeOf<'parametric'>).props.sections as { height?: number }[]).map((row) => row.height)).toEqual([1440, 1200, 760, undefined])
  })

  it('is told apart from another by its sections, each said in the language asked', () => {
    const nodes = [custom, [{ type: 'Fridge', height: 1000 }]].map((rows, i) => ({ type: 'parametric', id: `t${i}`, parent: 'page_1', kind: 'arch.tallunit', props: { sections: rows }, x: 0, y: 0 }) as unknown as NodeOf<'parametric'>)
    const [one] = variantsOf(nodes, registry)
    const french: Record<string, string> = { 'Tall unit': 'Colonne', Drawer: 'Tiroir', Oven: 'Four', 'Section: Open': 'Niche', Filler: 'Remplissage' }
    expect(variantLabel(one.label, one.detail, (text) => french[text] ?? text)).toBe('Colonne Tiroir / Four / Niche / Remplissage')
  })

  it('moves the line between two sections, a filler taking what is left', () => {
    expect(tall.splits!(props({ sections: custom }))).toEqual([820, 1420, 1800])
    // The line over the drawer taken up 80: it is 800, the oven over it 520, its top where it was.
    expect(tall.moveSplit!(props({ sections: custom }), 0, 900)).toEqual({
      sections: [{ type: 'Drawer', height: 800 }, { type: 'Oven', height: 520 }, { type: 'Open', height: 380 }, { type: 'Filler', height: 720 }],
    })
    // The line under the filler: only the niche changes, the filler takes the rest.
    expect((tall.moveSplit!(props({ sections: custom }), 2, 1700)?.sections as { height: number }[]).map((row) => row.height)).toEqual([720, 600, 280, 720])
    // Never less than 50 for either, and no line past the last, nor between two fillers.
    expect((tall.moveSplit!(props({ sections: custom }), 0, 0)?.sections as unknown[]).slice(0, 2)).toMatchObject([{ height: 50 }, { height: 1270 }])
    expect(tall.moveSplit!(props({ sections: custom }), 3, 2000)).toBeNull()
    expect(tall.moveSplit!(props({ sections: [{ type: 'Filler' }, { type: 'Filler' }] }), 0, 1000)).toBeNull()
    // The line under the panel at the top, with no filler: the section under it is made that high.
    expect(tall.moveSplit!(props({ sections: [{ type: 'Door', height: 500 }] }), 0, 1000)).toEqual({ sections: [{ type: 'Door', height: 900 }] })
  })

  it('is described to models with the fields of its sections', () => {
    expect(drawingGuide(registry)).toContain('"sections":"list of up to 12 {type: one of Door | Drawer | Oven | Microwave | Fridge | Freezer | Open | Filler (default Door), height: number in mm (default 720)}"')
  })
})
