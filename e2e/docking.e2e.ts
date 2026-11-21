import { expect, test, type Page } from '@playwright/test'
import { failOnErrors, openEditor, startWith } from './support'

/*
 * Every way a panel can be dragged and dropped, and what each must show and do. A case starts a
 * drag from a panel's icon (or its name, when it is alone), goes to one or more places that must
 * all show the same mark, checks that mark against where the groups are at that moment, lets go at
 * the last place and checks where every panel ended up.
 *
 * Panels are written by a letter, groups by their panels in order, the drawing by "*", and the
 * whole arrangement column by column from the left (" | "), each column's groups from the top
 * ("/"). The default arrangement is "LPCKMD/S | * | RA".
 */

failOnErrors()

const NAMES: Record<string, string> = { L: 'Layers', P: 'Pages', C: 'Components', K: 'Colours', M: 'Materials', D: 'Dimension styles', S: 'Structure', R: 'Properties', A: 'Assistant' }
const LETTERS = Object.fromEntries(Object.entries(NAMES).map(([letter, name]) => [name, letter]))
const DEFAULT = 'LPCKMD/S | * | RA'

type Side = 'top' | 'bottom' | 'left' | 'right'
/**
 * Where the pointer goes: between two icons of a group's rail (gap `at`, 0 before the first), on
 * the lower half of the icon above, the upper half of the one below or the empty rail after the
 * last; an edge or the middle of a group's content; the row at the top of a group of one; outside
 * the panels.
 */
type Target = { gap: string; at: number; from: 'above' | 'below' | 'empty' } | { zone: string; side: Side | 'center'; inset?: number } | { head: string } | { edge: 'left' | 'right' } | { outside: true }
/** What must show: nothing, a bar between icons of a rail, a line along a side of a group or down an edge of the window, or a group outlined. */
type Mark = 'none' | { bar: [string, number] } | { line: [string, Side] } | { edge: 'left' | 'right' } | { join: string }
interface Case {
  name: string
  setup?: [string, Target][]
  /** The panel dragged, by its icon or its name; or "rail:" and a group, by the empty part of its rail. */
  drag: string
  to: Target[]
  mark: Mark
  /** Where the panels are after the drop; the same as before when left out. */
  after?: string
  /** Escape is pressed before letting go: the drag is given up. */
  escape?: boolean
}

const gap = (group: string, at: number, from: 'above' | 'below' | 'empty'): Target => ({ gap: group, at, from })
/** An edge of a group's content, `inset` pixels in (8 above and below, 16 at the sides), or its middle. */
const zone = (group: string, side: Side | 'center', inset?: number): Target => ({ zone: group, side, inset })
const head = (group: string): Target => ({ head: group })
const edge = (side: 'left' | 'right'): Target => ({ edge: side })

