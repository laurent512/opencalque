import { Component, type ErrorInfo, type ReactNode } from 'react'
import { serializeDocument } from '@opencalque/core'
import { t } from './i18n'
import { platform } from './platform'
import { hideSplash } from './splash'
import { forFile, useStore } from './store'

/** Saves the drawing as it is, wherever the user says, whatever state the interface is in. */
async function saveCopy(): Promise<void> {
  const { doc, base, file } = useStore.getState()
  // A gesture under way is left out: what is drawn is what was last finished.
  const drawing = base ?? doc
  try {
    await platform.save(serializeDocument(forFile(drawing)), file?.name ?? `${drawing.name.trim() || t('Untitled')}.opencalque`)
  } catch (error) {
    window.alert((error as Error).message)
  }
}

/**
 * Keeps a fault in one part of the interface from taking everything down with it. The drawing
 * lives outside the interface, in the store, so it is still whole when something fails to show:
 * the app as a whole falls back to a page that saves it, and a panel or the drawing area to a note
 * in its place, with a way to try again.
 */
export class Guard extends Component<{ children: ReactNode; area?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    // A fault while starting would otherwise stay hidden under the loading screen.
    hideSplash()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const retry = () => this.setState({ error: null })
    if (this.props.area) {
      return (
        <div className="crash compact" role="alert">
          <p>{t('{area} stopped working: {reason}', { area: this.props.area, reason: error.message })}</p>
          <div>
            <button className="text-button" onClick={retry}>
              {t('Try again')}
            </button>
            <button className="text-button" onClick={saveCopy}>
              {t('Save a copy of the drawing…')}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="crash" role="alert">
        <h2>{t('Something went wrong')}</h2>
        <p>{t('The drawing is still here. Save a copy of it, then reload the app.')}</p>
        <pre>{error.message}</pre>
        <div>
          <button className="text-button" onClick={saveCopy}>
            {t('Save a copy of the drawing…')}
          </button>
          <button className="text-button" onClick={retry}>
            {t('Try again')}
          </button>
          <button className="text-button" onClick={() => location.reload()}>
            {t('Reload')}
          </button>
        </div>
      </div>
    )
  }
}
