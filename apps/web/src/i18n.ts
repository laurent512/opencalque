import { de } from './locales/de'
import { es } from './locales/es'
import { fr } from './locales/fr'

/**
 * Translation. The English text is the key: `t('Save as…')` returns the text in the active
 * language, or the English itself when there is no translation. Adding a language is one file in
 * `locales/` plus a line in each of the two tables below; a test checks every language covers
 * every string used in the source.
 */
export const LANGUAGES: [code: string, name: string][] = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
]

export const LOCALES: Record<string, Record<string, string>> = { fr, es, de }

let app: Record<string, string> = {}
let extensions: Record<string, string> = {}
let active = 'en'

/** The language the system is set to, when the app has it; English otherwise. */
function detect(): string {
  const wanted = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2).toLowerCase()
  return LANGUAGES.some(([code]) => code === wanted) ? wanted : 'en'
}

/**
 * Switches language. `preference` is a language code or 'auto'. `fromExtensions` holds the
 * translations extensions ship for their own labels, by language.
 */
export function setLanguage(preference: string, fromExtensions: Record<string, Record<string, string>> = {}): void {
  active = preference === 'auto' ? detect() : preference
  app = LOCALES[active] ?? {}
  extensions = fromExtensions[active] ?? {}
  if (typeof document !== 'undefined') document.documentElement.lang = active
}

export const language = () => active

/** Translates `source`, filling `{name}` placeholders from `values`. */
export function t(source: string, values?: Record<string, string | number>): string {
  const text = app[source] ?? extensions[source] ?? source
  return values ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole)) : text
}

/** Translates a text that depends on a count: `one` when it is 1, `other` otherwise. `{n}` is the count. */
export function tn(count: number, one: string, other: string, values?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { n: count, ...values })
}

/**
 * Marks a text for translation without translating it yet. For tables built when the app starts,
 * before the language is known; whatever displays the text later passes it through `t`.
 */
export const msg = (source: string): string => source
