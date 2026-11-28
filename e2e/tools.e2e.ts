import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, drawWall, failOnErrors, objectRows, openEditor, pickIn, recordSaves, startWith } from './support'

/**
 * Each tool of the canvas, and each drag of the select tool, used as a person would, with what it
 * made read back from the drawing as it is saved. A blank drawing opens at 0.1 pixel per
 * millimetre with its origin 320 pixels across and 220 down the canvas, and its grid of 100 mm
 * falls on every tenth pixel from there, which is where these tests click.
 */

failOnErrors()

type Saved = { type: string; [key: string]: any }

/** Where a point of a blank drawing is on the page. */
async function blank(page: Page, prefs: Record<string, unknown> = {}): Promise<(x: number, y: number) => { x: number; y: number }> {
  await startWith(page, prefs)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  return (x, y) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
}

const click = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y)

/** Drags from one point to another, slowly enough to count as a drag rather than a click whose hand slipped. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.waitForTimeout(250)
  await page.mouse.up()
}

/** What the drawing holds, as saved now. */
async function saved(page: Page): Promise<Saved[]> {
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  return Object.values(doc.nodes as Record<string, Saved>).filter((node) => node.type !== 'page')
}

const status = (page: Page) => page.locator('.status span')

test('draws a line, and a closed shape by coming back to its first point, with the line tool', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  await page.keyboard.press('Escape')
  await click(page, at(0, 2000))
  await click(page, at(1000, 2000))
  await click(page, at(1000, 3000))
  await click(page, at(0, 2000))
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'line')).toEqual([expect.objectContaining({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } })])
  expect(nodes.filter((n) => n.type === 'polyline')).toEqual([
    expect.objectContaining({
      closed: true,
      points: [
        { x: 0, y: 2000 },
        { x: 1000, y: 2000 },
        { x: 1000, y: 3000 },
      ],
    }),
  ])
})

test('lines a wall up with a point the pointer rested on, and not with every point drawn', async ({ page }) => {
  const at = await blank(page)
  const move = (p: { x: number; y: number }) => page.mouse.move(p.x, p.y, { steps: 4 })
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await page.keyboard.press('Escape')
  // Rested on the end of that wall, then away: a wall started a little below level with it starts level with it.
  await move(at(2000, 0))
  await page.waitForTimeout(400)
  await move(at(2600, 600))
  await move(at(4000, 60))
  await click(page, at(4000, 60))
  await click(page, at(4000, 2000))
  await page.keyboard.press('Escape')
  // Rested on nothing: as far below level with the first wall, it goes by the grid.
  await move(at(-2000, 60))
  await click(page, at(-2000, 60))
  await click(page, at(-2000, 2000))
  await page.keyboard.press('Escape')
  const starts = (await saved(page)).filter((n) => n.type === 'wall').map((n) => n.a)
  expect(starts).toEqual([
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: -2000, y: 100 },
  ])
})

test('closes a run of walls back to where it started with a double-click on its last corner', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(3000, 0))
  await click(page, at(3000, 2000))
  await page.mouse.dblclick(at(3000, 2000).x, at(3000, 2000).y)
  await page.keyboard.press('Escape')
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls).toHaveLength(3)
  expect(walls).toContainEqual(expect.objectContaining({ a: { x: 3000, y: 2000 }, b: { x: 0, y: 0 } }))
})

test('draws a rectangle by dragging and an ellipse by two clicks', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await drag(page, at(0, 0), at(2000, 1000))
  await page.keyboard.press('o')
  // Under it: further right, a narrow canvas has the view bar standing against its edge.
  await click(page, at(0, 1500))
  await click(page, at(2000, 2500))
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'rect')).toMatchObject({ x: 0, y: 0, width: 2000, height: 1000 })
  expect(nodes.find((n) => n.type === 'ellipse')).toMatchObject({ cx: 1000, cy: 2000, rx: 1000, ry: 500 })
})

test('writes a text where it is clicked, and a note with a leader to what it is about', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await click(page, at(0, 0))
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+T')
  await click(page, at(2000, 0))
  await click(page, at(3000, -1000))
  await page.keyboard.type('Note')
  await page.keyboard.press('Escape')
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'text')).toMatchObject({ x: 0, y: 0, text: 'Hello' })
  expect(nodes.find((n) => n.type === 'annotation')).toMatchObject({ a: { x: 2000, y: 0 }, b: { x: 3000, y: -1000 }, text: 'Note' })
})

test('draws grid lines by two clicks, each labelled after the one before', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('g')
  await click(page, at(0, 0))
  await click(page, at(0, 4000))
  await click(page, at(3000, 0))
  await click(page, at(3000, 4000))
  const lines = (await saved(page)).filter((n) => n.type === 'gridline')
  expect(lines).toHaveLength(2)
  expect(lines.find((n) => n.label === 'A')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 0, y: 4000 }, style: { dash: [9, 3, 1.5, 3] } })
  expect(lines.find((n) => n.label === 'B')).toMatchObject({ a: { x: 3000, y: 0 }, b: { x: 3000, y: 4000 } })
})

test('changes the label of a grid line by double-clicking its bubble', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('g')
  await click(page, at(0, 0))
  await click(page, at(0, 4000))
  await page.keyboard.press('v')
  // The bubble of 800 mm sits above the start of the line, its middle 400 mm up.
  await page.mouse.dblclick(at(0, -400).x, at(0, -400).y)
  await page.keyboard.type('X1')
  await page.keyboard.press('Enter')
  expect((await saved(page)).find((n) => n.type === 'gridline')).toMatchObject({ label: 'X1' })
})

test('lays a paper at a standard format by pulling towards its corner', async ({ page }) => {
  await blank(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('f')
  // The first corner, at the origin, stays where it is while the view steps back until an A3 fits half its width.
  await page.mouse.click(box.x + 320, box.y + 220)
  const zoom = (0.5 * box.width) / 42000
  await page.mouse.move(box.x + 320 + 42000 * zoom, box.y + 220 + 29700 * zoom, { steps: 5 })
  await page.mouse.click(box.x + 320 + 42000 * zoom, box.y + 220 + 29700 * zoom)
  expect((await saved(page)).find((n) => n.type === 'paper')).toMatchObject({ x: 0, y: 0, width: 42000, height: 29700, scale: 100 })
})

test('lays a US sheet once the ARCH sizes are chosen, and gives a paper an ANSI one in its properties', async ({ page }) => {
  await blank(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('f')
  // Only the ARCH sheets are offered once chosen; an ARCH B lying is 18 × 12 inches, 45720 × 30480 at 1:100.
  await pickIn(page, page.getByRole('combobox', { name: 'Sheet sizes' }), 'ARCH')
  await page.mouse.click(box.x + 320, box.y + 220)
  const zoom = (0.5 * box.width) / 42000
  const corner = { x: box.x + 320 + 45720 * zoom, y: box.y + 220 + 30480 * zoom }
  await page.mouse.move(corner.x, corner.y, { steps: 5 })
  await page.mouse.click(corner.x, corner.y)
  const paper = (await saved(page)).find((n) => n.type === 'paper')!
  expect([paper.width, paper.height, paper.scale].map(Math.round)).toEqual([45720, 30480, 100])
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('opencalque.prefs')))!)).toMatchObject({ paperSeries: 'ARCH' })

  // In its properties, the formats are listed by series, and an ANSI D keeps the sheet lying, about its middle.
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: paper.name }).click()
  const format = page.locator('.field', { has: page.locator('span:text-is("Format")') }).locator('.select')
  await expect(format).toHaveText('ARCH B')
  await format.click()
  const list = page.getByRole('listbox')
  await expect(list.locator('.select-group')).toHaveText(['ISO', 'ARCH', 'ANSI'])
  await expect(list.getByRole('group', { name: 'ARCH' }).getByRole('option')).toHaveText(['ARCH A', 'ARCH B', 'ARCH C', 'ARCH D', 'ARCH E1', 'ARCH E'])
  await list.getByRole('option', { name: 'ANSI D', exact: true }).click()
  const resized = (await saved(page)).find((n) => n.type === 'paper')!
  expect([resized.width, resized.height].map(Math.round)).toEqual([86360, 55880])
})

test('lays the title blocks of a drawing down the right edge from its settings, with captions, each sheet with its revisions', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing({
    sheet: { id: 'sheet', type: 'paper', parent: 'page_1', layer: 'layer_1', order: 'a1', name: 'Floor plan', x: 0, y: 0, width: 42000, height: 29700, scale: 100, titleBlock: { number: 'A-101' } },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await objectRows(page).filter({ hasText: 'Floor plan' }).click()
  await expect(page.locator('.title-entry', { hasText: 'Revisions' })).toHaveCount(0)
  const settings = async () => {
    await page.keyboard.press('Control+k')
    // The palette keeps its last search: replace it.
    await page.getByPlaceholder('Type a command…').fill('Drawing settings')
    await page.keyboard.press('Enter')
    return page.getByRole('dialog', { name: 'Drawing settings' })
  }
  const lastSettings = async () => {
    await saved(page)
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1))).settings
  }
  let dialog = await settings()
  const layout = dialog.locator('.pref-field', { hasText: 'Title block' }).locator('.select')
  await expect(layout).toHaveText('In the bottom right corner')
  await pickIn(page, layout, 'Down the right edge, with captions')
  await dialog.getByRole('button', { name: 'Done' }).click()
  // The captions are written with the drawing, in the language of the app; the sheet is left as it was.
  expect(await lastSettings()).toMatchObject({ titleBlock: { layout: 'strip', labels: { sheet: 'Sheet title', author: 'Drawn by', number: 'Sheet no.' } } })
  // Each sheet types its own revisions.
  await objectRows(page).filter({ hasText: 'Floor plan' }).click()
  const revisions = page.locator('.title-entry', { hasText: 'Revisions' }).locator('textarea')
  await revisions.fill('1 | 2026-11-17 | Issued for permit')
  await revisions.blur()
  expect((await saved(page)).find((n) => n.type === 'paper')!.titleBlock).toEqual({ number: 'A-101', revisions: '1 | 2026-11-17 | Issued for permit' })
  // Back in the corner, the drawing goes without its captions, and the sheet keeps what was typed.
  dialog = await settings()
  await pickIn(page, dialog.locator('.pref-field', { hasText: 'Title block' }).locator('.select'), 'In the bottom right corner')
  await dialog.getByRole('button', { name: 'Done' }).click()
  expect(await lastSettings()).toBeUndefined()
  expect((await saved(page)).find((n) => n.type === 'paper')!.titleBlock).toEqual({ number: 'A-101', revisions: '1 | 2026-11-17 | Issued for permit' })
})

