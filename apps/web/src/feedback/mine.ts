import { create } from 'zustand'
import { t } from '../i18n'
import { toast } from '../windows'
import { readThread } from './send'
import type { Thread } from './thread'

/**
 * The reports sent from this device, with the key that reads their answers and replies to them
 * ("Your reports" in the report window). They are kept with the app's other data in the browser's
 * storage (the profile, in the desktop app), which updates leave as it is; the key is what makes
 * the person the author of their report, so a device that loses it can still send a new report.
 */
export interface MyReport {
  number: number
  title: string
  /** The issue on GitHub. */
  url: string
  key: string
  /** When it was sent, in milliseconds. */
  sent: number
  /** Answers to it, as last read (`answersIn`). */
  answers: number
  /** Answers the person has seen. */
  seen: number
  closed?: boolean
}

interface Mine {
  /** Newest first. */
  reports: MyReport[]
  /** When the answers were last looked for at start. */
  checked: number
}

const STORAGE_KEY = 'opencalque.reports'
/** Reports kept; older ones are forgotten. */
const KEPT = 50
/** Reports whose answers are looked for at start, newest first. */
const CHECKED = 10
/** How long after looking for answers the app looks again at start. */
const CHECK_EVERY = 6 * 3_600_000

function load(): Mine {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const reports = Array.isArray(stored.reports) ? stored.reports.filter((r: MyReport) => r && Number.isInteger(r.number) && typeof r.key === 'string' && typeof r.url === 'string') : []
    return { reports: reports.slice(0, KEPT), checked: typeof stored.checked === 'number' ? stored.checked : 0 }
  } catch {
    return { reports: [], checked: 0 }
  }
}

export const useMyReports = create<Mine>(load)

useMyReports.subscribe((mine) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mine))
  } catch {
    // Storage is full or unavailable: the reports are still on GitHub, through the link shown when they were sent.
  }
})

/** Keeps a report just sent. */
export function remember(report: { number: number; title: string; url: string; key: string }, now = Date.now()): void {
  useMyReports.setState((mine) => ({
    reports: [{ ...report, sent: now, answers: 0, seen: 0 }, ...mine.reports.filter((r) => r.number !== report.number)].slice(0, KEPT),
  }))
}

/** The answers in a thread: what the project and people on GitHub wrote, not the person's report and replies. */
export const answersIn = (thread: Thread) => thread.entries.filter((e) => e.from === 'team' || e.from === 'someone').length

export const unread = (report: MyReport) => report.answers > report.seen

function update(number: number, thread: Thread, seen: boolean): void {
  const answers = answersIn(thread)
  useMyReports.setState((mine) => ({
    reports: mine.reports.map((r) => (r.number === number ? { ...r, title: thread.title, answers, seen: seen ? answers : r.seen, closed: thread.state === 'closed' } : r)),
  }))
}

/** The person has read the thread: its answers are no longer new. */
export const read = (number: number, thread: Thread) => update(number, thread, true)

/**
 * Looks for new answers to the reports sent from here, at most every few hours, and says so when
 * there are. Nothing is said when the server cannot be reached.
 */
export async function checkAnswers(now = Date.now()): Promise<void> {
  const { reports, checked } = useMyReports.getState()
  if (reports.length === 0 || now - checked < CHECK_EVERY) return
  useMyReports.setState({ checked: now })
  const answered: MyReport[] = []
  for (const report of reports.slice(0, CHECKED)) {
    const thread = await readThread(report.number, report.key)
    if ('status' in thread) continue
    if (answersIn(thread) > report.answers) answered.push(report)
    update(report.number, thread, false)
  }
  if (answered.length > 0) toast(t('There is a new answer to your report “{title}”: see Feedback, in the Preferences menu.', { title: answered[0].title }))
}
