import { readFileSync } from 'node:fs'
import { expect, test, type Locator } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, drawWall, failOnErrors, librarySection, objectRows, openEditor, pickIn, recordSaves, startWith } from './support'

/**
 * The editor in a browser, as people use it. Each test starts from a fresh profile: no drawing, no
 * settings, the welcome window turned off unless the test wants it.
 */

failOnErrors()

test('draws a wall, undoes and redoes it', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await expect(objectRows(page)).toHaveCount(0)
  await drawWall(page, [300, 300], [700, 300])
  await expect(objectRows(page)).toHaveCount(1)
  await expect(objectRows(page).first()).toContainText('Wall')
  await page.keyboard.press('Control+z')
  await expect(objectRows(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(objectRows(page)).toHaveCount(1)
})

test('saves a drawing, then saves each change by itself', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await drawWall(page, [300, 300], [700, 300])
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).saves[0])).toContain('"type": "wall"')
  await expect(page.locator('.menubar-saved')).toBeVisible()
  await drawWall(page, [300, 400], [700, 400])
  // Autosave waits for two seconds without changes.
  await expect.poll(() => page.evaluate(() => (window as any).saves.length), { timeout: 8000 }).toBe(2)
  expect((await page.evaluate(() => (window as any).saves[1])).match(/"type": "wall"/g)).toHaveLength(2)
})

test('imports a large scan as a plan to trace, kept up to 8192 pixels wide so that small details stay sharp', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // A scan of 10000 × 5000 pixels, made in the page: a PNG of it is small, all white but a dot.
  const png = await page.evaluate(async () => {
    const scan = new OffscreenCanvas(10000, 5000)
    const ctx = scan.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, scan.width, scan.height)
    ctx.fillStyle = '#000000'
    ctx.fillRect(100, 100, 2, 2)
    const bytes = new Uint8Array(await (await scan.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  })
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Import floor plan')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.toast')).toContainText('Plan imported')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const saved = JSON.parse(await page.evaluate(() => (window as any).saves[0]))
  const assets = Object.values(saved.assets) as { mime: string; width: number; height: number }[]
  expect(assets.map(({ mime, width, height }) => [mime, width, height])).toEqual([['image/jpeg', 8192, 4096]])
})

test('imports a page of an A1 PDF as a plan to trace, drawn 8192 pixels wide and placed as if at 1:100', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // A blank A1 sheet, landscape: 2384 × 1684 points.
  const pdf = '%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 2384 1684]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n'
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Import floor plan')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name: 'sheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  await expect(page.locator('.toast')).toContainText('Plan imported')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const saved = JSON.parse(await page.evaluate(() => (window as any).saves[0]))
  const assets = Object.values(saved.assets) as { width: number; height: number }[]
  expect(assets.map(({ width, height }) => [width, height])).toEqual([[8192, 5787]])
  const plan = Object.values(saved.nodes).find((node: any) => node.type === 'image') as { width: number }
  expect(plan.width).toBeCloseTo(((2384 * 25.4) / 72) * 100, 0)
})

test('a drawing saved under a name of its own takes that name, which exports then use', async ({ page }) => {
  await startWith(page)
  // A save dialog in which the user types "Cabin" over the name suggested.
  await page.addInitScript(() => {
    const saves: { name: string; content: string }[] = []
    ;(window as any).saves = saves
    ;(window as any).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => {
      const name = suggestedName.endsWith('.opencalque') ? 'Cabin.opencalque' : suggestedName
      return {
        name,
        createWritable: async () => {
          let content = ''
          return { write: async (data: unknown) => void (content = typeof data === 'string' ? data : '(bytes)'), close: async () => void saves.push({ name, content }) }
        },
      }
    }
  })
  await openEditor(page)
  await expect(page.locator('.menubar-name')).toContainText('Untitled')
  await drawWall(page, [300, 300], [700, 300])
  await page.keyboard.press('Control+s')
  await expect(page.locator('.menubar-name')).toContainText('Cabin')
  // Written again with its new name, and left saved.
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(2)
  expect(JSON.parse(await page.evaluate(() => (window as any).saves[1].content)).name).toBe('Cabin')
  await expect(page.locator('.menubar-saved')).toBeVisible()
  await expect(page).toHaveTitle(/^Cabin\.opencalque/)
  await page.keyboard.press('Control+e')
  await page.getByRole('radio', { name: /SVG/ }).click()
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).saves.at(-1).name)).toBe('Cabin.svg')
})

test('keeps the icon of the tool in use white on its blue under the pointer', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const tool = page.locator('.toolbar .icon-button.active').first()
  const colour = () => tool.evaluate((button) => getComputedStyle(button).color)
  const resting = await colour()
  await tool.hover()
  await expect.poll(colour).toBe(resting)
})

test('exports what is selected from its right-click menu: papers as their sheets in a PDF, anything else alone in a picture', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing({
    first: { id: 'first', type: 'paper', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Plan sheet', x: 0, y: 0, width: 42000, height: 29700, scale: 100 },
    second: { id: 'second', type: 'paper', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Other sheet', x: 50000, y: 0, width: 42000, height: 29700, scale: 100 },
    box: { id: 'box', type: 'rect', parent: 'page_1', layer: 'layer_1', order: 'a3', name: 'Box', x: 1000, y: 1000, width: 2000, height: 1000 },
    round: { id: 'round', type: 'ellipse', parent: 'page_1', layer: 'layer_1', order: 'a4', name: 'Round', cx: 6000, cy: 1500, rx: 500, ry: 500 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'sheets.opencalque', plan)
  const dialog = page.locator('.dialog.export')
  const exportFrom = async (row: string) => {
    await objectRows(page).filter({ hasText: new RegExp(`^${row}$`) }).click({ button: 'right' })
    await page.locator('.context-menu').getByText('Export the selection…').click()
    await expect(dialog).toBeVisible()
  }
  // A paper: its sheet alone, in a PDF.
  await exportFrom('Plan sheet')
  await expect(dialog.getByRole('radio', { name: /PDF/ })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.locator('.pref-row', { hasText: 'Plan sheet' }).getByRole('checkbox')).toBeChecked()
  await expect(dialog.locator('.pref-row', { hasText: 'Other sheet' }).getByRole('checkbox')).not.toBeChecked()
  // What goes in it, then how, each under its heading.
  await expect(dialog.locator('h3')).toContainText(['Sheets', 'Options'])
  await page.keyboard.press('Escape')
  // Anything else: a picture of it alone, the page still to be chosen instead.
  await exportFrom('Box')
  await expect(dialog.getByRole('radio', { name: /PNG/ })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.locator('h3')).toContainText(['What is exported', 'Options'])
  await expect(dialog.getByRole('tab', { name: 'The selection (1 object)' })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('radio', { name: /SVG/ }).click()
  await expect(dialog.getByRole('tab', { name: 'The selection (1 object)' })).toHaveAttribute('aria-selected', 'true')
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await dialog.locator('footer button').click()
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const svg: string = await page.evaluate(() => (window as any).saves.at(-1))
  expect(svg).toContain('<path')
  expect(svg).not.toContain('<ellipse')
  // Opened as usual, it is of a page, the selection to be chosen.
  await page.keyboard.press('Control+e')
  await dialog.getByRole('radio', { name: /SVG/ }).click()
  await expect(dialog.getByRole('tab', { name: 'A page' })).toHaveAttribute('aria-selected', 'true')
})

test('sets a paper in sections: where it lies and its sheet under Geometry, then its title block, then what is on every sheet', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const plan = drawing({ first: { id: 'first', type: 'paper', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Plan sheet', x: 0, y: 0, width: 42000, height: 29700, scale: 100 } })
  await choose(page, () => page.keyboard.press('Control+o'), 'sheets.opencalque', plan)
  await objectRows(page).filter({ hasText: /^Plan sheet$/ }).click()
  const properties = page.locator('[data-panel="properties"]')
  await expect(properties.locator('h3')).toContainText(['Geometry', 'Title block', 'On every sheet'])
  const geometry = properties.locator('section.section', { has: page.locator('h3', { hasText: /^Geometry$/ }) })
  await expect(geometry).toContainText('Position')
  await expect(geometry).toContainText('Format')
  await expect(geometry.locator('.field', { has: page.locator('span:text-is("Scale")') }).locator('input')).toHaveValue('100')
  await expect(geometry.locator('.field-prefix')).toHaveText('1:')
  // No paragraphs of explanation in its sections: said when the pointer rests on what they explain.
  for (const title of ['Geometry', 'Title block', 'On every sheet']) await expect(properties.locator('section.section', { has: page.locator('h3', { hasText: new RegExp(`^${title}$`) }) }).locator('.hint')).toHaveCount(0)
  // Its title block, turned on here: what it says.
  const block = properties.locator('section.section', { has: page.locator('h3', { hasText: /^Title block$/ }) })
  await block.getByRole('radio', { name: 'Yes' }).click()
  await expect(block).toContainText('For the whole drawing')
  await expect(block).toContainText('For this sheet')
})

test('offers the papers in groups in the PDF export window, with the others', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const plan = drawing({
    loose: { id: 'loose', type: 'paper', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Loose sheet', x: 0, y: 0, width: 42000, height: 29700, scale: 100 },
    sheets: { id: 'sheets', type: 'group', parent: 'page_1', layer: 'layer_1', order: 'a2' },
    held: { id: 'held', type: 'paper', parent: 'sheets', layer: 'layer_1', order: 'a1', name: 'Grouped sheet', x: 50000, y: 0, width: 42000, height: 29700, scale: 100 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'sheets.opencalque', plan)
  await page.keyboard.press('Control+e')
  await page.getByRole('radio', { name: /PDF/ }).click()
  const listed = page.locator('.dialog.export .pref-row')
  await expect(listed.filter({ hasText: 'Grouped sheet' }).getByRole('checkbox')).toBeChecked()
  await expect(listed.filter({ hasText: 'Loose sheet' }).getByRole('checkbox')).toBeChecked()
})

test('opens a drawing that needs repairs, and says so; refuses one from a newer version', async ({ page }) => {
  await startWith(page)
  // "Discard unsaved changes?" before opening the second file.
  page.on('dialog', (dialog) => dialog.accept())
  await openEditor(page)
  const broken = drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200, layer: 'missing' } })
  await choose(page, () => page.keyboard.press('Control+o'), 'broken.opencalque', broken)
  await expect(page.locator('.toast')).toContainText('One problem in broken.opencalque was put right')
  await expect(objectRows(page)).toHaveCount(1)
  // Still editable: a wall can be drawn next to it.
  await drawWall(page, [300, 500], [700, 500])
  await expect(objectRows(page)).toHaveCount(2)

  await choose(page, () => page.keyboard.press('Control+o'), 'future.opencalque', drawing({}, { version: 99 }))
  await expect(page.locator('.toast')).toContainText('future.opencalque was saved by a newer version of OpenCalque')
  await expect(objectRows(page)).toHaveCount(2)
})

test('pastes where one is looking: a cut thing back in place, a copy beside it, else in the middle of the view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await drawWall(page, [300, 300], [700, 300])
  const x1 = page.locator('label.field', { has: page.locator('span:text-is("X1")') }).locator('input')
  await objectRows(page).first().click()
  await expect(x1).toHaveValue('-200')

  // Cut and pasted while in view, it comes back exactly where it was.
  await page.keyboard.press('Control+x')
  await expect(objectRows(page)).toHaveCount(0)
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(1)
  await expect(x1).toHaveValue('-200')

  // Copied, it is pasted beside the original, and the next paste beside that one: two steps of the 100 mm grid each time.
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(x1).toHaveValue('0')
  await page.keyboard.press('Control+v')
  await expect(x1).toHaveValue('200')

  // Looked at from elsewhere, it lands in the middle of the view.
  await page.mouse.move(box.x + 600, box.y + 400)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + 1200, box.y + 400, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(4)
  const pasted = Number((await x1.inputValue()).replace(/\s/g, ''))
  // The view moved 600 px, 6 m at this zoom: the wall's place is now off to the right, out of sight.
  expect(pasted).toBeLessThan(-4000)
})

test('pastes a picture copied in another program as it is, rather than what was copied here before', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+c')
  // A copy leaves a picture, which is all a chat or a document sees, and the drawing in a format of its own.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read()
        const own = 'web application/x-opencalque'
        const text = item?.types.includes(own) ? await (await item.getType(own)).text() : ''
        return [...(item?.types ?? [])].sort().join(' | ') + (text.includes('"format":"opencalque"') ? ' | drawing' : '')
      }),
    )
    .toBe('image/png | web application/x-opencalque | drawing')
  // What "Copy image" in a browser leaves on the clipboard: a PNG and some HTML, no plain text.
  await page.evaluate(async () => {
    const picture = document.createElement('canvas')
    Object.assign(picture, { width: 40, height: 30 })
    picture.getContext('2d')!.fillRect(10, 10, 20, 10)
    const png = await new Promise<Blob>((done) => picture.toBlob((blob) => done(blob!), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/html': new Blob(['<img src="plan.png">'], { type: 'text/html' }) })])
  })
  // Pixels per millimetre.
  const zoom = page.locator('.view-bar .zoom-scale')
  const seen = Number(await zoom.getAttribute('data-zoom'))
  await page.keyboard.press('Control+v')
  // On top, selected, whole: not a plan to trace, which goes under everything on a layer of its own, faded, and changes the view and the tool.
  await expect(objectRows(page)).toHaveCount(2)
  await expect(objectRows(page).first()).toContainText('Pasted picture')
  await expect(page.locator('.opacity-slider > span')).toHaveText('100 %')
  await expect(page.locator('[data-panel="layers"]')).toContainText('Layer 1')
  await expect(page.locator('[data-panel="layers"]')).not.toContainText('Reference')
  await expect(page.locator('.toast')).toHaveCount(0)
  await expect(zoom).toHaveAttribute('data-zoom', String(seen))
  // As big as it was on screen, and see-through where it was: kept as PNG.
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const saved = JSON.parse(await page.evaluate(() => (window as any).saves[0]))
  const picture = Object.values<any>(saved.nodes).find((node) => node.type === 'image')
  expect(saved.assets[picture.asset].mime).toBe('image/png')
  expect(picture.opacity).toBeUndefined()
  expect(picture.width / picture.height).toBeCloseTo(4 / 3, 2)
  expect(picture.width * seen).toBeCloseTo(40, 0)
})

test('fills a shape with the colour of its layer, chosen in the colour window, which also has an eyedropper', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const fill = page.locator('[data-panel="properties"] .fill-field .fill-now')
  // A rectangle starts with no fill; a solid one is chosen on its tab of the fill window.
  await expect(fill).toContainText('None')
  await fill.click()
  await page.locator('.fill-tabs button', { hasText: 'Solid colour' }).click()
  await expect(page.locator('.fill-menu .color-eyedropper')).toBeVisible()
  // Back to no fill is the None tab: the page offers no Reset of its own.
  await expect(page.locator('.fill-menu .color-reset')).toHaveCount(0)
  // Not the layer's name: the Layer field above says which it is.
  await expect(page.locator('.fill-menu')).not.toContainText('Layer 1')
  await page.locator('.fill-menu .color-option', { hasText: 'Colour of the layer' }).click()
  // The field says what it follows, the whole of it: colour fields were cut to 72 pixels.
  await expect(fill).toContainText('Layer')
  expect((await fill.boundingBox())!.width).toBeGreaterThan(120)
})

test('opens the window of the next field of the bar above the tools at once, closing the one that was open', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.keyboard.press('r')
  const line = page.locator('.quickbar .color-choice:not(.fill-choice) .color-now')
  const fill = page.locator('.quickbar .fill-now')
  const colourWindow = page.locator('.color-menu:not(.fill-menu)')
  const fillWindow = page.locator('.fill-menu')
  // Each press elsewhere closes the window open; the click it ends with opens the other one, back and forth.
  for (const [field, opened, closed] of [[fill, fillWindow, colourWindow], [line, colourWindow, fillWindow], [fill, fillWindow, colourWindow], [line, colourWindow, fillWindow]] as const) {
    await field.click()
    await expect(opened).toHaveCount(1)
    await expect(closed).toHaveCount(0)
  }
  // A click on the field of the window open closes it.
  await line.click()
  await expect(colourWindow).toHaveCount(0)
})

