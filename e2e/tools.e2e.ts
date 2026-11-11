import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, drawWall, failOnErrors, objectRows, openEditor, recordSaves, startWith } from './support'

/**
 * Each tool of the canvas, and each drag of the select tool, used as a person would, with what it
 * made read back from the drawing as it is saved. A blank drawing opens at 0.1 pixel per
 * millimetre with its origin 320 pixels across and 220 down the canvas, and its grid of 100 mm
 * falls on every tenth pixel from there, which is where these tests click.
 */

failOnErrors()

type Saved = { type: string; [key: string]: any }

/** Where a point of a blank drawing is on the page. */
async function blank(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  await startWith(page)
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

test('names the rooms that closed walls make, and splits one with a divider', async ({ page }) => {
  const at = await blank(page)
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
  // Its line 1 m in front of the face, its far side on it, on the plan; the view where it was put down.
  const line = nodes.find((n) => n.type === 'viewline')
  expect(line).toMatchObject({ a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, name: 'View line 1' })
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ line: line.id, x: 0, y: 3000, name: 'Elevation 1' })
  // Put down once and selected, the tool back to selecting.
  await expect(objectRows(page).filter({ hasText: 'Elevation 1' })).toHaveClass(/selected/)
})


/** A wall 4 m long along y = 0 with a socket on its lower face, 2 m along, and an elevation of that face (its line 1 m in front of it) drawn with its floor at y = 6000. */
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

const field = (page: Page, name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')

test('selects the socket of the plan by clicking it in an elevation, and moves it there along the wall and up', async ({ page }) => {
  const at = await planWithElevation(page)
  // 300 above the floor at y = 6000, 2 m along: (2000, 5700) in the view.
  const [x, y] = at(2000, 5700)
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

test('keeps a socket dragged in an elevation to one way with Shift, on the wall and above the floor', async ({ page }) => {
  const at = await planWithElevation(page)
  const [x, y] = at(2000, 5700)
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
  expect(nodes.find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 4000, y: 0 }, b: { x: 0, y: 0 } })
  expect(nodes.find((n) => n.type === 'elevation')).toMatchObject({ x: 0, y: -1500, name: 'Section 1' })
})


test('shows on the plan what a view line sees, and sets its depth by the handle at its far side', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
  // Its line 1 m in front of the lower face, at y = 1100, what it sees up to the face: the handle on the face at (2000, 100).
  await page.mouse.move(...at(2000, 100))
  await page.mouse.down()
  await page.mouse.move(...at(2000, 600), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'viewline')).toMatchObject({ depth: 500 })
  await expect(field(page, 'Depth')).toHaveValue('500')
})

test('drags an edge of what a view line sees across, as a wall’s face, taken anywhere along it', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
  // The line itself, at y = 1100, taken 1 m from its start and brought 400 nearer the face: the far side stays on it.
  await page.mouse.move(...at(1000, 1100))
  await page.mouse.down()
  await page.mouse.move(...at(1300, 700), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 0, y: 700 }, b: { x: 4000, y: 700 }, depth: 600 })
  // The side at its end, from x = 4000 to 3000: the views show less of the face.
  await page.mouse.move(...at(4000, 400))
  await page.mouse.down()
  await page.mouse.move(...at(3000, 500), { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 0, y: 700 }, b: { x: 3000, y: 700 } })
})

test('takes a corner of what a view line sees before the edges meeting there and the corner of the walls beside it', async ({ page }) => {
  const at = await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
  // Its far corner at the end is on the face at (4000, 100), beside the end of the wall: pressed a few
  // pixels along the far edge from it, it is the corner that is dragged, turning the area about its start.
  const [x, y] = at(4000, 100)
  await page.mouse.move(x - 6, y + 1)
  await page.mouse.down()
  await page.mouse.move(...at(4000, -900), { steps: 8 })
  await page.mouse.up()
  const nodes = await saved(page)
  const line = nodes.find((n) => n.type === 'viewline')
  expect(line).toMatchObject({ a: { x: 0, y: 1100 }, depth: 1000 })
  expect(line.b.y).toBeLessThan(1000)
  // The wall did not move.
  expect(nodes.find((n) => n.type === 'wall')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
})

test('copies a view as another view of the same line, which stays on the plan', async ({ page }) => {
  await planWithElevation(page)
  await objectRows(page).filter({ hasText: 'North' }).click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'viewline')).toMatchObject([{ id: 'l', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 } }])
  expect(nodes.filter((n) => n.type === 'elevation').map((n) => n.line)).toEqual(['l', 'l'])
})

test('says which line a view is of, and makes it a view of another one picked from the list', async ({ page }) => {
  const at = await planWithElevation(page)
  // A second line, drawn with the tool away from the wall: a section across the plan, its view put down below.
  await page.keyboard.press('Shift+W')
  await page.mouse.click(...at(500, 2500))
  await page.mouse.click(...at(3500, 2500))
  await page.mouse.click(...at(500, 3500))
  await objectRows(page).filter({ hasText: 'North' }).click()
  const choice = page.locator('.field', { has: page.locator('span:text-is("View line")') }).locator('select')
  await expect(choice.locator('option:checked')).toHaveText('Wall line')
  await choice.selectOption({ label: 'View line 2' })
  const nodes = await saved(page)
  const other = nodes.find((n) => n.type === 'viewline' && n.id !== 'l')
  expect(nodes.find((n) => n.id === 'e')).toMatchObject({ line: other.id })
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
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
  // Its end at x = 5000, taken by its arrow (20 pixels from the end, where the corner's point is not),
  // dragged back to 3000, a little off the line: it stays on its line, the view still of the face.
  const [ex, ey] = at(5000, 1100)
  await page.mouse.move(ex, ey + 20)
  await page.mouse.down()
  const [tx, ty] = at(3000, 1150)
  await page.mouse.move(tx, ty + 20, { steps: 8 })
  await page.mouse.up()
  expect((await saved(page)).find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 1000, y: 1100 }, b: { x: 3000, y: 1100 } })
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
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
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
  expect(nodes.find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 2000, y: 1100 }, b: { x: 5000, y: 1100 } })
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
  await objectRows(page).filter({ hasText: 'Wall line' }).click()
  // Its far corner at the end, on the face at (5000, 100), dragged with Shift to (4000, 400): it keeps its way, shorter, and seeing 700 deep.
  await page.mouse.move(...at(5000, 100))
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(...at(4000, 400), { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect((await saved(page)).find((n) => n.type === 'viewline')).toMatchObject({ a: { x: 1000, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 700 })
  // Without Shift, the same corner dragged 1.5 m further up turns the area about its start, 700 deep still.
  await page.mouse.move(...at(4000, 400))
  await page.mouse.down()
  await page.mouse.move(...at(4000, -1100), { steps: 8 })
  await page.mouse.up()
  const turned = (await saved(page)).find((n) => n.type === 'viewline')!
  expect(turned).toMatchObject({ a: { x: 1000, y: 1100 }, depth: 700 })
  expect(turned.b.y).toBeLessThan(1000)
})
