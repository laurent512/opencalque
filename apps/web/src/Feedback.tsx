import { useEffect, useRef, useState } from 'react'
import { serializeDocument, withoutAssets } from '@opencalque/core'
import { t } from './i18n'
import { REPOSITORY } from './release'
import { forFile, useStore } from './store'
import { useWindows } from './windows'
import { Select } from './Select'
import { recentErrors } from './feedback/errors'
import { LIMITS, newIssueUrl, type Report, type ReportKind } from './feedback/report'
import { environment, sendReport } from './feedback/send'

const close = () => useWindows.setState({ feedbackOpen: false })

/** The drawing area as a PNG in base64, no wider than 1600 pixels, or null when there is nothing to take. */
function captureCanvas(): string | null {
  const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null
  const scale = Math.min(1, 1600 / canvas.width)
  const copy = document.createElement('canvas')
  copy.width = Math.round(canvas.width * scale)
  copy.height = Math.round(canvas.height * scale)
  copy.getContext('2d')?.drawImage(canvas, 0, 0, copy.width, copy.height)
  const base64 = copy.toDataURL('image/png').split(',')[1] ?? ''
  return base64 && base64.length <= LIMITS.screenshot ? base64 : null
}

/** The open drawing as saved, without its pictures. */
function drawingAsSaved(): { name: string; content: string } {
  const { doc } = useStore.getState()
  return { name: `${doc.name.trim() || 'drawing'}.opencalque`, content: serializeDocument(forFile(withoutAssets(doc))) }
}

type Status = { step: 'writing' } | { step: 'sending' } | { step: 'sent'; url: string } | { step: 'failed'; reason: string }

/**
 * A bug report or an idea, written in the app and posted as an issue on GitHub by the site's
 * worker (`apps/web/worker`), so that no GitHub account is needed. What is written stays when the
 * window is closed, until it is sent. Attachments are each the person's choice, unticked at
 * first, since the issue is public; the rest of what is sent is shown under "What else is sent".
 */
export function Feedback() {
  const open = useWindows((s) => s.feedbackOpen)
  const [kind, setKind] = useState<ReportKind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expected, setExpected] = useState('')
  const [attach, setAttach] = useState({ drawing: false, screenshot: false, errors: false })
  const [status, setStatus] = useState<Status>({ step: 'writing' })
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<{ name: string; content: string } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const titleField = useRef<HTMLInputElement>(null)

  // What can be attached is taken as the window opens: the drawing and its area as they are now.
  useEffect(() => {
    if (!open) return
    setScreenshot(captureCanvas())
    setDrawing(drawingAsSaved())
    setErrors(recentErrors())
    setStatus((s) => (s.step === 'sent' ? { step: 'writing' } : s))
    titleField.current?.focus()
  }, [open])

  if (!open) return null
  const drawingFits = drawing !== null && drawing.content.length <= LIMITS.drawing
  const report = (): Report => ({
    kind,
    title: title.trim(),
    description,
    ...(kind === 'bug' && expected.trim() && { expected }),
    environment: environment(),
    ...(attach.errors && errors.length > 0 && { errors }),
    ...(attach.drawing && drawingFits && { drawing }),
    ...(attach.screenshot && screenshot && { screenshot }),
  })
  const send = async () => {
    setStatus({ step: 'sending' })
    const sent = await sendReport(report())
    if ('url' in sent) {
      setStatus({ step: 'sent', url: sent.url })
      setTitle('')
      setDescription('')
      setExpected('')
      setAttach({ drawing: false, screenshot: false, errors: false })
    } else {
      setStatus({ step: 'failed', reason: sent.status === 0 ? t('The server could not be reached.') : sent.error })
    }
  }
  const tick = (key: keyof typeof attach) => (e: React.ChangeEvent<HTMLInputElement>) => setAttach({ ...attach, [key]: e.target.checked })

  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog feedback" role="dialog" aria-label={t('Report a bug or suggest an idea')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Report a bug or suggest an idea')}</h2>
          <button className="text-button" onClick={close}>
            {status.step === 'sent' ? t('Done') : t('Cancel')}
          </button>
        </header>
        {status.step === 'sent' ? (
          <section className="feedback-sent">
            <p>{t('Thank you. Your report is on GitHub, where the answers will be written:')}</p>
            <p>
              <a href={status.url} target="_blank" rel="noreferrer">
                {status.url}
              </a>
            </p>
          </section>
        ) : (
          <>
            <section>
              <label className="feedback-field">
                <span>{t('Kind')}</span>
                <Select
                  value={kind}
                  onChange={(value) => setKind(value as ReportKind)}
                  options={[
                    { value: 'bug', label: t('Something does not work') },
                    { value: 'idea', label: t('An idea or a request') },
                  ]}
                />
              </label>
              <label className="feedback-field">
                <span>{t('Title')}</span>
                <input ref={titleField} value={title} maxLength={LIMITS.title} placeholder={t('In a few words')} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="feedback-field">
                <span>{kind === 'bug' ? t('What happened') : t('Your idea')}</span>
                <textarea
                  rows={6}
                  value={description}
                  maxLength={LIMITS.description}
                  placeholder={kind === 'bug' ? t('What you did, step by step, and what happened then') : t('What you would like to do, and why')}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              {kind === 'bug' && (
                <label className="feedback-field">
                  <span>{t('What you expected')}</span>
                  <textarea rows={2} value={expected} maxLength={LIMITS.expected} onChange={(e) => setExpected(e.target.value)} />
                </label>
              )}
            </section>
            <section>
              <h3>{t('Attach')}</h3>
              <label className="pref-row">
                <input type="checkbox" checked={attach.drawing && drawingFits} disabled={!drawingFits} onChange={tick('drawing')} />
                {drawingFits ? t('The open drawing, without its pictures') : t('The open drawing is too large to attach')}
              </label>
              <label className="pref-row">
                <input type="checkbox" checked={attach.screenshot && !!screenshot} disabled={!screenshot} onChange={tick('screenshot')} />
                {t('A picture of the drawing area')}
              </label>
              {attach.screenshot && screenshot && <img className="feedback-screenshot" alt="" src={`data:image/png;base64,${screenshot}`} />}
              {errors.length > 0 && (
                <label className="pref-row">
                  <input type="checkbox" checked={attach.errors} onChange={tick('errors')} />
                  {t('The errors the app ran into ({count})', { count: errors.length })}
                </label>
              )}
              {attach.errors && errors.length > 0 && <pre className="feedback-errors">{errors.join('\n\n')}</pre>}
              <details className="feedback-environment">
                <summary>{t('What else is sent')}</summary>
                <table>
                  <tbody>
                    {Object.entries(environment()).map(([label, value]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <p className="hint">{t('Your report will be public: it becomes an issue on GitHub, where anyone can read it. You need no GitHub account, and no name or address is sent. Leave out anything private.')}</p>
              {status.step === 'failed' && (
                <p className="feedback-failed" role="alert">
                  {t('It could not be sent: {reason}', { reason: status.reason })}{' '}
                  <a href={newIssueUrl(REPOSITORY, report())} target="_blank" rel="noreferrer">
                    {t('Post it on GitHub yourself')}
                  </a>
                </p>
              )}
              <div className="feedback-actions">
                <button className="pill active" disabled={!title.trim() || status.step === 'sending'} onClick={send}>
                  {status.step === 'sending' ? t('Sending…') : status.step === 'failed' ? t('Try again') : t('Send')}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