test('gives the next shapes a line colour and a hatch from the bar above the tools, and edits the hatch in the fill window', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  // No dots of colour, weight or kind of line: a colour for the lines, which is the layer's until another is chosen, and a fill.
  await expect(page.locator('.quickbar .weight-choice')).toHaveCount(0)
  const line = page.locator('.quickbar .color-choice:not(.fill-choice) .color-now')
  await expect(line).toHaveAttribute('title', /Follows the colour of its layer/)
  await page.locator('.quickbar .fill-now').click()
  await page.locator('.fill-tabs button', { hasText: 'Hatch' }).click()
  await page.keyboard.press('Escape')
  // Escape closed the window and left the tool as it was.
  await expect(page.locator('.fill-menu')).toHaveCount(0)
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const fill = page.locator('[data-panel="properties"] .fill-field .fill-now')
  await expect(fill).toContainText('Lines')
  await fill.click()
  // A weight chosen from a list opened in the fill window leaves the fill window open.
  await page.locator('.fill-menu .field', { hasText: 'Weight' }).locator('.weight-now').click()
  await page.locator('.weight-option', { hasText: '0.35 mm' }).click()
  await expect(page.locator('.fill-menu')).toHaveCount(1)
  await page.locator('.fill-menu .field', { hasText: 'Spacing' }).locator('input').fill('250')
  await page.locator('.fill-menu .field', { hasText: 'Spacing' }).locator('input').press('Enter')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const saved = JSON.parse(await page.evaluate(() => (window as any).saves[0]))
  const rect = Object.values<any>(saved.nodes).find((node) => node.type === 'rect')
  expect(rect.style.pattern).toEqual({ kind: 'Lines', strokeWidth: 1.4, spacing: 250 })
  expect(rect.style.fill).toBeUndefined()
})

test('gives a colour an opacity, on a shape and on a shared colour', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const fill = page.locator('[data-panel="properties"] .fill-field .fill-now')
  await fill.click()
  await page.locator('.fill-tabs button', { hasText: 'Solid colour' }).click()
  await page.locator('.color-code input').fill('#e5484d')
  await page.locator('.color-code input').press('Enter')
  // Pressed straight after typing the code: the press counts, the code is not saved again over it.
  const slider = page.locator('.color-menu .color-alpha')
  const track = (await slider.boundingBox())!
  await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
  await expect(fill).toContainText('#e5484d80')
  await expect(page.locator('.color-menu .color-opacity')).toContainText('50 %')

  // A shared colour is set in the same window, opacity included, and not linked to anything else.
  await page.keyboard.press('Escape')
  await page.locator('.dv-tab:has(.rail-tab[title="Colours"])').click()
  await page.locator('button[title="Add a shared colour"]').click()
  await page.locator('[data-panel="colors"] .row .color-now').first().click()
  await expect(page.locator('.color-menu .color-alpha')).toBeVisible()
  await expect(page.locator('.color-menu')).not.toContainText('New shared colour')
})

test('resizes a rectangle by the middles of its sides and its corners', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const drag = async (from: [number, number], to: [number, number], shift = false) => {
    await page.mouse.move(box.x + from[0], box.y + from[1])
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 })
    await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
  }
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('W')).toHaveValue('2000')
  // The middle of the right side: only the width changes, the left side stays.
  await drag([500, 350], [600, 350])
  await expect(field('W')).toHaveValue('3000')
  await expect(field('H')).toHaveValue('1000')
  await expect(field('X')).toHaveValue('-200')
  // The middle of the bottom side: only the height.
  await drag([450, 400], [450, 450])
  await expect(field('W')).toHaveValue('3000')
  await expect(field('H')).toHaveValue('1500')
  // A corner with Shift keeps the proportions.
  await drag([600, 450], [900, 500], true)
  await expect(field('W')).toHaveValue('6000')
  await expect(field('H')).toHaveValue('3000')
})

test('makes a wall thicker from one face, the other face staying where it was', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // At the first zoom (0.1 px/mm) a wall of 200 mm is 20 pixels thick: its middle line at y = 300, its faces at 290 and 310.
  await drawWall(page, [300, 300], [700, 300])
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const thickness = field('Thickness')
  await expect(thickness).toHaveValue('200')
  await expect(field('Y1')).toHaveValue('800')
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + 500, box.y + 291)
  await expect(page.locator('.hint-bar')).toContainText('Drag the face to make the wall thicker or thinner on this side')
  await page.mouse.down()
  await page.mouse.move(box.x + 500, box.y + 270, { steps: 4 })
  await page.mouse.move(box.x + 500, box.y + 250, { steps: 4 })
  await expect(page.locator('.hint-bar')).toContainText('The other face stays where it is')
  await page.mouse.up()
  // The upper face went up 400 mm: 600 thick, its middle 200 mm higher, its lower face still at 900.
  await expect(thickness).toHaveValue('600')
  await expect(field('Y1')).toHaveValue('600')
  await expect(field('Y2')).toHaveValue('600')
  // One step to undo.
  await page.keyboard.press('Control+z')
  await expect(thickness).toHaveValue('200')
  await expect(field('Y1')).toHaveValue('800')

  const drag = async (to: number, key: 'Control' | 'Alt') => {
    await page.mouse.move(box.x + 500, box.y + 291)
    await page.mouse.down()
    await page.keyboard.down(key)
    await page.mouse.move(box.x + 500, box.y + to, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up(key)
  }
  // Ctrl grows it both ways: 300 mm either side of a middle line that stays put.
  await drag(270, 'Control')
  await expect(thickness).toHaveValue('600')
  await expect(field('Y1')).toHaveValue('800')
  await page.keyboard.press('Control+z')
  // Alt, as everywhere, ignores the steps: 470 mm, where the steps of this zoom (50 mm) would give 450 or 500.
  await drag(263, 'Alt')
  await expect(thickness).toHaveValue('470')
  await expect(field('Y1')).toHaveValue('665')
})

test('with Shift, an end of a slanting wall dragged near level comes level with its other end', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const plan = drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 3000, y: 400 }, thickness: 200 } })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await objectRows(page).first().click()
  const at = await drawingOnScreen(page)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const [x, y] = at(3000, 400)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  const [tx, ty] = at(3000, 50)
  await page.mouse.move(tx, ty, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  // The end of a wall is a corner of the plan: it is the corner that was dragged, and is selected.
  await expect(field('Y')).toHaveValue('0')
  await objectRows(page).first().click()
  await expect(field('Y2')).toHaveValue('0')
  await expect(field('X2')).toHaveValue(/^3\s?000$/)
})

test('draws a wall by its face and keeps it: thicker, it grows away; given another line, it stays where it is', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('w')
  await page.getByTitle('Points along the right face of the wall').click()
  // Running east at y = 300 (800 mm), its right face is the line clicked: the wall lies north of it, from 280 to 300.
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 700, box.y + 300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.mouse.click(box.x + 500, box.y + 289)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const thickness = field('Thickness')
  const line = page.locator('.field', { has: page.locator('span:text-is("Reference line")') })
  await expect(field('Y1')).toHaveValue('800')
  await expect(line.locator('[aria-checked="true"]')).toHaveAttribute('title', /^By its right face/)
  // Thicker, it grows away from its line, which stays where it was clicked.
  await thickness.fill('400')
  await thickness.press('Enter')
  await expect(field('Y1')).toHaveValue('800')
  await expect(field('Y2')).toHaveValue('800')
  // By its middle now: the wall stays where it is, from 400 to 800, its line going to its middle.
  await line.getByTitle(/^By its middle/).click()
  await expect(line.locator('[aria-checked="true"]')).toHaveAttribute('title', /^By its middle/)
  await expect(field('Y1')).toHaveValue('600')
  await expect(thickness).toHaveValue('400')
})

test('with Shift, a wall being drawn keeps level and still stops on what it meets: a wall it crosses, a point it comes level with', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // An upright wall whose middle line is at x = 1830 mm, off the grid; and a short line ending at (3270, 2300).
  const plan = drawing({
    upright: { id: 'upright', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 1830, y: 0 }, b: { x: 1830, y: 2000 }, thickness: 200 },
    mark: { id: 'mark', type: 'line', parent: 'page_1', order: 'a2', a: { x: 3270, y: 2100 }, b: { x: 3270, y: 2300 } },
    // So that the view the drawing opens on takes in where the walls start.
    edge: { id: 'edge', type: 'line', parent: 'page_1', order: 'a3', a: { x: 0, y: 0 }, b: { x: 0, y: 2600 } },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const onScreen = await drawingOnScreen(page)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const drawHeld = async (from: [number, number], to: [number, number]) => {
    await page.keyboard.press('w')
    await page.mouse.click(...onScreen(...from))
    await page.keyboard.down('Shift')
    await page.mouse.move(...onScreen(...to), { steps: 4 })
    await page.mouse.click(...onScreen(...to))
    await page.keyboard.up('Shift')
    await page.keyboard.press('Escape')
    await page.keyboard.press('v')
    await objectRows(page).first().click()
  }
  // From the left, level, the pointer a little past the upright wall's middle line and a little low: it stops on that line.
  await drawHeld([1100, 1000], [1850, 1040])
  await expect(field('X2')).toHaveValue('1830')
  await expect(field('Y2')).toHaveValue('1000')
  // Level again, the pointer on the end of the line a little lower down: the wall ends level with it, at x = 3270.
  await drawHeld([1100, 1800], [3270, 2300])
  await expect(field('X2')).toHaveValue('3270')
  await expect(field('Y2')).toHaveValue('1800')
})

test('makes a wall longer by the line across its free end, in its own direction; its end point still moves it anywhere', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // At 0.1 px/mm, the origin at (320, 220): a wall 200 thick from (-200, 800) to (1800, 800) mm, 20 px thick on screen.
  await drawWall(page, [300, 300], [500, 300])
  await page.mouse.click(box.x + 400, box.y + 300)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X2')).toHaveValue('1800')
  // On its end line, 8 px off the point at its end: the pointer says sideways, and the hints what a drag does.
  await page.mouse.move(box.x + 500, box.y + 308)
  await expect(canvas(page)).toHaveCSS('cursor', 'ew-resize')
  await expect(page.locator('.hint-bar')).toContainText('Drag the end to make the wall longer or shorter')
  // Dragged out and down: it only gets longer, level as it was.
  await page.mouse.down()
  await page.mouse.move(box.x + 560, box.y + 340, { steps: 5 })
  await page.mouse.up()
  await expect(field('X2')).toHaveValue('2400')
  await expect(field('Y2')).toHaveValue('800')
  await expect(field('X1')).toHaveValue('-200')
  // The point at its end, dragged down, turns it (a press there picks that corner, so the wall is picked again to read it).
  await page.mouse.move(box.x + 560, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 560, box.y + 340, { steps: 5 })
  await page.mouse.up()
  await page.mouse.click(box.x + 430, box.y + 320)
  await expect(field('X2')).toHaveValue('2400')
  await expect(field('Y2')).toHaveValue('1200')
})

test('shows the angle of a wall to a thousandth of a degree, says when it is nearly level and straightens it, and turns it by whole degrees with Alt', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // Four metres long and 8 mm off level, as a traced plan has them; another wall meets its end.
  const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  await choose(page, () => page.keyboard.press('Control+o'), 'askew.opencalque', drawing({ w1: wall('1', [0, 0], [4000, 8]), w2: wall('2', [4000, 8], [4000, 3000]) }))
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).last().click()
  const angle = page.locator('.field', { has: page.locator('span:text-is("Angle")') }).locator('input')
  await expect(angle).toHaveValue('359.885')
  const note = page.locator('[data-panel="properties"] .hint', { hasText: 'Not quite level' })
  await expect(note).toContainText('Not quite level: 0.115° off')
  await note.getByRole('button', { name: 'Straighten' }).click()
  await expect(angle).toHaveValue('0')
  await expect(note).toHaveCount(0)
  const saved = async () => {
    await page.keyboard.press('Control+s')
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  }
  let doc = await saved()
  // Level, as long as it was, turned about the end the other wall meets, which stays where it was: its free start moved.
  expect(doc.nodes.w1.b).toEqual({ x: 4000, y: 8 })
  expect(doc.nodes.w1.a.y).toBe(8)
  expect(doc.nodes.w1.a.x).toBeCloseTo(-0.008, 3)
  expect(doc.nodes.w2.a).toEqual({ x: 4000, y: 8 })
  // Dragged with Alt, ten pixels to the right: ten degrees, one step to undo.
  const box = (await angle.boundingBox())!
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await expect(angle).toHaveValue('10')
  await page.keyboard.press('Control+z')
  await expect(angle).toHaveValue('0')
  doc = await saved()
  expect(doc.nodes.w1.b).toEqual({ x: 4000, y: 8 })
})

test('sets the length of a wall typed in its properties, its free end moving and the walls joined there following', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // A wall whose start another wall meets, so that its free end is the one that moves; and a curved one.
  const wall = (id: string, a: [number, number], b: [number, number], extra = {}) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, ...extra })
  await choose(page, () => page.keyboard.press('Control+o'), 'lengths.opencalque', drawing({ w1: wall('1', [3000, 0], [0, 0]), w2: wall('2', [0, 0], [0, 2000]), w3: wall('3', [0, 5000], [4000, 5000], { bulge: 500 }) }))
  await expect(objectRows(page)).toHaveCount(3)
  const length = page.locator('.field', { has: page.locator('span:text-is("Length")') }).locator('input')
  const saved = async () => {
    await page.keyboard.press('Control+s')
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  }
  await objectRows(page).nth(2).click()
  await expect(length).toHaveValue('3000')
  await length.fill('4500')
  await length.press('Enter')
  await expect(length).toHaveValue('4500')
  let doc = await saved()
  // Its end at (0, 0), where the other wall meets it, stays; its free start goes on in the same direction.
  expect(doc.nodes.w1.a).toEqual({ x: 4500, y: 0 })
  expect(doc.nodes.w1.b).toEqual({ x: 0, y: 0 })
  expect(doc.nodes.w2.a).toEqual({ x: 0, y: 0 })
  // The curved wall keeps its shape: twice as long round the curve, it bows out twice as far.
  await objectRows(page).nth(0).click()
  await expect(length).not.toHaveValue('4500')
  const round = Number(await length.inputValue())
  await length.fill(String(round * 2))
  await length.press('Enter')
  doc = await saved()
  // The length shown is rounded to the millimetre, so twice it is twice the length to a millimetre or two.
  expect(doc.nodes.w3.a).toEqual({ x: 0, y: 5000 })
  expect(doc.nodes.w3.b.y).toBe(5000)
  expect(Math.abs(doc.nodes.w3.b.x - 8000)).toBeLessThan(2)
  expect(doc.nodes.w3.b.x / doc.nodes.w3.bulge).toBeCloseTo(8, 6)
})

