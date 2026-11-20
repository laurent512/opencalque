import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { applyEdit, DRAWING_TOOLS, runDrawingTool, type Document, type DrawingHost, type ToolSpec } from '@opencalque/core'
import { runRequest, systemPrompt, toolsFor, type AgentHost } from '../../../apps/web/src/ai/agent'
import type { ChatSession, Provider, ToolResult, TurnInput } from '../../../apps/web/src/ai/types'
import { mcpServer, type Backend } from '../../cli/src/mcp'
import { renderPicture } from '../../cli/src/render'
import { PAGE, registry } from './plans'
import type { Task } from './tasks'

/*
 * Where a task is carried out. `assistant` is the assistant built into the app: its prompt, the
 * state sent with each request, its loop (`runRequest`) and its tools, as the app runs them, on a
 * drawing held here in place of the store. `outside` is an agent outside the app talking to the
 * MCP server, the real one over an in-memory transport, as Claude Code or another client would:
 * it is told only what the server says and the person's request.
 */

export type Surface = 'assistant' | 'outside'
export const SURFACES: Surface[] = ['assistant', 'outside']

/** One thing that happened in a run, kept for reading afterwards. */
export type Entry =
  | { sent: string }
  | { results: { tool: string; error?: boolean; content: string; picture?: boolean }[] }
  | { text: string }
  | { calls: { tool: string; input: unknown }[]; stop: string }
  | { note: string }
  | { error: string }

export interface RunResult {
  doc: Document
  /** Everything the model wrote to the person. */
  reply: string
  /** Model steps. */
  steps: number
  /** Calls by tool. */
  calls: Record<string, number>
  /** Calls that came back as errors: invalid operations, ids that are not there. */
  toolErrors: number
  /** Whether it ended by itself, rather than at the step limit, a refusal, a cut-off or an error. */
  finished: boolean
  error?: string
  transcript: Entry[]
}

/** Longest text kept from one message or result in a transcript. */
const KEEP = 3000
const clip = (text: string) => (text.length > KEEP ? `${text.slice(0, KEEP)}… (${text.length} characters)` : text)

/** Model steps allowed to an outside agent, which reads the guide and the drawing first. */
const OUTSIDE_STEPS = 20

/** A session that keeps a transcript and counts what the model did. */
function recorded(session: ChatSession, run: RunResult): ChatSession {
  const names = new Map<string, string>()
  return {
    snapshot: () => session.snapshot(),
    async send(input: TurnInput, onText, signal) {
      if ('results' in input) {
        run.toolErrors += input.results.filter((r) => r.isError).length
        run.transcript.push({ results: input.results.map((r) => ({ tool: names.get(r.id) ?? '?', ...(r.isError ? { error: true } : {}), content: clip(r.content), ...(r.image ? { picture: true } : {}) })) })
      } else run.transcript.push({ sent: clip(input.text) })
      let text = ''
      const output = await session.send(
        input,
        (delta) => {
          text += delta
          onText(delta)
        },
        signal,
      )
      run.steps++
      if (text) {
        run.reply += (run.reply ? '\n' : '') + text
        run.transcript.push({ text: clip(text) })
      }
      for (const call of output.calls) {
        names.set(call.id, call.name)
        run.calls[call.name] = (run.calls[call.name] ?? 0) + 1
      }
      run.transcript.push({ calls: output.calls.map((c) => ({ tool: c.name, input: c.input })), stop: output.stop })
      if (output.stop === 'done') run.finished = true
      return output
    },
  }
}

const blank = (doc: Document): RunResult => ({ doc, reply: '', steps: 0, calls: {}, toolErrors: 0, finished: false, transcript: [] })

const picture = async (svg: string, pixels: number) => renderPicture(svg, pixels)

/** The part of the drawing said to be on screen: the whole of every plan the tasks start from. */
const VISIBLE = { minX: -1000, minY: -1000, maxX: 11000, maxY: 9000 }

