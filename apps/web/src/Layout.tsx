import { useEffect, type FunctionComponent } from 'react'
import { DockviewReact, themeLight, type DockviewApi, type DockviewReadyEvent, type DockviewTheme } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { PANELS, registerDock, useDock, type PanelId } from './dock'
import { t } from './i18n'
import { AssistantPanel } from './panels/AssistantPanel'
import { Layers, Objects, Pages } from './panels/LeftPanel'
import { Properties } from './panels/RightPanel'
import { Stage } from './Stage'

const STORAGE_KEY = 'opencalque.layout'
const CANVAS = 'canvas'
/** A column narrower than this is not offered to be split into two side by side. */
const SPLIT_MIN_WIDTH = 520

/**
 * How dragging a panel looks: tabs slide apart and a thin line marks where the tab will land,
 * and the area a panel would take is outlined rather than only tinted.
 */
const THEME: DockviewTheme = {
  ...themeLight,
  dndTabIndicator: 'line',
  tabAnimation: 'smooth',
  dndPanelOverlay: 'content',
  dndOverlayBorder: '2px solid var(--dv-active-sash-color)',
}

const scrolling = (id: PanelId, Panel: FunctionComponent) => () => (
  <div className="dock-panel" data-panel={id}>
    <Panel />
  </div>
)

const COMPONENTS: Record<PanelId | typeof CANVAS, FunctionComponent> = {
  canvas: Stage,
  pages: scrolling('pages', Pages),
  layers: scrolling('layers', Layers),
  objects: scrolling('objects', Objects),
  properties: scrolling('properties', Properties),
  assistant: AssistantPanel,
}

/** Where a panel goes when it is opened and its usual neighbours are closed too. */
const SIDE: Record<PanelId, 'left' | 'right'> = { pages: 'left', layers: 'left', objects: 'left', properties: 'right', assistant: 'right' }
/** The panel each one shares tabs with by default. */
const PARTNER: Record<PanelId, PanelId> = { pages: 'layers', layers: 'pages', objects: 'layers', properties: 'assistant', assistant: 'properties' }

const title = (id: PanelId) => t(PANELS[id])

/** The drawing has no tab strip and cannot be closed. */
function pinCanvas(api: DockviewApi): void {
  const canvas = api.getPanel(CANVAS)
  if (canvas) canvas.group.header.hidden = true
}

/**
 * Leaves out the drop zones that would give a useless result, so the ones offered while dragging
 * are all sensible:
 * - on the drawing, a panel can dock along a side but never becomes a tab of it;
 * - a narrow column is not split into two narrower ones; panels there stack or share tabs.
 */
function limitDropZones(api: DockviewApi): void {
  api.onWillShowOverlay((event) => {
    const group = event.group
    if (!group) return
    if (group.id === api.getPanel(CANVAS)?.group.id) {
      if (event.kind !== 'content' || event.position === 'center') event.preventDefault()
    } else if (event.kind === 'content' && (event.position === 'left' || event.position === 'right') && group.element.clientWidth < SPLIT_MIN_WIDTH) {
      event.preventDefault()
    }
  })
}

function arrange(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: CANVAS, component: CANVAS, title: '' })
  const add = (id: PanelId, position: { referencePanel: string; direction: 'left' | 'right' | 'below' | 'within' }, initialWidth?: number) =>
    api.addPanel({ id, component: id, title: title(id), position, initialWidth })
  add('layers', { referencePanel: CANVAS, direction: 'left' }, 250)
  add('pages', { referencePanel: 'layers', direction: 'within' })
  add('objects', { referencePanel: 'layers', direction: 'below' })
  add('properties', { referencePanel: CANVAS, direction: 'right' }, 290)
  add('assistant', { referencePanel: 'properties', direction: 'within' })
  for (const front of ['layers', 'objects', 'properties']) api.getPanel(front)?.api.setActive()
  pinCanvas(api)
}

/**
 * A remembered arrangement without the panels this version no longer has (a panel can be retired,
 * as Assets was when the component library replaced it). Null when taking them out would leave an
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
 * The drawing surrounded by panels that can be dragged to another edge, dropped onto another panel
 * to share its tabs, pulled out to float, resized and closed, as in a code editor. The arrangement
 * is remembered on this computer.
 */
export function Layout() {
  useEffect(() => () => registerDock(null), [])

  const onReady = ({ api }: DockviewReadyEvent) => {
    restore(api)
    limitDropZones(api)
    const remember = () => {
      useDock.setState({ open: api.panels.map((p) => p.id) })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()))
      } catch {
        // Storage can be unavailable (private windows); the layout then lasts for this session.
      }
    }
    remember()
    api.onDidLayoutChange(remember)

    const show = (id: PanelId) => {
      const existing = api.getPanel(id)
      if (existing) return existing.api.setActive()
      const partner = api.getPanel(PARTNER[id])
      const position = partner ? { referencePanel: partner.id, direction: 'within' as const } : { referencePanel: CANVAS, direction: SIDE[id] }
      api.addPanel({ id, component: id, title: title(id), position, initialWidth: partner ? undefined : 270 })
    }
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

  return <DockviewReact className="dock" theme={THEME} components={COMPONENTS} onReady={onReady} />
}
