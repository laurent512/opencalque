import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The desktop app's own part, its main process: what only it does with files. Runs against the
 * built app (`pnpm build`); skipped when it has not been built, as in CI, which builds the web app only.
 */
const APP = resolve(__dirname, '../apps/desktop')
// Every test here starts the app: not on top of what the person is working on.
process.env.OPENCALQUE_BACKGROUND = '1'
test.skip(!existsSync(join(APP, 'out/main/index.js')), 'Build the desktop app first (pnpm build).')

test('desktop: opens the file it is started with, saves over it with a backup and no temporary file left', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'opencalque-e2e-'))
  const folder = join(scratch, 'files')
  const profile = join(scratch, 'profile')
  const file = join(folder, 'plan.opencalque')
  const original = JSON.stringify({
    format: 'opencalque',
    version: 1,
    id: 'doc_x',
    name: 'Plan',
    unit: 'mm',
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order: 'a0' } },
    nodes: {
      page_1: { id: 'page_1', type: 'page', name: 'Page 1', parent: null, order: 'a0' },
      w: { id: 'w', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, future: 'kept' },
    },
  })
  mkdirSync(folder)
  writeFileSync(file, original)
  // Agent terminals set this, which would start Electron as plain Node.
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [APP, `--user-data-dir=${profile}`, file], env, cwd: APP })
  try {
    const page = await app.firstWindow()
    const rows = page.locator('[data-panel="objects"] .row')
    await expect(rows).toHaveCount(1)
    const box = (await page.locator('.stage canvas').boundingBox())!
    const walls = () => readFileSync(file, 'utf8').match(/"type": "wall"/g)?.length ?? 0
    const drawAndSave = async (y: number) => {
      await page.keyboard.press('w')
      await page.mouse.click(box.x + 300, box.y + y)
      await page.mouse.click(box.x + 700, box.y + y)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+s')
    }

    await drawAndSave(400)
    await expect.poll(walls).toBe(2)
    // What this version does not know is kept.
    expect(JSON.parse(readFileSync(file, 'utf8')).nodes.w.future).toBe('kept')
    // The drawing as it was is in the backups, and nothing but the drawing is left beside it.
    const backups = readdirSync(join(profile, 'backups'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(profile, 'backups', backups[0]), 'utf8')).toBe(original)
    expect(readdirSync(folder)).toEqual(['plan.opencalque'])

    // One backup per run, however often it is saved.
    await drawAndSave(500)
    await expect.poll(walls).toBe(3)
    expect(readdirSync(join(profile, 'backups'))).toHaveLength(1)
  } finally {
    await app.close()
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('desktop: keeps the key of the assistant encrypted in the profile, moving there one kept in plain text before', async () => {
  // The app is started twice.
  test.setTimeout(90_000)
  const scratch = mkdtempSync(join(tmpdir(), 'opencalque-e2e-'))
  const profile = join(scratch, 'profile')
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({ args: [APP, `--user-data-dir=${profile}`], env, cwd: APP })
  try {
    // A key written with the preferences, as versions before kept it.
    let app = await launch()
    let page = await app.firstWindow()
    await page.evaluate(() => localStorage.setItem('opencalque.prefs', JSON.stringify({ language: 'en', showWelcome: false, ai: { anthropic: { apiKey: 'sk-ant-e2e-secret' } } })))
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await expect.poll(() => existsSync(join(profile, 'secrets.json'))).toBe(true)
    const kept = readFileSync(join(profile, 'secrets.json'), 'utf8')
    expect(JSON.parse(kept)).toHaveProperty('anthropic')
    expect(kept).not.toContain('sk-ant-e2e-secret')
    expect(await page.evaluate(() => localStorage.getItem('opencalque.prefs'))).not.toContain('sk-ant')
    // And read back into the preferences, where the assistant takes it from.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Preferences')
    await page.keyboard.press('Enter')
    await page.locator('.prefs-nav button', { hasText: 'AI' }).click()
    await expect(page.locator('.pref-field', { hasText: 'API key' }).locator('input')).toHaveValue('sk-ant-e2e-secret')
    await expect(page.getByText('encrypted by the system')).toBeVisible()
    await app.close()
  } finally {
    // Windows can hold the profile of an app started twice for a while after it closed: what is
    // left in the temporary folder is left to the system.
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    } catch {}
  }
})

/**
 * Starts the page again with these settings. They are stored before any of its code runs: written
 * while it starts, they could be overwritten by what it saves of its own then (`keepKeysIn`).
 */
async function reloadWith(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript((stored) => localStorage.setItem('opencalque.prefs', stored), JSON.stringify({ language: 'en', showWelcome: false, ...prefs }))
  await page.reload()
}

/** Opens the AI page of Preferences, pressing again if the page had not begun to listen yet, as on a busy computer. */
async function openAiPreferences(page: Page) {
  const nav = page.locator('.prefs-nav button', { hasText: 'AI' })
  await expect(async () => {
    await page.keyboard.press('Control+,')
    await expect(nav).toBeVisible({ timeout: 1000 })
  }).toPass()
  await nav.click()
}

/** `opencalque mcp --live` from a checkout, as an agent runs it. */
const fromCheckout = (): [string, string[]] => {
  const root = resolve(__dirname, '..')
  return [process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'packages/cli/src/cli.ts'), 'mcp', '--live']]
}

