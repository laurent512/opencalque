/**
 * A bug report or an idea sent from inside the app, as the editor sends it and the site's worker
 * (`apps/web/worker`) turns it into a GitHub issue. Nothing here touches the DOM, so the worker
 * imports it too: the limits checked before sending are the ones checked on arrival.
 */

export type ReportKind = 'bug' | 'idea'

/** The kinds of video a recording may be: what `MediaRecorder` writes in Chromium (WebM) and in Safari (MP4). */
export const RECORDING_TYPES = ['video/webm', 'video/mp4'] as const
export type RecordingType = (typeof RECORDING_TYPES)[number]

/** A short recording of part of the app, base64 without the `data:` prefix. */
export interface Recording {
  type: RecordingType
  content: string
  /** How long it lasts, as the app measured it while recording. */
  seconds: number
}

export interface Report {
  kind: ReportKind
  title: string
  description: string
  /** What the person expected instead: a field of its own up to 1.13, now part of the description. Still read from those versions. */
  expected?: string
  /** Where it was sent from, label → value (version, web or desktop, system, language…), shown in the issue as a table. */
  environment: Record<string, string>
  /** The last errors the app ran into, oldest first, when the person chose to attach them. */
  errors?: string[]
  /** The open drawing without its pictures (`withoutAssets`), as saved, when the person chose to attach it. */
  drawing?: { name: string; content: string }
  /**
   * Pictures of parts of the app the person took, PNGs in base64 without the `data:` prefix.
   * (Up to 1.13 a report sent one, `screenshot`, which `checkReport` reads as the first.)
   */
  pictures?: string[]
  /** Short recordings of part of the app the person made. */
  recordings?: Recording[]
}

export const LIMITS = {
  title: 120,
  description: 10_000,
  expected: 4_000,
  environment: 20,
  label: 40,
  value: 300,
  errors: 20,
  error: 2_000,
  /** Characters of the drawing as saved: a plan without pictures is far smaller. */
  drawing: 3_000_000,
  pictures: 6,
  /** Characters of base64 of one picture. */
  picture: 3_000_000,
  recordings: 2,
  /** Characters of base64 of one recording. */
  recording: 8_000_000,
  /** Seconds of one recording: the app stops it there. */
  seconds: 30,
  /** The whole request, which holds all of the above. */
  body: 25_000_000,
}

/** Labels every issue sent from the app carries, by kind. `from-app` says there is no GitHub account to answer. */
export const LABELS: Record<ReportKind, string[]> = { bug: ['bug', 'from-app'], idea: ['enhancement', 'from-app'] }

const text = (value: unknown): value is string => typeof value === 'string'
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The first bytes of a file in base64, to tell what it is from what it says it is. */
function head(base64: string): string {
  try {
    return atob(base64.slice(0, 16))
  } catch {
    return ''
  }
}
const isPng = (base64: string) => head(base64).startsWith('\x89PNG')
const isVideo = (base64: string, type: RecordingType) => (type === 'video/webm' ? head(base64).startsWith('\x1a\x45\xdf\xa3') : head(base64).slice(4, 8) === 'ftyp')

/** A picture as sent, or what is wrong with it. */
function checkPicture(value: unknown): string | null {
  return text(value) && value.length <= LIMITS.picture && BASE64.test(value) && isPng(value) ? null : 'Each picture must be a PNG in base64, of a reasonable size'
}

function checkRecording(value: unknown): string | null {
  const r = value as Record<string, unknown> | null
  if (!r || !RECORDING_TYPES.includes(r.type as RecordingType)) return `A recording must be one of ${RECORDING_TYPES.join(', ')}`
  if (typeof r.seconds !== 'number' || !(r.seconds >= 0 && r.seconds <= LIMITS.seconds + 5)) return `A recording lasts at most ${LIMITS.seconds} seconds`
  if (!text(r.content) || r.content.length > LIMITS.recording || !BASE64.test(r.content) || !isVideo(r.content, r.type as RecordingType)) return 'Each recording must be a video in base64, of a reasonable size'
  return null
}