const CASES: Case[] = [
  // In its own rail.
  { name: 'an icon dropped just above itself stays', drag: 'P', to: [gap('LPCKMD', 1, 'above'), gap('LPCKMD', 1, 'below')], mark: 'none' },
  { name: 'an icon dropped just under itself stays', drag: 'P', to: [gap('LPCKMD', 2, 'above'), gap('LPCKMD', 2, 'below')], mark: 'none' },
  { name: 'an icon goes before the first', drag: 'P', to: [gap('LPCKMD', 0, 'below')], mark: { bar: ['LPCKMD', 0] }, after: 'PLCKMD/S | * | RA' },
  { name: 'an icon goes between two others, one bar from either', drag: 'P', to: [gap('LPCKMD', 3, 'above'), gap('LPCKMD', 3, 'below')], mark: { bar: ['LPCKMD', 3] }, after: 'LCPKMD/S | * | RA' },
  { name: 'an icon goes after the last, one bar from the last icon or the empty rail', drag: 'P', to: [gap('LPCKMD', 6, 'above'), gap('LPCKMD', 6, 'empty')], mark: { bar: ['LPCKMD', 6] }, after: 'LCKMDP/S | * | RA' },
  { name: 'the last icon has no place after itself', drag: 'D', to: [gap('LPCKMD', 6, 'above'), gap('LPCKMD', 6, 'empty'), gap('LPCKMD', 5, 'below')], mark: 'none' },
  { name: 'the first icon has no place before itself', drag: 'L', to: [gap('LPCKMD', 0, 'below'), gap('LPCKMD', 1, 'below')], mark: 'none' },
  // Into another rail.
  { name: 'a panel alone joins a rail between two icons', drag: 'S', to: [gap('RA', 1, 'above'), gap('RA', 1, 'below')], mark: { bar: ['RA', 1] }, after: 'LPCKMD | * | RSA' },
  { name: 'a panel alone joins a rail at its end, from the empty rail', drag: 'S', to: [gap('RA', 2, 'empty')], mark: { bar: ['RA', 2] }, after: 'LPCKMD | * | RAS' },
  { name: 'a panel alone joins a rail at its start', drag: 'S', to: [gap('RA', 0, 'below')], mark: { bar: ['RA', 0] }, after: 'LPCKMD | * | SRA' },
  { name: 'an icon goes from one rail to another', drag: 'P', to: [gap('RA', 1, 'below')], mark: { bar: ['RA', 1] }, after: 'LCKMD/S | * | RPA' },
  // Between two groups stacked in a column: one line, from the lower edge of the upper one, the upper edge of the lower one or its row.
  { name: 'an icon goes between two stacked groups, one line from either', drag: 'P', to: [zone('LPCKMD', 'bottom'), zone('S', 'top'), head('S')], mark: { line: ['S', 'top'] }, after: 'LCKMD/P/S | * | RA' },
  { name: 'a panel from the other side goes between two stacked groups', drag: 'A', to: [head('S'), zone('LPCKMD', 'bottom')], mark: { line: ['S', 'top'] }, after: 'LPCKMD/A/S | * | R' },
  { name: 'a panel alone has no place on its own row', drag: 'S', to: [head('S')], mark: 'none' },
  { name: 'a panel alone has no place where it already is, above the next one', setup: [['P', head('S')]], drag: 'P', to: [head('S'), zone('S', 'top'), zone('LCKMD', 'bottom')], mark: 'none', after: 'LCKMD/P/S | * | RA' },
  { name: 'a panel alone goes above the one over it', setup: [['P', head('S')]], drag: 'S', to: [head('P'), zone('P', 'top')], mark: { line: ['P', 'top'] }, after: 'LCKMD/S/P | * | RA' },
  // A group of one.
  { name: 'a panel goes under a group at the bottom of the window', drag: 'P', to: [zone('S', 'bottom')], mark: { line: ['S', 'bottom'] }, after: 'LCKMD/S/P | * | RA' },
  { name: 'a panel joins a group of one, outlined whole', drag: 'P', to: [zone('S', 'center')], mark: { join: 'S' }, after: 'LCKMD/SP | * | RA' },
  { name: 'a panel let go a little inside the top of a group joins it rather than going above it', drag: 'P', to: [zone('S', 'top', 50), zone('S', 'bottom', 50)], mark: { join: 'S' }, after: 'LCKMD/SP | * | RA' },
  { name: 'a group stacked in a narrow column takes nothing at its sides', drag: 'P', to: [zone('S', 'left'), zone('S', 'right')], mark: 'none' },
  { name: 'a panel alone has no place on itself', drag: 'S', to: [zone('S', 'top'), zone('S', 'center'), zone('S', 'bottom')], mark: 'none' },
  // A group with a rail, from outside it.
  { name: 'a panel goes above a group at the top of the window', drag: 'S', to: [zone('LPCKMD', 'top')], mark: { line: ['LPCKMD', 'top'] }, after: 'S/LPCKMD | * | RA' },
  { name: 'a panel alone has no place under the group it is already under', drag: 'S', to: [zone('LPCKMD', 'bottom')], mark: 'none' },
  { name: 'a panel joins a group with a rail, outlined whole', drag: 'S', to: [zone('LPCKMD', 'center')], mark: { join: 'LPCKMD' }, after: 'LPCKMDS | * | RA' },
  // Its own group, with a rail.
  { name: 'an icon taken out of its rail above it', drag: 'P', to: [zone('LPCKMD', 'top')], mark: { line: ['LPCKMD', 'top'] }, after: 'P/LCKMD/S | * | RA' },
  { name: 'an icon taken out of its rail under it', drag: 'P', to: [zone('LPCKMD', 'bottom')], mark: { line: ['S', 'top'] }, after: 'LCKMD/P/S | * | RA' },
  { name: 'an icon has no place in the middle of its own group', drag: 'P', to: [zone('LPCKMD', 'center')], mark: 'none' },
  { name: 'a group with a rail stacked in a narrow column takes nothing at its sides', drag: 'P', to: [zone('LPCKMD', 'left'), zone('LPCKMD', 'right')], mark: 'none' },
  // Columns and the drawing.
  { name: 'a panel makes a column at the right of the window', drag: 'P', to: [zone('RA', 'right')], mark: { line: ['RA', 'right'] }, after: 'LCKMD/S | * | RA | P' },
  { name: 'a panel makes a column between the drawing and the one beside it, one line from either', drag: 'P', to: [zone('RA', 'left'), zone('*', 'right')], mark: { line: ['RA', 'left'] }, after: 'LCKMD/S | * | P | RA' },
  { name: 'a panel makes a column at the left of the drawing', drag: 'P', to: [zone('*', 'left')], mark: { line: ['*', 'left'] }, after: 'LCKMD/S | P | * | RA' },
  { name: 'a panel alone in a stacked column makes a column of its own', drag: 'S', to: [zone('*', 'left')], mark: { line: ['*', 'left'] }, after: 'LPCKMD | S | * | RA' },
  { name: 'the drawing takes no panel in its middle', drag: 'P', to: [zone('*', 'center')], mark: 'none' },
  { name: 'nothing goes above or under the drawing', drag: 'P', to: [zone('*', 'top'), zone('*', 'bottom')], mark: 'none' },
  { name: 'a panel that is a column already has no place beside the drawing on its side', setup: [['A', zone('LPCKMD', 'center')]], drag: 'R', to: [zone('*', 'right'), zone('R', 'left'), zone('R', 'right')], mark: 'none', after: 'LPCKMDA/S | * | R' },
  { name: 'a panel that is a column goes to the other side of the drawing', setup: [['A', zone('LPCKMD', 'center')]], drag: 'R', to: [zone('*', 'left')], mark: { line: ['*', 'left'] }, after: 'LPCKMDA/S | R | *' },
  { name: 'a panel goes between two columns, one line from either', setup: [['P', zone('RA', 'left')]], drag: 'C', to: [zone('P', 'right'), zone('RA', 'left')], mark: { line: ['RA', 'left'] }, after: 'LKMD/S | * | P | C | RA' },
  // At an edge of the window: a column there, the outermost.
  { name: 'a panel makes a column at the far left', drag: 'P', to: [edge('left')], mark: { edge: 'left' }, after: 'P | LCKMD/S | * | RA' },
  { name: 'a panel makes a column at the far right', drag: 'P', to: [edge('right')], mark: { edge: 'right' }, after: 'LCKMD/S | * | RA | P' },
  { name: 'a panel alone in a stacked column makes a column at the far left', drag: 'S', to: [edge('left')], mark: { edge: 'left' }, after: 'S | LPCKMD | * | RA' },
  { name: 'a panel that is the outermost column already has no place at that edge', setup: [['A', zone('LPCKMD', 'center')]], drag: 'R', to: [edge('right')], mark: 'none', after: 'LPCKMDA/S | * | R' },
  { name: 'back from an edge of the window, the place under the pointer is marked again', drag: 'P', to: [zone('RA', 'right'), edge('right'), zone('RA', 'right')], mark: { line: ['RA', 'right'] }, after: 'LCKMD/S | * | RA | P' },
  { name: 'Escape gives a drag up at an edge of the window', drag: 'P', to: [edge('left')], mark: { edge: 'left' }, escape: true },
  // Only panels are dragged, never a whole group.
  { name: 'the empty part of a rail drags nothing', drag: 'rail:LPCKMD', to: [zone('RA', 'center'), gap('RA', 1, 'below'), zone('S', 'top'), edge('right')], mark: 'none' },
  // Given up.
  { name: 'Escape gives a drag up', drag: 'P', to: [zone('S', 'top')], mark: { line: ['S', 'top'] }, escape: true },
  // Nowhere.
  { name: 'a panel let go outside the panels stays', drag: 'P', to: [{ outside: true }], mark: 'none' },
]