/** An MCP server started as an agent starts it, spoken to in the protocol's own lines of JSON. */
function liveAgent(env: Record<string, string>, [command, args]: [string, string[]] = fromCheckout()) {
  const server = spawn(command, args, { env })
  const waiting = new Map<number, (message: { result: { content: { type: string; text?: string; data?: string }[]; isError?: boolean } }) => void>()
  let received = ''
  server.stdout.on('data', (chunk) => {
    received += String(chunk)
    for (let end = received.indexOf('\n'); end !== -1; end = received.indexOf('\n')) {
      const line = received.slice(0, end).trim()
      received = received.slice(end + 1)
      // Electron writes an empty line of its own on Windows; clients skip what is not a message.
      if (!line) continue
      const message = JSON.parse(line)
      waiting.get(message.id)?.(message)
    }
  })
  let id = 0
  const request = (method: string, params: unknown) =>
    new Promise<{ result: { content: { type: string; text?: string; data?: string }[]; isError?: boolean } }>((done) => {
      waiting.set(++id, done)
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  return {
    start: () => request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }),
    gone: new Promise<void>((done) => server.on('exit', () => done())),
    close: () => server.stdin.end(),
    call: async (name: string, args: unknown = {}) => (await request('tools/call', { name, arguments: args })).result,
    stop: () => server.kill(),
  }
}

test('desktop: an agent works on the open drawing only when let in, each edit a step of the undo', async () => {
  test.setTimeout(90_000)
  const scratch = mkdtempSync(join(tmpdir(), 'opencalque-e2e-'))
  // This test's, not the one in the person's home folder.
  const bridgeFile = join(scratch, 'bridge.json')
  const env = { ...process.env, OPENCALQUE_BRIDGE_FILE: bridgeFile } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [APP, `--user-data-dir=${join(scratch, 'profile')}`], env, cwd: APP })
  const agent = liveAgent(env)
  try {
    const page = await app.firstWindow()
    await reloadWith(page, {})
    await expect(page.locator('.stage canvas')).toBeVisible()
    await agent.start()

    // Off the screen, the page still runs as it does for a person: seen, and painting.
    expect(await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(document.visibilityState))))).toBe('visible')

    // Nothing reaches the drawing until the person says so.
    expect(existsSync(bridgeFile)).toBe(false)
    const refused = await agent.call('describe_drawing')
    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toContain('Preferences')

    const setting = async () => {
      await openAiPreferences(page)
      await page.getByLabel('Let agents on this computer work on the open drawing').click()
      await page.getByRole('button', { name: 'Done' }).click()
    }
    await setting()
    await expect.poll(() => existsSync(bridgeFile)).toBe(true)

    const summary = JSON.parse((await agent.call('describe_drawing')).content[0].text!)
    const pageId = summary.pages[0].id as string
    const wall = (a: [number, number], b: [number, number]) => ({ op: 'add_node', node: { type: 'wall', parent: pageId, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 } })
    const room = { op: 'add_node', node: { type: 'room', name: 'Kitchen', parent: pageId, x: 2000, y: 1500 } }
    const edit = await agent.call('apply_operations', { operations: [wall([0, 0], [4000, 0]), wall([4000, 0], [4000, 3000]), wall([4000, 3000], [0, 3000]), wall([0, 3000], [0, 0]), room] })
    expect(JSON.parse(edit.content[0].text!).applied).toBe(5)

    // On the canvas, and in what the agent measures of it.
    const rows = page.locator('[data-panel="objects"] .row')
    await expect(rows).toHaveCount(5)
    const measured = JSON.parse((await agent.call('measure_drawing', { of: ['rooms'] })).content[0].text!)
    expect(measured.rooms[0]).toMatchObject({ name: 'Kitchen', area: 10.64 })

    // Drawn by the editor's own browser.
    const view = await agent.call('view_drawing')
    const picture = view.content.find((part) => part.type === 'image')!
    expect(Buffer.from(picture.data!, 'base64').subarray(1, 4).toString()).toBe('PNG')

    // The whole edit is one step of the undo.
    await page.locator('.stage canvas').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(rows).toHaveCount(0)

    // And the door closes when the person says so.
    await setting()
    await expect.poll(() => existsSync(bridgeFile)).toBe(false)
    expect((await agent.call('describe_drawing')).isError).toBe(true)
  } finally {
    agent.stop()
    await app.close()
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    } catch {}
  }
})

test('desktop: the app gives the command that makes it a server, and that command works', async () => {
  test.setTimeout(90_000)
  const scratch = mkdtempSync(join(tmpdir(), 'opencalque-e2e-'))
  const bridgeFile = join(scratch, 'bridge.json')
  const env = { ...process.env, OPENCALQUE_BRIDGE_FILE: bridgeFile } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [APP, `--user-data-dir=${join(scratch, 'profile')}`], env, cwd: APP })
  try {
    const page = await app.firstWindow()
    await reloadWith(page, { agentBridge: true })
    await expect.poll(() => existsSync(bridgeFile)).toBe(true)
    await expect(page.locator('.stage canvas')).toBeVisible()

    // Exactly what Preferences shows, as a terminal would split it.
    await openAiPreferences(page)
    const code = page.locator('.pref-command code')
    await expect(code).toHaveText(/^claude mcp add opencalque-live -- /)
    const shown = (await code.textContent())!
    const words = [...shown.split(' -- ')[1].matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
    expect(words.at(-1)).toBe('--mcp')

    const agent = liveAgent(env, [words[0], words.slice(1)])
    const hello = (await agent.start()) as unknown as { result: { serverInfo: { name: string } } }
    expect(hello.result.serverInfo.name).toBe('opencalque')
    const summary = JSON.parse((await agent.call('describe_drawing')).content[0].text!)
    expect(summary.pages).toHaveLength(1)
    const guide = await agent.call('read_guide')
    expect(guide.content[0].text).toContain('# How a drawing is stored')

    // It opened no window of its own, and it goes when the agent does.
    expect(app.windows()).toHaveLength(1)
    agent.close()
    await agent.gone
  } finally {
    await app.close()
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    } catch {}
  }
})
