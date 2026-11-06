import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, safeStorage, shell, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { agentCommand, startBridge, type Bridge } from './bridge'
import { checkForUpdate, installOnClose, installUpdate, keptOpen, listen } from './updates'

// Under test, on a computer someone is working at: the window is shown, so that the page runs as it
// does for a person, but off the screen, out of the taskbar and without taking the focus. Windows
// would count it as covered and Chromium stop painting it, so that is switched off, and nothing
// asks about unsaved changes: that dialog would come up on the screen, with the focus.
const inBackground = process.env.OPENCALQUE_BACKGROUND === '1'
if (inBackground) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Started by an agent (mcp.ts): no window, and a profile of its own, to leave the running app's alone.
const servingAgents = process.argv.includes('--mcp')
if (servingAgents) app.setPath('userData', join(app.getPath('temp'), 'opencalque-mcp'))

// Settings made while the project was called OpenCAD (preferences, shortcuts, conversations) are
// carried over the first time the renamed app starts.
const former = join(app.getPath('appData'), '@opencad', 'desktop')
if (!servingAgents && !existsSync(app.getPath('userData')) && existsSync(former)) cpSync(former, app.getPath('userData'), { recursive: true })

// Files the user chose in a dialog or launched the app with. The window may only write to these.
const granted = new Set<string>()
let dirty = false
// The words of the app's own dialogs. The window supplies them in the user's language once it has loaded.
let labels = {
  unsaved: 'You have unsaved changes.',
  discard: 'Discard changes',
  cancel: 'Cancel',
  connect: 'Let the assistant connect to {origin}?',
  connectDetail: 'OpenCalque reaches an AI service only at an address set in Preferences. Allow it if you entered this address yourself.',
  allow: 'Allow',
  deny: 'Do not allow',
}
let claude: ChildProcess | null = null

/**
 * Writes a file so that it is never left half-written, whatever happens while it is being
 * written (the app stopped, the computer switched off, the disk full): the content goes to a file
 * beside it, which then takes its place in one step. The file that was there stays whole until then.
 */
