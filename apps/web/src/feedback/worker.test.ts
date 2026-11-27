import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { feedback, reply, thread, type Bucket, type Env } from '../../worker/index'
import { appToken, pkcs8 } from '../../worker/github'
import type { Report } from './report'
import { REPLY_MARK, type Thread } from './thread'

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

/** An issue the stand-in GitHub holds, as its API describes one. */
type FakeIssue = {
  number: number
  state: 'open' | 'closed'
  labels: { name: string }[]
  pull_request?: object
  title?: string
  body?: string
  comments?: { body: string; user: { login: string }; author_association: string; created_at: string }[]
}

/** Stands in for GitHub's API, recording what was asked of it; `issues` are those already there. */
function fakeGitHub(issues: FakeIssue[] = []) {
  const calls: { method: string; path: string; body?: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(init.body as string) : undefined })
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (path.endsWith('/installation')) return answer(200, { id: 7 })
    if (path.endsWith('/access_tokens')) return answer(201, { token: 't', expires_at: new Date(Date.now() + 3_600_000).toISOString() })
    if (path.endsWith('/issues')) return answer(201, { html_url: 'https://github.com/o/app/issues/42', number: 42 })
    const one = path.match(/\/issues\/(\d+)(\/comments)?$/)
    const issue = one && issues.find((i) => i.number === Number(one[1]))
    if (issue && one[2] && init.method === 'POST') {
      issue.comments = [...(issue.comments ?? []), { body: JSON.parse(init.body as string).body, user: { login: BOT }, author_association: 'NONE', created_at: '2026-11-27T10:00:00Z' }]
      return answer(201, { html_url: `https://github.com/o/app/issues/${issue.number}#issuecomment-9` })
    }
    if (issue && one[2] && init.method === 'GET') return answer(200, issue.comments ?? [])
    if (issue && init.method === 'GET') return answer(200, { html_url: `https://github.com/o/app/issues/${issue.number}`, created_at: '2026-11-22T10:00:00Z', title: 'A report', body: '', user: { login: BOT }, ...issue })
    if (issue && init.method === 'PATCH') return answer(200, { ...issue, ...JSON.parse(init.body as string) })
    return answer(404, {})
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

/** The account the feedback App writes as. */
const BOT = 'opencalque-feedback[bot]'

