import { useCallback, useRef, useState, useEffect, type FunctionComponent, type ReactNode } from 'react'
import { BrickWall, Component, Files, Layers as LayersIcon, ListTree, Palette, RulerDimensionLine, SlidersHorizontal, Sparkles, X, type LucideIcon } from 'lucide-react'
import { DockviewReact, getPanelData, themeLight, type DockviewApi, type DockviewGroupPanel, type DockviewPanelApi, type DockviewReadyEvent, type DockviewTheme, type DockviewWillShowOverlayLocationEvent, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { PANELS, registerDock, useDock, type PanelId } from './dock'
import { Guard } from './Guard'
import { t } from './i18n'
import { PanelHeadSlot, useHeadSlots } from './panelHead'
import { IconButton } from './ui'
import { AssistantPanel } from './panels/AssistantPanel'
import { Colors, Components, Layers, Objects, Pages } from './panels/LeftPanel'
import { Materials } from './panels/MaterialsPanel'
import { DimensionStyles } from './panels/DimensionStylesPanel'
import { Properties } from './panels/properties/Properties'
import { Stage } from './Stage'

const STORAGE_KEY = 'opencalque.layout'
const CANVAS = 'canvas'
/** Where the panels that existed when the layout was last saved are listed, to tell a new panel from a closed one. */
const KNOWN_KEY = 'opencalque.layout.panels'
/** How near the left or right edge of the window, in pixels, a panel dropped makes a column there. */
const EDGE_BAND = 10
/**
 * How near an edge of a group, in pixels, a panel dropped goes beside it; further in, it joins the
 * group. The library's own bands, a share of the group's size, were wide enough on a tall group that
 * a panel meant to join it went beside it.
 */
const SIDE_BAND = 30

/**
 * How dragging a panel looks: the tabs stay where they are and a short bar (styles.css) marks
 * where the tab will land, and the area a panel would take is outlined rather than only tinted.
 * The library's other way, tabs sliding apart around a gap, moved them under the pointer as it
 * went, and lost a drop let go of once they had slid.
 */
const THEME: DockviewTheme = {
  ...themeLight,
  dndTabIndicator: 'line',
  tabAnimation: 'default',
  dndPanelOverlay: 'content',
  dndOverlayBorder: '2px solid var(--dv-active-sash-color)',
}

/** What stands for each panel in the rail of its group. */
const ICONS: Record<PanelId, LucideIcon> = {
  pages: Files,
  layers: LayersIcon,
  components: Component,
  objects: ListTree,
  colors: Palette,
  materials: BrickWall,
  dimensionStyles: RulerDimensionLine,
  properties: SlidersHorizontal,
  assistant: Sparkles,
}

/**
 * A panel in its group's header. Where it shares the group with others, the header is a rail down
 * the group's left side and the panel is its icon, its name shown when the pointer rests on it;
 * alone, the header is a row at the top and the panel is its name, as a title (styles.css shows
 * one or the other). Either way a click brings the panel in front and a drag takes it elsewhere,
 * out of the group or into another one.
 */
function RailTab({ api }: IDockviewPanelHeaderProps) {
  const Icon = ICONS[api.id as PanelId]
  const name = api.title ?? ''
  return (
    <span className="rail-tab" title={name} aria-label={name}>
      {Icon && <Icon size={16} />}
      <span className="rail-name">{name}</span>
    </span>
  )
}

/**
 * The end of the header of a group holding one panel: the panel's buttons (`PanelActions` puts
 * them here through `useHeadSlots`) and the cross that closes it, after its name. A group of
 * several has its rail instead, and each panel this row of its own (`PanelFrame`).
 */
function GroupHead({ panels, activePanel }: IDockviewHeaderActionsProps) {
  const id = panels.length === 1 ? activePanel?.id : undefined
  const mine = useRef<HTMLElement | null>(null)
  // A panel moved from one group to another may get its new place before the old one goes: only
  // the place this header gave is taken back.
  const place = useCallback(
    (element: HTMLElement | null) => {
      if (!id) return
      if (element) useHeadSlots.setState({ [id]: element })
      else if (useHeadSlots.getState()[id] === mine.current) useHeadSlots.setState({ [id]: null })
      mine.current = element
    },
    [id],
  )
  if (!id || !(id in PANELS)) return null
  return (
    <span className="group-head">
      <span ref={place} className="panel-head-actions" />
      <IconButton title={t('Close')} onClick={() => activePanel?.api.close()}>
        <X size={14} />
      </IconButton>
    </span>
  )
}

/**
 * Every panel's frame. In a group of several, a row at the top with its name, its own buttons
 * (`PanelActions`, which panels put there) and the cross that closes it: the rail beside it says
 * what the panel is by its icon only, so the name is here, once. Alone in its group, the group's
 * header says all that (`GroupHead`). Then what it shows, which scrolls under the row unless it
 * scrolls by itself (the assistant).
 */
function PanelFrame({ id, api, scrolls, children }: { id: PanelId; api: DockviewPanelApi; scrolls: boolean; children: ReactNode }) {
  const [own, setOwn] = useState<HTMLElement | null>(null)
  const alone = useDock((s) => s.alone.includes(id))
  const shared = useHeadSlots((slots) => slots[id] ?? null)
  return (
    <div className="panel-frame" data-panel={id}>
      {!alone && (
        <header className="panel-head">
          <h2 className="panel-title">{title(id)}</h2>
          <span ref={setOwn} className="panel-head-actions" />
          <IconButton title={t('Close')} onClick={() => api.close()}>
            <X size={14} />
          </IconButton>
        </header>
      )}
      <PanelHeadSlot.Provider value={alone ? shared : own}>
        {scrolls ? (
          <div className="panel-scroll">
            <div className="dock-panel">
              <Guard area={title(id)}>{children}</Guard>
            </div>
          </div>
        ) : (
          <div className="panel-fill">
            <Guard area={title(id)}>{children}</Guard>
          </div>
        )}
      </PanelHeadSlot.Provider>
    </div>
  )
}

const framed =
  (id: PanelId, Panel: FunctionComponent, scrolls = true) =>
  ({ api }: IDockviewPanelProps) => (
    <PanelFrame id={id} api={api} scrolls={scrolls}>
      <Panel />
    </PanelFrame>
  )

/** A panel that fails shows a note in its place; the others, and the drawing, carry on. */
const guarded = (area: () => string, Panel: FunctionComponent) => () => (
  <Guard area={area()}>
    <Panel />
  </Guard>
)

const COMPONENTS: Record<PanelId | typeof CANVAS, FunctionComponent<IDockviewPanelProps>> = {
  canvas: guarded(() => t('The drawing area'), Stage),
  pages: framed('pages', Pages),
  layers: framed('layers', Layers),
  components: framed('components', Components),
  objects: framed('objects', Objects),
  colors: framed('colors', Colors),
  materials: framed('materials', Materials),
  dimensionStyles: framed('dimensionStyles', DimensionStyles),
  properties: framed('properties', Properties),
  assistant: framed('assistant', AssistantPanel, false),
}

/** Where a panel goes when it is opened and its usual neighbours are closed too. */
const SIDE: Record<PanelId, 'left' | 'right'> = { pages: 'left', layers: 'left', components: 'left', objects: 'left', colors: 'left', materials: 'left', dimensionStyles: 'left', properties: 'right', assistant: 'right' }
/** The panel each one shares a rail with by default. */
const PARTNER: Partial<Record<PanelId, PanelId>> = { pages: 'layers', layers: 'pages', components: 'layers', colors: 'layers', materials: 'layers', dimensionStyles: 'layers', properties: 'assistant', assistant: 'properties' }
/** The panel each one stands under, alone, by default. */
const BELOW: Partial<Record<PanelId, PanelId>> = { objects: 'layers' }

const title = (id: PanelId) => t(PANELS[id])

/**
 * The drawing has no rail and cannot be closed. Its group is marked (`drawing-group`) since nothing
 * else tells it apart in styles.css, where the line marking a drop beside a group is drawn from
 * the group's edge, above its header, which the drawing has not.
 */
function pinCanvas(api: DockviewApi): void {
  const canvas = api.getPanel(CANVAS)
  if (!canvas) return
  canvas.group.header.hidden = true
  canvas.group.element.classList.add('drawing-group')
}

/**
 * A group of several panels has their icons in a rail down its left side; a group of one, its name
 * in a row at the top (`RailTab`, `GroupHead`). Called again on every change of layout, as panels
 * come into a group or leave it; `useDock().alone` says which panels are alone, for `PanelFrame`.
 */
function fitHeaders(api: DockviewApi): void {
  const drawing = api.getPanel(CANVAS)?.group
  const alone: string[] = []
  for (const group of api.groups) {
    if (group === drawing) continue
    const position = group.panels.length > 1 ? 'left' : 'top'
    if (group.api.getHeaderPosition() !== position) group.api.setHeaderPosition(position)
    if (group.panels.length === 1) alone.push(group.panels[0].id)
  }
  const was = useDock.getState().alone
  if (was.length !== alone.length || alone.some((id) => !was.includes(id))) useDock.setState({ alone })
}

/**
 * Leaves out the drop zones that would give a useless result, so the ones offered while dragging
 * are all sensible (the owner's choices):
 * - only a panel is dragged, never a whole group (`stopGroupDrags`), so nothing is offered without one;
 * - on the drawing, a panel can dock at its left or right but never joins it, nor goes above or
 *   below it;
 * - no column is split into two side by side; panels there stack or share a rail. A group that is
 *   the whole column takes a panel at its side, which makes a column of its own, as tall
 *   (`wholeColumn`), taking its room from the drawing;
 * - an icon is shown no place in its own rail that would leave it where it is (`leavesInPlace`);
 * - a panel is offered no place on its own group that changes nothing (its middle; anywhere on it
 *   when it is alone there), nor, alone, beside the group next to it on the side it is already on
 *   (`besideAlready`);
 * - the row at the top of a group of one panel puts what is dropped on it above the group, as its
 *   top edge does, rather than in it: the library would join the group there, which left no way to
 *   drop a panel at the very top of a column. Dropped in the middle, it still joins.
 * A drop beside a group, on any side, is marked by `dropLine`, which also makes a column at either
 * edge of the window and gives a drag up on Escape.
 */
function limitDropZones(api: DockviewApi): () => void {
  const line = dropLine(api)
  const overlays = api.onWillShowOverlay((event) => {
    line.clear()
    const data = event.getData()
    if (line.taken() || !data?.panelId) return event.preventDefault()
    const group = event.group
    if (!group) return
    const from = api.groups.find((g) => g.id === data.groupId)
    const lone = from && from.panels.length === 1 ? from : undefined
    const header = event.kind === 'tab' || event.kind === 'header_space'
    const side = event.position === 'top' || event.position === 'bottom' || event.position === 'left' || event.position === 'right' ? event.position : null
    const drawing = group.id === api.getPanel(CANVAS)?.group.id
    const useless = drawing
      ? event.kind !== 'content' || (side !== 'left' && side !== 'right') || (lone !== undefined && besideAlready(lone, group, side))
      : event.kind === 'content' && group === from && (lone !== undefined || !side)
        ? true
        : event.kind === 'content' && lone !== undefined && side !== null && besideAlready(lone, group, side)
          ? true
          : event.kind === 'content' && (side === 'left' || side === 'right') && !wholeColumn(group)
            ? true
            : header && !(group.panels.length === 1 && group.api.getHeaderPosition() === 'top') && leavesInPlace(event, group)
    if (header && !drawing && group.panels.length === 1 && group.api.getHeaderPosition() === 'top') {
      // The row at the top of a group of one: above the group, done here, never joined.
      event.preventDefault()
      if (group !== from && !(lone && besideAlready(lone, group, 'top'))) line.show(group, 'top', data.panelId)
    } else if (useless) {
      event.preventDefault()
    } else if (event.kind === 'content' && side) {
      line.show(group, side)
    }
  })
  // What `dropLine` does itself, or a drag given up, the library does not drop as well.
  const drops = api.onWillDrop((event) => {
    if (line.taken()) event.preventDefault()
  })
  return () => {
    line.dispose()
    overlays.dispose()
    drops.dispose()
  }
}

/** The bands along the edges of a group's content where a panel goes beside it rather than joining it (`SIDE_BAND`). */
const sideBands = ({ location }: { location: string }) => (location === 'content' ? { activationSize: { type: 'pixels' as const, value: SIDE_BAND }, size: { type: 'pixels' as const, value: SIDE_BAND } } : undefined)

/**
 * Text cut short with "…" in a panel shows whole when the pointer rests on it, as a tooltip:
 * every row stays one line, whatever the width of the panel. Only where the text is cut, and not
 * where something says what it is already (a tooltip of its own). Returns what stops this.
 */
function fullTextOnHover(): () => void {
  const over = (event: PointerEvent) => {
    let element = event.target instanceof HTMLElement ? event.target : null
    for (let depth = 0; element && depth < 3 && element.closest('.dock'); depth++, element = element.parentElement) {
      if (getComputedStyle(element).textOverflow !== 'ellipsis') continue
      const ours = element.dataset.fullText !== undefined
      if (element.title && !ours) return
      const cut = element.scrollWidth > element.clientWidth + 1
      if (cut) {
        element.title = element.textContent?.trim() ?? ''
        element.dataset.fullText = ''
      } else if (ours) {
        element.removeAttribute('title')
        delete element.dataset.fullText
      }
      return
    }
  }
  window.addEventListener('pointerover', over, true)
  return () => window.removeEventListener('pointerover', over, true)
}

/**
 * Only a panel is dragged: the library drags a whole group by the empty part of its rail or of the
 * row at its top, which the owner does not want (it moved every panel of the group at once). The
 * press there never reaches it. Returns what stops this.
 */
function stopGroupDrags(): () => void {
  const press = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest('.dock .dv-void-container')) event.stopPropagation()
  }
  window.addEventListener('pointerdown', press, true)
  return () => window.removeEventListener('pointerdown', press, true)
}