/** The arrangement of the panels, as written above. */
function arrangement(page: Page): Promise<string> {
  return page.evaluate((letters) => {
    const groups = [...document.querySelectorAll<HTMLElement>('.dock .dv-groupview')]
      .map((element) => ({ box: element.getBoundingClientRect(), name: element.querySelector('.stage') ? '*' : [...element.querySelectorAll('.dv-tab .rail-tab')].map((tab) => letters[tab.getAttribute('title') ?? ''] ?? '?').join('') }))
      .filter((group) => group.box.width > 0 && group.name)
      .sort((a, b) => a.box.left - b.box.left || a.box.top - b.box.top)
    const columns: { left: number; groups: typeof groups }[] = []
    for (const group of groups) {
      const column = columns.find((one) => Math.abs(one.left - group.box.left) < 3)
      if (column) column.groups.push(group)
      else columns.push({ left: group.box.left, groups: [group] })
    }
    return columns.map((column) => column.groups.sort((a, b) => a.box.top - b.box.top).map((group) => group.name).join('/')).join(' | ')
  }, LETTERS)
}

interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Group { box: Box; content: Box; header: Box; tabs: Box[]; dock: Box }

/** Where a group's parts are, now. */
async function where(page: Page, name: string): Promise<Group> {
  const found = await page.evaluate(
    ({ name, letters }) => {
      const plain = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
      const element = [...document.querySelectorAll<HTMLElement>('.dock .dv-groupview')].find((one) => (one.querySelector('.stage') ? '*' : [...one.querySelectorAll('.dv-tab .rail-tab')].map((tab) => letters[tab.getAttribute('title') ?? ''] ?? '?').join('')) === name)
      if (!element) return null
      return {
        box: plain(element.getBoundingClientRect()),
        content: plain(element.querySelector(':scope > .dv-content-container')!.getBoundingClientRect()),
        header: plain(element.querySelector(':scope > .dv-tabs-and-actions-container')!.getBoundingClientRect()),
        tabs: [...element.querySelectorAll('.dv-tab')].map((tab) => plain(tab.getBoundingClientRect())),
        dock: plain(document.querySelector('.dock')!.getBoundingClientRect()),
      }
    },
    { name, letters: LETTERS },
  )
  if (!found) throw new Error(`No group "${name}" in ${await arrangement(page)}`)
  return found
}

