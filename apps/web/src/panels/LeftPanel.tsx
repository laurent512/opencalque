import { searchable } from '../search'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Camera, ChevronDown, ChevronRight, Eye, EyeOff, Image, MoveHorizontal, LayoutGrid, List, Lock, LockOpen, Pencil, Plus, Replace, ScanEye, Trash2, Copy } from 'lucide-react'
import { childrenOf, componentPlacements, componentsOf, layersOf, lookedAt, pagesOf, rootOf, viewsLookingAt, toSVG, type Document, type Node, type NodeOf, type Op, type Variant, colorsOf, colorUses } from '@opencalque/core'
import { addPage, browseInstances, deleteEntry, deleteUnusedComponents, editModel, moveInOrder, duplicatePage, openComponent, placeIn, replaceInstances, stopBrowsing, zoomToViewMark, zoomToViewPicture } from '../actions'
import { EntryChoice } from '../EntryChoice'
import { entryName, entryOf, modelEntry, modelsOf } from '../entries'
import { parametricPicture } from '../pictures'
import { carry, svgUrl } from '../carry'
import { ColorChoice } from '../ColorChoice'
import { registry, useExtensions } from '../extensions'
import { msg, t } from '../i18n'
import { MoreMenu } from '../MoreMenu'
import { editComponent, showPage } from '../navigation'
import { setPrefs, usePrefs } from '../prefs'
import { apply, select, selectViewPart, setTool, useSettledDoc, useStore, type ViewPart } from '../store'
import { EditableText, IconButton, labelOf, TypeIcon } from '../ui'
import { useWindows } from '../windows'
import { PanelActions } from '../panelHead'

const rename = (id: string) => (name: string) => apply([{ op: 'update_node', id, patch: { name } }])
/**
 * The drawing's shared colours: named colours that objects are linked to instead of having a
 * colour of their own. Changing one here changes everything linked to it.
 */
