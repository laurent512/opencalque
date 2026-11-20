/**
 * A bug report or an idea sent from inside the app, as the editor sends it and the site's worker
 * (`apps/web/worker`) turns it into a GitHub issue. Nothing here touches the DOM, so the worker
 * imports it too: the limits checked before sending are the ones checked on arrival.
 */

export type ReportKind = 'bug' | 'idea'

export interface Report {
  kind: ReportKind
  title: string
  description: string
  /** For a bug: what the person expected instead. */
  expected?: string
  /** Where it was sent from, label → value (version, web or desktop, system, language…), shown in the issue as a table. */
  environment: Record<string, string>
  /** The last errors the app ran into, oldest first, when the person chose to attach them. */
  errors?: string[]
  /** The open drawing without its pictures (`withoutAssets`), as saved, when the person chose to attach it. */
  drawing?: { name: string; content: string }
  /** The drawing area as a PNG, base64 without the `data:` prefix, when the person chose to attach it. */
  screenshot?: string
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
  /** Characters of base64. */
  screenshot: 3_000_000,
  /** The whole request, which holds all of the above. */
  body: 7_000_000,
}

/** Labels every issue sent from the app carries, by kind. `from-app` says there is no GitHub account to answer. */
export const LABELS: Record<ReportKind, string[]> = { bug: ['bug', 'from-app'], idea: ['enhancement', 'from-app'] }

const text = (value: unknown): value is string => typeof value === 'string'

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
  if (r.screenshot !== undefined && (!text(r.screenshot) || r.screenshot.length > LIMITS.screenshot || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.screenshot))) return 'The screenshot must be a PNG in base64, of a reasonable size'
  return {
    kind: r.kind,
    title: r.title.trim(),
    description: r.description,
    ...(text(r.expected) && r.expected.trim() && { expected: r.expected }),
    environment: Object.fromEntries(environment) as Record<string, string>,
    ...(Array.isArray(r.errors) && r.errors.length > 0 && { errors: r.errors as string[] }),
    ...(r.drawing !== undefined && { drawing: r.drawing as Report['drawing'] }),
    ...(text(r.screenshot) && r.screenshot && { screenshot: r.screenshot }),
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
  screenshot?: string
  /** Why the attachments the person chose are not there, when they could not be stored. */
  missing?: string
}

/** The issue's text, in English, as maintainers read it. */
export function issueBody(report: Report, stored: StoredAttachments = {}): string {
  const parts: string[] = [report.description.trim() ? inert(report.description.trim()) : '_No description._']
  if (report.expected?.trim()) parts.push(`### Expected\n\n${inert(report.expected.trim())}`)
  const attached: string[] = []
  if (stored.screenshot) attached.push(`![The drawing area when the report was written](${stored.screenshot})`)
  if (stored.drawing) attached.push(`- Drawing: [${cell(report.drawing?.name ?? 'drawing.opencalque')}](${stored.drawing})`)
  if (stored.missing) attached.push(`_${stored.missing}_`)
  if (attached.length > 0) parts.push(`### Attached\n\n${attached.join('\n\n')}`)
  if (report.errors?.length) parts.push(`### Recent errors\n\n${fenced(report.errors.join('\n\n'))}`)
  const rows = Object.entries(report.environment).map(([label, value]) => `| ${cell(label)} | ${cell(value)} |`)
  if (rows.length > 0) parts.push(`<details><summary>Environment</summary>\n\n| | |\n|---|---|\n${rows.join('\n')}\n\n</details>`)
  parts.push('_Sent from inside OpenCalque by someone who may not have a GitHub account: they can read the answers here, but may not reply._')
  return parts.join('\n\n')
}

/** The title of the issue, made inert like the rest. */
export const issueTitle = (report: Report) => inert(report.title.trim()).slice(0, LIMITS.title + 20)

/**
 * GitHub's page for a new issue, filled in with the report, for when it cannot be sent from the
 * app: the person then posts it themselves, with their own account. Attachments cannot go in an
 * address, and a long description is cut to keep the address short enough for every browser.
 */
export function newIssueUrl(repository: string, report: Report): string {
  const room = 5000
  const cut = report.description.length > room ? { ...report, description: `${report.description.slice(0, room)}…` } : report
  const body = issueBody({ ...cut, errors: cut.errors?.slice(-5), drawing: undefined, screenshot: undefined }).replace(/\n\n_Sent from inside OpenCalque[^]*$/, '')
  const query = new URLSearchParams({ title: report.title.trim(), body, labels: LABELS[report.kind][0] })
  return `${repository}/issues/new?${query}`
}
