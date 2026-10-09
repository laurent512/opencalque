import { app, BrowserWindow, dialog, ipcMain, Menu, net } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

// Settings made while the project was called OpenCAD (preferences, shortcuts, conversations) are
// carried over the first time the renamed app starts.
const former = join(app.getPath('appData'), '@opencad', 'desktop')
if (!existsSync(app.getPath('userData')) && existsSync(former)) cpSync(former, app.getPath('userData'), { recursive: true })

// Files the user chose in a dialog or launched the app with. The window may only write to these.
const granted = new Set<string>()
let dirty = false
// The window supplies these in the user's language once it has loaded.
let closeWarning = { message: 'You have unsaved changes.', discard: 'Discard changes', cancel: 'Cancel' }
let claude: ChildProcess | null = null

/**
 * Sends one prompt to the Claude Code CLI and resolves with its reply. The CLI runs in an empty
 * folder in restricted mode, without MCP servers or skills: it is used here as a model, not as an
 * agent, so it gets nothing to act on. Every argument is fixed or validated, and the prompt goes
 * through stdin, so nothing the user typed reaches a command line.
 */
async function runClaude(input: { prompt: string; session?: string; model?: string }): Promise<{ text: string; session: string }> {
  const args = ['-p', '--output-format', 'json', '--restricted', '--strict-mcp-config', '--disable-slash-commands']
  if (input.session && /^[\w-]+$/.test(input.session)) args.push('--resume', input.session)
  if (input.model && /^[\w.[\]-]+$/.test(input.model)) args.push('--model', input.model)
  const cwd = await mkdtemp(join(tmpdir(), 'opencalque-claude-'))
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

async function read(path: string) {
  granted.add(path)
  return { name: basename(path), content: await readFile(path, 'utf8'), token: path }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenCalque',
    backgroundColor: '#ffffff',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
  })
  win.on('close', (event) => {
    if (!dirty) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: closeWarning.message,
      buttons: [closeWarning.discard, closeWarning.cancel],
      defaultId: 1,
      cancelId: 1,
    })
    if (choice === 1) event.preventDefault()
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
      const result = await dialog.showSaveDialog(win, { defaultPath: suggestedName })
      if (result.canceled || !result.filePath) return null
      path = result.filePath
      granted.add(path)
    }
    await writeFile(path, content, 'utf8')
    return { name: basename(path), token: path }
  })

  ipcMain.handle('file:initial', () => {
    const file = process.argv.slice(1).find((arg) => arg.endsWith('.opencalque') || arg.endsWith('.opencad'))
    return file ? read(resolve(file)) : null
  })

  ipcMain.on('doc:dirty', (_, value: boolean) => {
    dirty = value
  })

  ipcMain.on('doc:closeWarning', (_, labels: typeof closeWarning) => {
    closeWarning = labels
  })

  // Lets the assistant reach a model server on this computer without that server having to
  // accept requests from the app's page.
  ipcMain.handle('net:request', async (_, url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https addresses can be requested.')
    // A request without a body (GET) must not be given one, even an empty one.
    const response = await net.fetch(url, init.body ? init : { method: init.method, headers: init.headers })
    return { status: response.status, body: await response.text() }
  })

  ipcMain.handle('claude:run', (_, input: { prompt: string; session?: string; model?: string }) => runClaude(input))
  ipcMain.on('claude:cancel', () => claude?.kill())

  createWindow()
})

app.on('window-all-closed', () => app.quit())
