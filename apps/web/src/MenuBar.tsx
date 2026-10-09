import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { allCommands, execute, formatKey, keysOf, useCommands, type Command } from './commands'
import { msg, t } from './i18n'
import { autosaves } from './autosave'
import { usePrefs } from './prefs'
import { apply, isDirty, useStore } from './store'
import { EditableText } from './ui'

/**
 * What each menu holds: command ids, null for a separator, or "@Category" for every command of a
 * category (used for the lists that depend on the drawing and on extensions).
 */
const MENUS: [string, (string | null)[]][] = [
  [msg('File'), ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.autosave', null, 'file.importPlan', 'tool.calibrate', 'file.importLibrary', null, 'file.exportPdf', 'file.exportSvg', 'file.exportDxf']],
  [msg('Edit'), ['edit.undo', 'edit.redo', null, 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', null, 'edit.selectAll', 'edit.deselect']],
  // What is done to the selection as an object, as against editing in general: arranging, transforming, modifying.
  [
    msg('Object'),
    ['edit.group', 'edit.ungroup', null, 'edit.bringToFront', 'edit.bringForward', 'edit.sendBackward', 'edit.sendToBack', null, 'edit.rotateRight', 'edit.rotateLeft', 'edit.flipHorizontal', 'edit.flipVertical', null, 'modifier.crop', 'modifier.hatch', null, 'component.create', 'component.finish'],
  ],
  [msg('View'), ['view.zoomToFit', 'view.zoomIn', 'view.zoomOut', null, 'view.toggleGrid', 'view.toggleSnapGrid', 'view.toggleSnapObjects', null, '@Panels', null, 'view.resetLayout']],
  // There is no Insert or Tools menu: the toolbar holds the tools and the component library, and pages
  // and layers are added from their panels. Every command stays in the command list (Ctrl+K).
  [msg('Preferences'), ['prefs.open', 'warehouse.extensions', null, 'palette.open', 'shortcuts.reset']],
]

function items(entries: (string | null)[], commands: Command[]): (Command | null)[] {
  const out: (Command | null)[] = []
  for (const entry of entries) {
    if (entry === null) out.push(null)
    else if (entry.startsWith('@')) out.push(...commands.filter((c) => c.category === entry.slice(1) && !entries.includes(c.id)))
    else out.push(commands.find((c) => c.id === entry) ?? null)
  }
  // Drop separators left dangling when a dynamic list turned out empty.
  return out.filter((item, i) => item !== null || (i > 0 && out[i - 1] !== null && i < out.length - 1))
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null)
  const bar = useRef<HTMLElement>(null)
  const overrides = useCommands((s) => s.overrides)
  const name = useStore((s) => s.doc.name)
  const dirty = useStore(isDirty)
  const file = useStore((s) => s.file)
  // Read so the note beside the name follows the setting.
  usePrefs((p) => p.autosave)
  const commands = open ? allCommands() : []

  // An open menu closes on Escape or on a press anywhere outside the menus. Nothing covers the bar
  // while a menu is open, so moving along it reaches the other titles.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) setOpen(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header className="menubar" ref={bar}>
      <strong className="menubar-brand">OpenCalque</strong>
      {MENUS.map(([title, entries]) => (
        <div key={title} className="menu">
          <button
            className={`menubar-item${open === title ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === title}
            onClick={() => setOpen(open === title ? null : title)}
            // Once one menu is open, pointing at another title switches to it, as native menus do.
            onPointerEnter={() => open && open !== title && setOpen(title)}
          >
            {t(title)}
          </button>
          {open === title && (
            <div className="menu-list" role="menu">
              {items(entries, commands).map((item, i) =>
                item === null ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={item.id}
                    role="menuitem"
                    disabled={item.when ? !item.when() : false}
                    onClick={() => {
                      setOpen(null)
                      execute(item)
                    }}
                  >
                    <span className="menu-check">{item.checked?.() && <Check size={12} />}</span>
                    <span className="menu-title">{t(item.title)}</span>
                    <kbd>{keysOf(item, overrides).slice(0, 1).map(formatKey)}</kbd>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-name">
        <EditableText value={name} onChange={(next) => apply([{ op: 'set_document', name: next }])} />
        {dirty && <span className="faint" title={autosaves(file) ? t('Saving…') : t('Unsaved changes')}>●</span>}
        {!dirty && autosaves(file) && <span className="faint menubar-saved">{t('Saved')}</span>}
      </div>
    </header>
  )
}
