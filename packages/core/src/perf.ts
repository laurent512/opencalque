/**
 * What the app spends its time on, measured while profiling is on (the editor's performance
 * monitor): spans of time by name (`span`), nested as they run, and counts (`count`), gathered
 * until the monitor takes them (`takeMeasures`), once a frame. Off, a span costs a test of one
 * flag and nothing is kept. The core measures what it does (edits and what follows them, the scene,
 * views); the editor what it does around it (painting, the labels of views).
 */

import { host } from './host'

/** One span of time: what ran, when it started and how long it took, in ms, and how deep in other spans it was. */
export interface Span {
  name: string
  start: number
  ms: number
  depth: number
}

let on = false
let depth = 0
let spans: Span[] = []
let counts = new Map<string, number>()
/** Spans kept at most between two takes, so that nothing grows while no monitor takes them. */
const KEPT = 20_000

export const profiling = () => on

/** Starts or stops measuring; what was measured is let go. */
export function setProfiling(enabled: boolean): void {
  on = enabled
  spans = []
  counts = new Map()
  depth = 0
}

/** Runs `run`, measured as `name` while profiling is on. */
export function span<T>(name: string, run: () => T): T {
  if (!on) return run()
  const start = host.performance.now()
  depth++
  try {
    return run()
  } finally {
    depth--
    if (spans.length < KEPT) spans.push({ name, start, ms: host.performance.now() - start, depth })
  }
}

/** Counts something that happened (a view kept, a view laid out again) while profiling is on. */
export function count(name: string, by = 1): void {
  if (on) counts.set(name, (counts.get(name) ?? 0) + by)
}

/** What was measured since the last take, which starts afresh. */
export function takeMeasures(): { spans: Span[]; counts: Map<string, number> } {
  const taken = { spans, counts }
  spans = []
  counts = new Map()
  return taken
}