/** Reads a report sent over the network, or says what is wrong with it. */
export function checkReport(input: unknown): Report | string {
  if (!input || typeof input !== 'object') return 'Expected a JSON object'
  const r = input as Record<string, unknown>
  if (r.kind !== 'bug' && r.kind !== 'idea') return 'kind must be "bug" or "idea"'
  if (!text(r.title) || !r.title.trim()) return 'A title is needed'
  if (r.title.length > LIMITS.title) return `The title is longer than ${LIMITS.title} characters`
  if (!text(r.description)) return 'description must be text'
  if (r.description.length > LIMITS.description) return `The description is longer than ${LIMITS.description} characters`
  if (r.expected !== undefined && (!text(r.expected) || r.expected.length > LIMITS.expected)) return `expected must be text of at most ${LIMITS.expected} characters`
  if (!r.environment || typeof r.environment !== 'object' || Array.isArray(r.environment)) return 'environment must be an object'
  const environment = Object.entries(r.environment as Record<string, unknown>)
  if (environment.length > LIMITS.environment) return `At most ${LIMITS.environment} entries of environment`
  for (const [label, value] of environment) {
    if (label.length > LIMITS.label || !text(value) || value.length > LIMITS.value) return `environment.${label.slice(0, LIMITS.label)} is too long or not text`
  }
  if (r.errors !== undefined) {
    if (!Array.isArray(r.errors) || r.errors.length > LIMITS.errors) return `errors must be a list of at most ${LIMITS.errors}`
    if (!r.errors.every((e) => text(e) && e.length <= LIMITS.error)) return `Each error must be text of at most ${LIMITS.error} characters`
  }
  if (r.drawing !== undefined) {
    const d = r.drawing as Record<string, unknown> | null
    if (!d || !text(d.name) || !text(d.content) || d.name.length > 200) return 'drawing must have a name and a content'
    if (d.content.length > LIMITS.drawing) return 'The drawing is too large to attach'
  }
  const media = checkMedia(r)
  if (typeof media === 'string') return media
  return {
    kind: r.kind,
    title: r.title.trim(),
    description: r.description,
    ...(text(r.expected) && r.expected.trim() && { expected: r.expected }),
    environment: Object.fromEntries(environment) as Record<string, string>,
    ...(Array.isArray(r.errors) && r.errors.length > 0 && { errors: r.errors as string[] }),
    ...(r.drawing !== undefined && { drawing: r.drawing as Report['drawing'] }),
    ...media,
  }
}

/** The pictures and recordings sent with a report or a reply, checked, or what is wrong with them. */
export function checkMedia(r: Record<string, unknown>): Pick<Report, 'pictures' | 'recordings'> | string {
  // 1.13 sent one picture, as `screenshot`.
  const pictures = [...(r.screenshot !== undefined ? [r.screenshot] : []), ...(Array.isArray(r.pictures) ? r.pictures : [])]
  if (r.pictures !== undefined && !Array.isArray(r.pictures)) return 'pictures must be a list'
  if (pictures.length > LIMITS.pictures) return `At most ${LIMITS.pictures} pictures`
  for (const picture of pictures) {
    const wrong = checkPicture(picture)
    if (wrong) return wrong
  }
  if (r.recordings !== undefined) {
    if (!Array.isArray(r.recordings) || r.recordings.length > LIMITS.recordings) return `recordings must be a list of at most ${LIMITS.recordings}`
    for (const recording of r.recordings) {
      const wrong = checkRecording(recording)
      if (wrong) return wrong
    }
  }
  return {
    ...(pictures.length > 0 && { pictures: pictures as string[] }),
    ...(Array.isArray(r.recordings) && r.recordings.length > 0 && { recordings: (r.recordings as Recording[]).map(({ type, content, seconds }) => ({ type, content, seconds })) }),
  }
}

/**
 * Keeps what anyone types from notifying people on GitHub: `@name` written in an issue notifies
 * that account, which would let a report reach anyone. A zero-width space after the @ keeps it
 * readable and inert.
 */
export function inert(value: string): string {
  return value.replace(/@(?=[A-Za-z0-9])/g, '@​')
}