export function Colors() {
  const doc = useSettledDoc()
  const colors = colorsOf(doc)
  const update = (id: string, patch: Record<string, unknown>) => apply([{ op: 'update_color', id, patch }])
  const add = () => apply([{ op: 'add_color', color: { name: t('Colour {n}', { n: colors.length + 1 }), value: '#0d99ff' } }])
  return (
    <section className="section untitled">
      <PanelActions>
        <IconButton title={t('Add a shared colour')} onClick={add}>
          <Plus size={14} />
        </IconButton>
      </PanelActions>
      {colors.length === 0 && <p className="hint">{t('No shared colours yet')}</p>}
      {colors.map((color) => {
        const uses = colorUses(doc, color.id)
        return (
          <div key={color.id} className="row">
            {/* The app's own colour window, which has an opacity, as the browser's does not. */}
            <ColorChoice compact plain title={t('Changes every object linked to it')} stored={color.value} fallback={color.value} commit={(value) => typeof value === 'string' && update(color.id, { value })} />
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
    </section>
  )
}

/** Marks a drag as one of our rows, so nothing else reacts to it. */
const ROW_DRAG = 'application/x-opencalque-node'

/** The rows being dragged, and the list they come from: pages are not dropped among objects. */
let dragged: { list: 'pages' | 'objects'; ids: string[] } | null = null

type Drop = 'above' | 'below' | 'into'

/** Where over a row the pointer is: in its top or bottom half; or, on a row that can hold others, in its middle half, which is into it. */
const where = (e: DragEvent, holds: boolean): Drop => {
  const box = e.currentTarget.getBoundingClientRect()
  const at = (e.clientY - box.top) / box.height
  return holds && at > 0.25 && at < 0.75 ? 'into' : at < 0.5 ? 'above' : 'below'
}

/**
 * Makes a row of a list draggable, taking `take()` along (the rows selected with it), and lets
 * rows of the same list be dropped above or below it, or into it when it `holds` others (a
 * group); `place` is told which. A row being dragged, or inside one (`within`), is not a place to drop.
 */
function useRowDrag(list: 'pages' | 'objects', id: string, enabled: boolean, take: () => string[], place: (ids: string[], where: Drop) => void, holds = false, within: (ids: string[]) => boolean = () => false) {
  const [drop, setDrop] = useState<Drop | null>(null)
  // Only a drag that carries rows: a row dragged out of sight in a long list is no longer drawn, so
  // its dragend never comes and `dragged` may be left over from it.
  const accepts = (e: DragEvent) => enabled && e.dataTransfer.types.includes(ROW_DRAG) && dragged?.list === list && !dragged.ids.includes(id) && !within(dragged.ids)
  return {
    drop,
    handlers: {
      draggable: enabled,
      onDragStart: (e: DragEvent) => {
        dragged = { list, ids: take() }
        e.dataTransfer.setData(ROW_DRAG, dragged.ids.join(' '))
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragEnd: () => {
        dragged = null
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDrop(where(e, holds))
      },
      // Going over the name or a button of the row is not leaving it.
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Element | null)) setDrop(null)
      },
      onDrop: (e: DragEvent) => {
        setDrop(null)
        if (!accepts(e)) return
        e.preventDefault()
        place(dragged!.ids, where(e, holds))
        dragged = null
      },
    },
  }
}

/** A page in the list: a click shows it; dragged, it takes its place among the others. */
function PageRow({ id, count }: { id: string; count: number }) {
  const doc = useSettledDoc()
  const scope = useStore((s) => s.scope)
  const page = doc.nodes[id]
  // The first page comes first: dropped above a page, a page goes before it.
  const { drop, handlers } = useRowDrag('pages', id, count > 1, () => [id], (ids, at) => moveInOrder(ids, id, at === 'below'))
  return (
    <div className={`row clickable${id === scope ? ' selected' : ''}${drop ? ` drop-${drop}` : ''}`} onClick={() => showPage(id)} {...handlers}>
      <EditableText value={labelOf(doc, page)} onChange={rename(id)} />
      <IconButton title={t('Duplicate this page, with what is on it')} onClick={() => duplicatePage(id)}>
        <Copy size={13} />
      </IconButton>
      {count > 1 && (
        <IconButton title={t('Delete page')} onClick={() => apply([{ op: 'remove_node', id }])}>
          <Trash2 size={13} />
        </IconButton>
      )}
    </div>
  )
}

export function Pages() {
  const doc = useSettledDoc()
  const pages = pagesOf(doc)
  return (
    <section className="section untitled">
      <PanelActions>
        <IconButton title={t('Add page')} onClick={addPage}>
          <Plus size={14} />
        </IconButton>
      </PanelActions>
      {pages.map((page) => (
        <PageRow key={page.id} id={page.id} count={pages.length} />
      ))}
    </section>
  )
}

export function Layers() {
  const doc = useSettledDoc()
  const active = useStore((s) => s.activeLayer)
  const layers = layersOf(doc)
  const update = (id: string, patch: Record<string, unknown>) => apply([{ op: 'update_layer', id, patch }])
  const add = () => apply([{ op: 'add_layer', layer: { name: t('Layer {n}', { n: layers.length + 1 }) } }])
  return (
    <section className="section untitled">
      <PanelActions>
        <IconButton title={t('Add layer')} onClick={add}>
          <Plus size={14} />
        </IconButton>
      </PanelActions>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`row clickable${layer.id === active ? ' current' : ''}`}
          title={t('New objects go on the highlighted layer')}
          onClick={() => useStore.setState({ activeLayer: layer.id })}
        >
          <ColorChoice
            compact
            title={t('Colour of the layer: the lines on it that have none of their own, and the components placed on it, take it')}
            stored={layer.color}
            fallback="#1f1f1f"
            unset={msg('none')}
            commit={(color) => update(layer.id, { color: (color as string | undefined) ?? null })}
          />
          <EditableText value={layer.name} onChange={(name) => update(layer.id, { name })} />
          {layers.length > 1 && (
            <IconButton title={t('Delete layer')} onClick={() => apply([{ op: 'remove_layer', id: layer.id }])}>
              <Trash2 size={13} />
            </IconButton>
          )}
          <IconButton title={layer.locked ? t('Unlock layer') : t('Lock layer')} on={layer.locked} onClick={() => update(layer.id, { locked: !layer.locked })}>
            {layer.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </IconButton>
          <IconButton title={layer.visible === false ? t('Show layer') : t('Hide layer')} on={layer.visible === false} onClick={() => update(layer.id, { visible: layer.visible === false })}>
            {layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </IconButton>
        </div>
      ))}
    </section>
  )
}

