import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { WallType } from '@opencalque/core'
import { ColorChoice } from '../ColorChoice'
import { t } from '../i18n'
import { apply, useStore } from '../store'
import { penOf, PENS, pixelsOf } from '../strokes'
import { DashPicker, EditableText, Field, IconButton, Section } from '../ui'
import { formatNumber, parseLength } from '../units'

/** The layers of a wall type as one line of text: each a material and, when it has one, its thickness, separated by commas. */
export const layersText = (type: WallType) => (type.layers ?? []).map((layer) => (layer.thickness === undefined ? layer.name : `${layer.name} ${formatNumber(layer.thickness)}`)).join(', ')

/**
 * Reads the layers typed on one line: "Plaster 15, Brick 200, Insulation 120", or just the
 * materials, "Gypsum board, Mineral wool". A part that ends in a number has that thickness, in
 * the user's unit unless another is written; the rest of it is the material.
 */
export function parseLayers(text: string): { name: string; thickness?: number }[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const found = /^(.*?\S)\s+([\d.,]+\s*[a-z"']*)$/i.exec(part)
      const thickness = found ? parseLength(found[2]) : null
      return found && thickness !== null && thickness > 0 ? { name: found[1], thickness } : { name: part }
    })
}

/** One property a type may define: a tick says whether it does, and its value is set beside it. */
function Defines(props: { label: string; on: boolean; fixed?: string; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className={`type-prop${props.on ? '' : ' off'}`}>
      <input
        type="checkbox"
        checked={props.on}
        disabled={props.fixed !== undefined}
        title={props.fixed ?? (props.on ? t('Defined by the type: its walls take it. Untick to leave it to each wall') : t('Left to each wall. Tick to have the type define it'))}
        aria-label={props.label}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <span>{props.label}</span>
      {props.on ? props.children : <em className="faint">{t('each wall its own')}</em>}
    </div>
  )
}

/**
 * The drawing's wall types: ways of building a wall that walls are made as. A type defines the
 * properties that are ticked, and only those: one may be no more than a material, another a
 * thickness, a fill and an outline. Its walls take what it defines, and changing it here changes
 * them all; what it leaves out stays each wall's own.
 */
export function WallTypes() {
  const doc = useStore((s) => s.doc)
  const types = Object.values(doc.wallTypes ?? {})
  const update = (id: string, patch: Record<string, unknown>) => apply([{ op: 'update_wall_type', id, patch }])
  const add = () => apply([{ op: 'add_wall_type', wallType: { name: t('Wall type {n}', { n: types.length + 1 }), thickness: useStore.getState().wallThickness } }])
  return (
    <Section title={t('Wall types')} action={<IconButton title={t('Add a wall type')} onClick={add}><Plus size={14} /></IconButton>}>
      {types.length === 0 && <p className="hint">{t('A wall type is a way of building walls. It defines what you tick: a material, a thickness, a height, a fill, an outline. Give it to walls in their properties, then change it here and they all follow.')}</p>}
      {types.map((type) => {
        const uses = Object.values(doc.nodes).filter((node) => node.type === 'wall' && node.wallType === type.id).length
        // Layers that are all measured make the thickness between them.
        const measured = (type.layers?.length ?? 0) > 0 && type.layers!.every((layer) => layer.thickness !== undefined)
        const set = (patch: Record<string, unknown>) => update(type.id, patch)
        return (
          <div key={type.id} className="wall-type">
            <div className="row">
              <EditableText value={type.name} onChange={(name) => set({ name })} />
              <span className="faint uses" title={t('Walls of this type')}>
                {uses}
              </span>
              <IconButton title={t('Delete this wall type. Its walls stay as they are')} onClick={() => apply([{ op: 'remove_wall_type', id: type.id }])}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <Field label={t('Build-up')} value={layersText(type)} placeholder={t('Plaster 15, Brick 200')} onCommit={(text: string) => set({ layers: parseLayers(text ?? '').length > 0 ? parseLayers(text) : null })} />
            <Defines
              label={t('Thickness')}
              on={type.thickness !== undefined}
              fixed={measured ? t('The thickness of its layers added up') : undefined}
              onToggle={(on) => set({ thickness: on ? useStore.getState().wallThickness : null })}
            >
              {measured ? <em>{formatNumber(type.thickness ?? 0)}</em> : <Field label="" numeric length min={1} value={type.thickness ?? 0} onCommit={(thickness) => thickness > 0 && set({ thickness })} />}
            </Defines>
            <Defines label={t('Height')} on={type.height !== undefined} onToggle={(on) => set({ height: on ? 2500 : null })}>
              <Field label="" numeric length min={1} value={type.height ?? 0} onCommit={(height) => height > 0 && set({ height })} />
            </Defines>
            <Defines label={t('Fill')} on={type.fill !== undefined || type.pattern !== undefined} onToggle={(on) => set(on ? { fill: '#e7e5e4' } : { fill: null, pattern: null })}>
              <ColorChoice stored={type.fill} fallback="#ffffff" commit={(fill) => set({ fill: (fill as string | undefined) ?? null })} pattern={{ value: type.pattern, commit: (pattern) => set({ pattern: pattern ?? null }) }} />
            </Defines>
            <Defines label={t('Outline colour')} on={type.stroke !== undefined} onToggle={(on) => set({ stroke: on ? '#1f1f1f' : null })}>
              <ColorChoice stored={type.stroke} fallback="#1f1f1f" commit={(stroke) => set({ stroke: (stroke as string | undefined) ?? null })} />
            </Defines>
            <Defines label={t('Outline weight')} on={type.strokeWidth !== undefined} onToggle={(on) => set({ strokeWidth: on ? pixelsOf(0.5) : null })}>
              <select value={penOf(type.strokeWidth ?? 1)} onChange={(e) => set({ strokeWidth: pixelsOf(Number(e.target.value)) })}>
                {(PENS.includes(penOf(type.strokeWidth ?? 1)) ? PENS : [...PENS, penOf(type.strokeWidth ?? 1)].sort((p, q) => p - q)).map((mm) => (
                  <option key={mm} value={mm}>
                    {mm} mm
                  </option>
                ))}
              </select>
            </Defines>
            <Defines label={t('Outline kind')} on={type.dash !== undefined} onToggle={(on) => set({ dash: on ? [6, 4] : null })}>
              {/* A type that defines the line gives a dashed one: a solid line is what a wall has anyway. */}
              <DashPicker value={type.dash} onPick={(pattern) => set({ dash: pattern })} />
            </Defines>
          </div>
        )
      })}
      {types.length > 0 && <p className="hint">{t('The build-up lists what the wall is made of, from its left face to its right face as it is drawn: a material, and its thickness if you know it.')}</p>}
    </Section>
  )
}
