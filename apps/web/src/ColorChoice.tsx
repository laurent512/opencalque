import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Link2, Plus, Unlink } from 'lucide-react'
import { colorRef, colorRefOf, colorsOf, newId, resolveColor } from '@opencalque/core'
import { t } from './i18n'
import { apply, useStore } from './store'

/**
 * A colour property: what it is now, and a list to change it from. It can hold a colour of its
 * own, or be linked to one of the drawing's shared colours, in which case it shows that colour's
 * name with a link and follows it whenever it changes. `compact` shows only the swatch, for a
 * row of a list or a bar, where there is no room for the name.
 */
export function ColorChoice({ stored, fallback, unset, commit, compact, title }: { stored: string | undefined; fallback: string; unset?: string; commit: (value: unknown) => void; compact?: boolean; title?: string }) {
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      // The list is drawn outside the field (see below), so a press in either is not a press elsewhere.
      if (!box.current?.contains(e.target as HTMLElement) && !menu.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    // The list is placed against the field once; when the panel scrolls under it, it closes.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element) || !menu.current?.contains(e.target)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  // The list has a width of its own, whatever the width of the field: it hangs under the field,
  // ending where the field ends, goes above it when there is no room below, and stays in the window.
  useLayoutEffect(() => {
    if (!open || !box.current || !menu.current) return setPlace(null)
    const field = box.current.getBoundingClientRect()
    const list = menu.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, field.right - list.width), window.innerWidth - list.width - margin)
    const below = field.bottom + 4
    const top = below + list.height + margin <= window.innerHeight ? below : Math.max(margin, field.top - 4 - list.height)
    setPlace({ left, top })
  }, [open, stored, doc.colors])

  const linked = colorRefOf(stored)
  const shared = linked === null ? undefined : doc.colors?.[linked]
  // What is painted: the shared colour's value, the property's own colour, or what it falls back on.
  const shown = resolveColor(doc, stored) ?? fallback
  const colors = colorsOf(doc)

  /** Makes a shared colour out of the one shown and links this property to it. */
  const share = () => {
    const id = newId('color')
    if (apply([{ op: 'add_color', color: { id, name: t('Colour {n}', { n: colors.length + 1 }), value: shown } }])) commit(colorRef(id))
    setOpen(false)
  }

  return (
    // A click in the chooser is about the colour, not about the row it may sit in.
    <span className={`color-choice${compact ? ' compact' : ''}`} ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`color-now${linked ? ' linked' : ''}`}
        title={linked ? `${title ? `${title}: ` : ''}${shared?.name ?? t('Missing colour')}. ${t('Linked to a shared colour: it changes when that colour does')}` : (title ?? t('Choose a colour'))}
        onClick={() => setOpen(!open)}
      >
        <i style={{ background: shown }} />
        {compact ? (
          linked && <Link2 size={9} />
        ) : linked ? (
          <>
            <Link2 size={12} />
            <span>{shared?.name ?? t('Missing colour')}</span>
          </>
        ) : stored === undefined ? (
          <em className="faint">{unset && t(unset)}</em>
        ) : (
          <span>{shown}</span>
        )}
      </button>
      {open &&
        // Drawn at the top of the page, not inside the field: a bar that is moved into place with a
        // transform would otherwise take the list along and put it somewhere else.
        createPortal(
        <div className="color-menu" ref={menu} style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}>
          <h4>{t('Shared colours')}</h4>
          {colors.length === 0 && <p className="hint">{t('None yet. A shared colour is used by reference: change it once and everything linked to it changes.')}</p>}
          {colors.map((color) => (
            <button key={color.id} type="button" className={`color-option${color.id === linked ? ' active' : ''}`} title={t('Link to this shared colour')} onClick={() => (commit(colorRef(color.id)), setOpen(false))}>
              <i style={{ background: color.value }} />
              <span>{color.name}</span>
              {color.id === linked && <Check size={12} />}
            </button>
          ))}
          <button type="button" className="color-option" onClick={share}>
            <Plus size={12} />
            <span>{t('New shared colour from this one')}</span>
          </button>
          {shared && (
            <label className="color-option" title={t('Changes every object linked to it')}>
              <input type="color" className="swatch" value={shared.value} onChange={(e) => apply([{ op: 'update_color', id: shared.id, patch: { value: e.target.value } }])} />
              <span>{t('Change “{name}” everywhere', { name: shared.name })}</span>
            </label>
          )}
          <h4>{t('A colour of its own')}</h4>
          <label className="color-option">
            <input type="color" className="swatch" value={shown} onChange={(e) => commit(e.target.value)} />
            <span>{linked ? t('Unlink and pick a colour') : t('Pick a colour')}</span>
          </label>
          {linked && (
            <button type="button" className="color-option" onClick={() => (commit(shown), setOpen(false))}>
              <Unlink size={12} />
              <span>{t('Unlink, keeping the colour')}</span>
            </button>
          )}
          {stored !== undefined && (
            <button type="button" className="color-option" onClick={() => (commit(undefined), setOpen(false))}>
              <span>{t('Reset')}{unset ? ` (${t(unset)})` : ''}</span>
            </button>
          )}
        </div>,
          document.body,
        )}
    </span>
  )
}
