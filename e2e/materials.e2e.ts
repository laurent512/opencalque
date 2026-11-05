import { expect, test, type Page } from '@playwright/test'
import { canvas, choose, drawing, drawWall, failOnErrors, librarySection, objectRows, openEditor, recordSaves, startWith } from './support'

/**
 * Materials, the walls made of them, and tables of quantities, as people use them
 * in the editor. What a test checks is read back from the saved drawing.
 */

failOnErrors()

/** The drawing as it was saved last. */
async function saved(page: Page) {
  await page.keyboard.press('Control+s')
  return JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
}

test('gives walls a material picked from the list of those of the drawing, each with its swatch, or a new one made from it, several at once', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  await drawWall(page, [300, 300], [700, 300])
  await objectRows(page).first().click()
  const material = page.locator('.field', { has: page.locator('span:text-is("Material")') }).locator('.material-choice > button')
  const thickness = page.locator('.field', { has: page.locator('span:text-is("Thickness")') }).locator('input')
  const list = page.locator('.material-menu')
  await thickness.fill('300')
  await thickness.press('Enter')
  // Of the default material to begin with. A name the drawing has no material of: the + makes one, and gives it to the wall.
  await expect(material).toHaveText('Default')
  await material.click()
  await page.getByPlaceholder('Find a material…').fill('Brick')
  await expect(list.locator('.hint')).toHaveText('No material by that name: the + makes one.')
  await list.getByRole('button', { name: 'New material “Brick”' }).click()
  let doc = await saved(page)
  const brick = Object.values(doc.materials).find((m: any) => m.name === 'Brick') as { id: string }
  let walls = Object.values(doc.nodes).filter((n: any) => n.type === 'wall') as { material?: string; thickness: number }[]
  expect(walls[0]).toMatchObject({ material: brick.id, thickness: 300 })

  // Another wall, of the default material: selected with the first, both are given one, found by part of its name.
  await drawWall(page, [300, 450], [700, 450])
  await page.keyboard.press('Control+a')
  await expect(material).toHaveText('Mixed')
  await material.click()
  // The drawing's materials only, the default first, each with its swatch.
  await expect(list.locator('.color-option')).toHaveText(['Default', 'Brick'])
  await expect(list.locator('.color-option .fill-swatch')).toHaveCount(2)
  await page.getByPlaceholder('Find a material…').fill('bri')
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  doc = await saved(page)
  walls = Object.values(doc.nodes).filter((n: any) => n.type === 'wall') as typeof walls
  expect(walls.map((wall) => wall.material)).toEqual([brick.id, brick.id])

  // The materials are the drawing's, in the Materials panel, after the default one: opened when one was made, for its look to be set.
  const rows = page.locator('[data-panel="materials"] .row.material')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Default')
})

test('gives a floor a material, and places a table of quantities that counts the floors and follows the drawing', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const plan = drawing(
    {
      ...Object.fromEntries(
        [wall('1', [0, 0], [5000, 0]), wall('2', [5000, 0], [5000, 4000]), wall('3', [5000, 4000], [0, 4000]), wall('4', [0, 4000], [0, 0])].map((w) => [w.id, w]),
      ),
      // Given a fill of its own before, as rooms could be.
      r: { id: 'r', type: 'room', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Living room', x: 2500, y: 2000, style: { fill: '#ff0000', stroke: '#333333' } },
    },
    { version: 2, materials: { oak: { id: 'oak', name: 'Oak', fill: '#d9b98c' } } },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(5)
  await objectRows(page).filter({ hasText: 'Living room' }).click()
  await expect(page.locator('[data-panel="properties"] .fill-field')).toHaveCount(1)
  await page.locator('.field', { has: page.locator('span:text-is("Material")') }).locator('.material-choice > button').click()
  await page.locator('.material-menu .color-option', { hasText: 'Oak' }).click()
  // Its look is now the material's, as a wall's is: its own fill went, and there is none to set.
  await expect(page.locator('[data-panel="properties"] .fill-field')).toHaveCount(0)

  await page.getByTitle('Object library: stairs, furniture and every other object').click()
  await librarySection(page, 'Tables of quantities').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Objects placed', 'Floor areas by material', 'Rooms', 'Walls by material', 'Doors and windows'])
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: 'Floor areas by material' }) }).click()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + 650, box.y + 150, { steps: 4 })
  await page.mouse.click(box.x + 650, box.y + 150)
  // Put down once, and selected to be set up.
  await expect(page.locator('[data-panel="objects"] .row.selected')).toHaveText(/Table of quantities/)
  await page.locator('.table-columns').getByRole('radiogroup', { name: 'Rooms' }).getByRole('radio', { name: 'Yes' }).click()

  const doc = await saved(page)
  const table = Object.values(doc.nodes).find((n: any) => n.type === 'table') as Record<string, any>
  // Its numbers are written as the drawing writes them, and its words leave the unit to it.
  expect(table).toMatchObject({ schedule: 'floors', title: 'Floor areas by material', columns: ['material', 'rooms', 'area'], language: 'en' })
  expect(table.system).toBeUndefined()
  expect(table.labels).toMatchObject({ material: 'Material', area: 'Area ({unit})', total: 'Total' })
  expect(doc.nodes.r.material).toBe('oak')
  expect(doc.nodes.r.style).toEqual({ stroke: '#333333' })
})

