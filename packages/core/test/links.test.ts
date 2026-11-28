import { describe, expect, it } from 'vitest'
import electrical from '../../warehouse/extensions/electrical.json'
import {
  applyOps,
  checkIntegrity,
  controlsOn,
  copyNodes,
  createDocument,
  declarativeExtension,
  DRAWING_TOOLS,
  drawingGuide,
  FORMAT_VERSION,
  kindOf,
  linkPort,
  nodePrimitives,
  OpError,
  parseDocument,
  readDocument,
  Registry,
  runDrawingTool,
  serializeDocument,
  tableContent,
  tableItems,
  toDXF,
  toPDF,
  toSVG,
  toggleControlOps,
  transformOps,
  type Document,
  type DrawingHost,
  type NodeOf,
  type Op,
} from '../src'

/*
 * Links between objects (`networks/`): a switch and the lights it controls, joined through the
 * ports their kinds declare (packages/warehouse/extensions/electrical.json), drawn between them,
 * removed with them, copied with them, and read back as what controls what.
 */
const registry = new Registry().use(declarativeExtension(electrical))

const object = (id: string, kind: string, x: number, y: number, props: Record<string, unknown> = {}): Op => ({ op: 'add_node', node: { type: 'parametric', id, parent: 'page_1', kind, props, x, y } })
const link = (id: string, from: string, to: string, more: Record<string, unknown> = {}): Op => ({ op: 'add_node', node: { type: 'link', id, parent: 'page_1', from, to, ...more } as never })

/** A switch at the origin, two ceiling lights 3 m away, a socket and a dimmer. */
const room = (): Document =>
  applyOps(createDocument(), [
    object('switch', 'elec.switch', 0, 0),
    object('light', 'elec.light', 3000, 0),
    object('light2', 'elec.light', 3000, 2000),
    object('socket', 'elec.socket', 0, 2000),
    object('dimmer', 'elec.dimmer', -2000, 0),
  ])
const linked = (): Document => applyOps(room(), [link('l1', 'switch', 'light')])
const drawn = (doc: Document, id: string) => nodePrimitives(doc.nodes[id], { doc, registry, depth: 0 })

