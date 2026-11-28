import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawingOnScreen, failOnErrors, openEditor, pickIn, recordSaves, startWith } from './support'

/*
 * Viewpoints: drawn on the plan with their tool, what they see shown in a frame on the plan, drawn
 * by WebGL, and what they are set to in Properties, with the description for an image model.
 */

failOnErrors()

type Saved = { type: string; [key: string]: any }

async function saved(page: Page): Promise<Saved[]> {
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  return Object.values(doc.nodes as Record<string, Saved>).filter((node) => node.type !== 'page')
}

/** How many pixels of the view on the plan are dark: the lines it draws. */
const inked = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector<HTMLCanvasElement>('.view-frame canvas')
    if (!view || view.width === 0) return 0
    const copy = document.createElement('canvas')
    copy.width = view.width
    copy.height = view.height
    const context = copy.getContext('2d')!
    context.drawImage(view, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
    return dark
  })

/** How many pixels of the view on the plan are of the accent colour, blue: what is selected, lit. */
const lit = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector<HTMLCanvasElement>('.view-frame canvas')
    if (!view || view.width === 0) return 0
    const copy = document.createElement('canvas')
    copy.width = view.width
    copy.height = view.height
    const context = copy.getContext('2d')!
    context.drawImage(view, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    let blue = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 2] > 180 && data[i] < 140 && data[i + 2] - data[i] > 80) blue++
    return blue
  })