/** A fenced block that the text inside cannot close: the fence is longer than any run of backticks in it. */
function fenced(content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${content}\n${fence}`
}

/** A cell of a Markdown table: no line breaks, no column separators. */
const cell = (value: string) => inert(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

/** Where the attached files were stored, to link them from the issue. */
export interface StoredAttachments {
  drawing?: string
  pictures?: string[]
  recordings?: string[]
  /** Why the attachments the person chose are not there, when they could not be stored. */
  missing?: string
}

/** What was attached, as an issue or a reply lists it: pictures shown, recordings and the drawing linked. Empty when nothing was. */
export function attachedSection(report: Pick<Report, 'drawing' | 'recordings'>, stored: StoredAttachments): string {
  const attached: string[] = []
  stored.pictures?.forEach((url, i) => attached.push(`![Picture ${i + 1} taken in the app](${url})`))
  if (stored.recordings?.length) {
    const length = (i: number) => (report.recordings?.[i] ? ` (${Math.round(report.recordings[i].seconds)} s)` : '')
    attached.push(stored.recordings.map((url, i) => `- Recording ${i + 1}${length(i)}: [${url.split('/').pop()}](${url})`).join('\n'))
  }
  if (stored.drawing) attached.push(`- Drawing: [${cell(report.drawing?.name ?? 'drawing.opencalque')}](${stored.drawing})`)
  if (stored.missing) attached.push(`_${stored.missing}_`)
  return attached.length > 0 ? `### Attached\n\n${attached.join('\n\n')}` : ''
}

/** The issue's text, in English, as maintainers read it. */
export function issueBody(report: Report, stored: StoredAttachments = {}): string {
  const parts: string[] = [report.description.trim() ? inert(report.description.trim()) : '_No description._']
  if (report.expected?.trim()) parts.push(`### Expected\n\n${inert(report.expected.trim())}`)
  const attached = attachedSection(report, stored)
  if (attached) parts.push(attached)
  if (report.errors?.length) parts.push(`### Recent errors\n\n${fenced(report.errors.join('\n\n'))}`)
  const rows = Object.entries(report.environment).map(([label, value]) => `| ${cell(label)} | ${cell(value)} |`)
  if (rows.length > 0) parts.push(`<details><summary>Environment</summary>\n\n| | |\n|---|---|\n${rows.join('\n')}\n\n</details>`)
  parts.push('_Sent from inside OpenCalque by someone who may not have a GitHub account: they can read the answers here, but may not reply._')
  return parts.join('\n\n')
}

/** The title of the issue, made inert like the rest. */
export const issueTitle = (report: Report) => inert(report.title.trim()).slice(0, LIMITS.title + 20)

/**
 * The issue a report follows up, when its title names one ("#30 Answers", "About #30"). Having no
 * GitHub account to comment with, people answer a question by sending a new report that names
 * its issue; the worker then posts it there, so that the exchange reads in one place. Only the
 * title counts: a description may name other issues in passing.
 */
export function followedIssue(title: string): number | null {
  const found = title.match(/#(\d{1,7})(?!\d)/)
  const number = found ? Number(found[1]) : 0
  return number > 0 ? number : null
}

/**
 * A report posted as a comment on the issue it follows up: its title first, as the issue would
 * have had it. Anyone can name an issue in a title, so it says it may come from someone else; the
 * person who sent the report replies from the app with its key instead (`replyBody` in `thread.ts`).
 */
export const commentBody = (report: Report, stored: StoredAttachments = {}) =>
  `**${issueTitle(report)}**\n\n${issueBody(report, stored)}\n\n_Sent from the app with this issue’s number in its title: it may not come from the person who sent the report._`

/**
 * GitHub's page for a new issue, filled in with the report, for when it cannot be sent from the
 * app: the person then posts it themselves, with their own account. Attachments cannot go in an
 * address, and a long description is cut to keep the address short enough for every browser.
 */
export function newIssueUrl(repository: string, report: Report): string {
  const room = 5000
  const cut = report.description.length > room ? { ...report, description: `${report.description.slice(0, room)}…` } : report
  const body = issueBody({ ...cut, errors: cut.errors?.slice(-5), drawing: undefined, pictures: undefined, recordings: undefined }).replace(/\n\n_Sent from inside OpenCalque[^]*$/, '')
  const query = new URLSearchParams({ title: report.title.trim(), body, labels: LABELS[report.kind][0] })
  return `${repository}/issues/new?${query}`
}
