import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDocument, parseDocument, serializeDocument, toSVG, type NodeOf } from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'
import { agentCommand, BRIDGE_FILE as APP_BRIDGE_FILE, startBridge } from '../../../apps/desktop/src/main/bridge'
import { BRIDGE_FILE, liveBackend, mcpServer } from '../src/mcp'
import { fileBackend } from '../src/mcp-files'
import { renderPng } from '../src/render'

const registry = standardRegistry()
const folder = mkdtempSync(join(tmpdir(), 'opencalque-mcp-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const root = fileURLToPath(new URL('../../../', import.meta.url))
/** Runs the CLI as a person does. */
const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'packages/cli/src/cli.ts'), ...args], { encoding: 'utf8' })

type Backend = Parameters<typeof mcpServer>[0]

/** A client connected to a server over `backend`, speaking the real protocol. */
async function connected(backend: Backend) {
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await mcpServer(backend, registry, '1.0.0').connect(theirs)
  await client.connect(ours)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }
    return { ...result, text: result.content[0].text ?? '' }
  }
  return { client, call }
}

const walls = [
  [0, 0, 4000, 0],
  [4000, 0, 4000, 3000],
  [4000, 3000, 0, 3000],
  [0, 3000, 0, 0],
].map(([ax, ay, bx, by]) => ({ op: 'add_node', node: { type: 'wall', parent: 'page_1', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 } }))
const room = { op: 'add_node', node: { type: 'room', name: 'Kitchen', parent: 'page_1', x: 2000, y: 1500 } }