/**
 * Whether a group is a column on its own, from the top of the panels to the bottom: it lies in a
 * row of the library's grid, not in a column of groups stacked one over another.
 */
function wholeColumn(group: DockviewGroupPanel): boolean {
  return group.element.closest('.dv-split-view-container')?.classList.contains('dv-horizontal') ?? false
}

/**
 * Whether the group `moving`, a panel alone, already lies against `target` on that side, as wide as
 * it (or as tall, at its left or right): dropped there, it would stay where it is.
 */
function besideAlready(moving: DockviewGroupPanel, target: DockviewGroupPanel, side: string): boolean {
  if (moving === target) return true
  const a = target.element.getBoundingClientRect()
  const b = moving.element.getBoundingClientRect()
  const near = (x: number, y: number) => Math.abs(x - y) <= 3
  const across = near(a.left, b.left) && near(a.width, b.width)
  const along = near(a.top, b.top) && near(a.height, b.height)
  if (side === 'bottom') return across && near(b.top, a.bottom)
  if (side === 'top') return across && near(b.bottom, a.top)
  if (side === 'right') return along && near(b.left, a.right)
  if (side === 'left') return along && near(b.right, a.left)
  return false
}

/** How thick the line marking a drop beside a group is, in pixels; on an edge of the window, where it is set a little in, thicker. */
const LINE = 3
const WINDOW_LINE = 4
const WINDOW_INSET = 2

