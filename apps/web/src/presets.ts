import { newId, type Document, type Op, type Preset } from '@opencalque/core'

/**
 * Settings saved under a name for the tools to draw with (`doc.presets`): for the wall tool its
 * thickness, material and layer, for a door or a window its parameters. They are the drawing's,
 * so a drawing kept with its own serves as a template. Picking one sets the tool as typing its
 * values would: nothing drawn stays linked to it. No React here, so that it is tested alone.
 */

/** What saved settings are for: `'wall'`, or the kind of a parametric object (`arch.door`). */
export const WALL = 'wall'

/** Saved settings without their id and name: what is compared and saved. */
export type PresetValues = Omit<Preset, 'id' | 'name'>

/** The wall tool's settings, as the store keeps them. */
export interface WallSettings {
  thickness: number
  material: string | null
  layer: string
}

/** The settings saved for one tool, in the order they were saved. */
export function presetsOf(doc: Document, of: string): Preset[] {
  return Object.values(doc.presets ?? {}).filter((preset) => preset.of === of)
}

/** The wall tool's settings as they would be saved. The default material is left out. */
export function wallValues(settings: WallSettings): PresetValues {
  return { of: WALL, thickness: settings.thickness, ...(settings.material ? { material: settings.material } : {}), layer: settings.layer }
}

/**
 * What a wall preset sets the tool to in `doc`: a material or a layer the drawing no longer has is
 * left as the tool has it (removing either takes it out of the presets; a pasted preset may still name one).
 */
export function wallSettingsOf(doc: Document, preset: Preset): Partial<WallSettings> {
  return {
    ...(preset.thickness ? { thickness: preset.thickness } : {}),
    material: preset.material && doc.materials?.[preset.material] ? preset.material : null,
    ...(preset.layer && doc.layers[preset.layer] ? { layer: preset.layer } : {}),
  }
}

/** A value written with its keys in order, so that two objects alike compare alike. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Whether `preset` holds what the tool is set to (`current`), so that the list shows it chosen. A
 * layer the drawing does not have is not compared, as picking the preset would not set it.
 */
export function holds(doc: Document, preset: Preset, current: PresetValues): boolean {
  if (preset.of !== current.of) return false
  if (preset.of === WALL) {
    const layerKept = preset.layer !== undefined && doc.layers[preset.layer] !== undefined
    return preset.thickness === current.thickness && (preset.material ?? null) === (current.material ?? null) && (!layerKept || preset.layer === current.layer)
  }
  return stable(preset.props ?? {}) === stable(current.props ?? {})
}

/** The saved settings that hold what the tool is set to, if any: the first saved, when several do. */
export function presetHeld(doc: Document, current: PresetValues): Preset | undefined {
  return presetsOf(doc, current.of).find((preset) => holds(doc, preset, current))
}

/**
 * The operations that save `values` under `name`. Saved again under a name that the tool has
 * already, they replace those settings rather than make a second entry of the same name.
 */
export function savePresetOps(doc: Document, name: string, values: PresetValues): { ops: Op[]; id: string } {
  const named = name.trim()
  const same = presetsOf(doc, values.of).find((preset) => preset.name.trim().toLowerCase() === named.toLowerCase())
  if (same) {
    // Every property it may hold is given, so that one it no longer has is taken away.
    const patch = { thickness: null, material: null, layer: null, props: null, ...values }
    return { ops: [{ op: 'update_preset', id: same.id, patch }], id: same.id }
  }
  const id = newId('preset')
  return { ops: [{ op: 'add_preset', preset: { id, name: named, ...values } }], id }
}