describe('the feedback worker', () => {
  it('posts a report as an issue, with its labels, and answers where it is', async () => {
    const calls = fakeGitHub()
    const response = await feedback(post(report), env())
    expect(response.status).toBe(201)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ url: 'https://github.com/o/app/issues/42', number: 42, key: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const issue = calls.find((c) => c.path === '/repos/o/app/issues')!
    expect(issue.body.title).toBe('Stairs with a landing')
    expect(issue.body.labels).toEqual(['enhancement', 'from-app'])
  })

  it('keeps attachments in the bucket, links them from the issue, and serves them', async () => {
    const calls = fakeGitHub()
    const { bucket, files } = fakeBucket()
    const png = 'iVBORw0KGgo='
    const webm = 'GkXfo59ChoEBQg=='
    await feedback(
      post({ ...report, kind: 'bug', pictures: [png, png], recordings: [{ type: 'video/webm', content: webm, seconds: 3 }], drawing: { name: 'Flat.opencalque', content: '{"format":"opencalque"}' } }),
      env({ FEEDBACK_FILES: bucket }),
    )
    const names = [...files.keys()].filter((name) => !name.startsWith('keys/'))
    expect(names).toEqual([
      expect.stringMatching(/^\d{4}-\d\d-\d\d-[0-9a-f]{18}\/picture-1\.png$/),
      expect.stringMatching(/\/picture-2\.png$/),
      expect.stringMatching(/\/recording-1\.webm$/),
      expect.stringMatching(/\/drawing\.opencalque$/),
    ])
    const body = calls.find((c) => c.path === '/repos/o/app/issues')!.body.body as string
    expect(body).toContain(`](https://opencalque.com/api/feedback/files/${names[0]})`)
    expect(body).toContain(`](https://opencalque.com/api/feedback/files/${names[1]})`)
    expect(body).toContain(`[recording-1.webm](https://opencalque.com/api/feedback/files/${names[2]})`)
    expect(body).toContain(`[Flat.opencalque](https://opencalque.com/api/feedback/files/${names[3]})`)

    const picture = await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${names[0]}`), env({ FEEDBACK_FILES: bucket }))
    expect(picture.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await picture.arrayBuffer()).toString('base64')).toBe(png)
    const video = await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${names[2]}`), env({ FEEDBACK_FILES: bucket }))
    expect(video.headers.get('Content-Type')).toBe('video/webm')
    expect(Buffer.from(await video.arrayBuffer()).toString('base64')).toBe(webm)
    const drawing = await worker.fetch(new Request(`https://opencalque.com/api/feedback/files/${names[3]}`), env({ FEEDBACK_FILES: bucket }))
    expect(await drawing.text()).toBe('{"format":"opencalque"}')
    expect(drawing.headers.get('Content-Disposition')).toContain('Flat.opencalque')
  })

  it('keeps the one picture 1.13 sends', async () => {
    fakeGitHub()
    const { bucket, files } = fakeBucket()
    expect((await feedback(post({ ...report, screenshot: 'iVBORw0KGgo=' }), env({ FEEDBACK_FILES: bucket }))).status).toBe(201)
    expect([...files.keys()]).toEqual([expect.stringMatching(/\/picture-1\.png$/), 'keys/42'])
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

  describe('a report that names an earlier one in its title', () => {
    const fromApp = [{ name: 'enhancement' }, { name: 'from-app' }]
    const answers = { ...report, title: '#30 Answers to your questions', description: 'Three or four walls' }

    it('is a comment on that report, which the app links', async () => {
      const calls = fakeGitHub([{ number: 30, state: 'open', labels: fromApp }])
      const response = await feedback(post(answers), env())
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ url: 'https://github.com/o/app/issues/30#issuecomment-9', number: 30 })
      const comment = calls.find((c) => c.path === '/repos/o/app/issues/30/comments')!
      expect(comment.body.body.startsWith('**#30 Answers to your questions**\n\nThree or four walls')).toBe(true)
      expect(comment.body.body).toContain('<summary>Environment</summary>')
      expect(calls.some((c) => c.path === '/repos/o/app/issues')).toBe(false)
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    })

    it('opens that report again when it was closed', async () => {
      const calls = fakeGitHub([{ number: 30, state: 'closed', labels: fromApp }])
      await feedback(post({ ...answers, title: 'About #30: still wrong' }), env())
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', path: '/repos/o/app/issues/30', body: { state: 'open' } })
    })

    it('is a new issue when what it names is not a report from the app', async () => {
      for (const named of [
        { number: 30, state: 'open', labels: [{ name: 'bug' }] },
        { number: 30, state: 'open', labels: fromApp, pull_request: {} },
        { number: 31, state: 'open', labels: fromApp },
      ] satisfies FakeIssue[]) {
        const calls = fakeGitHub([named])
        expect(await (await feedback(post(answers), env())).json()).toMatchObject({ url: 'https://github.com/o/app/issues/42', number: 42 })
        expect(calls.find((c) => c.path === '/repos/o/app/issues')!.body.title).toBe('#30 Answers to your questions')
        expect(calls.some((c) => c.path.endsWith('/comments'))).toBe(false)
      }
    })
  })

  describe('the person who sent a report, reading and answering it from the app', () => {
    const at = (path: string, body: unknown) => new Request(`https://opencalque.com/api/feedback/${path}`, { method: 'POST', body: JSON.stringify(body) })
    /** Sends a report as the app does, then makes the stand-in GitHub hold it as issue 42. */
    async function sent(issue: Partial<FakeIssue> = {}) {
      const { bucket, files } = fakeBucket()
      const settings = env({ FEEDBACK_FILES: bucket })
      fakeGitHub()
      const answer = await (await feedback(post(report), settings)).json()
      const held: FakeIssue = {
        number: 42,
        state: 'open',
        labels: [{ name: 'enhancement' }, { name: 'from-app' }],
        title: 'Stairs with a landing',
        body: 'Please\n\n<details><summary>Environment</summary>\n\n| | |\n</details>',
        ...issue,
      }
      const calls = fakeGitHub([held])
      return { answer, settings, files, held, calls }
    }

    it('gets a key with the report, of which only a hash is kept, and never served', async () => {
      const { answer, files, settings } = await sent()
      expect(answer.key).toMatch(/^[0-9a-f]{64}$/)
      expect([...files.keys()]).toEqual(['keys/42'])
      expect(String(files.get('keys/42')!.value)).not.toContain(answer.key)
      expect((await worker.fetch(new Request('https://opencalque.com/api/feedback/files/keys/42'), settings)).status).toBe(404)
    })

    it('reads the report and its answers with that key', async () => {
      const { answer, settings, held } = await sent()
      held.comments = [
        { body: 'Danke! Welche Wände?', user: { login: 'laurent512' }, author_association: 'OWNER', created_at: '2026-11-23T10:00:00Z' },
        { body: 'Same here', user: { login: 'visitor' }, author_association: 'NONE', created_at: '2026-11-24T10:00:00Z' },
      ]
      const response = await worker.fetch(at('thread', { number: 42, key: answer.key }), settings)
      expect(response.status).toBe(200)
      const read: Thread = await response.json()
      expect(read).toMatchObject({ number: 42, title: 'Stairs with a landing', state: 'open', url: 'https://github.com/o/app/issues/42' })
      expect(read.entries).toEqual([
        { from: 'you', at: '2026-11-22T10:00:00Z', text: 'Please' },
        { from: 'team', at: '2026-11-23T10:00:00Z', text: 'Danke! Welche Wände?' },
        { from: 'someone', name: 'visitor', at: '2026-11-24T10:00:00Z', text: 'Same here' },
      ])
    })

    it('posts a reply on the report, marked as theirs, and opens it again when it was closed', async () => {
      const { answer, settings, held, calls } = await sent({ state: 'closed' })
      const response = await reply(at('reply', { number: 42, key: answer.key, text: 'Drei Wände, @someone' }), settings)
      expect(response.status).toBe(201)
      const posted = calls.find((c) => c.method === 'POST' && c.path === '/repos/o/app/issues/42/comments')!
      expect(posted.body.body).toContain('Drei Wände, @\u200bsomeone')
      expect(posted.body.body).toContain(REPLY_MARK)
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', path: '/repos/o/app/issues/42', body: { state: 'open' } })
      const read: Thread = await (await thread(at('thread', { number: 42, key: answer.key }), settings)).json()
      expect(read.entries.at(-1)).toMatchObject({ from: 'you', text: 'Drei Wände, @someone' })
      expect(held.comments).toHaveLength(1)
    })

    it('refuses anyone without the key, before reaching GitHub', async () => {
      const { answer, settings, calls } = await sent()
      const other = answer.key.replace(/^./, (c: string) => (c === '0' ? '1' : '0'))
      for (const [path, body] of [
        ['thread', { number: 42, key: other }],
        ['reply', { number: 42, key: other, text: 'not me' }],
        ['reply', { number: 41, key: answer.key, text: 'another report' }],
      ] as const) {
        expect((await worker.fetch(at(path, body), settings)).status).toBe(403)
      }
      for (const body of [{ number: 42 }, { number: '42', key: answer.key }, { number: 42, key: 'short' }]) {
        expect((await worker.fetch(at('thread', body), settings)).status).toBe(400)
      }
      expect((await worker.fetch(at('reply', { number: 42, key: answer.key, text: '  ' }), settings)).status).toBe(400)
      expect(calls).toEqual([])
    })

    it('reads and answers only reports from the app', async () => {
      const { answer, settings, calls } = await sent({ labels: [{ name: 'bug' }] })
      expect((await worker.fetch(at('thread', { number: 42, key: answer.key }), settings)).status).toBe(404)
      expect((await worker.fetch(at('reply', { number: 42, key: answer.key, text: 'hello' }), settings)).status).toBe(404)
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/comments'))).toBe(false)
    })

    it('gives no key to a report added to another, nor when nothing can be kept', async () => {
      fakeGitHub([{ number: 30, state: 'open', labels: [{ name: 'from-app' }] }])
      expect(await (await feedback(post({ ...report, title: '#30 more' }), env())).json()).toEqual({ url: 'https://github.com/o/app/issues/30#issuecomment-9', number: 30 })
      fakeGitHub()
      expect(await (await feedback(post(report), env({ FEEDBACK_FILES: undefined }))).json()).toEqual({ url: 'https://github.com/o/app/issues/42', number: 42 })
    })
  })

  it('says it is not set up when the App’s secrets are missing', async () => {
    expect((await feedback(post(report), env({ GITHUB_APP_KEY: undefined }))).status).toBe(503)
  })

  it('leaves every other address to the editor’s files', async () => {
    expect(await (await worker.fetch(new Request('https://opencalque.com/'), env())).text()).toBe('the editor')
    expect((await worker.fetch(new Request('https://opencalque.com/api/other'), env())).status).toBe(404)
  })
})