test('shows how wide and high the objects selected stand together, and stretches them by a size typed', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // Two walls 200 thick meeting at a corner: their outer faces stand 4100 by 3100 apart, their axes 4000 by 3000.
  const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  await choose(page, () => page.keyboard.press('Control+o'), 'corner.opencalque', drawing({ w1: wall('1', [0, 0], [4000, 0]), w2: wall('2', [4000, 0], [4000, 3000]) }))
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).first().click()
  await objectRows(page).last().click({ modifiers: ['Shift'] })
  // The first: the walls' own Height field comes further down.
  const size = (name: string) => page.locator('[data-panel="properties"] .field', { has: page.locator(`span:text-is("${name}")`) }).locator('input').first()
  await expect(page.locator('[data-panel="properties"]')).toContainText('Selection (2)')
  await expect(size('Width')).toHaveValue('4100')
  await expect(size('Height')).toHaveValue('3100')
  await expect(size('Width, axis to axis')).toHaveValue('4000')
  await expect(size('Height, axis to axis')).toHaveValue('3000')
  // Typed between the axes, the wall on the right moves out whole, the other getting longer to stay joined.
  await size('Width, axis to axis').fill('5000')
  await size('Width, axis to axis').press('Enter')
  await expect(size('Width')).toHaveValue('5100')
  await page.keyboard.press('Control+s')
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  expect(doc.nodes.w1).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200 })
  expect(doc.nodes.w2).toMatchObject({ a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 }, thickness: 200 })
  // With the proportions kept, the other side goes as far in proportion, and one undo takes both back.
  await page.getByRole('button', { name: 'Keep the proportions: width and height change together' }).first().click()
  await size('Width').fill('10200')
  await size('Width').press('Enter')
  await expect(size('Width')).toHaveValue('10200')
  await expect(size('Height')).toHaveValue('6200')
  await page.keyboard.press('Control+z')
  await expect(size('Width')).toHaveValue('5100')
  await expect(size('Height')).toHaveValue('3100')
})

test('moves the step between two walls in line by the line across the end of either, the other following', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // A wall 400 thick, then one 100 thick carrying on from it, the line of the step drawn.
  const wall = (id: string, from: number, to: number, thickness: number, extra = {}) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: from, y: 0 }, b: { x: to, y: 0 }, thickness, ...extra })
  await choose(page, () => page.keyboard.press('Control+o'), 'step.opencalque', drawing({ w1: wall('1', 0, 3000, 400, { edges: { b: { show: true } } }), w2: wall('2', 3000, 6000, 100) }))
  await expect(objectRows(page)).toHaveCount(2)
  const at = await drawingOnScreen(page)
  await objectRows(page).last().click()
  // On the step, beside the thinner wall: the pointer says along the wall.
  await page.mouse.move(...at(3000, 150))
  await expect(canvas(page)).toHaveCSS('cursor', 'ew-resize')
  await page.mouse.down()
  await page.mouse.move(...at(4000, 170), { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Control+s')
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  // The thick wall longer, level as it was; the thin one shorter, still starting where the thick one ends.
  expect(doc.nodes.w1.b.x).toBeGreaterThan(3800)
  expect(doc.nodes.w1.b.y).toBe(0)
  expect(doc.nodes.w2.a).toEqual(doc.nodes.w1.b)
  expect(doc.nodes.w2.b).toEqual({ x: 6000, y: 0 })
})

test('stretches a window placed on a wall by either of its ends, the other staying put', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // At the first zoom (0.1 px/mm, the origin at 320, 220), a wall along y = 800 mm from x = -200 to 3800 mm.
  await drawWall(page, [300, 300], [700, 300])
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Window$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // Centred on the wall under the pointer, at x = 1800 mm: 1200 mm wide, it runs from 1200 to 2400 (440 to 560 on screen).
  await page.mouse.click(box.x + 500, box.y + 300)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Window' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Width')).toHaveValue('1200')
  await expect(field('X')).toHaveValue('1200')
  const drag = async (from: number, to: number) => {
    await page.mouse.move(box.x + from, box.y + 300)
    await page.mouse.down()
    await page.mouse.move(box.x + to, box.y + 305, { steps: 4 })
    await page.mouse.up()
  }
  // Its end, along the wall: wider, the start where it was.
  await drag(560, 600)
  await expect(field('Width')).toHaveValue('1600')
  await expect(field('X')).toHaveValue('1200')
  // Its start: the end stays where it was.
  await drag(440, 420)
  await expect(field('Width')).toHaveValue('1800')
  await expect(field('X')).toHaveValue('1000')
})

test('makes a stair longer by its top in whole steps, and wider by its side', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Stair, straight$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // At the first zoom (0.1 px/mm, the origin at 320, 220): its foot at (1800, 3800) mm, 900 wide and 12 steps of 270 up,
  // so on screen from x 500 to 590 and from y 276 to 600.
  await page.mouse.click(box.x + 500, box.y + 600)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Stair, straight' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Steps')).toHaveValue('12')
  const drag = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(box.x + from[0], box.y + from[1])
    await page.mouse.down()
    await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 })
    await page.mouse.up()
  }
  // Its top, up by a little over two treads: two more steps, its foot where it was.
  await drag([545, 276], [545, 220])
  await expect(field('Steps')).toHaveValue('14')
  await expect(field('Y')).toHaveValue('3800')
  // Its right side (whose middle is now at y = 411), 300 mm out.
  await drag([590, 411], [620, 411])
  await expect(field('Width')).toHaveValue('1200')
  await expect(field('X')).toHaveValue('1800')
})

test('brings a washbasin against a wall of a plan whose walls are grouped', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A room of 5000 × 4000 mm whose walls, 200 thick, are grouped, the inside of its left wall at
  // x = 100; and a washbasin outside the group, turned with its back to that wall, at x = 1530.
  const wall = (id: string, order: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'plan', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const plan = drawing({
    plan: { id: 'plan', type: 'group', parent: 'page_1', order: 'a1' },
    left: wall('left', 'a0', [0, 0], [0, 4000]),
    bottom: wall('bottom', 'a1', [0, 4000], [5000, 4000]),
    right: wall('right', 'a2', [5000, 4000], [5000, 0]),
    top: wall('top', 'a3', [5000, 0], [0, 0]),
    basin: { id: 'basin', type: 'parametric', parent: 'page_1', order: 'a2', kind: 'arch.washbasin', props: {}, x: 1530, y: 2500, rotation: 270 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(2)
  const onScreen = await drawingOnScreen(page)
  // The washbasin fills x 1530 to 1980, y 1900 to 2500. Taken by a point on it away from its grips
  // and dragged 1410 mm to the left, its back comes 20 mm short of the wall's face: it goes against it.
  await page.mouse.move(...onScreen(1930, 2050))
  await page.mouse.down()
  await page.mouse.move(...onScreen(520, 2050), { steps: 6 })
  await page.mouse.up()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('100')
})

test('inside a group, lines up what is moved with what is around the group, which cannot be picked', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A post on the page, its left side at x = 3033, off the grid; a group holding two boxes.
  const rect = (id: string, parent: string, order: string, x: number, y: number) => ({ id, type: 'rect', parent, order, x, y, width: 500, height: 500, layer: 'layer_1' })
  const plan = drawing({
    post: rect('post', 'page_1', 'a1', 3033, 0),
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a2' },
    box: rect('box', 'set', 'a0', 0, 1000),
    other: rect('other', 'set', 'a1', 0, 2000),
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'around.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(2)
  const onScreen = await drawingOnScreen(page)
  await page.mouse.dblclick(...onScreen(250, 1000))
  await expect(page.locator('.breadcrumb')).toContainText('Set')
  // The post is there, faded, but a click on its side picks nothing up.
  await page.mouse.click(...onScreen(3283, 0))
  await expect(page.locator('.breadcrumb')).toContainText('Set')
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toBeHidden()
  // Dragged to just short of below it, the box lines up with its side, where the grid would not put it.
  await page.mouse.move(...onScreen(250, 1000))
  await page.mouse.down()
  await page.mouse.move(...onScreen(250 + 3020, 1000), { steps: 6 })
  await page.mouse.up()
  await expect(field('X')).toHaveValue('3033')
})

test('outlines what the pointer is on through groups in groups, and goes to it in one double-click', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A group holding a box and a group, which holds another box: the outer group spans (0, 0) to (1500, 1500).
  const rect = (id: string, parent: string, order: string, x: number, y: number) => ({ id, type: 'rect', parent, order, x, y, width: 500, height: 500, layer: 'layer_1' })
  const plan = drawing({
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a1' },
    corner: rect('corner', 'set', 'a0', 1000, 0),
    inner: { id: 'inner', type: 'group', name: 'Inner', parent: 'set', order: 'a1' },
    box: rect('box', 'inner', 'a0', 0, 1000),
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'nested.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(1)
  const onScreen = await drawingOnScreen(page)
  // Whether the selection's blue is drawn within a few pixels of a point of the drawing.
  const blueNear = (x: number, y: number) =>
    page.evaluate(([x, y]) => {
      const stage = document.querySelector<HTMLCanvasElement>('.stage canvas')!
      const rect = stage.getBoundingClientRect()
      const scale = stage.width / rect.width
      const data = stage.getContext('2d')!.getImageData((x - rect.left) * scale - 3, (y - rect.top) * scale - 3, 7, 7).data
      // Solid or faint: never the black of the lines nor the grey of the grid.
      for (let i = 0; i < data.length; i += 4) if (data[i] < 150 && data[i + 1] > 120 && data[i + 1] < 215 && data[i + 2] > 215) return true
      return false
    }, onScreen(x, y))
  // On the page, the inner box pointed at is outlined, its bottom too, and the box of the outer
  // group a click would pick up is dashed, where nothing is drawn. The other box stays black.
  expect(await blueNear(0, 500)).toBe(false)
  expect(await blueNear(250, 1500)).toBe(false)
  await page.mouse.move(...onScreen(250, 1000))
  await expect.poll(() => blueNear(250, 1500)).toBe(true)
  await expect.poll(() => blueNear(0, 500)).toBe(true)
  expect(await blueNear(1250, 500)).toBe(false)
  await page.mouse.move(...onScreen(3000, 3000))
  await expect.poll(() => blueNear(0, 500)).toBe(false)
  await expect.poll(() => blueNear(250, 1500)).toBe(false)
  // One double-click goes into the inner group, the box selected; Esc lets go of it, then climbs out to the outer group, the inner one selected.
  const crumbs = page.locator('.breadcrumb .crumb:not(.ahead)')
  const selected = page.locator('[data-panel="objects"] .row.selected')
  await page.mouse.dblclick(...onScreen(250, 1000))
  await expect(crumbs).toHaveText(['Page 1', 'Set', 'Inner'])
  await expect(selected).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(crumbs).toHaveText(['Page 1', 'Set'])
  await expect(selected).toHaveText(/Inner/)
})

test('says in the Structure list when an object is locked by its layer, which picking it on the drawing does not', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const rect = (id: string, name: string, layer: string, x: number) => ({ id, name, type: 'rect', parent: 'page_1', order: `a${x / 1000}`, x, y: 0, width: 800, height: 800, layer })
  const plan = drawing(
    { mine: rect('mine', 'Mine', 'layer_1', 1000), held: rect('held', 'Held', 'floor', 3000) },
    { layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order: 'a0' }, floor: { id: 'floor', name: 'Floor', order: 'a1', locked: true } } },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'locked.opencalque', plan)
  const row = (name: string) => objectRows(page).filter({ hasText: name })
  await expect(row('Held').getByTitle('Locked with its layer “Floor”: unlock it in the Layers panel')).toBeVisible()
  await expect(row('Mine').getByTitle('Lock so it cannot be selected or moved on the drawing')).toBeVisible()
  // Its own lock is still its own: once given, it is what the row says.
  await row('Held').getByTitle('Locked with its layer “Floor”: unlock it in the Layers panel').click()
  await expect(row('Held').getByTitle('Unlock', { exact: true })).toBeVisible()
})

test('lists the furniture by room in the object library, the adjustable pieces with the rest', async ({ page }) => {
  // The adjustable furniture installed as 1.0.0-rc.3 shipped it, all of it listed as furniture: the copy that ships now replaces it.
  const furniture = JSON.parse(readFileSync('packages/warehouse/extensions/furniture.json', 'utf8'))
  const old = { ...furniture, version: '1.1.0', objects: furniture.objects.map((object: Record<string, unknown>) => ({ ...object, category: 'furniture' })) }
  await startWith(page, { extensions: { installed: { [old.id]: old }, disabled: [] } })
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  const sections = await page.locator('.warehouse-sections .warehouse-section-name').allTextContents()
  expect(sections.filter((name) => ['Living room', 'Dining room', 'Bedroom', 'Office', 'Furniture'].includes(name))).toEqual(['Living room', 'Dining room', 'Bedroom', 'Office'])
  // The library's double bed and dining table are gone: the adjustable bed and table draw them. The banquette is one of the adjustable pieces.
  await librarySection(page, 'Dining room').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Chair', 'High chair', 'Banquette', 'Table with chairs'])
  // The library's single bed and wardrobe too: the adjustable bed and wardrobe draw them, and the
  // bedroom's furniture is all adjustable now, drawn by its fronts in elevations.
  await librarySection(page, 'Bedroom').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Bedside table', 'Chest of drawers', 'Wardrobe', 'Single bed', 'Double bed'])
  // The components shown can be taken at once: the whole furniture library, the round coffee table
  // alone now, which is put on the pointer as one card clicked is.
  await librarySection(page, 'Living room').click()
  await page.getByRole('button', { name: 'Add the whole library' }).click()
  await expect(page.getByRole('dialog', { name: 'Object library' })).toBeHidden()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + 400, box.y + 300)
  await page.keyboard.press('Escape')
  await expect(objectRows(page)).toHaveCount(1)
  await expect(objectRows(page).first()).toContainText('Coffee table, round')
})

test('has the furniture and the electrical symbols from the start, which are not extensions', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await librarySection(page, 'Bedroom').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Bedside table', 'Chest of drawers', 'Wardrobe', 'Single bed', 'Double bed'])
  await page.keyboard.press('Escape')
  // Preferences › Extensions lists only what was added: nothing here.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Extensions…')
  await page.keyboard.press('Enter')
  await expect(page.locator('.prefs-extensions')).toContainText('No extension added')
  await expect(page.locator('.prefs-extensions .warehouse-row')).toHaveCount(0)
})

