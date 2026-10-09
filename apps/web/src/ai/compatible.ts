import { t } from '../i18n'
import { PICTURE_GONE, shorten, type Provider, type ToolCall, type TurnInput } from './types'

/** Makes an HTTP request and returns the status and the body as text. Supplied by the caller so the desktop app can route it. */
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body: string }, signal: AbortSignal) => Promise<{ status: number; body: string }>

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Models other than Claude, through the chat-completions protocol that OpenAI introduced and most
 * other services and local runners (Ollama, LM Studio, OpenRouter, Mistral…) also accept.
 */
export function compatibleProvider(config: { apiKey: string; model: string; baseUrl: string }, http: Http): Provider {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  type Message = Record<string, unknown>
  /** What `snapshot` returns and `createSession` takes back: everything but the instructions. */
  interface History {
    messages: Message[]
    unanswered: string[]
  }
  const imagePart = (picture: { mime: string; data: string }) => ({ type: 'image_url', image_url: { url: `data:${picture.mime};base64,${picture.data}` } })
  /** A copy of the conversation small enough to store: no pictures and no old copies of the drawing. */
  const compact = (messages: Message[]): Message[] =>
    messages.map((message) => {
      const { content } = message
      if (typeof content === 'string') return { ...message, content: shorten(content) }
      if (!Array.isArray(content)) return message
      return { ...message, content: content.map((part) => (part.type === 'text' ? { ...part, text: shorten(part.text) } : { type: 'text', text: PICTURE_GONE })) }
    })

  return {
    pictures: true,
    createSession({ system, tools, history }) {
      const earlier = history as History | undefined
      let messages: Message[] = [{ role: 'system', content: system }, ...(earlier?.messages ?? [])]
      let unanswered: string[] = earlier?.unanswered ?? []

      return {
        async send(input: TurnInput, onText, signal) {
          const added: Record<string, unknown>[] = []
          if ('results' in input) {
            for (const r of input.results) added.push({ role: 'tool', tool_call_id: r.id, content: r.content })
            // This protocol has no pictures in tool results, so they follow as a user message.
            for (const r of input.results) {
              if (!r.image) continue
              added.push({ role: 'user', content: [{ type: 'text', text: 'The picture requested above:' }, imagePart(r.image)] })
            }
          } else {
            for (const id of unanswered) added.push({ role: 'tool', tool_call_id: id, content: 'Interrupted before it ran.' })
            added.push({ role: 'user', content: input.images?.length ? [{ type: 'text', text: input.text }, ...input.images.map(imagePart)] : input.text })
          }
          const next = [...messages, ...added]

          const headers: Record<string, string> = { 'content-type': 'application/json' }
          if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
          const body = JSON.stringify({
            model: config.model,
            messages: next,
            tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } })),
          })
          const response = await http(url, { method: 'POST', headers, body }, signal)
          if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
          if (response.status < 200 || response.status >= 300) throw new HttpError(response.status, response.body.slice(0, 400))
          const choice = JSON.parse(response.body).choices?.[0]
          const message = choice?.message
          if (!message) throw new Error(t('The service returned no message.'))
          if (typeof message.content === 'string' && message.content) onText(message.content)

          const calls: ToolCall[] = (message.tool_calls ?? []).map((call: any) => {
            let parsed: unknown
            try {
              parsed = JSON.parse(call.function.arguments)
            } catch {
              // Left unparsed on purpose: the tool rejects it and the model is told to try again.
              parsed = call.function.arguments
            }
            return { id: call.id, name: call.function.name, input: parsed }
          })
          if (choice.finish_reason === 'length' && calls.length > 0) return { calls: [], stop: 'truncated' }
          if (choice.finish_reason === 'content_filter') return { calls: [], stop: 'refused' }

          messages = [...next, message]
          unanswered = calls.map((call) => call.id)
          return { calls, stop: calls.length > 0 ? 'tools' : 'done' }
        },
        snapshot: (): History => ({ messages: compact(messages.slice(1)), unanswered }),
      }
    },

    describeError(error) {
      if (error instanceof DOMException && error.name === 'AbortError') return ''
      if (error instanceof HttpError) {
        if (error.status === 401 || error.status === 403) return t('The API key was rejected. Check it in Preferences.')
        if (error.status === 404) return t('The service did not recognise the model “{model}” or the address {url}.', { model: config.model, url })
        if (error.status === 429) return t('Rate limit reached. Wait a moment and try again.')
        return t('The service returned an error ({status}): {reason}', { status: String(error.status), reason: error.message })
      }
      // A request that never got an answer: the address is wrong, or nothing is listening there.
      if (!(error instanceof HttpError) && !(error instanceof SyntaxError)) return t('Could not reach {url}. Check the address and that the service is running.', { url })
      return error instanceof Error ? error.message : String(error)
    },
  }
}
