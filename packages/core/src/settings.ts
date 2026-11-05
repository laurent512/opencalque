import { settingsOf } from './document'
import type { Op } from './ops'
import type { Document, DrawingSettings } from './schema'
import { unitless } from './tables'

/** What each drawing setting is when the drawing does not say: stored, it is left out. */
const DEFAULTS: Required<DrawingSettings> = { system: 'metric', decimal: '.' }

/**
 * The operations that make a drawing write its numbers as `next` says, and everything in it with
 * it: the rooms, tables of quantities, dimensions and dimension styles that wrote theirs their own
 * way stop doing so, and the words of a table that name a unit ("Area (m²)") say "{unit}" there,
 * to follow the drawing too. Only the settings `next` gives are changed.
 */
export function drawingSettingsOps(doc: Document, next: DrawingSettings): Op[] {
  const keys = (Object.keys(next) as (keyof DrawingSettings)[]).filter((key) => next[key] !== undefined)
  if (keys.length === 0) return []
  const settings = Object.fromEntries(keys.map((key) => [key, next[key] === DEFAULTS[key] ? null : next[key]]))
  const ops: Op[] = [{ op: 'set_document', settings }]
  const system = settingsOf(doc).system
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'room' && node.type !== 'table' && node.type !== 'dimension') continue
    const patch: Record<string, unknown> = {}
    for (const key of keys) if (key in node && (node as Record<string, unknown>)[key] !== undefined) patch[key] = null
    if (node.type === 'table' && keys.includes('system') && node.labels) {
      const from = node.system ?? system
      const labels = Object.fromEntries(Object.entries(node.labels).map(([field, text]) => [field, unitless(text, field, from)]))
      if (Object.entries(labels).some(([field, text]) => text !== node.labels![field])) patch.labels = labels
    }
    if (Object.keys(patch).length > 0) ops.push({ op: 'update_node', id: node.id, patch })
  }
  if (keys.includes('decimal')) for (const style of Object.values(doc.dimensionStyles ?? {})) if (style.decimal !== undefined) ops.push({ op: 'update_dimension_style', id: style.id, patch: { decimal: null } })
  return ops
}
