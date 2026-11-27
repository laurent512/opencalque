import { searchable } from './search'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { PAPER_SERIES, type PaperSeries } from '@opencalque/core'
import { Bot, ChevronUp, GripVertical, Keyboard, PanelBottom, PencilRuler, Plus, Puzzle, Settings2, X, type LucideIcon } from 'lucide-react'
import { allCommands, eventKey, executeById, formatKey, isCustomised, keysOf, RESERVED_KEYS, resetShortcut, setShortcut, useCommands, type Command } from './commands'
import { resetLayout } from './dock'
import { LANGUAGES, msg, t } from './i18n'
import { platform } from './platform'
import { CLAUDE_MODELS, setAiPrefs, setPrefs, usePrefs } from './prefs'
import { REPOSITORY } from './release'
import { Select } from './Select'
import { useStore } from './store'
import { toast, useWindows } from './windows'
import { FRACTIONS, UNITS } from './units'
import { ExtensionWarehouse } from './WarehouseDialog'
import { addEntry, ALL_ITEMS, canJoin, dropOn, itemOf, itemsIn, removeEntry, sameToolbar, saveToolbar, SEPARATOR, tidyToolbar, TOOLBAR_DEFAULT, type DragSource, type DropTarget, type SavedToolbar, type ToolbarLayout } from './toolbar'

const close = () => useWindows.setState({ preferencesOpen: false })

/** Says how a key is kept: encrypted by the system where the app can have it so (`keepKeysIn`), in plain text otherwise. */
function KeyNote(props: { encrypted: string; plain: string }) {
  const [encrypted, setEncrypted] = useState(false)
  useEffect(() => {
    void platform.secrets?.available().then(setEncrypted)
  }, [])
  return <p className="hint">{encrypted ? props.encrypted : props.plain}</p>
}

/** What a setting does, said under it: a sentence, or what is given as it is. */
function Hint({ hint }: { hint?: React.ReactNode }) {
  if (hint === undefined || hint === null || hint === false) return null
  return typeof hint === 'string' ? <p className="hint">{hint}</p> : <>{hint}</>
}

/** A titled part of a page of the preferences: its settings in one box, one under another. */
function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="pref-section">
      <h3 className="pref-heading">{props.title}</h3>
      <div className="pref-card">{props.children}</div>
    </section>
  )
}

/** One setting: its name on the left, what sets it on the right, what it does under both. */
function Setting(props: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pref-item">
      <label className="pref-field">
        <span>{props.label}</span>
        {props.children}
      </label>
      <Hint hint={props.hint} />
    </div>
  )
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: React.ReactNode }) {
  return (
    <div className="pref-item">
      <label className="pref-row">
        <span>{props.label}</span>
        <input type="checkbox" role="switch" className="pref-switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      </label>
      <Hint hint={props.hint} />
    </div>
  )
}

/** A text setting saved when the field is left, so a key is not written to storage on every keystroke. */
function TextSetting(props: { label: string; value: string; secret?: boolean; placeholder?: string; hint?: React.ReactNode; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value)
  useEffect(() => {
    setText(props.value)
  }, [props.value])
  return (
    <Setting label={props.label} hint={props.hint}>
      <input
        type={props.secret ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== props.value && props.onCommit(text.trim())}
      />
    </Setting>
  )
}

/** Everything that lets AI reach a drawing: the assistant in the app, then agents outside it where the app can let them in. */
function AiSettings() {
  return (
    <>
      <Section title={t('Assistant')}>
        <AssistantSettings />
      </Section>
      {platform.agentBridge && (
        <Section title={t('Agents')}>
          <AgentSettings />
        </Section>
      )}
    </>
  )
}

