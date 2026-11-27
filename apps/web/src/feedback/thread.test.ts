import { describe, expect, it } from 'vitest'
import { commentBody, issueBody } from './report'
import { blocks, inlines, readable, REPLY_MARK, replyBody, speakerOf } from './thread'

describe('what the person reads of their thread', () => {
  it('leaves out the environment and the notes written for maintainers', () => {
    const body = issueBody({ kind: 'idea', title: 'Styles', description: 'Wall types, please', environment: { Version: '2.1.0', Language: 'de' } })
    expect(readable(body)).toBe('Wall types, please')
    const named = commentBody({ kind: 'idea', title: '#30 Antworten', description: 'Ja', environment: {} })
    expect(readable(named)).toBe('**#30 Antworten**\n\nJa')
    expect(readable(replyBody('Thanks, it works'))).toBe('Thanks, it works')
  })

  it('shows a name written with @ as it was typed', () => {
    expect(readable(replyBody('ask @someone'))).toBe('ask @someone')
  })

  it('tells the person’s replies from reports that only named the issue, the project and anyone else', () => {
    const bot = 'opencalque-feedback[bot]'
    expect(speakerOf({ user: { login: bot }, body: replyBody('yes') }, bot)).toEqual({ from: 'you' })
    expect(speakerOf({ user: { login: bot }, body: commentBody({ kind: 'bug', title: '#30 still', description: '', environment: {} }) }, bot)).toEqual({ from: 'app' })
    expect(speakerOf({ user: { login: 'laurent512' }, author_association: 'OWNER', body: 'Danke' }, bot)).toEqual({ from: 'team' })
    // Someone on GitHub copying the mark is still someone on GitHub.
    expect(speakerOf({ user: { login: 'visitor' }, author_association: 'NONE', body: `me ${REPLY_MARK}` }, bot)).toEqual({ from: 'someone', name: 'visitor' })
  })
})

describe('Markdown as replies are written', () => {
  it('reads paragraphs, headings, lists, quotes, code and rules', () => {
    const text = [
      'Danke für Ihre Meldung!',
      '',
      '- **Türen**: Art',
      '- **Fenster**: Flügel',
      '  und Verglasung',
      '',
      '1. Worum geht es?',
      '2. Wie oft?',
      '',
      '> 1. Ca. 3 bis 4.',
      '> Ja.',
      '',
      '---',
      '',
      '### Recent errors',
      '',
      '````',
      'TypeError: x',
      '```',
      '````',
    ].join('\n')
    expect(blocks(text)).toEqual([
      { type: 'paragraph', text: 'Danke für Ihre Meldung!' },
      { type: 'list', ordered: false, items: ['**Türen**: Art', '**Fenster**: Flügel\nund Verglasung'] },
      { type: 'list', ordered: true, items: ['Worum geht es?', 'Wie oft?'] },
      { type: 'quote', blocks: [{ type: 'list', ordered: true, items: ['Ca. 3 bis 4.'] }, { type: 'paragraph', text: 'Ja.' }] },
      { type: 'rule' },
      { type: 'heading', text: 'Recent errors' },
      { type: 'code', text: 'TypeError: x\n```' },
    ])
  })

  it('reads bold, italics, code and links, and keeps anything else as text', () => {
    expect(inlines('**Wand** and _here_ `Shift+X` [2.2.0](https://github.com/o/r/releases/tag/v2.2.0) <b>no</b>')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'Wand' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'here' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'Shift+X' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://github.com/o/r/releases/tag/v2.2.0', children: [{ type: 'text', text: '2.2.0' }] },
      { type: 'text', text: ' <b>no</b>' },
    ])
  })

  it('links only web addresses', () => {
    expect(inlines('[click](javascript:alert(1))')).toEqual([{ type: 'text', text: '[click](javascript:alert(1))' }])
    expect(inlines('see https://opencalque.com.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://opencalque.com', children: [{ type: 'text', text: 'https://opencalque.com' }] },
      { type: 'text', text: '.' },
    ])
    expect(inlines('![Picture 1 taken in the app](https://opencalque.com/api/feedback/files/a/picture-1.png)')).toEqual([{ type: 'picture', href: 'https://opencalque.com/api/feedback/files/a/picture-1.png' }])
  })

  it('leaves underscores inside words alone', () => {
    expect(inlines('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }])
  })
})
