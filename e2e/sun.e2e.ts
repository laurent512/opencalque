import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, failOnErrors, objectRows, openEditor, pickIn, recordSaves, startWith } from './support'

/*
 * The sun (ARCHITECTURE, "The sun"): put down with its tool beside a plan, set to a day and an hour
 * in Properties, the shade it casts drawn on the plan, and a viewpoint lit by it.
 */

failOnErrors()
// Where the computer is says where the building is first taken to be.
test.use({ timezoneId: 'Europe/Paris' })

type Saved = { type: string; [key: string]: any }

async function saved(page: Page): Promise<{ nodes: Saved[]; settings: any; page: any }> {
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  const nodes = Object.values(doc.nodes as Record<string, Saved>)
  return { nodes: nodes.filter((node) => node.type !== 'page'), settings: doc.settings, page: nodes.find((node) => node.type === 'page') }
}

/** How many pixels of the canvas, in a box of the drawing, are of the shade's grey-blue over white. */
const shaded = (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) =>
  page.evaluate(
    ([from, to]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')!
      const box = canvas.getBoundingClientRect()
      const scale = canvas.width / box.width
      const [x, y] = [(Math.min(from.x, to.x) - box.x) * scale, (Math.min(from.y, to.y) - box.y) * scale]
      const [w, h] = [Math.abs(to.x - from.x) * scale, Math.abs(to.y - from.y) * scale]
      const data = canvas.getContext('2d')!.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        if (b - r >= 4 && r > 170 && r < 235) count++
      }
      return count
    },
    [from, to] as const,
  )

test('puts down a sun beside a plan, sets its day and hour, shades the plan and lights a view', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // A blank drawing: 0.1 px per mm, its origin 320 across and 220 down.
  const at = (x: number, y: number) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
  // A room 4 m by 3 m, put in by itself once its walls close.
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await page.mouse.click(at(x, y).x, at(x, y).y)
  await page.keyboard.press('Escape')

  await page.keyboard.press('Shift+S')
  await expect(page.locator('.hint-bar')).toContainText('Click where the circle of the sky goes')
  // On the left of the plan, in sight: the shade falls on the other side at the hours tried here.
  await page.mouse.move(at(-2500, 1500).x, at(-2500, 1500).y)
  await page.mouse.click(at(-2500, 1500).x, at(-2500, 1500).y)
  // Put down once and selected, the tool back to selecting; the building taken to be where the computer's clocks are.
  await expect(objectRows(page).filter({ hasText: /^Sun / })).toHaveClass(/selected/)
  let drawn = await saved(page)
  expect(drawn.nodes.find((n) => n.type === 'sun')).toMatchObject({ x: -2500, y: 1500, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: expect.stringMatching(/^\d{2}:\d{2}$/) })
  expect(drawn.settings.site).toEqual({ latitude: 48.867, longitude: 2.333, timeZone: 'Europe/Paris' })

  // Set in Properties to a summer afternoon.
  const panel = page.locator('[data-panel="properties"]')
  const field = (name: string) => panel.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await field('Day').fill('2026-06-21')
  await field('Day').press('Enter')
  await field('Hour').fill('16h30')
  await field('Hour').press('Enter')
  await expect(field('Hour')).toHaveValue('16:30')
  await expect(panel).toContainText(/The sun is \d+° above the horizon, 2\d\d° from north\./)
  // A day that is not one is put back as it was.
  await field('Day').fill('2026-02-30')
  await field('Day').press('Enter')
  await expect(field('Day')).toHaveValue('2026-06-21')
  drawn = await saved(page)
  expect(drawn.nodes.find((n) => n.type === 'sun')).toMatchObject({ date: '2026-06-21', time: '16:30' })
  // Its shade under a heading of its own: drawn or not, and its colours.
  await expect(panel).toContainText('Sunlit floors')
  await panel.screenshot({ path: 'test-results/sun-properties.png' })
  // Its shade twice as long, which it says, and its words larger, in Properties.
  await field('Shade length').fill('200')
  await field('Shade length').press('Enter')
  await expect(panel).toContainText("Its shade is 200% as long as the real sun's at that hour.")
  await field('Text size').fill('300')
  await field('Text size').press('Enter')
  expect((await saved(page)).nodes.find((n) => n.type === 'sun')).toMatchObject({ reach: 2, size: 300 })
  await field('Shade length').fill('100')
  await field('Shade length').press('Enter')
  expect((await saved(page)).nodes.find((n) => n.type === 'sun').reach).toBeUndefined()
  // The time zones, a long list, no taller than 360 pixels, found by what is typed in the box at their top.
  const zones = panel.locator('.field', { has: page.locator('span:text-is("Time zone")') }).locator('.select')
  await zones.click()
  const list = page.locator('.select-list')
  await expect(page.locator('.select-search')).toBeFocused()
  // Against its field, under it or, with no room there, over it, as a short list is.
  const [shown, under] = [(await list.boundingBox())!, (await zones.boundingBox())!]
  expect(shown.height).toBeLessThanOrEqual(361)
  expect(Math.min(Math.abs(shown.y - (under.y + under.height)), Math.abs(shown.y + shown.height - under.y))).toBeLessThan(10)
  await page.keyboard.type('toky')
  await expect(list.getByRole('option')).toHaveCount(1)
  // Where it was, against its field, with one option left in it.
  expect(await list.boundingBox()).toMatchObject({ x: shown.x, y: shown.y, height: shown.height })
  await page.screenshot({ path: 'test-results/sun-zones.png' })
  await page.keyboard.press('Enter')
  await expect(zones).toHaveText('Tokyo')
  expect((await saved(page)).settings.site.timeZone).toBe('Asia/Tokyo')
  await zones.click()
  await page.keyboard.type('nowhere at all')
  await expect(list).toContainText('Nothing matches')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await pickIn(page, zones, 'Paris')
  // The hour dragged with Alt, ten pixels to the right: fifty minutes later, as one step to undo.
  const hour = (await field('Hour').boundingBox())!
  await page.keyboard.down('Alt')
  await page.mouse.move(hour.x + 20, hour.y + hour.height / 2)
  await page.mouse.down()
  await page.mouse.move(hour.x + 30, hour.y + hour.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await expect(field('Hour')).toHaveValue('17:20')
  await page.keyboard.press('Control+z')
  await expect(field('Hour')).toHaveValue('16:30')

  // In the south-west, the sun casts the building's shade to the north-east of it, not to the south-west.
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await expect.poll(() => shaded(page, at(4300, -1800), at(5500, -300))).toBeGreaterThan(40)
  expect(await shaded(page, at(-1500, 3300), at(-300, 4500))).toBeLessThan(10)
  await page.screenshot({ path: 'test-results/sun-plan.png' })

  // North turned to the right on the page: the shade goes round with it, to the south-east.
  await objectRows(page).filter({ hasText: /^Sun / }).click()
  await field('North').fill('90')
  await field('North').press('Enter')
  expect((await saved(page)).page.north).toBe(90)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await expect.poll(() => shaded(page, at(4300, 3300), at(5500, 4500))).toBeGreaterThan(40)
  await page.screenshot({ path: 'test-results/sun-plan-turned.png' })

  // A viewpoint in the room is lit by it, which its Properties say.
  await page.keyboard.press('Shift+P')
  await page.mouse.click(at(500, 2500).x, at(500, 2500).y)
  await page.mouse.click(at(3500, 500).x, at(3500, 500).y)
  await expect(panel.locator('.field', { has: page.locator('span:text-is("Lit by")') }).locator('.select')).toHaveText('Sun 16:30, 2026-06-21')
  const rendering = panel.locator('.field', { has: page.locator('span:text-is("Rendering")') }).locator('.select')
  await pickIn(page, rendering, 'Shaded')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'test-results/sun-view.png' })
})