test('drags a component from the library onto the drawing, where it is let go', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await librarySection(page, 'Dining room').click()
  const card = (await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Chair$/ }) }).boundingBox())!
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.mouse.down()
  // The library closes as soon as the card is dragged, and the chair follows the pointer.
  await page.mouse.move(card.x + card.width / 2 + 20, card.y + card.height / 2, { steps: 4 })
  await expect(page.getByRole('dialog', { name: 'Object library' })).toBeHidden()
  // At the first zoom (0.1 px/mm, the origin at 320, 220): let go at (-200, 800) mm, a chair is put there, one, and selected.
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 8 })
  await page.mouse.up()
  await expect(objectRows(page)).toHaveCount(1)
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveText(/Chair/)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('-200')
  await expect(field('Y')).toHaveValue('800')
  // Done: a click on the drawing now selects, it places nothing more.
  await page.mouse.click(box.x + 600, box.y + 500)
  await expect(objectRows(page)).toHaveCount(1)
  // Let go beside the drawing, over a panel, it stays on the pointer as after a click on its card.
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 40, box.y + 300, { steps: 8 })
  await page.mouse.up()
  await expect(objectRows(page)).toHaveCount(1)
  await page.mouse.move(box.x + 500, box.y + 300, { steps: 4 })
  await page.mouse.click(box.x + 500, box.y + 300)
  await expect(objectRows(page)).toHaveCount(2)
})

test('opens the object library on the section looked at last', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const library = page.getByTitle('Object library: stairs, furniture and every other object')
  const section = (name: string) => librarySection(page, name)
  const heading = (name: string) => page.locator('.warehouse-heading-name', { hasText: new RegExp(`^${name}$`) })
  await library.click()
  await expect(section('All')).toHaveClass(/active/)
  await section('Bathroom').click()
  await expect(heading('Bedroom')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(heading('Bathroom')).toHaveCount(0)
  // Opened again, and after a restart, it shows the bathroom only.
  for (const again of [() => library.click(), async () => (await page.reload(), await library.click())]) {
    await again()
    await expect(section('Bathroom')).toHaveClass(/active/)
    await expect(heading('Bathroom')).toBeVisible()
    await expect(heading('Bedroom')).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  // What the drawing holds already is not in it: that is the Components panel's.
  await expect(section('In this drawing')).toHaveCount(0)
})

test('searches every section of the object library, and counts what each section holds', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  const dialog = page.getByRole('dialog', { name: 'Object library' })
  const search = page.getByPlaceholder('Search every object and component…')
  const count = (name: string) => librarySection(page, name).locator('.warehouse-count')
  await librarySection(page, 'Bathroom').click()
  await expect(page.locator('.warehouse-heading-name')).toHaveText(['Bathroom'])
  // A search looks through every section, wherever the library was, and each section says how much it found.
  await search.fill('fridge')
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Fridge', 'American fridge'])
  await expect(librarySection(page, 'All')).toHaveClass(/active/)
  await expect(count('Kitchen')).toHaveText('2')
  await expect(count('Bathroom')).toHaveText('0')
  // Cleared, it is back where it was.
  await search.fill('')
  await expect(librarySection(page, 'Bathroom')).toHaveClass(/active/)
  await expect(page.locator('.warehouse-heading-name')).toHaveText(['Bathroom'])
  // Nothing is confirmed in this window: its corner closes it.
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})

test('takes the components of a drawing on this computer from the foot of the object library', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  const other = drawing({
    stool: { id: 'stool', type: 'component', parent: null, order: 'a0', name: 'Stool' },
    seat: { id: 'seat', type: 'ellipse', parent: 'stool', order: 'a0', cx: 0, cy: 0, rx: 200, ry: 200 },
  })
  await choose(page, () => page.getByRole('button', { name: 'From a file…' }).click(), 'stools.opencalque', other)
  await expect(page.locator('.toast')).toContainText('Imported 1 component from stools.opencalque')
  // They are shown where they now are, in the Components panel; taken again, they are components of their own.
  const rows = page.locator('[data-panel="components"] .row')
  await expect(rows.locator('.editable')).toHaveText(['Stool'])
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await choose(page, () => page.getByRole('button', { name: 'From a file…' }).click(), 'stools.opencalque', other)
  await expect(rows.locator('.editable')).toHaveText(['Stool', 'Stool 2'])
})

test('takes a component of its own from the object library each time, placed as often as clicked', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const table = page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Coffee table, round$/ }) }).first()
  // Taken once and put down twice: one component, placed twice.
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await table.click()
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 300)
  await page.keyboard.press('Escape')
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  const panel = page.locator('[data-panel="components"]')
  await expect(panel.locator('.row .editable')).toHaveText(['Coffee table, round'])
  await expect(panel.locator('.row .uses')).toHaveText(['2'])
  // Taken again: another component, of its own.
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await table.click()
  await page.mouse.click(box.x + 700, box.y + 300)
  await page.keyboard.press('Escape')
  await expect(panel.locator('.row .editable')).toHaveText(['Coffee table, round', 'Coffee table, round 2'])
  await expect(panel.locator('.row .uses')).toHaveText(['2', '1'])
  // The panel finds them by name.
  const search = panel.getByPlaceholder('Search the components…')
  await search.fill('round 2')
  await expect(panel.locator('.row .editable')).toHaveText(['Coffee table, round 2'])
  await search.fill('sofa')
  await expect(panel.locator('.row')).toHaveCount(0)
  await expect(panel.getByText('Nothing matches.')).toBeVisible()
  await search.press('Escape')
  await expect(panel.locator('.row')).toHaveCount(2)
})

test('puts the wall-hung toilet from the library against the wall it is placed near, turned to stand out of it', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A wall from (0, 0) down to (0, 4000), 200 thick: the face on its right as seen on the sheet at x = 100.
  const plan = drawing({ wall: { id: 'wall', type: 'wall', parent: 'page_1', order: 'a0', a: { x: 0, y: 0 }, b: { x: 0, y: 4000 }, thickness: 200 } })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(1)
  const onScreen = await drawingOnScreen(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Toilet, wall-hung$/ }) }).click()
  // Placed by its middle, a little off the wall: within reach of it (40 pixels), it goes against it.
  await page.mouse.click(...onScreen(250, 2000))
  await page.keyboard.press('Escape')
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).filter({ hasText: 'Toilet, wall-hung' }).click()
  // Its back on the face, its bowl out into the room: turned a quarter from how it is drawn.
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('100')
  await expect(field('Rotation')).toHaveValue('270')
  // Its width and depth are its W and D: no section under its name is left with nothing in it.
  await expect(page.locator('[data-panel="properties"] .section h3', { hasText: 'Geometry' })).toHaveCount(1)
  await expect(page.locator('[data-panel="properties"] .section h3', { hasText: 'Toilet, wall-hung' })).toHaveCount(0)
})

test('makes a group see-through from its properties, one drag of the slider being one step to undo', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  for (const [x, y] of [[300, 300], [450, 300]]) {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + x, box.y + y)
    await page.mouse.click(box.x + x + 100, box.y + y + 80)
  }
  await page.keyboard.press('v')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+g')
  await expect(objectRows(page).first()).toContainText('Group')
  const slider = page.locator('.opacity-slider input')
  const reading = page.locator('.opacity-slider > span')
  await expect(reading).toHaveText('100 %')
  await slider.fill('50')
  await expect(reading).toHaveText('50 %')
  // Dragged from its middle to near its start: many positions written, one step to undo.
  const track = (await slider.boundingBox())!
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
  await page.mouse.down()
  for (const share of [0.4, 0.3, 0.2]) await page.mouse.move(track.x + track.width * share, track.y + track.height / 2)
  await page.mouse.up()
  await expect(reading).not.toHaveText('50 %')
  await page.keyboard.press('Control+z')
  await expect(reading).toHaveText('50 %')
  await page.keyboard.press('Control+z')
  await expect(reading).toHaveText('100 %')
})

test('shows a shape left unfilled in a component white, as it is placed, and see-through everywhere once given no fill', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A black band on the page, and a component of one unfilled rectangle placed across it.
  const plan = drawing({
    band: { id: 'band', type: 'rect', parent: 'page_1', order: 'a0', x: 0, y: 0, width: 3000, height: 1000, style: { fill: '#000000' } },
    glass: { id: 'glass', type: 'component', name: 'Glass', parent: null, order: 'a1' },
    pane: { id: 'pane', type: 'rect', parent: 'glass', order: 'a0', x: 0, y: 0, width: 1000, height: 2000 },
    placed: { id: 'placed', type: 'instance', parent: 'page_1', order: 'a1', component: 'glass', x: 1000, y: -500 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'glass.opencalque', plan)
  const at = await drawingOnScreen(page)
  const pixel = (x: number, y: number) =>
    page.evaluate(([x, y]) => {
      const stage = document.querySelector<HTMLCanvasElement>('.stage canvas')!
      const rect = stage.getBoundingClientRect()
      const scale = stage.width / rect.width
      return [...stage.getContext('2d')!.getImageData((x - rect.left) * scale, (y - rect.top) * scale, 1, 1).data.slice(0, 3)]
    }, at(x, y))
  expect(await pixel(1500, 500)).toEqual([255, 255, 255])
  // Inside the component its fill says what it is where it is placed; None makes it see-through.
  await page.mouse.dblclick(...at(1500, -300))
  await objectRows(page).first().click()
  const fill = page.locator('.fill-now')
  await expect(fill).toHaveText('default')
  await fill.click()
  await page.locator('.fill-tabs button', { hasText: 'None' }).click()
  await page.keyboard.press('Escape')
  await expect(fill).toHaveText('None')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(objectRows(page)).toHaveCount(2)
  await expect.poll(() => pixel(1500, 500)).toEqual([0, 0, 0])
})

test('resizes a table by its side, the furniture installed before it could be', async ({ page }) => {
  // Installed as it was before it said how it is resized: the copy that ships now replaces it.
  const furniture = JSON.parse(readFileSync('packages/warehouse/extensions/furniture.json', 'utf8'))
  const old = { ...furniture, version: '1.0.0', objects: furniture.objects.map(({ box: _, ...object }: Record<string, unknown>) => object) }
  await startWith(page, { extensions: { installed: { [old.id]: old }, disabled: [] } })
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Table with chairs$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // At the first zoom (0.1 px/mm, the origin at 320, 220): its corner at (1800, 2800) mm, 1800 long and 900 wide,
  // so on screen from x 500 to 680 and from y 500 to 590.
  await page.mouse.click(box.x + 500, box.y + 500)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Table with chairs' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Length')).toHaveValue('1800')
  await page.mouse.move(box.x + 680, box.y + 545)
  await page.mouse.down()
  await page.mouse.move(box.x + 700, box.y + 548, { steps: 4 })
  await page.mouse.up()
  await expect(field('Length')).toHaveValue('2000')
  await expect(field('Width')).toHaveValue('900')
  await expect(field('X')).toHaveValue('1800')
})

test('stretches a placed component by a side of its frame, and gives it its proportions back', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // A 2000 × 1000 rectangle from (-200, 800) mm, on screen from (300, 300) to (500, 400), made into a component placed there.
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  await expect(objectRows(page).first()).toContainText('Component 1')
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('-200')
  const back = page.getByRole('button', { name: 'Back to its own proportions' })
  await expect(back).toHaveCount(0)
  // Its right side, 1000 mm further: half as wide again, its left side where it was.
  await page.mouse.move(box.x + 500, box.y + 350)
  await page.mouse.down()
  await page.mouse.move(box.x + 600, box.y + 352, { steps: 4 })
  await page.mouse.up()
  await expect(back).toBeVisible()
  await expect(field('X')).toHaveValue('-200')
  await back.click()
  await expect(back).toHaveCount(0)
})

test('vectorizes a stair into a group of its shapes from the right-click menu', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Stair, straight$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + 500, box.y + 600)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Stair, straight' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) })
  await expect(field('Steps')).toHaveCount(1)
  await page.mouse.click(box.x + 545, box.y + 450, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Vectorize' }).click()
  // A group where the stair was, named after it: its shapes to edit, no steps to set.
  await expect(field('Steps')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ungroup' })).toBeVisible()
  await expect(objectRows(page).filter({ hasText: 'Stair, straight' })).toHaveCount(1)
})