/** Puts a component of the drawing on the pointer to be placed, or under it while it is dragged to the drawing (`carried`). */
const placeComponent = (id: string) => (carried = false) => setTool('place', { type: 'instance', component: id, carried })

/** Puts one more object of a model on the pointer, with the same parameters, or under it while it is dragged (`carried`). */
const placeModel = (model: Variant) => (carried = false) => setTool('place', { type: 'parametric', kind: model.kind, props: model.props, carried })

/**
 * What the drawing holds that is placed: its components and the models of its parametric objects
 * (a kind with its parameters: a radiator of 80 cm, one of 1.20 m), one list, by name, whoever
 * draws need not know the two apart (`entries.ts`). As a list or as pictures side by side
 * (`componentsView`), each with how many times it is placed (`componentPlacements` for a
 * component). A click puts one more on the pointer and a drag puts it down on the drawing, as from
 * the object library. Its buttons go through its placements one by one, make them placements of
 * another entry, open it to edit it (a component, filling the view; a model, its objects selected
 * together for the Properties panel to change them at once), and delete it with its placements
 * once the user has said yes. A component's name is renamed by a double-click; one placed nowhere
 * is faint, and the "···" menu deletes all of those at once. A selected placement highlights its
 * entry. What is on every sheet, a component too, is left out: it is not placed, and is edited from
 * the properties of a paper.
 */