function AssistantSettings() {
  const ai = usePrefs((p) => p.ai)
  const custom = !CLAUDE_MODELS.some(([id]) => id === ai.anthropic.model)
  return (
    <>
      <Setting label={t('Provider')} hint={t('When you use the assistant, your drawing is sent to the provider you chose. Imported pictures are left out unless the assistant asks to look at one.')}>
        <Select
          value={ai.provider}
          onChange={(provider) => setAiPrefs({ provider: provider as typeof ai.provider })}
          options={[
            { value: 'anthropic', label: t('Claude, with an API key') },
            // Starting a program is something only the desktop app can do.
            { value: 'claude-cli', label: platform.claudeCli ? t('Claude, through the Claude Code CLI on this computer') : t('Claude Code CLI (desktop app only)'), disabled: !platform.claudeCli },
            { value: 'ollama', label: t('Local model, through Ollama') },
            { value: 'compatible', label: t('Other (OpenAI-compatible)') },
          ]}
        />
      </Setting>

      {ai.provider === 'anthropic' && (
        <>
          <TextSetting
            label={t('API key')}
            secret
            placeholder="sk-ant-…"
            value={ai.anthropic.apiKey}
            onCommit={(apiKey) => setAiPrefs({ anthropic: { ...ai.anthropic, apiKey } })}
            hint={
              <>
                <p className="hint">{t('Create a key at console.anthropic.com. Usage is billed to your Anthropic account.')}</p>
                <KeyNote encrypted={t('The key is stored on this computer, encrypted by the system, and is sent only to Anthropic.')} plain={t('The key is stored on this computer, unencrypted, and is sent only to Anthropic.')} />
              </>
            }
          />
          <Setting label={t('Model')}>
            <Select
              value={custom ? '' : ai.anthropic.model}
              onChange={(model) => model && setAiPrefs({ anthropic: { ...ai.anthropic, model } })}
              options={[...CLAUDE_MODELS.map(([id, label]) => ({ value: id, label: t(label) })), ...(custom ? [{ value: '', label: ai.anthropic.model }] : [])]}
            />
          </Setting>
        </>
      )}

      {ai.provider === 'claude-cli' && (
        <TextSetting
          label={t('Model')}
          placeholder={t('Leave empty to use the CLI’s default')}
          value={ai.claudeCli.model}
          onCommit={(model) => setAiPrefs({ claudeCli: { model } })}
          hint={
            <>
              <p className="hint">{t('Uses the Claude Code command-line program installed on this computer, with the account it is signed in to, so no API key is needed here. It must be installed and signed in (run “claude” in a terminal once).')}</p>
              <p className="hint">{t('It runs with its command and file tools switched off, in an empty folder. It cannot look at imported pictures.')}</p>
            </>
          }
        />
      )}

      {ai.provider === 'ollama' && (
        <>
          <TextSetting label={t('Model')} placeholder={t('A model you have pulled, as listed by “ollama list”')} value={ai.ollama.model} onCommit={(model) => setAiPrefs({ ollama: { ...ai.ollama, model } })} />
          <TextSetting
            label={t('Address')}
            value={ai.ollama.baseUrl}
            onCommit={(baseUrl) => setAiPrefs({ ollama: { ...ai.ollama, baseUrl } })}
            hint={
              <>
                <p className="hint">{t('Runs entirely on this computer: nothing is sent over the internet. The model must support tool calling.')}</p>
                {!platform.desktop && <p className="hint">{t('In a browser, Ollama must be told to accept requests from this page (its OLLAMA_ORIGINS setting). The desktop app does not need that.')}</p>}
              </>
            }
          />
        </>
      )}

      {ai.provider === 'compatible' && (
        <>
          <TextSetting label={t('Address')} placeholder="https://api.openai.com/v1" value={ai.compatible.baseUrl} onCommit={(baseUrl) => setAiPrefs({ compatible: { ...ai.compatible, baseUrl } })} />
          <TextSetting label={t('Model')} placeholder={t('The model name your service expects')} value={ai.compatible.model} onCommit={(model) => setAiPrefs({ compatible: { ...ai.compatible, model } })} />
          <TextSetting
            label={t('API key')}
            secret
            value={ai.compatible.apiKey}
            onCommit={(apiKey) => setAiPrefs({ compatible: { ...ai.compatible, apiKey } })}
            hint={
              <>
                <p className="hint">{t('Works with any service that accepts the OpenAI chat-completions format and supports tool calling.')}</p>
                <KeyNote encrypted={t('The key is stored on this computer, encrypted by the system, and is sent only to the address above.')} plain={t('The key is stored on this computer, unencrypted, and is sent only to the address above.')} />
              </>
            }
          />
        </>
      )}
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
      <Toggle
        label={t('Let agents on this computer work on the open drawing')}
        checked={agentBridge}
        onChange={(on) => setPrefs({ agentBridge: on })}
        hint={
          <>
            <p className="hint">{t('Programs on this computer that know how to reach it, such as Claude Code through the OpenCalque MCP server, can then read the open drawing and change it. Each change can be undone.')}</p>
            <p className="hint">{t('Any program you run on this computer can then reach the open drawing, so turn this off when you are not using it.')}</p>
          </>
        }
      />
      <div className="pref-item">
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
      </div>
    </>
  )
}