/**
 * The line marking where a panel dropped beside a group will go: along that side of the group, as
 * long as it, centred on the group's edge (`.drop-line`, laid over the panels). The bottom of one
 * group and the top of the one under it, the side of a column and the side of the drawing next to
 * it, are one edge, marked at one place; on an edge of the window it is kept inside. The library's
 * own marks for those drops are drawn inside the group, where it clips them, so they are not shown.
 * Any other place the pointer goes takes the line away.
 *
 * Some drops are done here, the library's own being refused (`taken`, read by `limitDropZones`):
 * - on the row at the top of a group of one, `show` is given the panel, and puts it above the group
 *   when the pointer is let go (the library would join the group there);
 * - within `EDGE_BAND` of the window's left or right edge, the line runs down that whole edge and
 *   the panel makes a column there, the outermost (`.dock.edge-drop` hides the library's marks
 *   meanwhile). The library has drop zones for that, but the group under the pointer always took
 *   the drop first. Not for a panel that is that column already;
 * - Escape gives the drag up, which the library cannot: the library is shown the pointer outside
 *   every group so that it takes its marks away, and nothing is offered until the pointer is let go.
 */
function dropLine(api: DockviewApi) {
  type Side = 'top' | 'bottom' | 'left' | 'right'
  let target: { zone: Element; group: DockviewGroupPanel; side: Side; move?: string } | null = null
  /** The last place the library offered, to mark again when the pointer comes back from an edge of the window. */
  let offered: { group: DockviewGroupPanel; side: Side; move?: string } | null = null
  let edge: { side: 'left' | 'right'; panel: string } | null = null
  let givenUp = false
  let dropping = false
  let last: PointerEvent | null = null
  const line = document.createElement('div')
  line.className = 'drop-line'
  const dock = () => document.querySelector<HTMLElement>('.dock')
  const place = (box: { left: number; top: number; width: number; height: number }, side: Side) => {
    const room = dock()!.getBoundingClientRect()
    const across = side === 'top' || side === 'bottom'
    const edgeAt = side === 'top' ? box.top : side === 'bottom' ? box.top + box.height : side === 'left' ? box.left : box.left + box.width
    const low = across ? room.top : room.left
    const high = across ? room.bottom : room.right
    // On an edge of the window the line sat on its last pixels, where it was hard to see.
    const first = Math.abs(edgeAt - low) <= 1
    const lastOne = Math.abs(edgeAt - high) <= 1
    const thick = first || lastOne ? WINDOW_LINE : LINE
    const at = first ? low + WINDOW_INSET : lastOne ? high - WINDOW_INSET - thick : Math.min(Math.max(edgeAt - LINE / 2, low), high - LINE)
    Object.assign(line.style, across ? { left: `${box.left}px`, top: `${at}px`, width: `${box.width}px`, height: `${thick}px` } : { left: `${at}px`, top: `${box.top}px`, width: `${thick}px`, height: `${box.height}px` })
    if (!line.isConnected) dock()!.append(line)
  }
  /**
   * The panel dragged, the groups there were when the drag began and the size of the one it came
   * from: a panel that lands in a group of its own, made by the drop, is given that size back
   * (`keepSize`), its width as a column, its height in a column, at most half of it.
   */
  let drag: { panel: string; groups: Set<string>; width: number; height: number } | null = null
  const begin = () => {
    const data = getPanelData()
    if (drag || !data?.panelId) return
    const from = api.groups.find((group) => group.id === data.groupId)
    if (!from) return
    const box = from.element.getBoundingClientRect()
    drag = { panel: data.panelId, groups: new Set(api.groups.map((group) => group.id)), width: box.width, height: box.height }
  }
  const keepSize = (started: NonNullable<typeof drag>) => {
    const group = api.getPanel(started.panel)?.group
    if (!group || started.groups.has(group.id) || group.panels.length !== 1) return
    if (wholeColumn(group)) return group.api.setSize({ width: started.width })
    const column = group.element.closest('.dv-split-view-container')?.getBoundingClientRect()
    group.api.setSize({ height: Math.min(started.height, (column?.height ?? started.height * 2) / 2) })
  }
  /** Takes away the line of a place beside a group; the one down an edge of the window stays while the pointer is there. */
  const clear = () => {
    target = null
    if (!edge) line.remove()
  }
  const show = (group: DockviewGroupPanel, side: Side, move?: string) => {
    offered = { group, side, move }
    if (edge) return
    const zone = move ? group.element.querySelector('.dv-tabs-and-actions-container') : group.element
    if (!dock() || !zone) return
    target = { zone, group, side, move }
    place(group.element.getBoundingClientRect(), side)
  }
  /** Which edge of the window the pointer is at, for a panel that is not that edge's column already. */
  const edgeAt = (event: PointerEvent): 'left' | 'right' | null => {
    const data = getPanelData()
    const room = dock()?.getBoundingClientRect()
    if (!data?.panelId || !room || event.buttons === 0 || event.clientY < room.top || event.clientY > room.bottom) return null
    const side = event.clientX - room.left <= EDGE_BAND ? 'left' : room.right - event.clientX <= EDGE_BAND ? 'right' : null
    const from = api.groups.find((group) => group.id === data.groupId)
    if (!side || !from) return side
    const box = from.element.getBoundingClientRect()
    const already = from.panels.length === 1 && Math.abs(box.height - room.height) <= 3 && Math.abs(side === 'left' ? box.left - room.left : room.right - box.right) <= 3
    return already ? null : side
  }
  const pointer = (event: PointerEvent) => {
    if (!event.isTrusted) return
    last = event
    if (event.buttons !== 0) begin()
    if (givenUp) return
    const side = edgeAt(event)
    if (side) {
      edge = { side, panel: getPanelData()!.panelId! }
      target = null
      dock()?.classList.add('edge-drop')
      place(dock()!.getBoundingClientRect(), side)
      return
    }
    if (edge) {
      edge = null
      dock()?.classList.remove('edge-drop')
      line.remove()
      // Back over the place the library offered last, which it does not offer again until it changes.
      const zone = offered && (offered.move ? offered.group.element.querySelector('.dv-tabs-and-actions-container') : offered.group.element)
      if (offered && zone?.contains(document.elementFromPoint(event.clientX, event.clientY))) show(offered.group, offered.side, offered.move)
      return
    }
    if (target && !target.zone.contains(document.elementFromPoint(event.clientX, event.clientY))) clear()
  }
  const up = () => {
    const move = target?.move
    const group = target?.group
    const toEdge = edge
    // The library drops in its own handler of this release, after this one: what is done here, or
    // given up, it is told not to (`taken`) until then.
    dropping = toEdge !== null || givenUp || move !== undefined
    const started = givenUp ? null : drag
    drag = null
    edge = null
    clear()
    offered = null
    dock()?.classList.remove('edge-drop')
    setTimeout(() => {
      dropping = false
      givenUp = false
      if (toEdge) api.getPanel(toEdge.panel)?.api.moveTo({ group: api.addGroup({ direction: toEdge.side }), position: 'center' })
      else if (move && group) api.getPanel(move)?.api.moveTo({ group, position: 'top' })
      if (started) keepSize(started)
    })
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !getPanelData() || !last || last.buttons === 0) return
    // Only the drag is given up, not the selection or the tool, which Escape otherwise takes.
    event.stopPropagation()
    edge = null
    clear()
    offered = null
    dock()?.classList.remove('edge-drop')
    givenUp = true
    const away = { bubbles: true, clientX: -100, clientY: -100, pointerId: last.pointerId, pointerType: last.pointerType, isPrimary: last.isPrimary, buttons: last.buttons }
    ;(document.elementFromPoint(last.clientX, last.clientY) ?? document.body).dispatchEvent(new PointerEvent('pointermove', away))
  }
  const cancel = () => {
    drag = null
    edge = null
    clear()
    offered = null
    givenUp = false
    dock()?.classList.remove('edge-drop')
  }
  window.addEventListener('pointermove', pointer, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
  return {
    show,
    clear,
    /** Whether the drop is not the library's: done here, at an edge of the window, or given up. */
    taken: () => edge !== null || givenUp || dropping || target?.move !== undefined,
    dispose: () => {
      cancel()
      window.removeEventListener('pointermove', pointer, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
    },
  }
}

/**
 * Whether an icon dropped here would stay where it is: on either side of itself, or after the last
 * one when it is the last. No bar is shown there, and letting go does nothing.
 */
function leavesInPlace(event: DockviewWillShowOverlayLocationEvent, group: DockviewGroupPanel): boolean {
  const data = event.getData()
  if (!data?.panelId || data.groupId !== group.id) return false
  const from = group.panels.findIndex((panel) => panel.id === data.panelId)
  let to = group.panels.length
  if (event.kind === 'tab') {
    // The event names the group's tab in front, not the one under the pointer.
    const { clientX, clientY } = event.nativeEvent as MouseEvent
    const tab = document.elementFromPoint(clientX, clientY)?.closest('.dv-tab')
    const tabs = [...(tab?.parentElement?.children ?? [])].filter((element) => element.classList.contains('dv-tab'))
    if (!tab || !tabs.includes(tab)) return false
    to = tabs.indexOf(tab) + (event.position === 'right' || event.position === 'bottom' ? 1 : 0)
  }
  return to === from || to === from + 1
}

/** The parts of the library's grid that `drawingTakesTheDifference` reaches into; none is public. */
type Sizing = number | { type: string; index?: number }
interface Splitview {
  resize: (index: number, delta: number, sizes?: number[], low?: number[], high?: number[], ...rest: unknown[]) => number
  addView: (view: unknown, size?: Sizing, index?: number, skipLayout?: boolean) => void
  removeView: (index: number, sizing?: Sizing, skipLayout?: boolean) => unknown
  viewItems: { view: { element?: HTMLElement } }[]
}
interface GridNode { splitview?: Splitview; children?: GridNode[] }
const favouring = new WeakSet<Splitview>()
const evensOut = (sizing: Sizing | undefined) => typeof sizing === 'object' && sizing.type === 'distribute'

/**
 * Columns keep their width and the drawing takes the difference. Dragging the line between two
 * columns resizes the one on its side away from the drawing, those between it and the drawing
 * keeping theirs; a column closed leaves its room to the drawing (a panel closed in a column of
 * them, to the last one there), the others keeping their sizes; one opened without a width of its
 * own takes half of the drawing, as a drop beside it does. The library gives a drag's change
 * to the nearest view, makes every view of a row as wide as the others when one is closed, and
 * offers no say in either: a group's `priority` cannot be set, and a drag passes none. So every
 * splitview of the grid has its `resize` put the view that holds the drawing first, as the library
 * does with views of high priority, and its `addView` and `removeView` not even out the sizes.
 * This reaches into the library's internals; should they change, it does nothing and the library's
 * own way comes back. Called again on every change of layout, for the splitviews made since.
 */
function drawingTakesTheDifference(api: DockviewApi): void {
  const visit = (node: GridNode | undefined) => {
    const splitview = node?.splitview
    if (!splitview || !Array.isArray(splitview.viewItems) || ![splitview.resize, splitview.addView, splitview.removeView].every((f) => typeof f === 'function')) return
    if (!favouring.has(splitview)) {
      favouring.add(splitview)
      const { resize, addView, removeView } = splitview
      const drawingSide = () => {
        const drawing = api.getPanel(CANVAS)?.group.element
        return drawing ? splitview.viewItems.findIndex((item) => item.view.element?.contains(drawing)) : -1
      }
      splitview.resize = (index, delta, sizes, low, high, ...rest) => {
        const side = drawingSide()
        return resize.call(splitview, index, delta, sizes, low, side < 0 ? high : [...(high ?? []), side], ...rest)
      }
      splitview.addView = (view, size, index, skipLayout) => {
        const side = drawingSide()
        addView.call(splitview, view, side >= 0 && (size === undefined || evensOut(size)) ? { type: 'split', index: side } : size, index, skipLayout)
      }
      // Wherever it is: the drawing may be on its way from a column that is going.
      splitview.removeView = (index, sizing, skipLayout) => removeView.call(splitview, index, evensOut(sizing) ? undefined : sizing, skipLayout)
    }
    for (const child of node?.children ?? []) visit(child)
  }
  visit((api as unknown as { component?: { gridview?: { root?: GridNode } } }).component?.gridview?.root)
}

/**
 * Panels are dragged with pointer events (`dndStrategy="pointer"`) rather than the browser's drag
 * and drop, whose cursor on Windows said "not allowed" as a drag began and at every edge between
 * two elements on the way: the browser asks the page too late. While one is dragged, the page has
 * the class `dock-dragging`, which keeps one cursor over everything and the tabs without hover.
 * Returns what stops it.
 */
function markDrags(): () => void {
  const root = document.documentElement
  const move = (event: PointerEvent) => root.classList.toggle('dock-dragging', event.buttons !== 0 && getPanelData() !== undefined)
  const end = () => root.classList.remove('dock-dragging')
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
  return () => {
    end()
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
  }
}

function arrange(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: CANVAS, component: CANVAS, title: '' })
  const add = (id: PanelId, position: { referencePanel: string; direction: 'left' | 'right' | 'below' | 'within' }, initialWidth?: number) =>
    api.addPanel({ id, component: id, title: title(id), position, initialWidth })
  // Wide enough for Layers, Pages and Components side by side in every language (Japanese is the
  // widest), with room for fonts drawn wider than on Windows, as on Linux.
  add('layers', { referencePanel: CANVAS, direction: 'left' }, 300)
  add('pages', { referencePanel: 'layers', direction: 'within' })
  add('components', { referencePanel: 'layers', direction: 'within' })
  add('colors', { referencePanel: 'layers', direction: 'within' })
  add('materials', { referencePanel: 'layers', direction: 'within' })
  add('dimensionStyles', { referencePanel: 'layers', direction: 'within' })
  add('objects', { referencePanel: 'layers', direction: 'below' })
  add('properties', { referencePanel: CANVAS, direction: 'right' }, 290)
  add('assistant', { referencePanel: 'properties', direction: 'within' })
  for (const front of ['layers', 'objects', 'properties']) api.getPanel(front)?.api.setActive()
  pinCanvas(api)
  fitHeaders(api)
}

