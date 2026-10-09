import { pagesOf, rootOf } from './document'
import type { Document } from './schema'

/**
 * Fields are words in a text that the drawing fills in: `{page}` becomes the name of the page the
 * text is on, and so on. They are written in braces so that a text can be read, and typed, with
 * them in it. A text shows the same on screen and in every export, since they are filled in where
 * primitives are made.
 */
export const TEXT_FIELDS = ['date', 'page', 'page-number', 'pages', 'document'] as const

const FIELD = /\{(date|page|page-number|pages|document)\}/g

/** A text with its fields filled in for the node that holds it; `parentId` is that node's parent. */
export function fillFields(text: string, doc: Document, parentId: string | null): string {
  if (!text.includes('{')) return text
  return text.replace(FIELD, (_, field: (typeof TEXT_FIELDS)[number]) => {
    const pages = pagesOf(doc)
    const page = rootOf(doc, parentId)
    switch (field) {
      case 'date':
        // The day the drawing is looked at or exported, written the way this computer writes dates.
        return new Date().toLocaleDateString()
      case 'page':
        return page?.name ?? ''
      case 'page-number':
        return page?.type === 'page' ? String(pages.findIndex((p) => p.id === page.id) + 1) : ''
      case 'pages':
        return String(pages.length)
      case 'document':
        return doc.name
    }
  })
}
