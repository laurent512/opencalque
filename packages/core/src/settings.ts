import { settingsOf } from './document'
import type { Op } from './ops'
import type { Document, DrawingSettings } from './schema'
import { unitless } from './tables'

/** What each drawing setting is when the drawing does not say: stored, it is left out. */
const DEFAULTS = { system: 'metric', decimal: '.' } as const

/** The settings of how the drawing writes its numbers, which what is placed in it may also say for itself. */
type NumberSetting = keyof typeof DEFAULTS

/**
 * The operations that make a drawing write its numbers as `next` says, and everything in it with
 * it: the rooms, tables of quantities, dimensions and dimension styles that wrote theirs their own
 * way stop doing so, and the words of a table that name a unit ("Area (m²)") say "{unit}" there,
 * to follow the drawing too. Only the settings `next` gives are changed. A title block laid out in
 * the corner, the default, is stored as nothing, its captions with it.
 */
export function drawingSettingsOps(doc: Document, next: DrawingSettings): Op[] {
  const keys = (['system', 'decimal'] as NumberSetting[]).filter((key) => next[key] !== undefined)
  const settings: NonNullable<Extract<Op, { op: 'set_document' }>['settings']> = Object.fromEntries(keys.map((key) => [key, next[key] === DEFAULTS[key] ? null : next[key]]))
  // The title blocks: in the corner, the default, the drawing says nothing of them, captions included.
  if (next.titleBlock !== undefined) settings.titleBlock = next.titleBlock.layout === 'strip' ? next.titleBlock : null
  if (Object.keys(settings).length === 0) return []
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
