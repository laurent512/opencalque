import { describe, expect, it } from 'vitest'
import { applyEdit, DRAWING_TOOLS, drawingGuide, nodeTypes, nodeTypeSchema, runDrawingTool, svgBox, toSVG, type Document, type DrawingHost } from '../src'
import { houseDoc, registry, wall } from './support/house'

/** The four walls of a room 4 m by 3 m, measured on their lines. */
const room = [wall('n', [0, 0], [4000, 0], 200), wall('e', [4000, 0], [4000, 3000], 200), wall('s', [4000, 3000], [0, 3000], 200), wall('w', [0, 3000], [0, 0], 200), { type: 'room', id: 'r', name: 'Kitchen', x: 2000, y: 1500 }]

function hostOf(start: Document, picture = true) {
  let doc = start
  const drawn: { svg: string; pixels: number }[] = []
  const host: DrawingHost = {
    registry,
    doc: () => doc,
    scope: () => 'page_1',
    apply: (ops) => {
      doc = applyEdit(doc, ops, registry).doc
    },
    ...(picture
      ? {
          picture: async (svg, pixels) => {
            drawn.push({ svg, pixels })
            return { mime: 'image/png', data: 'cGljdHVyZQ==', width: 1000, height: 500 }
          },
        }
      : {}),
  }
  return { host, drawn, doc: () => doc }
}

const parsed = (content: string) => JSON.parse(content)

describe('the tools every agent has', () => {
  it('tells an edit what it left wrong', async () => {
    const { host } = hostOf(houseDoc(room))
    const { content, note } = await runDrawingTool('apply_operations', { operations: [{ op: 'remove_node', id: 'e' }] }, host)
    expect(note).toEqual({ kind: 'applied', count: 1 })
    expect(parsed(content).problems.map((p: { kind: string }) => p.kind)).toEqual(['room-not-enclosed'])
  })

  it('adds nothing to the result of an edit that left nothing wrong', async () => {
    const { host } = hostOf(houseDoc(room))
    const { content } = await runDrawingTool('apply_operations', { operations: [{ op: 'update_node', id: 'r', patch: { name: 'Den' } }] }, host)
    expect(parsed(content)).toEqual({ applied: 1, addedNodeIds: [] })
  })

  it('changes nothing and says why when an edit is not valid', async () => {
    const { host, doc } = hostOf(houseDoc(room))
    const before = doc()
    for (const operations of [[{ op: 'remove_node', id: 'nothing' }], 'not a list', undefined]) {
      const result = await runDrawingTool('apply_operations', { operations }, host)
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/^Nothing was changed\./)
      expect(result.note).toEqual({ kind: 'invalid-operations' })
    }
    expect(doc()).toBe(before)
  })

  it('puts a door back in the wall an edit moved', async () => {
    const { host, doc } = hostOf(houseDoc([wall('w', [0, 0], [6000, 0], 200), { type: 'parametric', id: 'd', kind: 'test.door', props: { width: 900 }, x: 1000, y: 0 }]))
    await runDrawingTool('apply_operations', { operations: [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 500 }, b: { x: 6000, y: 500 } } }] }, host)
    expect(doc().nodes.d).toMatchObject({ x: 1000, y: 500 })
  })

  it('measures what is drawn, in the units it says', async () => {
    const { host } = hostOf(houseDoc(room))
    const { content } = await runDrawingTool('measure_drawing', {}, host)
    const result = parsed(content)
    expect(result.page).toBe('page_1')
    expect(result.units).toContain('m²')
    // Inside faces: 3.8 m by 2.8 m.
    expect(result.rooms[0]).toMatchObject({ id: 'r', name: 'Kitchen', area: 10.64 })
    expect(result.walls).toHaveLength(4)
  })

  it('measures only the parts asked for, and says when there is too much to send at once', async () => {
    const { host } = hostOf(houseDoc(room))
    expect(Object.keys(parsed((await runDrawingTool('measure_drawing', { of: ['rooms'] }, host)).content))).toEqual(['page', 'units', 'rooms'])
    const many = Array.from({ length: 400 }, (_, i) => wall(`long${i}`, [0, i * 1000], [4000, i * 1000], 200))
    const result = parsed((await runDrawingTool('measure_drawing', {}, hostOf(houseDoc(many)).host)).content)
    expect(result.tooMuchAtOnce).toMatchObject({ walls: 400 })
  })

  it('lists what is wrong with the drawing, however it came to be', async () => {
    const { host } = hostOf(houseDoc(room.filter((node) => node.id !== 'e')))
    const whole = parsed((await runDrawingTool('check_drawing', {}, host)).content)
    expect(whole.problems.map((p: { kind: string }) => p.kind)).toEqual(['room-not-enclosed'])
    expect(parsed((await runDrawingTool('check_drawing', { page: 'page_1' }, host)).content).problems).toHaveLength(1)
    expect((await runDrawingTool('check_drawing', { page: 'nowhere' }, host)).isError).toBe(true)
  })

  it('keeps a long list of problems short, saying how many there are', async () => {
    const doubled = Array.from({ length: 40 }, (_, i) => [wall(`a${i}`, [0, i * 1000], [4000, i * 1000], 200), wall(`b${i}`, [0, i * 1000], [4000, i * 1000], 200)]).flat()
    const result = parsed((await runDrawingTool('check_drawing', {}, hostOf(houseDoc(doubled)).host)).content)
    expect(result.problems).toHaveLength(30)
    expect(result.totalProblems).toBe(40)
  })

  it('shows the drawing, saying what the picture covers', async () => {
    const { host, drawn } = hostOf(houseDoc(room))
    const result = await runDrawingTool('view_drawing', {}, host)
    expect(result.image).toEqual({ mime: 'image/png', data: 'cGljdHVyZQ==' })
    expect(result.note).toEqual({ kind: 'looked-at-drawing' })
    expect(drawn[0].pixels).toBe(1568)
    expect(drawn[0].svg).toContain('<svg')
    const box = svgBox(drawn[0].svg)
    expect(result.content).toContain(`x from ${Math.round(box.minX)} to ${Math.round(box.maxX)}`)
    expect(result.content).toContain('1000 × 500 pixels')
  })

  it('shows the part of the drawing asked for, exactly', async () => {
    const { host, drawn } = hostOf(houseDoc(room))
    await runDrawingTool('view_drawing', { area: { minX: 100, minY: 200, maxX: 1100, maxY: 700 } }, host)
    expect(svgBox(drawn[0].svg)).toEqual({ minX: 100, minY: 200, maxX: 1100, maxY: 700 })
    for (const area of [{ minX: 5, minY: 5, maxX: 5, maxY: 9 }, { minX: 0 }, 'all']) expect((await runDrawingTool('view_drawing', { area }, host)).isError).toBe(true)
  })

  it('says so where the drawing cannot be shown, or the page is not there', async () => {
    const result = await runDrawingTool('view_drawing', {}, hostOf(houseDoc(room), false).host)
    expect(result).toMatchObject({ isError: true, note: { kind: 'no-picture' } })
    expect((await runDrawingTool('view_drawing', { page: 'r' }, hostOf(houseDoc(room)).host)).isError).toBe(true)
    expect((await runDrawingTool('measure_drawing', { page: 'nowhere' }, hostOf(houseDoc(room)).host)).isError).toBe(true)
  })

  it('sums the drawing up, with what is being worked on', async () => {
    const { host } = hostOf(houseDoc(room))
    const result = parsed((await runDrawingTool('describe_drawing', {}, { ...host, selection: () => ['n'] })).content)
    expect(result.pages[0]).toMatchObject({ id: 'page_1', objects: { wall: 4, room: 1 } })
    expect(result.workingOn).toBe('page_1')
    expect(result.selection).toEqual(['n'])
  })

  it('refuses a tool that is not there, and input that is not an object', async () => {
    const { host } = hostOf(houseDoc(room))
    expect(await runDrawingTool('rm_rf', {}, host)).toMatchObject({ isError: true, note: { kind: 'no-such-tool' } })
    expect((await runDrawingTool('apply_operations', null, host)).isError).toBe(true)
  })

  it('runs every tool it lists', async () => {
    const { host } = hostOf(houseDoc(room))
    for (const { name } of DRAWING_TOOLS) expect((await runDrawingTool(name, {}, host)).note).not.toEqual({ kind: 'no-such-tool' })
  })
})

