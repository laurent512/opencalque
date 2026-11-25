/**
 * The only code opencalque.com runs on its server. Every other address is a file of the web
 * editor, served by Cloudflare without reaching this script (`run_worker_first` in
 * wrangler.jsonc names the addresses that do).
 *
 * `POST /api/feedback` takes a bug report or an idea from the editor (`Report`, in
 * `src/feedback/report.ts`) and posts it as an issue on GitHub as the feedback GitHub App, so
 * that people need no GitHub account to send one. The App's private key is a secret of the
 * worker and never reaches the app. An issue made through GitHub's API cannot hold files, so the
 * files attached to a report (the drawing, pictures, recordings) are kept in an R2 bucket, served by
 * `GET /api/feedback/files/…`, and the issue links them. See ARCHITECTURE, "Reports from the
 * app", for setting it up.
 */

import { checkReport, commentBody, followedIssue, issueBody, issueTitle, LABELS, LIMITS, type Report, type StoredAttachments } from '../src/feedback/report'
import { github, GitHubError, installationToken } from './github'

/** The label every report from the app carries (`LABELS`), by which a follow-up finds its issue. */
const FROM_APP = 'from-app'

/** The part of an R2 bucket the worker uses. */
export interface Bucket {
  put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string; contentDisposition?: string } } | null>
}

/** What Cloudflare gives the worker (wrangler.jsonc, and `wrangler secret put` for the App). */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Requests a visitor may make in a minute, by address (the `ratelimits` binding). */
  FEEDBACK_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> }
  GITHUB_APP_ID?: string
  GITHUB_APP_KEY?: string
  /** "owner/name" of the repository issues go to. */
  FEEDBACK_REPO: string
  /** Where attached files are kept; without it, they are left out and the issue says so. */
  FEEDBACK_FILES?: Bucket
}

/**
 * The desktop app's page has no origin of its own (it is a file), and copies of the editor may be
 * served from anywhere: the endpoint answers every origin. It holds no one's session, so that
 * gives nothing away; the limit per address is what keeps it from being flooded.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const FILES = '/api/feedback/files/'
/** The only names files are kept under: a report's folder, then one of the files it may have (`screenshot.png` is how 1.13's picture was kept). */
const FILE_NAME = /^\d{4}-\d\d-\d\d-[0-9a-f]{18}\/(screenshot\.png|picture-[1-9]\.png|recording-[1-9]\.(webm|mp4)|drawing\.opencalque)$/

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

