import type { Provider, ToolCall, ToolSpec, TurnInput } from './types'

/** Runs one prompt through the Claude Code CLI and returns its reply and conversation id. */
export type RunClaudeCli = (input: { prompt: string; session?: string; model?: string }) => Promise<{ text: string; session: string }>

const BLOCK = /<opencalque-tool>([\s\S]*?)<\/opencalque-tool>/g

/**
 * The CLI answers in text only, so tool use is carried in the text: the model ends its message
 * with one block per call and the results come back in the next prompt.
 */
function protocol(tools: ToolSpec[]): string {
  return `In this conversation you cannot call tools directly, and you must not use any tool of your own. To use one of the tools listed below, end your message with one block per call, exactly in this form:

<opencalque-tool>{"name":"apply_operations","input":{"operations":[]}}</opencalque-tool>

The content of a block is a single JSON object with "name" and "input". After writing blocks, stop: the results arrive in the next message, and you can then continue or give your final answer. When you need no tool, reply normally with no block.

The tools:

${JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input: t.schema })))}`
}

/** Splits a reply into the text meant for the user and the tool calls it asks for. */
export function parseReply(reply: string): { text: string; calls: ToolCall[] } {
  const calls: ToolCall[] = []
  for (const match of reply.matchAll(BLOCK)) {
    const id = `cli_${calls.length + 1}`
    try {
      const { name, input } = JSON.parse(match[1])
      calls.push({ id, name: String(name), input })
    } catch {
      // Passed on as a call to a tool that does not exist, so the model is told and can retry.
      calls.push({ id, name: 'unreadable tool block', input: match[1] })
    }
  }
  return { text: reply.replace(BLOCK, '').trim(), calls }
}

/**
 * Claude through the Claude Code CLI installed on this computer, using whatever account the CLI is
 * signed in with. Desktop only: a web page cannot start a program.
 */
export function claudeCliProvider(config: { model: string }, run: RunClaudeCli, describe: (error: unknown) => string): Provider {
  return {
    // The CLI takes its prompt as text.
    pictures: false,
    createSession({ system, tools, history }) {
      // The CLI keeps conversations itself; all there is to remember is which one this is.
      let session = (history as { session?: string } | undefined)?.session

      return {
        async send(input: TurnInput, onText, signal) {
          let prompt: string
          if ('results' in input) {
            const results = input.results.map((r) => ({ id: r.id, ok: !r.isError, result: r.image ? `${r.content} (The picture itself cannot be shown through this provider.)` : r.content }))
            prompt = `Tool results:\n${JSON.stringify(results)}`
          } else {
            // The CLI keeps the conversation, so the instructions go in once, with the first message.
            prompt = session ? input.text : `${system}\n\n${protocol(tools)}\n\n${input.text}`
          }
          const reply = await run({ prompt, session, model: config.model || undefined })
          if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
          session = reply.session
          const { text, calls } = parseReply(reply.text)
          if (text) onText(text)
          return { calls, stop: calls.length > 0 ? 'tools' : 'done' }
        },
        snapshot: () => ({ session }),
      }
    },
    describeError: describe,
  }
}