test('draws a viewpoint in a room, shows what it sees beside the plan, and sets it in Properties with a description', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  // A blank drawing: 0.1 px per mm, its origin 320 across and 220 down.
  const at = (x: number, y: number) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
  // A room 4 m by 3 m.
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await page.mouse.click(at(x, y).x, at(x, y).y)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+P')
  await expect(page.locator('.hint-bar')).toContainText('Click where you stand')
  // In a corner, looking across at the one opposite: two walls, their corner, the floor and the ceiling.
  await page.mouse.click(at(500, 2500).x, at(500, 2500).y)
  await expect(page.locator('.hint-bar')).toContainText('Click the way you look')
  await page.mouse.click(at(3500, 500).x, at(3500, 500).y)
  // Drawn once and selected, the tool back to selecting.
  await expect(page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' })).toHaveClass(/selected/)

  const camera = (await saved(page)).find((n) => n.type === 'camera')
  expect(camera).toMatchObject({ a: { x: 500, y: 2500 }, b: { x: 3500, y: 500 }, name: 'Viewpoint 1' })

  // Its view is on the plan, in a frame of its own, put in sight: moved by its name, the viewpoint
  // staying where it is, in one step of undo.
  expect(camera!.frame.width).toBeGreaterThan(0)
  const label = (await page.locator('.view-frame-name').boundingBox())!
  await page.mouse.move(label.x + 10, label.y + label.height / 2)
  await page.mouse.down()
  await page.mouse.move(label.x - 40, label.y + label.height / 2)
  await page.mouse.move(label.x - 90, label.y + label.height / 2)
  await page.mouse.up()
  const placed = (await saved(page)).find((n) => n.type === 'camera')!
  expect(placed.frame.x).toBeCloseTo(camera!.frame.x - 1000, -1)
  expect(placed.a).toEqual(camera!.a)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  expect((await saved(page)).find((n) => n.type === 'camera')!.frame).toEqual(camera!.frame)
  await page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' }).click()

  // Its view draws the walls ahead: lines where they meet the floor, each other and the ceiling;
  // Properties sets it.
  const panel = page.locator('[data-panel="properties"]')
  await expect(page.locator('.view-frame canvas')).toBeVisible()
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)
  await expect(panel.locator('textarea')).toHaveValue(/shot from eye level 1\.50 m above the floor with a 26 mm lens \(70° horizontal field of view\), f\/5\.6, the camera level/)
  // Only how it was taken: the picture shows what is in view. A button under it copies it.
  await expect(panel.locator('textarea')).not.toHaveValue(/In view/)
  await expect(panel.locator('.perspective-copy')).toHaveText('Copy')

  // Its eye raised, typed in Properties: the description follows.
  const field = (name: string) => panel.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await field('Eye height').fill('1600')
  await field('Eye height').press('Enter')
  await expect(panel.locator('textarea')).toHaveValue(/1\.60 m above the floor/)
  // A 24 mm lens sees 74° across.
  await field('Lens').fill('24')
  await field('Lens').press('Enter')
  await expect(panel.locator('.field', { has: page.locator('span:text-is("Lens")') })).toContainText('mm · 74°')
  await expect(panel.locator('textarea')).toHaveValue(/74° horizontal field of view/)
  // Tilted 10° down, typed: it says so, and its vertical lines no longer stay vertical.
  await field('Tilt').fill('-10')
  await field('Tilt').press('Enter')
  await expect(panel.locator('textarea')).toHaveValue(/\(74° horizontal field of view\), f\/5\.6, the camera tilted 10° down/)
  await field('Tilt').fill('0')
  await field('Tilt').press('Enter')
  expect((await saved(page)).find((n) => n.type === 'camera')).toMatchObject({ eyeHeight: 1600, fov: 73.7 })
  // There is no panel of its own any more: Properties is where it is set.
  await expect(page.locator('.perspective')).toHaveCount(0)
  // Drawn shaded, then as lines again, chosen under Rendering.
  const rendering = panel.locator('.field', { has: page.locator('span:text-is("Rendering")') }).locator('.select')
  await pickIn(page, rendering, 'Shaded')
  await expect(rendering).toHaveText('Shaded')
  await pickIn(page, rendering, 'Lines')

  // The view dragged to the left and down: it looks further right and up, standing where it was, in one step of undo.
  const view = (await page.locator('.view-frame canvas').boundingBox())!
  const middle = { x: view.x + view.width / 2, y: view.y + view.height / 2 }
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(middle.x - (i * view.width) / 20, middle.y + (i * view.height) / 20)
  await page.mouse.up()
  await expect(panel.locator('textarea')).toHaveValue(/the camera tilted \d+° up/)
  const turned = (await saved(page)).find((n) => n.type === 'camera')!
  expect(turned.a).toEqual({ x: 500, y: 2500 })
  expect(turned.pitch).toBeGreaterThan(5)
  // Turned to the right of the way it looked (north-east, Y down): further round towards south-east.
  const way = (p: { x: number; y: number }) => Math.atan2(p.y - 2500, p.x - 500)
  expect(way(turned.b)).toBeGreaterThan(way({ x: 3500, y: 500 }) + 0.2)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  // Nothing selected, Properties shows no viewpoint: the drawing says it is level again.
  expect((await saved(page)).find((n) => n.type === 'camera')!.pitch).toBeUndefined()

  // Dragged with the middle button to the left and up: it steps to its right and lowers its eye,
  // looking the same way, in one step of undo.
  const heading = (c: Saved) => Math.atan2(c.b.y - c.a.y, c.b.x - c.a.x)
  const standing = (await saved(page)).find((n) => n.type === 'camera')!
  // Its viewpoint no longer selected, nor anything picked in its view, a drag in its view selects it
  // and moves it on the plan, as any object pressed and dragged: working on the plan never turns a
  // view by mistake. Undone, it is back where it was.
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(middle.x + i * 10, middle.y)
  await page.mouse.up()
  await expect(page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' })).toHaveClass(/selected/)
  const carried = (await saved(page)).find((n) => n.type === 'camera')!
  expect({ ...carried, frame: undefined }).toEqual({ ...standing, frame: undefined })
  expect(carried.frame.x).toBeGreaterThan(standing.frame?.x ?? -Infinity)
  await page.keyboard.press('Control+z')
  expect((await saved(page)).find((n) => n.type === 'camera')).toEqual(standing)
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down({ button: 'middle' })
  for (let i = 1; i <= 5; i++) await page.mouse.move(middle.x - i * 10, middle.y - i * 6)
  await page.mouse.up({ button: 'middle' })
  await expect(panel.locator('textarea')).not.toHaveValue(/1\.60 m above the floor/)
  const stepped = (await saved(page)).find((n) => n.type === 'camera')!
  expect(stepped.eyeHeight).toBeLessThan(1600)
  expect(heading(stepped)).toBeCloseTo(heading(standing), 3)
  // Its right, looking north-east with Y down, is towards the south-east: x and y both grow.
  expect(stepped.a.x).toBeGreaterThan(standing.a.x)
  expect(stepped.a.y).toBeGreaterThan(standing.a.y)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  expect((await saved(page)).find((n) => n.type === 'camera')!.eyeHeight).toBe(1600)

  // The wheel turned forward over the view walks 75 cm the way it looks, the panel not scrolling;
  // the turns that follow one another are one step of undo.
  const scrolled = () => page.evaluate(() => document.querySelector('[data-panel="properties"]')!.closest('.dock-panel')?.scrollTop ?? 0)
  const scrolledBefore = await scrolled()
  // Nothing selected, a first click on the view selects the view, as a first click on a group does.
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await page.mouse.click(middle.x, middle.y)
  await expect(page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' })).toHaveClass(/selected/)
  // Then a click in it selects what it shows there, the plan's own object: the wall ahead, which
  // Properties then shows. The view stays entered while it is selected.
  await page.mouse.click(middle.x, middle.y)
  await expect(panel).toContainText('Thickness')
  await expect(page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' })).not.toHaveClass(/selected/)
  // The view shows which: the wall lit, tinted and outlined in the accent colour.
  await expect.poll(() => lit(page), { timeout: 10000 }).toBeGreaterThan(500)
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.wheel(0, -100)
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(700)
  const walked = (await saved(page)).find((n) => n.type === 'camera')!
  const [dx, dy] = [walked.a.x - standing.a.x, walked.a.y - standing.a.y]
  expect(Math.hypot(dx, dy)).toBeCloseTo(750, -1)
  expect(Math.atan2(dy, dx)).toBeCloseTo(heading(standing), 2)
  expect(heading(walked)).toBeCloseTo(heading(standing), 3)
  expect(await scrolled()).toBe(scrolledBefore)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  // Nothing selected, nothing lit.
  await expect.poll(() => lit(page), { timeout: 10000 }).toBe(0)
  await page.keyboard.press('Control+z')
  expect((await saved(page)).find((n) => n.type === 'camera')!.a).toEqual(standing.a)
  // With Ctrl, turned back, a shorter lens: it sees wider, standing where it was.
  await page.mouse.click(middle.x, middle.y)
  await page.mouse.move(middle.x, middle.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 200)
  await page.keyboard.up('Control')
  await page.waitForTimeout(700)
  const wider = (await saved(page)).find((n) => n.type === 'camera')!
  expect(wider.fov).toBeGreaterThan(standing.fov + 20)
  expect(wider.a).toEqual(standing.a)
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')

  // A wall drawn on the plan, across the room: the view follows once it is drawn.
  const before = await inked(page)
  await page.keyboard.press('w')
  // A drawing tool in hand, the views let the plan have the pointer.
  await expect(page.locator('.view-frame')).toHaveClass(/passive/)
  await page.mouse.click(at(2000, 0).x, at(2000, 0).y)
  await page.mouse.click(at(2000, 1500).x, at(2000, 1500).y)
  await page.keyboard.press('Escape')
  await expect.poll(() => inked(page), { timeout: 15000 }).not.toBe(before)
})

test('keeps a viewpoint and its view on the page when it is made into a component, and sizes its view by its sides and corners', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  // A room, and a viewpoint whose frame says no height: 16:9.
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Viewpoint 1', a: { x: 500, y: 2500 }, b: { x: 3500, y: 500 }, frame: { x: 5000, y: 0, width: 4000 } },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const row = page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' })
  await expect(page.locator('.view-frame canvas')).toBeVisible()

  // Alone, it is not made into a component: it says why, and stays a viewpoint with its view.
  await row.click()
  await page.keyboard.press('Control+Alt+k')
  await expect(page.locator('.toast')).toContainText('viewpoint stays on the page')
  expect((await saved(page)).filter((n) => n.type === 'component')).toEqual([])
  // With the room around it: the walls make the component, the viewpoint stays on the page, its view still drawn.
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(async () => (await saved(page)).filter((n) => n.type === 'component').length).toBe(1)
  const nodes = await saved(page)
  expect(nodes.find((n) => n.id === 'c')).toMatchObject({ parent: 'page_1', a: { x: 500, y: 2500 } })
  expect(nodes.find((n) => n.id === 'n')!.parent).not.toBe('page_1')
  await expect(page.locator('.view-frame canvas')).toBeVisible()
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)

  // Sized by the middle of its bottom side: taller only, its shape its own; by its right side, wider only.
  await row.click()
  const frame = () => saved(page).then((all) => all.find((n) => n.id === 'c')!.frame as { x: number; y: number; width: number; height?: number })
  const drag = async (grip: string, dx: number, dy: number, shift = false) => {
    const box = (await page.locator(`.view-frame-grip.${grip}`).boundingBox())!
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
    await page.mouse.move(x, y)
    await page.mouse.down()
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.move(x + dx, y + dy, { steps: 6 })
    await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
  }
  await drag('s', 0, 60)
  const taller = await frame()
  expect(taller).toMatchObject({ x: 5000, y: 0, width: 4000 })
  expect(taller.height).toBeGreaterThan(2250)
  await drag('e', 80, 0)
  const wider = await frame()
  expect(wider.width).toBeGreaterThan(4000)
  expect(wider.height).toBe(taller.height)
  // By a corner with Shift: larger, keeping its shape, its right side staying where it is.
  // (The left one: the right one is under the edge of the panels by now.)
  await drag('sw', -50, 10, true)
  const larger = await frame()
  expect(larger.width).toBeGreaterThan(wider.width)
  expect(larger.x + larger.width).toBe(wider.x + wider.width)
  expect(larger.width / larger.height!).toBeCloseTo(wider.width / wider.height!, 1)
  // There is no choice of shape in Properties any more: the frame is the shape.
  await expect(page.locator('[data-panel="properties"] [aria-label="Format"]')).toHaveCount(0)

  // Over its view, the arrow: a click selects. The hand is only for a drag.
  const view = page.locator('.view-frame canvas')
  await expect(view).toHaveCSS('cursor', 'default')

  // Its camera fixed (Properties, Camera), it keeps where it stands and the way it looks: a drag in
  // its view and the wheel over it leave it as it is, the wheel zooming the plan.
  const camera = () => saved(page).then((all) => all.find((n) => n.id === 'c')!)
  const properties = page.locator('[data-panel="properties"]')
  await row.click()
  await properties.getByTitle('Fixed: it keeps where it stands and the way it looks, and the wheel over its view zooms the plan').click()
  await expect(page.locator('.view-frame')).toHaveClass(/fixed/)
  const kept = await camera()
  expect(kept.fixed).toBe(true)
  const box = (await view.boundingBox())!
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dragIn = async () => {
    await page.mouse.move(middle.x, middle.y)
    await page.mouse.down()
    await page.mouse.move(middle.x - 80, middle.y + 30, { steps: 6 })
    await page.mouse.up()
  }
  // Dragged in its view, it is carried on the plan, its camera as it was; undone, back.
  await dragIn()
  const carried = await camera()
  expect({ ...carried, frame: undefined }).toEqual({ ...kept, frame: undefined })
  expect(carried.frame).not.toEqual(kept.frame)
  await page.keyboard.press('Control+z')
  expect(await camera()).toEqual(kept)
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.wheel(0, -300)
  await expect.poll(async () => (await view.boundingBox())!.width).toBeGreaterThan(box.width + 10)
  expect(await camera()).toEqual(kept)
  // Free again, it says nothing of it.
  await properties.getByTitle('Free: dragged in its view, or with the wheel over it, it looks around and walks').click()
  await expect(page.locator('.view-frame')).not.toHaveClass(/fixed/)
  expect(await camera()).not.toHaveProperty('fixed')

  // Locked by its Status, the view stays where it is on the plan: neither moved by its name nor
  // sized; but its camera is not fixed by that, and a drag in its view still looks around.
  await properties.getByTitle('Lock so it cannot be selected or moved on the drawing').click()
  await expect(page.locator('.view-frame')).toHaveClass(/locked/)
  await expect(page.locator('.view-frame-grip').first()).toBeHidden()
  const label = page.locator('.view-frame-name')
  const placed = (await camera()).frame
  const shift = async () => {
    const at = (await label.boundingBox())!
    await page.mouse.move(at.x + 10, at.y + at.height / 2)
    await page.mouse.down()
    await page.mouse.move(at.x + 60, at.y + at.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  await shift()
  expect((await camera()).frame).toEqual(placed)
  const looking = await camera()
  const inView = (await view.boundingBox())!
  await page.mouse.move(inView.x + inView.width / 2, inView.y + inView.height / 2)
  await page.mouse.down()
  await page.mouse.move(inView.x + inView.width / 2 - 80, inView.y + inView.height / 2, { steps: 6 })
  await page.mouse.up()
  expect((await camera()).b).not.toEqual(looking.b)

  // Locked, it is still selected by its name above it, which shows a padlock; unlocked there, it moves again by it.
  await page.locator('.stage canvas.canvas').click({ position: { x: 5, y: 5 } })
  await expect(row).not.toHaveClass(/selected/)
  await expect(label.locator('svg')).toHaveCount(1)
  await label.click()
  await expect(row).toHaveClass(/selected/)
  await properties.getByTitle('Unlock').click()
  await expect(page.locator('.view-frame')).not.toHaveClass(/locked/)
  await expect(label.locator('svg')).toHaveCount(0)
  await shift()
  expect((await camera()).frame.x).toBeGreaterThan(placed.x)
})

