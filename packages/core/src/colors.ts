import type { Document, SharedColor } from './schema'

/**
 * Shared colours are named colours that belong to the drawing. Anything that takes a colour (a
 * stroke, a fill, a layer) can refer to one instead of holding a colour of its own, written the
 * way CSS writes a reference: `var(--<id>)`. Changing the shared colour then changes everything
 * that refers to it, because nothing else was copied.
 */
const REFERENCE = /^var\(--([\w-]+)\)$/
/** The same, anywhere inside a longer text such as a node written out as JSON. */
const REFERENCES = /var\(--([\w-]+)\)/g

/** What is drawn for a reference to a colour that is no longer there. */
const MISSING = '#1f1f1f'

/** The way a colour property refers to the shared colour `id`. */
export const colorRef = (id: string) => `var(--${id})`

/** The id of the shared colour a value refers to, or null when it is a colour in its own right. */
export function colorRefOf(value: unknown): string | null {
  return typeof value === 'string' ? (REFERENCE.exec(value)?.[1] ?? null) : null
}

/** A colour as it is to be painted: the shared colour's value for a reference, the value itself otherwise. */
export function resolveColor<T extends string | undefined>(doc: Document, value: T): T {
  const id = colorRefOf(value)
  return id === null ? value : ((doc.colors?.[id]?.value ?? MISSING) as T)
}

/** The shared colours of a drawing, in the order they were made. */
export const colorsOf = (doc: Document): SharedColor[] => Object.values(doc.colors ?? {})

/** The ids of the shared colours something refers to, wherever in it the references are. */
export function colorRefsIn(value: unknown): string[] {
  return [...new Set([...JSON.stringify(value ?? null).matchAll(REFERENCES)].map((match) => match[1]))]
}

/** How many nodes and layers refer to a shared colour. */
export function colorUses(doc: Document, id: string): number {
  const reference = colorRef(id)
  const uses = (thing: unknown) => JSON.stringify(thing).includes(reference)
  return Object.values(doc.nodes).filter(uses).length + Object.values(doc.layers).filter(uses).length
}

/** A copy of something with every reference to one shared colour replaced by a plain colour. */
export function withoutColorRef<T>(thing: T, id: string, value: string): T {
  const text = JSON.stringify(thing)
  const reference = colorRef(id)
  return text.includes(reference) ? (JSON.parse(text.split(reference).join(value)) as T) : thing
}
