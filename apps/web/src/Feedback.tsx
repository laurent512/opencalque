import { useEffect, useRef, useState } from 'react'
import { FileText, TriangleAlert, X } from 'lucide-react'
import { serializeDocument, withoutAssets } from '@opencalque/core'
import { t } from './i18n'
import { REPOSITORY } from './release'
import { forFile, useStore } from './store'
import { useWindows } from './windows'
import { Tabs } from './ui'
import { recentErrors } from './feedback/errors'
import { AreaPicker, boxOf, RecordingBar } from './feedback/AreaPicker'
import { CaptureButtons, MediaTiles, nextId, NO_MEDIA, ShowContext, type Media, type Shown } from './feedback/Attachments'
import { openSource, pictureOf, record, type Area, type Recorder, type Source } from './feedback/capture'
import { LIMITS, newIssueUrl, type Report, type ReportKind } from './feedback/report'
import { environment, sendReport } from './feedback/send'
import { listed, remember, useMyReports } from './feedback/mine'
import { ReportList, ReportThread } from './feedback/MyReports'

const close = () => useWindows.setState({ feedbackOpen: false })

/** The open drawing as saved, without its pictures. */
function drawingAsSaved(): { name: string; content: string } {
  const { doc } = useStore.getState()
  return { name: `${doc.name.trim() || 'drawing'}.opencalque`, content: serializeDocument(forFile(withoutAssets(doc))) }
}

type Status = { step: 'writing' } | { step: 'sending' } | { step: 'sent'; url: string; kept: boolean } | { step: 'failed'; reason: string }

/** What is being written: the new report, or a reply to a report sent from here, by its number. */
type Draft = 'new' | number

/** Taking a picture or a recording for a draft: the window is out of the way meanwhile. */
type Capture =
  | { step: 'none' }
  | { step: 'starting'; recording: boolean; draft: Draft }
  | { step: 'picking'; recording: boolean; draft: Draft; source: Source }
  | { step: 'recording'; draft: Draft; recorder: Recorder | null; area: ReturnType<typeof boxOf> | null; stopping: boolean }

/**
 * The Feedback window. A bug report or an idea, written in the app and posted as an issue on
 * GitHub by the site's worker (`apps/web/worker`), so that no GitHub account is needed. Nothing is
 * attached at first, since the issue is public: each attachment is added by the person and shown
 * as a tile they can take out; the rest of what is sent is shown under "What else is sent". A list
 * down the side holds a new report and those sent from here, each opened with its answers and a
 * reply (`feedback/MyReports.tsx`). What is written and attached, to the new report and to each
 * reply, stays when the window is closed, until it is sent: the window is hidden, not reset.
 */