async function point(page: Page, target: Target): Promise<{ x: number; y: number }> {
  if ('outside' in target) return { x: 700, y: 12 }
  if ('edge' in target) {
    const { dock } = await where(page, '*')
    return { x: target.edge === 'left' ? dock.left + 3 : dock.right - 3, y: dock.top + dock.height / 2 }
  }
  if ('head' in target) {
    const group = await where(page, target.head)
    return { x: group.header.left + 40, y: group.header.top + group.header.height / 2 }
  }
  if ('zone' in target) {
    const { content: c } = await where(page, target.zone)
    const middle = { x: c.left + c.width / 2, y: c.top + c.height / 2 }
    const across = target.inset ?? 8
    const along = target.inset ?? 16
    return { top: { ...middle, y: c.top + across }, bottom: { ...middle, y: c.bottom - across }, left: { ...middle, x: c.left + along }, right: { ...middle, x: c.right - along }, center: middle }[target.side]
  }
  const { tabs } = await where(page, target.gap)
  const x = tabs[0].left + tabs[0].width / 2
  if (target.from === 'above') return { x, y: tabs[target.at - 1].bottom - 4 }
  if (target.from === 'below') return { x, y: tabs[target.at].top + 4 }
  return { x, y: tabs[tabs.length - 1].bottom + 10 }
}

