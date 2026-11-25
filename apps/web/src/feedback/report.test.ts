import { describe, expect, it } from 'vitest'
import { checkReport, followedIssue, inert, issueBody, LIMITS, newIssueUrl, type Report } from './report'
import { withoutPaths } from './errors'

const PNG = 'iVBORw0KGgo='
const WEBM = 'GkXfo59ChoEBQg=='
const MP4 = 'AAAAIGZ0eXBpc29t'

const report: Report = {
  kind: 'bug',
  title: 'Walls lose their corner',
  description: 'I moved a wall and @someone said ```hi```',
  environment: { Version: '1.12.0', App: 'Web', Screen: '1920 × 1080 | 2' },
  errors: ['TypeError: x is undefined\n    at f (index-abc.js:3:9)'],
}

describe('checkReport', () => {
  it('takes a report as the editor sends it', () => {
    expect(checkReport(JSON.parse(JSON.stringify(report)))).toEqual(report)
  })

  it('says what is wrong with one that is not', () => {
    expect(checkReport(null)).toBeTypeOf('string')
    expect(checkReport({ ...report, kind: 'rant' })).toMatch(/kind/)
    expect(checkReport({ ...report, title: '   ' })).toMatch(/title/)
    expect(checkReport({ ...report, title: 'x'.repeat(LIMITS.title + 1) })).toMatch(/title/)
    expect(checkReport({ ...report, environment: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'])) })).toMatch(/environment/)
    expect(checkReport({ ...report, errors: ['x'.repeat(LIMITS.error + 1)] })).toMatch(/error/)
    expect(checkReport({ ...report, screenshot: 'not base64!' })).toMatch(/picture/)
    expect(checkReport({ ...report, pictures: [PNG, WEBM] })).toMatch(/PNG/)
    expect(checkReport({ ...report, pictures: Array(LIMITS.pictures + 1).fill(PNG) })).toMatch(/pictures/)
    expect(checkReport({ ...report, recordings: [{ type: 'video/webm', content: MP4, seconds: 3 }] })).toMatch(/video/)
    expect(checkReport({ ...report, recordings: [{ type: 'video/ogg', content: WEBM, seconds: 3 }] })).toMatch(/webm/)
    expect(checkReport({ ...report, recordings: [{ type: 'video/webm', content: WEBM, seconds: 600 }] })).toMatch(/seconds/)
    expect(checkReport({ ...report, drawing: { name: 'a', content: 'x'.repeat(LIMITS.drawing + 1) } })).toMatch(/drawing/)
  })

  it('takes pictures and recordings, and the one picture and the expectation 1.13 sent', () => {
    const recordings = [
      { type: 'video/webm', content: WEBM, seconds: 4.2 },
      { type: 'video/mp4', content: MP4, seconds: 1 },
    ] as const
    expect(checkReport({ ...report, pictures: [PNG, PNG], recordings })).toEqual({ ...report, pictures: [PNG, PNG], recordings })
    const old = checkReport({ ...report, screenshot: PNG, expected: 'The corner stays joined' }) as Report
    expect(old.pictures).toEqual([PNG])
    expect(old.expected).toBe('The corner stays joined')
    expect(issueBody(old)).toContain('### Expected')
  })

  it('leaves out what is empty', () => {
    const read = checkReport({ ...report, expected: '  ', errors: [] }) as Report
    expect(read.expected).toBeUndefined()
    expect(read.errors).toBeUndefined()
  })
})

describe('the issue', () => {
  it('notifies nobody, and keeps what was typed from breaking out of its block or table', () => {
    const body = issueBody(report)
    expect(body).not.toMatch(/@someone/)
    expect(body).toContain('@\u200bsomeone')
    expect(body).toContain('1920 × 1080 \\| 2')
    expect(body).toContain('```\nTypeError')
    expect(inert('mail me at a@b.c or @x')).toBe('mail me at a@\u200bb.c or @\u200bx')
  })

  it('fences errors so that backticks in them cannot close the block', () => {
    const body = issueBody({ ...report, errors: ['a ``` b'] })
    expect(body).toContain('````\na ``` b\n````')
  })

  it('links what was stored, and says when it could not be', () => {
    const body = issueBody(
      { ...report, drawing: { name: 'Flat.opencalque', content: '{}' }, recordings: [{ type: 'video/webm', content: WEBM, seconds: 12.4 }] },
      { drawing: 'https://raw/x', pictures: ['https://raw/1.png', 'https://raw/2.png'], recordings: ['https://raw/recording-1.webm'] },
    )
    expect(body).toMatch(/!\[.*\]\(https:\/\/raw\/1\.png\)[^]*!\[.*\]\(https:\/\/raw\/2\.png\)/)
    expect(body).toContain('- Recording 1 (12 s): [recording-1.webm](https://raw/recording-1.webm)')
    expect(body).toContain('[Flat.opencalque](https://raw/x)')
    expect(issueBody(report, { missing: 'Not stored.' })).toContain('_Not stored._')
  })

  it('fills in GitHub’s new issue page when it cannot be sent, without attachments', () => {
    const url = new URL(newIssueUrl('https://github.com/o/r', { ...report, pictures: [PNG], recordings: [{ type: 'video/webm', content: WEBM, seconds: 1 }], description: 'x'.repeat(9000) }))
    expect(url.pathname).toBe('/o/r/issues/new')
    expect(url.searchParams.get('title')).toBe(report.title)
    expect(url.searchParams.get('labels')).toBe('bug')
    expect(url.searchParams.get('body')!.length).toBeLessThan(6000)
    expect(url.searchParams.get('body')).not.toMatch(/Sent from inside|Attached/)
  })
})

describe('a report that follows up another', () => {
  it('names it in its title, as people answering from the app write it', () => {
    expect(followedIssue('#30 Antworten auf Nachfrage')).toBe(30)
    expect(followedIssue('Zu #30 Nachtrag')).toBe(30)
    expect(followedIssue('About issue #1234: still wrong')).toBe(1234)
    expect(followedIssue('#30, #31')).toBe(30)
  })

  it('names nothing without a number after #', () => {
    for (const title of ['Doors in walls', 'Wall #', 'C# export', '#0', 'Room 30']) expect(followedIssue(title)).toBeNull()
  })
})

describe('errors kept for a report', () => {
  it('leave out the folders, which on the desktop name the person’s account', () => {
    expect(withoutPaths('at f (file:///C:/Users/laure/AppData/app.asar/out/renderer/assets/index-abc.js:3:9)')).toBe('at f (index-abc.js:3:9)')
    expect(withoutPaths('at g (https://opencalque.com/assets/index-abc.js:1:2)')).toBe('at g (index-abc.js:1:2)')
    expect(withoutPaths('could not read C:\\Users\\laure\\plan.opencalque')).toBe('could not read plan.opencalque')
    expect(withoutPaths('at h (/home/someone/app/index.js:1:2)')).toBe('at h (index.js:1:2)')
  })
})