/** The assistant built into the app, as the app runs it. */
export async function runAssistant(task: Task, start: Document, provider: Provider, signal: AbortSignal): Promise<RunResult> {
  const run = blank(start)
  const host: AgentHost = {
    registry,
    state: () => ({ doc: run.doc, scope: PAGE, selection: task.selection ?? [], activeLayer: Object.keys(run.doc.layers)[0], visible: VISIBLE }),
    // As the store does (`applied`): the edit, and what follows from it.
    apply: (ops) => {
      run.doc = applyEdit(run.doc, ops, registry).doc
    },
    ...(provider.pictures ? { picture } : {}),
  }
  const session = recorded(provider.createSession({ system: systemPrompt(registry, provider.pictures), tools: toolsFor(provider.pictures) }), run)
  try {
    await runRequest(session, host, task.prompt, { onText: () => {}, onActivity: (kind, text) => kind === 'error' && run.transcript.push({ note: text }) }, signal)
  } catch (error) {
    run.error = provider.describeError(error) || 'stopped'
    run.transcript.push({ error: run.error })
  }
  return run
}

/** What an MCP client such as Claude Code tells its model besides the server's own instructions, kept short. */
const OUTSIDE_PROMPT = `You are an agent working for a person at their computer. You have the tools of the MCP server "opencalque", connected to the drawing they want you to work on, which is already open. Carry out their request with those tools, then reply in one or two sentences saying what you did.`

/** An agent outside the app, through the MCP server. */
export async function runOutside(task: Task, start: Document, provider: Provider, signal: AbortSignal): Promise<RunResult> {
  const run = blank(start)
  const host: DrawingHost = {
    registry,
    doc: () => run.doc,
    scope: () => PAGE,
    apply: (ops) => {
      run.doc = applyEdit(run.doc, ops, registry).doc
    },
    ...(provider.pictures ? { picture } : {}),
  }
  const backend: Backend = { tools: DRAWING_TOOLS, call: (name, input) => runDrawingTool(name, input, host) }
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  await mcpServer(backend, registry, 'eval').connect(theirs)
  const client = new Client({ name: 'opencalque-evals', version: '1' })
  await client.connect(ours)
  try {
    const listed = (await client.listTools()).tools
    const tools: ToolSpec[] = listed.filter((tool) => provider.pictures || tool.name !== 'view_drawing').map((tool) => ({ name: tool.name, description: tool.description ?? '', schema: tool.inputSchema }))
    const system = `${OUTSIDE_PROMPT}\n\nWhat the server says of itself:\n${client.getInstructions() ?? ''}`
    const session = recorded(provider.createSession({ system, tools }), run)
    let input: TurnInput = { text: task.outside ?? task.prompt }
    for (let step = 0; step < OUTSIDE_STEPS; step++) {
      const output = await session.send(input, () => {}, signal)
      if (output.stop !== 'tools') {
        if (output.stop !== 'done') run.transcript.push({ note: `stopped: ${output.stop}` })
        break
      }
      const results: ToolResult[] = []
      for (const call of output.calls) {
        const args = call.input && typeof call.input === 'object' && !Array.isArray(call.input) ? (call.input as Record<string, unknown>) : {}
        const answer = await client.callTool({ name: call.name, arguments: args })
        const parts = (answer.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[]
        const image = parts.find((part) => part.type === 'image')
        results.push({
          id: call.id,
          content: parts.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n'),
          ...(answer.isError ? { isError: true } : {}),
          ...(image?.data && image.mimeType ? { image: { mime: image.mimeType, data: image.data } } : {}),
        })
      }
      input = { results }
    }
    if (!run.finished && !run.transcript.some((entry) => 'note' in entry)) run.transcript.push({ note: `stopped after ${OUTSIDE_STEPS} steps` })
  } catch (error) {
    run.error = provider.describeError(error) || 'stopped'
    run.transcript.push({ error: run.error })
  } finally {
    await client.close()
  }
  return run
}

export const runOn = (surface: Surface) => (surface === 'assistant' ? runAssistant : runOutside)

/** Whether a task can be run on a surface with a provider that can or cannot see pictures. */
export const runs = (task: Task, surface: Surface, pictures: boolean) => (pictures || !task.pictures) && (surface === 'assistant' || !task.selection || !!task.outside)