test('draws on the grid set in the drawing settings, every 455 mm for the Japanese module, and back on the one that follows the zoom', async ({ page }) => {
  const at = await blank(page)
  const settings = async () => {
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Type a command…').fill('Drawing settings')
    await page.keyboard.press('Enter')
    return page.getByRole('dialog', { name: 'Drawing settings' })
  }
  const lastSettings = async () => {
    await saved(page)
    return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1))).settings
  }
  let dialog = await settings()
  const spacing = dialog.locator('.pref-field', { hasText: 'Spacing' }).locator('.select')
  await expect(spacing).toHaveText('Changes with the zoom')
  await pickIn(page, spacing, 'Always the same')
  const main = dialog.locator('.pref-field', { hasText: 'Main lines every' }).locator('input')
  await main.fill('910')
  await main.press('Enter')
  const parts = dialog.locator('.pref-field', { hasText: 'Divided into' }).locator('input')
  await parts.fill('2')
  await parts.press('Enter')
  await expect(dialog.locator('.hint', { hasText: 'Finer lines every 455 mm' })).toBeVisible()
  // Neither a length of nothing nor a count of none is taken.
  await main.fill('0')
  await main.press('Enter')
  await expect(main).toHaveValue('910 mm')
  await dialog.getByRole('button', { name: 'Done' }).click()
  expect(await lastSettings()).toEqual({ grid: { spacing: 910, divisions: 2 } })
  // A line ends on the nearest line of the grid: 910 mm along, not the 1000 mm pointed at.
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(1000, 30))
  await page.keyboard.press('Escape')
  expect((await saved(page)).find((n) => n.type === 'line')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 910, y: 0 } })
  // Following the zoom again, the drawing keeps nothing of it.
  dialog = await settings()
  await pickIn(page, dialog.locator('.pref-field', { hasText: 'Spacing' }).locator('.select'), 'Changes with the zoom')
  await expect(dialog.locator('.pref-field', { hasText: 'Main lines every' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Done' }).click()
  expect(await lastSettings()).toBeUndefined()
})

test('names the rooms that closed walls make, and splits one with a divider', async ({ page }) => {
  // The Room tool, rooms not being put in by themselves.
  const at = await blank(page, { autoRooms: false })
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Shift+A')
  await click(page, at(2000, 0))
  await click(page, at(2000, 3000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  for (const [x, y] of [[1000, 1500], [3000, 1500]]) {
    await page.mouse.move(at(x, y).x, at(x, y).y)
    await click(page, at(x, y))
  }
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'wall')).toHaveLength(4)
  expect(nodes.filter((n) => n.type === 'divider')).toEqual([expect.objectContaining({ a: { x: 2000, y: 0 }, b: { x: 2000, y: 3000 } })])
  expect(nodes.filter((n) => n.type === 'room').map((n) => [n.x, n.y])).toEqual([
    [1000, 1500],
    [3000, 1500],
  ])
})

test('puts a room in the space walls close, and another in the part a divider splits off, in the same step', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  const rooms = async () => (await saved(page)).filter((n) => n.type === 'room')
  await expect.poll(async () => (await rooms()).map((n) => [n.name, n.x, n.y])).toEqual([['Room 01', 2000, 1500]])
  // A divider down the middle, over the room: it moves into one half, and the other gets a room of its own.
  await page.keyboard.press('Shift+A')
  await click(page, at(2000, 0))
  await click(page, at(2000, 3000))
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await rooms()).length).toBe(2)
  const [one, two] = await rooms()
  expect(Math.sign(one.x - 2000) * Math.sign(two.x - 2000)).toBe(-1)
  expect(two.name).toBe('Room 02')
  // One undo takes back the divider and the room it made.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await rooms()).map((n) => [n.name, n.x, n.y])).toEqual([['Room 01', 2000, 1500]])
})

test('selects the walls round a room by a double-click on its name, and the room goes with them when they are moved', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  // A wall beside the room, not round it.
  await page.keyboard.press('w')
  for (const [x, y] of [[-1500, 0], [-1500, 3000]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  const rooms = async () => (await saved(page)).filter((n) => n.type === 'room')
  await expect.poll(async () => (await rooms()).map((n) => [n.x, n.y])).toEqual([[2000, 1500]])
  // Its name is written just above its point.
  const selected = page.locator('[data-panel="objects"] .row.selected')
  await page.mouse.dblclick(at(2000, 1450).x, at(2000, 1450).y)
  await expect(selected).toHaveCount(4)
  // Dragged, even by the room's name, they all go, the room with them, and no second room comes in.
  await drag(page, at(2000, 1450), at(2000, 4950))
  await expect.poll(async () => (await rooms()).map((n) => [n.x, n.y])).toEqual([[2000, 5000]])
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls.filter((n) => n.a.y >= 3500)).toHaveLength(4)
  expect(walls).toContainEqual(expect.objectContaining({ a: { x: -1500, y: 0 }, b: { x: -1500, y: 3000 } }))
  // A click on the name, not a drag, picks the room.
  await click(page, at(2000, 4950))
  await expect(selected).toHaveCount(1)
  await expect(selected).toContainText('Room 01')
})

test('dimensions the plan round its building with dimensions of its own, in a group, that follow the walls', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  // From the Dimension tool, in its Properties.
  await page.keyboard.press('d')
  await page.getByRole('button', { name: 'Dimension the whole plan' }).click()
  const nodes = async () => saved(page)
  await expect.poll(async () => (await nodes()).filter((n) => n.type === 'dimension').length).toBe(4)
  const group = (await nodes()).find((n) => n.type === 'group' && n.name === 'Dimensions of the plan')!
  expect((await nodes()).filter((n) => n.type === 'dimension').every((n) => n.parent === group.id)).toBe(true)
  await expect(objectRows(page).filter({ hasText: 'Dimensions of the plan' })).toHaveClass(/selected/)
  // The right wall dragged 1 m to the right: the dimension above, from corner to corner, follows.
  await page.keyboard.press('Escape')
  await drag(page, at(4000, 1500), at(5000, 1500))
  const right = async () => (await nodes()).find((n) => n.type === 'wall' && n.a.x === n.b.x && n.a.x > 3000)!.a.x
  await expect.poll(right).toBeGreaterThan(4500)
  // From the outer face of the left wall to that of the right one, wherever it went.
  const width = (await right()) + 100 - -100
  expect((await nodes()).filter((n) => n.type === 'dimension' && n.a.y === n.b.y && n.a.y < 0).map((n) => Math.round(Math.abs(n.b.x - n.a.x)))).toEqual([Math.round(width)])
})

test('draws a spline its points pull, shows its control points when selected, and makes it of a line', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+B')
  await expect(page.locator('.hint-bar')).toContainText('Click where the spline starts')
  for (const [x, y] of [[0, 0], [1000, -1500], [2500, 1500], [4000, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Enter')
  const splines = async () => (await saved(page)).filter((n) => n.type === 'polyline')
  await expect.poll(async () => (await splines()).map((n) => [n.smooth, n.points.length])).toEqual([['spline', 4]])
  await page.keyboard.press('Escape')
  await click(page, at(0, 0))
  await page.screenshot({ path: test.info().outputPath('spline.png') })
  // Straightened, and made a spline again, from the command list.
  await page.keyboard.press('Control+k')
  await page.locator('.palette input').fill('Straighten the line')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await splines())[0].smooth).toBeUndefined()
  await page.keyboard.press('Control+k')
  await page.locator('.palette input').fill('Make it a spline')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await splines())[0].smooth).toBe('spline')
})

test('cuts a wall in two with the split tool', async ({ page }) => {
  const at = await blank(page)
  await drawWall(page, [320, 220], [720, 220])
  await page.keyboard.press('k')
  await page.mouse.move(at(2000, 0).x, at(2000, 0).y)
  await click(page, at(2000, 0))
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls.map((w) => [w.a, w.b])).toEqual(
    expect.arrayContaining([
      [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
      [{ x: 2000, y: 0 }, { x: 4000, y: 0 }],
    ]),
  )
})

test('takes away the stretch of a wall up to the wall crossing it with the trim tool', async ({ page }) => {
  const at = await blank(page)
  await drawWall(page, [320, 220], [720, 220])
  await drawWall(page, [520, 20], [520, 420])
  await page.keyboard.press('x')
  await page.mouse.move(at(1000, 0).x, at(1000, 0).y)
  await click(page, at(1000, 0))
  // What is left of the long wall ends on the line of the wall it crossed.
  expect((await saved(page)).find((n) => n.type === 'wall' && n.b.x === 4000)).toMatchObject({ a: { x: 2000, y: 0 }, b: { x: 4000, y: 0 } })
})

/** Draws a line between two points of a blank drawing with the line tool. */
async function line(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.press('l')
  await click(page, from)
  await click(page, to)
  await page.keyboard.press('Escape')
}

test('draws a circle by its centre and a point it goes through, or by a radius typed first', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('c')
  await click(page, at(1000, 1000))
  await click(page, at(1500, 1000))
  // Typed first, the radius needs only the click at the centre.
  await page.keyboard.type('300')
  await click(page, at(3000, 1000))
  const circles = (await saved(page)).filter((n) => n.type === 'ellipse')
  expect(circles).toEqual([expect.objectContaining({ cx: 1000, cy: 1000, rx: 500, ry: 500 }), expect.objectContaining({ cx: 3000, cy: 1000, rx: 300, ry: 300 })])
})

test('extends a line from the end clicked to what is in its way, then on to the next', async ({ page }) => {
  const at = await blank(page)
  await line(page, at(0, 0), at(1000, 0))
  await line(page, at(2000, -1000), at(2000, 1000))
  await line(page, at(3000, -1000), at(3000, 1000))
  await page.keyboard.press('j')
  await page.mouse.move(at(800, 0).x, at(800, 0).y)
  await click(page, at(800, 0))
  expect((await saved(page)).find((n) => n.type === 'line' && n.a.y === 0)).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } })
  await page.mouse.move(at(1800, 0).x, at(1800, 0).y)
  await click(page, at(1800, 0))
  expect((await saved(page)).find((n) => n.type === 'line' && n.a.y === 0)).toMatchObject({ b: { x: 3000, y: 0 } })
})

