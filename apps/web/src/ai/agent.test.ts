import { describe, expect, it } from 'vitest'
import { applyOps, childrenOf, createDocument, Registry, type Document } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import { describeState, runRequest, systemPrompt, TOOLS, type AgentHost } from './agent'
import { parseReply } from './claudecli'
import type { ChatSession, TurnInput, TurnOutput } from './types'

const registry = new Registry().use(architecture)

function fakeHost(initial: Document = createDocument()) {
  let doc = initial
  const host: AgentHost = {
    state: () => ({ doc, scope: 'page_1', selection: [] }),
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
    expect(TOOLS.map((t) => t.name)).toEqual(['apply_operations', 'read_document', 'view_image'])
    expect(JSON.stringify(TOOLS[0].schema)).toContain('add_node')
  })
})
