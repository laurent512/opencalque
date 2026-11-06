import { describe, expect, it } from 'vitest'
import { applyOps, childrenOf, createDocument, OpSchema, Registry, type Document, type Op, type Vec2 } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import { describeState, runRequest, systemPrompt, toolsFor, TOOLS, type AgentHost } from './agent'
import { modelOptions } from './anthropic'
import { parseReply } from './claudecli'
import type { ChatSession, TurnInput, TurnOutput } from './types'

const registry = new Registry().use(architecture)

function fakeHost(initial: Document = createDocument(), seen: { scope?: string; selection?: string[]; corner?: Vec2 } = {}) {
  let doc = initial
  const host: AgentHost = {
    registry,
    state: () => ({ doc, scope: seen.scope ?? 'page_1', selection: seen.selection ?? [], corner: seen.corner, activeLayer: 'layer_1', visible: { minX: 0, minY: 0, maxX: 10000, maxY: 8000 } }),
    apply: (ops) => {
      doc = applyOps(doc, ops)
    },
  }
  return { host, doc: () => doc }
}

/** A model that replies with the given steps in turn and records what it was sent. */
function scripted(steps: TurnOutput[]) {
  const received: TurnInput[] = []
  const session: ChatSession = {
    send: async (input, onText) => {
      received.push(input)
      onText('ok')
      return steps[received.length - 1] ?? { calls: [], stop: 'done' }
    },
    snapshot: () => null,
  }
  return { session, received }
}

const events = () => {
  const notes: string[] = []
  return { notes, onText: () => {}, onActivity: (kind: string, text: string) => notes.push(`${kind}: ${text}`) }
}
const call = (name: string, input: unknown): TurnOutput => ({ calls: [{ id: 'c1', name, input }], stop: 'tools' })
const wall = { op: 'add_node', node: { type: 'wall', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 } }

