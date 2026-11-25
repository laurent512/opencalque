import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { NodeOf, ParametricKind, Preset } from '@opencalque/core'
import { registry } from '../../extensions'
import { msg, t } from '../../i18n'
import { presetHeld, presetsOf, savePresetOps, wallSettingsOf, wallValues, type PresetValues } from '../../presets'
import { Select } from '../../Select'
import { apply, useStore } from '../../store'
import { IconButton } from '../../ui'
import { formatLength } from '../../units'
import { Sections, type Update } from './FieldRow'
import { fieldsOf } from './fields'

/**
 * The settings saved for a tool, to pick before drawing (`presets.ts`): the one that holds what
 * the tool is set to shows chosen. Compact, in the bar above the tools, it is the list alone, and
 * only once something is saved; in Properties, with the button that removes the chosen one, and a
 * name to save the tool's settings under.
 */
export function PresetChoice(props: { current: PresetValues; pick: (preset: Preset) => void; suggested: string; compact?: boolean }) {
  const doc = useStore((s) => s.doc)
  const [name, setName] = useState('')
  const saved = presetsOf(doc, props.current.of)
  const held = presetHeld(doc, props.current)
  if (props.compact && saved.length === 0) return null
  const list = (
    <Select
      className={props.compact ? 'quick-select' : undefined}
      aria-label={t('Saved settings')}
      title={props.compact ? t('Settings saved in this drawing, to draw with') : undefined}
      value={held?.id ?? ''}
      placeholder={saved.length === 0 ? t('None saved yet') : t('Choose…')}
      disabled={saved.length === 0}
      options={saved.map((preset) => ({ value: preset.id, label: preset.name }))}
      onChange={(id) => {
        const preset = doc.presets?.[id]
        if (preset) props.pick(preset)
      }}
    />
  )
  if (props.compact) return list
  const save = () => {
    const named = name.trim() || props.suggested
    if (apply(savePresetOps(doc, named, props.current).ops)) setName('')
  }
  return (
    <>
      <div className="field">
        <span>{t('Saved')}</span>
        <div className="preset-row">
          {list}
          {held && (
            <IconButton title={t('Remove these saved settings. What was drawn with them stays as it is')} onClick={() => apply([{ op: 'remove_preset', id: held.id }])}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <span>{t('Save as')}</span>
        <div className="preset-row">
          <input aria-label={t('Name of the settings to save')} value={name} placeholder={props.suggested} onChange={(e) => setName(e.target.value)} />
          <button className="text-button" type="submit">
            {t('Save')}
          </button>
        </div>
      </form>
      <p className="hint">{t('Saved with the drawing, to pick before drawing. What is drawn with them does not stay linked to them: changing it changes nothing else.')}</p>
    </>
  )
}

/** The wall tool's saved settings: its thickness, its material and the layer in use. */
export function WallToolPresets({ compact }: { compact?: boolean }) {
  const doc = useStore((s) => s.doc)
  const thickness = useStore((s) => s.wallThickness)
  const chosen = useStore((s) => s.wallMaterial)
  const layer = useStore((s) => s.activeLayer)
  const material = chosen && doc.materials?.[chosen] ? doc.materials[chosen] : undefined
  return (
    <PresetChoice
      compact={compact}
      current={wallValues({ thickness, material: material?.id ?? null, layer })}
      suggested={`${material?.name ?? t('Wall')} ${formatLength(thickness)}`}
      pick={(preset) => {
        const settings = wallSettingsOf(doc, preset)
        useStore.setState({ ...(settings.thickness ? { wallThickness: settings.thickness } : {}), wallMaterial: settings.material ?? null, ...(settings.layer ? { activeLayer: settings.layer } : {}) })
      }}
    />
  )
}

/** Sets the parameters of the door or window about to be placed. */
function setPlacingProps(props: Record<string, unknown>) {
  useStore.setState((s) => (s.placing?.type === 'parametric' ? { placing: { ...s.placing, props } } : {}))
}

/**
 * A door or a window about to be placed: its parameters, set before the click that puts it on a
 * wall, as they are set on one placed (the same fields, `fieldsOf`), and the settings saved for it.
 * What is set stays for the next ones placed, until the tool is left.
 */
export function PlacingOpening({ kind }: { kind: ParametricKind }) {
  const scope = useStore((s) => s.scope)
  const placing = useStore((s) => s.placing)
  const doc = useStore((s) => s.doc)
  const props = (placing?.type === 'parametric' ? placing.props : undefined) ?? {}
  // It is not in the drawing yet: its fields are read from what it would be, and write to the tool.
  const node = { id: 'placing', type: 'parametric', kind: kind.kind, props, x: 0, y: 0, parent: scope, order: 'a0' } as NodeOf<'parametric'>
  const fields = fieldsOf(node, doc).filter((field) => field.path.startsWith('props.') && !field.get && !field.set)
  const update: Update = (patch) => setPlacingProps((patch(node).props as Record<string, unknown> | null) ?? {})
  const width = registry.resolveProps(kind, props).width
  return (
    <>
      <Sections
        node={node}
        fields={fields}
        update={update}
        extras={[
          {
            title: msg('Saved settings'),
            before: <PresetChoice current={{ of: kind.kind, props }} suggested={typeof width === 'number' ? `${t(kind.label)} ${formatLength(width)}` : t(kind.label)} pick={(preset) => setPlacingProps({ ...preset.props })} />,
          },
        ]}
      />
      <p className="hint">{t('Set it here before placing it, then click on a wall. The next ones placed are set alike until you change tool.')}</p>
    </>
  )
}
