import type { MyReport } from './mine'
import type { ReplyMedia } from './send'
import type { Thread } from './thread'

/**
 * Development only (`pnpm dev`, `pnpm dev:web`): reports and their answers made up, so that the
 * Feedback window can be seen with a list in it before any report was sent. They are listed only
 * while no report was sent from here, are read and answered without reaching the server, and are
 * left out of every build (`import.meta.env.DEV` in `mine.ts` and `send.ts`). Their picture and
 * recording are drawn here when shown.
 */

/** The key the examples carry, by which `send.ts` knows them. */
export const SAMPLE_KEY = '0'.repeat(64)

const issue = (n: number) => `https://github.com/laurent512/opencalque/issues/${n}`
/** Where the examples' files seem to be: where reports' files are, in a folder of their own. */
const FILES = `${import.meta.env.VITE_FEEDBACK_URL ?? 'https://opencalque.com/api/feedback'}/files/2026-11-12-sample/`

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
      {
        from: 'you',
        at: '2026-11-25T08:12:00Z',
        text: `1. About 3 to 4, and I switch between them often.\n2. Drawing faster.\n\nPicking the settings before I start drawing would matter most to me. Here is how I switch today:\n\n- Recording 1 (3 s): [recording-1.webm](${FILES}recording-1.webm)`,
      },
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
      { from: 'you', at: '2026-11-12T09:15:00Z', text: `I draw a dimension, press \`Ctrl+Z\` on something else, and the dimension is gone too.\n\n![Picture 1 taken in the app](${FILES}picture-1.png)` },
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

/** Files of replies to the examples, kept until the page is reloaded. */
const replied = new Map<string, Blob>()
let replies = 0

const blobOf = (base64: string, type: string) => new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type })

/** A reply to an example, with what it attached, kept until the page is reloaded. */
export function sampleReply(number: number, text: string, media: ReplyMedia): Promise<{ url: string } | { error: string; status: number }> {
  const thread = threads[number]
  if (!thread) return later({ error: 'No such example', status: 404 })
  const at = `${FILES}reply-${++replies}-`
  const attached: string[] = []
  media.pictures?.forEach((picture, i) => {
    replied.set(`${at}picture-${i + 1}.png`, blobOf(picture, 'image/png'))
    attached.push(`![Picture ${i + 1} taken in the app](${at}picture-${i + 1}.png)`)
  })
  media.recordings?.forEach((recording, i) => {
    const name = `recording-${i + 1}.${recording.type === 'video/mp4' ? 'mp4' : 'webm'}`
    replied.set(`${at}${name}`, blobOf(recording.content, recording.type))
    attached.push(`- Recording ${i + 1} (${Math.round(recording.seconds)} s): [${name}](${at}${name})`)
  })
  thread.entries.push({ from: 'you', at: new Date().toISOString(), text: [text.trim(), ...attached].filter(Boolean).join('\n\n') })
  thread.state = 'open'
  return later({ url: thread.url })
}

export const isSampleFile = (url: string) => url.startsWith(FILES)

/** The examples' files: drawn for the picture and the recording of the examples, as sent for replies to them. */
export async function sampleFile(url: string): Promise<Blob | null> {
  if (replied.has(url)) return replied.get(url)!
  if (url === `${FILES}picture-1.png`) return drawn(1)
  if (url === `${FILES}recording-1.webm`) return recorded()
  return null
}

/** A plan as a picture of the app might show it: a room, a door, a dimension, at `progress` of drawing the dimension. */
function sketch(context: CanvasRenderingContext2D, width: number, height: number, progress: number) {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#eeeeee'
  context.lineWidth = 1
  for (let x = 0; x < width; x += 20) context.strokeRect(x, 0, 0, height)
  for (let y = 0; y < height; y += 20) context.strokeRect(0, y, width, 0)
  context.strokeStyle = '#333333'
  context.lineWidth = 10
  context.strokeRect(80, 70, width - 160, height - 150)
  context.clearRect(80 + 110, height - 85, 70, 10)
  context.lineWidth = 2
  context.beginPath()
  context.arc(80 + 110, height - 80, 70, -Math.PI / 2, 0)
  context.stroke()
  const end = 80 + (width - 160) * progress
  context.strokeStyle = '#0d99ff'
  context.fillStyle = '#0d99ff'
  context.beginPath()
  context.moveTo(80, 40)
  context.lineTo(end, 40)
  context.stroke()
  context.font = '16px system-ui, sans-serif'
  if (progress >= 1) context.fillText('4.20', width / 2 - 16, 32)
}

function drawn(progress: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  sketch(canvas.getContext('2d')!, canvas.width, canvas.height, progress)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** Three seconds of the dimension being drawn. */
function recorded(): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 300
  const context = canvas.getContext('2d')!
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
  const parts: Blob[] = []
  recorder.ondataavailable = (e) => parts.push(e.data)
  const start = performance.now()
  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }))
    const frame = () => {
      const seconds = (performance.now() - start) / 1000
      sketch(context, canvas.width, canvas.height, Math.min(1, seconds / 2))
      if (seconds < 3) requestAnimationFrame(frame)
      else recorder.stop()
    }
    recorder.start()
    frame()
  })
}