describe('assistant', () => {
  it('sends the request with the state of the drawing, applies the operations and reports the new ids', async () => {
    const { host, doc } = fakeHost()
    const { session, received } = scripted([call('apply_operations', { operations: [wall] })])
    const log = events()
    await runRequest(session, host, 'add a wall', log, new AbortController().signal)

    expect((received[0] as { text: string }).text).toContain('add a wall')
    expect((received[0] as { text: string }).text).toContain('"page_1"')
    const walls = childrenOf(doc(), 'page_1')
    expect(walls).toHaveLength(1)
    const [result] = (received[1] as { results: { content: string; isError?: boolean }[] }).results
    expect(JSON.parse(result.content)).toEqual({ applied: 1, addedNodeIds: [walls[0].id] })
    expect(log.notes).toEqual(['done: Applied 1 change to the drawing'])
  })

  it('returns invalid operations to the model as an error and leaves the drawing alone', async () => {
    const { host, doc } = fakeHost()
    const bad = { op: 'add_node', node: { type: 'wall', parent: 'nowhere', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 200 } }
    const { session, received } = scripted([call('apply_operations', { operations: [wall, bad] }), call('apply_operations', { operations: 'not a list' })])
    await runRequest(session, host, 'x', events(), new AbortController().signal)
    for (const step of [1, 2]) {
      const [result] = (received[step] as { results: { content: string; isError?: boolean }[] }).results
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/Nothing was changed/)
    }
    expect(childrenOf(doc(), 'page_1')).toHaveLength(0)
  })

  it('shows the model a picture with the mapping from pixels to millimetres, and never sends picture data otherwise', async () => {
    const withPlan = applyOps(createDocument(), [
      { op: 'add_asset', asset: { id: 'scan', mime: 'image/jpeg', data: 'QUJD', width: 1000, height: 500 } },
      { op: 'add_node', node: { type: 'image', id: 'plan', parent: 'page_1', asset: 'scan', x: 100, y: 0, width: 20000, height: 10000 } },
    ])
    const { host } = fakeHost(withPlan)
    expect(describeState(host)).not.toContain('QUJD')
    const { session, received } = scripted([call('view_image', { node: 'plan' }), call('read_document', {})])
    await runRequest(session, host, 'trace it', events(), new AbortController().signal)
    const [seen] = (received[1] as { results: { content: string; image?: { data: string } }[] }).results
    expect(seen.image).toEqual({ mime: 'image/jpeg', data: 'QUJD' })
    expect(seen.content).toContain('x = 100 + px × 20')
    const [read] = (received[2] as { results: { content: string }[] }).results
    expect(read.content).toContain('"plan"')
    expect(read.content).not.toContain('QUJD')
  })

  it('stops on a refusal or a truncated reply without running anything', async () => {
    for (const stop of ['refused', 'truncated'] as const) {
      const { host, doc } = fakeHost()
      const { session, received } = scripted([{ calls: [], stop }])
      const log = events()
      await runRequest(session, host, 'x', log, new AbortController().signal)
      expect(received).toHaveLength(1)
      expect(log.notes[0]).toMatch(/^error:/)
      expect(childrenOf(doc(), 'page_1')).toHaveLength(0)
    }
  })

  it('tells the model what its edit left wrong, and the person only that it was applied', async () => {
    const { host } = fakeHost()
    const room = { op: 'add_node', node: { type: 'room', id: 'r', name: 'Kitchen', parent: 'page_1', x: 500, y: 500 } }
    const { session, received } = scripted([call('apply_operations', { operations: [room] })])
    const log = events()
    await runRequest(session, host, 'name this room', log, new AbortController().signal)
    const [result] = (received[1] as { results: { content: string }[] }).results
    expect(JSON.parse(result.content).problems[0]).toMatchObject({ kind: 'room-not-enclosed', nodes: ['r'] })
    expect(log.notes).toEqual(['done: Applied 1 change to the drawing'])
  })

  it('shows the model the drawing through the host, and runs the calls of one step in turn', async () => {
    const { host, doc } = fakeHost()
    const drawn: string[] = []
    host.picture = async (svg) => {
      // What is drawn is the drawing as the call before it left it.
      drawn.push(svg)
      return { mime: 'image/png', data: 'eA==', width: 800, height: 600 }
    }
    const step: TurnOutput = {
      calls: [
        { id: 'c1', name: 'apply_operations', input: { operations: [wall] } },
        { id: 'c2', name: 'view_drawing', input: {} },
      ],
      stop: 'tools',
    }
    const { session, received } = scripted([step])
    const log = events()
    await runRequest(session, host, 'draw and look', log, new AbortController().signal)
    expect(childrenOf(doc(), 'page_1')).toHaveLength(1)
    expect(drawn[0]).toContain('<path')
    const results = (received[1] as { results: { id: string; content: string; image?: unknown }[] }).results
    expect(results.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(results[1].image).toEqual({ mime: 'image/png', data: 'eA==' })
    expect(results[1].content).toContain('800 × 600 pixels')
    expect(log.notes).toEqual(['done: Applied 1 change to the drawing', 'done: Looked at the drawing'])
  })

  it('offers looking at the drawing only to a provider that can be shown it', () => {
    expect(toolsFor(true).map((tool) => tool.name)).toContain('view_drawing')
    expect(toolsFor(false).map((tool) => tool.name)).not.toContain('view_drawing')
    expect(toolsFor(false).map((tool) => tool.name)).toContain('view_image')
    expect(systemPrompt(registry, true)).toContain('Use view_drawing')
    expect(systemPrompt(registry, false)).not.toContain('Use view_drawing')
  })

  it('reads tool calls out of a text-only reply, as the Claude CLI gives', () => {
    const reply = 'Adding it.\n<opencalque-tool>{"name":"apply_operations","input":{"operations":[]}}</opencalque-tool>\n<opencalque-tool>not json</opencalque-tool>'
    const { text, calls } = parseReply(reply)
    expect(text).toBe('Adding it.')
    expect(calls).toEqual([
      { id: 'cli_1', name: 'apply_operations', input: { operations: [] } },
      { id: 'cli_2', name: 'unreadable tool block', input: 'not json' },
    ])
    expect(parseReply('Just an answer.')).toEqual({ text: 'Just an answer.', calls: [] })
  })

  it('describes every tool and parametric object to the model', () => {
    const prompt = systemPrompt(registry)
    for (const kind of registry.parametric.keys()) expect(prompt).toContain(kind)
    expect(prompt).toContain('"wall"')
    expect(TOOLS.map((t) => t.name)).toEqual(['apply_operations', 'read_document', 'describe_drawing', 'view_image', 'view_drawing', 'measure_drawing', 'check_drawing'])
    expect(JSON.stringify(TOOLS[0].schema)).toContain('add_node')
  })

  it('tells the model what is selected, in full and with what it measures, unless the person leaves it out', () => {
    const plan = applyOps(createDocument(), [
      { op: 'add_node', node: { type: 'wall', id: 'w1', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 } },
      { op: 'add_node', node: { type: 'wall', id: 'w2', parent: 'page_1', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 }, thickness: 200 } },
      { op: 'add_node', node: { type: 'group', id: 'g', parent: 'page_1' } },
      { op: 'add_node', node: { type: 'line', id: 'inside', parent: 'g', a: { x: 0, y: 5000 }, b: { x: 1000, y: 5000 } } },
    ] as Op[])
    const state = describeState(fakeHost(plan, { selection: ['w1', 'g'] }).host)
    expect(state).toContain('<selection>')
    expect(state).toContain('"w1", a wall: length 4000 mm along its line, 200 mm thick')
    expect(state).toContain('"g", a group: holds 1 objects: 1 line')
    expect(state).toContain('"inside"')
    expect(state).toContain('New objects go on the layer "Layer 1"')
    expect(state).toContain('On their screen: x from 0 to 10000, y from 0 to 8000')
    const left = describeState(fakeHost(plan, { selection: ['w1'] }).host, { selection: false })
    expect(left).not.toContain('<selection>')
    expect(left).toContain('chose not to send what is selected')
    const corner = describeState(fakeHost(plan, { corner: { x: 4000, y: 0 } }).host)
    expect(corner).toContain('wall corner at (4000, 0), where the walls "w1" (its end b) and "w2" (its end a) meet')
    expect(describeState(fakeHost(plan, { scope: 'g' }).host)).toContain('editing inside the group')
  })

  it('tells the model which properties it wrote mean nothing, and reads nodes by id', async () => {
    const { host } = fakeHost()
    const typo = { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, hieght: 2500 } }
    const { session, received } = scripted([call('apply_operations', { operations: [typo] }), call('read_document', { ids: ['w'] }), call('read_document', { ids: ['nope'] })])
    await runRequest(session, host, 'x', events(), new AbortController().signal)
    const applied = JSON.parse((received[1] as { results: { content: string }[] }).results[0].content)
    expect(applied.unknownProperties).toEqual(['new wall "w": "hieght"'])
    const read = JSON.parse((received[2] as { results: { content: string }[] }).results[0].content)
    expect(read.nodes[0]).toMatchObject({ id: 'w', hieght: 2500 })
    expect((received[3] as { results: { isError?: boolean }[] }).results[0].isError).toBe(true)
  })

  it('explains every operation and that groups hold nodes too', () => {
    const prompt = systemPrompt(registry)
    // Those refused since a version of the format took them out are not offered.
    for (const option of OpSchema.options) if (!option.description?.startsWith('Refused')) expect(prompt).toContain(option.shape.op.value)
    expect(prompt).toContain('or in a group')
    expect(prompt).toContain('never invent one such as "top"')
    expect(prompt).toContain('<selection>')
  })

  it('asks each Claude model only for what it supports', () => {
    expect(modelOptions('claude-opus-5-5')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    expect(modelOptions('claude-haiku-5-5')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } })
    expect(modelOptions('claude-haiku-4-5')).toEqual({})
  })
})