describe('a control link', () => {
  it('is drawn as a dashed curve from the edge of one symbol to the edge of the other', () => {
    const [curve, ...rest] = drawn(linked(), 'l1')
    expect(rest).toEqual([])
    if (curve.kind !== 'path') throw new Error('a path')
    expect(curve.dash).toEqual([6, 4])
    // Neither end is inside the symbols: a light is a circle of 120 round its point, the switch reaches 230 from its own.
    const [start, end] = [curve.points[0], curve.points[curve.points.length - 1]]
    expect(Math.hypot(start.x, start.y)).toBeGreaterThan(55)
    expect(Math.hypot(end.x - 3000, end.y)).toBeGreaterThan(115)
    // It bows: its middle stands off the straight line between them.
    expect(Math.abs(curve.points[Math.floor(curve.points.length / 2)].y)).toBeGreaterThan(200)
  })

  it('follows its ends: it has no position of its own', () => {
    const moved = applyOps(linked(), [{ op: 'update_node', id: 'light', patch: { x: 3000, y: 4000 } }])
    const curve = drawn(moved, 'l1')[0]
    if (curve.kind !== 'path') throw new Error('a path')
    expect(curve.points[curve.points.length - 1].y).toBeGreaterThan(3500)
    // Mirrored, one told how to bow bows the other way, as the mirror image does.
    const bent = applyOps(linked(), [{ op: 'update_node', id: 'l1', patch: { bend: 0.4 } }])
    const mirrored = applyOps(bent, transformOps(bent, [bent.nodes.l1], { pivot: { x: 0, y: 0 }, mirror: true }, registry))
    expect((mirrored.nodes.l1 as NodeOf<'link'>).bend).toBe(-0.4)
  })

  it('bows into the plan when it is not told which way: a link along the bottom of the plan bows up', () => {
    // The dimmer at (-2000, 0) and the socket at (0, 2000): the plan's middle is up and to the right of the line between them.
    const doc = applyOps(room(), [link('d', 'dimmer', 'socket'), link('e', 'socket', 'dimmer')])
    for (const id of ['d', 'e']) {
      const curve = drawn(doc, id)[0]
      if (curve.kind !== 'path') throw new Error('a path')
      // The line between them is where x + y is 0; the plan's middle (800, 800) is where it is positive.
      // The curve stands about 350 off the line at its furthest (x + y about 500), on that side, whichever way the link runs.
      expect(Math.max(...curve.points.map((p) => p.x + p.y)), id).toBeGreaterThan(400)
    }
  })

  it('is bowed by dragging the middle of its curve, more, less, or the other way', () => {
    const doc = linked()
    const kind = kindOf(doc.nodes.l1)
    const [middle] = kind.handles!(doc.nodes.l1, registry, doc)
    // The switch's symbol and the light's are not centred on their points: the middle is near (1500, 0), off the line between them.
    expect(Math.abs(middle.x - 1500)).toBeLessThan(200)
    expect(Math.abs(middle.y)).toBeGreaterThan(200)
    // Dragged back where it is, the bend is what it bows by on its own (0.25, towards the plan's middle); across the line, the other way.
    const own = (kind.moveHandle!(doc.nodes.l1, 0, middle, registry, doc) as { bend: number }).bend
    expect(Math.abs(own)).toBeCloseTo(0.25, 2)
    const across = { x: middle.x, y: -middle.y }
    const other = (kind.moveHandle!(doc.nodes.l1, 0, across, registry, doc) as { bend: number }).bend
    expect(Math.sign(other)).toBe(-Math.sign(own))
    const bent = applyOps(doc, [{ op: 'update_node', id: 'l1', patch: { bend: other } }])
    expect(kind.handles!(bent.nodes.l1, registry, bent)[0].y).toBeCloseTo(across.y, 0)
    // Without the drawing, it has no handle to show.
    expect(kind.handles!(doc.nodes.l1, registry)).toEqual([])
  })

  it('goes into every export: dashed in SVG and PDF, as lines in DXF, which carries no dashes for anything', () => {
    const doc = applyOps(linked(), [{ op: 'add_node', node: { type: 'paper', id: 'sheet', parent: 'page_1', x: -2000, y: -3000, width: 8000, height: 6000, scale: 50 } }])
    const only = applyOps(doc, [{ op: 'remove_node', id: 'l1' }])
    expect(toSVG(doc, 'page_1', registry)).toContain('stroke-dasharray="6 4"')
    const lines = (dxf: string) => dxf.split('\n').filter((line) => line === 'LINE').length
    // Its curve is drawn as many short lines.
    expect(lines(toDXF(doc, 'page_1', registry)) - lines(toDXF(only, 'page_1', registry))).toBeGreaterThan(20)
    const pdf = (d: Document) => Buffer.from(toPDF(d, registry)).toString('latin1')
    expect(pdf(only)).not.toMatch(/\] 0 d/)
    expect(pdf(doc)).toMatch(/\] 0 d/)
  })

  it('is drawn only while both its ends are shown', () => {
    expect(drawn(applyOps(linked(), [{ op: 'update_node', id: 'light', patch: { visible: false } }]), 'l1')).toEqual([])
  })

  it('joins two different objects that are on its page, or is refused', () => {
    expect(() => applyOps(room(), [link('x', 'switch', 'switch')])).toThrow(OpError)
    expect(() => applyOps(room(), [link('x', 'switch', 'nothing')])).toThrow(/not an object of the drawing/)
    expect(() => applyOps(room(), [link('x', 'switch', 'page_1')])).toThrow(OpError)
    const twoPages = applyOps(room(), [{ op: 'add_node', node: { type: 'page', id: 'p2' } }, { op: 'add_node', node: { type: 'parametric', id: 'far', parent: 'p2', kind: 'elec.light', props: {}, x: 0, y: 0 } }])
    expect(() => applyOps(twoPages, [link('x', 'switch', 'far')])).toThrow(/another page/)
  })

  it('goes with either of its ends, and with a group that holds one', () => {
    expect(applyOps(linked(), [{ op: 'remove_node', id: 'light' }]).nodes.l1).toBeUndefined()
    expect(applyOps(linked(), [{ op: 'remove_node', id: 'switch' }]).nodes.l1).toBeUndefined()
    const grouped = applyOps(linked(), [{ op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1' } }, { op: 'update_node', id: 'switch', patch: { parent: 'g' } }])
    // Still drawn from the switch inside its group.
    expect(drawn(grouped, 'l1')).toHaveLength(1)
    expect(applyOps(grouped, [{ op: 'remove_node', id: 'g' }]).nodes.l1).toBeUndefined()
    // Removed with both its ends at once, it is not removed twice.
    expect(applyOps(linked(), [{ op: 'remove_node', id: 'switch' }, { op: 'remove_node', id: 'light' }]).nodes.l1).toBeUndefined()
  })
})

describe('ports', () => {
  it('come from the kinds: a double switch has a second button, a light a control that must be linked, a socket one that may be', () => {
    const doc = applyOps(room(), [{ op: 'update_node', id: 'switch', patch: { props: { double: true } } }])
    expect(linkPort(doc, registry, { from: 'switch', to: 'light', fromPort: 'out2' }, 'from')?.label).toBe('Second button')
    expect(linkPort(doc, registry, { from: 'switch', to: 'light' }, 'from')?.key).toBe('out')
    // A switch made single again: a link on its second button is on its only one.
    expect(linkPort(room(), registry, { from: 'switch', to: 'light', fromPort: 'out2' }, 'from')?.key).toBe('out')
    expect(linkPort(room(), registry, { from: 'switch', to: 'socket' }, 'to')).toMatchObject({ way: 'in' })
    expect(linkPort(room(), registry, { from: 'switch', to: 'light' }, 'to')).toMatchObject({ required: true })
  })
})

describe('clicking a switch then a light', () => {
  const place = { id: 'new', parent: 'page_1' }

  it('links them, the switch first whichever was clicked first, and unlinks them the second time', () => {
    const made = toggleControlOps(room(), registry, 'light', 'switch', place)!
    expect(made.linked).toBe(true)
    const doc = applyOps(room(), made.ops)
    expect(doc.nodes.new).toMatchObject({ type: 'link', from: 'switch', to: 'light' })
    const undone = toggleControlOps(doc, registry, 'switch', 'light', { ...place, id: 'other' })!
    expect(undone.linked).toBe(false)
    expect(applyOps(doc, undone.ops).nodes.new).toBeUndefined()
  })

  it('does nothing between two lights, or two switches, or a switch and a smoke detector', () => {
    expect(toggleControlOps(room(), registry, 'light', 'light2', place)).toBeNull()
    expect(toggleControlOps(room(), registry, 'switch', 'dimmer', place)).toBeNull()
    expect(toggleControlOps(applyOps(room(), [object('smoke', 'elec.smoke', 0, 0)]), registry, 'switch', 'smoke', place)).toBeNull()
  })
})

describe('what controls what', () => {
  it('lists each switch with its lights, the lights nothing controls, and the switches that control nothing', () => {
    const summary = controlsOn(applyOps(linked(), [link('l2', 'dimmer', 'socket')]), registry, 'page_1')
    expect(summary.controllers.map((c) => [c.id, c.controls.map((d) => d.id)])).toEqual([
      ['switch', ['light']],
      ['dimmer', ['socket']],
    ])
    // A socket need not be switched: only the light is uncontrolled.
    expect(summary.uncontrolled.map((d) => d.id)).toEqual(['light2'])
    expect(controlsOn(room(), registry, 'page_1').idle.map((d) => d.id)).toEqual(['switch', 'dimmer'])
  })

  it('is told to agents, who are told how to make links', async () => {
    expect(DRAWING_TOOLS.map((tool) => tool.name)).toContain('read_controls')
    const doc = linked()
    const host: DrawingHost = { registry, doc: () => doc, scope: () => 'page_1', apply: () => {} }
    const read = JSON.parse((await runDrawingTool('read_controls', {}, host)).content)
    expect(read.uncontrolled).toEqual([{ id: 'light2', kind: 'elec.light' }])
    expect(drawingGuide(registry)).toContain('A "link" joins two objects')
  })
})

describe('a table of what controls what', () => {
  it('lists each switch with what it controls, kinds numbered when several share a name, its symbol beside it', () => {
    const doc = applyOps(linked(), [
      object('switch2', 'elec.switch', 0, 3000),
      link('l2', 'switch', 'light2'),
      link('l3', 'dimmer', 'socket'),
      { op: 'add_node', node: { type: 'table', id: 't', parent: 'page_1', x: 0, y: 5000, schedule: 'controls' } },
    ])
    const table = tableContent(doc.nodes.t as NodeOf<'table'>, doc, registry)
    expect(table.headings).toEqual(['Symbol', 'Name', 'Controls'])
    expect(table.rows).toEqual([
      ['', 'Switch 1', 'Ceiling light ×2'],
      ['', 'Dimmer', 'Socket'],
      ['', 'Switch 2', '—'],
    ])
    expect(table.symbols?.objects.map((o) => o.id)).toEqual(['elec.switch', 'elec.dimmer', 'elec.switch'])
    // Its rows can be chosen as any table's: by the switch they are of.
    expect(tableItems(doc.nodes.t as NodeOf<'table'>, doc, registry).map((item) => item.key)).toEqual(['control:switch', 'control:dimmer', 'control:switch2'])
    const only = applyOps(doc, [{ op: 'update_node', id: 't', patch: { only: ['control:dimmer'] } }])
    expect(tableContent(only.nodes.t as NodeOf<'table'>, only, registry).rows).toEqual([['', 'Dimmer', 'Socket']])
  })
})

describe('copied and pasted', () => {
  it('comes along between objects copied together, joining the copies; alone, or with one end, it does not', () => {
    const doc = linked()
    const clip = copyNodes(doc, ['switch', 'light'])
    const links = Object.values(clip.nodes).filter((n): n is NodeOf<'link'> => n.type === 'link')
    expect(links).toHaveLength(1)
    expect([clip.nodes[links[0].from], clip.nodes[links[0].to]].map((n) => (n as NodeOf<'parametric'>).kind)).toEqual(['elec.switch', 'elec.light'])
    expect(Object.values(copyNodes(doc, ['switch', 'l1']).nodes).some((n) => n.type === 'link')).toBe(false)
  })
})

describe('in a file', () => {
  it('make a drawing of version 4, which says the version before while it has none, for the versions before them', () => {
    // Version 5 came after them, with the office chair apart from the desk: a drawing without desks
    // does not need it; 6 with viewpoints, which it has none of; 7 with splines; and 8 with suns.
    expect(FORMAT_VERSION).toBe(8)
    expect(JSON.parse(serializeDocument(linked())).version).toBe(4)
    expect(JSON.parse(serializeDocument(room())).version).toBe(2)
    expect(parseDocument(JSON.parse(serializeDocument(linked()))).nodes.l1).toEqual(linked().nodes.l1)
  })

  it('are taken out when an end is missing, saying so', () => {
    const json = JSON.parse(serializeDocument(linked()))
    delete json.nodes.light
    const { doc, repairs } = readDocument(json)
    expect(doc.nodes.l1).toBeUndefined()
    expect(repairs.join(' ')).toMatch(/Link "l1" was removed/)
    expect(checkIntegrity(doc)).toEqual([])
  })
})