function GeneralSettings() {
  const prefs = usePrefs()
  return (
    <>
      <Section title={t('Language and appearance')}>
        <Setting label={t('Language')}>
          <Select value={prefs.language} onChange={(language) => setPrefs({ language })} options={[{ value: 'auto', label: t('Same as the system') }, ...LANGUAGES.map(([code, name]) => ({ value: code, label: name }))]} />
        </Setting>
        <Setting label={t('Theme')}>
          <Select
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme: theme as typeof prefs.theme })}
            options={[
              { value: 'system', label: t('Same as the system') },
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
            ]}
          />
        </Setting>
        {prefs.theme !== 'light' && (
          <Toggle
            label={t('Dark drawing area')}
            checked={prefs.darkCanvas}
            onChange={(darkCanvas) => setPrefs({ darkCanvas })}
            hint={t('In the dark theme, the drawing is shown light on dark. Turned off, it keeps the colours it will have on paper. Exports are never changed.')}
          />
        )}
        <div className="pref-item">
          <button className="text-button" onClick={resetLayout}>
            {t('Reset the panel layout')}
          </button>
        </div>
      </Section>
      <Section title={t('Units')}>
        <Setting label={t('Unit')} hint={t('Lengths are shown and typed in this unit. A different unit can always be typed after a number, such as 350 cm.')}>
          <Select value={prefs.unit} onChange={(unit) => setPrefs({ unit: unit as typeof prefs.unit })} options={UNITS.map(([code, name]) => ({ value: code, label: t(name) }))} />
        </Setting>
        {prefs.unit === 'ft-in' && (
          <Setting label={t('To the nearest')}>
            <Select value={String(prefs.fraction)} onChange={(under) => setPrefs({ fraction: Number(under) })} options={FRACTIONS.map((under) => ({ value: String(under), label: `1/${under}"` }))} />
          </Setting>
        )}
        <Setting label={t('Sheet sizes')} hint={t('The standard sheets a paper is drawn to: ISO (A4, A3…), or the ARCH and ANSI sizes used in the United States. Any of them can be given to a paper in its properties.')}>
          <Select value={prefs.paperSeries} onChange={(series) => setPrefs({ paperSeries: series as PaperSeries })} options={PAPER_SERIES.map((series) => ({ value: series, label: series }))} />
        </Setting>
        <Setting label={t('Decimal mark')} hint={t('Numbers in the panels are shown with it, and new drawings write theirs with it; a drawing’s own is in File › Drawing settings. Either mark can be typed.')}>
          <Select
            value={prefs.decimal}
            onChange={(decimal) => setPrefs({ decimal: decimal as typeof prefs.decimal })}
            options={[
              { value: 'auto', label: t('As the language writes it') },
              { value: '.', label: t('With a point: 1.5') },
              { value: ',', label: t('With a comma: 1,5') },
            ]}
          />
        </Setting>
      </Section>
      <Section title={t('Starting and saving')}>
        <Toggle
          label={t('Save automatically')}
          checked={prefs.autosave}
          onChange={(autosave) => setPrefs({ autosave })}
          hint={t('A drawing is saved to its file a moment after each change. A new drawing has to be saved once first, to give it a file.')}
        />
        <Toggle label={t('Show the welcome window when the app starts')} checked={prefs.showWelcome} onChange={(showWelcome) => setPrefs({ showWelcome })} />
        {platform.checkForUpdate && (
          <Toggle
            label={t('Check for a new version when the app starts')}
            checked={prefs.checkUpdates}
            onChange={(checkUpdates) => setPrefs({ checkUpdates })}
            hint={t('OpenCalque asks GitHub, where it is published, whether a newer version is out. Where it can, it downloads it and installs it when the app closes.')}
          />
        )}
      </Section>
    </>
  )
}

