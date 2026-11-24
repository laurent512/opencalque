import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { allCommands, execute, formatKey, keysOf, useCommands, type Command } from './commands'
import { controlSide, pagesOf } from '@opencalque/core'
import { labelOf } from './ui'
import { registry } from './extensions'
import { t } from './i18n'
import { useStore } from './store'

/** What a right-click offers, as command ids; null is a separator. */
const ON_SELECTION = [
  // The few things reached for most; the rest is in the Object menu and the properties panel.
  // Turning and mirroring are not here: they are in the toolbar, beside the Rotate tool.
  // First, where it is: from the list of objects, the thing picked may be anywhere on the drawing.
  'view.zoomToSelection',
  // A view is in two places: where it looks from, and its picture (in place of Zoom to it).
  'view.zoomToEye',
  'view.zoomToLine',
  'view.zoomToView',
  null,
  'view.addAutoDimensions',
  null,
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  null,
  'edit.selectSimilar',
  null,
  'edit.group',
  'edit.ungroup',
  'component.create',
  'component.browse',
  'component.vectorize',
  null,
  'edit.bringToFront',
  'edit.sendToBack',
  null,
  'file.exportSelection',
]
const ON_NOTHING = ['edit.paste', 'edit.pasteInPlace', 'edit.selectAll', null, 'view.zoomToFit', null, 'warehouse.components', 'file.importPlan']

/** The entry that opens, beside it, the pages a view can be moved to. */
const PAGES = { pages: true } as const

/** Closes the menu without doing anything: the point it was opened at is forgotten too, so that no later command acts there. */
const close = () => useStore.setState({ contextMenu: null, menuPoint: null })

/** The menu shown where the user right-clicked, on the drawing or on a row of the object list. */
export function ContextMenu() {
  const at = useStore((s) => s.contextMenu)
  const hasSelection = useStore((s) => s.selection.length > 0)
  // A picture that was brought in can have its scale set again, from here as well as from its properties.
  const onPicture = useStore((s) => s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'image')
  // A polyline or a polygon can be closed or opened, curved or straightened.
  const onPolyline = useStore((s) => s.selection.some((id) => s.doc.nodes[id]?.type === 'polyline'))
  // A switch can be linked to the lights it controls, and a light to its switches: the Connect tool starts from it.
  const onDevice = useStore((s) => s.selection.length === 1 && controlSide(s.doc.nodes[s.selection[0]], registry) !== null)
  // A view (3D, elevation, section) can be moved to another page, still looking at its plan.
  const onView = useStore((s) => s.selection.length === 1 && (s.doc.nodes[s.selection[0]]?.type === 'camera' || s.doc.nodes[s.selection[0]]?.type === 'elevation'))
  const doc = useStore((s) => s.doc)
  const overrides = useCommands((s) => s.overrides)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  // The list of pages a view goes to, opened beside its entry: where it is open, in window coordinates.
  const sub = useRef<HTMLDivElement>(null)
  const [pagesAt, setPagesAt] = useState<{ left: number; top: number; right: number } | null>(null)
  const [subPosition, setSubPosition] = useState({ left: 0, top: 0 })

  // Keep the whole menu on screen when the click was near the right or bottom edge.
  useLayoutEffect(() => {
    if (!at || !menu.current) return
    const box = menu.current.getBoundingClientRect()
    setPosition({ left: Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4)) })
    setPagesAt(null)
  }, [at])

  // Beside its entry, on the right, or on the left where the right has no room; kept on screen.
  useLayoutEffect(() => {
    if (!pagesAt || !sub.current) return
    const box = sub.current.getBoundingClientRect()
    const left = pagesAt.right + box.width + 4 <= window.innerWidth ? pagesAt.right : Math.max(4, pagesAt.left - box.width)
    setSubPosition({ left, top: Math.max(4, Math.min(pagesAt.top - 6, window.innerHeight - box.height - 4)) })
  }, [pagesAt])

  useEffect(() => {
    if (!at) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as HTMLElement) && !sub.current?.contains(e.target as HTMLElement)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [at])

  if (!at) return null
  const commands = allCommands()
  // Only what can be done to what was clicked: unlike the menu bar, whose items keep their places
  // and are greyed, this menu leaves out what does not apply (Ungroup on a wall, Make into a component
  // on a component), and the separators left doubled or at an end.
  const items: (Command | null | typeof PAGES)[] = []
  for (const id of [...(hasSelection ? ON_SELECTION : ON_NOTHING), ...(onPicture ? [null, 'tool.calibrate'] : []), ...(onPolyline ? [null, 'shape.close', 'shape.open', 'shape.curve', 'shape.straighten'] : []), ...(onDevice ? [null, 'tool.connect'] : [])]) {
    const command = id === null ? null : commands.find((c) => c.id === id)
    if (command === undefined || (command && command.when && !command.when())) continue
    if (onView && id === 'view.zoomToSelection') continue
    if (command === null && (items.length === 0 || items[items.length - 1] === null)) continue
    items.push(command)
  }
  // A view goes to another page: one entry, whose pages open beside it, however many there are.
  const targets = onView
    ? pagesOf(doc).flatMap((page) => {
        const command = commands.find((c) => c.id === `view.moveTo.${page.id}`)
        return command && (!command.when || command.when()) ? [{ name: labelOf(doc, page), command }] : []
      })
    : []
  if (targets.length > 0) items.push(null, PAGES)
  if (items[items.length - 1] === null) items.pop()
  const run = (item: Command) => {
    // The command may use the point the menu was opened at (Paste, Split here), and reads it as it starts.
    useStore.setState({ contextMenu: null })
    execute(item)
    useStore.setState({ menuPoint: null })
  }

  // Against the menu's own edge, level with its entry.
  const openPages = (target: HTMLElement) => {
    const entry = target.getBoundingClientRect()
    const box = menu.current?.getBoundingClientRect() ?? entry
    setPagesAt({ left: box.left, top: entry.top, right: box.right })
  }
  return (
    <>
      <div ref={menu} className="menu-list context-menu" role="menu" style={position} onContextMenu={(e) => e.preventDefault()}>
        {items.map((item, i) =>
          item === null ? (
            <hr key={i} />
          ) : 'pages' in item ? (
            <button key="pages" role="menuitem" aria-haspopup="menu" aria-expanded={pagesAt !== null} className={pagesAt ? 'open' : ''} onMouseEnter={(e) => openPages(e.currentTarget)} onClick={(e) => openPages(e.currentTarget)}>
              <span className="menu-title">{t('Move to page')}</span>
              <ChevronRight size={13} aria-hidden />
            </button>
          ) : (
            <button key={item.id} role="menuitem" onMouseEnter={() => setPagesAt(null)} onClick={() => run(item)}>
              {/* It is what was clicked that it acts on: no need to say "selection" each time. */}
              <span className="menu-title">{t(item.short ?? item.title)}</span>
              <kbd>{keysOf(item, overrides).slice(0, 1).map(formatKey)}</kbd>
            </button>
          ),
        )}
      </div>
      {pagesAt && (
        <div ref={sub} className="menu-list context-menu submenu" role="menu" aria-label={t('Move to page')} style={subPosition} onContextMenu={(e) => e.preventDefault()}>
          {targets.map(({ name, command }) => (
            <button key={command.id} role="menuitem" onClick={() => run(command)}>
              <span className="menu-title">{name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
