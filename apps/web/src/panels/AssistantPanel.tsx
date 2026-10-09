import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Paperclip, Plus, Square, Trash2, X } from 'lucide-react'
import {
  currentModel,
  deleteConversation,
  isConfigured,
  listModels,
  newConversation,
  note,
  openConversation,
  sendMessage,
  setModel,
  stop,
  takesPictures,
  useChat,
  type Attachment,
  type ModelChoice,
} from '../ai/chat'
import { attachmentFrom, pictureFiles } from '../ai/pictures'
import { msg, t } from '../i18n'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { IconButton } from '../ui'

const EXAMPLES = [
  msg('Draw a 5 × 4 m room with a door on the bottom wall'),
  msg('Add a window to each exterior wall'),
  msg('Put the selected objects on a new layer called Furniture'),
]

/** Pictures one message can carry. */
const MAX_PICTURES = 5

/** What can be typed after a slash instead of a message. Those with `takes` are followed by a choice. */
const SLASH: { name: string; hint: string; takes?: boolean }[] = [
  { name: 'new', hint: msg('Start a new conversation') },
  { name: 'resume', hint: msg('Go back to an earlier conversation'), takes: true },
  { name: 'model', hint: msg('Change the model'), takes: true },
  { name: 'clear', hint: msg('Delete this conversation') },
  { name: 'help', hint: msg('List these commands') },
]

/** One line of the list that opens above the message while a command is being typed. */
interface Suggestion {
  key: string
  label: string
  hint?: string
  run(): void
}