test('fillets two lines into a corner, and with a radius typed into a rounded one', async ({ page }) => {
  const at = await blank(page)
  await line(page, at(0, 0), at(2000, 0))
  await line(page, at(3000, 500), at(3000, 2000))
  await page.keyboard.press('Shift+F')
  await click(page, at(1000, 0))
  await page.mouse.move(at(3000, 1500).x, at(3000, 1500).y)
  await click(page, at(3000, 1500))
  let lines = (await saved(page)).filter((n) => n.type === 'line')
  expect(lines).toEqual([expect.objectContaining({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }), expect.objectContaining({ a: { x: 3000, y: 0 }, b: { x: 3000, y: 2000 } })])
  // Undone, then again with a radius: each line stops where the arc takes over.
  await page.keyboard.press('Control+z')
  await page.keyboard.type('500')
  await click(page, at(1000, 0))
  await page.mouse.move(at(3000, 1500).x, at(3000, 1500).y)
  await click(page, at(3000, 1500))
  const nodes = await saved(page)
  lines = nodes.filter((n) => n.type === 'line')
  expect(lines).toEqual([expect.objectContaining({ b: { x: 2500, y: 0 } }), expect.objectContaining({ a: { x: 3000, y: 500 } })])
  expect(nodes.find((n) => n.type === 'ellipse')).toMatchObject({ cx: 2500, cy: 500, rx: 500, ry: 500 })
})

test('carries a line on past its end once the pointer rested on it, and the next point lands on that way', async ({ page }) => {
  const at = await blank(page)
  await line(page, at(0, 0), at(1000, 300))
  await page.keyboard.press('l')
  // Resting on the end of the line, then pointing along its way, where the grid alone would round to 800.
  await page.mouse.move(at(1000, 300).x, at(1000, 300).y)
  await page.waitForTimeout(400)
  await page.mouse.move(at(2500, 760).x, at(2500, 760).y)
  await click(page, at(2500, 760))
  await click(page, at(2500, 2000))
  await page.keyboard.press('Escape')
  const { a } = (await saved(page)).find((n) => n.type === 'line' && n.b.y === 2000)!
  expect(Math.abs(a.y - a.x * 0.3)).toBeLessThan(0.01)
  expect(Math.abs(a.x - 2500)).toBeLessThan(50)
})

test('flips the wall being drawn to the other side of its points with Shift+Space', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  await page.getByRole('radio', { name: 'Points along the left face of the wall' }).click()
  await page.mouse.move(at(0, 0).x, at(0, 0).y)
  await page.keyboard.press('Shift+Space')
  await click(page, at(0, 0))
  await click(page, at(3000, 0))
  await page.keyboard.press('Escape')
  // Shift+Space neither ended the drawing nor panned: the wall is there, by its right face.
  expect((await saved(page)).filter((n) => n.type === 'wall')).toEqual([expect.objectContaining({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, justify: 'right' })])
})

test('moves a wall by typing its distance to the wall it faces into a temporary dimension', async ({ page }) => {
  const at = await blank(page)
  await drawWall(page, [320, 220], [320, 620])
  await drawWall(page, [620, 220], [620, 620])
  await click(page, at(0, 2000))
  // From the face of the one selected, 100 mm from its line, to the face of the other: 2.8 m, written halfway.
  await click(page, at(1500, 2000))
  const field = page.locator('.clearance-editor')
  await expect(field).toHaveValue('2800')
  await field.fill('2000')
  await field.press('Enter')
  expect((await saved(page)).find((n) => n.type === 'wall' && n.a.y === 0 && n.a.x < 3000)).toMatchObject({ a: { x: 800, y: 0 }, b: { x: 800, y: 4000 } })
})

test('turns the selection a quarter about a point with the rotate tool', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(2000, 1000))
  await page.keyboard.press('v')
  await click(page, at(1000, 1000))
  await page.keyboard.press('e')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  // Up the screen is a quarter turn counter-clockwise, as angles are read; the drawing keeps it clockwise, as 270°.
  await page.mouse.move(at(0, -1000).x, at(0, -1000).y, { steps: 5 })
  await expect(status(page)).toHaveText('Rotation 90°')
  await click(page, at(0, -1000))
  expect((await saved(page)).find((n) => n.type === 'rect')).toMatchObject({ x: 0, y: 0, width: 2000, height: 1000, rotation: 270 })
})

test('turns the selection exactly onto a point clicked, at an angle that is no whole degree', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 500))
  await page.keyboard.press('l')
  await click(page, at(0, 2500))
  await click(page, at(3000, 2000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await click(page, at(1000, 250))
  await page.keyboard.press('e')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  // The end of the line is 33.69° below level from the pivot: the rectangle's top side goes through it.
  await page.mouse.move(at(3000, 2000).x, at(3000, 2000).y, { steps: 5 })
  await expect(status(page)).toHaveText('Rotation -33.69°')
  await click(page, at(3000, 2000))
  const rect = (await saved(page)).find((n) => n.type === 'rect')!
  expect(rect.rotation).toBeCloseTo((Math.atan2(2000, 3000) * 180) / Math.PI, 6)
})

test('moves the selection by a point of it onto a point of something else, and leaves copies with Ctrl', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 600))
  await click(page, at(3000, 0))
  await click(page, at(4000, 1000))
  await page.keyboard.press('v')
  await click(page, at(1000, 300))
  await page.keyboard.press('Shift+E')
  // Taken by its centre, put down on the other's top-right corner.
  await click(page, at(500, 300))
  await page.mouse.move(at(4000, 0).x, at(4000, 0).y, { steps: 5 })
  await expect(status(page)).toContainText('Move by 3513')
  await click(page, at(4000, 0))
  let rects = (await saved(page)).filter((n) => n.type === 'rect')
  expect(rects.map((r) => [r.x, r.y])).toEqual([[3500, -300], [3000, 0]])
  // Taken again by its corner: with Ctrl each click leaves a copy and the tool goes on, the original staying.
  await click(page, at(3500, -300))
  await page.keyboard.down('Control')
  await click(page, at(3000, 1000))
  await click(page, at(4000, 1000))
  await page.keyboard.up('Control')
  await page.keyboard.press('Escape')
  rects = (await saved(page)).filter((n) => n.type === 'rect')
  expect(rects.map((r) => [r.x, r.y])).toEqual([[3500, -300], [3000, 0], [3000, 1000], [4000, 1000]])
})

test('reads a distance and an angle without adding anything', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('m')
  await click(page, at(0, 0))
  await page.mouse.move(at(3000, 0).x, at(3000, 0).y, { steps: 5 })
  await expect(status(page)).toContainText('Distance 3000')
  await click(page, at(3000, 0))
  await page.keyboard.press('Shift+M')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  await page.mouse.move(at(0, -1000).x, at(0, -1000).y, { steps: 5 })
  await expect(status(page)).toHaveText(/^Angle (90° · 270|270° · 90)°$/)
  await click(page, at(0, -1000))
  expect(await saved(page)).toEqual([])
})

test('selects what a box is dragged around, then scales it all by a corner of the box around it', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 1000))
  await click(page, at(2000, 0))
  await click(page, at(3000, 1000))
  await page.keyboard.press('v')
  // A box from beside them takes in both.
  await drag(page, at(-500, -500), at(3500, 1500))
  // The bottom-right corner of the box around them, pulled to twice as far from the top-left one.
  await drag(page, at(3000, 1000), at(6000, 2000))
  const rects = (await saved(page)).filter((n) => n.type === 'rect')
  expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual([
    [0, 0, 2000, 2000],
    [4000, 0, 2000, 2000],
  ])
})

test('drags a wall corner, both walls following, and the end of a line by its handle', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [3000, 0], [3000, 2000]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  await page.keyboard.press('l')
  await click(page, at(0, 3000))
  await click(page, at(2000, 3000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await drag(page, at(3000, 0), at(4000, -1000))
  await click(page, at(1000, 3000))
  await drag(page, at(2000, 3000), at(2000, 4000))
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'wall').map((w) => [w.a, w.b])).toEqual([
    [{ x: 0, y: 0 }, { x: 4000, y: -1000 }],
    [{ x: 4000, y: -1000 }, { x: 3000, y: 2000 }],
  ])
  expect(nodes.find((n) => n.type === 'line')).toMatchObject({ a: { x: 0, y: 3000 }, b: { x: 2000, y: 4000 } })
})

test('drags a point of a polyline onto the foot of the perpendicular from the point beside it', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(4000, 2000))
  await page.keyboard.press('Escape')
  for (const [x, y] of [[0, 2900], [1000, 2900], [3000, 2900]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await click(page, at(2000, 2900))
  // The foot of the perpendicular from (1000, 2900) onto the slanting line is (1960, 980), off the grid,
  // which would otherwise have put the point at (2000, 1000).
  await drag(page, at(3000, 2900), at(1960, 980))
  const poly = (await saved(page)).find((n) => n.type === 'polyline')
  expect(poly?.points).toEqual([
    { x: 0, y: 2900 },
    { x: 1000, y: 2900 },
    { x: 1960, y: 980 },
  ])
})

test('moves an object by dragging it, by whole steps of the grid', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 1000))
  await page.keyboard.press('v')
  await drag(page, at(500, 0), at(2500, 1000))
  expect((await saved(page)).find((n) => n.type === 'rect')).toMatchObject({ x: 2000, y: 1000, width: 1000, height: 1000 })
})

test('draws a curve through the points clicked, with its own tool', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+L')
  await click(page, at(0, 0))
  await expect(page.locator('.quickbar .quick-size span')).toHaveText(['Length'])
  await click(page, at(1000, 1000))
  await click(page, at(2000, 0))
  await page.keyboard.press('Escape')
  expect((await saved(page)).find((n) => n.type === 'polyline')).toMatchObject({
    smooth: true,
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 2000, y: 0 },
    ],
  })
})

test('draws an arc by its two ends and a point it goes through', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+O')
  await click(page, at(0, 0))
  await expect(page.locator('.quickbar .quick-size span')).toHaveText(['Length'])
  await click(page, at(2000, 0))
  await expect(page.locator('.quickbar .quick-size span')).toHaveText(['Radius'])
  await page.mouse.move(at(1000, 1000).x, at(1000, 1000).y)
  await click(page, at(1000, 1000))
  const arc = (await saved(page)).find((n) => n.type === 'ellipse')!
  expect(arc).toMatchObject({ cx: 1000, cy: 0, rx: 1000, ry: 1000 })
  // Clockwise on screen from the right end, down through the point clicked, to the left end.
  expect([arc.from, arc.to].map(Math.round)).toEqual([0, 180])
})

test('takes a radius typed for an arc, on the side of the pointer', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+O')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await page.mouse.move(at(1000, -300).x, at(1000, -300).y)
  await page.keyboard.type('1500')
  await page.keyboard.press('Enter')
  const arc = (await saved(page)).find((n) => n.type === 'ellipse')!
  expect(arc.rx).toBeCloseTo(1500)
  expect(arc.cy).toBeGreaterThan(0)
})

