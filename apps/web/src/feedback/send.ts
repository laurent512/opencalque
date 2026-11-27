import { language } from '../i18n'
import { platform } from '../platform'
import { usePrefs } from '../prefs'
import { VERSION } from '../release'
import { sessionSeconds } from './errors'
import type { Report } from './report'
import { SAMPLE_KEY, sampleReply, sampleThread } from './samples'
import type { Thread } from './thread'

/**
 * Where reports go: the worker of opencalque.com (`apps/web/worker`), from the web editor, the
 * desktop app and any copy of the editor alike. A build can point elsewhere with
 * `VITE_FEEDBACK_URL`, to try the worker locally with `wrangler dev`.
 */
export const FEEDBACK_URL: string = import.meta.env.VITE_FEEDBACK_URL ?? 'https://opencalque.com/api/feedback'

/** The system, read from the browser's description of itself. */
function system(agent: string): string {
  if (/Windows/.test(agent)) return 'Windows'
  if (/iPhone|iPad/.test(agent)) return 'iOS'
  if (/Mac OS X|Macintosh/.test(agent)) return 'macOS'
  if (/Android/.test(agent)) return 'Android'
  if (/CrOS/.test(agent)) return 'ChromeOS'
  if (/Linux/.test(agent)) return 'Linux'
  return 'Unknown'
}

function browser(agent: string): string {
  const found = agent.match(/(Electron|Edg|Firefox|Chrome|Version)\/([\d.]+)/g) ?? []
  const named = (name: string) => found.find((f) => f.startsWith(`${name}/`))
  const pick = named('Electron') ?? named('Edg')?.replace('Edg', 'Edge') ?? named('Firefox') ?? named('Chrome') ?? (named('Version') && /Safari/.test(agent) ? named('Version')!.replace('Version', 'Safari') : undefined)
  return pick?.replace('/', ' ') ?? 'Unknown'
}

/**
 * What a report says of where it came from. Every entry is shown in the window before sending, so
 * nothing goes that the person has not seen; none of it names them.
 */
export function environment(): Record<string, string> {
  const agent = navigator.userAgent
  const prefs = usePrefs.getState()
  const minutes = Math.floor(sessionSeconds() / 60)
  return {
    Version: VERSION,
    App: platform.desktop ? 'Desktop' : 'Web',
    System: system(agent),
    Browser: browser(agent),
    Language: language(),
    Unit: prefs.unit,
    Screen: `${screen.width} × ${screen.height} at ${devicePixelRatio}×`,
    Window: `${innerWidth} × ${innerHeight}`,
    'Open for': minutes < 1 ? 'less than a minute' : `${minutes} min`,
    'User agent': agent,
  }
}

/** Where the report is, and the key that answers it from the app (none when it went onto another report, or the server kept none). */
export type Sent = { url: string; number?: number; key?: string } | { error: string; status: number }

type Failed = { error: string; status: number }

async function post<T>(url: string, body: unknown): Promise<T | Failed> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const answer = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (response.ok) return answer
    return { error: answer.error ?? response.statusText, status: response.status }
  } catch (error) {
    return { error: (error as Error).message, status: 0 }
  }
}

/** Sends a report; says where the issue is, or why it was not made. */
export async function sendReport(report: Report): Promise<Sent> {
  const answer = await post<{ url?: string; number?: number; key?: string }>(FEEDBACK_URL, report)
  if ('status' in answer) return answer
  if (!answer.url) return { error: 'The server did not say where the report is', status: 502 }
  return { url: answer.url, ...(typeof answer.number === 'number' && { number: answer.number }), ...(typeof answer.key === 'string' && { key: answer.key }) }
}

/** A report this device sent, with the answers to it, read with its key. */
export async function readThread(number: number, key: string): Promise<Thread | Failed> {
  if (import.meta.env.DEV && key === SAMPLE_KEY) return sampleThread(number)
  const answer = await post<Thread>(`${FEEDBACK_URL}/thread`, { number, key })
  if (!('status' in answer) && !Array.isArray(answer.entries)) return { error: 'The server sent no thread', status: 502 }
  return answer
}

/** Posts the person's reply under their report. */
export async function sendReply(number: number, key: string, text: string): Promise<{ url: string } | Failed> {
  if (import.meta.env.DEV && key === SAMPLE_KEY) return sampleReply(number, text)
  return post<{ url: string }>(`${FEEDBACK_URL}/reply`, { number, key, text })
}