/**
 * A remembered arrangement without the panels this version no longer has (a panel can be retired,
 * as Assets was when the object library replaced it). Null when taking them out would leave an
 * empty group, in which case the default arrangement is the safer choice.
 */
function withoutUnknownPanels(saved: any): any | null {
  const known = (id: string) => id === CANVAS || id in PANELS
  const gone = Object.keys(saved?.panels ?? {}).filter((id) => !known(id))
  if (gone.length === 0) return saved
  let emptied = false
  const prune = (data: any) => {
    data.views = (data.views ?? []).filter(known)
    if (!known(data.activeView)) data.activeView = data.views[0]
    if (data.views.length === 0) emptied = true
  }
  const walk = (node: any) => {
    if (node?.type === 'leaf') prune(node.data)
    else for (const child of node?.data ?? []) walk(child)
  }
  walk(saved.grid?.root)
  for (const group of [...(saved.floatingGroups ?? []), ...(saved.popoutGroups ?? [])]) prune(group.data)
  for (const id of gone) delete saved.panels[id]
  return emptied ? null : saved
}

function restore(api: DockviewApi): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return arrange(api)
    const layout = withoutUnknownPanels(JSON.parse(saved))
    if (!layout) return arrange(api)
    api.fromJSON(layout)
    if (!api.getPanel(CANVAS)) return arrange(api)
    // Titles are saved in the language they were created in.
    for (const panel of api.panels) if (panel.id in PANELS) panel.api.setTitle(title(panel.id as PanelId))
    pinCanvas(api)
  } catch {
    arrange(api)
  }
}

