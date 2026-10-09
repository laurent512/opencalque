import { DeclarativeExtensionSchema, parseDocument, type DeclarativeExtension, type Document } from '@opencalque/core'
import bundledIndex from './warehouse/components/index.json'

/**
 * The warehouse: component libraries and extensions that can be added to the app. Some ship with
 * it (the files under ./warehouse); more can come from a catalog published anywhere on the web.
 *
 * A catalog is a JSON file:
 *   { "libraries":  [{ "name": "…", "description": "…", "file": "relative/or/absolute.opencalque" }],
 *     "extensions": [{ "file": "relative/or/absolute.json" }] }
 * A library is an ordinary OpenCalque document; an extension is a declarative extension (data, not code).
 */
export interface Library {
  id: string
  name: string
  description: string
  /**
   * Translations of the library's name and description and of its components' names and
   * descriptions, by language code and then by the English text, like an extension's.
   */
  translations?: Record<string, Record<string, string>>
  /** Number of components, when known without opening the library. */
  components?: number
  load(): Promise<Document>
}

// Vite turns these into separate files fetched only when a library is opened. Importing them,
// rather than fetching by URL, also works in the desktop app, which is loaded from disk.
const libraryFiles = import.meta.glob('./warehouse/components/*.opencalque', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const extensionFiles = import.meta.glob('./warehouse/extensions/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

export function bundledLibraries(): Library[] {
  return (bundledIndex as unknown as (Omit<Library, 'load'> & { file: string })[]).map((entry) => ({
    ...entry,
    load: async () => parseDocument(JSON.parse(await libraryFiles[`./warehouse/components/${entry.file}`]())),
  }))
}

export function bundledExtensions(): DeclarativeExtension[] {
  return Object.values(extensionFiles).map((json) => DeclarativeExtensionSchema.parse(json))
}

/** Reads a catalog from the web. Entries that cannot be read are skipped rather than failing the lot. */
export async function remoteCatalog(url: string): Promise<{ libraries: Library[]; extensions: DeclarativeExtension[] }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const catalog = (await response.json()) as { libraries?: { name: string; description?: string; file: string; translations?: Library['translations'] }[]; extensions?: { file: string }[] }
  const json = async (file: string) => (await fetch(new URL(file, url))).json()

  const libraries = (catalog.libraries ?? []).map((entry): Library => ({
    id: new URL(entry.file, url).href,
    name: String(entry.name),
    description: String(entry.description ?? ''),
    translations: entry.translations,
    load: async () => parseDocument(await json(entry.file)),
  }))
  const extensions: DeclarativeExtension[] = []
  for (const entry of catalog.extensions ?? []) {
    const parsed = DeclarativeExtensionSchema.safeParse(await json(entry.file).catch(() => null))
    if (parsed.success) extensions.push(parsed.data)
  }
  return { libraries, extensions }
}
