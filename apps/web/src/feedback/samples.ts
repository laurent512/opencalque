import type { MyReport } from './mine'
import type { Thread } from './thread'

/**
 * Development only (`pnpm dev`, `pnpm dev:web`): reports and their answers made up, so that the
 * Feedback window can be seen with a list in it before any report was sent. They are listed only
 * while no report was sent from here, are read and answered without reaching the server, and are
 * left out of every build (`import.meta.env.DEV` in `mine.ts` and `send.ts`).
 */

/** The key the examples carry, by which `send.ts` knows them. */
export const SAMPLE_KEY = '0'.repeat(64)

const issue = (n: number) => `https://github.com/laurent512/opencalque/issues/${n}`

export const SAMPLE_REPORTS: MyReport[] = [
  { number: 9030, title: 'Styles for doors, windows and walls?', url: issue(30), key: SAMPLE_KEY, sent: 1795383600000 /* 2026-11-22T21:40:00Z */, answers: 2, seen: 1 },
  { number: 9017, title: 'Dimensions disappear after undo', url: issue(17), key: SAMPLE_KEY, sent: 1794474900000 /* 2026-11-12T09:15:00Z */, answers: 1, seen: 1, closed: true },
  { number: 9012, title: 'Export to DWG', url: issue(12), key: SAMPLE_KEY, sent: 1795708920000 /* 2026-11-26T16:02:00Z */, answers: 0, seen: 0 },
]

const threads: Record<number, Thread> = {
  9030: {
    number: 9030,
    title: 'Styles for doors, windows and walls?',
    state: 'open',
    url: issue(30),
    entries: [
      { from: 'you', at: '2026-11-22T21:40:00Z', text: 'I would like wall types such as "Exterior wall 36.5" or "Interior wall 11.5", with the thickness, material and layer already set, and the same for doors and windows.' },
      {
        from: 'team',
        at: '2026-11-22T22:03:00Z',
        text: 'Thank you for your report! This is what exists today:\n\n- **Doors**: under **Kind**, single, double, sliding, pocket or opening only, with the hinge, the angle and the width.\n- **Windows**: the number of leaves, the glazing, the sill height.\n- **Walls**: each wall has its own **material**, drawn as set in the **Materials** panel.\n\nTo understand what you miss, could you tell us:\n\n1. How many different walls does a typical plan of yours have?\n2. Should all walls of a type change together, or is it mostly about drawing faster?',
      },
      { from: 'you', at: '2026-11-25T08:12:00Z', text: '1. About 3 to 4, and I switch between them often.\n2. Drawing faster.\n\nPicking the settings before I start drawing would matter most to me. Thanks for your great work!' },
      {
        from: 'team',
        at: '2026-11-25T10:23:00Z',
        text: 'Thank you, that is exactly what we needed to know.\n\n---\n\nThis is how it will work: the **Wall**, **Door** and **Window** tools get a short list of your **saved settings**, picked before you draw. It comes with the next version; we will write here once it is out.',
      },
    ],
  },
  9017: {
    number: 9017,
    title: 'Dimensions disappear after undo',
    state: 'closed',
    url: issue(17),
    entries: [
      { from: 'you', at: '2026-11-12T09:15:00Z', text: 'I draw a dimension, press `Ctrl+Z` on something else, and the dimension is gone too.' },
      { from: 'team', at: '2026-11-14T17:40:00Z', text: 'Thanks, we could do the same here. It is fixed in [2.1.0](https://github.com/laurent512/opencalque/releases/tag/v2.1.0): undo now takes back only the last step.\n\nIf it is still not right, reply here.' },
    ],
  },
  9012: {
    number: 9012,
    title: 'Export to DWG',
    state: 'open',
    url: issue(12),
    entries: [{ from: 'you', at: '2026-11-26T16:02:00Z', text: 'My engineer works in AutoCAD. Could the plans be exported as DWG, not only DXF?' }],
  },
}

const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 300))

/** An example thread, as the server would send it. */
export function sampleThread(number: number): Promise<Thread | { error: string; status: number }> {
  const thread = threads[number]
  return later(thread ? structuredClone(thread) : { error: 'No such example', status: 404 })
}

/** A reply to an example, kept until the page is reloaded. */
export function sampleReply(number: number, text: string): Promise<{ url: string } | { error: string; status: number }> {
  const thread = threads[number]
  if (!thread) return later({ error: 'No such example', status: 404 })
  thread.entries.push({ from: 'you', at: new Date().toISOString(), text })
  thread.state = 'open'
  return later({ url: thread.url })
}
