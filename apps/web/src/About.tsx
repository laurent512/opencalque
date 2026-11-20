import { useEffect, useState } from 'react'
import { executeById } from './commands'
import { msg, t } from './i18n'
import { platform } from './platform'
import { RELEASES, REPOSITORY, VERSION } from './release'
import { useStore } from './store'
import { Logo } from './Welcome'
import { useWindows } from './windows'

const close = () => useWindows.setState({ aboutOpen: false })

/** The headings the changelog files changes under, so that they can be shown in the user's language. */
const HEADINGS: Record<string, string> = { New: msg('New'), Improved: msg('Improved'), Fixed: msg('Fixed') }

const LINKS: [string, string][] = [
  [msg('Source code'), REPOSITORY],
  [msg('Downloads'), `${REPOSITORY}/releases`],
]

/**
 * The licences of what the app includes (THIRD-PARTY-NOTICES.txt, written by `pnpm notices`),
 * fetched only when asked for: they are long, and in English, as licences are.
 */
function Licences() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    import('../../../THIRD-PARTY-NOTICES.txt?raw').then((file) => setText(file.default))
  }, [])
  return <pre className="about-licences">{text ?? t('Loading…')}</pre>
}

/**
 * What the app is, which version this is, and what changed in each version. The notes come from
 * CHANGELOG.md, the same text that describes each release on GitHub; they are written in English.
 * The licences of the software and fonts it includes are shown in their place on demand.
 */
export function About() {
  const open = useWindows((s) => s.aboutOpen)
  const [licences, setLicences] = useState(false)
  useEffect(() => setLicences(false), [open])
  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog about" role="dialog" aria-label={t('About')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-head">
          <Logo size={52} />
          <div>
            <h2>OpenCalque</h2>
            <p>{t('Version {version}', { version: VERSION })}</p>
            <p className="faint">{t('A free, open-source drawing tool for plans and layouts. No account, nothing sent anywhere.')}</p>
            <p className="about-links">
              {LINKS.map(([name, url]) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {t(name)}
                </a>
              ))}
              <button className="link-button" onClick={() => useWindows.setState({ aboutOpen: false, feedbackOpen: true })}>
                {t('Report a bug or suggest an idea')}
              </button>
              <button className="link-button" onClick={() => setLicences(!licences)}>
                {licences ? t('What is new') : t('Licences')}
              </button>
              {platform.checkForUpdate && (
                <button className="link-button" onClick={() => executeById('app.checkUpdate')}>
                  {t('Check for a new version…')}
                </button>
              )}
            </p>
          </div>
          <button className="text-button" autoFocus onClick={close}>
            {t('Done')}
          </button>
        </div>
        <div className="about-notes">
          <h3>{licences ? t('Licences') : t('What is new')}</h3>
          {licences && <Licences />}
          {!licences && RELEASES.map((release, i) => (
            <article key={release.version} className={i === 0 ? 'latest' : ''}>
              <h4>
                {t('Version {version}', { version: release.version })}
                <span className="faint">{release.date}</span>
              </h4>
              {release.sections.map((section) => (
                <div key={section.title}>
                  {section.title && <h5>{t(HEADINGS[section.title] ?? section.title)}</h5>}
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
