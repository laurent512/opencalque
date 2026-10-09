import { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen, Plus, Trash2, ArrowDown, ArrowUp, Copy, Files } from 'lucide-react'
import { childrenOf, layersOf, pagesOf, type Node, type Op, colorsOf, colorUses } from '@opencalque/core'
import { moveInOrder, duplicatePage, movePage } from '../actions'
import { t } from '../i18n'
import { apply, editComponent, select, showPage, useStore } from '../store'
import { EditableText, IconButton, labelOf, Section, TypeIcon } from '../ui'

const rename = (id: string) => (name: string) => apply([{ op: 'update_node', id, patch: { name } }])
/**
 * The drawing's shared colours: named colours that objects are linked to instead of having a
 * colour of their own. Changing one here changes everything linked to it.
 */
export function Colors() {
  const doc = useStore((s) => s.doc)
  const colors = colorsOf(doc)
  const update = (id: string, patch: Record<string, unknown>) => apply([{ op: 'update_color', id, patch }])
  const add = () => apply([{ op: 'add_color', color: { name: t('Colour {n}', { n: colors.length + 1 }), value: '#0d99ff' } }])
  return (
    <Section title={t('Shared colours')} action={<IconButton title={t('Add a shared colour')} onClick={add}><Plus size={14} /></IconButton>}>
      {colors.length === 0 && <p className="hint">{t('A shared colour is used by reference: link objects to it from any colour in their properties, then change it here and they all follow.')}</p>}
      {colors.map((color) => {
        const uses = colorUses(doc, color.id)
        return (
          <div key={color.id} className="row">
            <input type="color" className="swatch" title={t('Changes every object linked to it')} value={color.value} onChange={(e) => update(color.id, { value: e.target.value })} />
            <EditableText value={color.name} onChange={(name) => update(color.id, { name })} />
            <span className="faint uses" title={t('Objects and layers linked to this colour')}>
              {uses}
            </span>
            <IconButton title={t('Delete this shared colour. What used it keeps the colour, unlinked')} onClick={() => apply([{ op: 'remove_color', id: color.id }])}>
              <Trash2 size={13} />
            </IconButton>
          </div>
        )
      })}
    </Section>
  )
}

/** Marks a drag as one of our object rows, so nothing else reacts to it. */
const ROW_DRAG = 'application/x-opencalque-node'

export function Pages() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const pages = pagesOf(doc)
  const add = () => apply([{ op: 'add_node', node: { type: 'page', name: t('Page {n}', { n: pages.length + 1 }) } }])
  return (
    <Section title={t('Pages')} action={<IconButton title={t('Add page')} onClick={add}><Plus size={14} /></IconButton>}>
      {pages.map((page, index) => (
        <div key={page.id} className={`row${page.id === scope ? ' selected' : ''}`} onClick={() => showPage(page.id)}>
          <EditableText value={labelOf(doc, page)} onChange={rename(page.id)} />
          <IconButton title={t('Move up')} onClick={() => movePage(page.id, -1)} disabled={index === 0}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton title={t('Move down')} onClick={() => movePage(page.id, 1)} disabled={index === pages.length - 1}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton title={t('Duplicate this page, with what is on it')} onClick={() => duplicatePage(page.id)}>
            <Copy size={13} />
          </IconButton>
          {pages.length > 1 && (
            <IconButton title={t('Delete page')} onClick={() => apply([{ op: 'remove_node', id: page.id }])}>
              <Trash2 size={13} />
            </IconButton>
          )}
        </div>
      ))}
    </Section>
  )
}

export function Layers() {
  const doc = useStore((s) => s.doc)
  const active = useStore((s) => s.activeLayer)
  const layers = layersOf(doc)
  const update = (id: string, patch: Record<string, unknown>) => apply([{ op: 'update_layer', id, patch }])
  const add = () => apply([{ op: 'add_layer', layer: { name: t('Layer {n}', { n: layers.length + 1 }) } }])
  return (
    <Section title={t('Layers')} action={<IconButton title={t('Add layer')} onClick={add}><Plus size={14} /></IconButton>}>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`row${layer.id === active ? ' current' : ''}`}
          title={t('New objects go on the highlighted layer')}
          onClick={() => useStore.setState({ activeLayer: layer.id })}
        >
          <input
            type="color"
            className="swatch"
            title={t('Layer color')}
            value={layer.color ?? '#1f1f1f'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => update(layer.id, { color: e.target.value })}
          />
          <EditableText value={layer.name} onChange={(name) => update(layer.id, { name })} />
          {layers.length > 1 && (
            <IconButton title={t('Delete layer')} onClick={() => apply([{ op: 'remove_layer', id: layer.id }])}>
              <Trash2 size={13} />
            </IconButton>
          )}
          <IconButton title={layer.shared ? t('Shown on every page. Click to show it only on the page it is drawn on') : t('Show what is on this layer on every page')} onClick={() => update(layer.id, { shared: !layer.shared })}>
            <Files size={13} className={layer.shared ? 'on' : 'faint'} />
          </IconButton>
          <IconButton title={layer.locked ? t('Unlock layer') : t('Lock layer')} onClick={() => update(layer.id, { locked: !layer.locked })}>
            {layer.locked ? <Lock size={13} /> : <LockOpen size={13} className="faint" />}
          </IconButton>
          <IconButton title={layer.visible === false ? t('Show layer') : t('Hide layer')} onClick={() => update(layer.id, { visible: layer.visible === false })}>
            {layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} className="faint" />}
          </IconButton>
        </div>
      ))}
    </Section>
  )
}