export function Components() {
  // As it stands outside a drag or a text being typed, which change it at every move or key: the list and its pictures follow once it is let go.
  const doc = useSettledDoc()
  const selection = useStore((s) => s.selection)
  const version = useExtensions((s) => s.version)
  const view = usePrefs((p) => p.componentsView)
  const [search, setSearch] = useState('')
  const components = componentsOf(doc).filter((c) => !c.sheet)
  const models = modelsOf(doc)
  const words = searchable(search).split(/\s+/).filter(Boolean)
  const pictures = useMemo(() => new Map(componentsOf(doc).map((c) => [c.id, svgUrl(toSVG(doc, c.id, registry))])), [doc, version])
  const modelPictures = useMemo(
    () =>
      new Map(
        modelsOf(doc).map((m) => {
          const kind = registry.parametric.get(m.kind)
          return [m.key, kind ? parametricPicture(kind, m.props) : '']
        }),
      ),
    [doc, version],
  )
  const placed = useMemo(() => componentPlacements(doc), [doc])
  const unused = components.filter((c) => !placed.get(c.id)).length
  const chosen = new Set(selection.flatMap((id) => entryOf(doc.nodes[id]) ?? []))
  const browsing = useWindows((s) => s.browsing?.entry)
  const listed = [
    ...components.map((component) => ({ entry: component.id, name: component.name ?? component.id, model: undefined as Variant | undefined })),
    ...models.map((model) => ({ entry: modelEntry(model), name: entryName(doc, modelEntry(model)), model })),
  ]
    .filter((one) => words.every((word) => searchable(one.name).includes(word)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const action = (
    <span className="section-actions">
      <span className="view-switch">
        <IconButton title={t('Show as a list')} active={view === 'list'} onClick={() => setPrefs({ componentsView: 'list' })}>
          <List size={14} />
        </IconButton>
        <IconButton title={t('Show as pictures')} active={view === 'grid'} onClick={() => setPrefs({ componentsView: 'grid' })}>
          <LayoutGrid size={14} />
        </IconButton>
      </span>
      <MoreMenu title={t('More actions')} actions={[{ label: t('Delete unused components'), icon: <Trash2 size={14} />, disabled: unused === 0, run: deleteUnusedComponents }]} />
    </span>
  )
  const place = t('Click, then click on the drawing to place it, or drag it onto the drawing')
  /** A row or a tile: what it is, the picture and the name first; how many times it is placed; what can be done to it. */
  const row = ({ entry: id, name, model }: (typeof listed)[number]) => {
    const count = model ? model.ids.length : (placed.get(id) ?? 0)
    const picture = model ? modelPictures.get(model.key) : pictures.get(id)
    const put = model ? placeModel(model) : placeComponent(id)
    return (
      <div
        key={id}
        className={`${view === 'list' ? 'row clickable' : 'component-tile'}${chosen.has(id) ? ' selected' : ''}${count === 0 ? ' unused' : ''}`}
        title={count === 0 ? `${t('Placed nowhere in the drawing')}\n\n${place}` : place}
        onClick={() => put()}
        // The first click of the double-click that renames it has put it on the pointer: it is taken off.
        onDoubleClick={() => setTool('select')}
        onPointerDown={(e) => carry(e, put)}
        onDragStart={(e) => e.preventDefault()}
      >
        {picture ? <img className="thumb" src={picture} alt="" draggable={false} /> : <i className="thumb" />}
        <span className="component-name">
          {/* A model is named by its kind and parameters, not by the user. */}
          {model ? <span className="editable">{name}</span> : <EditableText value={name} onChange={rename(id)} />}
          <span className="faint uses" title={t('How many times it is placed')}>
            {count}
          </span>
        </span>
        <span className="component-actions">
          {/* An eye in a frame, not the eye that shows or hides: it goes through where the entry is placed. */}
          {count > 0 && (
            <IconButton title={t('Go through its instances one by one')} active={browsing === id} onClick={() => (browsing === id ? stopBrowsing() : browseInstances(id))}>
              <ScanEye size={13} />
            </IconButton>
          )}
          {/* Two drawn twice over: its instances made instances of the other, for the tables to count them together. */}
          {count > 0 && (
            <EntryChoice
              label={t('Replace its instances with another component')}
              exclude={(other) => other === id}
              pick={(to) => replaceInstances(id, to)}
              trigger={(open, shown) => (
                <IconButton title={t('Replace its instances with another component')} active={shown} onClick={open}>
                  <Replace size={13} />
                </IconButton>
              )}
            />
          )}
          <IconButton title={model ? t('Select them all, to change them together') : t('Edit component')} onClick={() => (model ? editModel(id) : openComponent(id))}>
            <Pencil size={13} />
          </IconButton>
          <IconButton title={model ? t('Delete them all') : t('Delete component and its instances')} onClick={() => deleteEntry(id)}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
    )
  }
  const any = components.length + models.length > 0
  return (
    <section className="section untitled">
      <PanelActions>{action}</PanelActions>
      {!any && <p className="hint">{t('No components yet')}</p>}
      {any && (
        <input
          className="panel-search"
          type="search"
          placeholder={t('Search the components…')}
          aria-label={t('Search the components…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && search && (e.stopPropagation(), setSearch(''))}
        />
      )}
      {any && listed.length === 0 && <p className="hint">{t('Nothing matches.')}</p>}
      {view === 'list' ? listed.map(row) : <div className="component-grid">{listed.map(row)}</div>}
    </section>
  )
}

/**
 * The row a range selected with Shift starts from: the last one clicked without Shift, as in a
 * file manager. It is only a convenience of this list, so it is kept here and not in the store.
 */
let anchor: string | null = null

/** The height of a row of the Structure list, as `.row` in styles.css sets it: rows are laid out by it. */
const ROW_HEIGHT = 28
/** Rows drawn beyond those in sight, above and below, so that scrolling shows no gap. */
const OVERSCAN = 12

/** A row of the Structure list: a node, and how deep in opened groups it is; or one of the parts of a view (`part`), under it. */
interface Line {
  node: Node
  depth: number
  part?: ViewPart
  /** A view on another page that looks at the plan of this one: listed here too, its eye or its line being here. */
  foreign?: boolean
}

/** Whether a row opens to list what it holds under it: a group, and a view, whose parts are listed under it, then what is drawn on it. */
const opens = (_doc: Document, node: Node): boolean => node.type === 'group' || node.type === 'elevation' || node.type === 'camera'

/** The rows of the list, topmost first: what is in the container, each opened group followed by what it holds. */
function linesOf(doc: Document, container: string, open: ReadonlySet<string>): Line[] {
  const lines: Line[] = []
  const walk = (parent: string, depth: number) => {
    const children = childrenOf(doc, parent)
    for (let i = children.length - 1; i >= 0; i--) {
      const node = children[i]
      lines.push({ node, depth })
      if (!opens(doc, node) || !open.has(node.id)) continue
      // A view is one object, of two parts, which are not objects: listed to be picked, never moved nor removed apart.
      if (node.type === 'camera' || node.type === 'elevation') lines.push({ node, depth: depth + 1, part: 'line' }, { node, depth: depth + 1, part: 'view' })
      walk(node.id, depth + 1)
    }
  }
  // On a page, the views of other pages that look at its plan come first, as their eyes and lines
  // are drawn over it: the same objects as on their own pages, with their parts; what an elevation
  // holds is drawn with it, on its own page, and listed there only.
  if (doc.nodes[container]?.type === 'page') {
    for (const node of viewsLookingAt(doc, container)) {
      lines.push({ node, depth: 0, foreign: true })
      if (open.has(node.id)) lines.push({ node, depth: 1, part: 'line', foreign: true }, { node, depth: 1, part: 'view', foreign: true })
    }
  }
  walk(container, 0)
  return lines
}

/**
 * One object in the list; a group can be opened to list what it holds under it. Rows directly in
 * the container being edited can be selected. Any row can be dragged up or down, with the rest of
 * the selection, to change the stacking order, or into another group, or out of one: dropped on
 * the middle of a group's row it goes inside it, above or below a row it goes next to it, in
 * whatever holds that row.
 */
/**
 * `twists` says whether the list holds a group, whose row has an arrow to open it: only then do
 * the rows keep a column for it, so that a list without groups starts where the panel's title does.
 */
function ObjectRow({ node, depth, open, toggle, show, twists }: { node: Node; depth: number; open: boolean; toggle: () => void; show: () => void; twists: boolean }) {
  const doc = useSettledDoc()
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const top = node.parent === scope
  const selected = top && selection.includes(node.id)
  const layer = node.layer === undefined ? undefined : doc.layers[node.layer]
  /** The name of the locked layer it is on, if it is. */
  const layerLock = layer?.locked ? layer.name : null

  /** Selects as a file manager does: a click picks one, Ctrl (or Cmd) adds or removes one, Shift takes everything from the last one clicked to this one. */
  const pick = (keys: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    // Something inside a group is reached by going into that group.
    if (!top) {
      anchor = node.id
      editComponent(node.parent!)
      return select([node.id])
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

  // A selected row takes the whole selection along; any other is picked up on its own (one inside a
  // group without being selected, which would mean going into the group). The list is topmost
  // first, so dropped above a row, objects go just after it in the stacking order.
  const { drop, handlers } = useRowDrag(
    'objects',
    node.id,
    true,
    () => {
      if (selected) return selection
      if (!top) return [node.id]
      anchor = node.id
      select([node.id])
      return [node.id]
    },
    (ids, at) => {
      if (at === 'into') {
        placeIn(ids, node.id)
        // What went in is shown there.
        if (!open) show()
      } else placeIn(ids, node.parent!, { id: node.id, after: at === 'above' })
    },
    // A group, or a view (what is dropped in it is brought into its coordinates, `placeInOps`).
    node.type === 'group' || node.type === 'elevation',
    // A group is not dropped into what it holds.
    (ids) => {
      for (let up = node.parent; up; up = doc.nodes[up]?.parent ?? null) if (ids.includes(up)) return true
      return false
    },
  )

  return (
    <div
      className={`row clickable${selected ? ' selected' : ''}${drop ? ` drop-${drop}` : ''}`}
      style={{ paddingLeft: (twists ? 6 : 18) + depth * 14 }}
      onClick={(e) => pick(e)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selected) pick()
        useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } })
      }}
      {...handlers}
    >
      {opens(doc, node) ? (
        <IconButton title={open ? t('Hide what is inside') : t('Show what is inside')} onClick={toggle}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </IconButton>
      ) : (
        twists && <i className="twist" />
      )}
      <TypeIcon node={node} />
      <EditableText value={labelOf(doc, node)} onChange={rename(node.id)} />
      {/* Locked by its layer, it shows so, faintly: nothing else on the row says why it cannot be picked on the drawing. */}
      <IconButton
        title={node.locked ? t('Unlock') : layerLock ? t('Locked with its layer “{layer}”: unlock it in the Layers panel', { layer: layerLock }) : t('Lock so it cannot be selected or moved on the drawing')}
        on={node.locked === true}
        onClick={() => apply([{ op: 'update_node', id: node.id, patch: { locked: node.locked ? null : true } }])}
      >
        {node.locked || layerLock ? <Lock size={13} /> : <LockOpen size={13} />}
      </IconButton>
      <IconButton
        title={node.visible === false ? t('Show') : t('Hide')}
        on={node.visible === false}
        onClick={() => apply([{ op: 'update_node', id: node.id, patch: { visible: node.visible === false } }])}
      >
        {node.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
      </IconButton>
    </div>
  )
}

/** What the parts of a view are called, as the sections of Properties that set them: a viewpoint's camera, an elevation's line of view, and the representation of either. */
const PARTS: Record<'camera' | 'elevation', Record<ViewPart, string>> = {
  camera: { line: msg('Camera'), view: msg('Representation') },
  elevation: { line: msg('Line of view'), view: msg('Representation') },
}

/**
 * A part of a view, under its row: a click selects the view, Properties opening on that part's
 * section (`selectViewPart`). Its line on the plan of another page is said so,
 * faint, with that page's name, and a click there goes to it.
 */
function PartRow({ node, part, depth, twists }: { node: NodeOf<'camera' | 'elevation'>; part: ViewPart; depth: number; twists: boolean }) {
  const doc = useSettledDoc()
  const scope = useStore((s) => s.scope)
  // The view selected whole (by its row, by its picture), both its parts are; picked by one, that one.
  const chosen = useStore((s) => s.selection.length === 1 && s.selection[0] === node.id && (s.viewPart === null || s.viewPart === part))
  // Each part is on a page, which may not be the one shown: its line on the page it looks at, its representation on its own.
  const here = rootOf(doc, scope)?.id
  const own = rootOf(doc, node.parent)?.id
  const page = part === 'line' ? lookedAt(doc, node) : own
  const elsewhere = page && page !== here ? doc.nodes[page] : undefined
  const pick = () => {
    if (own === here && node.parent !== scope) editComponent(node.parent!)
    selectViewPart(node.id, part)
    if (elsewhere) (part === 'line' ? zoomToViewMark : zoomToViewPicture)()
  }
  const Icon = part === 'view' ? Image : node.type === 'camera' ? Camera : MoveHorizontal
  return (
    <div
      className={`row clickable view-part${chosen ? ' selected' : ''}${elsewhere ? ' elsewhere' : ''}`}
      style={{ paddingLeft: (twists ? 6 : 18) + depth * 14 }}
      title={elsewhere ? t('On {page}: click to go there', { page: labelOf(doc, elsewhere) }) : undefined}
      onClick={pick}
      onContextMenu={(e) => {
        e.preventDefault()
        pick()
        useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } })
      }}
    >
      {twists && <i className="twist" />}
      <Icon size={13} className="type-icon" aria-hidden />
      <span className="view-part-name">{t(PARTS[node.type][part])}</span>
      {elsewhere && <span className="view-part-page">{labelOf(doc, elsewhere)}</span>}
    </div>
  )
}

