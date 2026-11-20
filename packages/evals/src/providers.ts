import { anthropicProvider } from '../../../apps/web/src/ai/anthropic'
import { compatibleProvider } from '../../../apps/web/src/ai/compatible'
import type { Provider } from '../../../apps/web/src/ai/types'
import { installMeter } from './meter'

/*
 * The app's own providers, given a key from the environment rather than from Preferences:
 * ANTHROPIC_API_KEY for Claude, EVAL_API_KEY (or OPENAI_API_KEY) for a service of the
 * chat-completions protocol, which a local runner such as Ollama does without.
 */

export interface ProviderChoice {
  provider: 'anthropic' | 'compatible'
  model: string
  /** For 'compatible': the address of the service, such as http://localhost:11434/v1 for Ollama. */
  baseUrl?: string
  /** False for a model that cannot be shown pictures: the tasks that need one are left out. */
  pictures: boolean
}

export function makeProvider(choice: ProviderChoice): Provider {
  // The SDK keeps the `fetch` there is when its client is made, so the meter goes in first.
  installMeter()
  if (choice.provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY to run the evals on Claude.')
    return { ...anthropicProvider({ apiKey, model: choice.model }), pictures: choice.pictures }
  }
  if (!choice.baseUrl) throw new Error('Give the address of the service with --base-url, such as http://localhost:11434/v1 for Ollama.')
  const http = async (url: string, init: { method: string; headers: Record<string, string>; body: string }, signal: AbortSignal) => {
    const response = await fetch(url, { ...init, signal })
    return { status: response.status, body: await response.text() }
  }
  return { ...compatibleProvider({ apiKey: process.env.EVAL_API_KEY ?? process.env.OPENAI_API_KEY ?? '', model: choice.model, baseUrl: choice.baseUrl }, http), pictures: choice.pictures }
}
