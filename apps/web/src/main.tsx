import './migrate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { blankDocument } from './actions'
import { App } from './App'
import { setLanguage } from './i18n'
import { usePrefs } from './prefs'
import { loadDocument, registry, useStore } from './store'
import { startTheme } from './theme'
import './styles.css'

// The language is known only now, so the first empty drawing is made here, with its page and
// layer named in it.
setLanguage(usePrefs.getState().language, registry.translations)
startTheme()
loadDocument(blankDocument(), null)

/** Rebuilds the whole interface when the language or the unit changes; drawing and settings live outside it. */
function Root() {
  const language = usePrefs((p) => p.language)
  const unit = usePrefs((p) => p.unit)
  // Extensions bring their own translations, so the language is set again when they change.
  useStore((s) => s.extensionsVersion)
  setLanguage(language, registry.translations)
  return <App key={`${language} ${unit}`} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
