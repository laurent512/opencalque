const { app, BrowserWindow } = require('electron')
const fs = require('fs'), os = require('os'), path = require('path')

// Interaction smoke test: drives the built app with real mouse and keyboard events and saves
// screenshots to look at. Run `pnpm build` first, then `pnpm smoke`. Coordinates are CSS pixels
// for a 1400x900 window and assume the current panel layout; update them if the layout changes.
const root = path.resolve(__dirname, '../../..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'opencalque-smoke-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: true })
  const wc = win.webContents
  wc.on('console-message', (e) => console.log('console:', e.message))
  await win.loadFile(path.join(root, 'apps/desktop/out/renderer/index.html'))
  await sleep(800)
  const key = async (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode.length === 1 && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(120) }
  const move = async (x, y) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); await sleep(60) }
  const click = async (x, y, modifiers = []) => { await move(x, y); wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers }); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers }); await sleep(120) }
  const shot = async (name) => { await sleep(300); fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG()) }
  // Draw an L of two walls with the wall tool, leave a third segment as a live preview.
  await key('w'); await click(500, 300); await click(800, 300); await click(800, 520); await move(640, 600)
  await shot('s1-drawing.png')
  await key('Escape'); await key('v')
  // Rectangle by dragging, then a stair from the assets panel.
  await key('r'); await move(540, 360); wc.sendInputEvent({ type: 'mouseDown', x: 540, y: 360, button: 'left', clickCount: 1 }); await sleep(250); await move(600, 400); await move(700, 460); wc.sendInputEvent({ type: 'mouseUp', x: 700, y: 460, button: 'left', clickCount: 1 }); await sleep(150)
  await key('v'); await click(620, 360); await shot('s2-selected.png')
  // Select everything, make a component, place a second instance rotated.
  await key('a', ['control']); await key('k', ['control', 'alt']); await shot('s3-component.png')
  // Chosen through the command list, which works in any language and any panel arrangement.
  await key('k', ['control']); for (const c of 'place component') await key(c); await key('Enter')
  await move(900, 620); await key('r'); await click(1000, 640); await key('Escape')
  await click(700, 330); await click(700, 330)
  await shot('s4-instances.png')
  console.log(`Screenshots: ${out}`)
  app.exit(0)
})
