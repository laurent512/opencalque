import type { Document } from '@opencalque/core'
import type { Provider } from '../../../apps/web/src/ai/types'
import { check, type Check } from './grade'
import { metered, type Usage } from './meter'
import { runOn, type RunResult, type Surface } from './surfaces'
import type { Task } from './tasks'

/*
 * One run of one task, graded: the task's checks against what the run left. A task passes when
 * every check that is not soft passes; its score is the share of its checks that pass, soft ones
 * included, which tells a near miss from a run that went nowhere.
 */

export interface Graded {
  task: string
  surface: Surface
  /** Which repetition of this task, from 1. */
  attempt: number
  passed: boolean
  score: number
  checks: Check[]
  steps: number
  calls: Record<string, number>
  toolErrors: number
  finished: boolean
  error?: string
  usage: Usage
  seconds: number
}

/** The checks of a task on what a run left. A grader that throws fails, rather than stopping the evals. */
export function grade(task: Task, start: Document, doc: Document, reply: string): Check[] {
  try {
    return task.checks({ start, doc, reply })
  } catch (error) {
    return [check('the grader ran', false, (error as Error).stack?.split('\n').slice(0, 3).join(' ') ?? String(error))]
  }
}

export const passedAll = (checks: Check[]) => checks.every((c) => c.pass || c.soft)
export const scoreOf = (checks: Check[]) => (checks.length === 0 ? 0 : checks.filter((c) => c.pass).length / checks.length)

/** Runs a task once on a surface, within `timeout` milliseconds, and grades it. */
export async function evaluate(task: Task, surface: Surface, provider: Provider, attempt: number, timeout: number): Promise<{ graded: Graded; run: RunResult; start: Document }> {
  const start = task.start()
  const began = Date.now()
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeout)
  const { value: run, usage } = await metered(() => runOn(surface)(task, start, provider, stop.signal))
  clearTimeout(timer)
  if (stop.signal.aborted && !run.error) run.error = `timed out after ${Math.round(timeout / 1000)} s`
  const checks = grade(task, start, run.doc, run.reply)
  return {
    start,
    run,
    graded: {
      task: task.id,
      surface,
      attempt,
      passed: passedAll(checks) && !run.error,
      score: scoreOf(checks),
      checks,
      steps: run.steps,
      calls: run.calls,
      toolErrors: run.toolErrors,
      finished: run.finished,
      ...(run.error ? { error: run.error } : {}),
      usage,
      seconds: Math.round((Date.now() - began) / 100) / 10,
    },
  }
}
