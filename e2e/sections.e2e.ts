import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, failOnErrors, openEditor, pickIn, recordSaves, startWith } from './support'

/*
 * A tall unit made of sections: edited as a list in Properties, and by the lines between its
 * sections where an elevation draws it.
 */
failOnErrors()

/** A wall along the top, a tall unit against it with no sections of its own, and an elevation of the wall drawn below the plan, its floor at y = 4000. */
const plan = drawing(
  {
    n: { id: 'n', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200 },
    t: { id: 't', type: 'parametric', parent: 'page_1', order: 'a2', kind: 'arch.tallunit', props: {}, x: 3000, y: 100 },
    v: { id: 'v', type: 'viewline', parent: 'page_1', order: 'a3', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000 },
    vv: { id: 'vv', type: 'elevation', parent: 'page_1', order: 'a4', line: 'v', x: 100, y: 4000 },
  },
  { version: 3 },
)

/** The sections of the tall unit as the drawing is saved. */
async function savedSections(page: Page): Promise<{ type: string; height: number }[]> {
  const before = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(before + 1)
  return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1))).nodes.t.props.sections
}

test('a tall unit’s sections are a list in Properties, as they stand: its Contents first, then each changed, one added on top and dragged into place', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'kitchen.opencalque', plan)
  const onScreen = await drawingOnScreen(page)
  await page.mouse.click(...onScreen(3300, 400))
  const list = page.locator('.list-field')
  const rows = list.locator('.list-row')
  const input = (row: number, name: string) => rows.nth(row).locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  // Those its Contents says, the top one first: a door as high as the others leave, the microwave, the oven, a door.
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0).locator('.select')).toHaveText('Door')
  await expect(input(0, 'Height')).toHaveValue('315')
  await expect(rows.nth(1).locator('.select')).toHaveText('Microwave')
  const contents = page.locator('.field', { has: page.locator('span:text-is("Contents")') })
  await expect(contents).toHaveCount(1)
  // The bottom one made a drawer 72 cm high: they are its own now, and Contents goes.
  await pickIn(page, rows.nth(3).locator('.select'), 'Drawer')
  await expect(contents).toHaveCount(0)
  // Chosen, it is made a drawer's usual height, then the height typed.
  await expect(input(3, 'Height')).toHaveValue('240')
  await input(3, 'Height').fill('720')
  await input(3, 'Height').press('Enter')
  // One added, on top; made an open niche 280 high.
  await list.getByRole('button', { name: 'Add a section' }).click()
  await expect(rows).toHaveCount(5)
  await pickIn(page, rows.nth(0).locator('.select'), 'Open')
  await expect(input(0, 'Height')).toHaveValue('380')
  await input(0, 'Height').fill('280')
  await input(0, 'Height').press('Enter')
  // Dragged by its grip onto the lower half of the microwave: it goes under it, over the oven.
  const [grip, target] = [(await rows.nth(0).locator('.list-grip').boundingBox())!, (await rows.nth(2).boundingBox())!]
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 10, { steps: 3 })
  await page.mouse.move(target.x + 40, target.y + target.height * 0.8, { steps: 5 })
  await page.mouse.up()
  await expect(rows.nth(2).locator('.select')).toHaveText('Open')
  // As high as its sections, its height shown, not typed; a filler is not one of the choices.
  const height = page.locator('.field-pair', { has: page.locator('.field-pair-name:text-is("W, D, H")') }).locator('input').nth(2)
  await expect(height).toHaveValue('2400')
  await expect(height).toHaveAttribute('readonly', '')
  await rows.nth(1).locator('.select').click()
  await expect(page.getByRole('listbox').getByRole('option', { name: 'Filler', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // The link under the list puts a filler on top: the unit goes up to the ceiling (2500), the filler as high as what the others leave.
  const filler = list.getByRole('button', { name: 'Add a full-height filler' })
  await filler.click()
  await expect(filler).toHaveCount(0)
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(0).locator('.list-fixed')).toHaveText('Filler')
  await expect(rows.nth(0).locator('.list-auto')).toHaveText('100 mm')
  await expect(height).toHaveValue('2500')
  expect(await savedSections(page)).toEqual([
    { type: 'Drawer', height: 720 },
    { type: 'Oven', height: 595 },
    { type: 'Open', height: 280 },
    { type: 'Microwave', height: 390 },
    { type: 'Door', height: 315 },
    { type: 'Filler', height: 720 },
  ])
  // Taken out by its cross, the link comes back.
  await rows.nth(0).getByRole('button', { name: 'Remove' }).click()
  await expect(filler).toBeVisible()
  await expect(rows).toHaveCount(5)
})

test('the line between two sections of a tall unit is dragged up and down in an elevation', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await choose(page, () => page.keyboard.press('Control+o'), 'kitchen.opencalque', plan)
  const onScreen = await drawingOnScreen(page)
  await page.mouse.click(...onScreen(3300, 400))
  // The elevation draws it from x = 3000 to 3600; the line over its lower doors at 850 above the floor.
  await page.mouse.move(...onScreen(3300, 4000 - 850))
  await expect(canvas(page)).toHaveCSS('cursor', 'row-resize')
  await expect(page.locator('.status')).toContainText('Drag the line up or down')
  await page.mouse.down()
  await page.mouse.move(...onScreen(3300, 4000 - 1050), { steps: 5 })
  await page.mouse.up()
  // Taken up 200 mm, by whole steps of the grid: the doors under it 950, the oven over it 395, its top where it was.
  expect((await savedSections(page)).map((row) => row.height)).toEqual([950, 395, 390, 315])
})