test("sets a 3D view in Properties as any object: where its view is and how large under Geometry, its eye and the way it looks under Camera", async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      n: { id: 'n', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Viewpoint 1', a: { x: 500, y: 2500 }, b: { x: 3500, y: 500 }, frame: { x: 5000, y: 0, width: 4000 } },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await page.locator('[data-panel="objects"] .row').filter({ hasText: 'Viewpoint 1' }).click()
  const panel = page.locator('[data-panel="properties"]')
  // Its parts, as Structure lists them: its representation (where its view is, how large, how drawn), its camera; then what to say of it.
  await expect(panel.locator('h3')).toContainText(['Representation', 'Camera', 'Description'])
  const pair = (name: string) => panel.locator('.field-pair', { has: page.locator(`.field-pair-name:text-is("${name}")`) }).locator('input')
  await expect(pair('Position')).toHaveCount(2)
  await expect(pair('Position').first()).toHaveValue('5000')
  // A frame that says no height has the one it is shown at, 9/16 of its width.
  await expect(pair('Size').nth(0)).toHaveValue('4000')
  await expect(pair('Size').nth(1)).toHaveValue('2250')
  await expect(pair('Eye').first()).toHaveValue('500')
  await expect(pair('Looks towards').nth(1)).toHaveValue('500')
  // A width typed keeps the height it was shown at: the frame says both from then on.
  await pair('Size').nth(0).fill('6000')
  await pair('Size').nth(0).press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.id === 'c')!.frame).toEqual({ x: 5000, y: 0, width: 6000, height: 2250 })
  // Its proportions kept, a width typed takes its height along, and a height its width.
  await panel.getByRole('button', { name: 'Keep the proportions: width and height change together' }).click()
  await pair('Size').nth(0).fill('8000')
  await pair('Size').nth(0).press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.id === 'c')!.frame).toEqual({ x: 5000, y: 0, width: 8000, height: 3000 })
  await pair('Size').nth(1).fill('1500')
  await pair('Size').nth(1).press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.id === 'c')!.frame).toEqual({ x: 5000, y: 0, width: 4000, height: 1500 })
  // Its eye typed: it stands there, its view where it was.
  await pair('Eye').first().fill('1000')
  await pair('Eye').first().press('Enter')
  await expect.poll(async () => (await saved(page)).find((n) => n.id === 'c')!.a).toEqual({ x: 1000, y: 2500 })
})