describe('an agent working on a file over MCP', () => {
  it('lists the drawing tools and tells the client where to start', async () => {
    const { client } = await connected(fileBackend(undefined, registry))
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['read_guide', 'open_drawing', 'apply_operations', 'view_drawing', 'measure_drawing', 'check_drawing', 'describe_drawing']))
    expect(client.getInstructions()).toContain('read_guide')
  })

  it('gives the guide before any drawing is open, and asks for one before anything else', async () => {
    const { call } = await connected(fileBackend(undefined, registry))
    expect((await call('read_guide')).text).toContain('# How a drawing is stored')
    expect(await call('describe_drawing')).toMatchObject({ isError: true, text: expect.stringContaining('open_drawing') })
  })

  it('keeps the guide and each type of node well within what a client takes from a tool', async () => {
    const { call } = await connected(fileBackend(undefined, registry))
    const guide = (await call('read_guide')).text
    expect(guide.length).toBeLessThan(30_000)
    expect(guide).toContain('arch.door')
    const types = /The types of node are ([^.]+)\./.exec(guide)![1].split(', ')
    expect(types).toContain('wall')
    for (const type of types) expect((await call('read_guide', { type })).text.length).toBeLessThan(15_000)
    expect(JSON.parse((await call('read_guide', { type: 'wall' })).text).properties).toHaveProperty('thickness')
    expect(await call('read_guide', { type: 'sofa' })).toMatchObject({ isError: true, text: expect.stringContaining('wall') })
  })

  it('draws a room in a new file, measures it, looks at it and leaves it on disk', async () => {
    const file = join(folder, 'plan.opencalque')
    const { call } = await connected(fileBackend(undefined, registry))
    expect((await call('open_drawing', { file })).isError).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect((await call('open_drawing', { file, create: true })).isError).toBeUndefined()

    const edit = JSON.parse((await call('apply_operations', { operations: [...walls, room] })).text)
    expect(edit.applied).toBe(5)
    expect(edit.problems).toBeUndefined()

    const measured = JSON.parse((await call('measure_drawing', { of: ['rooms'] })).text)
    expect(measured.rooms[0]).toMatchObject({ name: 'Kitchen', area: 10.64 })

    const view = await call('view_drawing')
    expect(view.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    // The first bytes of a PNG.
    expect(Buffer.from(view.content[1].data!, 'base64').subarray(1, 4).toString()).toBe('PNG')

    const saved = parseDocument(JSON.parse(readFileSync(file, 'utf8')))
    expect(Object.values(saved.nodes).filter((node) => node.type === 'wall')).toHaveLength(4)
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('tells the agent what its edit left wrong, and leaves the file alone when the edit is refused', async () => {
    const file = join(folder, 'broken.opencalque')
    writeFileSync(file, serializeDocument(createDocument('Broken')))
    const { call } = await connected(fileBackend(file, registry))
    const [north, ...others] = walls
    const short = { ...north, node: { ...north.node, b: { x: 3700, y: 0 } } }
    const edit = JSON.parse((await call('apply_operations', { operations: [short, ...others, room] })).text)
    expect(edit.problems.map((p: { kind: string }) => p.kind).sort()).toEqual(['room-not-enclosed', 'wall-gap'])

    const before = readFileSync(file, 'utf8')
    expect((await call('apply_operations', { operations: [{ op: 'remove_node', id: 'nothing' }] })).isError).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('sees what someone else saved since its last call', async () => {
    const file = join(folder, 'shared.opencalque')
    writeFileSync(file, serializeDocument(createDocument('First')))
    const { call } = await connected(fileBackend(file, registry))
    expect(JSON.parse((await call('describe_drawing')).text).name).toBe('First')
    writeFileSync(file, serializeDocument(createDocument('Second')))
    expect(JSON.parse((await call('describe_drawing')).text).name).toBe('Second')
  })

  it('opens and writes only drawings', async () => {
    const other = join(folder, 'notes.txt')
    writeFileSync(other, 'mine')
    const { call } = await connected(fileBackend(undefined, registry))
    expect((await call('open_drawing', { file: other, create: true })).isError).toBe(true)
    expect((await call('open_drawing', { file: join(folder, 'script.sh'), create: true })).isError).toBe(true)
    expect(existsSync(join(folder, 'script.sh'))).toBe(false)
    expect(readFileSync(other, 'utf8')).toBe('mine')
  })
})

describe('an agent working on the drawing open in the app', () => {
  it('looks for the app where the app says it is', () => {
    expect(BRIDGE_FILE).toBe(APP_BRIDGE_FILE)
  })

  it('reaches the editor through the bridge, and is told how to open it when it is closed', async () => {
    const file = join(folder, 'bridge.json')
    const { call } = await connected(liveBackend(file))
    expect((await call('describe_drawing')).text).toContain('Preferences')

    const seen: [string, unknown][] = []
    const bridge = await startBridge(async (name, input) => {
      seen.push([name, input])
      return { content: 'done in the editor', image: { mime: 'image/png', data: 'eA==' } }
    }, file)
    const reply = await call('view_drawing', { page: 'p' })
    expect(reply.text).toBe('done in the editor')
    expect(reply.content[1]).toMatchObject({ type: 'image', data: 'eA==' })
    expect(seen).toEqual([['view_drawing', { page: 'p' }]])

    bridge.stop()
    expect(existsSync(file)).toBe(false)
    expect((await call('describe_drawing')).text).toContain('Preferences')
  })

  it('tells an agent the app is closed when a crash left the file behind', async () => {
    const file = join(folder, 'stale.json')
    const bridge = await startBridge(async () => ({ content: 'x' }), file)
    const stale = readFileSync(file, 'utf8')
    bridge.stop()
    writeFileSync(file, stale)
    const { call } = await connected(liveBackend(file))
    expect((await call('describe_drawing')).text).toContain('Preferences')
  })

  it('has no tool to open another file: the drawing is the one on screen', async () => {
    const { client } = await connected(liveBackend(join(folder, 'none.json')))
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('open_drawing')
  })
})

describe('the door of the desktop app', () => {
  const file = join(folder, 'door.json')
  const open = async () => {
    const calls: string[] = []
    const bridge = await startBridge(async (name) => {
      calls.push(name)
      return { content: 'ran' }
    }, file)
    const { token } = JSON.parse(readFileSync(file, 'utf8')) as { token: string }
    const ask = (headers: Record<string, string>, body = '{"name":"check_drawing","input":{}}', path = '/tool', method = 'POST') => fetch(`http://127.0.0.1:${bridge.port}${path}`, { method, headers, ...(method === 'POST' ? { body } : {}) })
    return { bridge, calls, token, ask }
  }

  it('answers who shows the token', async () => {
    const { bridge, calls, token, ask } = await open()
    const response = await ask({ authorization: `Bearer ${token}` })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ content: 'ran' })
    expect(calls).toEqual(['check_drawing'])
    bridge.stop()
  })

  it('turns away a wrong token, none, and any web page, whatever it shows', async () => {
    const { bridge, calls, token, ask } = await open()
    expect((await ask({})).status).toBe(401)
    expect((await ask({ authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await ask({ authorization: `Bearer ${token}`, origin: 'https://example.com' })).status).toBe(403)
    expect(calls).toEqual([])
    bridge.stop()
  })

  it('takes only calls of tools', async () => {
    const { bridge, calls, token, ask } = await open()
    const authorization = `Bearer ${token}`
    expect((await ask({ authorization }, undefined, '/other')).status).toBe(404)
    expect((await ask({ authorization }, undefined, '/tool', 'GET')).status).toBe(404)
    expect((await ask({ authorization }, 'not json')).status).toBe(500)
    expect((await ask({ authorization }, '{"input":{}}')).status).toBe(400)
    expect(calls).toEqual([])
    bridge.stop()
  })

  it('listens on this computer only, and under a new token each time', async () => {
    const first = await open()
    first.bridge.stop()
    const second = await open()
    expect(second.token).not.toBe(first.token)
    expect(second.token).toHaveLength(64)
    second.bridge.stop()
  })
})

describe('what starts the server of the desktop app', () => {
  const exe = 'C:/Program Files/OpenCalque/OpenCalque.exe'
  it('is the app itself once installed, and takes no script', () => {
    expect(agentCommand({ exe, packaged: true, appPath: 'x', env: {} })).toEqual({ command: exe, args: ['--mcp'] })
  })

  it('is what the person started, not the copy a portable app or an AppImage runs from', () => {
    expect(agentCommand({ exe: 'C:/Temp/unpacked.exe', packaged: true, appPath: 'x', env: { PORTABLE_EXECUTABLE_FILE: 'D:/OpenCalque.exe' } }).command).toBe('D:/OpenCalque.exe')
    expect(agentCommand({ exe: '/tmp/.mount_x/opencalque', packaged: true, appPath: 'x', env: { APPIMAGE: '/home/me/OpenCalque.AppImage' } }).command).toBe('/home/me/OpenCalque.AppImage')
  })

  it('names the app to Electron when run from a checkout', () => {
    expect(agentCommand({ exe: 'electron', packaged: false, appPath: 'apps/desktop', env: {} })).toEqual({ command: 'electron', args: ['apps/desktop', '--mcp'] })
  })
})

describe('the command line', () => {
  const plan = () => {
    const file = join(folder, `cli-${Math.random().toString(36).slice(2)}.opencalque`)
    writeFileSync(file, serializeDocument(createDocument('Plan')))
    return file
  }
  const opsFile = (ops: unknown[]) => {
    const file = join(folder, `ops-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(file, JSON.stringify(ops))
    return file
  }

  it('moves the doors of a wall with it, as the editor does', () => {
    const file = plan()
    const door = { op: 'add_node', node: { type: 'parametric', id: 'd', kind: 'arch.door', parent: 'page_1', props: {}, x: 1000, y: 0 } }
    const wall = { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 } }
    expect(cli('apply', file, opsFile([wall, door])).status).toBe(0)
    expect(cli('apply', file, opsFile([{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } }])).status).toBe(0)
    const saved = parseDocument(JSON.parse(readFileSync(file, 'utf8')))
    expect((saved.nodes.d as NodeOf<'parametric'>).y).toBe(1000)
  })

  it('warns of what an edit left wrong, checks a file, and measures it', () => {
    const file = plan()
    const [north, ...others] = walls
    const short = { ...north, node: { ...north.node, b: { x: 3700, y: 0 } } }
    expect(cli('apply', file, opsFile([short, ...others, room])).stderr).toContain('stops 200 mm short')

    const check = cli('check', file)
    expect(check.status).toBe(1)
    expect(JSON.parse(check.stdout).map((p: { kind: string }) => p.kind).sort()).toEqual(['room-not-enclosed', 'wall-gap'])

    expect(JSON.parse(cli('quantities', file).stdout).walls).toHaveLength(4)
  })

  it('says a drawing with nothing wrong is fine', () => {
    const check = cli('check', plan())
    expect(check.status).toBe(0)
    expect(JSON.parse(check.stdout)).toEqual([])
  })

  it('prints the guide, and the schema of one type', () => {
    expect(cli('guide').stdout).toContain('# How a drawing is stored')
    expect(JSON.parse(cli('guide', '--type', 'wall').stdout).properties).toHaveProperty('thickness')
    expect(cli('guide', '--type', 'sofa').status).toBe(1)
  })

  it('draws a page as a picture of the size asked for, and refuses a size that is not one', () => {
    const file = plan()
    cli('apply', file, opsFile([...walls, room]))
    const out = join(folder, 'plan.png')
    expect(cli('png', file, '--size', '640', '--out', out).status).toBe(0)
    const png = readFileSync(out)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBe(640)
    expect(cli('png', file, '--size', 'big', '--out', out).status).toBe(1)
  })

  it('serves MCP with nothing but the protocol on stdout', () => {
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    const output = execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'packages/cli/src/cli.ts'), 'mcp'], { input: `${request}\n`, encoding: 'utf8' })
    const lines = output.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).result.serverInfo.name).toBe('opencalque')
  })
})

describe('a drawing as a picture', () => {
  it('draws line weights in pixels whatever the size of the plan, as the editor does', () => {
    const doc = parseDocument(JSON.parse(readFileSync(join(root, 'examples/studio.opencalque'), 'utf8')))
    const page = Object.values(doc.nodes).find((node) => node.type === 'page')!
    const { png, width, height } = renderPng(toSVG(doc, page.id, registry), 400)
    expect(Math.max(width, height)).toBe(400)
    expect(png.length).toBeGreaterThan(1000)
  })
})