/** A conversation with a model that can read and change the drawing. */
export function AssistantPanel() {
  const entries = useChat((s) => s.entries)
  const busy = useChat((s) => s.busy)
  const conversations = useChat((s) => s.conversations)
  const current = useChat((s) => s.current)
  const ai = usePrefs((p) => p.ai)
  const configured = isConfigured(ai)
  const model = currentModel(ai)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [models, setModels] = useState<ModelChoice[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const end = useRef<HTMLDivElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  // The list of models depends on the provider, and for local or other services on what they report.
  const service = ai.provider === 'ollama' ? ai.ollama.baseUrl : ai.provider === 'compatible' ? `${ai.compatible.baseUrl} ${ai.compatible.apiKey}` : ''
  useEffect(() => {
    let stale = false
    listModels(usePrefs.getState().ai).then((list) => !stale && setModels(list))
    return () => {
      stale = true
    }
  }, [ai.provider, service, model])

  const attach = (files: File[]) => {
    for (const file of files.slice(0, MAX_PICTURES - attachments.length)) {
      attachmentFrom(file).then(
        (attachment) => setAttachments((list) => (list.length < MAX_PICTURES ? [...list, attachment] : list)),
        () => note(t('That picture could not be read.'), 'error'),
      )
    }
  }

  const send = (message = text) => {
    // A command is carried out here, never sent to the model.
    if (message === text && offered) return offered[pick]?.run()
    if (busy || (message.trim() === '' && attachments.length === 0)) return
    setText('')
    setAttachments([])
    sendMessage(message.trim(), attachments)
  }

  /** The choices for what is typed when it is a command, or null when it is an ordinary message. */
  const suggestions = (): Suggestion[] | null => {
    if (!text.startsWith('/')) return null
    const [, name = '', rest] = /^\/(\S*)(?:\s+(.*))?$/s.exec(text) ?? []
    const query = (rest ?? '').trim().toLowerCase()
    const done = () => setText('')
    if (rest === undefined) {
      return SLASH.filter((c) => c.name.startsWith(name.toLowerCase())).map((c) => ({
        key: c.name,
        label: `/${c.name}`,
        hint: t(c.hint),
        run: () => {
          if (c.takes) return setText(`/${c.name} `)
          done()
          if (c.name === 'new') newConversation()
          else if (c.name === 'clear') deleteConversation()
          else note(SLASH.map((s) => `/${s.name}: ${t(s.hint)}`).join('\n'))
        },
      }))
    }
    if (name === 'resume') {
      return conversations
        .filter((c) => c.id !== current && c.title.toLowerCase().includes(query))
        .map((c) => ({ key: c.id, label: c.title, hint: new Date(c.updated).toLocaleDateString(), run: () => (done(), openConversation(c.id)) }))
    }
    if (name === 'model') {
      return models.filter(([id, label]) => `${id} ${label}`.toLowerCase().includes(query)).map(([id, label]) => ({ key: id, label, hint: id === model ? t('in use') : undefined, run: () => (done(), setModel(id)) }))
    }
    return []
  }
  const offered = configured ? suggestions() : null
  const pick = Math.min(highlighted, (offered?.length ?? 1) - 1)

  if (!configured) {
    return (
      <div className="assistant-panel">
        <div className="assistant-log">
          <p className="hint">{t('The assistant changes the drawing for you from a description. It needs an AI provider and, for most, an API key.')}</p>
          <button className="text-button" onClick={() => useStore.setState({ preferencesOpen: true })}>
            {t('Set it up in Preferences')}
          </button>
        </div>
      </div>
    )
  }

  const kept = conversations.some((c) => c.id === current)
  const canSeePictures = takesPictures(ai)

  return (
    <div className="assistant-panel">
      <div className="assistant-head">
        <select aria-label={t('Conversation')} title={t('Conversation')} value={current} disabled={busy} onChange={(e) => openConversation(e.target.value)}>
          {!kept && <option value={current}>{t('New conversation')}</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <IconButton title={t('New conversation')} onClick={newConversation} disabled={busy || entries.length === 0}>
          <Plus size={14} />
        </IconButton>
        <IconButton title={t('Delete this conversation')} onClick={deleteConversation} disabled={busy || entries.length === 0}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className="assistant-log">
        {entries.length === 0 && (
          <>
            <p className="hint">{t('Describe what you want drawn or changed. Each request can be undone with one undo.')}</p>
            {EXAMPLES.map((example) => (
              <button key={example} className="assistant-example" onClick={() => send(t(example))}>
                {t(example)}
              </button>
            ))}
            <p className="hint">{t('You can paste or attach a picture, and type / for commands such as /resume.')}</p>
          </>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={`assistant-entry ${entry.role}`}>
            {entry.pictures?.map((src, n) => <img key={n} src={src} alt="" />)}
            {entry.text}
          </div>
        ))}
        {busy && <div className="assistant-entry activity">{t('Working…')}</div>}
        <div ref={end} />
      </div>

      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        onDragOver={(e) => canSeePictures && e.preventDefault()}
        onDrop={(e) => {
          const files = pictureFiles(e.dataTransfer)
          if (!canSeePictures || files.length === 0) return
          e.preventDefault()
          attach(files)
        }}
      >
        {offered && (
          <div className="assistant-suggest" role="listbox">
            {offered.length === 0 && <p className="hint">{t('Nothing matches.')}</p>}
            {offered.map((s, i) => (
              // Pressed, not clicked: the message field must keep the focus.
              <button key={s.key} type="button" role="option" aria-selected={i === pick} className={i === pick ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), s.run())} onMouseEnter={() => setHighlighted(i)}>
                <span>{s.label}</span>
                <span className="faint">{s.hint}</span>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="assistant-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="assistant-attachment">
                <img src={a.preview} alt="" />
                <button type="button" title={t('Remove the picture')} aria-label={t('Remove the picture')} onClick={() => setAttachments(attachments.filter((_, n) => n !== i))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          rows={3}
          placeholder={t('Ask for a change, or type / for commands…')}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setHighlighted(0)
          }}
          onPaste={(e) => {
            const files = pictureFiles(e.clipboardData)
            if (!canSeePictures || files.length === 0) return
            e.preventDefault()
            attach(files)
          }}
          onKeyDown={(e) => {
            if (offered) {
              // While a command is being typed the keys work its list; nothing is sent to the model.
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                if (offered.length > 0) setHighlighted((pick + (e.key === 'ArrowDown' ? 1 : offered.length - 1)) % offered.length)
              } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault()
                setHighlighted(0)
                if (offered.length > 0) offered[pick].run()
                else note(t('There is no such command. Type / to see the commands.'), 'error')
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setText('')
              }
              return
            }
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="assistant-actions">
          <input
            ref={filePicker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <IconButton title={canSeePictures ? t('Attach a picture (or paste one)') : t('This provider cannot be shown pictures')} onClick={() => filePicker.current?.click()} disabled={!canSeePictures || attachments.length >= MAX_PICTURES}>
            <Paperclip size={14} />
          </IconButton>
          <select className="assistant-model" aria-label={t('Model')} title={t('Model')} value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
            {(models.some(([id]) => id === model) ? models : [...models, [model, model] as ModelChoice]).map(([id, label]) => (
              <option key={id} value={id}>
                {label || t('Model')}
              </option>
            ))}
          </select>
          {busy ? (
            <IconButton title={t('Stop')} onClick={stop} active>
              <Square size={12} />
            </IconButton>
          ) : (
            <IconButton title={t('Send (Enter)')} onClick={() => send()} active disabled={text.trim() === '' && attachments.length === 0}>
              <ArrowUp size={14} />
            </IconButton>
          )}
        </div>
      </form>
    </div>
  )
}