test('a click on the third point of an arc in line with its ends makes a line', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+O')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await click(page, at(1000, 0))
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'ellipse')).toEqual([])
  expect(nodes.find((n) => n.type === 'line')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } })
})

test('a box dragged rightwards takes what is inside it, one dragged leftwards what it touches', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(1000, 0))
  await click(page, at(1000, 3000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  // Over the middle of the line, its ends outside: rightwards this takes nothing.
  await drag(page, at(500, 1000), at(1500, 2000))
  await page.keyboard.press('Delete')
  expect((await saved(page)).filter((n) => n.type === 'line')).toHaveLength(1)
  await drag(page, at(1500, 1000), at(500, 2000))
  await page.keyboard.press('Delete')
  expect((await saved(page)).filter((n) => n.type === 'line')).toHaveLength(0)
})

test('offsets a line by a typed distance, to the side clicked, each copy one step of undo', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+X')
  await page.keyboard.type('500')
  await page.keyboard.press('Enter')
  await click(page, at(1000, 20))
  await click(page, at(1000, -20))
  const lines = async () => (await saved(page)).filter((n) => n.type === 'line').map((n) => [n.a.y, n.b.y])
  expect(await lines()).toEqual([[0, 0], [500, 500], [-500, -500]])
  await page.mouse.move(at(3000, 3000).x, at(3000, 3000).y)
  await page.keyboard.press('Control+z')
  expect(await lines()).toEqual([[0, 0], [500, 500]])
})

test('offsets a line to where the pointer says, and keeps that distance for the next', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+X')
  await click(page, at(1000, 0))
  await expect(page.locator('.quickbar .quick-size span')).toHaveText(['Distance'])
  await page.mouse.move(at(1000, 800).x, at(1000, 800).y)
  await expect(status(page)).toContainText('800')
  await click(page, at(1000, 800))
  await expect(page.locator('.quickbar .quick-size input')).toHaveValue('800')
  await click(page, at(1000, 780))
  const ys = (await saved(page)).filter((n) => n.type === 'line').map((n) => n.a.y)
  expect(ys).toEqual([0, 800, 0])
})

test('gives up the offset being placed with Esc, leaving the drawing as it was', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(2000, 0))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+X')
  await click(page, at(1000, 0))
  await page.mouse.move(at(1000, 800).x, at(1000, 800).y)
  await page.keyboard.press('Escape')
  expect((await saved(page)).filter((n) => n.type === 'line')).toHaveLength(1)
})

test('offsets a rectangle inwards, and says so when it is too far to', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(2000, 2000))
  await page.keyboard.press('Shift+X')
  await page.keyboard.type('300')
  await page.keyboard.press('Enter')
  await click(page, at(1000, 30))
  const rects = async () => (await saved(page)).filter((n) => n.type === 'rect').map((n) => [n.x, n.y, n.width, n.height])
  expect(await rects()).toEqual([[0, 0, 2000, 2000], [300, 300, 1400, 1400]])
  await page.locator('.quickbar .quick-size input').fill('1200')
  await page.mouse.move(at(1000, 30).x, at(1000, 30).y)
  await expect(status(page)).toContainText('Too far')
  await click(page, at(1000, 30))
  expect(await rects()).toHaveLength(2)
})

test('offsets a curve and an arc into their own kinds, and tells what cannot be offset', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('Shift+L')
  for (const [x, y] of [[0, 0], [1000, 1000], [2000, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+O')
  await click(page, at(-2500, 0))
  await click(page, at(-500, 0))
  await click(page, at(-1500, 1000))
  // An ellipse that is no circle has nothing parallel to it of its kind.
  await page.keyboard.press('o')
  await click(page, at(0, 2500))
  await click(page, at(2000, 3500))
  await page.keyboard.press('Shift+X')
  await page.keyboard.type('200')
  await page.keyboard.press('Enter')
  await click(page, at(1000, 1020))
  await click(page, at(-1500, 1020))
  await page.mouse.move(at(2000, 3000).x, at(2000, 3000).y)
  await expect(status(page)).toContainText('can be offset')
  await click(page, at(2000, 3000))
  const nodes = await saved(page)
  const curves = nodes.filter((n) => n.type === 'polyline')
  expect(curves).toHaveLength(2)
  expect(curves[1]).toMatchObject({ smooth: true })
  expect(curves[1].points).toHaveLength(3)
  expect(nodes.filter((n) => n.type === 'ellipse').map((n) => Math.round(n.rx))).toEqual([1000, 1000, 1200])
})

test('offsets a wall into a wall like it, at a distance typed between their lines', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(4000, 0))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+X')
  await page.keyboard.type('1500')
  await page.keyboard.press('Enter')
  // Clicked on its lower face: the copy goes down.
  await click(page, at(2000, 90))
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls.map((w) => [w.a, w.b, w.thickness])).toEqual([
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }, 200],
    [{ x: 0, y: 1500 }, { x: 4000, y: 1500 }, 200],
  ])
})

test('fixes a socket on the face of a wall beside the pointer, at its height, and it follows the wall moved', async ({ page }) => {
  const electrical = JSON.parse(readFileSync('packages/warehouse/extensions/electrical.json', 'utf8'))
  await startWith(page, { extensions: { installed: { [electrical.id]: electrical }, disabled: [] } })
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  const at = (x: number, y: number) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
  // A wall 200 thick along y = 0: its faces at y = -100 and y = 100.
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(4000, 0))
  await page.keyboard.press('Escape')
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.getByRole('button', { name: 'Socket', exact: true }).click()
  // Beside the wall, below it: on its lower face, standing out of it downwards, by the grid along it.
  await click(page, at(1530, 300))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  const socket = async () => (await saved(page)).find((n) => n.type === 'parametric')
  expect(await socket()).toMatchObject({ kind: 'elec.socket', x: 1500, y: 100, rotation: 0 })
  // The wall moved down 1 m: the socket stays on its face.
  await click(page, at(3000, 0))
  await drag(page, at(3000, 0), at(3000, 1000))
  expect(await socket()).toMatchObject({ x: 1500, y: 1100, rotation: 0 })
  // Its height is the usual one for a socket until another is typed.
  await objectRows(page).filter({ hasText: 'Socket' }).click()
  const height = page.locator('.field', { has: page.locator('span:text-is("Height above floor")') }).locator('input')
  await expect(height).toHaveValue('300')
  await height.fill('450')
  await height.press('Enter')
  expect(await socket()).toMatchObject({ z: 450 })
})

test('draws an elevation of the face of a wall beside the pointer, put down where it is clicked', async ({ page }) => {
  const at = await blank(page)
  // A wall 200 thick along y = 0, from 0 to 4 m: its lower face at y = 100.
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(4000, 0))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+W')
  await expect(page.locator('.hint-bar')).toContainText('Click beside a wall for an elevation of its face on that side')
  // Beside the wall, below it: its lower face, seen from below, its start on the left.
  await click(page, at(2000, 300))
  await expect(page.locator('.hint-bar')).toContainText('Click where the view goes')
  await click(page, at(0, 3000))
  const nodes = await saved(page)
  // One view, holding its line 1 m in front of the face, its far side on it; drawn where it was put down.
  expect(nodes.filter((n) => n.type === 'elevation')).toMatchObject([{ a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, x: 0, y: 3000, name: 'Elevation 1' }])
  // Put down once and selected, the tool back to selecting.
  await expect(objectRows(page).filter({ hasText: 'Elevation 1' })).toHaveClass(/selected/)
  // Dimensioned by itself: what it holds, of its own layer.
  const view = nodes.find((n) => n.type === 'elevation')!
  expect(nodes.filter((n) => n.type === 'autodimensions')).toMatchObject([{ parent: view.id, layer: view.layer }])
})


test('draws the elevations of every wall of a room clicked inside, and of a side of the building clicked beside an outer wall, or all four with Shift', async ({ page }) => {
  const at = await blank(page)
  // A room of 4 by 3 m, walls 200 thick on their lines.
  for (const [from, to] of [[[0, 0], [4000, 0]], [[4000, 0], [4000, 3000]], [[4000, 3000], [0, 3000]], [[0, 3000], [0, 0]]] as [number, number][][]) {
    await page.keyboard.press('w')
    await click(page, at(...from))
    await click(page, at(...to))
    await page.keyboard.press('Escape')
  }
  const views = async () => (await saved(page)).filter((n) => n.type === 'elevation')
  await page.keyboard.press('Shift+W')
  await expect(page.locator('.hint-bar')).toContainText('inside a room, of each of its walls')
  // Inside the room: a view of each of its four walls, seen from inside, in a row that follows the
  // pointer, to be put down where one is looking, and selected.
  await page.mouse.move(at(2000, 1500).x, at(2000, 1500).y)
  await page.screenshot({ path: test.info().outputPath('room-lit.png') })
  await click(page, at(2000, 1500))
  await expect(page.locator('.hint-bar')).toContainText('Click where the views go')
  await page.mouse.move(at(0, -500).x, at(0, -500).y, { steps: 4 })
  await click(page, at(0, -500))
  await expect.poll(async () => (await views()).length).toBe(4)
  // The first where it was clicked, its floor there; the others in a row to its right.
  const row = await views()
  expect(row[0]).toMatchObject({ x: 0, y: -500 })
  for (let i = 1; i < row.length; i++) {
    expect(row[i].y).toBe(-500)
    expect(row[i].x).toBeGreaterThan(row[i - 1].x)
  }
  // In a group named after the room (put in by itself when the walls closed), the group selected.
  const group = async (name: string) => (await saved(page)).find((n) => n.type === 'group' && n.name === name)
  const room = (await group('Elevations – Room 01'))!
  expect((await views()).every((view) => view.parent === room.id)).toBe(true)
  await expect(objectRows(page).filter({ hasText: 'Elevations – Room 01' })).toHaveClass(/selected/)
  for (const view of await views()) expect(view.depth).toBe(1000)
  // Beside the outer face of the bottom wall: the bottom side of the building, seen from outside.
  await page.keyboard.press('Shift+W')
  await page.mouse.move(at(2000, 3300).x, at(2000, 3300).y)
  await page.screenshot({ path: test.info().outputPath('side-lit.png') })
  await click(page, at(2000, 3300))
  await expect.poll(async () => (await views()).length).toBe(5)
  expect((await views())[4]).toMatchObject({ a: { x: -100, y: 4100 }, b: { x: 4100, y: 4100 } })
  // With Shift, all four sides.
  await page.keyboard.press('Shift+W')
  await page.keyboard.down('Shift')
  await page.mouse.move(at(2000, 3320).x, at(2000, 3320).y)
  await page.screenshot({ path: test.info().outputPath('sides-lit.png') })
  await click(page, at(2000, 3300))
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await views()).length).toBe(9)
  // The four together, in a group of their own; the one side alone, in none.
  const sides = (await group('Façades'))!
  expect((await views()).filter((view) => view.parent === sides.id)).toHaveLength(4)
})