/** A folder name nobody can guess, so that attached files are found only from their issue. */
function folder(now: Date): string {
  const random = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${now.toISOString().slice(0, 10)}-${random}`
}

async function storeAttachments(env: Env, origin: string, report: Report): Promise<StoredAttachments> {
  if (!report.drawing && !report.pictures && !report.recordings) return {}
  if (!env.FEEDBACK_FILES) return { missing: 'The person attached files, but this server keeps none.' }
  try {
    const at = folder(new Date())
    const stored: StoredAttachments = {}
    const store = async (name: string, base64: string, contentType: string) => {
      await env.FEEDBACK_FILES!.put(`${at}/${name}`, bytesOf(base64), { httpMetadata: { contentType } })
      return `${origin}${FILES}${at}/${name}`
    }
    if (report.pictures) stored.pictures = await Promise.all(report.pictures.map((picture, i) => store(`picture-${i + 1}.png`, picture, 'image/png')))
    if (report.recordings) {
      stored.recordings = await Promise.all(report.recordings.map((r, i) => store(`recording-${i + 1}.${r.type === 'video/mp4' ? 'mp4' : 'webm'}`, r.content, r.type)))
    }
    if (report.drawing) {
      const name = report.drawing.name.replace(/[^\p{L}\p{N} ._-]/gu, '_')
      await env.FEEDBACK_FILES.put(`${at}/drawing.opencalque`, report.drawing.content, {
        httpMetadata: { contentType: 'application/json', contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
      })
      stored.drawing = `${origin}${FILES}${at}/drawing.opencalque`
    }
    return stored
  } catch (error) {
    console.error(error)
    return { missing: 'The person attached files, but they could not be stored.' }
  }
}

/**
 * The issue a report names in its title (`followedIssue`), when that is a report sent from the app
 * too: the report is then a comment on it. Anything else named (an issue someone opened on GitHub,
 * a pull request, no issue at all) gets a new issue as before, so that a report cannot be pushed
 * onto any thread of the repository, and one whose issue cannot be read is not lost.
 */
async function followedUp(token: string, repository: string, report: Report): Promise<{ number: number; state: string } | null> {
  const number = followedIssue(report.title)
  if (!number) return null
  try {
    const issue = await github<{ number: number; state: string; pull_request?: unknown; labels: (string | { name?: string })[] }>(token, 'GET', `/repos/${repository}/issues/${number}`)
    const fromApp = issue.labels.some((label) => (typeof label === 'string' ? label : label.name) === FROM_APP)
    return fromApp && !issue.pull_request ? { number: issue.number, state: issue.state } : null
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) console.error(error)
    return null
  }
}

export async function feedback(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json(405, { error: 'Use POST' })
  if (Number(request.headers.get('Content-Length') ?? 0) > LIMITS.body) return json(413, { error: 'The report is too large' })
  if (env.FEEDBACK_LIMIT) {
    const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (!(await env.FEEDBACK_LIMIT.limit({ key: visitor })).success) return json(429, { error: 'Too many reports from this address; try again in a minute' })
  }
  const body = await request.text()
  if (body.length > LIMITS.body) return json(413, { error: 'The report is too large' })
  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return json(400, { error: 'The report is not JSON' })
  }
  const report = checkReport(input)
  if (typeof report === 'string') return json(400, { error: report })
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_KEY) return json(503, { error: 'Reports are not set up on this server' })

  try {
    const token = await installationToken({ id: env.GITHUB_APP_ID, key: env.GITHUB_APP_KEY }, env.FEEDBACK_REPO)
    const stored = await storeAttachments(env, new URL(request.url).origin, report)
    const followed = await followedUp(token, env.FEEDBACK_REPO, report)
    if (followed) {
      const comment = await github<{ html_url: string }>(token, 'POST', `/repos/${env.FEEDBACK_REPO}/issues/${followed.number}/comments`, { body: commentBody(report, stored) })
      // A closed report is opened again by its follow-up ("it still does not work"), so that it is read.
      if (followed.state === 'closed') await github(token, 'PATCH', `/repos/${env.FEEDBACK_REPO}/issues/${followed.number}`, { state: 'open' }).catch((error) => console.error(error))
      return json(201, { url: comment.html_url, number: followed.number })
    }
    const issue = await github<{ html_url: string; number: number }>(token, 'POST', `/repos/${env.FEEDBACK_REPO}/issues`, {
      title: issueTitle(report),
      body: issueBody(report, stored),
      labels: LABELS[report.kind],
    })
    return json(201, { url: issue.html_url, number: issue.number })
  } catch (error) {
    console.error(error)
    return json(502, { error: 'GitHub did not take the report' })
  }
}

/** A file attached to a report, as its issue links it. Anything not named as the worker names files is not looked for. */
export async function attachment(name: string, env: Env): Promise<Response> {
  const found = FILE_NAME.test(name) && env.FEEDBACK_FILES ? await env.FEEDBACK_FILES.get(name) : null
  if (!found) return new Response('Not found', { status: 404 })
  return new Response(found.body, {
    headers: {
      'Content-Type': found.httpMetadata?.contentType ?? 'application/octet-stream',
      ...(found.httpMetadata?.contentDisposition && { 'Content-Disposition': found.httpMetadata.contentDisposition }),
      'X-Content-Type-Options': 'nosniff',
      // Never changed once written.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/feedback') return feedback(request, env)
    if (pathname.startsWith(FILES) && request.method === 'GET') return attachment(pathname.slice(FILES.length), env)
    if (pathname.startsWith('/api/')) return json(404, { error: 'No such address' })
    return env.ASSETS.fetch(request)
  },
}
