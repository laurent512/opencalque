import { useEffect, useRef, useState } from 'react'
import { FilePlus, FileText, FolderOpen, History, LayoutTemplate, MessageSquarePlus, Sparkles, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { guarded, newDocument, openDocument, openExample, openRecent } from './actions'
import { language, LANGUAGES, t } from './i18n'
import { platform } from './platform'
import { setPrefs, usePrefs } from './prefs'
import { forget, recoverable, restore, type Kept } from './recovery'
import { VERSION } from './release'
import { isDirty, useStore } from './store'
import { IconButton } from './ui'
import { UNITS } from './units'
import { useWindows } from './windows'
import { Select } from './Select'

const close = () => useWindows.setState({ welcomeOpen: false })

/** The mark of the app: sheets of tracing paper lying on one another. */
export function Logo({ size }: { size: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0d99ff" />
      <path d="M32 14 52 25 32 36 12 25Z" fill="#fff" />
      <path d="M12 33 32 44 52 33M12 41 32 52 52 41" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity=".8" />
    </svg>
  )
}

function Choice(props: { icon: LucideIcon; title: string; note: string; onClick: () => void }) {
  return (
    <button className="welcome-choice" onClick={props.onClick}>
      <i>
        <props.icon size={20} strokeWidth={1.7} />
      </i>
      <strong>{props.title}</strong>
      <span>{props.note}</span>
    </button>
  )
}

/**
 * Where to begin, offered when the app starts without a file: an empty drawing, a file, one of
 * the drawings worked on lately (the desktop app keeps that list), or the example that comes
 * with the app.
 */
export function Welcome() {
  const open = useWindows((s) => s.welcomeOpen)
  const show = usePrefs((p) => p.showWelcome)
  const chosenLanguage = usePrefs((p) => p.language)
  const chosenUnit = usePrefs((p) => p.unit)
  const [recent, setRecent] = useState<{ name: string; path: string }[]>([])
  const [lost, setLost] = useState<Kept[]>([])

  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    box.current?.focus()
    let current = true
    platform.recent?.().then((files) => current && setRecent(files), () => {})
    recoverable().then((kept) => current && setLost(kept))
    return () => {
      current = false
    }
  }, [open])

  if (!open) return null
  const bringBack = (kept: Kept) =>
    guarded(async () => {
      if (isDirty() && !window.confirm(t('Discard unsaved changes?'))) return
      await restore(kept)
      close()
    })
  const throwAway = async (kept: Kept) => {
    await forget(kept)
    setLost((list) => list.filter((other) => other !== kept))
  }

  const openFile = async () => {
    const before = useStore.getState().doc
    await openDocument()
    // Stays when the file dialog was cancelled.
    if (useStore.getState().doc !== before) close()
  }

  return (
    <div className="palette-backdrop welcome-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      {/* The window itself takes the keyboard, so that Esc closes it without any one control looking chosen. */}
      <div className="dialog welcome" role="dialog" aria-label={t('Welcome to OpenCalque')} tabIndex={-1} ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <div className="welcome-head">
          <Logo size={46} />
          <div className="welcome-title">
            <h2>{t('Welcome to OpenCalque')}</h2>
            <p className="faint">{t('Plans and layouts drawn to scale, free and open source.')}</p>
          </div>
          <button className="welcome-news" onClick={() => useWindows.setState({ welcomeOpen: false, aboutOpen: true })}>
            <Sparkles size={13} />
            {t('What is new')}
            <span>{VERSION}</span>
          </button>
        </div>
        {lost.length > 0 && (
          <div className="welcome-recent welcome-recover">
            <h3>
              <TriangleAlert size={14} />
              {t('Unsaved work from a window that closed unexpectedly')}
            </h3>
            {lost.map((kept) => (
              <div key={kept.session} className="welcome-recover-row">
                <button title={t('Open it as an unsaved drawing')} onClick={() => bringBack(kept)}>
                  <History size={14} />
                  <span>{kept.fileName ?? kept.name}</span>
                  <span className="faint">{new Date(kept.changed).toLocaleString(language())}</span>
                </button>
                <IconButton title={t('Throw this unsaved work away')} onClick={() => throwAway(kept)}>
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div className="welcome-choices">
          <Choice
            icon={FilePlus}
            title={t('New drawing')}
            note={t('Start from an empty page')}
            onClick={() => {
              close()
              newDocument()
            }}
          />
          <Choice icon={FolderOpen} title={t('Open a drawing…')} note={t('Carry on with a file from this computer')} onClick={openFile} />
          <Choice icon={LayoutTemplate} title={t('Start with the example')} note={t('A furnished flat to explore and take apart')} onClick={openExample} />
        </div>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <h3>{t('Recent drawings')}</h3>
            {recent.map((file) => (
              <button key={file.path} title={file.path} onClick={() => openRecent(file.path)}>
                <FileText size={14} />
                <span>{file.name}</span>
                <span className="faint">{file.path}</span>
              </button>
            ))}
          </div>
        )}
        {/* Taken from the computer at the first start; here to be seen, and put right if the guess was wrong. */}
        <div className="welcome-settings">
          <label>
            <span>{t('Language')}</span>
            <Select value={chosenLanguage} onChange={(language) => setPrefs({ language })} options={[{ value: 'auto', label: t('Same as the system') }, ...LANGUAGES.map(([code, name]) => ({ value: code, label: name }))]} />
          </label>
          <label>
            <span>{t('Unit')}</span>
            <Select value={chosenUnit} onChange={(unit) => setPrefs({ unit: unit as typeof chosenUnit })} options={UNITS.map(([code, name]) => ({ value: code, label: t(name) }))} />
          </label>
        </div>
        <footer>
          <label>
            <input type="checkbox" checked={show} onChange={(e) => setPrefs({ showWelcome: e.target.checked })} />
            {t('Show this window when the app starts')}
          </label>
          <button className="text-button welcome-feedback" onClick={() => useWindows.setState({ welcomeOpen: false, feedbackOpen: true, feedbackView: 'new' })}>
            <MessageSquarePlus size={13} />
            {t('Report a bug or suggest an idea')}
          </button>
        </footer>
      </div>
    </div>
  )
}