async function writeSafely(path: string, content: string | Uint8Array): Promise<void> {
  // A link is followed, so that the file it points to is replaced, not the link.
  const target = await realpath(path).catch(() => path)
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}-${Date.now()}.tmp`)
  await writeFile(temporary, content)
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(temporary, target)
    } catch (error) {
      // On Windows a program that has the file open for a moment (a cloud folder synchronising it, an
      // antivirus reading it) makes the replacement fail: it is tried again, and in the end the file
      // is written over in place, which is what saving did before, rather than not saved at all.
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        await new Promise((done) => setTimeout(done, 100 * attempt))
        continue
      }
      await unlink(temporary).catch(() => {})
      if (!['EPERM', 'EBUSY', 'EACCES', 'EXDEV'].includes(code)) throw error
      return writeFile(target, content)
    }
  }
}

/** Where the drawings are copied before this app first writes over them. */
const backups = join(app.getPath('userData'), 'backups')
/** How many of those copies are kept, the newest. */
const BACKUPS_KEPT = 30
/** The drawings already copied since the app started. */
const backedUp = new Set<string>()

/**
 * Copies a drawing as it was before the app first writes over it, once each time the app runs:
 * what was saved before can be found again in the backups folder, whatever the app later does to it.
 */
async function backUp(path: string): Promise<void> {
  if (backedUp.has(path) || !/\.(opencalque|opencad)$/i.test(path) || !existsSync(path)) return
  backedUp.add(path)
  try {
    await mkdir(backups, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(path, join(backups, `${stamp} ${basename(path)}`))
    // Named after the time they were made, they sort oldest first.
    const kept = (await readdir(backups)).filter((name) => /\.(opencalque|opencad)$/i.test(name)).sort()
    for (const old of kept.slice(0, Math.max(0, kept.length - BACKUPS_KEPT))) await unlink(join(backups, old)).catch(() => {})
  } catch {
    // A backup that cannot be made must not stop the drawing from being saved.
  }
}

/**
 * Addresses the assistant may reach through the main process (see 'net:request'). A model server
 * on this computer always; any other only once the user has said yes to it, in a dialog the page
 * cannot fake, so that a page that went wrong could not use the app to reach the network around it.
 */
const allowedFile = join(app.getPath('userData'), 'allowed-hosts.json')
let allowedOrigins: string[] = []
try {
  const stored = JSON.parse(readFileSync(allowedFile, 'utf8'))
  if (Array.isArray(stored)) allowedOrigins = stored.filter((origin) => typeof origin === 'string')
} catch {
  // None allowed yet.
}

async function mayReach(url: URL, win: BrowserWindow | null): Promise<boolean> {
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true
  if (allowedOrigins.includes(url.origin)) return true
  const options = {
    type: 'question' as const,
    message: labels.connect.replace('{origin}', url.origin),
    detail: labels.connectDetail,
    buttons: [labels.allow, labels.deny],
    defaultId: 1,
    cancelId: 1,
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (response !== 0) return false
  allowedOrigins = [...allowedOrigins, url.origin]
  writeFile(allowedFile, JSON.stringify(allowedOrigins)).catch(() => {})
  return true
}

/**
 * Sends one prompt to the Claude Code CLI and resolves with its reply. The CLI runs in an empty
 * folder of its own in restricted mode, without MCP servers or skills: it is used here as a model,
 * not as an agent, so it gets nothing to act on. Every argument is fixed or validated, and the
 * prompt goes through stdin, so nothing the user typed reaches a command line. The folder is the
 * same every time, because the CLI keeps its conversations by folder: `--resume` finds one only there.
 */
async function runClaude(input: { prompt: string; session?: string; model?: string }): Promise<{ text: string; session: string }> {
  const args = ['-p', '--output-format', 'json', '--restricted', '--strict-mcp-config', '--disable-slash-commands']
  if (input.session && /^[\w-]+$/.test(input.session)) args.push('--resume', input.session)
  if (input.model && /^[\w.[\]-]+$/.test(input.model)) args.push('--model', input.model)
  const cwd = join(app.getPath('userData'), 'assistant')
  await mkdir(cwd, { recursive: true })
  return new Promise((done, fail) => {
    // On Windows the CLI is a .cmd or .exe found through the shell's PATH lookup.
    const child = spawn('claude', args, { cwd, shell: process.platform === 'win32', windowsHide: true })
    claude = child
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', () => fail(new Error('The "claude" program was not found. Install Claude Code and sign in first.')))
    child.on('close', (code) => {
      claude = null
      try {
        const reply = JSON.parse(stdout)
        if (reply.is_error) return fail(new Error(String(reply.result ?? 'The CLI reported an error.')))
        done({ text: String(reply.result ?? ''), session: String(reply.session_id ?? '') })
      } catch {
        const missing = code !== 0 && /not recognized|not found|ENOENT/i.test(stderr)
        fail(new Error(missing ? 'The "claude" program was not found. Install Claude Code and sign in first.' : stderr.trim().slice(0, 300) || `The CLI stopped with code ${code}.`))
      }
    })
    child.stdin.end(input.prompt)
  })
}

// The drawings opened or saved lately, newest first. Kept here, not in the window, so that the
// window can only ask to reopen a file the user already chose once.
const recentFile = join(app.getPath('userData'), 'recent.json')
let recent: string[] = []
try {
  const stored = JSON.parse(readFileSync(recentFile, 'utf8'))
  if (Array.isArray(stored)) recent = stored.filter((path) => typeof path === 'string')
} catch {
  // No list yet.
}

function remember(path: string): void {
  recent = [path, ...recent.filter((other) => other !== path)].slice(0, 8)
  writeFile(recentFile, JSON.stringify(recent)).catch(() => {})
}

// The keys of the assistant's services, encrypted by the system (`safeStorage`), each by the
// service it is for, so that they are not kept in plain text with the window's preferences.
const secretsFile = join(app.getPath('userData'), 'secrets.json')
const SECRET_NAMES = ['anthropic', 'compatible']
let secrets: Record<string, string> = {}
try {
  const stored = JSON.parse(readFileSync(secretsFile, 'utf8'))
  if (stored && typeof stored === 'object') secrets = Object.fromEntries(Object.entries(stored).filter(([name, value]) => SECRET_NAMES.includes(name) && typeof value === 'string')) as Record<string, string>
} catch {
  // None kept yet.
}

/** Whether keys can be kept encrypted: on Linux without a keyring, Electron would only obscure them, so they stay where they were. */
const canEncrypt = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

function secret(name: string): string | null {
  if (!SECRET_NAMES.includes(name) || !secrets[name] || !canEncrypt()) return null
  try {
    return safeStorage.decryptString(Buffer.from(secrets[name], 'base64'))
  } catch {
    return null
  }
}

async function keepSecret(name: string, value: string): Promise<void> {
  if (!SECRET_NAMES.includes(name) || typeof value !== 'string' || !canEncrypt()) return
  if (value) secrets[name] = safeStorage.encryptString(value).toString('base64')
  else delete secrets[name]
  await writeFile(secretsFile, JSON.stringify(secrets))
}

async function read(path: string) {
  granted.add(path)
  remember(path)
  return { name: basename(path), content: await readFile(path, 'utf8'), token: path }
}

/**
 * Drawings macOS asks the app to open (a double-click in the Finder, a drop on the Dock icon),
 * which come as events rather than as arguments. The window may read only these, and each once.
 */
const requested = new Set<string>()
/** Those that came before the window was ready to hear of them. */
const waiting: string[] = []
let listening: Electron.WebContents | null = null

app.on('open-file', (event, path) => {
  event.preventDefault()
  requested.add(path)
  if (listening && !listening.isDestroyed()) listening.send('file:openRequest', path)
  else waiting.push(path)
})

/**
 * How the system's buttons sit over the menu bar on Windows. The strip behind them is see-through,
 * so it is whatever the app shows there: the menu bar, or the veil of an open window. The height
 * is that of `.menubar` in the web app.
 *
 * The highlight under the minimise and maximise buttons is not set here: Windows draws it dark or
 * light according to `nativeTheme`, so that must always say what the app is showing (see
 * 'app:theme'), or a light bar gets a white highlight that cannot be seen.
 */
const titleBarButtons = (dark: boolean) => ({ color: '#00000000', symbolColor: dark ? '#e6e6e6' : '#1e1e1e', height: 36 })

/** Longest an agent waits for the editor, in ms. */
const BRIDGE_TIMEOUT = 120_000
let bridge: Bridge | null = null
/** The window that answers, which a reload replaces. */
let bridgeWindow: WebContents | null = null
let nextBridgeCall = 0
const bridgeCalls = new Map<number, (result: unknown) => void>()
/** Turning it on and off are done in turn, so that quick clicks cannot leave two doors open. */
let bridgeChange: Promise<void> = Promise.resolve()

/** Hands a call from an agent to the window and waits for its answer. */
function callEditor(name: string, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!bridgeWindow || bridgeWindow.isDestroyed()) return reject(new Error('The window of the app is closed.'))
    const id = nextBridgeCall++
    const timer = setTimeout(() => {
      bridgeCalls.delete(id)
      reject(new Error('The app did not answer in time.'))
    }, BRIDGE_TIMEOUT)
    bridgeCalls.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    bridgeWindow.send('bridge:call', id, name, input)
  })
}

function setBridge(on: boolean, sender: WebContents): Promise<void> {
  bridgeWindow = sender
  bridgeChange = bridgeChange
    .then(async () => {
      if (on && !bridge) bridge = await startBridge(callEditor)
      if (!on && bridge) {
        bridge.stop()
        bridge = null
      }
    })
    .catch((error) => console.error('The door for agents could not be changed:', error))
  return bridgeChange
}

function createWindow(): void {
  // On Windows and macOS the window has no title bar of its own: the app's menu bar is the top of
  // the window, with the system's buttons drawn over its end. Linux keeps its usual frame.
  const merged = process.platform === 'win32' || process.platform === 'darwin'
  // The system's light or dark until the page says which theme it shows ('app:theme'); the
  // loading screen in index.html takes the same colours.
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    titleBarStyle: merged ? 'hidden' : 'default',
    titleBarOverlay: merged ? titleBarButtons(dark) : false,
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenCalque',
    backgroundColor: dark ? '#1e1e1e' : '#ffffff',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
    ...(inBackground ? { show: false, x: -10000, y: -10000, skipTaskbar: true } : {}),
  })
  if (inBackground) win.showInactive()
  // A link never opens a window of the app: a web address goes to the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Nor does the window ever leave the app for another page, by a link or a file dropped where the page does not take it.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
  })
  win.on('close', (event) => {
    if (!dirty || inBackground) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: labels.unsaved,
      buttons: [labels.discard, labels.cancel],
      defaultId: 1,
      cancelId: 1,
    })
    if (choice === 1) {
      event.preventDefault()
      // Closing to install an update stops here too: it is installed when the app closes later.
      keptOpen()
    }
  })

  // `electron-vite dev` serves the web app with hot reload; a build loads it from disk.
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // Smoke test hook: OPENCALQUE_SCREENSHOT=<file.png> saves a picture of the window, then quits.
  const screenshot = process.env.OPENCALQUE_SCREENSHOT
  if (screenshot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        await writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
        dirty = false
        app.quit()
      }, 2000)
    })
  }
}

app.whenReady().then(() => {
  if (servingAgents) {
    app.dock?.hide()
    // Not app.quit(), which would wait for the read of stdin in progress.
    return void import('./mcp').then(({ serveAgents }) => serveAgents(app.getVersion(), () => app.exit(0)))
  }
  Menu.setApplicationMenu(null)

  ipcMain.handle('file:open', async (event, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'OpenCalque', extensions }] })
    return result.canceled ? null : read(result.filePaths[0])
  })

  ipcMain.handle('file:openBytes', async (event, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Plans and pictures', extensions }] })
    if (result.canceled) return null
    return { name: basename(result.filePaths[0]), bytes: new Uint8Array(await readFile(result.filePaths[0])) }
  })

  ipcMain.handle('file:save', async (event, content: string | Uint8Array, suggestedName: string, token?: string) => {
    let path = token
    if (!path || !granted.has(path)) {
      const win = BrowserWindow.fromWebContents(event.sender)!
      // A filter of the file's type: the dialog shows it ("OpenCalque (*.opencalque)") and adds the extension to a name typed without one.
      const extension = extname(suggestedName).slice(1).toLowerCase()
      const filters = extension ? [{ name: /^(opencalque|opencad)$/.test(extension) ? 'OpenCalque' : extension.toUpperCase(), extensions: [extension] }] : []
      const result = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters })
      if (result.canceled || !result.filePath) return null
      path = result.filePath
      granted.add(path)
    }
    await backUp(path)
    await writeSafely(path, content)
    // Exports (PDF, SVG, DXF) are saved this way too; only drawings are worth reopening.
    if (/\.(opencalque|opencad)$/i.test(path)) remember(path)
    return { name: basename(path), token: path }
  })

  ipcMain.handle('file:recent', () => recent.filter((path) => existsSync(path)).map((path) => ({ name: basename(path), path })))

  ipcMain.handle('file:openRecent', (_, path: string) => (recent.includes(path) && existsSync(path) ? read(path) : null))

  ipcMain.handle('file:initial', () => {
    const asked = waiting.shift()
    if (asked) return read(asked)
    const file = process.argv.slice(1).find((arg) => arg.endsWith('.opencalque') || arg.endsWith('.opencad'))
    return file ? read(resolve(file)) : null
  })

  // The window is ready to be told of drawings to open; those that came before it was are told now.
  ipcMain.on('file:listen', (event) => {
    listening = event.sender
    for (const path of waiting.splice(0)) event.sender.send('file:openRequest', path)
  })

  ipcMain.handle('file:openRequested', (_, path: string) => {
    if (!requested.delete(path) || !existsSync(path)) return null
    return read(path)
  })

  ipcMain.on('file:showBackups', async () => {
    await mkdir(backups, { recursive: true }).catch(() => {})
    shell.openPath(backups)
  })

  ipcMain.on('doc:dirty', (_, value: boolean) => {
    dirty = value
  })

  // The web app chooses light or dark; the system's buttons over the menu bar and its dialogs follow.
  // When the app follows the system, so does the window, which keeps the page told of its changes.
  ipcMain.on('app:theme', (event, dark: boolean, followsSystem?: boolean) => {
    nativeTheme.themeSource = followsSystem ? 'system' : dark ? 'dark' : 'light'
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && process.platform === 'win32') win.setTitleBarOverlay(titleBarButtons(dark))
    win?.setBackgroundColor(dark ? '#1e1e1e' : '#ffffff')
  })

  ipcMain.on('app:labels', (_, given: Partial<typeof labels>) => {
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) if (typeof given[key] === 'string') labels[key] = given[key]
  })

  // Lets the assistant reach a model server on this computer without that server having to
  // accept requests from the app's page.
  ipcMain.handle('net:request', async (event, url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https addresses can be requested.')
    if (!(await mayReach(new URL(url), BrowserWindow.fromWebContents(event.sender)))) throw new Error(`Connecting to ${new URL(url).origin} was not allowed.`)
    // A request without a body (GET) must not be given one, even an empty one.
    const response = await net.fetch(url, init.body ? init : { method: init.method, headers: init.headers })
    return { status: response.status, body: await response.text() }
  })

  ipcMain.handle('secret:available', () => canEncrypt())
  ipcMain.handle('secret:get', (_, name: string) => secret(name))
  ipcMain.handle('secret:set', (_, name: string, value: string) => keepSecret(name, value))

  ipcMain.handle('claude:run', (_, input: { prompt: string; session?: string; model?: string }) => runClaude(input))
  ipcMain.on('claude:cancel', () => claude?.kill())

  // Agents on this computer, while the person lets them (bridge.ts): what they ask runs in the window.
  ipcMain.on('bridge:set', (event, on: boolean) => void setBridge(on, event.sender))
  ipcMain.handle('bridge:command', () => agentCommand({ exe: process.execPath, packaged: app.isPackaged, appPath: app.getAppPath(), env: process.env }))
  ipcMain.on('bridge:result', (_, id: number, result: unknown) => {
    bridgeCalls.get(id)?.(result)
    bridgeCalls.delete(id)
  })

  // A newer version of the app: looked for when the window asks (updates.ts).
  ipcMain.on('update:listen', (event) => listen(event.sender))
  ipcMain.on('update:check', () => checkForUpdate())
  ipcMain.on('update:install', () => installUpdate())

  createWindow()
})

// The door for agents closes with the app, and the file that says where it was goes with it.
app.on('will-quit', () => bridge?.stop())

// Unless the windows closed to install an update, which then quits the app itself.
app.on('window-all-closed', () => installOnClose() || app.quit())
