import './migrate'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { blankDocument } from './actions'
import { App } from './App'
import { Guard } from './Guard'
import { setLanguage } from './i18n'
import { platform } from './platform'
import { keepKeysIn, usePrefs } from './prefs'
import { loadExtensions, registry, useExtensions } from './extensions'
import { loadDocument } from './store'
import { startTheme } from './theme'
import { startAgentBridge } from './ai/bridge'
import { startUpdates } from './updates'
import './styles.css'

// The language is known only now, so the first empty drawing is made here, with its page and
// layer named in it.
loadExtensions()
setLanguage(usePrefs.getState().language, registry.translations)
startTheme()
startUpdates()
startAgentBridge()
if (platform.secrets) void keepKeysIn(platform.secrets)
loadDocument(blankDocument(), null)

/** Rebuilds the whole interface when the language or the unit changes; drawing and settings live outside it. */
function Root() {
  const language = usePrefs((p) => p.language)
  const unit = usePrefs((p) => p.unit)
  const fraction = usePrefs((p) => p.fraction)
  // Extensions bring their own translations, so the language is set again when they change.
  useExtensions((s) => s.version)
  setLanguage(language, registry.translations)
  return <App key={`${language} ${unit} ${fraction}`} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Guard>
      <Root />
    </Guard>
  </StrictMode>,
)
