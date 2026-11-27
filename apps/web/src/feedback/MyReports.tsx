import { useEffect, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { language, t } from '../i18n'
import { listed, read, unread, useMyReports, type MyReport } from './mine'
import { readThread, sendReply } from './send'
import { blocks, inlines, REPLY_LIMIT, type Block, type Inline, type Speaker, type Thread } from './thread'

/** What is being written to each report, kept while the app is open, as the new report's text is. */
const drafts = new Map<number, string>()

const when = (at: string | number) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(language(), { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Why a thread could not be read or a reply sent, in the person's words where it is known. */
const reason = (failed: { error: string; status: number }) =>
  failed.status === 0 ? t('The server could not be reached.') : failed.status === 403 || failed.status === 404 ? t('This report can no longer be answered from here.') : failed.error

/**
 * The side of the Feedback window: a new report first, then the reports sent from this device,
 * newest first, those with an answer not yet read marked.
 */
export function ReportList({ selected, onSelect }: { selected: number | null; onSelect: (report: number | null) => void }) {
  const reports = useMyReports(listed)
  return (
    <nav className="feedback-side" aria-label={t('Your reports')}>
      <button className={`feedback-pick new${selected === null ? ' active' : ''}`} aria-current={selected === null} onClick={() => onSelect(null)}>
        <Plus size={14} /> {t('New report')}
      </button>
      <h3>{t('Your reports')}</h3>
      {reports.length === 0 && <p className="hint feedback-none">{t('The reports you send from here will be listed here, with the answers to them.')}</p>}
      <ul className="feedback-reports">
        {reports.map((r) => (
          <li key={r.number}>
            <button className={`feedback-pick${selected === r.number ? ' active' : ''}`} aria-current={selected === r.number} onClick={() => onSelect(r.number)}>
              <span className="feedback-report-title">{r.title}</span>
              <span className="feedback-report-meta">
                #{r.number} · {when(r.sent)}
              </span>
              {unread(r) && <span className="feedback-new">{t('New answer')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * A report sent from here: what was written on it, the answers, and a reply, posted under the
 * report on GitHub by the site's worker with the report's key.
 */
export function ReportThread({ report }: { report: MyReport }) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [text, setText] = useState(drafts.get(report.number) ?? '')
  const [sending, setSending] = useState(false)
  const [notSent, setNotSent] = useState<string | null>(null)

  const load = async () => {
    const got = await readThread(report.number, report.key)
    if ('status' in got) return setFailed(t('The answers could not be read: {reason}', { reason: reason(got) }))
    setFailed(null)
    setThread(got)
    read(report.number, got)
  }
  useEffect(() => {
    void load()
  }, [report.number])

  const write = (value: string) => {
    setText(value)
    drafts.set(report.number, value)
  }
  const send = async () => {
    setSending(true)
    setNotSent(null)
    const sent = await sendReply(report.number, report.key, text)
    setSending(false)
    if ('status' in sent) return setNotSent(t('Your reply could not be sent: {reason}', { reason: reason(sent) }))
    write('')
    await load()
  }

  return (
    <section className="feedback-thread">
      <div className="feedback-thread-head">
        <h3>{thread?.title ?? report.title}</h3>
        <a href={report.url} target="_blank" rel="noreferrer">
          {t('See it on GitHub')}
        </a>
      </div>
      {failed && (
        <p className="feedback-failed" role="alert">
          {failed}
        </p>
      )}
      {!thread && !failed && <p className="hint">{t('Loading…')}</p>}
      {thread?.entries.map((entry, i) => (
        <article key={i} className={`feedback-entry ${entry.from}`}>
          <header>
            <strong>{who(entry.from, entry.name)}</strong> <span>{when(entry.at)}</span>
          </header>
          <Markdown text={entry.text} />
        </article>
      ))}
      {thread && (
        <>
          {thread.state === 'closed' && <p className="hint">{t('This report is closed. A reply opens it again.')}</p>}
          <label className="feedback-field">
            <span>{t('Your reply')}</span>
            <textarea rows={5} value={text} maxLength={REPLY_LIMIT} onChange={(e) => write(e.target.value)} />
          </label>
          <p className="hint">{t('Your reply will be public, under your report on GitHub.')}</p>
          {notSent && (
            <p className="feedback-failed" role="alert">
              {notSent}
            </p>
          )}
          <div className="feedback-actions">
            <button className="pill active" disabled={!text.trim() || sending} onClick={send}>
              {sending ? t('Sending…') : t('Send')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function who(from: Speaker, name?: string): string {
  if (from === 'you') return t('You')
  if (from === 'team') return 'OpenCalque'
  if (from === 'app') return t('Sent from the app')
  return name ?? 'GitHub'
}

/** Markdown as answers are written on GitHub, drawn as elements: nothing in it is read as HTML. */
function Markdown({ text }: { text: string }) {
  return <div className="feedback-markdown">{blocks(text).map(block)}</div>
}

function block(b: Block, i: number): ReactNode {
  switch (b.type) {
    case 'paragraph':
      return <p key={i}>{inlines(b.text).map(inline)}</p>
    case 'heading':
      return <h4 key={i}>{inlines(b.text).map(inline)}</h4>
    case 'list': {
      const items = b.items.map((item, j) => <li key={j}>{inlines(item).map(inline)}</li>)
      return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
    }
    case 'quote':
      return <blockquote key={i}>{b.blocks.map(block)}</blockquote>
    case 'code':
      return <pre key={i}>{b.text}</pre>
    case 'rule':
      return <hr key={i} />
  }
}

function inline(part: Inline, i: number): ReactNode {
  switch (part.type) {
    case 'text':
      return part.text
    case 'strong':
      return <strong key={i}>{part.children.map(inline)}</strong>
    case 'em':
      return <em key={i}>{part.children.map(inline)}</em>
    case 'code':
      return <code key={i}>{part.text}</code>
    case 'link':
      return (
        <a key={i} href={part.href} target="_blank" rel="noreferrer">
          {part.children.map(inline)}
        </a>
      )
    case 'picture':
      return (
        <a key={i} href={part.href} target="_blank" rel="noreferrer">
          {t('Picture')}
        </a>
      )
  }
}