test('keeps a view while the plan is zoomed away from it and back, drawing nothing heavy during the zoom', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  // A room with a kitchen along a wall, and a viewpoint whose view is beside it.
  const units = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`u${i}`, { id: `u${i}`, type: 'parametric', parent: 'page_1', layer: 'layer_1', order: `b${i}`, kind: 'arch.baseunit', props: {}, x: 200 + i * 600, y: 100 }]))
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      ...units,
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Viewpoint 1', a: { x: 2000, y: 2800 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 } },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)
  await page.evaluate(() => {
    ;(window as any).kept = document.querySelector('.view-frame canvas')
    ;(window as any).longest = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as any).longest = Math.max((window as any).longest, entry.duration)
    }).observe({ type: 'longtask' })
  })
  // Zoomed in on the far corner of the room, the view out of sight; then out again, step by step.
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + 60, box.y + box.height - 60)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120)
  await page.waitForTimeout(600)
  // Out of sight, past the right of the plan: kept all the same.
  const away = (await page.locator('.view-frame').boundingBox())!
  expect(away.x).toBeGreaterThan(box.x + box.width)
  await page.evaluate(() => ((window as any).longest = 0))
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(16)
  }
  // During the zoom nothing was made again: no task long enough to stop the plan moving.
  expect(await page.evaluate(() => (window as any).longest)).toBeLessThan(120)
  // The same view, kept all along, its picture there at once, then drawn again at its size.
  expect(await page.evaluate(() => (window as any).kept === document.querySelector('.view-frame canvas'))).toBe(true)
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)
})

