import { AsyncLocalStorage } from 'node:async_hooks'

/*
 * Counts the tokens each run uses without changing the app's providers: they call `fetch`, so it
 * is wrapped once, and each run reads its own meter through AsyncLocalStorage, which follows a
 * run through its promises while several run at once. Anthropic's streamed replies give usage in
 * their `message_start` and `message_delta` events; services of the chat-completions protocol in
 * `usage` of the body.
 */

export interface Usage {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const noUsage = (): Usage => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

interface Meter {
  usage: Usage
  reading: Promise<void>[]
}

const meters = new AsyncLocalStorage<Meter>()
let installed = false

type Counts = Record<string, number | undefined>

function add(usage: Usage, counts: Counts | undefined, output = true): void {
  if (!counts) return
  usage.input += counts.input_tokens ?? counts.prompt_tokens ?? 0
  usage.cacheRead += counts.cache_read_input_tokens ?? 0
  usage.cacheWrite += counts.cache_creation_input_tokens ?? 0
  if (output) usage.output += counts.output_tokens ?? counts.completion_tokens ?? 0
}

async function read(response: Response, usage: Usage): Promise<void> {
  const body = await response.text()
  if (!(response.headers.get('content-type') ?? '').includes('event-stream')) {
    add(usage, (JSON.parse(body) as { usage?: Counts }).usage)
    return
  }
  // The final message_delta carries the whole output count; message_start only its first token.
  let output = 0
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const event = JSON.parse(line.slice(5)) as { type?: string; message?: { usage?: Counts }; usage?: Counts }
    if (event.type === 'message_start') add(usage, event.message?.usage, false)
    if (event.type === 'message_delta') output = event.usage?.output_tokens ?? output
  }
  usage.output += output
}

/** Wraps `fetch` so that what each request uses is added to the meter of the run that made it. */
export function installMeter(): void {
  if (installed) return
  installed = true
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init)
    const meter = meters.getStore()
    if (meter && response.ok) {
      meter.usage.requests++
      meter.reading.push(read(response.clone(), meter.usage).catch(() => {}))
    }
    return response
  }
}

/** Runs `work` with a meter of its own, and returns what it used. */
export async function metered<T>(work: () => Promise<T>): Promise<{ value: T; usage: Usage }> {
  const meter: Meter = { usage: noUsage(), reading: [] }
  const value = await meters.run(meter, work)
  await Promise.all(meter.reading)
  return { value, usage: meter.usage }
}