test('vectorizes a table of quantities into a group of its lines and words from the right-click menu', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const nodes = {
    w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
    t: { id: 't', type: 'table', parent: 'page_1', layer: 'layer_1', order: 'a2', x: 0, y: 1000, schedule: 'walls', title: 'Walls' },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'table.opencalque', drawing(nodes, { version: 2 }))
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).filter({ hasText: 'Table of quantities' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Vectorize' }).click()
  // A group named after its title where the table was, which counts nothing any more.
  await expect(page.locator('.toast')).toContainText('It no longer follows the drawing.')
  await expect(objectRows(page).filter({ hasText: 'Table of quantities' })).toHaveCount(0)
  await expect(objectRows(page).filter({ hasText: 'Walls' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Ungroup' })).toBeVisible()
})

test('goes through the instances of a component one by one, on every page and in groups, from the Components panel', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const placed = (id: string, parent: string, order: string, x: number, y: number) => ({ id, type: 'instance', parent, layer: 'layer_1', order, component: 'chair', x, y })
  const nodes = {
    chair: { id: 'chair', type: 'component', parent: null, order: 'a5', name: 'Chair' },
    seat: { id: 'seat', type: 'rect', parent: 'chair', order: 'a0', x: 0, y: 0, width: 450, height: 450 },
    c1: placed('c1', 'page_1', 'a1', 0, 0),
    c2: placed('c2', 'page_1', 'a2', 3000, 0),
    g: { id: 'g', type: 'group', parent: 'page_1', layer: 'layer_1', order: 'a3', name: 'Dining' },
    c3: placed('c3', 'g', 'a0', 0, 3000),
    page_2: { id: 'page_2', type: 'page', parent: null, order: 'a1', name: 'Upstairs' },
    c4: placed('c4', 'page_2', 'a0', 0, 0),
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'chairs.opencalque', drawing(nodes, { version: 2 }))
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  await page.locator('[data-panel="components"] .row').first().hover()
  await page.getByRole('button', { name: 'Go through its instances one by one' }).click()
  const bar = page.locator('.instance-bar')
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  // The first, on the page, selected; then the one beside it, by the arrow or by Alt+→.
  await expect(bar).toContainText('Chair')
  await expect(bar.locator('.instance-count')).toHaveText('1 / 4')
  await expect(field('X')).toHaveValue('0')
  await bar.getByRole('button', { name: /^Next instance/ }).click()
  await expect(bar.locator('.instance-count')).toHaveText('2 / 4')
  await expect(field('X')).toHaveValue('3000')
  // Both on the page can be selected at once from the bar.
  await bar.getByRole('button', { name: 'Select the 2 here' }).click()
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveCount(2)
  // In its group, which is gone into; then on the other page.
  await page.keyboard.press('Alt+ArrowRight')
  await expect(bar.locator('.instance-count')).toHaveText('3 / 4')
  await expect(page.locator('.breadcrumb')).toContainText('Dining')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(bar.locator('.instance-count')).toHaveText('4 / 4')
  // Upstairs, it is all there is.
  await expect(objectRows(page)).toHaveCount(1)
  await expect(page.locator('.breadcrumb')).toHaveCount(0)
  // Round to the first again, and Escape lets go of the bar, the instance staying selected.
  await page.keyboard.press('Alt+ArrowRight')
  await expect(bar.locator('.instance-count')).toHaveText('1 / 4')
  await canvas(page).hover()
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
  await expect(field('X')).toHaveValue('0')
})

test('makes the instances of one component instances of another from the Components panel, not from their properties', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const shape = (id: string, parent: string) => ({ id, type: 'ellipse', parent, order: 'a0', cx: 0, cy: 0, rx: 100, ry: 100 })
  const placed = (id: string, component: string, order: string, x: number) => ({ id, type: 'instance', parent: 'page_1', layer: 'layer_1', order, component, x, y: 0 })
  const nodes = {
    socket: { id: 'socket', type: 'component', parent: null, order: 'a5', name: 'Socket' },
    s: shape('s', 'socket'),
    twin: { id: 'twin', type: 'component', parent: null, order: 'a6', name: 'Socket 2' },
    t: shape('t', 'twin'),
    lamp: { id: 'lamp', type: 'component', parent: null, order: 'a7', name: 'Lamp' },
    l: shape('l', 'lamp'),
    i1: placed('i1', 'socket', 'a1', 0),
    i2: placed('i2', 'twin', 'a2', 1000),
    i3: placed('i3', 'twin', 'a3', 2000),
    i4: placed('i4', 'lamp', 'a4', 3000),
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'sockets.opencalque', drawing(nodes, { version: 2 }))
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  const row = (name: string) => page.locator('[data-panel="components"] .row', { has: page.locator(`.component-name :text-is("${name}")`) })
  await row('Socket 2').hover()
  await row('Socket 2').getByRole('button', { name: 'Replace its instances with another component' }).click()
  // The other components, found by name; Enter takes the first found.
  await page.getByPlaceholder('Find a component…').fill('sock')
  await expect(page.locator('.material-menu .color-option')).toHaveText(['Socket'])
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('2 instances of “Socket 2” now place “Socket”.')
  await expect(row('Socket').locator('.uses')).toHaveText('3')
  await expect(row('Socket 2').locator('.uses')).toHaveText('0')
  // Not from the properties of one selected: they say what it is, and replacing is done from here.
  await objectRows(page).nth(0).click()
  await expect(page.locator('[data-panel="properties"] .component-choice')).toHaveCount(0)
})

test('lists the objects placed with the same settings as one entry beside the components, which changes them together', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const radiator = (id: string, order: string, x: number, props: Record<string, unknown>) => ({ id, type: 'parametric', parent: 'page_1', layer: 'layer_1', order, kind: 'arch.radiator', props, x, y: 0 })
  const nodes = {
    r1: radiator('r1', 'a1', 0, {}),
    r2: radiator('r2', 'a2', 2000, { width: 800 }),
    r3: radiator('r3', 'a3', 4000, { width: 1200 }),
    chair: { id: 'chair', type: 'component', parent: null, order: 'a5', name: 'Chair' },
    seat: { id: 'seat', type: 'rect', parent: 'chair', order: 'a0', x: 0, y: 0, width: 450, height: 450 },
    c1: { id: 'c1', type: 'instance', parent: 'page_1', layer: 'layer_1', order: 'a4', component: 'chair', x: 0, y: 2000 },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'heating.opencalque', drawing(nodes, { version: 2 }))
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  const rows = page.locator('[data-panel="components"] .row')
  // By name, the two lengths of radiator apart, each with how many there are.
  await expect(rows.locator('.component-name > span:first-child')).toHaveText(['Chair', 'Radiator 800', 'Radiator 1200'])
  await expect(rows.locator('.uses')).toHaveText(['1', '2', '1'])
  // Its pencil selects the two of 80 cm, to be changed together: made 1.20 m long, all three are one entry.
  const short = rows.filter({ hasText: 'Radiator 800' })
  await short.hover()
  await short.getByRole('button', { name: 'Select them all, to change them together' }).click()
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveCount(2)
  const length = page.locator('.field', { has: page.locator('span:text-is("Length")') }).locator('input').first()
  await length.fill('1200')
  await length.press('Enter')
  await expect(rows.locator('.component-name > span:first-child')).toHaveText(['Chair', 'Radiator'])
  await expect(rows.filter({ hasText: 'Radiator' }).locator('.uses')).toHaveText('3')
  // A click puts one more of it on the pointer, as it is.
  await rows.filter({ hasText: 'Radiator' }).click()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + 600, box.y + 500, { steps: 3 })
  await page.mouse.click(box.x + 600, box.y + 500)
  await page.keyboard.press('Escape')
  await expect(rows.filter({ hasText: 'Radiator' }).locator('.uses')).toHaveText('4')
})

test('lists the components of the drawing in their own panel, and places one from there by a click or a drag', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 400, box.y + 380)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  const rows = page.locator('[data-panel="components"] .row')
  const count = rows.first().locator('.uses')
  await expect(rows).toHaveCount(1)
  // Its placement is selected, so its row is too.
  await expect(rows.first()).toHaveClass(/selected/)
  await expect(count).toHaveText('1')
  // Clicked, it goes on the pointer, and a click on the drawing puts it down.
  await rows.first().click()
  await page.mouse.click(box.x + 600, box.y + 500)
  await expect(count).toHaveText('2')
  await page.keyboard.press('Escape')
  // Dragged onto the drawing, it is put down where it is let go.
  const row = (await rows.first().boundingBox())!
  await page.mouse.move(row.x + 10, row.y + row.height / 2)
  await page.mouse.down()
  await page.mouse.move(row.x + 40, row.y + row.height / 2)
  await page.mouse.move(box.x + 700, box.y + 300)
  await page.mouse.up()
  await expect(count).toHaveText('3')
  // Deleted from its row, once the question is answered, it goes with its placements.
  const remove = rows.first().getByRole('button', { name: 'Delete component and its instances' })
  const question = page.getByRole('alertdialog', { name: 'Delete component' })
  await remove.click()
  await expect(question).toContainText('“Component 1” is placed 3 times in the drawing')
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toHaveCount(0)
  await expect(rows).toHaveCount(1)
  await remove.click()
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(rows).toHaveCount(0)
  await expect(objectRows(page)).toHaveCount(0)
})

test('shows the components as pictures too, faint when placed nowhere, and deletes those at once', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // A component of the library, given up before it is put down, leaves nothing in the drawing.
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Armchair$/ }) }).first().click()
  await page.mouse.move(box.x + 500, box.y + 300)
  await page.mouse.move(box.x + 520, box.y + 320)
  await page.keyboard.press('Escape')
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  const panel = page.locator('[data-panel="components"]')
  await expect(panel.locator('.row')).toHaveCount(0)
  // Two of the drawing's own; the placement of the second deleted, it is placed nowhere.
  for (const x of [300, 600]) {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + x, box.y + 300)
    await page.mouse.click(box.x + x + 100, box.y + 380)
    await page.keyboard.press('v')
    await objectRows(page).first().click()
    await page.keyboard.press('Control+Alt+k')
  }
  await page.keyboard.press('Delete')
  await expect(panel.locator('.row')).toHaveCount(2)
  await expect(panel.locator('.row.unused')).toHaveCount(1)
  // As pictures, side by side, with the same faint one.
  await panel.getByRole('button', { name: 'Show as pictures' }).click()
  await expect(panel.locator('.component-tile')).toHaveCount(2)
  await expect(panel.locator('.component-tile.unused')).toHaveCount(1)
  // Those placed nowhere go at once, from the panel's "···", once the question is answered.
  const more = panel.getByRole('button', { name: 'More actions' })
  const purge = page.getByRole('menuitem', { name: 'Delete unused components' })
  await more.click()
  await purge.click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('alertdialog', { name: 'Delete unused components' }).getByRole('button', { name: 'Delete' }).click()
  await expect(panel.locator('.component-tile')).toHaveCount(1)
  await expect(panel.locator('.component-tile.unused')).toHaveCount(0)
  // With none left, the entry is greyed; Escape closes the menu.
  await more.click()
  await expect(purge).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('opens a component from its row filling the view, and comes back to the view it was opened from', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 100, box.y + 100)
  await page.mouse.click(box.x + 130, box.y + 120)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  const zoom = page.locator('.view-bar .zoom-scale')
  const seen = await zoom.innerText()
  await page.locator('.dv-tab:has(.rail-tab[title="Components"])').click()
  await page.locator('[data-panel="components"] .row').first().getByRole('button', { name: 'Edit component' }).click()
  // Inside it, its rectangle of 300 × 200 mm in the middle of the view, at 2 px a millimetre: its
  // left side 300 px left of the middle.
  await expect.poll(async () => Number(await zoom.getAttribute('data-zoom'))).toBeCloseTo(2, 3)
  await page.mouse.click(box.x + box.width / 2 - 300, box.y + box.height / 2)
  await expect(objectRows(page).first()).toHaveClass(/selected/)
  // Out again (Esc lets go of the rectangle, then leaves), the drawing is as it was, its placement selected.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(zoom).toHaveText(seen)
  await expect(objectRows(page).first()).toHaveClass(/selected/)
})

test('turns a rectangle about its middle from the angle typed, and arranges it from the toolbar', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const label = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) })
  const field = (name: string) => label(name).locator('input')
  // Stacking is in the toolbar.
  await expect(label('Order')).toHaveCount(0)
  const x = Number(await field('X').inputValue())
  const y = Number(await field('Y').inputValue())
  await field('Rotation').fill('90')
  await field('Rotation').press('Enter')
  // 2000 by 1000 turned a quarter about its middle: the corner it is placed by goes round it.
  await expect(field('X')).toHaveValue(String(x + 1500))
  await expect(field('Y')).toHaveValue(String(y - 500))
  await page.getByTitle('Arrange: stacking order, align, space evenly').click()
  await expect(page.getByRole('menuitem', { name: 'Bring to front' })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Align left' })).toBeDisabled()
})

test('turns a compass by its knob, its box turning with it, and turns it again from where the knob went', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Compass \(north\)$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // At the first zoom (0.1 px/mm, the origin at 320, 220).
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Compass (north)' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const x = Number(await field('X').inputValue())
  const y = Number(await field('Y').inputValue())
  const centre = { x: 320 + x * 0.1, y: 220 + y * 0.1 }
  const grabs = async (at: { x: number; y: number }) => {
    await page.mouse.move(box.x + at.x, box.y + at.y)
    return (await canvas(page).evaluate((el) => el.style.cursor)) === 'grab'
  }
  // The knob is above the middle of the box, which is as wide each side of the compass's centre.
  const above: number[] = []
  for (let dy = 40; dy < 160; dy++) if (await grabs({ x: centre.x, y: centre.y - dy })) above.push(dy)
  expect(above.length).toBeGreaterThan(0)
  const knob = { x: centre.x, y: centre.y - (above[0] + above[above.length - 1]) / 2 }
  // The box reaches from the letter down to the south point, 600 mm below the centre, and turns
  // about its middle. Its knob stands 22 px off its top, which is drawn 3.5 px out.
  const top = knob.y + 25.5
  const bottom = centre.y + 60
  const middle = { x: centre.x, y: (top + bottom) / 2 }
  const turn = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(box.x + from.x, box.y + from.y)
    await page.mouse.down()
    await page.keyboard.down('Shift')
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
  }
  // A quarter turn clockwise: from above the middle to its right.
  await turn(knob, { x: middle.x + 150, y: middle.y })
  await expect(field('Rotation')).toHaveValue('90')
  // The box turned with the compass rather than growing around it: its knob is now to the right
  // of the middle, as far out as it was above it, and not above the upright box around the
  // compass lying on its side, 840 mm (84 px) high.
  const reach = middle.y - knob.y
  expect(await grabs({ x: middle.x + reach, y: middle.y })).toBe(true)
  expect(await grabs({ x: middle.x, y: middle.y - 42 - 25.5 })).toBe(false)
  await turn({ x: middle.x + reach, y: middle.y }, { x: middle.x, y: middle.y + 150 })
  await expect(field('Rotation')).toHaveValue('180')
  // Turned a half about the middle, which never moved: the centre is as far below it as it was above.
  await expect(field('X')).toHaveValue(String(x))
})

test('shows in the Structure list what is picked on the drawing, however far down', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A floor at the bottom of the stacking order, so the last row, under 400 small squares.
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const key = (i: number) => `b${digits[Math.floor(i / 62)]}${digits[i % 62]}`
  const nodes: Record<string, unknown> = {
    floor: { id: 'floor', type: 'rect', name: 'Floor', parent: 'page_1', order: key(0), x: -20000, y: -20000, width: 40000, height: 40000, style: { fill: '#dddddd' } },
  }
  for (let i = 1; i <= 400; i++) nodes[`s${i}`] = { id: `s${i}`, type: 'rect', parent: 'page_1', order: key(i), x: 50000 + i * 10, y: 50000, width: 5, height: 5 }
  await choose(page, () => page.keyboard.press('Control+o'), 'many.opencalque', drawing(nodes))
  await page.locator('.dv-tab:has(.rail-tab[title="Structure"])').click()
  expect(await objectRows(page).count()).toBeLessThan(100)
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const floor = objectRows(page).filter({ hasText: 'Floor' })
  await expect(floor).toHaveClass(/selected/)
  await expect(floor).toBeInViewport()
})

