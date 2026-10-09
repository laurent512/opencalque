import { create } from 'zustand'
import { applyOps } from '@opencalque/core'
import { t } from '../i18n'
import { platform } from '../platform'
import { CLAUDE_MODELS, setAiPrefs, usePrefs, type Prefs } from '../prefs'
import { collapseHistory, registry, replaceDoc, useStore } from '../store'
import { runRequest, systemPrompt, TOOLS, type AgentHost } from './agent'
import { anthropicProvider } from './anthropic'
import { claudeCliProvider } from './claudecli'
import { compatibleProvider, type Http } from './compatible'
import type { ChatSession, Picture, Provider } from './types'

export interface ChatEntry {
  /** 'activity' and 'error' are one-line notes about what the assistant did to the drawing. */
  role: 'user' | 'assistant' | 'activity' | 'error'
  text: string
  /** Small previews, as data URLs, of the pictures sent with a message. */
  pictures?: string[]
}

/** A picture ready to send: what the model gets, and a small preview to show in the conversation. */
export interface Attachment {
  picture: Picture
  preview: string
}

type ProviderKind = Prefs['ai']['provider']

/** A conversation as it is kept between sessions of the app. */
export interface Conversation {
  id: string
  title: string
  /** When it was last added to, in milliseconds since 1970. */
  updated: number
  entries: ChatEntry[]
  /** The provider that holds `history`, which only that provider can continue from. */
  provider?: ProviderKind
  history?: unknown
}

const STORAGE_KEY = 'opencalque.chats'
/** Conversations kept; older ones are forgotten. */
const KEPT = 30

function loadConversations(): Conversation[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.entries)) : []
  } catch {
    return []
  }
}

function storeConversations(conversations: Conversation[]): void {
  let kept = conversations
  for (let drop = 0; drop <= kept.length; drop++) {
    try {
      return localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
    } catch {
      // Storage is full (or unavailable): give up what the model remembers of the oldest
      // conversations, one more each time. What was said stays readable.
      kept = kept.map((c, i) => (i >= kept.length - 1 - drop ? { ...c, history: undefined } : c))
    }
  }
}