test('moves every selected view when one of their pictures is dragged', async ({ page }) => {
  const at = await blank(page)
  for (const [from, to] of [[[0, 0], [4000, 0]], [[4000, 0], [4000, 3000]], [[4000, 3000], [0, 3000]], [[0, 3000], [0, 0]]] as [number, number][][]) {
    await page.keyboard.press('w')
    await click(page, at(...from))
    await click(page, at(...to))
    await page.keyboard.press('Escape')
  }
  // A cupboard against the top wall, which two of the views show.
  await page.keyboard.press('Shift+W')
  await click(page, at(2000, 1500))
  await click(page, at(0, -500))
  const views = async () => (await saved(page)).filter((n) => n.type === 'elevation')
  await expect.poll(async () => (await views()).length).toBe(4)
  const before = await views()
  await page.keyboard.press('Shift+1')
  await page.screenshot({ path: test.info().outputPath('four-views.png') })
  // Dragged by the middle of the second picture, a face of a wall drawn there: all four move.
  const picture = (await page.locator('.view-label').nth(1).boundingBox())!
  const middle = { x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 }
  await drag(page, middle, { x: middle.x + 40, y: middle.y + 40 })
  const offsets = async (from: Saved[]) => (await views()).map((view, i) => `${Math.round(view.x - from[i].x)},${Math.round(view.y - from[i].y)}`)
  const once = await offsets(before)
  expect(new Set(once).size).toBe(1)
  expect(once[0]).not.toBe('0,0')
  // Dragged by the name of one of them, as well.
  const moved = await views()
  const name = (await page.locator('.view-label .view-frame-name').nth(2).boundingBox())!
  const on = { x: name.x + name.width / 2, y: name.y + name.height / 2 }
  await drag(page, on, { x: on.x - 30, y: on.y + 20 })
  const twice = await offsets(moved)
  expect(new Set(twice).size).toBe(1)
  expect(twice[0]).not.toBe('0,0')
  // Double-clicked by its name, a view goes into the group of the room's views, itself selected there.
  await page.locator('.view-label .view-frame-name').first().dblclick()
  await expect(objectRows(page).filter({ hasText: /^Elevation [1-4]$/ }).and(page.locator('.selected'))).toHaveCount(1)
})

/** A wall 4 m long along y = 0 with a socket on its lower face, 2 m along, and an elevation of that face (its line 1 m in front of it) drawn with its floor at y = 6000. */
/** Selects the elevation by its name, so that a click in it then takes what it shows. */
const openView = (page: Page) => page.locator('.view-label .view-frame-name').click()

async function planWithElevation(page: Page) {
  const electrical = JSON.parse(readFileSync('packages/warehouse/extensions/electrical.json', 'utf8'))
  await startWith(page, { extensions: { installed: { [electrical.id]: electrical }, disabled: [] } })
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      s: { id: 's', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a2', kind: 'elec.socket', props: {}, x: 2000, y: 100 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a3', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, name: 'Wall line' },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a4', line: 'l', x: 0, y: 6000, name: 'North' },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  return drawingOnScreen(page)
}

/** A field of the object by its name: not one of the rows of a list (a tall unit's sections), which have fields of the same names. */
const field = (page: Page, name: string) => page.locator('.field:not(.list-row .field)', { has: page.locator(`span:text-is("${name}")`) }).locator('input')

test('selects the socket of the plan by clicking it in an elevation once the view is selected, and moves it there along the wall and up', async ({ page }) => {
  const at = await planWithElevation(page)
  // 300 above the floor at y = 6000, 2 m along: (2000, 5700) in the view.
  const [x, y] = at(2000, 5700)
  // With nothing selected, a drag there moves the view, as any object pressed and dragged; the socket stays.
  const elevation = () => saved(page).then((all) => all.find((n) => n.type === 'elevation')!)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(...at(2300, 5900), { steps: 8 })
  await page.mouse.up()
  const moved = await elevation()
  expect(moved.x).toBeGreaterThan(200)
  expect(moved.y).toBeGreaterThan(6100)
  expect((await saved(page)).find((n) => n.type === 'parametric')).toMatchObject({ x: 2000, y: 100 })
  await page.keyboard.press('Control+z')
  expect(await elevation()).toMatchObject({ x: 0, y: 6000 })
  // The first click takes the view; the next, what it shows.
  await page.keyboard.press('Escape')
  await page.mouse.click(x, y)
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveText(/North/)
  await page.mouse.click(x, y)
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveText(/Socket/)
  await expect(field(page, 'Height above floor')).toHaveValue('300')
  // Dragged 500 to the right and 200 up in the view: 500 further along the wall, 500 high.
  const [tx, ty] = at(2500, 5500)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(tx, ty, { steps: 8 })
  await expect(page.locator('.status')).toContainText('500 mm above the floor')
  await page.mouse.up()
  const socket = (await saved(page)).find((n) => n.type === 'parametric')
  expect(socket).toMatchObject({ x: 2500, y: 100, z: 500 })
  // One step of undo puts it back.
  await page.keyboard.press('Control+z')
  expect((await saved(page)).find((n) => n.type === 'parametric')).toMatchObject({ x: 2000, y: 100 })
})

test('keeps a unit picked in an elevation selected, inside its group, while its height is dragged with Alt or by its top', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      g: { id: 'g', type: 'group', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Kitchen' },
      u: { id: 'u', type: 'parametric', parent: 'g', layer: 'layer_1', order: 'a1', kind: 'arch.baseunit', props: {}, x: 1500, y: 100 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a3', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, name: 'Wall line' },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a4', line: 'l', x: 0, y: 6000, name: 'North' },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  // A base unit inside a group, 900 high, picked where the elevation shows it, from 1500 to 2100 along it.
  await openView(page)
  await page.mouse.click(...at(1800, 5500))
  const height = field(page, 'Height')
  await expect(height).toHaveValue('900')
  const box = (await height.boundingBox())!
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  // Ten pixels to the right: 100 mm higher, and still selected, the group not gone into.
  await expect(height).toHaveValue('1000')
  const unit = async () => (await saved(page)).find((n) => n.type === 'parametric')
  expect(await unit()).toMatchObject({ parent: 'g', props: { height: 1000 } })
  // Its top, at 1000 in the view, pulled up 300: 1300 high, one step to undo.
  const [x, y] = at(1800, 5000)
  await page.mouse.move(x, y - 3)
  await expect(page.locator('.status')).toContainText('Drag the top up or down to change its height')
  await page.mouse.down()
  await page.mouse.move(...at(1800, 4700), { steps: 8 })
  await expect(page.locator('.status')).toContainText('600 mm × 1300 mm')
  await page.mouse.up()
  expect(await unit()).toMatchObject({ x: 1500, y: 100, props: { height: 1300 } })
  await expect(height).toHaveValue('1300')
  await page.keyboard.press('Control+z')
  await expect(height).toHaveValue('1000')
})

test('raises a unit standing on the floor by dragging it up in an elevation, and puts it back on the floor by emptying its height', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      u: { id: 'u', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a2', kind: 'arch.baseunit', props: {}, x: 1500, y: 100 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a3', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, name: 'Wall line' },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a4', line: 'l', x: 0, y: 6000, name: 'North' },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  // On the floor: its height above it is empty, and says so.
  await openView(page)
  await page.mouse.click(...at(1800, 5500))
  const above = field(page, 'Height above floor')
  await expect(above).toHaveValue('')
  await expect(above).toHaveAttribute('placeholder', 'Floor')
  // Dragged 500 up in the view: its underside 500 above the floor, where it was on the plan.
  await page.mouse.move(...at(1800, 5500))
  await page.mouse.down()
  await page.mouse.move(...at(1800, 5000), { steps: 8 })
  await expect(page.locator('.status')).toContainText('500 mm above the floor')
  await page.mouse.up()
  const unit = async () => (await saved(page)).find((n) => n.type === 'parametric')
  expect(await unit()).toMatchObject({ x: 1500, y: 100, z: 500 })
  await expect(above).toHaveValue('500')
  // Emptied: back on the floor.
  await above.fill('')
  await above.press('Enter')
  expect(await unit()).not.toHaveProperty('z')
})

test('widens a unit by its side in an elevation up against the next one, and moves another until it is flush, off the grid', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // Three base units along the wall, 600 wide: from 1500, from 2537 and from 3700.
  const unit = (id: string, x: number, order: string) => ({ id, type: 'parametric', parent: 'page_1', layer: 'layer_1', order, kind: 'arch.baseunit', props: {}, x, y: 100 })
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200 },
      u1: unit('u1', 1500, 'a2'),
      u2: unit('u2', 2537, 'a3'),
      u3: unit('u3', 3700, 'a4'),
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a5', a: { x: 0, y: 1100 }, b: { x: 5000, y: 1100 }, depth: 1000, name: 'Wall line' },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a6', line: 'l', x: 0, y: 6000, name: 'North' },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  const units = async () => Object.fromEntries((await saved(page)).filter((n) => n.type === 'parametric').map((n) => [n.id, n]))
  // The first picked in the view; its right side, at 2100, dragged to 2530: it goes against the next one, at 2537.
  await openView(page)
  await page.mouse.click(...at(1800, 5500))
  const [x, y] = at(2100, 5500)
  await page.mouse.move(x + 3, y)
  await expect(page.locator('.status')).toContainText('Drag the side to make it wider or narrower')
  await page.mouse.down()
  await page.mouse.move(...at(2530, 5500), { steps: 8 })
  await expect(page.locator('.status')).toContainText('1037 mm × 900 mm')
  await page.mouse.up()
  expect((await units()).u1).toMatchObject({ x: 1500, y: 100, props: { width: 1037 } })
  // The third, dragged 560 to the left: its left side, at 3140, goes against the right of the second, at 3137.
  await page.mouse.move(...at(4000, 5500))
  await page.mouse.down()
  await page.mouse.move(...at(3440, 5500), { steps: 8 })
  await page.mouse.up()
  expect((await units()).u3).toMatchObject({ x: 3137, y: 100 })
})