test('changes the stacking order by dragging a row of the Structure list, and lists what an opened group holds', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const nodes = {
    under: { id: 'under', type: 'rect', name: 'Under', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 1000, height: 1000 },
    over: { id: 'over', type: 'rect', name: 'Over', parent: 'page_1', order: 'a2', x: 2000, y: 0, width: 1000, height: 1000 },
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a3' },
    inside: { id: 'inside', type: 'rect', name: 'Inside', parent: 'set', order: 'a0', x: 4000, y: 0, width: 500, height: 500 },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'order.opencalque', drawing(nodes))
  await page.locator('.dv-tab:has(.rail-tab[title="Structure"])').click()
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under'])
  await objectRows(page).filter({ hasText: 'Set' }).getByTitle('Show what is inside').click()
  await expect(objectRows(page)).toHaveText(['Set', 'Inside', 'Over', 'Under'])
  const under = objectRows(page).filter({ hasText: 'Under' })
  const over = objectRows(page).filter({ hasText: 'Over' })
  await under.dragTo(over, { targetPosition: { x: 40, y: 4 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Inside', 'Under', 'Over'])
})

test('puts an object in a group by dropping its row on the group, and takes one out the same way', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const nodes = {
    under: { id: 'under', type: 'rect', name: 'Under', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 1000, height: 1000 },
    over: { id: 'over', type: 'rect', name: 'Over', parent: 'page_1', order: 'a2', x: 2000, y: 0, width: 1000, height: 1000 },
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a3' },
    inside: { id: 'inside', type: 'rect', name: 'Inside', parent: 'set', order: 'a0', x: 4000, y: 0, width: 500, height: 500 },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'groups.opencalque', drawing(nodes))
  await page.locator('.dv-tab:has(.rail-tab[title="Structure"])').click()
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under'])
  // Dropped on the middle of the group's row: it goes in, on top of what the group holds, and the group opens to show it.
  const row = (name: string) => objectRows(page).filter({ hasText: new RegExp(`^${name}$`) })
  const height = (await row('Set').boundingBox())!.height
  await row('Over').dragTo(row('Set'), { targetPosition: { x: 60, y: height / 2 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Inside', 'Under'])
  // One step in from the group's own row.
  const indent = async (name: string) => parseFloat(await row(name).evaluate((element) => getComputedStyle(element).paddingLeft))
  expect((await indent('Over')) - (await indent('Set'))).toBe(14)
  // A row inside the group, dropped below one on the page, comes out of it.
  await row('Inside').dragTo(row('Under'), { targetPosition: { x: 60, y: height - 3 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under', 'Inside'])
  expect(await indent('Inside')).toBe(await indent('Set'))
})

test('with Shift, a dimension keeps level and stops on the line it crosses', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // A rectangle whose right side is at x = 1800 mm (x = 500 on screen, 10 mm a pixel).
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  // From a point left of it, Shift held, the pointer a little past its right side and below the start.
  await page.keyboard.press('m')
  await page.mouse.click(box.x + 200, box.y + 350)
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 504, box.y + 356, { steps: 4 })
  await expect(page.locator('.status')).toContainText(/Distance 3\s?000 mm · ΔX 3\s?000 · ΔY 0/)
  await page.keyboard.up('Shift')
  await page.keyboard.press('Escape')

  await page.keyboard.press('d')
  await page.mouse.click(box.x + 200, box.y + 350)
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 504, box.y + 356, { steps: 4 })
  await page.mouse.click(box.x + 504, box.y + 356)
  await page.keyboard.up('Shift')
  await page.mouse.click(box.x + 504, box.y + 330)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X2')).toHaveValue(/^1\s?800$/)
  await expect(field('Y2')).toHaveValue(/^1\s?300$/)
})

test('takes a thing out of a component: cut inside it, pasted on the page where the component drew it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  // The component placed elsewhere: its rectangle is drawn from (3000, 1000), 30 px a metre on screen... 10 mm a pixel.
  await field('X').fill('3000')
  await field('X').press('Enter')
  await field('Y').fill('1000')
  await field('Y').press('Enter')
  await page.mouse.dblclick(box.x + 720, box.y + 370)
  await objectRows(page).first().click()
  await expect(field('X')).toHaveValue('0')
  await page.keyboard.press('Control+x')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+v')
  // Two things on the page now: the placement of the emptied component, and the rectangle, on top, where it was seen.
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).first().click()
  await expect(field('X')).toHaveValue(/^3\s?000$/)
  await expect(field('Y')).toHaveValue(/^1\s?000$/)
})

test('shows the way into a group and a component in it, and goes back out to any place on it', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  // The rectangle made into a component, its placement then put in a group.
  await page.keyboard.press('Control+Alt+k')
  await page.keyboard.press('Control+g')
  const crumbs = page.locator('.breadcrumb .crumb:not(.ahead)')
  const left = page.locator('.breadcrumb .crumb.ahead')
  const selected = page.locator('[data-panel="objects"] .row.selected')
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await expect(crumbs).toHaveText(['Page 1', /Group/])
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await expect(crumbs).toHaveText(['Page 1', /Group/, 'Component 1'])
  await expect(page.locator('.hint-bar')).toContainText('insertion point')
  // Back to the group in one click, the placement gone into selected there and the component left
  // shown after it.
  await page.locator('.breadcrumb button.crumb', { hasText: 'Group' }).click()
  await expect(crumbs).toHaveText(['Page 1', /Group/])
  await expect(left).toHaveText(['Component 1'])
  await expect(selected).toHaveText(/Component 1/)
  // Out to the page, the group selected. The places left stay.
  await page.locator('.breadcrumb button.crumb', { hasText: 'Page 1' }).click()
  await expect(crumbs).toHaveText(['Page 1'])
  await expect(left).toHaveText([/Group/, 'Component 1'])
  await expect(selected).toHaveText(/Group/)
  // Straight back into the component, and out again a step at a time with Esc.
  await left.filter({ hasText: 'Component 1' }).click()
  await expect(crumbs).toHaveText(['Page 1', /Group/, 'Component 1'])
  await expect(left).toHaveCount(0)
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape')
  await expect(crumbs).toHaveText(['Page 1'])
  await expect(left).toHaveText([/Group/, 'Component 1'])
  // On the page with nothing selected, Esc lets go of them.
  await page.keyboard.press('Escape')
  await expect(page.locator('.breadcrumb')).toHaveCount(0)
  // After that, leaving offers back only what was just left. Gone into by a double-click, the group
  // has what was double-clicked in it selected: Esc lets go of it, then leaves.
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await expect(selected).toHaveText(/Component 1/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(left).toHaveText([/Group/])
})

test('puts what is cut and pasted on top of what it was under', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const rect = async (from: [number, number], to: [number, number]) => {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + from[0], box.y + from[1])
    await page.mouse.click(box.x + to[0], box.y + to[1])
  }
  // The first under the second, which overlaps it: the list shows the topmost first.
  await rect([300, 300], [500, 400])
  await rect([350, 320], [550, 420])
  await page.keyboard.press('v')
  const x = page.locator('label.field', { has: page.locator('span:text-is("X")') }).locator('input')
  await objectRows(page).nth(1).click()
  await expect(x).toHaveValue('-200')
  await page.keyboard.press('Control+x')
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).first().click()
  await expect(x).toHaveValue('-200')
})

test('measures and dimensions between the points clicked, not the grid points near them', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // At the first zoom the grid is 100 mm: these points, 4370 mm apart, are between its lines.
  await page.keyboard.press('m')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.move(box.x + 737, box.y + 300, { steps: 4 })
  await expect(page.locator('.status')).toContainText(/4\s?370/)
  await page.keyboard.press('Escape')

  await page.keyboard.press('d')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 737, box.y + 300)
  await page.mouse.click(box.x + 737, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const x = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(x('X2')).toHaveValue(/^4\s?170$/)
  await expect(x('X1')).toHaveValue('-200')
})

test('keeps every row of a dimension style on one line in the narrow side panel, with cut words shown whole under the pointer', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Dimension styles')
  await page.keyboard.press('Enter')
  await page.locator('button[title="Add a dimension style"]').click()
  const panel = page.locator('[data-panel="dimensionStyles"]')
  const text = panel.locator('h4:has-text("Text") ~ .type-prop')
  const row = (name: string) => text.filter({ has: page.locator(`span:text-is("${name}")`) })
  for (const name of ['Font', 'Color']) {
    const box = row(name).locator('input[type=checkbox]').first()
    if (!(await box.isChecked())) await box.click()
  }
  // A colour defined by the style can be seen and chosen: its chooser was once hidden with the row's name.
  await expect(row('Color').locator('.color-now')).toBeVisible()
  // In a column of about 250 px every row is one line: the font stays beside its name.
  for (const name of ['Font', 'Color', 'Size']) expect((await row(name).boundingBox())!.height, name).toBeLessThanOrEqual(32)
  // What is left to each dimension is said in a few words, cut if need be and shown whole under the pointer.
  const left = text.locator('em').first()
  await left.hover()
  if (await left.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) await expect(left).toHaveAttribute('title', 'each dimension its own')
})

test('shows the panels of a group as icons in a rail, the name of the one in front above it once, one alone under its name, and reorders them by dragging', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const rail = page.locator('.dv-tabs-container-vertical', { has: page.locator('.rail-tab[title="Colours"]') })
  expect(await rail.locator('.rail-tab').evaluateAll((icons) => icons.map((icon) => icon.getAttribute('title')))).toEqual(['Layers', 'Pages', 'Components', 'Colours', 'Materials', 'Dimension styles'])
  // Structure is alone in its group: no rail, its name and its cross in the row at the top.
  const structure = page.locator('.dv-groupview', { has: page.locator('[data-panel="objects"]') })
  await expect(structure.locator('.dv-groupview-header-vertical')).toHaveCount(0)
  await expect(structure.locator('.dv-tab')).toHaveText('Structure')
  await expect(structure.getByRole('button', { name: 'Close' })).toHaveCount(1)
  await expect(structure.locator('.panel-head')).toHaveCount(0)
  // The name is in the row at the top of the panel, and nowhere else in it.
  await rail.locator('.rail-tab[title="Dimension styles"]').click()
  const frame = page.locator('[data-panel="dimensionStyles"]')
  await expect(frame.locator('.panel-head .panel-title')).toHaveText('Dimension styles')
  await expect(frame.getByRole('button', { name: 'Add a dimension style' })).toBeVisible()
  await expect(frame.locator('.section h3', { hasText: 'Dimension styles' })).toHaveCount(0)

  // Icons are dragged into another order, a bar showing where one would land; none where it would stay.
  const top = page.locator('.dv-tabs-container', { has: page.locator('.rail-tab[title="Pages"]') })
  const icons = top.locator('.rail-tab')
  const marks = top.locator('.dv-drop-target-selection')
  const a = (await icons.nth(0).boundingBox())!
  const b = (await icons.nth(1).boundingBox())!
  const x = a.x + a.width / 2
  await page.mouse.move(x, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, a.y + a.height / 2 + 6, { steps: 2 })
  await page.mouse.move(x, b.y + 5, { steps: 6 })
  await expect(marks).toHaveCount(0)
  await page.mouse.move(x, b.y + b.height - 3, { steps: 4 })
  await expect(marks).toHaveCount(1)
  await page.mouse.up()
  expect(await icons.evaluateAll((all) => all.map((icon) => icon.getAttribute('title')))).toEqual(['Pages', 'Layers', 'Components', 'Colours', 'Materials', 'Dimension styles'])

  // Dragged by its name into the rail, Structure joins it; the rail's last icon dragged out stands alone under its name.
  const name = (await structure.locator('.dv-tab').boundingBox())!
  const last = (await icons.last().boundingBox())!
  await page.mouse.move(name.x + name.width / 2, name.y + name.height / 2)
  await page.mouse.down()
  await page.mouse.move(name.x + name.width / 2 + 10, name.y + name.height / 2, { steps: 2 })
  await page.mouse.move(last.x + last.width / 2, last.y + last.height - 3, { steps: 8 })
  await page.mouse.up()
  await expect(icons).toHaveCount(7)
  await expect(page.locator('[data-panel="objects"] .panel-head .panel-title')).toHaveText('Structure')
})

test('resizes a column by its line away from the drawing: the columns between keep their width, the drawing takes the difference', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const group = (tab: string) => page.locator('.dv-groupview', { has: page.locator(`.rail-tab[title="${tab}"]`) })
  const stage = page.locator('.dv-groupview', { has: page.locator('.stage') })
  const columns = { layers: group('Layers'), components: group('Components'), stage, assistant: group('Assistant'), properties: group('Properties') }
  const widths = async () => Object.fromEntries(await Promise.all(Object.entries(columns).map(async ([name, column]) => [name, (await column.count()) ? (await column.boundingBox())!.width : 0]))) as Record<keyof typeof columns, number>
  const changed = async (before: Record<keyof typeof columns, number>, by: Partial<Record<keyof typeof columns, number>>) => {
    const after = await widths()
    for (const name of Object.keys(columns) as (keyof typeof columns)[]) expect(Math.abs(after[name] - before[name] - (by[name] ?? 0)), name).toBeLessThanOrEqual(1)
  }
  const dropBeside = async (tab: string, x: (area: { x: number; width: number }) => number) => {
    const from = (await page.locator(`.dv-tab:has(.rail-tab[title="${tab}"])`).boundingBox())!
    const area = (await stage.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 2 })
    await page.mouse.move(x(area), area.y + area.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  const drag = async (x: number, by: number) => {
    const y = (await stage.boundingBox())!.y + 120
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + by, y, { steps: 6 })
    await page.mouse.up()
  }

  // Two columns on each side of the drawing.
  await dropBeside('Components', (area) => area.x + 12)
  await dropBeside('Assistant', (area) => area.x + area.width - 12)
  let before = await widths()
  for (const name of Object.keys(columns) as (keyof typeof columns)[]) expect(before[name], name).toBeGreaterThan(100)
  const edge = async (column: keyof typeof columns) => (await columns[column].boundingBox())!.x

  // The line between the two on the left is the outer column's: narrowed, the other keeps its width.
  await drag(await edge('components'), -60)
  await changed(before, { layers: -60, stage: 60 })
  before = await widths()
  await drag(await edge('components'), 80)
  await changed(before, { layers: 80, stage: -80 })

  // On the right too.
  before = await widths()
  await drag(await edge('properties'), 50)
  await changed(before, { properties: -50, stage: 50 })

  // A column closed leaves its room to the drawing.
  before = await widths()
  // Alone in its column, its cross is in the row at the top of the group.
  await columns.components.getByRole('button', { name: 'Close' }).click()
  await expect(columns.components).toHaveCount(0)
  const after = await widths()
  expect(after.stage).toBeGreaterThan(before.stage + before.components - 10)
  for (const name of ['layers', 'assistant', 'properties'] as const) expect(Math.abs(after[name] - before[name]), name).toBeLessThanOrEqual(1)

  // And so in the arrangement remembered for the next time.
  await page.reload()
  await expect(stage).toHaveCount(1)
  before = await widths()
  await drag(await edge('properties'), -40)
  await changed(before, { properties: 40, stage: -40 })
})

test('imports a DXF of twenty thousand lines in a few seconds', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const lines = Array.from({ length: 20000 }, (_, i) => `0\nLINE\n8\n0\n10\n${i * 10}\n20\n0\n11\n${i * 10}\n21\n1000`).join('\n')
  const dxf = `0\nSECTION\n2\nENTITIES\n${lines}\n0\nENDSEC\n0\nEOF\n`
  const start = Date.now()
  await choose(page, () => page.keyboard.press('Control+i'), 'big.dxf', dxf)
  await expect(page.locator('.toast')).toContainText('Imported 20000 objects from big.dxf', { timeout: 15000 })
  expect(Date.now() - start).toBeLessThan(15000)
  // The structure lays out only the rows in sight, in a list as long as all twenty thousand:
  // laying them all out took seconds after every change.
  await page.locator('.dv-tab:has(.rail-tab[title="Structure"])').click()
  const panel = page.locator('[data-panel="objects"] .dock-panel')
  expect(await objectRows(page).count()).toBeLessThan(100)
  expect(await panel.evaluate((element) => element.scrollHeight)).toBeGreaterThan(20000 * 28)
  await panel.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect(objectRows(page).last()).toBeInViewport()
  expect(await objectRows(page).count()).toBeLessThan(100)
})

test('offers back unsaved work after the window crashed', async ({ page, context, browser }) => {
  await startWith(page)
  await openEditor(page)
  await drawWall(page, [300, 300], [700, 300])
  // The copy is made a moment after the last change.
  await page.waitForTimeout(2500)
  // What the browser kept for the site, taken while the window is still open, as a crash would
  // leave it (a window closed normally takes its copy away), is what the next start finds.
  const kept = await context.storageState({ indexedDB: true })
  const later = await browser.newContext({ storageState: kept, viewport: { width: 1400, height: 900 } })
  const after = await later.newPage()
  after.on('pageerror', (error) => ((page as any).errors as string[]).push(error.message))
  // A blank page of the same site, to make the crashed window's last sign of life old enough to count as gone.
  await after.route('**/blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }))
  await after.goto('/blank')
  await after.evaluate(
    () =>
      new Promise<void>((done) => {
        const open = indexedDB.open('opencalque-recovery', 1)
        open.onsuccess = () => {
          const store = open.result.transaction('drawings', 'readwrite').objectStore('drawings')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const kept of all.result) store.put({ ...kept, alive: 0 })
            store.transaction.oncomplete = () => done()
          }
        }
      }),
  )
  await after.goto('/')
  const offered = after.locator('.welcome-recover-row')
  await expect(offered).toHaveCount(1)
  await offered.locator('button').first().click()
  await expect(after.locator('[data-panel="objects"] .row')).toHaveCount(1)
  // It is unsaved work again: the title says so.
  await expect(after).toHaveTitle(/^● /)
  await later.close()
})

