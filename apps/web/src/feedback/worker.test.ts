import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { feedback, type Bucket, type Env } from '../../worker/index'
import { appToken, pkcs8 } from '../../worker/github'
import type { Report } from './report'

// One key for every test: generating RSA keys is slow.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PKCS1 = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

describe('signing in as the GitHub App', () => {
  it('reads the key as GitHub hands it out (PKCS#1) and as converted (PKCS#8)', () => {
    const der = (pem: string) => Uint8Array.from(Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64'))
    expect(pkcs8(PKCS1)).toEqual(der(PKCS8))
    expect(pkcs8(PKCS8)).toEqual(der(PKCS8))
  })

  it('signs a token GitHub can check with the App’s public key', async () => {
    const token = await appToken({ id: '123', key: PKCS1 }, 1_700_000_000_000)
    const [header, payload, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: '123' })
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })
})

const report: Report = { kind: 'idea', title: 'Stairs with a landing', description: 'Please', environment: { Version: '1.12.0' } }

/** Stands in for the R2 bucket. */
function fakeBucket() {
  const files = new Map<string, { value: string | Uint8Array; httpMetadata?: { contentType?: string; contentDisposition?: string } }>()
  const bucket: Bucket = {
    put: async (key, value, options) => void files.set(key, { value, httpMetadata: options?.httpMetadata }),
    get: async (key) => {
      const file = files.get(key)
      return file ? { body: new Response(file.value as BodyInit).body!, httpMetadata: file.httpMetadata } : null
    },
  }
  return { bucket, files }
}

function env(more: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('the editor') },
    GITHUB_APP_ID: '123',
    GITHUB_APP_KEY: PKCS1,
    FEEDBACK_REPO: 'o/app',
    FEEDBACK_FILES: fakeBucket().bucket,
    ...more,
  }
}

const post = (body: unknown) => new Request('https://opencalque.com/api/feedback', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

/** Stands in for GitHub's API, recording what was asked of it. */
function fakeGitHub() {
  const calls: { method: string; path: string; body?: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(init.body as string) : undefined })
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (path.endsWith('/installation')) return answer(200, { id: 7 })
    if (path.endsWith('/access_tokens')) return answer(201, { token: 't', expires_at: new Date(Date.now() + 3_600_000).toISOString() })
    if (path.endsWith('/issues')) return answer(201, { html_url: 'https://github.com/o/app/issues/42', number: 42 })
    return answer(404, {})
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('the feedback worker', () => {
  it('posts a report as an issue, with its labels, and answers where it is', async () => {
    const calls = fakeGitHub()
    const response = await feedback(post(report), env())
    expect(response.status).toBe(201)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ url: 'https://github.com/o/app/issues/42', number: 42 })
    const issue = calls.find((c) => c.path === '/repos/o/app/issues')!
    expect(issue.body.title).toBe('Stairs with a landing')
    expect(issue.body.labels).toEqual(['enhancement', 'from-app'])
  })

  it('keeps attachments in the bucket, links them from the issue, and serves them', async () => {
    const calls = fakeGitHub()
    const { bucket, files } = fakeBucket()
    const png = 'iVBORw0KGgo='
    await feedback(post({ ...report, kind: 'bug', screenshot: png, drawing: { name: 'Flat.opencalque', content: '{"format":"opencalque"}' } }), env({ FEEDBACK_FILES: bucket }))
    const names = [...files.keys()]
    expect(names).toEqual([expect.stringMatching(/^\d{4}-\d\d-\d\d-[0-9a-f]{18}\/screenshot\.png$/), expect.stringMatching(/\/drawing\.opencalque$/)])
    const body = calls.find((c) => c.path === '/repos/o/app/issues')!.body.body as string
    expect(body).toContain(`](https://opencalque.com/api/feedback/files/${names[0]})`)
    expect(body).toContain(`[Flat.opencalque](https://opencalque.com/api/feedback/files/${names[1]})`)

    const picture = await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${names[0]}`), env({ FEEDBACK_FILES: bucket }))
    expect(picture.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await picture.arrayBuffer()).toString('base64')).toBe(png)
    const drawing = await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${names[1]}`), env({ FEEDBACK_FILES: bucket }))
    expect(await drawing.text()).toBe('{"format":"opencalque"}')
    expect(drawing.headers.get('Content-Disposition')).toContain('Flat.opencalque')
  })

  it('serves nothing but the files of reports', async () => {
    const { bucket, files } = fakeBucket()
    files.set('secret', { value: 'no' })
    for (const name of ['secret', '../secret', '2026-11-20-000000000000000000/other.txt', '2026-11-20-000000000000000000/screenshot.png']) {
      expect((await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${name}`), env({ FEEDBACK_FILES: bucket }))).status).toBe(404)
    }
  })

  it('makes the issue without the files, and says so, when there is nowhere to keep them', async () => {
    const calls = fakeGitHub()
    expect((await feedback(post({ ...report, screenshot: 'iVBORw0KGgo=' }), env({ FEEDBACK_FILES: undefined }))).status).toBe(201)
    expect(calls.find((c) => c.path === '/repos/o/app/issues')!.body.body).toContain('this server keeps none')
  })

  it('refuses what is not a report, and says so', async () => {
    const calls = fakeGitHub()
    expect((await feedback(post('not json'), env())).status).toBe(400)
    const bad = await feedback(post({ ...report, title: '' }), env())
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/title/)
    expect((await feedback(new Request('https://opencalque.com/api/feedback'), env())).status).toBe(405)
    expect(calls).toEqual([])
  })

  it('answers the browser’s question before a request from another origin', async () => {
    const response = await feedback(new Request('https://opencalque.com/api/feedback', { method: 'OPTIONS' }), env())
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('turns visitors away past the limit, before reading what they sent', async () => {
    const calls = fakeGitHub()
    const response = await feedback(post(report), env({ FEEDBACK_LIMIT: { limit: async () => ({ success: false }) } }))
    expect(response.status).toBe(429)
    expect(calls).toEqual([])
  })

  it('says it is not set up when the App’s secrets are missing', async () => {
    expect((await feedback(post(report), env({ GITHUB_APP_KEY: undefined }))).status).toBe(503)
  })

  it('leaves every other address to the editor’s files', async () => {
    expect(await (await worker.fetch(new Request('https://opencalque.com/'), env())).text()).toBe('the editor')
    expect((await worker.fetch(new Request('https://opencalque.com/api/other'), env())).status).toBe(404)
  })
})
