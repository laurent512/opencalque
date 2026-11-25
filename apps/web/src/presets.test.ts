import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, type Document } from '@opencalque/core'
import { presetHeld, presetsOf, savePresetOps, wallSettingsOf, wallValues, WALL } from './presets'

const layer = (doc: Document) => Object.keys(doc.layers)[0]

/** A drawing with a material, and one wall's settings saved. */
function drawing(): Document {
  const doc = applyOps(createDocument(), [{ op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#c0503a' } }])
  return applyOps(doc, savePresetOps(doc, 'Outer wall', wallValues({ thickness: 365, material: 'brick', layer: layer(doc) })).ops)
}

describe('saved settings', () => {
  it('save what the wall tool is set to, the default material left out', () => {
    const doc = drawing()
    expect(presetsOf(doc, WALL).map(({ id: _, ...rest }) => rest)).toEqual([{ name: 'Outer wall', of: 'wall', thickness: 365, material: 'brick', layer: layer(doc) }])
    expect(wallValues({ thickness: 115, material: null, layer: 'l' })).toEqual({ of: 'wall', thickness: 115, layer: 'l' })
  })

  it('show chosen the ones that hold what the tool is set to', () => {
    const doc = drawing()
    expect(presetHeld(doc, wallValues({ thickness: 365, material: 'brick', layer: layer(doc) }))?.name).toBe('Outer wall')
    expect(presetHeld(doc, wallValues({ thickness: 240, material: 'brick', layer: layer(doc) }))).toBeUndefined()
    expect(presetHeld(doc, wallValues({ thickness: 365, material: null, layer: layer(doc) }))).toBeUndefined()
    // A door's parameters compare whatever order they were set in.
    const doors = applyOps(doc, savePresetOps(doc, 'Door 90', { of: 'arch.door', props: { width: 900, swing: 'Right' } }).ops)
    expect(presetHeld(doors, { of: 'arch.door', props: { swing: 'Right', width: 900 } })?.name).toBe('Door 90')
    expect(presetHeld(doors, { of: 'arch.door', props: { width: 900 } })).toBeUndefined()
    expect(presetHeld(doors, { of: 'arch.window', props: { width: 900, swing: 'Right' } })).toBeUndefined()
  })

  it('saved again under the same name replace those, with nothing left of what they held', () => {
    const doc = drawing()
    const again = applyOps(doc, savePresetOps(doc, ' outer WALL ', wallValues({ thickness: 425, material: null, layer: layer(doc) })).ops)
    expect(presetsOf(again, WALL).map(({ id: _, ...rest }) => rest)).toEqual([{ name: 'Outer wall', of: 'wall', thickness: 425, layer: layer(doc) }])
    // The same name for another tool is other settings.
    const door = applyOps(again, savePresetOps(again, 'Outer wall', { of: 'arch.door', props: {} }).ops)
    expect(Object.keys(door.presets ?? {})).toHaveLength(2)
  })

  it('set the tool to what the drawing still has', () => {
    const doc = drawing()
    const preset = presetsOf(doc, WALL)[0]
    expect(wallSettingsOf(doc, preset)).toEqual({ thickness: 365, material: 'brick', layer: layer(doc) })
    // Pasted from another drawing, with a material and a layer this one has not.
    expect(wallSettingsOf(doc, { ...preset, material: 'concrete', layer: 'elsewhere' })).toEqual({ thickness: 365, material: null })
  })
})