/**
 * A view of another page that looks at the plan of this one, at the top of its list: the same object
 * as on its own page, whose name says where that is. A click selects it, here, where its eye or its
 * line is; it is moved in the order of its own page, not here.
 */
function ForeignViewRow({ node, open, toggle }: { node: Node; open: boolean; toggle: () => void }) {
  const doc = useSettledDoc()
  const selected = useStore((s) => s.selection.includes(node.id))
  const own = rootOf(doc, node.parent)
  return (
    <div
      className={`row clickable foreign-view${selected ? ' selected' : ''}`}
      style={{ paddingLeft: 6 }}
      title={own ? t('Drawn on {page}, looking at the plan of this page', { page: labelOf(doc, own) }) : undefined}
      onClick={() => select([node.id])}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selected) select([node.id])
        useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY } })
      }}
    >
      <IconButton title={open ? t('Hide what is inside') : t('Show what is inside')} onClick={toggle}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </IconButton>
      <TypeIcon node={node} />
      <span className="view-part-name">{labelOf(doc, node)}</span>
      {own && <span className="view-part-page">{labelOf(doc, own)}</span>}
    </div>
  )
}

/**
 * What is on the page (or in the component or group) being edited, topmost first. Only the rows in
 * sight are laid out, in a list as tall as all of them: a drawing imported from a DXF can hold
 * tens of thousands of objects in one container, and laying them all out took seconds after every
 * change.
 */
