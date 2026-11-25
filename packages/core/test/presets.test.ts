import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, parseDocument, parseOps, serializeDocument, unknownProperties, type Document } from '../src'

/** A drawing with a material, a second layer, and settings saved for walls and for doors. */
const saved = (): Document =>
  applyOps(createDocument(), [
    { op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#c0503a' } },
    { op: 'add_layer', layer: { id: 'outer', name: 'Outer walls' } },
    { op: 'add_preset', preset: { id: 'outside', name: 'Outer wall 36.5', of: 'wall', thickness: 365, material: 'brick', layer: 'outer' } },
    { op: 'add_preset', preset: { id: 'door', name: 'Door 90', of: 'arch.door', props: { width: 900, swing: 'Right' } } },
  ])

describe('settings saved for the tools', () => {
  it('are kept in the drawing, read back as they were saved', () => {
    const doc = saved()
    expect(doc.presets?.outside).toEqual({ id: 'outside', name: 'Outer wall 36.5', of: 'wall', thickness: 365, material: 'brick', layer: 'outer' })
    expect(parseDocument(JSON.parse(serializeDocument(doc))).presets).toEqual(doc.presets)
  })

  it('are changed and removed, and refuse what is wrong', () => {
    let doc = applyOps(saved(), [{ op: 'update_preset', id: 'outside', patch: { thickness: 425, layer: null } }])
    expect(doc.presets?.outside).toEqual({ id: 'outside', name: 'Outer wall 36.5', of: 'wall', thickness: 425, material: 'brick' })
    doc = applyOps(doc, [{ op: 'remove_preset', id: 'door' }])
    expect(Object.keys(doc.presets ?? {})).toEqual(['outside'])
    expect(() => applyOps(doc, [{ op: 'add_preset', preset: { id: 'outside', name: 'Again', of: 'wall' } }])).toThrow(/already exist/)
    expect(() => applyOps(doc, [{ op: 'update_preset', id: 'nothing', patch: {} }])).toThrow(/Unknown saved settings/)
    expect(() => applyOps(doc, [{ op: 'add_preset', preset: { name: 'Thin', of: 'wall', thickness: -5 } }])).toThrow()
    expect(unknownProperties(doc, [{ op: 'add_preset', preset: { name: 'Thin', of: 'wall', colour: 'red' } as never }])).not.toEqual([])
  })

  it('lose a material or a layer that is removed, as the walls do, and nothing else', () => {
    const doc = applyOps(saved(), [
      { op: 'remove_material', id: 'brick' },
      { op: 'remove_layer', id: 'outer' },
    ])
    expect(doc.presets?.outside).toEqual({ id: 'outside', name: 'Outer wall 36.5', of: 'wall', thickness: 365 })
    expect(doc.presets?.door).toEqual(saved().presets?.door)
  })

  it('are operations an agent may send', () => {
    expect(parseOps([{ op: 'add_preset', preset: { name: 'Window 120', of: 'arch.window', props: { width: 1200 } } }, { op: 'update_preset', id: 'p', patch: { name: 'W' } }, { op: 'remove_preset', id: 'p' }])).toHaveLength(3)
  })
})
