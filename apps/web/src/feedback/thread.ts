/**
 * A report's thread as the person who sent it reads it in the app ("Your reports"), and the reply
 * they write there. The worker reads the issue and its comments on GitHub and hands them over in
 * this shape; the app draws the text with `blocks` and `inlines`, as elements, never as HTML.
 * Nothing here touches the DOM, so the worker imports it too.
 */

import { inert, LIMITS } from './report'

/** Who wrote an entry: the person (their report, their replies), the project, a report from the app that named the issue, anyone else on GitHub. */
export type Speaker = 'you' | 'team' | 'app' | 'someone'

export interface ThreadEntry {
  from: Speaker
  /** The GitHub account, for `someone`. */
  name?: string
  /** When it was written, as GitHub says (ISO 8601). */
  at: string
  /** Its Markdown, without what is written for maintainers (`readable`). */
  text: string
}

export interface Thread {
  number: number
  title: string
  state: 'open' | 'closed'
  /** The issue on GitHub. */
  url: string
  /** The report first, then every comment, oldest first. */
  entries: ThreadEntry[]
}

/** What lets a device answer the report it sent: 32 random bytes in hex. The worker keeps only its SHA-256. */
export const REPLY_KEY = /^[0-9a-f]{64}$/

/** The longest reply, as long as a report's description. */
export const REPLY_LIMIT = LIMITS.description

/** Comments the worker reads of one thread: GitHub's largest page. */
export const THREAD_COMMENTS = 100

/** Hidden in a reply the worker posted for the holder of the report's key, so that the app knows it as theirs. */
export const REPLY_MARK = '<!-- opencalque:reporter -->'
const REPLY_NOTE = '_Written in OpenCalque by the person who sent this report._'

/** A reply as posted on GitHub: inert like a report, then a line saying who wrote it. */
export function replyBody(text: string): string {
  return `${inert(text.trim())}\n\n${REPLY_NOTE}\n${REPLY_MARK}`
}

/** The roles GitHub gives the project's own people on its issues. */
const TEAM = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** Who wrote a comment on a report from the app, whose author is the feedback App (`bot`). */
export function speakerOf(comment: { user?: { login: string } | null; author_association?: string; body?: string | null }, bot: string): { from: Speaker; name?: string } {
  const login = comment.user?.login ?? ''
  if (login === bot) return { from: comment.body?.includes(REPLY_MARK) ? 'you' : 'app' }
  if (TEAM.has(comment.author_association ?? '')) return { from: 'team' }
  return { from: 'someone', name: login || undefined }
}

/** An issue's or a comment's text as the person reads it: without the environment, the notes for maintainers and the hidden marks. */
export function readable(body: string | null | undefined): string {
  return (body ?? '')
    .replace(/<details>[^]*?<\/details>/g, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^_Sent from inside OpenCalque[^\n]*_$/gm, '')
    .replace(/^_Written in OpenCalque by the person[^\n]*_$/gm, '')
    .replace(/^_Sent from the app with this issue[^\n]*_$/gm, '')
    .replace(/@​/g, '@')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Markdown, as far as the replies use it.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  /** A picture, shown as a link to it: the app's pages load no pictures from elsewhere. */
  | { type: 'picture'; href: string }

export type Block =
  | { type: 'paragraph' | 'heading'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }

const LINK = /^https?:\/\/\S+$/
const INLINE =
  /(`+)([^]+?)\1|!\[[^\]\n]*\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^]+?)\*\*|(?<![\p{L}\p{N}_*])_([^_\n]+)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}*])\*([^*\n]+)\*(?![\p{L}\p{N}*])|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"’”])/gu

/** The inline parts of a text: bold, italic, code, links. Anything else, HTML included, stays text. */
export function inlines(text: string, depth = 0): Inline[] {
  const out: Inline[] = []
  const plain = (s: string) => {
    if (!s) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += s
    else out.push({ type: 'text', text: s })
  }
  // Deep nesting is no use to anyone: past a few levels the rest is text.
  if (depth > 4) return [{ type: 'text', text }]
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(at, m.index))
    at = m.index + m[0].length
    const [whole, , code, picture, label, href, strong, under, star, bare] = m
    if (code !== undefined) out.push({ type: 'code', text: code.trim() || code })
    else if (picture !== undefined) LINK.test(picture) ? out.push({ type: 'picture', href: picture }) : plain(whole)
    else if (label !== undefined) LINK.test(href) ? out.push({ type: 'link', href, children: inlines(label, depth + 1) }) : plain(whole)
    else if (strong !== undefined) out.push({ type: 'strong', children: inlines(strong, depth + 1) })
    else if (under !== undefined || star !== undefined) out.push({ type: 'em', children: inlines(under ?? star, depth + 1) })
    else if (bare !== undefined) out.push({ type: 'link', href: bare, children: [{ type: 'text', text: bare }] })
  }
  plain(text.slice(at))
  return out
}

const BULLET = /^ {0,3}[-*+] +(.*)$/
const NUMBERED = /^ {0,3}\d{1,9}[.)] +(.*)$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** The blocks of a text: paragraphs, headings, lists, quotes, code, rules. */
export function blocks(text: string, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++])
      i++
      out.push({ type: 'code', text: body.join('\n') })
      continue
    }
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
      out.push({ type: 'rule' })
      i++
      continue
    }
    const heading = line.match(/^ {0,3}#{1,6} +(.*?)[ #]*$/)
    if (heading) {
      out.push({ type: 'heading', text: heading[1] })
      i++
      continue
    }
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      out.push(depth < 3 ? { type: 'quote', blocks: blocks(quoted.join('\n'), depth + 1) } : { type: 'paragraph', text: quoted.join('\n') })
      continue
    }
    const listed = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null
    if (listed) {
      const items: string[] = []
      while (i < lines.length && lines[i].trim()) {
        const item = lines[i].match(listed)
        if (item) items.push(item[1])
        else if (/^\s/.test(lines[i]) && items.length > 0) items[items.length - 1] += `\n${lines[i].trim()}`
        else break
        i++
      }
      out.push({ type: 'list', ordered: listed === NUMBERED, items })
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !/^ {0,3}(>|#{1,6} )/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) paragraph.push(lines[i++])
    out.push({ type: 'paragraph', text: paragraph.join('\n') })
  }
  return out
}
