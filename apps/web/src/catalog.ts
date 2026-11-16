import { DeclarativeExtensionSchema, parseDocument, type DeclarativeExtension, type Document } from '@opencalque/core'
import bundledIndex from '@opencalque/warehouse/components/index.json'
export { bundledExtensions } from '@opencalque/warehouse'

/**
 * The warehouse: component libraries and extensions that can be added to the app. Some ship with
 * it (`packages/warehouse`); more can come from a catalog published anywhere on the web.
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
  /**
   * Where the object library lists components of this library, by their id: a room such as
   * 'bedroom' or 'dining' (or any section of the library). One not given is listed under the
   * library's name.
   */
  categories?: Record<string, string>
  load(): Promise<Document>
}

// Vite turns these into separate files fetched only when a library is opened. Importing them,
// rather than fetching by URL, also works in the desktop app, which is loaded from disk.
// A glob takes no package name, hence the path to the package.
const libraryFiles = import.meta.glob('../../../packages/warehouse/components/*.opencalque', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export function bundledLibraries(): Library[] {
  return (bundledIndex as unknown as (Omit<Library, 'load'> & { file: string })[]).map((entry) => ({
    ...entry,
    load: async () => parseDocument(JSON.parse(await libraryFiles[`../../../packages/warehouse/components/${entry.file}`]())),
  }))
}

/** Reads a catalog from the web. Entries that cannot be read are skipped rather than failing the lot. */
export async function remoteCatalog(url: string): Promise<{ libraries: Library[]; extensions: DeclarativeExtension[] }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const catalog = (await response.json()) as { libraries?: { name: string; description?: string; file: string; translations?: Library['translations']; categories?: unknown }[]; extensions?: { file: string }[] }
  const json = async (file: string) => (await fetch(new URL(file, url))).json()
  const strings = (value: unknown) => (value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, text]) => typeof text === 'string')) : undefined)

  const libraries = (catalog.libraries ?? []).map((entry): Library => ({
    id: new URL(entry.file, url).href,
    name: String(entry.name),
    description: String(entry.description ?? ''),
    translations: entry.translations,
    categories: strings(entry.categories),
    load: async () => parseDocument(await json(entry.file)),
  }))
  const extensions: DeclarativeExtension[] = []
  for (const entry of catalog.extensions ?? []) {
    const parsed = DeclarativeExtensionSchema.safeParse(await json(entry.file).catch(() => null))
    if (parsed.success) extensions.push(parsed.data)
  }
  return { libraries, extensions }
}