function DrawingSettings() {
  const prefs = usePrefs()
  return (
    <>
      <Section title={t('Grid and snapping')}>
        <Toggle label={t('Show the grid')} checked={prefs.showGrid} onChange={(showGrid) => setPrefs({ showGrid })} />
        <Toggle label={t('Snap to the grid')} checked={prefs.snapToGrid} onChange={(snapToGrid) => setPrefs({ snapToGrid })} />
        <Toggle
          label={t('Snap to existing objects, and line up what is moved with them')}
          checked={prefs.snapToObjects}
          onChange={(snapToObjects) => setPrefs({ snapToObjects })}
          hint={
            <>
              <p className="hint">{t('A point being placed snaps to the points of objects, the middle of a line, where two lines cross, the foot of a perpendicular, or the line itself. An object being moved lines up with the sides and middles of the others, and keeps equal gaps with its neighbours.')}</p>
              <p className="hint">{t('Holding Alt while drawing or moving turns snapping off for that moment.')}</p>
            </>
          }
        />
      </Section>
      <Section title={t('Groups and components')}>
        <Setting label={t('Editing inside a group')}>
          <Select
            value={prefs.editGroups}
            onChange={(editGroups) => setPrefs({ editGroups: editGroups as typeof prefs.editGroups })}
            options={[
              { value: 'faded', label: t('Show the rest of the drawing faded') },
              { value: 'alone', label: t('Show the group alone') },
            ]}
          />
        </Setting>
        <Setting
          label={t('Editing a component')}
          hint={t('Faded, the rest of the drawing can be snapped to but not selected. A component opened from the Components panel or the object library, or placed both stretched and turned, is always shown alone.')}
        >
          <Select
            value={prefs.editComponents}
            onChange={(editComponents) => setPrefs({ editComponents: editComponents as typeof prefs.editComponents })}
            options={[
              { value: 'faded', label: t('Show the rest of the drawing faded') },
              { value: 'alone', label: t('Show the component alone') },
            ]}
          />
        </Setting>
      </Section>
    </>
  )
}

/** Names a toolbar item in a list: its tooltip up to the colon, the explanation after it being for the tooltip. */
const itemName = (id: string) => (id === SEPARATOR ? t('Separator') : t(itemOf(id)!.title).split(/\s*:/)[0])

/** The picture of a toolbar item; a separator as the line it is. */
function ItemIcon({ id }: { id: string }) {
  if (id === SEPARATOR) return <span className="toolbar-separator" />
  const Icon = itemOf(id)!.icon
  return <Icon size={15} />
}

