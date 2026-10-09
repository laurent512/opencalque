import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { allCommands, execute, formatKey, keysOf, useCommands } from './commands'
import { t } from './i18n'
import { useStore } from './store'

/** What a right-click offers, as command ids; null is a separator. */
const ON_SELECTION = [
  // The few things reached for most; the rest is in the Object menu and the properties panel.
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  null,
  'edit.group',
  'edit.ungroup',
  'component.create',
  null,
  'edit.bringToFront',
  'edit.sendToBack',
  null,
  'edit.rotateRight',
  'edit.flipHorizontal',
  'edit.flipVertical',
]
const ON_NOTHING = ['edit.paste', 'edit.selectAll', null, 'view.zoomToFit', null, 'warehouse.components', 'file.importPlan']

const close = () => useStore.setState({ contextMenu: null })

/** The menu shown where the user right-clicked, on the drawing or on a row of the object list. */
export function ContextMenu() {
  const at = useStore((s) => s.contextMenu)
  const hasSelection = useStore((s) => s.selection.length > 0)
  // A picture that was brought in can have its scale set again, from here as well as from its properties.
  const onPicture = useStore((s) => s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'image')
  const overrides = useCommands((s) => s.overrides)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  // Keep the whole menu on screen when the click was near the right or bottom edge.
  useLayoutEffect(() => {
    if (!at || !menu.current) return
    const box = menu.current.getBoundingClientRect()
    setPosition({ left: Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4)) })
  }, [at])

  useEffect(() => {
    if (!at) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as HTMLElement)) close()
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
  const items = [...(hasSelection ? ON_SELECTION : ON_NOTHING), ...(onPicture ? [null, 'tool.calibrate'] : [])].map((id) => commands.find((c) => c.id === id) ?? null)

  return (
    <div ref={menu} className="menu-list context-menu" role="menu" style={position} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === null ? (
          <hr key={i} />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.when ? !item.when() : false}
            onClick={() => {
              close()
              execute(item)
            }}
          >
            <span className="menu-title">{t(item.title)}</span>
            <kbd>{keysOf(item, overrides).slice(0, 1).map(formatKey)}</kbd>
          </button>
        ),
      )}
    </div>
  )
}
