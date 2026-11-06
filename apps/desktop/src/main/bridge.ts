import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/*
 * How `opencalque mcp --live` reaches the drawing open in this app, while the person lets it (it is
 * off until they do). It can change their drawing, so it takes care over who is asking: it listens
 * on this computer only, on a port of the system's choosing, and answers only those who show the
 * token it wrote in a file of the person's. A web page can reach a local port but can neither read
 * that file nor hide that it is a web page, so anything with an Origin is turned away.
 */

/** Where the app says how to reach it, and the CLI looks: the same for an installed app and a checkout. */
export const BRIDGE_FILE = process.env.OPENCALQUE_BRIDGE_FILE ?? join(homedir(), '.opencalque', 'bridge.json')

/**
 * What runs the MCP server of this app, for the person to give their agent. A portable app and an
 * AppImage run from a copy that goes away: the environment says where the file the person started
 * is. Run from a checkout, Electron must be told which app it is.
 */
export function agentCommand({ exe, packaged, appPath, env }: { exe: string; packaged: boolean; appPath: string; env: Record<string, string | undefined> }): { command: string; args: string[] } {
  return { command: env.PORTABLE_EXECUTABLE_FILE ?? env.APPIMAGE ?? exe, args: packaged ? ['--mcp'] : [appPath, '--mcp'] }
}

/** Largest request taken: a very long list of operations, far from a drawing's worth of pictures. */
const MAX_BODY = 32 * 1024 * 1024

export interface Bridge {
  port: number
  stop(): void
}

/** Runs one tool in the editor and resolves to its result. */
export type BridgeCall = (name: string, input: unknown) => Promise<unknown>

function sameToken(given: string, token: string): boolean {
  const [a, b] = [Buffer.from(given), Buffer.from(`Bearer ${token}`)]
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) return reject(new Error('too large'))
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function answer(request: IncomingMessage, response: ServerResponse, token: string, call: BridgeCall): Promise<void> {
  const reply = (status: number, body: string) => {
    response.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'text/plain' })
    response.end(body)
  }
  if (request.headers.origin !== undefined) return reply(403, 'Not from a web page.')
  if (!sameToken(request.headers.authorization ?? '', token)) return reply(401, 'Wrong token.')
  if (request.method !== 'POST' || request.url !== '/tool') return reply(404, 'Only POST /tool.')
  try {
    const { name, input } = JSON.parse(await readBody(request)) as { name?: unknown; input?: unknown }
    if (typeof name !== 'string') return reply(400, 'Give the name of a tool.')
    reply(200, JSON.stringify(await call(name, input)))
  } catch (error) {
    reply(500, (error as Error).message)
  }
}

/** Starts listening and says where in `file`, which only the person's programs should read. */
export function startBridge(call: BridgeCall, file = BRIDGE_FILE): Promise<Bridge> {
  const token = randomBytes(32).toString('hex')
  const server = createServer((request, response) => void answer(request, response, token, call))
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ port, token }), { mode: 0o600 })
      resolve({
        port,
        stop: () => {
          rmSync(file, { force: true })
          server.closeAllConnections()
          server.close()
        },
      })
    })
  })
}