test('tells the assistant what is selected, and applies what it answers', async ({ page }) => {
  await startWith(page, { ai: { provider: 'anthropic', anthropic: { apiKey: 'test-key', model: 'claude-opus-5-5' } } })
  const requests: string[] = []
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = request.postData() ?? ''
    requests.push(body)
    const events: unknown[] =
      requests.length === 1
        ? (() => {
            const id = /\\"(n_[a-z0-9]+)\\", a wall/.exec(body)?.[1] ?? 'missing'
            const input = JSON.stringify({ operations: [{ op: 'update_node', id, patch: { thickness: 300 } }] })
            return [
              { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'apply_operations', input: {} } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
            ]
          })()
        : [
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The wall is now 300 mm thick.' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
          ]
    const start = { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }
    const stream = [start, ...events, { type: 'message_stop' }].map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: stream })
  })
  await openEditor(page)
  await drawWall(page, [300, 300], [700, 300])
  await objectRows(page).first().click()
  await page.locator('.dv-tab:has(.rail-tab[title="Assistant"])').click()
  await expect(page.locator('.assistant-context')).toContainText('Wall')
  await page.locator('.assistant-composer textarea').fill('make this thicker')
  await page.keyboard.press('Enter')
  await expect(page.locator('.assistant-entry.assistant')).toContainText('300 mm thick')
  await expect(page.locator('.assistant-entry.activity').first()).toContainText('Applied 1 change')
  expect(requests[0]).toContain('<selection>')
  expect(requests[0]).toContain('length ')
  expect(requests[0]).toContain('make this thicker')

  // Left out, the selection is not sent with the next message.
  await page.locator('.assistant-context button').click()
  await page.locator('.assistant-composer textarea').fill('thanks')
  await page.keyboard.press('Enter')
  await expect.poll(() => requests.length).toBe(3)
  // Each request carries the conversation so far; what matters is the newest message.
  const newest = JSON.stringify(JSON.parse(requests[2]).messages.at(-1))
  expect(newest).toContain('thanks')
  expect(newest).toContain('chose not to send what is selected')
  expect(newest).not.toContain('<selection>')
})

test('shows the version and its notes under About, and the licences of what the app includes', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('About OpenCalque')
  await page.keyboard.press('Enter')
  const about = page.locator('.dialog.about')
  await expect(about.locator('.about-notes h4').first()).toContainText(/^Version \d+\.\d+\.\d+/)
  await about.getByRole('button', { name: 'Licences' }).click()
  // Loaded only now, from THIRD-PARTY-NOTICES.txt: the fonts and the packages of others the build holds.
  await expect(about.locator('.about-licences')).toContainText('pdfjs-dist')
  await expect(about.locator('.about-licences')).toContainText('SIL OPEN FONT LICENSE')
  await about.getByRole('button', { name: 'What is new' }).click()
  await expect(about.locator('.about-licences')).toHaveCount(0)
})

test('shows which ends of a wall are joined, sets one loose, and brings an end that nearly meets another onto it', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, order: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  // An L joined at (4000, 0), and a third wall whose end stops 4 mm short of the L's other end.
  const plan = drawing({ top: wall('top', 'a1', [0, 0], [4000, 0]), side: wall('side', 'a2', [4000, 0], [4000, 3000]), short: wall('short', 'a3', [4000, 3004], [1000, 3004]) }, { version: 2 })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(3)
  const saved = async () => {
    await page.keyboard.press('Control+s')
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  }
  const endOf = (label: string) => page.locator('.field', { has: page.locator(`span:text-is("${label}")`) }).locator('.wall-end')

  // The side wall: joined at its start, nearly meeting the short wall at its end.
  await objectRows(page).filter({ hasText: 'Wall' }).nth(1).click()
  await expect(endOf('At its end')).toContainText('Nearly meets another wall, 4 mm away')
  await endOf('At its end').getByRole('button', { name: 'Join them' }).click()
  expect((await saved()).nodes.side.b).toEqual({ x: 4000, y: 3004 })
  await expect(endOf('At its end')).not.toContainText('Nearly')

  // Set loose at its start, it is joined to the top wall no more, and can be joined again. In the
  // side panel the pictures of joints have no room beside their name: they are a list.
  const joint = (label: string) => endOf(label).locator('.picture-row > .select')
  const NOT_JOINED = 'Not joined: the walls that end here do not follow it, nor it them'
  await pickIn(page, joint('At its start'), NOT_JOINED)
  expect((await saved()).nodes.side.joins).toEqual({ a: 'free' })
  // The joint chosen is drawn on the list's button, named when the pointer rests on it.
  await expect(joint('At its start').locator('.select-value')).toHaveAttribute('title', NOT_JOINED)

  // Dragged by that end, the selected wall moves, and the wall it was set loose from stays.
  const onScreen = await drawingOnScreen(page)
  const [x, y] = onScreen(4000, 0)
  const [, y2] = onScreen(4000, 600)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, (y + y2) / 2, { steps: 4 })
  await page.mouse.move(x, y2, { steps: 4 })
  await page.mouse.up()
  const dragged = await saved()
  expect(dragged.nodes.top.b).toEqual({ x: 4000, y: 0 })
  expect(dragged.nodes.side.a.y).toBeGreaterThan(300)
  await expect(page.locator('.field', { has: page.locator('span:text-is("At its start")') })).toBeVisible()
  await page.keyboard.press('Control+z')

  // A joint picked joins it again, with that joint.
  await pickIn(page, joint('At its start'), 'Rounded')
  expect((await saved()).nodes.side.joins).toEqual({ a: 'round' })
  await expect(joint('At its start').locator('.select-value')).toHaveAttribute('title', 'Rounded')
})

test('brings the end of a wall level with its other end exactly, whatever decimals that one has, and says nothing of a hair off', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // Its start where a traced plan puts it, to the millionth of a millimetre.
  const traced = { x: 0.123456, y: 1000.340414 }
  const plan = drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: traced, b: { x: 3000, y: 1600 }, thickness: 200 } })
  await choose(page, () => page.keyboard.press('Control+o'), 'traced.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(1)
  await objectRows(page).first().click()
  const onScreen = await drawingOnScreen(page)
  const [x, y] = onScreen(3000, 1600)
  const [, level] = onScreen(3000, 1030)
  // Its end dragged with Shift, held level with its start.
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(x, (y + level) / 2, { steps: 4 })
  await page.mouse.move(x, level, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.keyboard.press('Control+s')
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  expect(doc.nodes.w.a).toEqual(traced)
  expect(doc.nodes.w.b.y).toBe(traced.y)
  await expect(page.locator('[data-panel="properties"] .hint', { hasText: 'Not quite level' })).toHaveCount(0)
})

test('exports the keyboard shortcuts to a file and imports them back', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await page.keyboard.press('Control+,')
  await page.locator('.prefs-nav button', { hasText: 'Keyboard shortcuts' }).click()
  await page.getByPlaceholder('Search a command or a key…').fill('Show all commands')
  const keys = page.locator('.shortcut-row', { hasText: 'Show all commands' }).locator('.palette-keys')
  await keys.click()
  await page.keyboard.press('Alt+J')
  await expect(keys).toHaveText('Alt+J')

  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const file = await page.evaluate(() => (window as any).saves[0] as string)
  expect(JSON.parse(file)).toMatchObject({ format: 'opencalque-shortcuts', version: 1, shortcuts: { 'palette.open': ['Alt+J'] } })

  await page.getByRole('button', { name: 'Reset all shortcuts' }).click()
  await expect(keys).toHaveText('Ctrl+K')
  await choose(page, () => page.getByRole('button', { name: 'Import…' }).click(), 'drawing.json', drawing({}))
  await expect(page.getByText('drawing.json is not a file of keyboard shortcuts')).toBeVisible()
  await expect(keys).toHaveText('Ctrl+K')
  await choose(page, () => page.getByRole('button', { name: 'Import…' }).click(), 'opencalque-shortcuts.json', file)
  await expect(keys).toHaveText('Alt+J')

  // Imported shortcuts work at once.
  await page.keyboard.press('Escape')
  await page.locator('.stage').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Alt+J')
  await expect(page.getByPlaceholder('Type a command…')).toBeVisible()
})

test('exports a page as a PNG picture of the size chosen', async ({ page }) => {
  await startWith(page)
  // The bytes saved, kept whole, to read the picture's size from its header.
  await page.addInitScript(() => {
    ;(window as any).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      name: suggestedName,
      createWritable: async () => ({ write: async (data: Uint8Array) => void ((window as any).png = { name: suggestedName, bytes: Array.from(data.slice(0, 24)) }), close: async () => {} }),
    })
  })
  await openEditor(page)
  await drawWall(page, [300, 300], [700, 300])
  await page.keyboard.press('Control+e')
  await page.getByRole('radio', { name: /PNG/ }).click()
  await pickIn(page, page.locator('.export-options .pref-field', { hasText: 'Size' }).locator('.select'), '2000 pixels on its longer side')
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).png?.name)).toMatch(/\.png$/)
  const bytes: number[] = await page.evaluate(() => (window as any).png.bytes)
  const word = (at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  // The PNG signature, then a header 2000 pixels wide, the wall being wider than it is high.
  expect(bytes.slice(1, 4)).toEqual([0x50, 0x4e, 0x47])
  expect(word(16)).toBe(2000)
  expect(word(20)).toBeLessThan(2000)
})

test('zooms and switches the grid, snapping and temporary dimensions from the view bar, and draws a paper from the shapes', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  // A still square in the corner, which opens under the pointer.
  const bar = page.getByRole('toolbar', { name: 'View' })
  const scale = bar.locator('.zoom-scale')
  await expect(bar).toBeHidden()
  const handle = page.getByRole('button', { name: 'View: zoom, grid and snapping' })
  const closed = await handle.boundingBox()
  await handle.hover()
  await expect(bar).toBeVisible()
  // Nothing moves as it opens, nor as the scale gets longer or shorter.
  expect(await handle.boundingBox()).toEqual(closed)
  const width = (await bar.boundingBox())!.width
  for (const press of ['Home', 'End']) {
    await bar.getByRole('slider', { name: 'Zoom' }).focus()
    await page.keyboard.press(press)
    expect(await handle.boundingBox()).toEqual(closed)
    expect((await bar.boundingBox())!.width).toBe(width)
  }
  await expect(scale).toHaveText('5.3:1')
  // As far out as it goes: zooming in from there.
  await page.keyboard.press('Home')
  await expect(scale).toHaveText('1:1890')
  const before = Number(await scale.getAttribute('data-zoom'))
  await bar.getByRole('button', { name: /^Zoom in/ }).click()
  await expect.poll(async () => Number(await scale.getAttribute('data-zoom'))).toBeCloseTo(before * 1.25, 5)
  // The slider at its far end: as close as the view goes, 20 px a millimetre, shown as a scale.
  await bar.getByRole('slider', { name: 'Zoom' }).focus()
  await page.keyboard.press('End')
  await expect(scale).toHaveText('5.3:1')
  // Each setting lit while on, and kept as a preference.
  const grid = bar.getByRole('button', { name: /^Show grid/ })
  await expect(grid).toHaveAttribute('aria-pressed', 'true')
  await grid.click()
  await expect(grid).toHaveAttribute('aria-pressed', 'false')
  await bar.getByRole('button', { name: /^Show temporary dimensions/ }).click()
  const prefs = JSON.parse((await page.evaluate(() => localStorage.getItem('opencalque.prefs')))!)
  expect(prefs).toMatchObject({ showGrid: false, showClearances: false })

  // The paper is drawn from the shapes' list, as a rectangle is.
  await page.getByRole('button', { name: /^Line, Curved line, Arc/ }).click()
  await page.getByRole('menuitem', { name: /^Paper/ }).click()
  await expect(page.locator('.toolbar .icon-button.active')).toHaveAttribute('title', /^Paper/)
})