type Shown = { kind: 'none' } | { kind: 'line'; box: Box } | { kind: 'join'; box: Box } | { kind: 'bar'; x: number; y: number } | { kind: 'unmarked'; what: string } | { kind: 'other'; what: string }

/** What shows where the pointer is. */
function shown(page: Page): Promise<Shown> {
  return page.evaluate(() => {
    const plain = (r: { left: number; top: number; right: number; bottom: number }) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top })
    const line = document.querySelector('.drop-line')
    if (line) return { kind: 'line' as const, box: plain(line.getBoundingClientRect()) }
    const visible = [...document.querySelectorAll<HTMLElement>('.dock .dv-drop-target-selection')].filter((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    })
    for (const element of visible) {
      const box = element.getBoundingClientRect()
      const inContent = element.closest('.dv-content-container') !== null
      if (inContent && element.classList.contains('dv-drop-target-center')) {
        const after = getComputedStyle(element, '::after')
        if (after.content === 'none' || after.content === 'normal') return { kind: 'other' as const, what: `the library's box over ${element.closest('.dv-groupview')?.className}` }
        return { kind: 'join' as const, box: plain({ left: box.left + parseFloat(after.left), top: box.top + parseFloat(after.top), right: box.right - parseFloat(after.right), bottom: box.bottom - parseFloat(after.bottom) }) }
      }
      if (inContent) return { kind: 'unmarked' as const, what: element.className }
      if (element.closest('.dv-groupview-header-vertical')) {
        const top = getComputedStyle(element).backgroundPositionY.startsWith('100') ? box.bottom - 2 : box.top
        return { kind: 'bar' as const, x: box.left + box.width / 2, y: top + 1 }
      }
      return { kind: 'other' as const, what: element.className }
    }
    return { kind: 'none' as const }
  })
}

/** Checks what shows against what must, from where the groups are now. */
async function check(page: Page, mark: Mark, at: string) {
  const now = await shown(page)
  const near = (a: number, b: number, by = 2) => Math.abs(a - b) <= by
  if (mark === 'none') return expect(now, at).toEqual({ kind: 'none' })
  if ('bar' in mark) {
    const { tabs } = await where(page, mark.bar[0])
    const boundary = mark.bar[1] === 0 ? tabs[0].top : tabs[mark.bar[1] - 1].bottom
    expect(now.kind, `${at}: ${JSON.stringify(now)}`).toBe('bar')
    if (now.kind === 'bar') expect(near(now.y, boundary, 1.5) && now.x > tabs[0].left && now.x < tabs[0].right, `${at}: bar at ${now.y}, the boundary at ${boundary}`).toBe(true)
    return
  }
  if ('join' in mark) {
    const { box } = await where(page, mark.join)
    expect(now.kind, `${at}: ${JSON.stringify(now)}`).toBe('join')
    if (now.kind === 'join') expect(near(now.box.left, box.left) && near(now.box.top, box.top) && near(now.box.right, box.right) && near(now.box.bottom, box.bottom), `${at}: outline ${JSON.stringify(now.box)}, the group ${JSON.stringify(box)}`).toBe(true)
    return
  }
  const [name, side] = 'edge' in mark ? (['*', mark.edge] as const) : mark.line
  const { dock } = await where(page, name)
  const box = 'edge' in mark ? dock : (await where(page, name)).box
  expect(now.kind, `${at}: ${JSON.stringify(now)}`).toBe('line')
  if (now.kind !== 'line') return
  const across = side === 'top' || side === 'bottom'
  const edge = box[side]
  const middle = across ? now.box.top + now.box.height / 2 : now.box.left + now.box.width / 2
  // Centred on the edge, or, on an edge of the window, 4 px thick and 2 px in from it.
  const low = across ? dock.top : dock.left
  const high = across ? dock.bottom : dock.right
  const expected = Math.abs(edge - low) <= 1 ? low + 4 : Math.abs(edge - high) <= 1 ? high - 4 : edge
  expect(near(middle, expected, 1), `${at}: line at ${middle}, the ${side} edge of ${name} at ${expected}`).toBe(true)
  const span = across ? near(now.box.left, box.left) && near(now.box.width, box.width) : near(now.box.top, box.top) && near(now.box.height, box.height)
  expect(span, `${at}: line ${JSON.stringify(now.box)} along ${JSON.stringify(box)}`).toBe(true)
}

