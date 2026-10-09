import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  allCommands,
  eventKey,
  execute,
  formatKey,
  isCustomised,
  keysOf,
  resetShortcut,
  RESERVED_KEYS,
  setShortcut,
  useCommands,
  type Command,
} from './commands'
import { t } from './i18n'
import { toast } from './store'

const close = () => useCommands.setState({ paletteOpen: false })

/**
 * Every word of the query must appear somewhere in the command's category or title. The English
 * names match too, whatever the language, so a shortcut learned from documentation still works.
 */
function matches(command: Command, query: string): boolean {
  const text = `${t(command.category)} ${t(command.title)} ${command.category} ${command.title} ${command.keywords ?? ''}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word))
}

/**
 * Lists every command, filtered as you type. Enter runs the highlighted one. Clicking a command's
 * shortcut records a new one for it.
 */
export function CommandPalette() {
  const open = useCommands((s) => s.paletteOpen)
  const overrides = useCommands((s) => s.overrides)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  /** Id of the command whose shortcut is being recorded. */
  const [recording, setRecording] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setRecording(null)
  }, [open])

  // `overrides` is a dependency so the shortcuts shown stay current after a change.
  const commands = useMemo(() => (open ? allCommands().filter((c) => matches(c, query)) : []), [open, query, overrides])
  const active = Math.min(index, commands.length - 1)

  useEffect(() => {
    list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (command: Command) => {
    close()
    execute(command)
  }

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (recording) return record(e, recording)
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') setIndex(Math.min(active + 1, commands.length - 1))
    else if (e.key === 'ArrowUp') setIndex(Math.max(active - 1, 0))
    else if (e.key === 'Enter' && commands[active]) run(commands[active])
    else return
    e.preventDefault()
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          autoFocus
          placeholder={t('Type a command…')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
        />
        <div className="palette-list" ref={list}>
          {commands.length === 0 && <p className="hint">{t('No command matches “{query}”.', { query })}</p>}
          {commands.map((command, i) => {
            const keys = keysOf(command, overrides)
            const unavailable = command.when ? !command.when() : false
            return (
              <div
                key={command.id}
                className={`palette-row${i === active ? ' active' : ''}${unavailable ? ' unavailable' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(command)}
              >
                <span className="faint">{t(command.category)}</span>
                <span className="palette-title">{t(command.title)}</span>
                {isCustomised(command.id) && (
                  <button
                    className="palette-reset"
                    title={t('Restore the default shortcut')}
                    aria-label={t('Restore the default shortcut')}
                    onClick={(e) => {
                      e.stopPropagation()
                      resetShortcut(command.id)
                    }}
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
                <button
                  className={`palette-keys${recording === command.id ? ' recording' : ''}`}
                  title={t('Click, then press the new shortcut. Backspace removes it, Esc cancels.')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRecording(recording === command.id ? null : command.id)
                  }}
                >
                  {recording === command.id ? t('Press keys…') : keys.length > 0 ? keys.map(formatKey).join('  ') : t('Set shortcut')}
                </button>
              </div>
            )
          })}
        </div>
        <footer className="palette-footer">{t('↑↓ to move · Enter to run · click a shortcut to change it · Esc to close')}</footer>
      </div>
    </div>
  )
}
