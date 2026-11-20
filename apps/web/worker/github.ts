/**
 * Speaking to GitHub as the OpenCalque feedback GitHub App: a JSON Web Token signed with the
 * App's private key buys a token for the installation on a repository, valid an hour, which every
 * call then carries. Only WebCrypto and fetch, as a Cloudflare Worker has them.
 */

const API = 'https://api.github.com'

export interface AppCredentials {
  /** The App's id, shown on its settings page. */
  id: string
  /** The private key GitHub generated for the App, in PEM, as downloaded (PKCS#1) or converted to PKCS#8. */
  key: string
}

function base64url(bytes: Uint8Array | string): string {
  const binary = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A DER element: its tag, its length, its content. */
function der(tag: number, content: Uint8Array): Uint8Array {
  const n = content.length
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]
  return concat(Uint8Array.of(tag, ...length), content)
}

/** The algorithm part of a PKCS#8 key: rsaEncryption, no parameters. */
const RSA_ALGORITHM = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00)

/**
 * The key's bytes in PKCS#8, the only form WebCrypto imports. GitHub hands out PKCS#1 keys
 * ("BEGIN RSA PRIVATE KEY"), which are wrapped here so the key can be stored as downloaded.
 */
export function pkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) return bytes
  return der(0x30, concat(Uint8Array.of(0x02, 0x01, 0x00), RSA_ALGORITHM, der(0x04, bytes)))
}

/** The token that identifies the App itself, valid ten minutes (backdated one for clocks that differ). */
export async function appToken(app: AppCredentials, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(app.key) as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const seconds = Math.floor(now / 1000)
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: app.id }))}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  return `${unsigned}.${base64url(signature)}`
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** One call to GitHub's REST API; throws `GitHubError` on anything but success. */
export async function github<T>(token: string, method: string, path: string, body?: unknown, scheme = 'token'): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${scheme} ${token}`,
      'User-Agent': 'opencalque-feedback',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new GitHubError(response.status, `GitHub answered ${response.status} to ${method} ${path}: ${(await response.text()).slice(0, 300)}`)
  return (await response.json()) as T
}

/** Installation tokens by repository, kept while they are valid: a worker instance answers many requests. */
const tokens = new Map<string, { token: string; until: number }>()

/** A token to act on `repository` ("owner/name"), where the App is installed. */
export async function installationToken(app: AppCredentials, repository: string): Promise<string> {
  const kept = tokens.get(repository)
  if (kept && kept.until > Date.now() + 60_000) return kept.token
  const jwt = await appToken(app)
  const installation = await github<{ id: number }>(jwt, 'GET', `/repos/${repository}/installation`, undefined, 'Bearer')
  const made = await github<{ token: string; expires_at: string }>(jwt, 'POST', `/app/installations/${installation.id}/access_tokens`, { repositories: [repository.split('/')[1]] }, 'Bearer')
  tokens.set(repository, { token: made.token, until: Date.parse(made.expires_at) })
  return made.token
}