test('writes the numbers of a whole drawing as its settings say, the rooms and tables placed before following them', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  // A room and a table placed by 1.3, each writing its numbers its own way, and the unit in the table's words.
  const plan = drawing({
    ...Object.fromEntries([wall('1', [0, 0], [5000, 0]), wall('2', [5000, 0], [5000, 4000]), wall('3', [5000, 4000], [0, 4000]), wall('4', [0, 4000], [0, 0])].map((w) => [w.id, w])),
    r: { id: 'r', type: 'room', parent: 'page_1', layer: 'layer_1', order: 'a5', name: 'Living room', x: 2500, y: 2000, system: 'metric', decimal: '.' },
    t: { id: 't', type: 'table', parent: 'page_1', layer: 'layer_1', order: 'a6', x: 7000, y: 0, schedule: 'rooms', system: 'metric', labels: { name: 'Name', area: 'Area (m²)' } },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Drawing settings')
  await page.keyboard.press('Enter')
  const window = page.getByRole('dialog', { name: 'Drawing settings' })
  await window.locator('.pref-field', { hasText: 'Units' }).locator('select').selectOption('imperial')
  await window.locator('.pref-field', { hasText: 'Decimal mark' }).locator('select').selectOption(',')
  await window.locator('.pref-field', { hasText: 'Client' }).locator('input').fill('Dupont')
  await window.getByRole('button', { name: 'Done' }).click()

  const doc = await saved(page)
  expect(doc.settings).toEqual({ system: 'imperial', decimal: ',' })
  expect(doc.info).toEqual({ client: 'Dupont' })
  expect(doc.nodes.r.system).toBeUndefined()
  expect(doc.nodes.r.decimal).toBeUndefined()
  expect(doc.nodes.t.system).toBeUndefined()
  expect(doc.nodes.t.labels).toEqual({ name: 'Name', area: 'Area ({unit})' })
  // A room has no units of its own to set any more.
  await objectRows(page).filter({ hasText: 'Living room' }).click()
  await expect(page.locator('.field', { has: page.locator('span:text-is("Area in")') })).toHaveCount(0)
})

test('selects the walls of one material and thickness, then every wall of that material', async ({ page }) => {
  await startWith(page)
  await openEditor(page)
  const wall = (id: string, a: [number, number], b: [number, number], thickness: number, material?: string) => ({ id, type: 'wall', parent: 'page_1', layer: 'layer_1', order: `a${id}`, name: `Wall ${id}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, ...(material ? { material } : {}) })
  const plan = drawing(
    Object.fromEntries([wall('1', [0, 0], [5000, 0], 200, 'brick'), wall('2', [5000, 0], [5000, 4000], 200, 'brick'), wall('3', [5000, 4000], [0, 4000], 300, 'brick'), wall('4', [0, 4000], [0, 0], 200)].map((w) => [w.id, w])),
    { version: 2, materials: { brick: { id: 'brick', name: 'Brick', fill: '#efc7b4' } } },
  )
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const selected = page.locator('[data-panel="objects"] .row.selected')
  await objectRows(page).filter({ hasText: 'Wall 1' }).click()
  await page.keyboard.press('Control+Shift+a')
  // The list shows what is on top first.
  await expect(selected).toHaveText([/Wall 2/, /Wall 1/])
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Select all of the same material')
  await page.keyboard.press('Enter')
  await expect(selected).toHaveText([/Wall 3/, /Wall 2/, /Wall 1/])
})
