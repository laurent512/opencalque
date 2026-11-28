import { expect, test, type Page } from '@playwright/test'
import { canvas, failOnErrors, openEditor, pickIn, recordSaves, startWith } from './support'

/**
 * A text typed in place with its words set apart (rich text): the keys and the format bar over
 * the words, with what they made read back from the drawing as it is saved. A blank drawing
 * opens at 0.1 pixel per millimetre with its origin 320 pixels across and 220 down the canvas.
 */

failOnErrors()

type Saved = { type: string; [key: string]: any }

async function blank(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  await startWith(page, {})
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  return (x, y) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
}

/** The one text of the drawing, as saved now. */
async function savedText(page: Page): Promise<Saved> {
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  return Object.values(doc.nodes as Record<string, Saved>).find((node) => node.type === 'text')!
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Text format' })

async function selectBack(page: Page, letters: number) {
  for (let i = 0; i < letters; i++) await page.keyboard.press('Shift+ArrowLeft')
}

test('sets words apart with the keys and the bar, and types on in the style of the letter before', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await page.mouse.click(at(0, 0).x, at(0, 0).y)
  await expect(bar(page)).toBeVisible()
  await page.keyboard.type('Hello world')
  // "world" bold, from the keyboard.
  await selectBack(page, 5)
  await page.keyboard.press('Control+b')
  await expect(bar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
  // Typed after it, bold too.
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  // "Hello" larger and in italics, from the bar, which keeps the words selected.
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  await bar(page).getByRole('button', { name: 'Larger text' }).click()
  await bar(page).getByRole('button', { name: 'Italic' }).click()
  await expect(page.locator('.text-editor.rich')).toBeFocused()
  // A new line, centred with the bar.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await bar(page).getByRole('button', { name: 'Centred' }).click()
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  expect(await savedText(page)).toMatchObject({
    text: 'Hello world!\ntwo',
    align: 'center',
    // The new line goes on in bold, as in a word processor: it was started after bold words.
    spans: [
      { from: 0, to: 5, italic: true, scale: 1.25 },
      { from: 6, to: 16, bold: true },
    ],
  })
})

test('undoes what was typed step by step while typing, and edits a text again with its words set apart', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await page.mouse.click(at(0, 0).x, at(0, 0).y)
  await page.keyboard.type('abc def')
  await selectBack(page, 3)
  await page.keyboard.press('Control+u')
  await page.keyboard.press('Control+z')
  // The underline undone, the words kept.
  await page.keyboard.press('Control+Shift+X')
  await page.keyboard.press('Escape')
  expect(await savedText(page)).toMatchObject({ text: 'abc def', spans: [{ from: 4, to: 7, strike: true }] })
  // Edited again: the words come back set apart, and what is deleted takes its style with it.
  await page.mouse.dblclick(at(150, -50).x, at(150, -50).y)
  await expect(page.locator('.text-editor.rich span').nth(1)).toHaveText('def')
  await page.keyboard.press('End')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await page.keyboard.type('xyz')
  await page.keyboard.press('Escape')
  const text = await savedText(page)
  expect(text.text).toBe('abc xyz')
  expect(text.spans).toBeUndefined()
})

test('writes a field where the caret is, from the bar', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await page.mouse.click(at(0, 0).x, at(0, 0).y)
  await page.keyboard.type('Plan of  floor')
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
  await pickIn(page, bar(page).locator('.text-format-field'), 'Name of the page')
  await expect(page.locator('.text-editor.rich')).toBeFocused()
  await page.keyboard.type('!')
  await page.keyboard.press('Escape')
  expect((await savedText(page)).text).toBe('Plan of {page}! floor')
  // The Properties panel no longer has what the bar does.
  await expect(page.locator('.field', { has: page.locator('span:text-is("Bold")') })).toHaveCount(0)
})

test('goes back through the typing a word at a time with Ctrl+Z, and forward with Ctrl+Y, what the bar set for the whole text included', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await page.mouse.click(at(0, 0).x, at(0, 0).y)
  const words = page.locator('.text-editor.rich')
  await page.keyboard.type('Chambre parentale')
  await page.keyboard.press('Control+z')
  await expect(words).toHaveText('Chambre ')
  await page.keyboard.press('Control+z')
  await expect(words).toHaveText('Chambre')
  await page.keyboard.press('Control+y')
  await expect(words).toHaveText('Chambre ')
  await page.keyboard.press('Control+Shift+z')
  await expect(words).toHaveText('Chambre parentale')
  // Centred from the bar, then back.
  await bar(page).getByRole('button', { name: 'Centred' }).click()
  await expect(bar(page).getByRole('button', { name: 'Centred' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+z')
  await expect(bar(page).getByRole('button', { name: 'Left' })).toHaveAttribute('aria-pressed', 'true')
  await expect(words).toHaveText('Chambre parentale')
  await page.keyboard.press('Escape')
  const text = await savedText(page)
  expect(text.text).toBe('Chambre parentale')
  expect(text.align).toBeUndefined()
})

test('shows the font and the field to insert as pictures, and colours the whole text when every word is selected', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await page.mouse.click(at(0, 0).x, at(0, 0).y)
  await page.keyboard.type('Salon cuisine')
  // The font by letters written in it, named when the pointer rests there; the field by an icon.
  const font = bar(page).locator('.text-format-font')
  await expect(font.locator('.font-sample')).toHaveText('Ag')
  await expect(bar(page).locator('.text-format-field .select-picture svg')).toBeVisible()
  await expect(bar(page)).not.toContainText('field')
  await pickIn(page, font, 'Serif')
  await expect(page.locator('.text-editor.rich')).toBeFocused()
  // Some words selected: their colour, with no layer's to follow.
  await selectBack(page, 7)
  const colour = bar(page).locator('.text-format-color')
  await expect(colour).toHaveAttribute('title', 'Colour of the selected words')
  // Every word: the text's own, which can follow its layer, as Properties set it before.
  await page.keyboard.press('Control+a')
  await expect(colour).toHaveAttribute('title', 'Colour of the text')
  await colour.click()
  await expect(page.locator('.color-menu .color-option', { hasText: 'Colour of the layer' })).toBeVisible()
  const code = page.locator('.color-menu input[aria-label="Colour code"]')
  await code.fill('#cc2200')
  await code.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator('.text-editor.rich')).toBeFocused()
  await page.keyboard.press('Escape')
  const text = await savedText(page)
  expect(text).toMatchObject({ text: 'Salon cuisine', font: 'serif', style: { stroke: '#cc2200' } })
  expect(text.spans).toBeUndefined()
  // Neither its colour nor its words are in the Properties panel: they are set where the text is, its colour in the bar.
  await expect(page.locator('[data-panel="properties"] .field', { has: page.locator('span:text-is("Color")') })).toHaveCount(0)
  await expect(page.locator('[data-panel="properties"] .field', { has: page.locator('span:text-is("Text")') })).toHaveCount(0)
})
