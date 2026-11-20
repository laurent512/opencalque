/**
 * The last errors of this session, kept so that a bug report can carry them when the person
 * chooses to (`Feedback.tsx`). Only in memory: nothing is written anywhere or sent unless asked.
 */

import { LIMITS } from './report'

const started = Date.now()
const kept: string[] = []

/**
 * Takes the folders out of addresses and paths in a stack, which on the desktop hold the name of
 * the person's account (`C:\Users\…`): `at f (file:///C:/Users/x/…/assets/index-abc.js:3:9)`
 * becomes `at f (index-abc.js:3:9)`.
 */
export function withoutPaths(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s()]*\//gi, '').replace(/[A-Za-z]:\\[^\s()]*\\/g, '').replace(/(^|[\s(])\/(?:[^\s()/]+\/)+/g, '$1')
}

/** Keeps one error, with the time it came since the app started. */
export function noteError(error: unknown): void {
  const seconds = Math.round((Date.now() - started) / 1000)
  const what = error instanceof Error ? `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 6).join('\n')}` : String(error)
  kept.push(`[${seconds} s] ${withoutPaths(what).trim()}`.slice(0, LIMITS.error))
  if (kept.length > LIMITS.errors) kept.shift()
}

/** The errors kept, oldest first. */
export const recentErrors = (): string[] => [...kept]

/** Seconds since the app started, for the report's environment. */
export const sessionSeconds = () => Math.round((Date.now() - started) / 1000)

/** Listens for what nothing else caught. Called once, at start. */
export function noteUncaughtErrors(): void {
  window.addEventListener('error', (e) => noteError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => noteError(e.reason))
}
