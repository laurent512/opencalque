import { useEffect, useMemo, useState } from 'react'
import { Bot, Keyboard, PencilRuler, Puzzle, Settings2, type LucideIcon } from 'lucide-react'
import { allCommands, eventKey, executeById, formatKey, isCustomised, keysOf, RESERVED_KEYS, resetShortcut, setShortcut, useCommands, type Command } from './commands'
import { resetLayout } from './dock'
import { LANGUAGES, msg, t } from './i18n'
import { platform } from './platform'
import { CLAUDE_MODELS, setAiPrefs, setPrefs, usePrefs } from './prefs'
import { BUILT_IN_EXTENSION } from './extensions'
import { REPOSITORY } from './release'
import { useStore } from './store'
import { toast, useWindows } from './windows'
import { FRACTIONS, UNITS } from './units'
import { ExtensionWarehouse } from './WarehouseDialog'

const close = () => useWindows.setState({ preferencesOpen: false })

/** Says how a key is kept: encrypted by the system where the app can have it so (`keepKeysIn`), in plain text otherwise. */
function KeyNote(props: { encrypted: string; plain: string }) {
  const [encrypted, setEncrypted] = useState(false)
  useEffect(() => {
    void platform.secrets?.available().then(setEncrypted)
  }, [])
  return <p className="hint">{encrypted ? props.encrypted : props.plain}</p>
}

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

/** Everything that lets AI reach a drawing: the assistant in the app, then agents outside it where the app can let them in. */
function AiSettings() {
  return (
    <>
      <h3 className="pref-heading">{t('Assistant')}</h3>
      <AssistantSettings />
      {platform.agentBridge && (
        <>
          <h3 className="pref-heading">{t('Agents')}</h3>
          <AgentSettings />
        </>
      )}
    </>
  )
}

function AssistantSettings() {
  const ai = usePrefs((p) => p.ai)
  const custom = !CLAUDE_MODELS.some(([id]) => id === ai.anthropic.model)
  return (
    <>
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
          <KeyNote encrypted={t('The key is stored on this computer, encrypted by the system, and is sent only to Anthropic.')} plain={t('The key is stored on this computer, unencrypted, and is sent only to Anthropic.')} />
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
          <KeyNote encrypted={t('The key is stored on this computer, encrypted by the system, and is sent only to the address above.')} plain={t('The key is stored on this computer, unencrypted, and is sent only to the address above.')} />
        </>
      )}

      <p className="hint">{t('When you use the assistant, your drawing is sent to the provider you chose. Imported pictures are left out unless the assistant asks to look at one.')}</p>
    </>
  )
}

/** A word of a command line, quoted unless it is plain: a path on Windows has backslashes, and often spaces. */
const shellWord = (word: string) => (/^[\w./:=-]+$/.test(word) ? word : `"${word}"`)

/** Agents outside the app: whether they may work on the open drawing, and how to connect one. */
function AgentSettings() {
  const agentBridge = usePrefs((p) => p.agentBridge)
  const [connect, setConnect] = useState('')
  useEffect(() => {
    void platform.agentBridge?.command().then(({ command, args }) => setConnect(`claude mcp add opencalque-live -- ${[command, ...args].map(shellWord).join(' ')}`))
  }, [])
  const copy = () => void navigator.clipboard.writeText(connect).then(() => toast(t('Copied to the clipboard')))
  return (
    <>
      <Toggle label={t('Let agents on this computer work on the open drawing')} checked={agentBridge} onChange={(on) => setPrefs({ agentBridge: on })} />
      <p className="hint">{t('Programs on this computer that know how to reach it, such as Claude Code through the OpenCalque MCP server, can then read the open drawing and change it. Each change can be undone.')}</p>
      <p className="hint">{t('Any program you run on this computer can then reach the open drawing, so turn this off when you are not using it.')}</p>
      <p className="hint">{t('To connect Claude Code, run this once in a terminal:')}</p>
      {connect && (
        <div className="pref-command">
          <code>{connect}</code>
          <button className="text-button" onClick={copy}>
            {t('Copy')}
          </button>
        </div>
      )}
      <p className="hint">
        <a href={`${REPOSITORY}#ai-agents`} target="_blank" rel="noreferrer">
          {t('Other agents, and working on files')}
        </a>
      </p>
    </>
  )
}

