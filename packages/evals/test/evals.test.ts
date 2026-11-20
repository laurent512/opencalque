import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { applyEdit, type Document, type Op } from '@opencalque/core'
import type { Provider } from '../../../apps/web/src/ai/types'
import { evaluate, grade, passedAll } from '../src/evaluate'
import { bedroomFurnitureOps, object, registry } from '../src/plans'
import { makeProvider } from '../src/providers'
import { markdown, summarize } from '../src/report'
import { runs, SURFACES } from '../src/surfaces'
import { TASKS, type Task } from '../src/tasks'

/*
 * What can be known of the evals without a model: that each task is solved by its reference and
 * not by leaving the drawing as it was, and that both surfaces carry a model's tool calls to the
 * drawing and its reply to the graders, through the real agent loop and the real MCP server.
 */

const solved = (task: Task, start: Document) => {
  const ops = task.reference.ops?.(start)
  return { doc: ops ? applyEdit(start, ops, registry).doc : start, reply: task.reference.reply?.(start) ?? '' }
}

describe('each task', () => {
  it('has a unique id', () => {
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(TASKS.length)
  })

  for (const task of TASKS) {
    it(`${task.id}: its reference passes every check, and the drawing it starts from does not`, () => {
      const start = task.start()
      const { doc, reply } = solved(task, start)
      const done = grade(task, start, doc, reply)
      expect(done.filter((c) => !c.pass), JSON.stringify(done.filter((c) => !c.pass))).toEqual([])
      expect(passedAll(grade(task, start, start, ''))).toBe(false)
    })
  }
})

describe('near misses', () => {
  const failed = (id: string, ops: Op[], reply = '') => {
    const task = TASKS.find((t) => t.id === id)!
    const start = task.start()
    return grade(task, start, applyEdit(start, ops, registry).doc, reply)
      .filter((c) => !c.pass)
      .map((c) => c.name)
  }
  const update = (id: string, patch: Record<string, unknown>) => ({ op: 'update_node', id, patch }) as Op

  it('a door at one end of the wall is not in its middle', () => {
    expect(failed('door-in-wall', [object('door', 'arch.door', 600, 0)])).toEqual(['it is in the middle of it'])
  })

  it('a socket on the outer face of the wall is not inside', () => {
    expect(failed('socket-on-wall', [object('socket', 'elec.socket', -100, 2000, 90, { count: 2 })])).toEqual(['fixed on the inner face of the left wall'])
  })

  it('a wardrobe in the swing of the door blocks it', () => {
    expect(failed('furnish-bedroom', [...bedroomFurnitureOps().slice(0, 3), object('wardrobe', 'arch.wardrobe', 300, 3000)])).toEqual(['the door can still open'])
  })

  it('thicker walls on the same lines make the rooms smaller', () => {
    expect(failed('thicken-selected-walls', ['w_top', 'w_right', 'w_bottom', 'w_left'].map((id) => update(id, { thickness: 300 })))).toEqual(['both rooms are still 10.83 m² inside'])
  })

  it('moving the right wall alone leaves the room open', () => {
    expect(failed('extend-room', [update('o_right', { a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 } })])).toContain('the office is 13.44 m²')
  })

  it('a wrong area is a wrong answer', () => {
    expect(failed('question-area', [], 'They have 36.0 m² together.')).toEqual(['the reply gives 34.78 m², within 0.3'])
  })
})

/** A model that answers every task with its reference: the operations in one call, then the reply. */
const replaying: Provider = {
  pictures: true,
  describeError: (error) => String(error),
  createSession: ({ tools }) => {
    let task: Task | undefined
    let start: Document | undefined
    let step = 0
    return {
      snapshot: () => null,
      async send(input, onText) {
        step++
        if (step === 1) {
          // The task is found by its request, which reaches the model in its first message.
          const text = 'text' in input ? input.text : ''
          task = TASKS.find((t) => text.endsWith(t.prompt) || (t.outside !== undefined && text.endsWith(t.outside)))
          start = task?.start()
          const ops = task && start ? task.reference.ops?.(start) : undefined
          expect(tools.some((tool) => tool.name === 'apply_operations')).toBe(true)
          if (ops) return { calls: [{ id: 'call_1', name: 'apply_operations', input: { operations: ops } }], stop: 'tools' }
        }
        if ('results' in input) expect(input.results.every((r) => !r.isError), JSON.stringify(input.results)).toBe(true)
        onText(task && start ? (task.reference.reply?.(start) ?? 'Done.') : 'Done.')
        return { calls: [], stop: 'done' }
      },
    }
  },
}