test('shows every placed object by X, Y and Z, then W, D and H, then what is its own, and sets the size of a placement and the height of its component there', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      u: { id: 'u', type: 'parametric', parent: 'page_1', layer: 'layer_1', order: 'a1', kind: 'arch.tallunit', props: {}, x: 1500, y: 100 },
      c: { id: 'c', type: 'component', parent: null, order: 'a0', name: 'Mirror', height: 800 },
      r: { id: 'r', type: 'rect', parent: 'c', order: 'a1', x: 0, y: 0, width: 600, height: 40 },
      i: { id: 'i', type: 'instance', parent: 'page_1', layer: 'layer_1', order: 'a2', component: 'c', x: 2600, y: 100 },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await drawingOnScreen(page)
  const row = (name: string) => page.locator('.field-pair', { has: page.locator(`.field-pair-name:text-is("${name}")`) })
  const nodes = async () => Object.fromEntries((await saved(page)).map((n) => [n.id, n]))
  // A tall unit: where it is, how large, and what it holds under its own name.
  await objectRows(page).filter({ hasText: /Tall unit/ }).click()
  await expect(row('X, Y, Z').locator('input')).toHaveCount(3)
  await expect(row('W, D, H').locator('input')).toHaveCount(3)
  await expect(page.locator('[data-panel="properties"] .section', { hasText: 'Tall unit' }).locator('.field', { hasText: 'Contents' })).toHaveCount(1)
  await field(page, 'Height').fill('2300')
  await field(page, 'Height').press('Enter')
  expect((await nodes()).u).toMatchObject({ props: { height: 2300 } })
  // A placement: twice as wide is stretched twice; taller is its component; Z raises it.
  await objectRows(page).filter({ hasText: /Mirror/ }).click()
  await expect(field(page, 'Width')).toHaveValue('600')
  await expect(field(page, 'Height')).toHaveValue('800')
  await field(page, 'Width').fill('1200')
  await field(page, 'Width').press('Enter')
  await field(page, 'Height').fill('900')
  await field(page, 'Height').press('Enter')
  await field(page, 'Height above floor').fill('1200')
  await field(page, 'Height above floor').press('Enter')
  const placed = await nodes()
  expect(placed.i).toMatchObject({ x: 2600, y: 100, scaleX: 2, z: 1200 })
  expect(placed.c).toMatchObject({ height: 900 })
})

test('keeps a socket dragged in an elevation to one way with Shift, on the wall and above the floor', async ({ page }) => {
  const at = await planWithElevation(page)
  const [x, y] = at(2000, 5700)
  await openView(page)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  // Mostly up, a little across: only up. Far below the floor: at the floor.
  const [tx, ty] = at(2100, 4700)
  await page.mouse.move(tx, ty, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect((await saved(page)).find((n) => n.type === 'parametric')).toMatchObject({ x: 2000, y: 100, z: 1300 })
  await page.mouse.move(...at(2000, 4700))
  await page.mouse.down()
  await page.mouse.move(...at(9000, 7000), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'parametric')).toMatchObject({ x: 4000, y: 100, z: 0 })
})

test('says the unit of lengths and angles in their fields, faint after the number', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 1000))
  await page.keyboard.press('v')
  await click(page, at(1000, 500))
  const unitOf = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('.field-unit')
  await expect(unitOf('X')).toHaveText('mm')
  await expect(unitOf('Rotation')).toHaveText('°')
  // The unit is not part of what is typed.
  await expect(field(page, 'X')).toHaveValue('0')
})

test('says the unit chosen in Preferences in the fields of lengths', async ({ page }) => {
  await startWith(page, { unit: 'cm' })
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 320, box.y + 220)
  await page.mouse.click(box.x + 420, box.y + 320)
  await page.keyboard.press('v')
  await page.mouse.click(box.x + 420, box.y + 270)
  await expect(page.locator('.field', { has: page.locator('span:text-is("X")') }).locator('.field-unit')).toHaveText('cm')
})

test('has the electrical symbols without installing anything, all of them objects to set', async ({ page }) => {
  await blank(page)
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-section', { has: page.locator('.warehouse-section-name', { hasText: /^Electrical$/ }) }).click()
  for (const name of ['Socket', 'Switch', 'Dimmer', 'Socket, 32 A', 'Consumer unit', 'Smoke detector']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
})

test('draws a section by its line and puts its view down on the side it is seen from', async ({ page }) => {
  const at = await blank(page)
  // A wall across x = 2000, which the section crosses.
  await page.keyboard.press('w')
  await click(page, at(2000, -1000))
  await click(page, at(2000, 1000))
  await page.keyboard.press('Escape')
  // The same tool as elevations: a click away from walls starts a section line.
  await page.keyboard.press('Shift+W')
  await expect(page.locator('.hint-bar')).toContainText('click elsewhere to start a section line')
  await click(page, at(0, 0))
  await expect(page.locator('.hint-bar')).toContainText('Click where the section line ends')
  await click(page, at(4000, 0))
  await expect(page.locator('.hint-bar')).toContainText('Click where the view goes, on the side the section is seen from')
  // Put down above the line: seen from above, so the line runs from right to left, its right being up.
  await click(page, at(0, -1500))
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 4000, y: 0 }, b: { x: 0, y: 0 } })
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ x: 0, y: -1500, name: 'Section 1' })
})


test('shows on the plan what a view sees, and sets its depth by the handle at its far side', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // Its line 1 m in front of the lower face, at y = 1100, what it sees up to the face: the handle on the face at (2000, 100).
  await page.mouse.move(...at(2000, 100))
  await page.mouse.down()
  await page.mouse.move(...at(2000, 600), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ depth: 500 })
  await expect(field(page, 'Depth')).toHaveValue('500')
})

test('keeps an elevation on its face when its depth is typed: its line moves', async ({ page }) => {
  await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  const depth = field(page, 'Depth')
  await depth.fill('600')
  await depth.press('Enter')
  // Its far side stays on the face at y = 100: the line comes from 1100 to 700.
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 0, y: 700 }, b: { x: 4000, y: 700 }, depth: 600 })
})

test('drags an edge of what a view sees across, as a wall’s face, taken anywhere along it', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // The line itself, at y = 1100, taken 1 m from its start and brought 400 nearer the face: the far side stays on it.
  await page.mouse.move(...at(1000, 1100))
  await page.mouse.down()
  await page.mouse.move(...at(1300, 700), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 0, y: 700 }, b: { x: 4000, y: 700 }, depth: 600 })
  // The side at its end, from x = 4000 to 3000: the views show less of the face.
  await page.mouse.move(...at(4000, 400))
  await page.mouse.down()
  await page.mouse.move(...at(3000, 500), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 0, y: 700 }, b: { x: 3000, y: 700 } })
})

test('takes a corner of what a view sees before the edges meeting there and the corner of the walls beside it', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // Its far corner at the end is on the face at (4000, 100), beside the end of the wall: pressed a few
  // pixels along the far edge from it, it is the corner that is dragged, turning the area about its start.
  const [x, y] = at(4000, 100)
  await page.mouse.move(x - 6, y + 1)
  await page.mouse.down()
  await page.mouse.move(...at(4000, -900), { steps: 8 })
  await page.mouse.up()
  const nodes = await saved(page)
  const line = nodes.find((n) => n.type === 'elevation')
  expect(line).toMatchObject({ a: { x: 0, y: 1100 }, depth: 1000 })
  expect(line.b.y).toBeLessThan(1000)
  // The wall did not move.
  expect(nodes.find((n) => n.type === 'wall')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
})

test('copies a view alone as another view looking where it did, with no line left apart on the plan', async ({ page }) => {
  await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  // A paste reads the clipboard first, which takes a moment: what is saved before it lands has one view.
  await expect.poll(async () => (await saved(page)).filter((n) => n.type === 'elevation').length).toBe(2)
  const nodes = await saved(page)
  // Opened from version 3, its line went into it: there is no line node, and both views hold the same line.
  expect(nodes.some((n) => ['viewline'].includes(n.type))).toBe(false)
  expect(nodes.filter((n) => n.type === 'elevation').map((n) => [n.a, n.b])).toEqual([
    [{ x: 0, y: 1100 }, { x: 4000, y: 1100 }],
    [{ x: 0, y: 1100 }, { x: 4000, y: 1100 }],
  ])
})

test('selects a view by its line on the plan, and moves the line across by dragging it there, the view staying where it is drawn', async ({ page }) => {
  const at = await planWithElevation(page)
  // Nothing selected: the line, at y = 1100, pressed 1 m from its start and dragged 300 nearer the face.
  await page.mouse.move(...at(1000, 1100))
  await page.mouse.down()
  await page.mouse.move(...at(1000, 800), { steps: 8 })
  await page.mouse.up()
  await expect(objectRows(page).filter({ hasText: 'North' })).toHaveClass(/selected/)
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 0, y: 800 }, b: { x: 4000, y: 800 }, x: 0, y: 6000 })
})

test('puts a hob against the wall beside the pointer, its back on the face and its middle under the pointer', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(4000, 0))
  await page.keyboard.press('Escape')
  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Hob$/ }) }).click()
  await click(page, at(2030, 300))
  await page.keyboard.press('Escape')
  expect((await saved(page)).find((n) => n.type === 'parametric')).toMatchObject({ kind: 'arch.hob', x: 1700, y: 100, rotation: 0 })
})

test('turns a unit dragged to the wall to stand against it, and sets it against the next one, wherever it was taken', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // A wall along y = 0, its face below at y = 100; a unit against it from x = 2400; another 600 wide
  // and deep turned the wrong way, its doors to the wall, its box from (1000, 300) to (1600, 900).
  const unit = (id: string, order: string, x: number, y: number, rotation: number) => ({ id, type: 'parametric', parent: 'page_1', order, layer: 'layer_1', kind: 'arch.baseunit', props: {}, x, y, rotation })
  const plan = drawing({
    w: { id: 'w', type: 'wall', parent: 'page_1', order: 'a0', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
    a: unit('a', 'a1', 2400, 100, 0),
    u: unit('u', 'a2', 1600, 900, 180),
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'kitchen.opencalque', plan)
  const onScreen = await drawingOnScreen(page)
  const at = (x: number, y: number) => ({ x: onScreen(x, y)[0], y: onScreen(x, y)[1] })
  // Taken by its lower part, then by its upper part, and brought by as much each time: its box's top
  // 50 short of the face, its right side 20 short of the other unit.
  for (const taken of [800, 350]) {
    await click(page, at(1300, 600))
    await drag(page, at(1300, taken), at(1300 + 780, taken - 150))
    expect((await saved(page)).find((n) => n.id === 'u')).toMatchObject({ x: 1800, y: 100, rotation: 0 })
    await page.keyboard.press('Control+z')
  }
})

test('makes an elevation look at part of the face by dragging its end along the wall', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Wall line', a: { x: 1000, y: 1100 }, b: { x: 5000, y: 1100 }, depth: 1000 },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a3', name: 'North', line: 'l', x: 1000, y: 6000 },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // Its end at x = 5000, taken by its arrow (20 pixels from the end, where the corner's point is not),
  // dragged back to 3000, a little off the line: it stays on its line, the view still of the face.
  const [ex, ey] = at(5000, 1100)
  await page.mouse.move(ex, ey + 20)
  await page.mouse.down()
  const [tx, ty] = at(3000, 1150)
  await page.mouse.move(tx, ty + 20, { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 1000, y: 1100 }, b: { x: 3000, y: 1100 } })
})

