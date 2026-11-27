import { create } from 'zustand'
import type { SecretStore } from './platform'
import type { DeclarativeExtension, PaperSeries } from '@opencalque/core'
import { msg } from './i18n'
import type { Surroundings } from './surroundings'
import { readScrollPref, type ScrollPref } from './canvas/wheel'
import { TOOLBAR_DEFAULT, type SavedToolbar, type ToolbarLayout } from './toolbar'

/**
 * Settings that belong to the person using the app, not to a drawing. They are kept in the
 * browser's local storage (per browser profile, or per desktop install).
 */
export interface Prefs {
  /** A language code, or 'auto' to follow the system. */
  language: string
  /** How the interface looks: 'system' follows the light or dark setting of the computer. */
  theme: 'system' | 'light' | 'dark'
  /** In the dark theme, draw the drawing light on dark too. Off, the drawing keeps its paper colours. */
  darkCanvas: boolean
  /** The unit lengths are shown and typed in. Drawings are stored in millimetres whatever it is. */
  unit: 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in'
  /** With feet and inches: the fraction of an inch lengths are rounded to, as its lower number (16 for sixteenths). */
  fraction: number
  /** The mark between the whole and the decimals of a number: 'auto' writes it as the language does (a comma in French, a point in English). */
  decimal: 'auto' | '.' | ','
  /** The standard sheets a paper being drawn is offered: ISO (A4, A3…), or the US ARCH or ANSI sizes. Any of them can be chosen for a paper drawn. */
  paperSeries: PaperSeries
  /** Save a drawing to its file by itself a moment after each change. */
  autosave: boolean
  /** Offer a new drawing, a file or the example in a window when the app starts. */
  showWelcome: boolean
  /** Desktop app: look for a newer version when the app starts, and download it where it can install it. */
  checkUpdates: boolean
  showGrid: boolean
  snapToGrid: boolean
  snapToObjects: boolean
  /** Show how far the one object selected stands from the walls around it, as dimensions to type into. */
  showClearances: boolean
  /** Put a room, with its name and area, in each space walls close as they are drawn (`roomsAfterEdit`). */
  autoRooms: boolean
  /** While editing inside a group: the rest of the drawing shown faded around it, to see and snap to, or not shown. */
  editGroups: Surroundings
  /** The same, while editing a component gone into by one of its placements. */
  editComponents: Surroundings
  /** Desktop app: let agents on this computer work on the open drawing. Off until the person turns it on. */
  agentBridge: boolean
  /** How the Components panel shows them: one per line, or as pictures side by side. */
  componentsView: 'list' | 'grid'
  /** The sections of the Properties panel folded under their headings, by title. */
  foldedSections: string[]
  /** In the Properties panel, a width or height typed changes the other in proportion. */
  keepProportions: boolean
  /** Whether exports and prints carry the marks drawn on the plan to work with (the eyes of viewpoints, the lines of views): the export window's Viewpoints and view lines. */
  exportMarks: boolean
  /**
   * Viewpoints (`panels/properties/viewpoint.tsx`): how their views are drawn (lines on white,
   * shaded, or a depth map), and what the description given with a picture asks of the photograph
   * (the shape of the picture is its frame's): a style among those offered (`preset`, an id of
   * `perspective/wishes.ts`, '' for none), the person's own words (`style`), and a light (`light`).
   */
  perspective: { look: 'lines' | 'clay' | 'depth'; preset: string; style: string; light: string }
  /**
   * What the person scrolls over the drawing with, a mouse (its wheel zooms) or a trackpad (two
   * fingers move the view), or 'auto' to tell them apart by their events (`canvas/wheel.ts`). A
   * pinch or Ctrl with the wheel zoom whichever it is. Stored as `scroll`, read by `readScrollPref`.
   */
  scroll: ScrollPref
  /** What the floating toolbar holds, from left to right (`toolbar.ts`): buttons, a tool or a list of tools each, and separators. */
  toolbar: ToolbarLayout
  /** Toolbars saved under a name in Preferences › Toolbar, to switch between. */
  savedToolbars: SavedToolbar[]
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
  ['claude-haiku-5-5', msg('Claude Haiku 5.5 (fastest, cheapest)')],
  ['claude-fable-5-1', msg('Claude Fable 5.1 (most capable)')],
]

/**
 * The unit a first start begins with: feet and inches where plans are drawn in them (the region of
 * the system's language is the United States, Liberia or Myanmar), millimetres everywhere else.
 * It is a guess, shown in the welcome window to be corrected; once chosen, the unit is kept.
 */
function usualUnit(): Prefs['unit'] {
  // The first language the system lists says where it is: "en-US", "es-US".
  const first = typeof navigator === 'undefined' ? '' : (navigator.language ?? '')
  return /[-_](US|LR|MM)$/i.test(first) ? 'ft-in' : 'mm'
}

