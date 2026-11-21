import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { DEFAULT_MATERIAL, newId, WALL_FILL, type Document, type Material } from '@opencalque/core'
import { FillChoice } from '../FillChoice'
import { t, tn } from '../i18n'
import { addCommon } from '../materials'
import { MoreMenu } from '../MoreMenu'
import { apply, useStore } from '../store'
import { EditableText, IconButton } from '../ui'
import { ask } from '../windows'
import { PanelActions } from '../panelHead'

/*
 * The drawing's materials: what its walls and floors are made of. Walls and the
 * floors of rooms refer to one, are drawn in its colour and pattern, and are counted
 * under its name in the tables of quantities. First comes the default material, what walls are
 * made of until they are given another, which is always there.
 */

/** How many walls, and floors of rooms, are made of a material. */
function usesOf(doc: Document, id: string): { walls: number; floors: number } {
  let walls = 0
  let floors = 0
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'wall' && node.material === id) walls++
    else if (node.type === 'room' && node.material === id) floors++
  }
  return { walls, floors }
}

/** Takes a material away, asking first when something is made of it: its walls are of the default material after, its floors keep its look. */
function remove(doc: Document, material: Material): void {
  const { walls, floors } = usesOf(doc, material.id)
  const run = () => {
    apply([{ op: 'remove_material', id: material.id }])
  }
  if (walls + floors === 0) return run()
  ask({
    title: t('Delete material'),
    message: [
      walls > 0 ? tn(walls, 'One wall is made of “{name}”: it will be of the default material.', '{n} walls are made of “{name}”: they will be of the default material.', { name: material.name }) : '',
      floors > 0 ? tn(floors, 'One floor is made of it: it keeps its colour and pattern.', '{n} floors are made of it: they keep its colour and pattern.') : '',
    ]
      .filter(Boolean)
      .join(' '),
    action: t('Delete'),
    run,
  })
}

/** A material, on one row: how it is drawn, as a swatch that a click changes, then its name and how many things are made of it. */
function MaterialRow({ material }: { material: Material }) {
  const doc = useStore((s) => s.doc)
  const set = (patch: Record<string, unknown>) => apply([{ op: 'update_material', id: material.id, patch }])
  const { walls, floors } = usesOf(doc, material.id)
  return (
    <div className="row material">
      <FillChoice
        compact
        fill={material.fill}
        pattern={material.pattern}
        fallback="#ffffff"
        filled
        title={t('Fill')}
        commit={(change) => set(Object.fromEntries(Object.entries(change).map(([key, value]) => [key, value ?? null])))}
      />
      <EditableText value={material.name} onChange={(name) => name && set({ name })} />
      <span className="faint uses" title={t('Walls and floors made of it')}>
        {walls + floors}
      </span>
      <IconButton title={t('Delete this material')} onClick={() => remove(doc, material)}>
        <Trash2 size={13} />
      </IconButton>
    </div>
  )
}

/**
 * The default material: what walls are made of until they are given a
 * material. It cannot be renamed or deleted; its look is changed as any other's, which puts it in
 * the drawing where it was not yet (without it, walls are white).
 */
function DefaultRow() {
  const material = useStore((s) => s.doc.materials?.[DEFAULT_MATERIAL])
  const set = (change: Record<string, unknown>) =>
    apply([
      material
        ? { op: 'update_material', id: DEFAULT_MATERIAL, patch: Object.fromEntries(Object.entries(change).map(([key, value]) => [key, value ?? null])) }
        : { op: 'add_material', material: { id: DEFAULT_MATERIAL, name: 'Default', ...Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) } },
    ])
  return (
    <div className="row material" title={t('What walls are made of until they are given a material. It cannot be deleted.')}>
      <FillChoice compact fill={material?.fill} pattern={material?.pattern} fallback={WALL_FILL} filled title={t('Fill')} commit={set} />
      <span className="editable">{t('Default')}</span>
      <em className="faint uses">{t('walls of no material')}</em>
    </div>
  )
}

export function Materials() {
  const doc = useStore((s) => s.doc)
  const materials = Object.values(doc.materials ?? {}).filter((material) => material.id !== DEFAULT_MATERIAL)
  const add = () => apply([{ op: 'add_material', material: { id: newId('material'), name: t('Material {n}', { n: materials.length + 1 }), fill: '#e7e5e4' } }])
  const actions = (
    <span className="section-actions">
      <IconButton title={t('Add a material')} onClick={add}>
        <Plus size={14} />
      </IconButton>
      <MoreMenu title={t('More actions')} actions={[{ label: t('Add common materials'), icon: <Sparkles size={14} />, run: addCommon }]} />
    </span>
  )
  return (
    <section className="section untitled">
      <PanelActions>{actions}</PanelActions>
      <DefaultRow />
      {materials.length === 0 && (
        <>
          <p className="hint">{t('No materials yet')}</p>
          <button className="text-button" onClick={addCommon}>
            {t('Add common materials')}
          </button>
        </>
      )}
      {materials.map((material) => (
        <MaterialRow key={material.id} material={material} />
      ))}
    </section>
  )
}
