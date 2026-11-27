import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, Plus } from 'lucide-react'
import { language, t } from '../i18n'
import { listed, read, unread, useMyReports, type MyReport } from './mine'
import { CaptureButtons, MediaTiles, ShowContext, type Media } from './Attachments'
import { LIMITS } from './report'
import { isReportFile, loadReportFile, readThread, sendReply } from './send'
import { blocks, inlines, REPLY_LIMIT, type Block, type Inline, type Speaker, type Thread } from './thread'

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
            <button className={`feedback-pick${selected === r.number ? ' active' : ''}`} aria-current={selected === r.number} title={r.title} onClick={() => onSelect(r.number)}>
              <span className="feedback-report-title">{r.title}</span>
              <span className="feedback-report-meta">
                #{r.number} · {when(r.sent)}
              </span>
              {unread(r) && <span className="feedback-new" role="img" aria-label={t('New answer')} />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * A report sent from here: what was written on it and the answers, scrolled above, and the reply
 * below, kept in sight, with the pictures and recordings attached to it. The reply is posted under
 * the report on GitHub by the site's worker with the report's key. What is written and attached is
 * kept by the window (`Feedback.tsx`), so that closing it loses nothing.
 */
export function ReportThread(props: {
  report: MyReport
  text: string
  onText: (text: string) => void
  media: Media
  onMedia: (media: Media) => void
  onCapture: (recording: boolean) => void
  onSent: () => void
  captureError: string | null
}) {
  const { report, text, onText, media, onMedia, onCapture, onSent, captureError } = props
  const show = useContext(ShowContext)
  const [thread, setThread] = useState<Thread | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [notSent, setNotSent] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)

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
  // The last messages are the ones to read: the thread opens at its end and stays there as it grows
  // (messages come, pictures and recordings load), unless the person scrolled up to read.
  const atEnd = useRef(true)
  useEffect(() => {
    const area = log.current
    if (!area) return
    const toEnd = () => {
      if (atEnd.current) area.scrollTop = area.scrollHeight
    }
    const scrolled = () => {
      atEnd.current = area.scrollTop + area.clientHeight >= area.scrollHeight - 8
    }
    const grown = new ResizeObserver(toEnd)
    for (const child of area.children) grown.observe(child)
    area.addEventListener('scroll', scrolled, { passive: true })
    toEnd()
    return () => {
      grown.disconnect()
      area.removeEventListener('scroll', scrolled)
    }
  }, [thread])

  const empty = !text.trim() && media.pictures.length === 0 && media.clips.length === 0
  const send = async () => {
    const sending = {
      ...(media.pictures.length > 0 && { pictures: media.pictures.map((p) => p.base64) }),
      ...(media.clips.length > 0 && { recordings: media.clips.map((c) => c.recording) }),
    }
    if (JSON.stringify(sending).length + text.length > LIMITS.body) return setNotSent(t('What is attached is too large to send together: take something out.'))
    setSending(true)
    setNotSent(null)
    const sent = await sendReply(report.number, report.key, text, sending)
    setSending(false)
    if ('status' in sent) return setNotSent(t('Your reply could not be sent: {reason}', { reason: reason(sent) }))
    onSent()
    atEnd.current = true
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
      <div className="feedback-log" ref={log}>
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
        {thread?.state === 'closed' && <p className="hint">{t('This report is closed. A reply opens it again.')}</p>}
      </div>
      {thread && (
        <div className="feedback-composer">
          <textarea rows={3} value={text} maxLength={REPLY_LIMIT} aria-label={t('Your reply')} placeholder={t('Your reply')} onChange={(e) => onText(e.target.value)} />
          <MediaTiles media={media} onChange={onMedia} onShow={show} />
          {(notSent || captureError) && (
            <p className="feedback-failed" role="alert">
              {notSent ?? captureError}
            </p>
          )}
          <div className="feedback-composer-row">
            <CaptureButtons media={media} onCapture={onCapture} />
            <button className="pill active" disabled={empty || sending} onClick={send}>
              {sending ? t('Sending…') : t('Send')}
            </button>
          </div>
        </div>
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
      if (RECORDING.test(part.href) && isReportFile(part.href)) return <ReportFile key={i} href={part.href} video />
      return (
        <a key={i} href={part.href} target="_blank" rel="noreferrer">
          {part.children.map(inline)}
        </a>
      )
    case 'picture':
      if (isReportFile(part.href)) return <ReportFile key={i} href={part.href} video={false} />
      return (
        <a key={i} href={part.href} target="_blank" rel="noreferrer">
          {t('Picture')}
        </a>
      )
  }
}

/** The name the worker gives a recording attached to a report or a reply. */
const RECORDING = /\/recording-\d\.(webm|mp4)$/

/**
 * A picture or a recording attached to a report or a reply, loaded from the site into memory
 * (`loadReportFile`): a picture as a thumbnail, a recording as a tile; either opens over the
 * window. A link to it while it loads, or when it cannot be loaded.
 */
function ReportFile({ href, video }: { href: string; video: boolean }) {
  const show = useContext(ShowContext)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void loadReportFile(href).then((loaded) => current && setUrl(loaded))
    return () => {
      current = false
    }
  }, [href])
  if (!url) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {video ? t('Play') : t('Picture')}
      </a>
    )
  }
  return (
    <button className={`feedback-attached${video ? ' video' : ''}`} title={video ? t('Play') : t('Show')} onClick={() => show({ url, video })}>
      {video ? <video src={url} muted preload="metadata" /> : <img alt={t('Picture')} src={url} />}
      {video && (
        <span className="feedback-play">
          <Play size={12} />
        </span>
      )}
    </button>
  )
}
