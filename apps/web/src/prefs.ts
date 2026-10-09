import { create } from 'zustand'
import type { DeclarativeExtension } from '@opencalque/core'
import { msg } from './i18n'

/**
 * Settings that belong to the person using the app, not to a drawing. They are kept in the
 * browser's local storage (per browser profile, or per desktop install).
 */
export interface Prefs {
  /** A language code, or 'auto' to follow the system. */
  language: string
  /** The unit lengths are shown and typed in. Drawings are stored in millimetres whatever it is. */
  unit: 'mm' | 'cm' | 'm' | 'in' | 'ft'
  /** Save a drawing to its file by itself a moment after each change. */
  autosave: boolean
  showGrid: boolean
  snapToGrid: boolean
  snapToObjects: boolean
  extensions: {
    /** Declarative extensions the user installed, by id. They are data, so they are stored whole. */
    installed: Record<string, DeclarativeExtension>
    /** Ids of extensions that are present but switched off, including the built-in one. */
    disabled: string[]
  }
  /** Address of an extra warehouse catalog on the web, or '' for none. */
  catalogUrl: string
  ai: {
    provider: 'anthropic' | 'claude-cli' | 'ollama' | 'compatible'
    /** Each provider keeps its own settings, so switching never sends one provider's key to another. */
    anthropic: { apiKey: string; model: string }
    /** The Claude Code CLI installed on this computer (desktop app only). An empty model means the CLI's default. */
    claudeCli: { model: string }
    /** A model running on this computer through Ollama. */
    ollama: { model: string; baseUrl: string }
    /** Any other service that speaks the OpenAI chat-completions protocol. */
    compatible: { apiKey: string; model: string; baseUrl: string }
  }
}

export const CLAUDE_MODELS: [string, string][] = [
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', msg('Claude Sonnet 5.5 (faster, cheaper)')],
  ['claude-haiku-4-5', msg('Claude Haiku 4.5 (fastest)')],
  ['claude-fable-5-1', msg('Claude Fable 5.1 (most capable)')],
]

const DEFAULTS: Prefs = {
  language: 'auto',
  unit: 'mm',
  autosave: true,
  showGrid: true,
  snapToGrid: true,
  snapToObjects: true,
  extensions: { installed: {}, disabled: [] },
  catalogUrl: '',
  ai: {
    provider: 'anthropic',
    anthropic: { apiKey: '', model: 'claude-opus-5-5' },
    claudeCli: { model: '' },
    ollama: { model: '', baseUrl: 'http://localhost:11434/v1' },
    compatible: { apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' },
  },
}

const STORAGE_KEY = 'opencalque.prefs'

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const ai = { ...DEFAULTS.ai, ...stored.ai }
    for (const key of ['anthropic', 'claudeCli', 'ollama', 'compatible'] as const) ai[key] = { ...DEFAULTS.ai[key], ...ai[key] }
    return { ...DEFAULTS, ...stored, ai, extensions: { ...DEFAULTS.extensions, ...stored.extensions } }
  } catch {
    return DEFAULTS
  }
}

export const usePrefs = create<Prefs>(() => load())

export function setPrefs(patch: Partial<Prefs>): void {
  usePrefs.setState(patch)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usePrefs.getState()))
  } catch {
    // Storage can be unavailable (private windows); the change then lasts for this session.
  }
}

export function setAiPrefs(patch: Partial<Prefs['ai']>): void {
  setPrefs({ ai: { ...usePrefs.getState().ai, ...patch } })
}