test('shows the picture a view keeps from the moment its drawing opens, and draws the view only once the plan stands still', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  // The picture the view kept at its last save: all red, so as to be told apart from the view.
  const red = await page.evaluate(() => {
    const picture = document.createElement('canvas')
    picture.width = 160
    picture.height = 100
    const context = picture.getContext('2d')!
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 160, 100)
    return picture.toDataURL('image/png').split(',')[1]
  })
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Viewpoint 1', a: { x: 2000, y: 2800 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 }, picture: 'asset_p' },
    },
    { version: 6, assets: { asset_p: { id: 'asset_p', mime: 'image/png', data: red, width: 160, height: 100 } } },
  )
  /** Whether the plan paints the middle of the view's frame red: the picture kept, not the view. */
  const keptShown = () =>
    page.evaluate(() => {
      const plan = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')!
      const frame = document.querySelector('.view-frame')!.getBoundingClientRect()
      const at = plan.getBoundingClientRect()
      const scale = plan.width / at.width
      const copy = document.createElement('canvas')
      copy.width = plan.width
      copy.height = plan.height
      copy.getContext('2d')!.drawImage(plan, 0, 0)
      const [r, g, b] = copy.getContext('2d')!.getImageData(Math.round((frame.left + frame.width / 2 - at.left) * scale), Math.round((frame.top + frame.height / 2 - at.top) * scale), 1, 1).data
      return r > 200 && g < 80 && b < 80
    })
  // Not yet drawn, its canvas is as the browser makes it, 300 pixels wide.
  const drawnLive = () => page.evaluate(() => document.querySelector<HTMLCanvasElement>('.view-frame canvas')!.width !== 300)
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  // Panned about at once, and on for two seconds: the picture it keeps is shown, and the view waits.
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(keptShown).toBe(true)
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(i % 20 < 10 ? 8 : -8, 0)
    await page.waitForTimeout(50)
  }
  expect(await drawnLive()).toBe(false)
  expect(await keptShown()).toBe(true)
  // The plan still, the view is drawn, and shown in place of the picture.
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)
  await expect.poll(keptShown).toBe(false)
})