export function Feedback() {
  const open = useWindows((s) => s.feedbackOpen)
  const selected = useWindows((s) => s.feedbackReport)
  const mine = useMyReports(listed)
  const opened = mine.find((r) => r.number === selected)
  const box = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<ReportKind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [attach, setAttach] = useState({ drawing: false, errors: false })
  const [media, setMedia] = useState<Record<string, Media>>({})
  const [replies, setReplies] = useState<Record<number, string>>({})
  const [shown, setShown] = useState<Shown | null>(null)
  const [status, setStatus] = useState<Status>({ step: 'writing' })
  const [capture, setCapture] = useState<Capture>({ step: 'none' })
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<{ name: string; content: string } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const titleField = useRef<HTMLInputElement>(null)
  const captureRef = useRef(capture)
  captureRef.current = capture

  // What can be attached is taken as the window opens: the drawing as it is now.
  useEffect(() => {
    if (!open) return
    setDrawing(drawingAsSaved())
    setErrors(recentErrors())
    setStatus((s) => (s.step === 'sent' ? { step: 'writing' } : s))
    titleField.current?.focus()
  }, [open])

  // The window keeps the keyboard, so that Esc closes it, also when what had the focus went away
  // (a report opened from the list, the Send button once the report is sent).
  useEffect(() => {
    if (open && box.current && !box.current.contains(document.activeElement)) box.current.focus()
  })

  // A capture under way ends with the window, and with the app.
  useEffect(() => {
    if (open) return
    const now = captureRef.current
    if (now.step === 'picking') now.source.stop()
    if (now.step === 'recording') now.recorder?.stop()
  }, [open])

  if (!open) return null

  const mediaOf = (draft: Draft) => media[draft] ?? NO_MEDIA
  const change = (draft: Draft, update: (was: Media) => Media) => setMedia((all) => ({ ...all, [draft]: update(all[draft] ?? NO_MEDIA) }))
  const forget = (draft: Draft) => {
    mediaOf(draft).clips.forEach((c) => URL.revokeObjectURL(c.url))
    setMedia((all) => ({ ...all, [draft]: NO_MEDIA }))
  }

  const startCapture = async (draft: Draft, recording: boolean) => {
    setCaptureError(null)
    setCapture({ step: 'starting', recording, draft })
    try {
      const source = await openSource()
      setCapture({ step: 'picking', recording, draft, source })
    } catch (error) {
      const name = (error as Error).name
      // Refusing to share, or closing the browser's question, is no error.
      if (name !== 'NotAllowedError' && name !== 'AbortError') failed(error as Error)
      else setCapture({ step: 'none' })
    }
  }

  const failed = (error: Error) => {
    setCaptureError(t('The app could not be captured: {reason}', { reason: error.message }))
    setCapture({ step: 'none' })
  }

  const picked = async (draft: Draft, source: Source, recording: boolean, area: Area) => {
    if (!recording) {
      source.stop()
      const base64 = pictureOf(source.frame, area)
      if (base64) change(draft, (m) => ({ ...m, pictures: [...m.pictures, { id: nextId(), base64 }] }))
      else setCaptureError(t('That picture is too large to send.'))
      return setCapture({ step: 'none' })
    }
    const shown = source.isPage ? boxOf(source.frame, area) : null
    setCapture({ step: 'recording', draft, recorder: null, area: shown, stopping: false })
    let recorder: Recorder
    try {
      recorder = await record(source, area)
    } catch (error) {
      source.stop()
      return failed(error as Error)
    }
    // Closed meanwhile: nothing to keep.
    if (captureRef.current.step !== 'recording') return recorder.stop()
    setCapture({ step: 'recording', draft, recorder, area: shown, stopping: false })
    recorder.done.then((clip) => {
      if (clip) change(draft, (m) => ({ ...m, clips: [...m.clips, { ...clip, id: nextId() }] }))
      else setCaptureError(t('That recording is too large to send.'))
      setCapture({ step: 'none' })
    }, failed)
  }

  if (capture.step === 'starting') return null
  if (capture.step === 'picking') {
    const { source, recording, draft } = capture
    return (
      <AreaPicker
        frame={source.frame}
        recording={recording}
        onPick={(area) => picked(draft, source, recording, area)}
        onCancel={() => {
          source.stop()
          setCapture({ step: 'none' })
        }}
      />
    )
  }
  if (capture.step === 'recording') {
    const { recorder } = capture
    return (
      <RecordingBar
        area={capture.area}
        elapsed={recorder ? recorder.elapsed : () => 0}
        ready={recorder !== null}
        stopping={capture.stopping}
        onStop={() => {
          setCapture({ ...capture, stopping: true })
          recorder?.stop()
        }}
      />
    )
  }

  const attached = mediaOf('new')
  const drawingFits = drawing !== null && drawing.content.length <= LIMITS.drawing
  const report = (): Report => ({
    kind,
    title: title.trim(),
    description,
    environment: environment(),
    ...(attach.errors && errors.length > 0 && { errors }),
    ...(attach.drawing && drawingFits && { drawing }),
    ...(attached.pictures.length > 0 && { pictures: attached.pictures.map((p) => p.base64) }),
    ...(attached.clips.length > 0 && { recordings: attached.clips.map((c) => c.recording) }),
  })
  const send = async () => {
    const sending = report()
    if (JSON.stringify(sending).length > LIMITS.body) return setStatus({ step: 'failed', reason: t('What is attached is too large to send together: take something out.') })
    setStatus({ step: 'sending' })
    const sent = await sendReport(sending)
    if ('url' in sent) {
      if (sent.number && sent.key) remember({ number: sent.number, title: sending.title, url: sent.url, key: sent.key })
      setStatus({ step: 'sent', url: sent.url, kept: !!(sent.number && sent.key) })
      setTitle('')
      setDescription('')
      setAttach({ drawing: false, errors: false })
      forget('new')
    } else {
      setStatus({ step: 'failed', reason: sent.status === 0 ? t('The server could not be reached.') : sent.error })
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && (shown ? setShown(null) : close())}>
      <div className="dialog feedback with-reports" role="dialog" aria-label={t('Feedback')} tabIndex={-1} ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Feedback')}</h2>
          <button className="text-button" onClick={close}>
            {t('Close')}
          </button>
        </header>
        <ShowContext.Provider value={setShown}>
          <div className="feedback-body">
            <ReportList
              selected={opened?.number ?? null}
              onSelect={(feedbackReport) => {
                // A new report after one was sent starts empty.
                if (feedbackReport === null && status.step === 'sent') setStatus({ step: 'writing' })
                useWindows.setState({ feedbackReport })
              }}
            />
            <div className="feedback-main">
              {opened ? (
                <ReportThread
                  key={opened.number}
                  report={opened}
                  text={replies[opened.number] ?? ''}
                  onText={(text) => setReplies((all) => ({ ...all, [opened.number]: text }))}
                  media={mediaOf(opened.number)}
                  onMedia={(m) => change(opened.number, () => m)}
                  onCapture={(recording) => startCapture(opened.number, recording)}
                  onSent={() => {
                    setReplies((all) => ({ ...all, [opened.number]: '' }))
                    forget(opened.number)
                  }}
                  captureError={captureError}
                />
              ) : status.step === 'sent' ? (
                <section className="feedback-sent">
                  <p>{t('Thank you. Your report is on GitHub, where the answers will be written:')}</p>
                  <p>
                    <a href={status.url} target="_blank" rel="noreferrer">
                      {status.url}
                    </a>
                  </p>
                  {status.kept && <p>{t('You will find the answers here too, under Your reports, where you can reply to them.')}</p>}
                </section>
              ) : (
                <>
                  <section>
                    <Tabs
                      className="feedback-kind"
                      label={t('Kind')}
                      value={kind}
                      onChange={setKind}
                      options={[
                        { value: 'bug', label: t('Something does not work') },
                        { value: 'idea', label: t('An idea or a request') },
                      ]}
                    />
                    <label className="feedback-field">
                      <span>{t('Title')}</span>
                      <input ref={titleField} value={title} maxLength={LIMITS.title} placeholder={t('In a few words')} onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <label className="feedback-field">
                      <span>{t('Description')}</span>
                      <textarea
                        rows={8}
                        value={description}
                        maxLength={LIMITS.description}
                        placeholder={kind === 'bug' ? t('What you did, step by step, what happened then, and what you expected') : t('What you would like to do, and why')}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                  </section>
                  <section>
                    <h3>{t('Attach')}</h3>
                    <MediaTiles media={attached} onChange={(m) => change('new', () => m)} onShow={setShown}>
                      {attach.drawing && drawingFits && (
                        <li className="feedback-tile">
                          <div className="feedback-thumb file" title={drawing.name}>
                            <FileText size={20} />
                            <span>{drawing.name}</span>
                          </div>
                          <button className="feedback-remove" title={t('Take out')} aria-label={t('Take out')} onClick={() => setAttach({ ...attach, drawing: false })}>
                            <X size={12} />
                          </button>
                        </li>
                      )}
                      {attach.errors && errors.length > 0 && (
                        <li className="feedback-tile">
                          <div className="feedback-thumb file">
                            <TriangleAlert size={20} />
                            <span>{t('Errors ({count})', { count: errors.length })}</span>
                          </div>
                          <button className="feedback-remove" title={t('Take out')} aria-label={t('Take out')} onClick={() => setAttach({ ...attach, errors: false })}>
                            <X size={12} />
                          </button>
                        </li>
                      )}
                    </MediaTiles>
                    <div className="feedback-add">
                      <CaptureButtons media={attached} onCapture={(recording) => startCapture('new', recording)} />
                      {!attach.drawing && (
                        <button className="pill" disabled={!drawingFits} onClick={() => setAttach({ ...attach, drawing: true })} title={drawingFits ? undefined : t('The open drawing is too large to attach')}>
                          <FileText size={14} /> {t('The open drawing, without its pictures')}
                        </button>
                      )}
                      {errors.length > 0 && !attach.errors && (
                        <button className="pill" onClick={() => setAttach({ ...attach, errors: true })}>
                          <TriangleAlert size={14} /> {t('The errors the app ran into ({count})', { count: errors.length })}
                        </button>
                      )}
                    </div>
                    {captureError && (
                      <p className="feedback-failed" role="alert">
                        {captureError}
                      </p>
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
        </ShowContext.Provider>
        {shown && (
          <div className="feedback-preview" onMouseDown={() => setShown(null)}>
            {shown.video ? <video src={shown.url} controls autoPlay onMouseDown={(e) => e.stopPropagation()} /> : <img alt="" src={shown.url} />}
          </div>
        )}
      </div>
    </div>
  )
}