test('drags an end of a view by its arrow, not only by its point', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Wall line', a: { x: 1000, y: 1100 }, b: { x: 5000, y: 1100 }, depth: 1000 },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a3', name: 'North', line: 'l', x: 1000, y: 6000 },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // The arrow at its start stands below the line, in the room it looks from, pointing up at the
  // wall: pressed 20 pixels down it.
  const [x, y] = at(1000, 1100)
  await page.mouse.move(x, y + 20)
  await page.mouse.down()
  const [tx] = at(2000, 1100)
  await page.mouse.move(tx, y + 20, { steps: 8 })
  await page.mouse.up()
  // Its view drawn as much further right: what it still shows stays where it was.
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 2000, y: 1100 }, b: { x: 5000, y: 1100 } })
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ x: 2000 })
})


test('resizes what an elevation sees by a corner of it, a rectangle still', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 },
      l: { id: 'l', type: 'viewline', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Wall line', a: { x: 1000, y: 1100 }, b: { x: 5000, y: 1100 }, depth: 1000 },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a3', name: 'North', line: 'l', x: 1000, y: 6000 },
    },
    { version: 3 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  // Its far corner at the end, on the face at (5000, 100), dragged with Shift to (4000, 400): it keeps its way, shorter, and seeing 700 deep.
  await page.mouse.move(...at(5000, 100))
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(...at(4000, 400), { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect((await saved(page)).find((n) => n.type === 'elevation')).toMatchObject({ a: { x: 1000, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 700 })
  // Without Shift, the same corner dragged 1.5 m further up turns the area about its start, 700 deep still.
  await page.mouse.move(...at(4000, 400))
  await page.mouse.down()
  await page.mouse.move(...at(4000, -1100), { steps: 8 })
  await page.mouse.up()
  const turned = (await saved(page)).find((n) => n.type === 'elevation')!
  expect(turned).toMatchObject({ a: { x: 1000, y: 1100 }, depth: 700 })
  expect(turned.b.y).toBeLessThan(1000)
})

test('links a switch to the lights and the socket it controls by clicking them, and unlinks one clicked again', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const object = (id: string, kind: string, x: number, y: number, order: string) => ({ id, type: 'parametric', parent: 'page_1', layer: 'layer_1', order, kind, props: {}, x, y })
  const plan = drawing({
    s: object('s', 'elec.switch', 0, 0, 'a1'),
    l: object('l', 'elec.light', 3000, 0, 'a2'),
    m: object('m', 'elec.light', 3000, 2000, 'a3'),
    p: object('p', 'elec.socket', 0, 2000, 'a4'),
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const at = await drawingOnScreen(page)
  const click = (x: number, y: number) => page.mouse.click(...at(x, y))
  await page.keyboard.press('Shift+C')
  await expect(page.locator('.hint-bar')).toContainText('Click a switch, a dimmer or a push button')
  await click(0, 0)
  await expect(page.locator('.hint-bar')).toContainText('Click a light or a socket it controls')
  // Pointing at the light shows what a click would do.
  await page.mouse.move(...at(3000, 0))
  await expect(page.locator('.status')).toContainText('Click to make Switch control Ceiling light')
  await click(3000, 0)
  await expect(page.locator('.status')).toContainText('Switch now controls Ceiling light')
  await click(0, 2000)
  const links = (nodes: Saved[]) => nodes.filter((n) => n.type === 'link').map((n) => [n.from, n.to])
  expect(links(await saved(page))).toEqual([
    ['s', 'l'],
    ['s', 'p'],
  ])
  // A light it controls already, clicked again, is unlinked.
  await click(3000, 0)
  expect(links(await saved(page))).toEqual([['s', 'p']])
  // The switch says what it controls, and a click there selects it.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await click(0, 0)
  const controls = page.locator('.controls-field')
  await expect(controls).toContainText('Controls')
  await controls.getByRole('button', { name: 'Socket' }).click()
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveText(/Socket/)
  // Removing the socket removes the link to it.
  await page.keyboard.press('Delete')
  expect(links(await saved(page))).toEqual([])
})

test('labels an elevation as a 3D view is: selected and moved by its name, made larger by a corner, with the menu of a view', async ({ page }) => {
  await planWithElevation(page)
  const elevation = () => saved(page).then((all) => all.find((n) => n.type === 'elevation')!)
  const label = page.locator('.view-label .view-frame-name')
  await expect(label).toHaveText('North')
  // Its name selects it.
  await label.click()
  await expect(objectRows(page).filter({ hasText: 'North' })).toHaveClass(/selected/)
  // Dragged by its name, it is drawn elsewhere; its line stays on the plan.
  const before = await elevation()
  const at = (await label.boundingBox())!
  await page.mouse.move(at.x + 10, at.y + at.height / 2)
  await page.mouse.down()
  await page.mouse.move(at.x + 70, at.y + at.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  const moved = await elevation()
  expect(moved.x).toBeGreaterThan(before.x)
  expect(moved.y).toBeGreaterThan(before.y)
  expect(moved.a).toEqual(before.a)
  // By its corner, larger, as a share of the plan: the corner across where it was. (Its top
  // right: its bottom is under the toolbar.)
  const box = (await page.locator('.view-label').boundingBox())!
  const corner = (await page.locator('.view-label .view-frame-grip.ne').boundingBox())!
  await page.mouse.move(corner.x + 5, corner.y + 5)
  await page.mouse.down()
  await page.mouse.move(corner.x + 5 + box.width / 2, corner.y + 5 - box.height / 2, { steps: 8 })
  await page.mouse.up()
  const larger = await elevation()
  expect(larger.scale).toBeGreaterThan(1.3)
  const grown = (await page.locator('.view-label').boundingBox())!
  expect(grown.x).toBeCloseTo(box.x, -1)
  expect(grown.y + grown.height).toBeCloseTo(box.y + box.height, -1)
  expect(grown.width).toBeGreaterThan(box.width * 1.3)
  // On no sheet, read against 1:100.
  await expect(field(page, 'Scale')).toHaveValue(String(Math.round(100 / larger.scale)))
  // By the middle of its right side, it shows more of what it looks at: its line longer at its end,
  // the view drawn where it was; by its left side, its line starts further back, and so it is drawn.
  const side = async (grip: 'w' | 'e', dx: number) => {
    const at = (await page.locator(`.view-label .view-frame-grip.${grip}`).boundingBox())!
    await page.mouse.move(at.x + 5, at.y + 5)
    await page.mouse.down()
    await page.mouse.move(at.x + 5 + dx, at.y + 5, { steps: 6 })
    await page.mouse.up()
  }
  // (Brought into view first: larger, it has gone under the panels.)
  await label.click()
  await page.keyboard.press('Shift+1')
  await side('e', 40)
  const longer = await elevation()
  expect(longer.b.x).toBeGreaterThan(larger.b.x)
  expect(longer.b.y).toBe(larger.b.y)
  expect(longer).toMatchObject({ a: larger.a, x: larger.x, y: larger.y, scale: larger.scale })
  await side('w', -40)
  const wider = await elevation()
  expect(wider.a.x).toBeLessThan(longer.a.x)
  expect(wider.b).toEqual(longer.b)
  // Drawn further left by as much as its line grew at its start, at its scale.
  expect(wider.x - longer.x).toBeCloseTo((wider.a.x - longer.a.x) * longer.scale, 0)
  // Its menu, from its name: to where it looks from, to itself, to another page.
  await label.click({ button: 'right' })
  const menu = page.locator('.context-menu:not(.submenu)')
  await expect(menu.getByRole('menuitem', { name: 'Zoom to its line' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Zoom to the view' })).toBeVisible()
})

test('holds the dimensions drawn on an elevation, in its own coordinates: listed under it, carried and made larger with it', async ({ page }) => {
  await planWithElevation(page)
  const box = (await page.locator('.view-label').boundingBox())!
  // Across the elevation, inside what it draws, from the page: the dimension goes in it.
  const [y, x0, x1] = [box.y + box.height * 0.3, box.x + box.width * 0.1, box.x + box.width * 0.6]
  await page.keyboard.press('d')
  await page.mouse.click(x0, y)
  await page.mouse.click(x1, y)
  await page.mouse.click(x1, y + 30)
  await page.keyboard.press('v')
  const dimension = () => saved(page).then((all) => all.find((n) => n.type === 'dimension')!)
  const drawn = await dimension()
  expect(drawn.parent).toBe('e')
  // In its coordinates: along its line from its start, up from its floor (negative), in millimetres of the plan.
  expect(drawn.a.y).toBeLessThan(0)
  expect(drawn.b.y).toBe(drawn.a.y)
  // Listed under it, which opens as a group does.
  const row = objectRows(page).filter({ hasText: 'North' })
  await row.getByTitle('Show what is inside').click()
  await expect(objectRows(page).filter({ hasText: /^Dimension$/ })).toHaveCount(1)
  // Made larger by a corner, the view carries it: the dimension itself does not change.
  await page.locator('.view-label .view-frame-name').click()
  const corner = (await page.locator('.view-label .view-frame-grip.ne').boundingBox())!
  await page.mouse.move(corner.x + 5, corner.y + 5)
  await page.mouse.down()
  await page.mouse.move(corner.x + 5 + box.width / 2, corner.y + 5 - box.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'elevation')!.scale).toBeGreaterThan(1.3)
  expect(await dimension()).toEqual(drawn)

  // Gone into by a double-click, as a group: the breadcrumb says so, its labels go, and what is
  // drawn there goes in it; Escape comes back out, the view where it was on screen.
  const before = (await page.locator('.view-label').boundingBox())!
  const inside = { x: before.x + before.width * 0.5, y: before.y + before.height * 0.5 }
  await page.mouse.dblclick(inside.x, inside.y)
  await expect(page.locator('.breadcrumb')).toContainText('North')
  await expect(page.locator('.view-label')).toHaveCount(0)
  await page.keyboard.press('d')
  await page.mouse.click(before.x + before.width * 0.2, before.y + before.height * 0.6)
  await page.mouse.click(before.x + before.width * 0.4, before.y + before.height * 0.6)
  await page.mouse.click(before.x + before.width * 0.4, before.y + before.height * 0.6 + 30)
  await page.keyboard.press('v')
  await expect.poll(async () => (await saved(page)).filter((n) => n.type === 'dimension' && n.parent === 'e').length).toBe(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.view-label')).toHaveCount(1)
  const after = (await page.locator('.view-label').boundingBox())!
  expect(after.x).toBeCloseTo(before.x, -1)
  expect(after.width).toBeCloseTo(before.width, -1)
})

test('draws the dimensions of an elevation as one of what it holds: its rows chosen in Properties, removed and added back from its menu', async ({ page }) => {
  await planWithElevation(page)
  const properties = page.locator('[data-panel="properties"]')
  // The view's settings: where it is drawn and at what scale, as any geometry; what it looks at; how it is drawn.
  await page.locator('.view-label .view-frame-name').click()
  await expect(properties.locator('h3')).toContainText(['Representation', 'Line of view'])
  // Its scale as a drawing scale, the N of 1:N, read against the sheet it is on: here none, so 1:100.
  await expect(field(page, 'Scale')).toHaveValue('100')
  await field(page, 'Scale').fill('1:50')
  await field(page, 'Scale').press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.type === 'elevation')!.scale).toBe(2)
  await expect(field(page, 'Scale')).toHaveValue('50')
  await field(page, 'Scale').fill('25')
  await field(page, 'Scale').press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.type === 'elevation')!.scale).toBe(4)
  // As large as the plan again: no scale of its own.
  await field(page, 'Scale').fill('1:100')
  await field(page, 'Scale').press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.type === 'elevation')!.scale).toBeUndefined()
  // One drawing has only one page: no page to choose for its plan.
  await expect(properties.getByText('Plan on page')).toHaveCount(0)
  // Its dimensions, under it in the Structure list, chosen there: a row left out is said false.
  const row = (name: string) => objectRows(page).filter({ hasText: new RegExp(`^${name}$`) })
  await row('North').getByTitle('Show what is inside').click()
  await row('Automatic dimensions').click()
  await expect(properties.locator('h3')).toContainText(['Dimensions drawn'])
  await properties.getByRole('radiogroup', { name: 'End to end' }).getByRole('radio', { name: 'No' }).click()
  const dimensions = () => saved(page).then((all) => all.filter((n) => n.type === 'autodimensions'))
  await expect.poll(async () => (await dimensions())[0]?.overall).toBe(false)
  // Removed, the view draws none; its menu, out of it, puts them back, all rows shown.
  await expect(page.locator('.breadcrumb')).toContainText('North')
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await dimensions()).length).toBe(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.view-label')).toHaveCount(1)
  await page.locator('.view-label .view-frame-name').click({ button: 'right' })
  await page.locator('.context-menu:not(.submenu)').getByText('Add automatic dimensions').click()
  await expect.poll(async () => (await dimensions()).length).toBe(1)
  expect((await dimensions())[0]).toMatchObject({ parent: 'e' })
  expect((await dimensions())[0].overall).toBeUndefined()
  // Once there, the menu no longer offers them.
  await page.locator('.view-label .view-frame-name').click({ button: 'right' })
  await expect(page.locator('.context-menu:not(.submenu)')).not.toContainText('Add automatic dimensions')
})