/** How many pixels of the canvas, in a box of the drawing, are of the sunlit yellow over a room's floor. */
const sunlit = (page: Page, from: [number, number], to: [number, number]) =>
  page.evaluate(
    ([from, to]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')!
      const box = canvas.getBoundingClientRect()
      const scale = canvas.width / box.width
      const [x, y] = [(Math.min(from[0], to[0]) - box.x) * scale, (Math.min(from[1], to[1]) - box.y) * scale]
      const [w, h] = [Math.abs(to[0] - from[0]) * scale, Math.abs(to[1] - from[1]) * scale]
      const data = canvas.getContext('2d')!.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i] - data[i + 2] > 40) count++
      return count
    },
    [from, to] as const,
  )

test('lights the floor of a room through its window, on the plan and in a view', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, height: 2600 })
  // A room 4 m by 3 m with a window 1.2 m wide in its south wall, at an equinox early in the afternoon.
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      win: { id: 'win', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a5', kind: 'arch.window', props: { width: 1200 }, x: 2600, y: 3000, rotation: 180 },
      r: { id: 'r', type: 'room', parent: 'page_1', layer: 'layer_1', order: 'a6', name: 'Living', x: 2000, y: 1500 },
      sun: { id: 'sun', type: 'sun', parent: 'page_1', layer: 'layer_1', order: 'a7', x: -2500, y: 1500, date: '2026-03-20', time: '13:30' },
      chair: { id: 'chair', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a8', kind: 'arch.armchair', props: {}, x: 1500, y: 1300 },
    },
    { version: 8, settings: { site: { latitude: 48.857, longitude: 2.352, timeZone: 'Europe/Paris' } } },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  // The sun high in the south: a patch on the floor north of the window, as wide, inside the room.
  await expect.poll(() => sunlit(page, at(1500, 400), at(2700, 2800))).toBeGreaterThan(100)
  expect(await sunlit(page, at(200, 200), at(1200, 1000))).toBeLessThan(10)
  await page.screenshot({ path: 'test-results/sun-window-plan.png' })

  // A viewpoint by the north wall looking at the window: lit by the sun, shaded.
  await page.keyboard.press('Shift+P')
  await page.mouse.click(...at(1700, 500))
  await page.mouse.click(...at(2000, 2500))
  const panel = page.locator('[data-panel="properties"]')
  await pickIn(page, panel.locator('.field', { has: page.locator('span:text-is("Rendering")') }).locator('.select'), 'Shaded')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test-results/sun-window-view.png' })
  await pickIn(page, panel.locator('.field', { has: page.locator('span:text-is("Rendering")') }).locator('.select'), 'Lines')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test-results/sun-window-lines.png' })
  // Looking down, the patch of sun on the floor.
  const tilt = panel.locator('.field', { has: page.locator('span:text-is("Tilt")') }).locator('input')
  await tilt.fill('-40')
  await tilt.press('Enter')
  await pickIn(page, panel.locator('.field', { has: page.locator('span:text-is("Rendering")') }).locator('.select'), 'Shaded')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test-results/sun-window-down.png' })
})