export function Objects() {
  const doc = useSettledDoc()
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const lines = useMemo(() => linesOf(doc, scope, open), [doc, scope, open])
  const twists = useMemo(() => lines.some((line) => opens(doc, line.node)), [lines, doc])
  const latest = useRef(lines)
  latest.current = lines
  const list = useRef<HTMLDivElement>(null)
  const [sight, setSight] = useState({ first: 0, last: 40 })

  /** The rows in sight, from where the list lies in the panel's scroll, and where the list's top is. */
  const measure = () => {
    const scroller = list.current?.closest<HTMLElement>('.dock-panel')
    if (!list.current || !scroller) return null
    const top = list.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    return { scroller, top, first: Math.floor(-top / ROW_HEIGHT), last: Math.ceil((scroller.clientHeight - top) / ROW_HEIGHT) }
  }

  // Read again as the panel scrolls, and as it is resized or shown (hidden, it measures nothing).
  useLayoutEffect(() => {
    const scroller = list.current?.closest<HTMLElement>('.dock-panel')
    if (!scroller) return
    const update = () => {
      const now = measure()
      if (now) setSight((was) => (was.first === now.first && was.last === now.last ? was : { first: now.first, last: now.last }))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const resized = new ResizeObserver(update)
    resized.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      resized.disconnect()
    }
  }, [])

  // What is selected on the drawing is scrolled to, however far down, unless some of the selection
  // is in sight already (as when it was picked in the list, where a range picked with Shift must
  // not jump back to its start).
  useEffect(() => {
    const now = measure()
    const chosen = new Set(selection)
    if (!now || chosen.size === 0 || now.scroller.clientHeight === 0) return
    const rows = latest.current
    for (let i = Math.max(0, now.first); i < Math.min(rows.length, now.last); i++) if (chosen.has(rows[i].node.id)) return
    const index = rows.findIndex((line) => chosen.has(line.node.id))
    if (index >= 0) now.scroller.scrollTop += now.top + index * ROW_HEIGHT - (now.scroller.clientHeight - ROW_HEIGHT) / 2
  }, [selection, scope])

  const from = Math.max(0, sight.first - OVERSCAN)
  const to = Math.min(lines.length, Math.max(sight.last, 0) + OVERSCAN)
  const toggle = (id: string) => () =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <section className="section untitled">
      {lines.length === 0 && <p className="hint">{t('Nothing drawn yet')}</p>}
      <div ref={list} style={{ height: lines.length * ROW_HEIGHT, paddingTop: from * ROW_HEIGHT, boxSizing: 'border-box' }}>
        {lines.slice(from, to).map((line) =>
          line.part ? (
            <PartRow key={`${line.node.id}:${line.part}`} node={line.node as NodeOf<'camera' | 'elevation'>} part={line.part} depth={line.depth} twists={twists} />
          ) : line.foreign ? (
            <ForeignViewRow key={`${line.node.id}:here`} node={line.node} open={open.has(line.node.id)} toggle={toggle(line.node.id)} />
          ) : (
            <ObjectRow key={line.node.id} node={line.node} depth={line.depth} open={open.has(line.node.id)} toggle={toggle(line.node.id)} show={() => setOpen((was) => new Set([...was, line.node.id]))} twists={twists} />
          ),
        )}
      </div>
    </section>
  )
}