async function grab(page: Page, panel: string) {
  let x: number
  let y: number
  if (panel.startsWith('rail:')) {
    const { tabs, box } = await where(page, panel.slice(5))
    x = tabs[0].left + tabs[0].width / 2
    y = (tabs[tabs.length - 1].bottom + box.bottom) / 2
  } else {
    const box = (await page.locator(`.dv-tab .rail-tab[title="${NAMES[panel]}"]`).boundingBox())!
    x = box.x + box.width / 2
    y = box.y + box.height / 2
  }
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 6, y + 3, { steps: 2 })
}

async function goTo(page: Page, target: Target) {
  const { x, y } = await point(page, target)
  await page.mouse.move(x, y, { steps: 10 })
  // The library shows its marks on the next frame.
  await page.waitForTimeout(60)
}

const describe = (target: Target) => ('outside' in target ? 'outside' : 'edge' in target ? `the ${target.edge} edge of the window` : 'head' in target ? `the row of ${target.head}` : 'zone' in target ? `the ${target.side} of ${target.zone}` : `gap ${target.at} of ${target.gap}, from ${target.from}`)

test.describe('dragging panels', () => {
  for (const one of CASES) {
    test(one.name, async ({ page }) => {
      await startWith(page)
      await openEditor(page)
      await expect.poll(() => arrangement(page)).toBe(DEFAULT)
      for (const [panel, target] of one.setup ?? []) {
        await grab(page, panel)
        await goTo(page, target)
        await page.mouse.up()
        await page.waitForTimeout(150)
      }
      const before = await arrangement(page)
      await grab(page, one.drag)
      for (const target of one.to) {
        await goTo(page, target)
        await check(page, one.mark, `${one.drag} over ${describe(target)}`)
      }
      if (one.escape) {
        await page.keyboard.press('Escape')
        await expect(page.locator('.drop-line')).toHaveCount(0)
      }
      await page.mouse.up()
      await expect.poll(() => arrangement(page)).toBe(one.after ?? before)
      await expect(page.locator('.drop-line')).toHaveCount(0)
    })
  }

  test('the empty part of a rail, or of the row of a panel alone, shows no hand', async ({ page }) => {
    await startWith(page)
    await openEditor(page)
    const cursors = await page.locator('.dock .dv-void-container').evaluateAll((all) => all.map((element) => getComputedStyle(element).cursor))
    expect(cursors.length).toBeGreaterThan(0)
    expect(cursors.every((cursor) => cursor === 'default')).toBe(true)
  })

  // A panel that lands in a group of its own is given the size of the one it came from.
  const sizes: [string, string, Target, string, 'width' | 'height'][] = [
    ['to the far left', 'P', edge('left'), 'LPCKMD', 'width'],
    ['beside the drawing', 'P', zone('*', 'left'), 'LPCKMD', 'width'],
    ['beside a column', 'P', zone('RA', 'right'), 'LPCKMD', 'width'],
    ['above a group in a column', 'S', zone('LPCKMD', 'top'), 'S', 'height'],
  ]
  for (const [where_, panel, target, from, dimension] of sizes) {
    test(`a panel taken ${where_} keeps the ${dimension} of its group`, async ({ page }) => {
      await startWith(page)
      await openEditor(page)
      await expect.poll(() => arrangement(page)).toBe(DEFAULT)
      const before = (await where(page, from)).box[dimension]
      await grab(page, panel)
      await goTo(page, target)
      await page.mouse.up()
      await page.waitForTimeout(200)
      const after = await page.locator('.dv-groupview', { has: page.locator(`.rail-tab[title="${NAMES[panel]}"]`) }).boundingBox()
      expect(Math.abs(after![dimension] - before), `${dimension} ${after![dimension]}, was ${before}`).toBeLessThanOrEqual(2)
    })
  }
})
