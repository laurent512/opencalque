import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, failOnErrors, openEditor, pickIn, recordSaves, startWith } from './support'

/**
 * Settings saved for the wall, door and window tools, picked before drawing, as people use them.
 * What a test checks is read back from the saved drawing.
 */

failOnErrors()

/** The drawing as it was saved last. */
async function saved(page: Page) {
  const before = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(before + 1)
  return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
}

const properties = (page: Page) => page.locator('[data-panel="properties"]')
const field = (page: Page, name: string) => properties(page).locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input').first()
const list = (page: Page) => properties(page).locator('button[aria-label="Saved settings"]')

async function saveAs(page: Page, name: string) {
  await properties(page).getByRole('textbox', { name: 'Name of the settings to save' }).fill(name)
  await properties(page).getByRole('button', { name: 'Save', exact: true }).click()
}

test('the wall tool keeps its settings under a name, and draws with them again once they are picked', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await page.keyboard.press('w')
  await expect(list(page)).toBeDisabled()
  await field(page, 'Thickness').fill('365')
  await field(page, 'Thickness').press('Enter')
  await saveAs(page, 'Outer wall')
  // Chosen, as it holds what the tool is set to; the bar above the tools lists it too.
  await expect(list(page)).toHaveText('Outer wall')
  await expect(page.locator('.quickbar button[aria-label="Saved settings"]')).toHaveText('Outer wall')
  await field(page, 'Thickness').fill('115')
  await field(page, 'Thickness').press('Enter')
  await saveAs(page, 'Partition')
  await pickIn(page, list(page), 'Outer wall')
  await expect(field(page, 'Thickness')).toHaveValue('365')
  await page.screenshot({ path: test.info().outputPath('wall-tool.png') })
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 700, box.y + 300)
  await page.keyboard.press('Escape')
  const doc = await saved(page)
  expect(Object.values(doc.nodes).filter((n: any) => n.type === 'wall').map((n: any) => n.thickness)).toEqual([365])
  expect(Object.values(doc.presets).map((p: any) => [p.name, p.of, p.thickness])).toEqual([
    ['Outer wall', 'wall', 365],
    ['Partition', 'wall', 115],
  ])
})

test('a door is set up before it is placed, and its settings are saved and picked as a wall’s', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 } }))
  const at = await drawingOnScreen(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Place: Door')
  await page.keyboard.press('Enter')
  await expect(properties(page)).toContainText('Saved settings')
  await field(page, 'Width').fill('1000')
  await field(page, 'Width').press('Enter')
  await saveAs(page, 'Wide door')
  await expect(list(page)).toHaveText('Wide door')
  await properties(page).screenshot({ path: test.info().outputPath('door-tool.png') })
  // Placed on the wall with what was set; the next one too.
  const [x, y] = at(2000, 0)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  const doc = await saved(page)
  const doors = Object.values(doc.nodes).filter((n: any) => n.type === 'parametric' && n.kind === 'arch.door') as any[]
  expect(doors.map((door) => door.props.width)).toEqual([1000])
  expect(Object.values(doc.presets).map((p: any) => [p.name, p.of, p.props])).toEqual([['Wide door', 'arch.door', { width: 1000 }]])
})