describe('the surfaces', () => {
  for (const surface of SURFACES) {
    for (const task of TASKS.filter((t) => runs(t, surface, true))) {
      it(`${surface}: carries ${task.id} from the model to the drawing and the graders`, async () => {
        const { graded } = await evaluate(task, surface, replaying, 1, 60_000)
        expect(graded.checks.filter((c) => !c.pass)).toEqual([])
        expect(graded).toMatchObject({ passed: true, finished: true, toolErrors: 0 })
      })
    }
  }

  it('tells the outside agent what the MCP server says, and offers it read_guide', async () => {
    let seen: { system: string; tools: string[] } | undefined
    const watching: Provider = {
      ...replaying,
      createSession: (setup) => {
        seen = { system: setup.system, tools: setup.tools.map((t) => t.name) }
        return replaying.createSession(setup)
      },
    }
    await evaluate(TASKS[0], 'outside', watching, 1, 60_000)
    expect(seen?.system).toMatch(/read_guide/)
    expect(seen?.tools).toContain('read_guide')
  })
})

describe('a run on Claude', () => {
  it('goes through the app’s own provider and the SDK, and counts the tokens of each request', async () => {
    const bodies: { tools: { name: string }[]; system: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        bodies.push(JSON.parse(body))
        const door = JSON.stringify({ operations: [{ op: 'add_node', node: { type: 'parametric', parent: 'page_1', kind: 'arch.door', props: {}, x: 2050, y: 0 } }] })
        const events: unknown[] =
          bodies.length === 1
            ? [
                { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'apply_operations', input: {} } },
                { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: door } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
              ]
            : [
                { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I added a 90 cm door in the middle of the top wall.' } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
              ]
        const usage = { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25, output_tokens: 1 }
        const start = { type: 'message_start', message: { id: `msg_${bodies.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage } }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([start, ...events, { type: 'message_stop' }].map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const saved = { url: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY }
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.ANTHROPIC_API_KEY = 'test-key'
    try {
      const provider = makeProvider({ provider: 'anthropic', model: 'claude-sonnet-5-5', pictures: true })
      const { graded, run } = await evaluate(TASKS.find((t) => t.id === 'door-in-wall')!, 'assistant', provider, 1, 60_000)
      expect(graded.checks.filter((c) => !c.pass)).toEqual([])
      expect(graded.usage).toEqual({ requests: 2, input: 200, cacheRead: 100, cacheWrite: 50, output: 30 })
      expect(run.reply).toMatch(/door/)
      expect(bodies[0].tools.map((t) => t.name)).toContain('apply_operations')
      expect(bodies[0].system).toMatch(/drawing assistant built into OpenCalque/)
    } finally {
      process.env.ANTHROPIC_BASE_URL = saved.url
      process.env.ANTHROPIC_API_KEY = saved.key
      if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
      server.close()
    }
  })
})

describe('the report', () => {
  it('counts passes by task and says what failed', async () => {
    const task = TASKS.find((t) => t.id === 'door-in-wall')!
    const nothing: Provider = { ...replaying, createSession: () => ({ snapshot: () => null, send: async () => ({ calls: [], stop: 'done' }) }) }
    const runsOf = [(await evaluate(task, 'assistant', replaying, 1, 60_000)).graded, (await evaluate(task, 'assistant', nothing, 2, 60_000)).graded]
    const summary = summarize(runsOf, { model: 'm', provider: 'p', date: '2026-11-18' })
    expect(summary.passRate).toBe(0.5)
    expect(summary.lines[0]).toMatchObject({ task: 'door-in-wall', runs: 2, passed: 1 })
    expect(summary.lines[0].failing['one door']).toBe(1)
    expect(markdown(summary, { ...summary, passRate: 1, lines: [{ ...summary.lines[0], passed: 2 }] })).toContain('1/2 (-50)')
  })
})