/**
 * The drawing surrounded by panels that can be dragged to another edge, dropped onto another
 * group's rail to share it, pulled out to float, resized and closed. The arrangement
 * is remembered on this computer.
 */
export function Layout() {
  useEffect(() => () => registerDock(null), [])
  useEffect(markDrags, [])
  useEffect(stopGroupDrags, [])
  useEffect(fullTextOnHover, [])
  const [limits, setLimits] = useState<(() => void) | null>(null)
  useEffect(() => () => limits?.(), [limits])

  const onReady = ({ api }: DockviewReadyEvent) => {
    restore(api)
    fitHeaders(api)
    const stop = limitDropZones(api)
    setLimits(() => stop)
    drawingTakesTheDifference(api)
    api.onDidLayoutChange(() => drawingTakesTheDifference(api))
    const remember = () => {
      fitHeaders(api)
      useDock.setState({ open: api.panels.map((p) => p.id) })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()))
        localStorage.setItem(KNOWN_KEY, JSON.stringify(Object.keys(PANELS)))
      } catch {
        // Storage can be unavailable (private windows); the layout then lasts for this session.
      }
    }
    const show = (id: PanelId) => {
      const existing = api.getPanel(id)
      if (existing) return existing.api.setActive()
      const partner = PARTNER[id] && api.getPanel(PARTNER[id])
      const above = BELOW[id] && api.getPanel(BELOW[id])
      const position = partner ? { referencePanel: partner.id, direction: 'within' as const } : above ? { referencePanel: above.id, direction: 'below' as const } : { referencePanel: CANVAS, direction: SIDE[id] }
      api.addPanel({ id, component: id, title: title(id), position, initialWidth: partner || above ? undefined : 270 })
    }
    // A panel added to the app since the layout was saved is not in it: it is opened beside its
    // usual neighbour, behind it, so that it is found without disturbing what was arranged.
    try {
      const known: string[] = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? 'null') ?? (localStorage.getItem(STORAGE_KEY) ? ['pages', 'layers', 'objects', 'properties', 'assistant'] : Object.keys(PANELS))
      for (const id of Object.keys(PANELS) as PanelId[]) {
        if (known.includes(id) || api.getPanel(id)) continue
        const front = PARTNER[id] && api.getPanel(PARTNER[id])
        show(id)
        front?.api.setActive()
      }
    } catch {
      // Without storage there is no saved layout either: every panel is already there.
    }
    remember()
    api.onDidLayoutChange(remember)
    registerDock({
      show,
      // A panel hidden behind another tab is brought forward; only one in view is closed.
      toggle: (id) => {
        const existing = api.getPanel(id)
        if (existing?.api.isVisible) api.removePanel(existing)
        else show(id)
      },
      reset: () => arrange(api),
    })
  }

  // A rail too short for its icons scrolls; the library's own list of those out of sight is not wanted.
  return <DockviewReact className="dock" theme={THEME} dropOverlayModel={sideBands} dndStrategy="pointer" scrollbars="native" disableTabsOverflowList defaultTabComponent={RailTab} rightHeaderActionsComponent={GroupHead} components={COMPONENTS} onReady={onReady} />
}
