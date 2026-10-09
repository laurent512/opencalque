import { useEffect, useState } from 'react'
import { executeById } from './commands'
import { resetLayout } from './dock'
import { LANGUAGES, t } from './i18n'
import { platform } from './platform'
import { CLAUDE_MODELS, setAiPrefs, setPrefs, usePrefs } from './prefs'
import { useStore } from './store'
import { UNITS } from './units'

const close = () => useStore.setState({ preferencesOpen: false })

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="pref-row">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  )
}

/** A text setting saved when the field is left, so a key is not written to storage on every keystroke. */
function TextSetting(props: { label: string; value: string; secret?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value)
  useEffect(() => {
    setText(props.value)
  }, [props.value])
  return (
    <label className="pref-field">
      <span>{props.label}</span>
      <input
        type={props.secret ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== props.value && props.onCommit(text.trim())}
      />
    </label>
  )
}

function AssistantSettings() {
  const ai = usePrefs((p) => p.ai)
  const custom = !CLAUDE_MODELS.some(([id]) => id === ai.anthropic.model)
  return (
    <section>
      <h3>{t('Assistant')}</h3>
      <label className="pref-field">
        <span>{t('Provider')}</span>
        <select value={ai.provider} onChange={(e) => setAiPrefs({ provider: e.target.value as typeof ai.provider })}>
          <option value="anthropic">{t('Claude, with an API key')}</option>
          {/* Starting a program is something only the desktop app can do. */}
          <option value="claude-cli" disabled={!platform.claudeCli}>
            {platform.claudeCli ? t('Claude, through the Claude Code CLI on this computer') : t('Claude Code CLI (desktop app only)')}
          </option>
          <option value="ollama">{t('Local model, through Ollama')}</option>
          <option value="compatible">{t('Other (OpenAI-compatible)')}</option>
        </select>
      </label>

      {ai.provider === 'anthropic' && (
        <>
          <TextSetting label={t('API key')} secret placeholder="sk-ant-…" value={ai.anthropic.apiKey} onCommit={(apiKey) => setAiPrefs({ anthropic: { ...ai.anthropic, apiKey } })} />
          <label className="pref-field">
            <span>{t('Model')}</span>
            <select value={custom ? '' : ai.anthropic.model} onChange={(e) => setAiPrefs({ anthropic: { ...ai.anthropic, model: e.target.value } })}>
              {CLAUDE_MODELS.map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
              {custom && <option value="">{ai.anthropic.model}</option>}
            </select>
          </label>
          <p className="hint">{t('Create a key at console.anthropic.com. Usage is billed to your Anthropic account.')}</p>
          <p className="hint">{t('The key is stored on this computer, unencrypted, and is sent only to Anthropic.')}</p>
        </>
      )}

      {ai.provider === 'claude-cli' && (
        <>
          <TextSetting label={t('Model')} placeholder={t('Leave empty to use the CLI’s default')} value={ai.claudeCli.model} onCommit={(model) => setAiPrefs({ claudeCli: { model } })} />
          <p className="hint">
            {t('Uses the Claude Code command-line program installed on this computer, with the account it is signed in to, so no API key is needed here. It must be installed and signed in (run “claude” in a terminal once).')}
          </p>
          <p className="hint">{t('It runs with its command and file tools switched off, in an empty folder. It cannot look at imported pictures.')}</p>
        </>
      )}

      {ai.provider === 'ollama' && (
        <>
          <TextSetting label={t('Model')} placeholder={t('A model you have pulled, as listed by “ollama list”')} value={ai.ollama.model} onCommit={(model) => setAiPrefs({ ollama: { ...ai.ollama, model } })} />
          <TextSetting label={t('Address')} value={ai.ollama.baseUrl} onCommit={(baseUrl) => setAiPrefs({ ollama: { ...ai.ollama, baseUrl } })} />
          <p className="hint">{t('Runs entirely on this computer: nothing is sent over the internet. The model must support tool calling.')}</p>
          {!platform.desktop && <p className="hint">{t('In a browser, Ollama must be told to accept requests from this page (its OLLAMA_ORIGINS setting). The desktop app does not need that.')}</p>}
        </>
      )}

      {ai.provider === 'compatible' && (
        <>
          <TextSetting label={t('Address')} placeholder="https://api.openai.com/v1" value={ai.compatible.baseUrl} onCommit={(baseUrl) => setAiPrefs({ compatible: { ...ai.compatible, baseUrl } })} />
          <TextSetting label={t('Model')} placeholder={t('The model name your service expects')} value={ai.compatible.model} onCommit={(model) => setAiPrefs({ compatible: { ...ai.compatible, model } })} />
          <TextSetting label={t('API key')} secret value={ai.compatible.apiKey} onCommit={(apiKey) => setAiPrefs({ compatible: { ...ai.compatible, apiKey } })} />
          <p className="hint">{t('Works with any service that accepts the OpenAI chat-completions format and supports tool calling.')}</p>
          <p className="hint">{t('The key is stored on this computer, unencrypted, and is sent only to the address above.')}</p>
        </>
      )}

      <p className="hint">{t('When you use the assistant, your drawing is sent to the provider you chose. Imported pictures are left out unless the assistant asks to look at one.')}</p>
    </section>
  )
}

export function Preferences() {
  const open = useStore((s) => s.preferencesOpen)
  const prefs = usePrefs()
  if (!open) return null

  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog" role="dialog" aria-label={t('Preferences')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Preferences')}</h2>
          <button className="text-button" onClick={close}>
            {t('Done')}
          </button>
        </header>

        <section>
          <h3>{t('General')}</h3>
          <label className="pref-field">
            <span>{t('Language')}</span>
            <select value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value })}>
              <option value="auto">{t('Same as the system')}</option>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="pref-field">
            <span>{t('Unit')}</span>
            <select value={prefs.unit} onChange={(e) => setPrefs({ unit: e.target.value as typeof prefs.unit })}>
              {UNITS.map(([code, name]) => (
                <option key={code} value={code}>
                  {t(name)}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{t('Lengths are shown and typed in this unit. A different unit can always be typed after a number, such as 350 cm.')}</p>
          <Toggle label={t('Save automatically')} checked={prefs.autosave} onChange={(autosave) => setPrefs({ autosave })} />
          <p className="hint">{t('A drawing is saved to its file a moment after each change. A new drawing has to be saved once first, to give it a file.')}</p>
          <button className="text-button" onClick={resetLayout}>
            {t('Reset the panel layout')}
          </button>
        </section>

        <section>
          <h3>{t('Drawing')}</h3>
          <Toggle label={t('Show the grid')} checked={prefs.showGrid} onChange={(showGrid) => setPrefs({ showGrid })} />
          <Toggle label={t('Snap to the grid')} checked={prefs.snapToGrid} onChange={(snapToGrid) => setPrefs({ snapToGrid })} />
          <Toggle label={t('Snap to points of existing objects')} checked={prefs.snapToObjects} onChange={(snapToObjects) => setPrefs({ snapToObjects })} />
        </section>

        <AssistantSettings />

        <section>
          <h3>{t('Keyboard shortcuts')}</h3>
          <p className="hint">{t('Every command and its shortcut is in the command list. Click a shortcut there to change it.')}</p>
          <button
            className="text-button"
            onClick={() => {
              close()
              executeById('palette.open')
            }}
          >
            {t('Open the command list')}
          </button>
          <button className="text-button" onClick={() => executeById('shortcuts.reset')}>
            {t('Reset all shortcuts')}
          </button>
        </section>
      </div>
    </div>
  )
}