const newId = () => `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const useChat = create(() => ({
  /** Earlier conversations, most recent first. The current one joins them with its first message. */
  conversations: loadConversations(),
  current: newId(),
  entries: [] as ChatEntry[],
  busy: false,
}))

const host: AgentHost = {
  state: () => {
    const { doc, scope, selection } = useStore.getState()
    return { doc, scope, selection }
  },
  apply: (ops) => replaceDoc(applyOps(useStore.getState().doc, ops)),
}

/** The model session of the current conversation, with the settings it was made with. */
let live: { provider: Provider; session: ChatSession; kind: ProviderKind; settings: string } | null = null
/** What was said earlier that the session's model has not seen, to send along with the next message. */
let carry = ''
let abort: AbortController | null = null

/** Whether the chosen provider has what it needs to be called. */
export function isConfigured(ai: Prefs['ai'] = usePrefs.getState().ai): boolean {
  switch (ai.provider) {
    case 'anthropic':
      return ai.anthropic.apiKey !== ''
    case 'claude-cli':
      return platform.claudeCli !== undefined
    case 'ollama':
      return ai.ollama.model !== ''
    case 'compatible':
      return ai.compatible.model !== '' && ai.compatible.baseUrl !== ''
  }
}

/** Whether pictures attached to a message reach the chosen provider's model. */
export const takesPictures = (ai: Prefs['ai']) => ai.provider !== 'claude-cli'

/** The desktop app makes the request itself, so a local model server need not allow this app's origin. */
const http: Http = async (url, init, signal) => {
  if (platform.request) return platform.request(url, init)
  const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body || undefined, signal })
  return { status: response.status, body: await response.text() }
}

function createProvider(ai: Prefs['ai']): Provider {
  switch (ai.provider) {
    case 'anthropic':
      return anthropicProvider(ai.anthropic)
    case 'claude-cli':
      return claudeCliProvider(ai.claudeCli, platform.claudeCli!, (error) =>
        error instanceof DOMException ? '' : t('The Claude CLI could not answer: {reason}', { reason: error instanceof Error ? error.message : String(error) }),
      )
    case 'ollama':
      return compatibleProvider({ ...ai.ollama, apiKey: '' }, http)
    case 'compatible':
      return compatibleProvider(ai.compatible, http)
  }
}

/** What was said so far as plain text, for a model that cannot be handed the conversation itself. */
function transcript(entries: ChatEntry[]): string {
  const lines = entries.flatMap((e) => (e.role === 'user' ? [`Person: ${e.text}`] : e.role === 'assistant' ? [`Assistant: ${e.text}`] : []))
  return lines.join('\n\n').slice(-12_000)
}

/**
 * The session to send the next message through. A conversation outlives its session: when the
 * model or provider changed, or the conversation was reopened, a new session is made and given
 * what came before, in the provider's own format when it has it and as a transcript otherwise.
 */
function currentSession(): NonNullable<typeof live> {
  const { ai } = usePrefs.getState()
  const settings = JSON.stringify(ai)
  if (live?.settings === settings) return live
  const { conversations, current, entries } = useChat.getState()
  const stored = conversations.find((c) => c.id === current)
  const history = live ? (live.kind === ai.provider ? live.session.snapshot() : undefined) : stored?.provider === ai.provider ? stored.history : undefined
  if (history === undefined) carry = transcript(entries)
  const provider = createProvider(ai)
  live = { provider, session: provider.createSession({ system: systemPrompt(registry), tools: TOOLS, history }), kind: ai.provider, settings }
  return live
}

const add = (entry: ChatEntry) => useChat.setState((s) => ({ entries: [...s.entries, entry] }))

/** Adds a note to the conversation that is for the person only; the model never sees it. */
export const note = (text: string, role: 'activity' | 'error' = 'activity') => add({ role, text })

/** Appends streamed text to the reply being written, starting a new one after a note or a question. */
function write(delta: string): void {
  useChat.setState((s) => {
    const last = s.entries.at(-1)
    if (last?.role !== 'assistant') return { entries: [...s.entries, { role: 'assistant', text: delta }] }
    return { entries: [...s.entries.slice(0, -1), { role: 'assistant', text: last.text + delta }] }
  })
}

/** Puts the current conversation, as it stands, at the top of the kept ones. */
function remember(): void {
  const { conversations, current, entries } = useChat.getState()
  const first = entries.find((e) => e.role === 'user')
  if (!first) return
  const title = first.text.split('\n')[0].slice(0, 60) || t('Picture')
  const record: Conversation = { id: current, title, updated: Date.now(), entries, provider: live?.kind, history: live?.session.snapshot() }
  const next = [record, ...conversations.filter((c) => c.id !== current)].slice(0, KEPT)
  useChat.setState({ conversations: next })
  storeConversations(next)
}

export async function sendMessage(text: string, attachments: Attachment[] = []): Promise<void> {
  if (useChat.getState().busy || (text.trim() === '' && attachments.length === 0)) return
  const active = currentSession()
  add({ role: 'user', text, pictures: attachments.length > 0 ? attachments.map((a) => a.preview) : undefined })
  const seen = active.provider.pictures ? attachments.map((a) => a.picture) : []
  if (attachments.length > seen.length) note(t('This provider cannot be shown pictures, so they were left out.'), 'error')
  const words = text.trim() || '(See the attached picture.)'
  const message = carry ? `<earlier_conversation>\n${carry}\n</earlier_conversation>\n\n${words}` : words
  carry = ''
  useChat.setState({ busy: true })
  abort = new AbortController()
  // Everything the assistant changes for this request becomes one undo step.
  const mark = useStore.getState().past.length
  try {
    await runRequest(active.session, host, message, { onText: write, onActivity: (kind, text) => add({ role: kind === 'done' ? 'activity' : 'error', text }) }, abort.signal, seen)
  } catch (error) {
    add({ role: 'error', text: active.provider.describeError(error) || t('Stopped.') })
  } finally {
    collapseHistory(mark)
    useChat.setState({ busy: false })
    abort = null
    remember()
  }
}

export function stop(): void {
  abort?.abort()
  platform.cancelClaudeCli?.()
}

/** Starts an empty conversation. The one left stays among the earlier ones. */
export function newConversation(): void {
  if (useChat.getState().busy) return
  live = null
  carry = ''
  useChat.setState({ current: newId(), entries: [] })
}

/** Goes back to an earlier conversation, to read it or carry it on. */
export function openConversation(id: string): void {
  const { conversations, busy, current } = useChat.getState()
  const conversation = conversations.find((c) => c.id === id)
  if (busy || !conversation || id === current) return
  live = null
  carry = ''
  useChat.setState({ current: id, entries: conversation.entries })
}

/** Forgets the current conversation for good. */
export function deleteConversation(): void {
  const { conversations, current, busy } = useChat.getState()
  if (busy) return
  const next = conversations.filter((c) => c.id !== current)
  useChat.setState({ conversations: next })
  storeConversations(next)
  newConversation()
}

/** The model the chosen provider is set to use; '' means the provider's own default. */
export function currentModel(ai: Prefs['ai']): string {
  return ai.provider === 'anthropic' ? ai.anthropic.model : ai.provider === 'claude-cli' ? ai.claudeCli.model : ai.provider === 'ollama' ? ai.ollama.model : ai.compatible.model
}

/** Changes the model of the chosen provider. A conversation in progress carries on with the new one. */
export function setModel(model: string): void {
  const { ai } = usePrefs.getState()
  if (ai.provider === 'anthropic') setAiPrefs({ anthropic: { ...ai.anthropic, model } })
  else if (ai.provider === 'claude-cli') setAiPrefs({ claudeCli: { model } })
  else if (ai.provider === 'ollama') setAiPrefs({ ollama: { ...ai.ollama, model } })
  else setAiPrefs({ compatible: { ...ai.compatible, model } })
}

export type ModelChoice = [id: string, label: string]

/** The models that can be picked for the chosen provider. Services that can list theirs are asked. */
export async function listModels(ai: Prefs['ai']): Promise<ModelChoice[]> {
  const current = currentModel(ai)
  const withCurrent = (choices: ModelChoice[]) => (choices.some(([id]) => id === current) ? choices : [...choices, [current, current] as ModelChoice])
  if (ai.provider === 'anthropic') return withCurrent(CLAUDE_MODELS.map(([id, label]): ModelChoice => [id, t(label)]))
  if (ai.provider === 'claude-cli') {
    return withCurrent([
      ['', t('The CLI’s default model')],
      ['opus', 'Claude Opus'],
      ['sonnet', 'Claude Sonnet'],
      ['haiku', 'Claude Haiku'],
    ])
  }
  const config = ai.provider === 'ollama' ? { ...ai.ollama, apiKey: '' } : ai.compatible
  let ids: string[] = []
  try {
    const headers: Record<string, string> = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
    const response = await http(`${config.baseUrl.replace(/\/+$/, '')}/models`, { method: 'GET', headers, body: '' }, new AbortController().signal)
    const listed = response.status >= 200 && response.status < 300 ? JSON.parse(response.body).data : []
    if (Array.isArray(listed)) ids = listed.map((m) => String(m.id)).sort()
  } catch {
    // The service is not running or does not list its models; the one in use is still offered.
  }
  return current === '' && ids.length > 0 ? ids.map((id): ModelChoice => [id, id]) : withCurrent(ids.map((id): ModelChoice => [id, id]))
}