test('keeps a door in its wall when the wall is made shorter than where the door was', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing({
    w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Wall', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
    d: { id: 'd', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a2', kind: 'arch.door', props: { width: 900 }, x: 4000, y: 0 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await objectRows(page).filter({ hasText: 'Wall' }).click()
  const length = page.locator('.field', { has: page.locator('span:text-is("Length")') }).locator('input')
  await length.fill('3000')
  await length.press('Enter')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  const saved = JSON.parse(await page.evaluate(() => (window as any).saves[0]))
  expect(saved.nodes.w.b).toEqual({ x: 3000, y: 0 })
  // Pushed back to the end of the wall, which it would otherwise have stood beyond.
  expect(saved.nodes.d).toMatchObject({ x: 2100, y: 0 })
  // And undone in the same step as the wall.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(2)
  expect(JSON.parse(await page.evaluate(() => (window as any).saves[1])).nodes.d).toMatchObject({ x: 4000, y: 0 })
})

test('the AI preferences of the web app hold the assistant, and no door for agents', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.keyboard.press('Control+,')
  await page.locator('.prefs-nav button', { hasText: 'AI' }).click()
  await expect(page.locator('.pref-heading')).toHaveText(['Assistant'])
  await expect(page.locator('.pref-field', { hasText: 'Provider' })).toBeVisible()
  await expect(page.getByLabel('Let agents on this computer work on the open drawing')).toHaveCount(0)
})

test('the properties panel: a name, a layer by its colour, its status, and sizes that keep their proportions', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const rect = (id: string, order: string, layer: string, width = 2000, height = 1000) => ({ id, type: 'rect', parent: 'page_1', order, layer, x: 0, y: 0, width, height })
  const opened = JSON.parse(drawing({ a: rect('a', 'a1', 'layer_1'), b: rect('b', 'a2', 'walls', 400, 400) }))
  opened.layers.walls = { id: 'walls', name: 'Walls', order: 'a1', color: '#e11d48' }
  await choose(page, () => page.keyboard.press('Control+o'), 'panel.opencalque', JSON.stringify(opened))
  await expect(objectRows(page)).toHaveCount(2)
  const panel = page.locator('[data-panel="properties"]')
  const field = (name: string) => panel.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const row = objectRows(page).filter({ has: page.locator('.type-icon') })
  await row.last().click()
  await expect(panel.locator('.section h3').first()).toHaveText('Selection')

  // Unnamed, it says what it is; named, the Structure panel says the name; emptied, it goes back.
  await expect(field('Name')).toHaveAttribute('placeholder', 'Rectangle')
  await field('Name').fill('Slab')
  await field('Name').press('Enter')
  await expect(row.last()).toContainText('Slab')
  await field('Name').fill('')
  await field('Name').press('Enter')
  await expect(row.last()).toContainText('Rectangle')

  // The layer is picked from a list that shows the colour of each.
  const layer = panel.locator('.layer-choice > button')
  await expect(layer).toContainText('Layer 1')
  await layer.click()
  const walls = page.locator('.layer-menu .color-option', { hasText: 'Walls' })
  await expect(walls.locator('.layer-mark')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await walls.click()
  await expect(layer).toContainText('Walls')
  await expect(layer.locator('.layer-mark')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await page.keyboard.press('Control+z')
  await expect(layer).toContainText('Layer 1')

  // X and Y side by side, as W and H, each box still named for itself.
  const pairs = panel.locator('.field-pair')
  await expect(pairs.locator('.field-pair-name')).toHaveText(['X, Y', 'W, H'])
  await expect(pairs.first().locator('input')).toHaveCount(2)

  // A size is set alone until the lock says otherwise; then the other follows, and one undo takes both back.
  await field('W').fill('3000')
  await field('W').press('Enter')
  await expect(field('H')).toHaveValue('1000')
  await page.getByRole('button', { name: 'Keep the proportions: width and height change together' }).click()
  await field('W').fill('6000')
  await field('W').press('Enter')
  await expect(field('H')).toHaveValue('2000')
  await field('H').fill('1000')
  await field('H').press('Enter')
  await expect(field('W')).toHaveValue('3000')
  await page.keyboard.press('Control+z')
  await expect(field('W')).toHaveValue('6000')
  await expect(field('H')).toHaveValue('2000')

  // Two objects together: their layers differ, so the layer says so, and picking one gives it to both.
  await row.first().click({ modifiers: ['Control'] })
  await expect(panel.locator('.section h3').first()).toHaveText('Selection (2)')
  await expect(field('Name')).toHaveCount(0)
  await expect(layer).toContainText('Mixed')
  await layer.click()
  await walls.click()
  await expect(layer).toContainText('Walls')

  // Status: for both at once, the same as the buttons of their rows.
  const lock = panel.getByRole('radio', { name: 'Lock so it cannot be selected or moved on the drawing' })
  const hide = panel.getByRole('radio', { name: 'Hide' })
  const show = panel.getByRole('radio', { name: 'Show' })
  await lock.click()
  await hide.click()
  await expect(lock).toBeChecked()
  await expect(hide).toBeChecked()
  await expect(row.first().getByRole('button', { name: 'Unlock' })).toHaveCount(1)
  await expect(row.first().getByRole('button', { name: 'Show' })).toHaveCount(1)
  // One of them shown again: they no longer agree, and neither side is lit.
  await row.first().getByRole('button', { name: 'Show' }).click()
  await expect(hide).not.toBeChecked()
  await expect(show).not.toBeChecked()
})

test('folds the sections of the properties panel, and keeps them folded', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const drawRect = async () => {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + 300, box.y + 300)
    await page.mouse.click(box.x + 500, box.y + 400)
    await page.keyboard.press('v')
    await objectRows(page).first().click()
  }
  await drawRect()
  const panel = page.locator('[data-panel="properties"]')
  const heading = panel.getByRole('button', { name: 'Geometry' })
  const x = panel.locator('.field', { has: page.locator('span:text-is("X")') })
  await expect(heading).toHaveAttribute('aria-expanded', 'true')
  await heading.click()
  await expect(heading).toHaveAttribute('aria-expanded', 'false')
  await expect(x).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Stroke' })).toHaveAttribute('aria-expanded', 'true')
  // Still folded after starting again, for the next thing selected.
  await page.reload()
  await expect(page.locator('#splash:not(.leaving)')).toHaveCount(0)
  await drawRect()
  await expect(heading).toHaveAttribute('aria-expanded', 'false')
  await heading.click()
  await expect(x).toHaveCount(1)
})

test('a locked object selected from the Structure panel cannot be changed by its handles', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'locked.opencalque', drawing({ a: { id: 'a', type: 'rect', parent: 'page_1', order: 'a1', layer: 'layer_1', x: 0, y: 0, width: 4000, height: 2000 } }))
  const on = await drawingOnScreen(page)
  const panel = page.locator('[data-panel="properties"]')
  const width = panel.locator('.field', { has: page.locator('span:text-is("W")') }).locator('input')
  const dragCorner = async () => {
    const [x, y] = on(4000, 2000)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y + 30, { steps: 6 })
    await page.mouse.up()
  }
  const row = objectRows(page).filter({ hasText: 'Rectangle' }).first()
  await row.click()
  // Its corner can be pulled, which is what makes the rest of this test mean something.
  await dragCorner()
  await expect(width).not.toHaveValue('4000')
  await page.keyboard.press('Control+z')
  await expect(width).toHaveValue('4000')
  await panel.getByRole('radio', { name: 'Lock so it cannot be selected or moved on the drawing' }).click()
  await dragCorner()
  // There is nothing to take hold of there now: the press is one beside it, which lets it go.
  await expect(width).toHaveCount(0)
  await row.click()
  await expect(width).toHaveValue('4000')
})

test('a drawing opens on the layer in use when it was saved, and choosing one is not an edit', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const rows = page.locator('[data-panel="layers"] .row')
  const written = async () => {
    const count: number = await page.evaluate(() => (window as any).saves.length)
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  }
  await page.getByRole('button', { name: 'Add layer' }).click()
  await expect(rows).toHaveCount(2)
  await rows.nth(0).click()
  // The first layer needs no saying: a drawing on it is written as it always was.
  expect((await written()).meta).toBeUndefined()
  await rows.nth(1).click()
  await expect(page.locator('.menubar-name .faint', { hasText: '●' })).toHaveCount(0)
  const file = await written()
  expect(file.layers[file.meta.activeLayer].name).toBe((await rows.nth(1).textContent())!.trim())

  await rows.nth(0).click()
  await expect(rows.nth(0)).toHaveClass(/current/)
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', JSON.stringify(file))
  await expect(rows.nth(1)).toHaveClass(/current/)
  await expect(rows.nth(0)).not.toHaveClass(/current/)

  // A layer that is no longer there, or anything else in its place, leaves the first one in use.
  for (const kept of ['gone', 'constructor', 7]) {
    await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', JSON.stringify({ ...file, meta: { activeLayer: kept } }))
    await expect(rows.nth(0)).toHaveClass(/current/)
  }
})

test('renames the drawing in place: the text does not move when it is double-clicked', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const name = page.locator('.menubar-name .editable')
  const shown = (await name.boundingBox())!
  const weight = await name.evaluate((el) => getComputedStyle(el).fontWeight)
  await name.dblclick()
  const field = page.locator('.menubar-name .inline-input')
  await expect(field).toBeFocused()
  const box = (await field.boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (shown.x + shown.width / 2))).toBeLessThanOrEqual(2)
  // No wider than the text and the field's own edges.
  expect(box.width).toBeLessThanOrEqual(shown.width + 14)
  expect(await field.evaluate((el) => [getComputedStyle(el).textAlign, getComputedStyle(el).fontWeight])).toEqual(['center', weight])
  await field.fill('A much longer name for this drawing')
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(box.width + 50)
  await field.press('Enter')
  await expect(name).toHaveText('A much longer name for this drawing')
})

test('moves the view with two fingers on a trackpad, and zooms with a mouse wheel or a pinch', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // The point of the drawing under (x, y) on the canvas, as the status bar says it.
  const under = async (x: number, y: number) => {
    await page.mouse.move(box.x + x, box.y + y)
    const text = (await page.locator('.status span').textContent())!.replaceAll(String.fromCharCode(0x2212), '-').replace(/[^\d.,-]/g, '')
    const [wx, wy] = text.split(',').map(Number)
    return { x: wx, y: wy }
  }
  const mmPerPixel = async () => ((await under(400, 300)).x - (await under(300, 300)).x) / 100
  const scale = await mmPerPixel()
  const before = await under(300, 300)
  // Small steps, and sideways ones: two fingers on a trackpad, which move the view 4 pixels across and 30 down.
  await page.mouse.wheel(4, 30)
  const after = await under(300, 300)
  expect(after.y - before.y).toBeCloseTo(30 * scale, 0)
  expect(after.x - before.x).toBeCloseTo(4 * scale, 0)
  expect(await mmPerPixel()).toBeCloseTo(scale, 5)
  // A notch of a mouse wheel, once the swipe is over, zooms in.
  await page.waitForTimeout(400)
  await page.mouse.move(box.x + 300, box.y + 300)
  await page.mouse.wheel(0, -100)
  const nearer = await mmPerPixel()
  expect(nearer).toBeLessThan(scale * 0.9)
  // So does a pinch, which comes with Ctrl.
  await page.waitForTimeout(400)
  await page.mouse.move(box.x + 300, box.y + 300)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -20)
  await page.keyboard.up('Control')
  expect(await mmPerPixel()).toBeLessThan(nearer * 0.9)
})

test('undoes from the toolbar, and redoes from the arrow beside Undo', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 } }))
  await objectRows(page).filter({ hasText: 'Wall' }).click()
  await page.keyboard.press('Delete')
  await expect(objectRows(page).filter({ hasText: 'Wall' })).toHaveCount(0)
  // No Redo button of its own: it is in the list beside Undo.
  await expect(page.locator('.toolbar').getByRole('button', { name: /^Redo/ })).toHaveCount(1)
  await page.locator('.toolbar').getByRole('button', { name: /^Undo/ }).click()
  await expect(objectRows(page).filter({ hasText: 'Wall' })).toHaveCount(1)
  await page.locator('.toolbar').getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('menuitem', { name: /Redo/ }).click()
  await expect(objectRows(page).filter({ hasText: 'Wall' })).toHaveCount(0)
})

test('offers to connect a switch from its right-click menu, not from the toolbar', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', drawing({ s: { id: 's', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a1', kind: 'elec.switch', props: {}, x: 0, y: 0 } }))
  await expect(page.locator('.toolbar').getByRole('button', { name: /Connect/ })).toHaveCount(0)
  await objectRows(page).filter({ hasText: 'Switch' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Connect switches to lights/ }).click()
  await expect(page.locator('.hint-bar')).toContainText('Click a light or a socket it controls')
})

/**
 * Drags one element onto another as the browser does, with the drag events themselves, letting go at
 * `at` (a share of the target's width and height, its middle by default). Playwright's `dragTo`
 * scrolls to the target after finding where the source is, and so presses where something else has
 * come to be in a window that scrolls, as Preferences does.
 */
async function drag(source: Locator, target: Locator, at = { x: 0.5, y: 0.5 }) {
  const handle = await target.elementHandle()
  await source.evaluate(
    (from, { to, at }) => {
      const data = new DataTransfer()
      const point = () => {
        const box = (to as HTMLElement).getBoundingClientRect()
        return { clientX: box.left + box.width * at.x, clientY: box.top + box.height * at.y }
      }
      const fire = (element: Element, type: string, where = {}) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, ...where }))
      fire(from, 'dragstart')
      const over = document.elementFromPoint(point().clientX, point().clientY) ?? (to as Element)
      const into = (to as Element).contains(over) ? over : (to as Element)
      fire(into, 'dragenter', point())
      fire(into, 'dragover', point())
      fire(into, 'drop', point())
      fire(from, 'dragend')
    },
    { to: handle, at },
  )
}

test('sets up the floating toolbar by dragging in Preferences, opened by a right-click on it, and switches between toolbars saved', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const toolbar = page.locator('.toolbar')
  const button = (name: string) => toolbar.getByRole('button', { name: new RegExp(`^${name}`) })
  await expect(button('Wall')).toHaveCount(1)
  await toolbar.click({ button: 'right', position: { x: 10, y: 10 } })
  const row = (name: string) => page.locator('.toolbar-item-row', { has: page.locator('.toolbar-item-name', { hasText: new RegExp(`^${name}$`) }) }).first()
  const top = { x: 0.3, y: 0.1 }
  // The shapes are a list, shown open under its button.
  await expect(row('List of 7 tools')).toBeVisible()
  // Dragged onto what is not in the toolbar, the wall tool leaves it.
  await drag(row('Wall'), page.locator('.toolbar-palette'))
  await expect(button('Wall')).toHaveCount(0)
  // Dragged out of the list of shapes, before the door: a button of its own.
  await drag(row('Line'), row('Door'), top)
  await expect(button('Line')).toHaveCount(1)
  await expect(row('List of 6 tools')).toBeVisible()
  // Dragged onto the middle of the select tool, pan joins it in a list.
  await drag(row('Pan'), row('Select'))
  await expect(row('List of 2 tools')).toBeVisible()
  await expect(button('Pan')).toHaveCount(0)
  // Connect, from what is not in the toolbar, to its end, and a separator before it.
  await drag(row('Connect'), page.locator('.toolbar-end'))
  await expect(toolbar.locator('.icon-button').last()).toHaveAttribute('title', /^Connect/)
  const separators = await toolbar.locator('hr').count()
  await drag(page.locator('.toolbar-palette .toolbar-item-row').first(), page.locator('.toolbar-items .toolbar-item-row', { hasText: /^Connect$/ }).first(), top)
  await expect(toolbar.locator('hr')).toHaveCount(separators + 1)
  // Saved as "Mine", it is the toolbar in use; the one that comes is a choice away, and back again.
  await page.getByRole('textbox', { name: 'Name of the toolbar' }).fill('Mine')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const inUse = page.locator('.pref-field', { hasText: 'Toolbar in use' }).locator('.select')
  await expect(inUse).toHaveText('Mine')
  await pickIn(page, inUse, 'As it comes')
  await expect(button('Wall')).toHaveCount(1)
  await expect(button('Connect')).toHaveCount(0)
  await pickIn(page, inUse, 'Mine')
  await expect(button('Wall')).toHaveCount(0)
  await expect(button('Connect')).toHaveCount(1)
  // Kept for the next start.
  await page.reload()
  await openEditor(page)
  await expect(page.locator('.toolbar').getByRole('button', { name: /^Connect/ })).toHaveCount(1)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Customise the toolbar')
  await page.keyboard.press('Enter')
  await expect(inUse).toHaveText('Mine')
})

test('offers the table of what controls what among the tables of the object library', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.getByPlaceholder(/Search/).fill('controls')
  await expect(page.locator('.warehouse-card strong', { hasText: /^What controls what$/ })).toHaveCount(1)
})

test('a percentage is set with a slider or typed, and stays between 0 and 100', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const plan = drawing({ c: { id: 'c', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a1', kind: 'furn.curtain', props: {}, x: 0, y: 0 } })
  await choose(page, () => page.keyboard.press('Control+o'), 'curtain.opencalque', plan)
  await objectRows(page).first().click()
  const row = page.locator('.percent-field', { has: page.locator('span:text-is("Opened")') })
  const typed = row.locator('input:not([type])')
  const slider = row.locator('input[type="range"]')
  // A curtain is drawn open unless said.
  await expect(typed).toHaveValue('100')
  const type = async (text: string) => {
    await typed.fill(text)
    await typed.press('Enter')
  }
  await type('40')
  await expect(slider).toHaveValue('40')
  await type('150')
  await expect(typed).toHaveValue('100')
  await type('-20')
  await expect(typed).toHaveValue('0')
  // Slid from its start to three quarters of the way: one step to undo, back to shut.
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + 7, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const slid = Number(await typed.inputValue())
  expect(slid).toBeGreaterThan(60)
  expect(slid).toBeLessThan(90)
  await page.keyboard.press('Control+z')
  await expect(typed).toHaveValue('0')
})
