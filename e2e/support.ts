import { expect, test, type Page } from '@playwright/test'

/*
 * What the browser tests share: a fresh profile with chosen settings, a stand-in save dialog, the
 * canvas and the Structure list, and the check that no test leaves a script error behind.
 */

/** Settings stored before the app starts, as Preferences would store them. */
export async function startWith(page: Page, prefs: Record<string, unknown> = {}) {
  await page.addInitScript((stored) => {
    if (!sessionStorage.getItem('started')) {
      localStorage.setItem('opencalque.prefs', JSON.stringify({ showWelcome: false, unit: 'mm', language: 'en', ...stored }))
      sessionStorage.setItem('started', '1')
    }
  }, prefs)
}

/**
 * Opens the editor, and waits for its loading screen to let clicks through: until then, a click
 * made by position lands on it rather than on the canvas.
 */
export async function openEditor(page: Page) {
  await page.goto('/')
  await expect(page.locator('#splash:not(.leaving)')).toHaveCount(0)
}

/**
 * Stands in for the browser's save dialog (File System Access API), which a test cannot answer:
 * every save is recorded in `window.saves` instead of written to disk.
 */
export async function recordSaves(page: Page) {
  await page.addInitScript(() => {
    const saves: string[] = []
    ;(window as any).saves = saves
    ;(window as any).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      name: suggestedName,
      createWritable: async () => {
        let content = ''
        return { write: async (data: unknown) => void (content = typeof data === 'string' ? data : '(bytes)'), close: async () => void saves.push(content) }
      },
    })
  })
}

export const canvas = (page: Page) => page.locator('.stage canvas')
export const objectRows = (page: Page) => page.locator('[data-panel="objects"] .row')
/** A section of the object library, in the list on its left, by its name. */
export const librarySection = (page: Page, name: string) => page.locator('.warehouse-section', { has: page.locator('.warehouse-section-name', { hasText: new RegExp(`^${name}$`) }) })

/** Draws a wall from one point of the canvas to another, in CSS pixels from its top-left corner. */
export async function drawWall(page: Page, from: [number, number], to: [number, number]) {
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('w')
  await page.mouse.click(box.x + from[0], box.y + from[1])
  await page.mouse.click(box.x + to[0], box.y + to[1])
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
}

/** Chooses a file for the next file dialog the page opens. */
export async function choose(page: Page, open: () => Promise<void>, name: string, content: string) {
  const chooser = page.waitForEvent('filechooser')
  await open()
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(content) })
}

/**
 * Where a point of the drawing is on the page, for a drawing brought into view as it opened: read
 * from the status bar, which says where the pointer is in millimetres, at two places.
 */
export async function drawingOnScreen(page: Page): Promise<(x: number, y: number) => [number, number]> {
  const box = (await canvas(page).boundingBox())!
  const reading = async (x: number, y: number) => {
    await page.mouse.move(box.x + x, box.y + y)
    const text = (await page.locator('.status span').textContent())!.replaceAll(String.fromCharCode(0x2212), '-').replace(/[^\d.,-]/g, '')
    const [wx, wy] = text.split(',').map(Number)
    return { x: wx, y: wy }
  }
  const p = await reading(100, 100)
  const q = await reading(700, 500)
  const zoom = 600 / (q.x - p.x)
  return (x, y) => [box.x + 100 + (x - p.x) * zoom, box.y + 100 + (y - p.y) * zoom]
}

export const drawing = (nodes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'opencalque',
    version: 1,
    id: 'doc_test',
    name: 'Test',
    unit: 'mm',
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order: 'a0' } },
    nodes: { page_1: { id: 'page_1', type: 'page', name: 'Page 1', parent: null, order: 'a0' }, ...nodes },
    ...extra,
  })


/** Fails any test of the file that leaves a script error or a Content-Security-Policy violation behind. */
export function failOnErrors() {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    ;(page as any).errors = errors
  })

  test.afterEach(async ({ page }) => {
    // No script error and no Content-Security-Policy violation, whatever the test did.
    expect((page as any).errors).toEqual([])
  })
}