const DEFAULTS: Prefs = {
  language: 'auto',
  theme: 'system',
  darkCanvas: true,
  unit: usualUnit(),
  fraction: 16,
  decimal: 'auto',
  paperSeries: 'ISO',
  autosave: true,
  showWelcome: true,
  checkUpdates: true,
  showGrid: true,
  snapToGrid: true,
  snapToObjects: true,
  showClearances: true,
  autoRooms: true,
  editGroups: 'faded',
  editComponents: 'alone',
  agentBridge: false,
  componentsView: 'list',
  foldedSections: [],
  keepProportions: false,
  exportMarks: false,
  perspective: { look: 'clay', preset: '', style: '', light: '' },
  scroll: 'auto',
  toolbar: TOOLBAR_DEFAULT,
  savedToolbars: [],
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
/** The providers whose settings hold a key, kept in the system's keychain where there is one (`keepKeysIn`). */
const KEYED = ['anthropic', 'compatible'] as const

/** Where the keys are kept once `keepKeysIn` has been given a keychain: then never written with the other preferences. */
let keychain: SecretStore | null = null
const PROVIDERS = ['anthropic', 'claudeCli', 'ollama', 'compatible'] as const

/** Whether the unit was chosen, rather than guessed from the system's language (`usualUnit`): once chosen, it is kept. */
let unitChosen = false

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    unitChosen = stored.unit !== undefined
    const ai = { ...DEFAULTS.ai, ...stored.ai }
    for (const key of PROVIDERS) ai[key] = { ...DEFAULTS.ai[key], ...ai[key] }
    return { ...DEFAULTS, ...stored, ai, extensions: { ...DEFAULTS.extensions, ...stored.extensions }, perspective: { ...DEFAULTS.perspective, ...stored.perspective }, scroll: readScrollPref(stored.scroll) }
  } catch {
    return DEFAULTS
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What of `value` differs from `fallback`, key by key: what is the same is left out. */
function differing<T extends object>(value: T, fallback: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => !same(v, (fallback as Record<string, unknown>)[key]))) as Partial<T>
}

/**
 * What is written to storage: only what differs from the defaults, the settings of each AI
 * provider one by one. A default changed in a later version (a newer model, a setting turned on)
 * then reaches everyone who never chose otherwise, where storing every setting would keep the old
 * defaults for good as soon as one setting was changed. The unit is kept once chosen.
 */
export function storedPrefs(prefs: Prefs): Record<string, unknown> {
  const out: Record<string, unknown> = differing(prefs, DEFAULTS)
  if (unitChosen) out.unit = prefs.unit
  const ai: Record<string, unknown> = prefs.ai.provider === DEFAULTS.ai.provider ? {} : { provider: prefs.ai.provider }
  for (const key of PROVIDERS) {
    const own = differing(prefs.ai[key], DEFAULTS.ai[key])
    if (Object.keys(own).length > 0) ai[key] = own
  }
  // In a keychain, a key is not written with the rest in plain text.
  if (keychain) for (const key of KEYED) if (ai[key]) delete (ai[key] as Record<string, unknown>).apiKey
  for (const key of KEYED) if (ai[key] && Object.keys(ai[key] as object).length === 0) delete ai[key]
  delete out.ai
  if (Object.keys(ai).length > 0) out.ai = ai
  delete out.extensions
  const extensions = differing(prefs.extensions, DEFAULTS.extensions)
  if (Object.keys(extensions).length > 0) out.extensions = extensions
  return out
}

export const usePrefs = create<Prefs>(() => load())

export function setPrefs(patch: Partial<Prefs>): void {
  if (patch.unit !== undefined) unitChosen = true
  const before = usePrefs.getState().ai
  usePrefs.setState(patch)
  const after = usePrefs.getState().ai
  if (keychain) for (const key of KEYED) if (after[key].apiKey !== before[key].apiKey) void keychain.set(key, after[key].apiKey)
  write()
}

function write(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedPrefs(usePrefs.getState())))
  } catch {
    // Storage can be unavailable (private windows); the change then lasts for this session.
  }
}

/**
 * Keeps the keys of the assistant's services in `store`, the desktop app's keychain, from now on:
 * those it holds are read into the preferences, and those still written with the preferences (by a
 * version before, or a computer that could not encrypt them then) are moved into it and taken out of
 * them. Where the store cannot encrypt, nothing changes. Called once, at start.
 */
export async function keepKeysIn(store: SecretStore): Promise<void> {
  if (!(await store.available())) return
  const ai = { ...usePrefs.getState().ai }
  for (const key of KEYED) {
    const kept = await store.get(key)
    if (kept) ai[key] = { ...ai[key], apiKey: kept } as never
    else if (ai[key].apiKey) await store.set(key, ai[key].apiKey)
  }
  keychain = store
  usePrefs.setState({ ai })
  write()
}

export function setAiPrefs(patch: Partial<Prefs['ai']>): void {
  setPrefs({ ai: { ...usePrefs.getState().ai, ...patch } })
}