test('exports the eyes of viewpoints and the lines of views only when asked to in the export window', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      n: { id: 'n', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Viewpoint 1', a: { x: 2000, y: 2500 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 } },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const svg = async () => {
    const count: number = await page.evaluate(() => (window as any).saves.length)
    await page.keyboard.press('Control+e')
    await page.getByRole('radio', { name: /SVG/ }).click()
    await page.locator('.dialog.export footer button').click()
    await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
    return page.evaluate(() => (window as any).saves.at(-1) as string)
  }
  // As it comes: the wall and the picture of the view, in its frame; not the eye, which is drawn on the plan to work with.
  const plain = await svg()
  expect(plain).toContain('<path')
  expect(plain).not.toContain('<ellipse')
  expect(plain).toMatch(/<image[^>]*data:image\/png;base64,/)
  // The drawing keeps that picture, and saved, its file holds it.
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBeGreaterThan(1)
  const file = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1) as string))
  expect(file.assets[file.nodes.c.picture]).toMatchObject({ mime: 'image/png' })
  // Asked for: the eye too, and the choice is kept for the next export.
  await page.keyboard.press('Control+e')
  const option = page.getByRole('checkbox', { name: 'Viewpoints and view lines' })
  await expect(option).not.toBeChecked()
  await option.check()
  await page.keyboard.press('Escape')
  const marked = await svg()
  expect(marked).toContain('<ellipse')
  await page.keyboard.press('Control+e')
  await expect(option).toBeChecked()
})

