import { useEffect, useRef, useState } from 'react'
import { FilePlus, FileText, FolderOpen, LayoutTemplate, type LucideIcon } from 'lucide-react'
import { newDocument, openDocument, openExample, openRecent } from './actions'
import { t } from './i18n'
import { platform } from './platform'
import { setPrefs, usePrefs } from './prefs'
import { VERSION } from './release'
import { useStore } from './store'

const close = () => useStore.setState({ welcomeOpen: false })

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
      <props.icon size={22} strokeWidth={1.6} />
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
  const open = useStore((s) => s.welcomeOpen)
  const show = usePrefs((p) => p.showWelcome)
  const [recent, setRecent] = useState<{ name: string; path: string }[]>([])

  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    box.current?.focus()
    let current = true
    platform.recent?.().then((files) => current && setRecent(files), () => {})
    return () => {
      current = false
    }
  }, [open])

  if (!open) return null
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
          <div>
            <h2>{t('Welcome to OpenCalque')}</h2>
            <p className="faint">{t('Plans and layouts drawn to scale, free and open source.')}</p>
          </div>
        </div>
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
        <footer>
          <label>
            <input type="checkbox" checked={show} onChange={(e) => setPrefs({ showWelcome: e.target.checked })} />
            {t('Show this window when the app starts')}
          </label>
          <button className="text-button" onClick={() => useStore.setState({ welcomeOpen: false, aboutOpen: true })}>
            {t('What is new in version {version}', { version: VERSION })}
          </button>
        </footer>
      </div>
    </div>
  )
}