/**
 * One object in the list, with what is inside it when it is an opened group. Rows directly in the
 * container being edited can be selected, and dragged up or down to change the stacking order.
 */
/**
 * The row a range selected with Shift starts from: the last one clicked without Shift, as in a
 * file manager. It is only a convenience of this list, so it is kept here and not in the store.
 */
let anchor: string | null = null

function ObjectRow({ node, depth }: { node: Node; depth: number }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const [open, setOpen] = useState(false)
  const [drop, setDrop] = useState<'above' | 'below' | null>(null)
  const top = node.parent === scope
  const selected = top && selection.includes(node.id)

  /** Selects as a file manager does: a click picks one, Ctrl (or Cmd) adds or removes one, Shift takes everything from the last one clicked to this one. */
  const pick = (keys: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    // Something inside a group is reached by going into that group.
    if (!top) {
      anchor = node.id
      return useStore.setState({ scope: node.parent!, selection: [node.id] })
    }
    const toggling = keys.ctrlKey || keys.metaKey
    // The rows in the order they are listed, topmost first.
    const listed = [...childrenOf(doc, scope)].reverse().map((n) => n.id)
    const from = anchor === null ? -1 : listed.indexOf(anchor)
    if (keys.shiftKey && from >= 0) {
      const to = listed.indexOf(node.id)
      const range = listed.slice(Math.min(from, to), Math.max(from, to) + 1)
      // With Ctrl as well, the range is added to what is selected instead of replacing it.
      return select(toggling ? [...new Set([...selection, ...range])] : range)
    }
    anchor = node.id
    select(toggling ? (selected ? selection.filter((id) => id !== node.id) : [...selection, node.id]) : [node.id])
  }

  return (
    <>
      <div
        className={`row${selected ? ' selected' : ''}${drop ? ` drop-${drop}` : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={top}
        onClick={(e) => pick(e)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!selected) pick()
          useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } })
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(ROW_DRAG, node.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!top || !e.dataTransfer.types.includes(ROW_DRAG)) return
          e.preventDefault()
          const box = e.currentTarget.getBoundingClientRect()
          setDrop(e.clientY < box.top + box.height / 2 ? 'above' : 'below')
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData(ROW_DRAG)
          if (dragged && drop) moveInOrder(dragged, node.id, drop)
          setDrop(null)
        }}
      >
        {node.type === 'group' ? (
          <IconButton title={open ? t('Hide what is inside') : t('Show what is inside')} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </IconButton>
        ) : (
          <i className="twist" />
        )}
        <TypeIcon node={node} />
        <EditableText value={labelOf(doc, node)} onChange={rename(node.id)} />
        <IconButton
          title={node.locked ? t('Unlock') : t('Lock so it cannot be selected or moved on the drawing')}
          onClick={() => apply([{ op: 'update_node', id: node.id, patch: { locked: node.locked ? null : true } }])}
        >
          {node.locked ? <Lock size={13} /> : <LockOpen size={13} className="faint" />}
        </IconButton>
        <IconButton
          title={node.visible === false ? t('Show') : t('Hide')}
          onClick={() => apply([{ op: 'update_node', id: node.id, patch: { visible: node.visible === false } }])}
        >
          {node.visible === false ? <EyeOff size={13} /> : <Eye size={13} className="faint" />}
        </IconButton>
      </div>
      {open && node.type === 'group' && [...childrenOf(doc, node.id)].reverse().map((child) => <ObjectRow key={child.id} node={child} depth={depth + 1} />)}
    </>
  )
}

/** What is on the page (or in the component or group) being edited, topmost first. */
export function Objects() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const nodes = [...childrenOf(doc, scope)].reverse()
  return (
    <section className="section untitled">
      {nodes.length === 0 && <p className="hint">{t('Nothing here yet. Pick a tool below the drawing and draw.')}</p>}
      {nodes.map((node) => (
        <ObjectRow key={node.id} node={node} depth={0} />
      ))}
      {nodes.length > 1 && <p className="hint">{t('Topmost first. Drag a row to change what is drawn over what.')}</p>}
    </section>
  )
}