test('lights a selected elevation by its outline only, and what it shows once picked in it', async ({ page }) => {
  const at = await planWithElevation(page)
  const box = (await page.locator('.view-label').boundingBox())!
  const plan = (await page.locator('.stage canvas.canvas').boundingBox())!
  /** How many pixels inside the elevation's drawing, clear of its outline, are of the accent colour (#0d99ff). */
  const lit = () =>
    page.evaluate(([x, y, w, h]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')!
      const scale = canvas.width / canvas.getBoundingClientRect().width
      const data = canvas.getContext('2d')!.getImageData(Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale)).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 13) < 40 && Math.abs(data[i + 1] - 153) < 40 && data[i + 2] > 215) count++
      return count
    }, [box.x - plan.x + 6, box.y - plan.y + 6, box.width - 12, box.height - 12])
  await expect.poll(lit).toBe(0)
  // Selected by its name: its outline is lit, not the socket and the wall it shows.
  await page.locator('.view-label .view-frame-name').click()
  await expect(objectRows(page).filter({ hasText: /^North$/ })).toHaveClass(/selected/)
  await page.waitForTimeout(100)
  expect(await lit()).toBe(0)
  // The socket picked in it: lit there, as what is selected is.
  await page.mouse.click(...at(2000, 5700))
  await expect(objectRows(page).filter({ hasText: /Socket/ })).toHaveClass(/selected/)
  await expect.poll(lit).toBeGreaterThan(0)
})

test('lists the parts of an elevation under it, and opens Properties on its line of view when it is picked by its line', async ({ page }) => {
  const at = await planWithElevation(page)
  const properties = page.locator('[data-panel="properties"]')
  const section = (title: string) => properties.locator('section.section', { has: page.locator('h3', { hasText: new RegExp(`^${title}$`) }) })
  const row = (name: string) => objectRows(page).filter({ hasText: new RegExp(`^${name}$`) })
  // Its parts, then what is drawn on it: its line of view and its representation, which are not objects to move or remove.
  await row('North').getByTitle('Show what is inside').click()
  await expect(row('Line of view')).toHaveCount(1)
  await expect(row('Representation')).toHaveCount(1)
  await expect(row('Automatic dimensions')).toHaveCount(1)
  // Selected whole, by its row: both its parts are, and Properties shows all of it.
  await row('North').click()
  await expect(row('Line of view')).toHaveClass(/selected/)
  await expect(row('Representation')).toHaveClass(/selected/)
  await expect(section('Representation')).not.toHaveClass(/folded/)
  await expect(section('Line of view')).not.toHaveClass(/folded/)
  // Its line of view picked there: the view selected, that part alone, Properties on its line, the rest folded.
  await row('Line of view').click()
  await expect(row('North')).toHaveClass(/selected/)
  await expect(row('Line of view')).toHaveClass(/selected/)
  await expect(row('Representation')).not.toHaveClass(/selected/)
  await expect(section('Line of view')).not.toHaveClass(/folded/)
  await expect(section('Representation')).toHaveClass(/folded/)
  // Its representation picked: the other way round.
  await row('Representation').click()
  await expect(row('Representation')).toHaveClass(/selected/)
  await expect(row('Line of view')).not.toHaveClass(/selected/)
  await expect(section('Representation')).not.toHaveClass(/folded/)
  await expect(section('Line of view')).toHaveClass(/folded/)
  // Picked by its line on the plan: the same as by its row.
  await page.keyboard.press('Escape')
  await page.mouse.click(...at(1500, 1100))
  await expect(row('North')).toHaveClass(/selected/)
  await expect(section('Representation')).toHaveClass(/folded/)
  await expect(section('Line of view')).not.toHaveClass(/folded/)
  // By its drawing, it is selected whole.
  await page.keyboard.press('Escape')
  await page.locator('.view-label .view-frame-name').click()
  await expect(row('Line of view')).toHaveClass(/selected/)
  await expect(row('Representation')).toHaveClass(/selected/)
  await expect(section('Line of view')).not.toHaveClass(/folded/)
  // Nothing was removed nor moved by picking its parts.
  expect((await saved(page)).filter((n) => n.type === 'elevation')).toHaveLength(1)
})

test('lists an elevation drawn on another page on the page it looks at too, with its parts where each is', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      w: { id: 'w', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      sheet: { id: 'sheet', type: 'page', parent: null, order: 'a1', name: 'Sheet' },
      e: { id: 'e', type: 'elevation', parent: 'sheet', layer: 'layer_1', order: 'a1', page: 'page_1', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, x: 0, y: 0, name: 'North' },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  // On the plan it looks at: listed first, faint, with the page it is drawn on.
  const row = (name: RegExp) => objectRows(page).filter({ hasText: name })
  await expect(objectRows(page).first()).toHaveClass(/foreign-view/)
  await expect(row(/^North/)).toContainText('Sheet')
  await row(/^North/).getByTitle('Show what is inside').click()
  // Its line of view is here; its representation is on the sheet, where a click on it goes.
  await expect(row(/^Line of view$/)).not.toHaveClass(/elsewhere/)
  await expect(row(/^Representation/)).toHaveClass(/elsewhere/)
  await row(/^Line of view$/).click()
  await expect(row(/^North/)).toHaveClass(/selected/)
  await row(/^Representation/).click()
  await expect(page.locator('.view-label')).toHaveCount(1)
  // On its own page it is listed as anything there, not faint, its line of view now the part elsewhere.
  await expect(row(/^North/)).not.toHaveClass(/foreign-view/)
  await expect(row(/^Line of view/)).toHaveClass(/elsewhere/)
})

test('brings a dimension into an elevation by dropping its row there, and copies one out of it to where the view draws it', async ({ page }) => {
  await planWithElevation(page)
  const box = (await page.locator('.view-label').boundingBox())!
  // A dimension on the page, above the elevation (not on it), between it and the plan.
  const y = box.y - 70
  await page.keyboard.press('d')
  await page.mouse.click(box.x + 20, y)
  await page.mouse.click(box.x + 200, y)
  await page.mouse.click(box.x + 200, y + 20)
  await page.keyboard.press('v')
  const dimensions = () => saved(page).then((all) => all.filter((n) => n.type === 'dimension'))
  const [drawn] = await dimensions()
  expect(drawn.parent).toBe('page_1')
  const view = (await saved(page)).find((n) => n.type === 'elevation')!
  // Its row dropped on the elevation's: in it, in its coordinates, seen where it was.
  const row = (name: string) => objectRows(page).filter({ hasText: new RegExp(`^${name}$`) })
  const height = (await row('North').boundingBox())!.height
  await row('Dimension').dragTo(row('North'), { targetPosition: { x: 60, y: height / 2 } })
  await expect.poll(async () => (await dimensions())[0].parent).toBe('e')
  const [inside] = await dimensions()
  expect(inside.a.x).toBeCloseTo(drawn.a.x - view.x, 0)
  expect(inside.a.y).toBeCloseTo(drawn.a.y - view.y, 0)
  expect(inside.b.x).toBeCloseTo(drawn.b.x - view.x, 0)

  // Copied from inside the view and pasted in place on the page: where the view draws it.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.breadcrumb')).toContainText('North')
  await row('Dimension').click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.view-label')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+v')
  await expect.poll(async () => (await dimensions()).length).toBe(2)
  const copy = (await dimensions()).find((n) => n.parent === 'page_1')!
  expect(copy.a.x).toBeCloseTo(drawn.a.x, 0)
  expect(copy.a.y).toBeCloseTo(drawn.a.y, 0)
})