/** The toolbar as it will look: its buttons, a list shown by its first tool and an arrow, and its separators. */
function ToolbarPreview({ layout }: { layout: ToolbarLayout }) {
  return (
    <div className="toolbar-preview" aria-hidden>
      {tidyToolbar(layout).map((entry, i) =>
        entry === SEPARATOR ? (
          <hr key={i} />
        ) : (
          <span key={i} className="toolbar-preview-button" title={entry.map(itemName).join(', ')}>
            <ItemIcon id={entry[0]} />
            {entry.length > 1 && <ChevronUp size={10} />}
          </span>
        ),
      )}
    </div>
  )
}

/** A small button of a row: here, only taking it out; everything else is done by dragging. */
function RowAction(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-button" title={props.title} aria-label={props.title} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

/** Which saved toolbar the one in use is: its place among them, 'default' for the one that comes, or 'changed' for none. */
function toolbarInUse(layout: ToolbarLayout, saved: SavedToolbar[]): string {
  const at = saved.findIndex((one) => sameToolbar(one.toolbar, layout))
  return at >= 0 ? String(at) : sameToolbar(layout, TOOLBAR_DEFAULT) ? 'default' : 'changed'
}

/**
 * The floating toolbar, set up by dragging, as it reads from left to right: its buttons and its
 * separators, a list of tools open under its button. A row is dragged between two others to move it,
 * onto a button to join its list, out of a list to a button of its own, or onto what is not in the
 * toolbar to take it out; what is not in it, a separator among them, is dragged in. The toolbar in
 * use can be saved under a name, and those saved switched between, at the top.
 */
function ToolbarSettings() {
  const layout = tidyToolbar(usePrefs((p) => p.toolbar), true)
  const saved = usePrefs((p) => p.savedToolbars)
  const [dragging, setDragging] = useState<DragSource | null>(null)
  // Read by the handlers, which may run before the drag's start is drawn: what is dragged, now.
  const carried = useRef<DragSource | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)
  const [name, setName] = useState('')
  const save = (toolbar: ToolbarLayout) => setPrefs({ toolbar })
  const held = itemsIn(layout)
  const missing = [SEPARATOR, ...ALL_ITEMS.filter((id) => !held.has(id))]
  const inUse = toolbarInUse(layout, saved)

  const start = (source: DragSource) => (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    // Something must be carried for the drag to start everywhere; what is carried is in `dragging`.
    e.dataTransfer.setData('text/plain', '')
    carried.current = source
    setDragging(source)
  }
  const end = () => {
    carried.current = null
    setDragging(null)
    setOver(null)
  }
  /** Lets go of what is dragged at `target`, or wherever `aim` says from where the pointer is over the row. */
  const target = (aim: (e: React.DragEvent) => DropTarget | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!carried.current) return
      const at = aim(e)
      if (!at) return
      e.preventDefault()
      e.stopPropagation()
      if (JSON.stringify(at) !== JSON.stringify(over)) setOver(at)
    },
    onDrop: (e: React.DragEvent) => {
      const source = carried.current
      const at = source && aim(e)
      if (!at) return
      e.preventDefault()
      e.stopPropagation()
      save(dropOn(layout, source!, at))
      end()
    },
  })
  /** Over a row of the toolbar: its upper half puts before it, its lower half after it, and its middle, on a button of tools, joins its list. */
  const onRow = (at: number) => (e: React.DragEvent): DropTarget => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - box.top) / box.height
    if (carried.current && canJoin(layout, carried.current, at) && y > 0.25 && y < 0.75) return { kind: 'join', at }
    return { kind: 'before', at: y < 0.5 ? at : at + 1 }
  }
  /** Over a tool of a list: before it or after it, in the list. */
  const onListRow = (at: number, index: number) => (e: React.DragEvent): DropTarget => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { kind: 'list', at, index: e.clientY - box.top < box.height / 2 ? index : index + 1 }
  }
  const lineBefore = (at: number) => over?.kind === 'before' && over.at === at
  const joining = (at: number) => over?.kind === 'join' && over.at === at
  const lineInList = (at: number, index: number) => over?.kind === 'list' && over.at === at && over.index === index

  return (
    <>
      <Section title={t('Toolbars')}>
        <Setting label={t('Toolbar in use')} hint={t('Switching applies it at once. Changes are made to the toolbar in use; save it again to keep them under its name.')}>
          <Select
            value={inUse}
            onChange={(chosen) => {
              if (chosen === 'default') save(TOOLBAR_DEFAULT)
              else if (chosen !== 'changed') save(saved[Number(chosen)].toolbar)
            }}
            options={[
              { value: 'default', label: t('As it comes') },
              ...saved.map((one, i) => ({ value: String(i), label: one.name })),
              ...(inUse === 'changed' ? [{ value: 'changed', label: t('Changed, not saved') }] : []),
            ]}
          />
        </Setting>
        <form
          className="pref-item toolbar-save"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            setPrefs({ savedToolbars: saveToolbar(saved, name, layout) })
            setName('')
          }}
        >
          <input aria-label={t('Name of the toolbar')} placeholder={t('Name of the toolbar')} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="pill" type="submit" disabled={!name.trim()}>
            {t('Save')}
          </button>
          {/^\d+$/.test(inUse) && (
            <button type="button" className="text-button" onClick={() => setPrefs({ savedToolbars: saved.filter((_, i) => i !== Number(inUse)) })}>
              {t('Delete “{name}”', { name: saved[Number(inUse)].name })}
            </button>
          )}
        </form>
      </Section>
      <Section title={t('Toolbar')}>
        <div className="pref-item">
          <ToolbarPreview layout={layout} />
          <p className="hint">{t('Drag a row between two others to move it, onto a button to put it in its list, out of a list to give it a button of its own, or onto “Not in the toolbar” to take it out. A button with a list shows the tool used last; the small arrow beside it opens the list. A right-click on the toolbar opens this page.')}</p>
        </div>
        <ol className="toolbar-items" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}>
          {layout.map((entry, at) => {
            const list = entry !== SEPARATOR && entry.length > 1
            const ids = entry === SEPARATOR ? [SEPARATOR] : entry
            return (
              <li key={`${ids.join(' ')} ${at}`} className={`toolbar-item${dragging?.kind === 'entry' && dragging.at === at ? ' dragged' : ''}`}>
                <div
                  className={`toolbar-item-row${lineBefore(at) ? ' drop-before' : ''}${joining(at) ? ' drop-join' : ''}${entry === SEPARATOR ? ' separator-row' : ''}`}
                  draggable
                  onDragStart={start({ kind: 'entry', at })}
                  onDragEnd={end}
                  {...target(onRow(at))}
                >
                  <GripVertical size={13} className="faint" />
                  <ItemIcon id={ids[0]} />
                  <span className="toolbar-item-name">{list ? t('List of {n} tools', { n: String(ids.length) }) : itemName(ids[0])}</span>
                  <RowAction title={t('Take out of the toolbar')} onClick={() => save(removeEntry(layout, at))}>
                    <X size={13} />
                  </RowAction>
                </div>
                {list && (
                  <ol className="toolbar-list">
                    {ids.map((id, index) => (
                      <li
                        key={id}
                        className={`toolbar-item-row${lineInList(at, index) ? ' drop-before' : ''}${dragging?.kind === 'tool' && dragging.at === at && dragging.index === index ? ' dragged' : ''}`}
                        draggable
                        onDragStart={start({ kind: 'tool', at, index })}
                        onDragEnd={end}
                        {...target(onListRow(at, index))}
                      >
                        <GripVertical size={13} className="faint" />
                        <ItemIcon id={id} />
                        <span className="toolbar-item-name">{itemName(id)}</span>
                        <RowAction title={t('Take out of the toolbar')} onClick={() => save(removeEntry(layout, at, index))}>
                          <X size={13} />
                        </RowAction>
                      </li>
                    ))}
                    {/* After its last tool, the end of the list. */}
                    <li className={`toolbar-list-end${lineInList(at, ids.length) ? ' drop-before' : ''}`} {...target(() => ({ kind: 'list', at, index: ids.length }))} />
                  </ol>
                )}
              </li>
            )
          })}
          <li className={`toolbar-end${lineBefore(layout.length) ? ' drop-before' : ''}`} {...target(() => ({ kind: 'before', at: layout.length }))}>
            {t('Drop here to put it at the end')}
          </li>
        </ol>
        <div className="toolbar-actions">
          <button className="text-button" onClick={() => save(TOOLBAR_DEFAULT)}>
            {t('Back to the toolbar as it comes')}
          </button>
        </div>
      </Section>
      <section className="pref-section">
        <h3 className="pref-heading">{t('Not in the toolbar')}</h3>
        <ol
          className={`pref-card toolbar-items toolbar-palette${over?.kind === 'remove' ? ' drop-remove' : ''}`}
          {...target(() => (carried.current && carried.current.kind !== 'new' ? { kind: 'remove' } : null))}
        >
          {missing.map((id) => (
            <li key={id} className={`toolbar-item-row${id === SEPARATOR ? ' separator-row' : ''}`} draggable onDragStart={start({ kind: 'new', id })} onDragEnd={end}>
              <GripVertical size={13} className="faint" />
              <ItemIcon id={id} />
              <span className="toolbar-item-name">{itemName(id)}</span>
              <RowAction title={`${t('Add to the toolbar')}: ${itemName(id)}`} onClick={() => save(addEntry(layout, id))}>
                <Plus size={13} />
              </RowAction>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

const matches = (command: Command, query: string) => {
  const text = searchable(`${t(command.category)} ${t(command.title)} ${command.category} ${command.title} ${command.keywords ?? ''} ${keysOf(command).map(formatKey).join(' ')}`)
  return searchable(query).split(/\s+/).every((word) => text.includes(word))
}

/** What the drawing is scrolled with: a mouse, whose wheel zooms, or a trackpad, on which two fingers move the view (`canvas/wheel.ts`). */
function PointingSetting() {
  const scroll = usePrefs((s) => s.scroll)
  return (
    <Section title={t('Mouse and trackpad')}>
      <Setting
        label={t('Scrolling with')}
        hint={
          <>
            <p className="hint">{t('With a mouse, the wheel zooms. On a trackpad, two fingers move the view. Automatic tells them apart by how they scroll, which a mouse with a fine wheel can get wrong: then say which you use.')}</p>
            <p className="hint">{t('A pinch on a trackpad, or Ctrl (⌘ on a Mac) with the wheel, always zooms. Shift with the wheel moves the view sideways. Space, or the middle button, held while dragging, moves it too.')}</p>
          </>
        }
      >
        <Select
          value={scroll}
          onChange={(chosen) => setPrefs({ scroll: chosen as typeof scroll })}
          options={[
            { value: 'auto', label: t('Automatic') },
            { value: 'mouse', label: t('Mouse') },
            { value: 'trackpad', label: t('Trackpad') },
          ]}
        />
      </Setting>
    </Section>
  )
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
      <PointingSetting />
      <h3 className="pref-heading">{t('Shortcuts')}</h3>
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
  ['toolbar', msg('Toolbar'), PanelBottom, ToolbarSettings],
  ['shortcuts', msg('Keyboard shortcuts'), Keyboard, ShortcutSettings],
  ['extensions', msg('Extensions'), Puzzle, ExtensionWarehouse],
]

/** The app's settings: a list of pages on the left, the chosen page on the right. */
export function Preferences() {
  const open = useWindows((s) => s.preferencesOpen)
  const asked = useWindows((s) => s.preferencesPage)
  const [current, setCurrent] = useState(PAGES[0][0])
  // A command that opens Preferences on a given page (Extensions) says which, once.
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
