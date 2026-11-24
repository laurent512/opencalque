import { expect, test } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, failOnErrors, objectRows, openEditor, recordSaves, startWith } from './support'

/** The flip controls of a selected door: clicked, it opens to the other side of its wall, or changes hinge. */

failOnErrors()

test('a door turns over from the arrows shown with it, each click one step of undo', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing({
    w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Wall', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
    d: { id: 'd', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a2', kind: 'arch.door', props: { width: 900 }, x: 2000, y: 0 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  await objectRows(page).filter({ hasText: 'Door' }).click()
  // It opens down the screen: its arrows stand above the wall, over its middle (x 2450).
  const [x, face] = at(2450, -100)
  await page.mouse.move(x, face - 35)
  await expect(page.locator('.status')).toContainText('Click to open it to the other side of its wall')
  await canvas(page).screenshot({ path: test.info().outputPath('door-arrows.png') })
  await page.mouse.click(x, face - 35)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  expect(JSON.parse(await page.evaluate(() => (window as any).saves[0])).nodes.d.props).toMatchObject({ flip: true })
  // Opening up the screen now, its arrows went below the wall: the one along it changes hinge.
  const [, below] = at(2450, 100)
  await canvas(page).screenshot({ path: test.info().outputPath('door-flipped.png') })
  await page.mouse.click(x, below + 64)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(2)
  expect(JSON.parse(await page.evaluate(() => (window as any).saves[1])).nodes.d.props).toMatchObject({ flip: true, hinge: 'Right' })
  // Two clicks, two steps of undo.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(3)
  expect(JSON.parse(await page.evaluate(() => (window as any).saves[2])).nodes.d.props).toEqual({ width: 900 })
})