describe('what agents are told of the format', () => {
  it('holds the format, the objects there are, the operations and how to check', () => {
    const guide = drawingGuide(registry)
    for (const text of ['# How a drawing is stored', 'test.door', 'apply_operations', 'check_drawing', 'measure_drawing', 'view_drawing']) expect(guide).toContain(text)
  })

  it('holds the schema of every node whole for the assistant, and names the types for who must ask', () => {
    expect(drawingGuide(registry)).toContain('"oneOf"')
    const short = drawingGuide(registry, { schema: false })
    expect(short).not.toContain('"oneOf"')
    for (const type of nodeTypes()) expect(short).toContain(type)
    expect(short.length).toBeLessThan(drawingGuide(registry).length / 4)
    expect(nodeTypeSchema('wall')).toMatchObject({ properties: { thickness: {} } })
    expect(nodeTypeSchema('sofa')).toBeUndefined()
  })

  it('does not offer pictures to who cannot be shown them', () => {
    expect(drawingGuide(registry, { pictures: false })).not.toContain('view_drawing')
  })
})

describe('an SVG of a part of the drawing', () => {
  it('shows just that part, and the whole of a page with a margin otherwise', () => {
    const doc = houseDoc(room)
    expect(toSVG(doc, 'page_1', registry, { area: { minX: 0, minY: 0, maxX: 10, maxY: 20 } })).toContain('viewBox="0 0 10 20"')
    const whole = svgBox(toSVG(doc, 'page_1', registry))
    expect(whole.minX).toBeLessThan(-100)
    expect(whole.maxX).toBeGreaterThan(4100)
  })
})
