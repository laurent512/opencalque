import { msg, t } from './i18n'
import { RELEASES, REPOSITORY, VERSION } from './release'
import { useStore } from './store'
import { Logo } from './Welcome'

const close = () => useStore.setState({ aboutOpen: false })

/** The headings the changelog files changes under, so that they can be shown in the user's language. */
const HEADINGS: Record<string, string> = { New: msg('New'), Improved: msg('Improved'), Fixed: msg('Fixed') }

const LINKS: [string, string][] = [
  [msg('Source code'), REPOSITORY],
  [msg('Downloads'), `${REPOSITORY}/releases`],
  [msg('Report a problem'), `${REPOSITORY}/issues`],
]

/**
 * What the app is, which version this is, and what changed in each version. The notes come from
 * CHANGELOG.md, the same text that describes each release on GitHub; they are written in English.
 */
export function About() {
  const open = useStore((s) => s.aboutOpen)
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
            </p>
          </div>
          <button className="text-button" autoFocus onClick={close}>
            {t('Done')}
          </button>
        </div>
        <div className="about-notes">
          <h3>{t('What is new')}</h3>
          {RELEASES.map((release, i) => (
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