function GeneralSettings() {
  const prefs = usePrefs()
  return (
    <>
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
        <span>{t('Theme')}</span>
        <select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as typeof prefs.theme })}>
          <option value="system">{t('Same as the system')}</option>
          <option value="light">{t('Light')}</option>
          <option value="dark">{t('Dark')}</option>
        </select>
      </label>
      {prefs.theme !== 'light' && (
        <>
          <Toggle label={t('Dark drawing area')} checked={prefs.darkCanvas} onChange={(darkCanvas) => setPrefs({ darkCanvas })} />
          <p className="hint">{t('In the dark theme, the drawing is shown light on dark. Turned off, it keeps the colours it will have on paper. Exports are never changed.')}</p>
        </>
      )}
      <Toggle label={t('Show the welcome window when the app starts')} checked={prefs.showWelcome} onChange={(showWelcome) => setPrefs({ showWelcome })} />
      {platform.checkForUpdate && (
        <>
          <Toggle label={t('Check for a new version when the app starts')} checked={prefs.checkUpdates} onChange={(checkUpdates) => setPrefs({ checkUpdates })} />
          <p className="hint">{t('OpenCalque asks GitHub, where it is published, whether a newer version is out. Where it can, it downloads it and installs it when the app closes.')}</p>
        </>
      )}
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
      {prefs.unit === 'ft-in' && (
        <label className="pref-field">
          <span>{t('To the nearest')}</span>
          <select value={prefs.fraction} onChange={(e) => setPrefs({ fraction: Number(e.target.value) })}>
            {FRACTIONS.map((under) => (
              <option key={under} value={under}>
                1/{under}"
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">{t('Lengths are shown and typed in this unit. A different unit can always be typed after a number, such as 350 cm.')}</p>
      <label className="pref-field">
        <span>{t('Decimal mark')}</span>
        <select value={prefs.decimal} onChange={(e) => setPrefs({ decimal: e.target.value as typeof prefs.decimal })}>
          <option value="auto">{t('As the language writes it')}</option>
          <option value=".">{t('With a point: 1.5')}</option>
          <option value=",">{t('With a comma: 1,5')}</option>
        </select>
      </label>
      <p className="hint">{t('Numbers in the panels are shown with it, and new drawings write theirs with it; a drawing’s own is in File › Drawing settings. Either mark can be typed.')}</p>
      <Toggle label={t('Save automatically')} checked={prefs.autosave} onChange={(autosave) => setPrefs({ autosave })} />
      <p className="hint">{t('A drawing is saved to its file a moment after each change. A new drawing has to be saved once first, to give it a file.')}</p>
      <button className="text-button" onClick={resetLayout}>
        {t('Reset the panel layout')}
      </button>
    </>
  )
}

function DrawingSettings() {
  const prefs = usePrefs()
  return (
    <>
      <Toggle label={t('Show the grid')} checked={prefs.showGrid} onChange={(showGrid) => setPrefs({ showGrid })} />
      <Toggle label={t('Snap to the grid')} checked={prefs.snapToGrid} onChange={(snapToGrid) => setPrefs({ snapToGrid })} />
      <Toggle label={t('Snap to existing objects, and line up what is moved with them')} checked={prefs.snapToObjects} onChange={(snapToObjects) => setPrefs({ snapToObjects })} />
      <p className="hint">{t('A point being placed snaps to the points of objects, the middle of a line, where two lines cross, the foot of a perpendicular, or the line itself. An object being moved lines up with the sides and middles of the others, and keeps equal gaps with its neighbours.')}</p>
      <p className="hint">{t('Holding Alt while drawing or moving turns snapping off for that moment.')}</p>
    </>
  )
}

const matches = (command: Command, query: string) => {
  const text = `${t(command.category)} ${t(command.title)} ${command.category} ${command.title} ${command.keywords ?? ''} ${keysOf(command).map(formatKey).join(' ')}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word))
}

/** Every command with its shortcut, to look through and to change. */
function ShortcutSettings() {
  const overrides = useCommands((s) => s.overrides)
  const [query, setQuery] = useState('')
  /** Id of the command whose shortcut is being recorded. */
  const [recording, setRecording] = useState<string | null>(null)
  // `overrides` is a dependency so that the shortcuts shown stay current after a change.
  const commands = useMemo(() => allCommands().filter((c) => matches(c, query)), [query, overrides])

  const record = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const key = eventKey(e.nativeEvent)
    if (!key) return
    if (key === 'Escape') return setRecording(null)
    if (key === 'Backspace' || key === 'Delete') setShortcut(id, null)
    else if (RESERVED_KEYS.includes(key)) return toast(t('{key} is reserved and cannot be reassigned', { key: formatKey(key) }))
    else {
      const taken = setShortcut(id, key)
      if (taken.length > 0) toast(t('{key} was removed from: {commands}', { key: formatKey(key), commands: taken.map((title) => t(title)).join(', ') }))
    }
    setRecording(null)
  }

  return (
    <>
      <p className="hint">{t('Click a shortcut, then press the keys you want for it. Backspace removes it; Esc leaves it as it is.')}</p>
      <div className="shortcut-bar">
        <input placeholder={t('Search a command or a key…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="text-button" onClick={() => executeById('shortcuts.reset')}>
          {t('Reset all shortcuts')}
        </button>
        <button className="text-button" title={t('Export keyboard shortcuts…')} onClick={() => executeById('shortcuts.export')}>
          {t('Export…')}
        </button>
        <button className="text-button" title={t('Import keyboard shortcuts…')} onClick={() => executeById('shortcuts.import')}>
          {t('Import…')}
        </button>
      </div>
      <div className="shortcut-list">
        {commands.length === 0 && <p className="hint">{t('Nothing matches.')}</p>}
        {commands.map((command) => {
          const keys = keysOf(command, overrides)
          return (
            <div key={command.id} className="shortcut-row">
              <span className="faint">{t(command.category)}</span>
              <span className="shortcut-title">{t(command.title)}</span>
              {isCustomised(command.id) && (
                <button className="text-button" title={t('Back to the default shortcut')} onClick={() => resetShortcut(command.id)}>
                  {t('Reset')}
                </button>
              )}
              <button
                className={`palette-keys${recording === command.id ? ' recording' : ''}`}
                onClick={() => setRecording(recording === command.id ? null : command.id)}
                onKeyDown={(e) => recording === command.id && record(e, command.id)}
                onBlur={() => recording === command.id && setRecording(null)}
              >
                {recording === command.id ? t('Press keys…') : keys.length > 0 ? keys.map(formatKey).join('  ') : t('Set shortcut')}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** The pages of the preferences, in the order of the list on the left. */
const PAGES: [id: string, title: string, icon: LucideIcon, page: () => React.ReactNode][] = [
  ['general', msg('General'), Settings2, GeneralSettings],
  ['drawing', msg('Drawing'), PencilRuler, DrawingSettings],
  ['ai', msg('AI'), Bot, AiSettings],
  ['shortcuts', msg('Keyboard shortcuts'), Keyboard, ShortcutSettings],
  ['extensions', msg('Extensions'), Puzzle, ExtensionWarehouse],
]

/** The app's settings: a list of pages on the left, the chosen page on the right. */
export function Preferences() {
  const open = useWindows((s) => s.preferencesOpen)
  const asked = useWindows((s) => s.preferencesPage)
  const [current, setCurrent] = useState(PAGES[0][0])
  // A command that opens Preferences on a given page (Extensions…) says which, once.
  useEffect(() => {
    if (!asked) return
    setCurrent(asked)
    useWindows.setState({ preferencesPage: null })
  }, [asked])
  if (!open) return null
  const [, title, , Page] = PAGES.find(([id]) => id === current) ?? PAGES[0]

  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog prefs" role="dialog" aria-label={t('Preferences')} onMouseDown={(e) => e.stopPropagation()}>
        <nav className="prefs-nav" aria-label={t('Preferences')}>
          <h2>{t('Preferences')}</h2>
          {PAGES.map(([id, name, Icon]) => (
            <button key={id} className={id === current ? 'active' : ''} aria-current={id === current ? 'page' : undefined} onClick={() => setCurrent(id)}>
              <Icon size={15} />
              {t(name)}
            </button>
          ))}
        </nav>
        <div className="prefs-page">
          <header>
            <h2>{t(title)}</h2>
            <button className="text-button" onClick={close}>
              {t('Done')}
            </button>
          </header>
          <div className="prefs-content">
            <Page />
          </div>
        </div>
      </div>
    </div>
  )
}
