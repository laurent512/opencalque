import { expect, test, type Page } from '@playwright/test'
import { failOnErrors, openEditor, startWith } from './support'

/*
 * Reporting a bug or an idea from inside the app. GitHub is never reached: the request to the
 * site's worker is answered here.
 */

failOnErrors()

// Chromium shares the tab without asking when the page asks for its own tab (`preferCurrentTab`), as the desktop app does.
test.use({ channel: 'chromium', launchOptions: { args: ['--auto-accept-this-tab-capture'] } })

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

/** Answers the worker's address with `status` and `body`, keeping each report sent. */
async function answerReports(page: Page, status: number, body: unknown) {
  const sent: any[] = []
  await page.route('https://opencalque.com/api/feedback', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    sent.push(route.request().postDataJSON())
    await route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  })
  return sent
}

/** Drags over the frozen picture of the app, from one point of the window to another. */
async function dragArea(page: Page, from: [number, number], to: [number, number]) {
  const picker = page.locator('.area-picker')
  await expect(picker).toBeVisible()
  await expect(page.locator('.dialog.feedback')).toHaveCount(0)
  await page.mouse.move(...from)
  await page.mouse.down()
  await page.mouse.move(...to, { steps: 4 })
  await page.mouse.up()
}

test('sends a bug report from the welcome window, with the drawing and a picture when asked, and shows where it went', async ({ page }) => {
  await startWith(page, { showWelcome: true })
  const sent = await answerReports(page, 201, { url: 'https://github.com/laurent512/opencalque/issues/42', number: 42 })
  await openEditor(page)
  await page.locator('.dialog.welcome').getByRole('button', { name: 'Report a bug or suggest an idea' }).click()
  const form = page.locator('.dialog.feedback')
  await expect(form).toBeVisible()
  const send = form.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  await form.getByLabel('Title').fill('Walls lose their corner')
  await form.getByLabel('Description').fill('I moved a wall')
  await expect(form.locator('.feedback-tile')).toHaveCount(0)
  await form.getByRole('button', { name: 'The open drawing, without its pictures' }).click()
  await expect(form.locator('.feedback-tile')).toHaveCount(1)

  // Two pictures of parts of the app, the window out of the way meanwhile; one is taken out again.
  for (const to of [[700, 500], [400, 300]] as [number, number][]) {
    await form.getByRole('button', { name: 'Capture an area' }).click()
    await dragArea(page, [200, 100], to)
    await expect(form).toBeVisible()
  }
  await expect(form.getByRole('img', { name: /^Picture \d$/ })).toHaveCount(2)
  await form.getByRole('img', { name: 'Picture 2' }).click()
  await expect(form.locator('.feedback-preview img')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form.locator('.feedback-preview')).toHaveCount(0)
  await form.locator('.feedback-tile', { has: page.getByRole('img', { name: 'Picture 2' }) }).getByRole('button', { name: 'Take out' }).click()
  await expect(form.getByRole('img', { name: /^Picture \d$/ })).toHaveCount(1)
  await form.getByText('What else is sent').click()
  await expect(form.locator('.feedback-environment')).toContainText('Web')
  await send.click()

  await expect(form.getByRole('link', { name: 'https://github.com/laurent512/opencalque/issues/42' })).toBeVisible()
  expect(sent).toHaveLength(1)
  const [report] = sent
  expect(report).toMatchObject({ kind: 'bug', title: 'Walls lose their corner', description: 'I moved a wall' })
  expect(report.expected).toBeUndefined()
  expect(report.environment).toMatchObject({ App: 'Web', Language: 'en', Unit: 'mm' })
  expect(JSON.parse(report.drawing.content).format).toBe('opencalque')
  expect(report.pictures).toHaveLength(1)
  expect(report.pictures[0]).toMatch(/^iVBOR/)
  // The area dragged over, 500 × 400 pixels of the window, at the scale the browser captured the tab.
  const [width, height] = await page.evaluate(async (base64) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${base64}`
    await picture.decode()
    return [picture.width, picture.height]
  }, report.pictures[0])
  expect(width).toBeGreaterThanOrEqual(490)
  expect(width / height).toBeCloseTo(500 / 400, 1)

  // Sent, the form starts again empty.
  await form.getByRole('button', { name: 'Done' }).click()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Report a bug')
  await page.keyboard.press('Enter')
  await expect(form.getByLabel('Title')).toHaveValue('')
})

test('offers to post the report on GitHub when it cannot be sent, and keeps what was written', async ({ page }) => {
  await startWith(page)
  await answerReports(page, 503, { error: 'Reports are not set up on this server' })
  await openEditor(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Report a bug')
  await page.keyboard.press('Enter')
  const form = page.locator('.dialog.feedback')
  // The two kinds are tabs of one width: going from one to the other moves nothing.
  const box = await form.boundingBox()
  await form.getByRole('tab', { name: 'An idea or a request' }).click()
  await expect(form.getByRole('tab', { name: 'An idea or a request' })).toHaveAttribute('aria-selected', 'true')
  expect(await form.boundingBox()).toEqual(box)
  await form.getByLabel('Title').fill('Stairs with a landing')
  await form.getByLabel('Description').fill('A landing halfway up')
  await form.getByRole('button', { name: 'Send' }).click()

  await expect(form.getByRole('alert')).toContainText('Reports are not set up on this server')
  const fallback = new URL((await form.getByRole('link', { name: 'Post it on GitHub yourself' }).getAttribute('href'))!)
  expect(fallback.pathname).toBe('/laurent512/opencalque/issues/new')
  expect(fallback.searchParams.get('title')).toBe('Stairs with a landing')
  expect(fallback.searchParams.get('labels')).toBe('enhancement')
  await expect(form.getByLabel('Title')).toHaveValue('Stairs with a landing')
  await expect(form.getByRole('button', { name: 'Try again' })).toBeEnabled()
  // The browser says in the console that the request failed; that is the answer this test chose.
  ;(page as any).errors = (page as any).errors.filter((e: string) => !/503/.test(e))
})

test('records an area of the app while it is used, and sends the recording', async ({ page }) => {
  await startWith(page)
  const sent = await answerReports(page, 201, { url: 'https://github.com/laurent512/opencalque/issues/43', number: 43 })
  await openEditor(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Report a bug')
  await page.keyboard.press('Enter')
  const form = page.locator('.dialog.feedback')
  await form.getByLabel('Title').fill('The rectangle tool')
  await form.getByRole('button', { name: 'Record an area' }).click()
  await dragArea(page, [300, 150], [1100, 750])

  // The app is used while it records; the bar to stop it is outside the area.
  const bar = page.locator('.recording-bar')
  await expect(bar).toBeVisible()
  await expect(page.locator('.recording-outline')).toBeVisible()
  await page.keyboard.press('r')
  await page.mouse.move(500, 400)
  await page.mouse.down()
  await page.mouse.move(800, 600, { steps: 10 })
  await page.mouse.up()
  await expect(bar).toContainText('0:01')
  await bar.getByRole('button', { name: 'Stop' }).click()

  await expect(form.getByRole('img', { name: 'Recording 1' })).toBeVisible()
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(form.getByRole('link', { name: /issues\/43/ })).toBeVisible()
  const [report] = sent
  expect(report.recordings).toHaveLength(1)
  expect(report.recordings[0]).toMatchObject({ type: 'video/webm' })
  expect(report.recordings[0].seconds).toBeGreaterThan(0.5)
  expect(report.recordings[0].content).toMatch(/^GkXf/)
})
