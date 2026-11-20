import { expect, test, type Page } from '@playwright/test'
import { failOnErrors, openEditor, pickIn, startWith } from './support'

/*
 * Reporting a bug or an idea from inside the app. GitHub is never reached: the request to the
 * site's worker is answered here.
 */

failOnErrors()

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
  await form.getByLabel('What happened').fill('I moved a wall')
  await form.getByLabel('What you expected').fill('The corner stays joined')
  await form.getByLabel('The open drawing, without its pictures').check()
  await form.getByLabel('A picture of the drawing area').check()
  await expect(form.locator('.feedback-screenshot')).toBeVisible()
  await form.getByText('What else is sent').click()
  await expect(form.locator('.feedback-environment')).toContainText('Web')
  await send.click()

  await expect(form.getByRole('link', { name: 'https://github.com/laurent512/opencalque/issues/42' })).toBeVisible()
  expect(sent).toHaveLength(1)
  const [report] = sent
  expect(report).toMatchObject({ kind: 'bug', title: 'Walls lose their corner', description: 'I moved a wall', expected: 'The corner stays joined' })
  expect(report.environment).toMatchObject({ App: 'Web', Language: 'en', Unit: 'mm' })
  expect(JSON.parse(report.drawing.content).format).toBe('opencalque')
  expect(report.screenshot).toMatch(/^iVBOR/)

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
  await pickIn(page, form.locator('.select'), 'An idea or a request')
  await form.getByLabel('Title').fill('Stairs with a landing')
  await form.getByLabel('Your idea').fill('A landing halfway up')
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