test('moves a view to another page from its right-click menu, keeps its eye on the plan, and comes back by cut and paste', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Viewpoint 1', a: { x: 2000, y: 2500 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 } },
      sheet: { id: 'sheet', type: 'page', parent: null, order: 'a1', name: 'Sheet' },
      ...Object.fromEntries(['Upstairs', 'Garden', 'Details'].map((name, i) => [`p${i}`, { id: `p${i}`, type: 'page', parent: null, order: `a${i + 2}`, name }])),
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const camera = () => saved(page).then((all) => all.find((n) => n.type === 'camera')!)

  // Right-clicked, the view opens the menu of the viewpoint: one entry, Move to page, whose pages
  // open beside it when the pointer comes onto it, however many there are.
  await page.locator('.view-frame canvas').click({ button: 'right' })
  const menu = page.locator('.context-menu:not(.submenu)')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Sheet|Upstairs|Garden|Details/ })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Move to page' }).hover()
  const pages = page.locator('.context-menu.submenu')
  await expect(pages.getByRole('menuitem')).toHaveText(['Sheet', 'Upstairs', 'Garden', 'Details'])
  // Beside the menu, not over it.
  expect((await pages.boundingBox())!.x).toBeGreaterThanOrEqual((await menu.boundingBox())!.x + (await menu.boundingBox())!.width - 1)
  await pages.getByRole('menuitem', { name: 'Sheet' }).click()
  // On the sheet now, with it in sight; still looking at the plan, from where it stood.
  await expect(page.locator('.view-frame canvas')).toBeVisible()
  expect(await camera()).toMatchObject({ parent: 'sheet', page: 'page_1', a: { x: 2000, y: 2500 } })
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)

  // Back on the plan: no view there, but its eye, which a click selects, with what it is set to.
  await page.locator('.rail-tab[title="Pages"]').click()
  await page.locator('[data-panel="pages"] .row').filter({ hasText: 'Page 1' }).click()
  await expect(page.locator('.view-frame')).toHaveCount(0)
  await canvas(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+1')
  const at = await drawingOnScreen(page)
  await page.mouse.click(...at(2000, 2500))
  await expect(page.locator('[data-panel="properties"]')).toContainText('Lens')
  await expect(page.locator('[data-panel="properties"] .field', { has: page.locator('span:text-is("Plan on page")') })).toContainText('Page 1')
  // Picked by its eye, Properties opens on its camera: the rest folded, until a heading is clicked.
  const properties = page.locator('[data-panel="properties"]')
  const section = (title: string) => properties.locator('section.section', { has: page.locator('h3', { hasText: new RegExp(`^${title}$`) }) })
  await expect(section('Representation')).toHaveClass(/folded/)
  await expect(section('Description')).toHaveClass(/folded/)
  await expect(section('Camera')).not.toHaveClass(/folded/)
  await section('Representation').locator('h3 button').click()
  await expect(section('Representation')).not.toHaveClass(/folded/)
  await expect(section('Description')).not.toHaveClass(/folded/)

  // On the sheet, Structure lists its parts under it: its camera, faint, on the plan of Page 1,
  // which a click goes to, the viewpoint selected and Properties on its camera; its picture, there.
  await page.locator('[data-panel="pages"] .row').filter({ hasText: 'Sheet' }).click()
  const rows = page.locator('[data-panel="objects"] .row')
  await rows.filter({ hasText: 'Viewpoint 1' }).getByTitle('Show what is inside').click()
  const cameraPart = rows.filter({ hasText: /^Camera/ })
  await expect(cameraPart).toHaveClass(/elsewhere/)
  await expect(cameraPart).toContainText('Page 1')
  await expect(rows.filter({ hasText: /^Representation$/ })).not.toHaveClass(/elsewhere/)
  await cameraPart.click()
  await expect(page.locator('[data-panel="pages"] .row').filter({ hasText: 'Page 1' })).toHaveClass(/selected/)
  await expect(page.locator('.view-frame')).toHaveCount(0)
  await expect(section('Camera')).not.toHaveClass(/folded/)
  await expect(section('Representation')).toHaveClass(/folded/)

  // On Page 1, whose plan it looks at, Structure lists it too, at the top, faint, with the page it is
  // drawn on; its camera is here, its representation on the sheet, which a click goes to.
  const here = rows.filter({ hasText: /^Viewpoint 1/ })
  await expect(here).toHaveClass(/foreign-view/)
  await expect(here).toContainText('Sheet')
  await expect(rows.first()).toHaveClass(/foreign-view/)
  if ((await here.getByRole('button').first().getAttribute('title')) === 'Show what is inside') await here.getByRole('button').first().click()
  await expect(rows.filter({ hasText: /^Camera/ })).not.toHaveClass(/elsewhere/)
  const representation = rows.filter({ hasText: /^Representation/ })
  await expect(representation).toHaveClass(/elsewhere/)
  await expect(representation).toContainText('Sheet')
  await here.click()
  await expect(here).toHaveClass(/selected/)
  await representation.click()
  await expect(page.locator('[data-panel="pages"] .row').filter({ hasText: 'Sheet' })).toHaveClass(/selected/)
  await expect(page.locator('.view-frame canvas')).toBeVisible()
  await expect(section('Representation')).not.toHaveClass(/folded/)
  await expect(section('Camera')).toHaveClass(/folded/)

  // Cut on the sheet and pasted on the plan: it is the plan's own view again, looking from where it stood.
  await page.locator('[data-panel="pages"] .row').filter({ hasText: 'Sheet' }).click()
  await page.locator('.view-frame-name').click()
  await page.keyboard.press('Control+x')
  await expect.poll(async () => (await saved(page)).filter((n) => n.type === 'camera').length).toBe(0)
  await page.locator('[data-panel="pages"] .row').filter({ hasText: 'Page 1' }).click()
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await saved(page)).filter((n) => n.type === 'camera').length).toBe(1)
  const back = await camera()
  expect(back).toMatchObject({ parent: 'page_1', a: { x: 2000, y: 2500 }, b: { x: 2000, y: 1000 } })
  expect(back).not.toHaveProperty('page')
  await expect(page.locator('.view-frame canvas')).toBeVisible()
})

