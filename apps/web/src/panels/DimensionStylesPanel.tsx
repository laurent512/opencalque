import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { newDimensionStyle, newId, type DimensionStyle, type Node } from '@opencalque/core'
import { msg, t } from '../i18n'
import { apply, useSettledDoc, useStore } from '../store'
import { EditableText, IconButton } from '../ui'
import { unit } from '../units'
import { PanelActions } from '../panelHead'
import { FieldRow, patchFor, read, type Update } from './properties/FieldRow'
import { DIMENSION, type FieldSpec } from './properties/fields'

/** What the tick of a property of a dimension style says, on and off, and what stands for its value when it is off. */
const TEXTS = {
  on: msg('Defined by the style: its dimensions take it. Untick to leave it to each dimension'),
  off: msg('Left to each dimension. Tick to have the style define it'),
  left: msg('each dimension its own'),
}

/** One property a style may define: a tick says whether it does, and its value is set beside it. */
function Defines(props: { label: string; on: boolean; texts: typeof TEXTS; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className={`type-prop${props.on ? '' : ' off'}`}>
      <input type="checkbox" checked={props.on} title={t(props.on ? props.texts.on : props.texts.off)} aria-label={props.label} onChange={(e) => props.onToggle(e.target.checked)} />
      <span>{props.label}</span>
      {props.on ? props.children : <em className="faint">{t(props.texts.left)}</em>}
    </div>
  )
}

/**
 * What a style can define, as the properties of a dimension show it: everything but its points
 * and the words written in place of its length. The plain font is "no font" on a dimension; a
 * style that defines it says so.
 */
const FIELDS: FieldSpec[] = DIMENSION.filter((field) => field.section && field.path !== 'text').map((field) =>
  field.path === 'font' ? { ...field, options: field.options!.map((option) => (option.value === '' ? { ...option, value: 'sans-serif' } : option)) } : field,
)
const SECTIONS = [...new Set(FIELDS.map((field) => field.section!))]

/** The decimals a value is written with in each unit when nothing says otherwise. */
const DECIMALS: Record<string, number> = { mm: 0, cm: 1, m: 2, in: 1, ft: 2 }

/** The value a property takes when a style starts to define it: what a dimension shows without it, or for a kind of line, dashes. */
function first(field: FieldSpec, style: DimensionStyle): unknown {
  switch (field.path) {
    case 'unit':
      return unit()
    case 'decimals':
      return DECIMALS[style.unit ?? 'mm'] ?? 0
    case 'font':
      return 'sans-serif'
    case 'style.dash':
    case 'extension.dash':
      return [6, 4]
    case 'extension.strokeWidth':
      return 1
  }
  return field.fallback
}

/** One style: its name, how many dimensions are in it, and, opened, what it defines. */
function StyleCard({ style, uses, open, onToggle }: { style: DimensionStyle; uses: number; open: boolean; onToggle: () => void }) {
  const set = (patch: Record<string, unknown>) => apply([{ op: 'update_dimension_style', id: style.id, patch }])
  const { id: _, name: __, ...look } = style
  // The style as a dimension, so that its values are set with the rows a dimension's properties use.
  const node = { id: style.id, type: 'dimension', parent: null, order: '', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, offset: 0, ...look } as Node
  const update: Update = (patch) => set(patch(node))
  return (
    <div className="wall-type dimension-style">
      <div className="row">
        <IconButton title={open ? t('Hide what it defines') : t('Show what it defines')} onClick={onToggle}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </IconButton>
        <EditableText value={style.name} onChange={(name) => set({ name })} />
        <span className="faint uses" title={t('Dimensions in this style')}>
          {uses}
        </span>
        <IconButton title={t('Delete this dimension style. Its dimensions keep how they look')} onClick={() => apply([{ op: 'remove_dimension_style', id: style.id }])}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      {open &&
        SECTIONS.map((section) => (
          <div key={section}>
            <h4 className="title-heading">{t(section)}</h4>
            {FIELDS.filter((field) => field.section === section).map((field) => (
              <Defines key={field.path} label={t(field.label)} texts={TEXTS} on={read(style, field.path) !== undefined} onToggle={(on) => set(patchFor(node, field.path, on ? first(field, style) : undefined))}>
                <FieldRow node={node} nodes={[node]} field={{ ...field, label: '' }} update={update} />
              </Defines>
            ))}
          </div>
        ))}
    </div>
  )
}

/**
 * The drawing's dimension styles: ways of drawing dimensions that dimensions are drawn in. A
 * style defines the properties that are ticked, and only those; its dimensions
 * take what it defines, and changing it here changes them all. What it leaves out, and what a
 * dimension sets for itself, stays each dimension's own.
 */
export function DimensionStyles() {
  const doc = useSettledDoc()
  const styles = Object.values(doc.dimensionStyles ?? {})
  // The style of the one dimension selected, or of the next ones the tool draws, is shown open.
  const current = useStore((s) => {
    if (s.tool === 'dimension') return s.dimensionTemplate.dimensionStyle as string | undefined
    const node = s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
    return node?.type === 'dimension' ? node.dimensionStyle : undefined
  })
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => opened[id] ?? (id === current || styles.length === 1)
  const add = () => {
    const id = newId('dimstyle')
    if (apply([{ op: 'add_dimension_style', dimensionStyle: { id, name: t('Dimension style {n}', { n: styles.length + 1 }), ...newDimensionStyle({ unit: unit() }) } }])) setOpened({ ...opened, [id]: true })
  }
  return (
    <section className="section untitled">
      <PanelActions>
        <IconButton title={t('Add a dimension style')} onClick={add}>
          <Plus size={14} />
        </IconButton>
      </PanelActions>
      {styles.length === 0 && <p className="hint">{t('No dimension styles yet')}</p>}
      {styles.map((style) => (
        <StyleCard
          key={style.id}
          style={style}
          uses={Object.values(doc.nodes).filter((node) => node.type === 'dimension' && node.dimensionStyle === style.id).length}
          open={isOpen(style.id)}
          onToggle={() => setOpened({ ...opened, [style.id]: !isOpen(style.id) })}
        />
      ))}
    </section>
  )
}