test('hides the frames and names of a 3D view and an elevation under a shape stacked over them, and shows them again once selected', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const plan = drawing(
    {
      n: { id: 'n', type: 'wall', parent: 'page_1', layer: 'layer_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a2', name: 'Viewpoint 1', a: { x: 2000, y: 2500 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 } },
      e: { id: 'e', type: 'elevation', parent: 'page_1', layer: 'layer_1', order: 'a3', a: { x: 0, y: 1100 }, b: { x: 4000, y: 1100 }, depth: 1000, x: 10000, y: 3000, name: 'North' },
      // Pasted over both, as a sheet of colour: their names and the frame went on showing through it.
      blue: { id: 'blue', type: 'rect', parent: 'page_1', layer: 'layer_1', order: 'a4', name: 'Blue', x: 4000, y: -2000, width: 12000, height: 6000, style: { fill: '#1449a0' } },
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(page.locator('.view-frame')).toHaveClass(/covered/)
  await expect(page.locator('.view-frame')).toHaveClass(/name-covered/)
  await expect(page.locator('.view-frame .view-frame-name')).toBeHidden()
  await expect(page.locator('.view-label')).toHaveClass(/covered/)
  await expect(page.locator('.view-label .view-frame-name')).toBeHidden()
  // Selected, in Structure, each shows its name and its frame again, to be worked with.
  const rows = page.locator('[data-panel="objects"] .row')
  await rows.filter({ hasText: /^Viewpoint 1/ }).click()
  await expect(page.locator('.view-frame')).not.toHaveClass(/covered/)
  await expect(page.locator('.view-frame .view-frame-name')).toBeVisible()
  await rows.filter({ hasText: /^North/ }).click()
  await expect(page.locator('.view-label .view-frame-name')).toBeVisible()
  // The shape sent under them: nothing covers them.
  await rows.filter({ hasText: /^Blue/ }).click()
  await page.keyboard.press('[')
  await expect(page.locator('.view-frame')).not.toHaveClass(/covered/)
  await expect(page.locator('.view-label')).not.toHaveClass(/covered/)
})

test('paints a 3D view in the stacking order of Structure, and zooms on its eye or on its view from its menu', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], order: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const rect = (id: string, order: string, x: number, fill: string, name: string) => ({ id, type: 'rect', parent: 'page_1', layer: 'layer_1', order, name, x, y: 500, width: 1000, height: 1000, style: { fill } })
  const plan = drawing(
    {
      n: wall('n', [0, 0], [4000, 0], 'a1'),
      e: wall('e', [4000, 0], [4000, 3000], 'a2'),
      s: wall('s', [4000, 3000], [0, 3000], 'a3'),
      w: wall('w', [0, 3000], [0, 0], 'a4'),
      // Under the viewpoint, and over it, both on its view.
      under: rect('under', 'a5', 5500, '#0000ff', 'Under'),
      c: { id: 'c', type: 'camera', parent: 'page_1', layer: 'layer_1', order: 'a6', name: 'Viewpoint 1', a: { x: 2000, y: 2500 }, b: { x: 2000, y: 1000 }, frame: { x: 5000, y: 0, width: 4000, height: 2500 } },
      over: rect('over', 'a7', 7000, '#ff0000', 'Over'),
    },
    { version: 6 },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect.poll(() => inked(page), { timeout: 15000 }).toBeGreaterThan(200)
  // Where a point of the drawing is on screen, from where the view's frame (5000, 0, 4000 × 2500) is.
  const onScreen = async () => {
    const f = (await page.locator('.view-frame').boundingBox())!
    return (x: number, y: number): [number, number] => [f.x + ((x - 5000) * f.width) / 4000, f.y + (y * f.height) / 2500]
  }
  const at = await onScreen()
  const box = (await canvas(page).boundingBox())!
  /** The colour the plan shows at a point of the drawing. */
  const colour = (x: number, y: number) =>
    page.evaluate(([px, py]) => {
      const plan = document.querySelector<HTMLCanvasElement>('.stage canvas.canvas')!
      const scale = plan.width / plan.getBoundingClientRect().width
      const [r, g, b] = plan.getContext('2d')!.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data
      return [r, g, b]
    }, [at(x, y)[0] - box.x, at(x, y)[1] - box.y])
  // What is stacked over the viewpoint shows over its view; what is under it does not.
  await expect.poll(async () => (await colour(7500, 1000))[0]).toBeGreaterThan(200)
  expect((await colour(7500, 1000))[2]).toBeLessThan(80)
  const [r, , b] = await colour(6000, 1000)
  expect(r < 80 && b > 200).toBe(false)
  // A click on what is over the view is the plan's: it selects it, not the view.
  await page.mouse.click(...at(7500, 1000))
  await expect(page.locator('[data-panel="objects"] .row').filter({ hasText: 'Over' })).toHaveClass(/selected/)

  // Right-clicked, the view offers to zoom on its eye, on the plan, or on its view; not on "it".
  await page.mouse.click(...at(6000, 2200), { button: 'right' })
  const menu = page.locator('.context-menu:not(.submenu)')
  await expect(menu.getByRole('menuitem', { name: 'Zoom to the view' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Zoom to it', exact: true })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Zoom to the eye' }).click()
  // The eye in the middle of the plan's area now.
  const near = await onScreen()
  const [ex, ey] = near(2000, 2000)
  expect(Math.abs(ex - (box.x + box.width / 2))).toBeLessThan(80)
  expect(Math.abs(ey - (box.y + box.height / 2))).toBeLessThan(120)
  // And back to its view, from the eye's own menu.
  await page.mouse.click(...near(2000, 2500), { button: 'right' })
  await menu.getByRole('menuitem', { name: 'Zoom to the view' }).click()
  const view = (await page.locator('.view-frame').boundingBox())!
  expect(Math.abs(view.x + view.width / 2 - (box.x + box.width / 2))).toBeLessThan(40)
})
