import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Link2, Plus, Unlink } from 'lucide-react'
import { create } from 'zustand'
import { colorRef, colorRefOf, colorsOf, newId, parseColor, resolveColor } from '@opencalque/core'
import { t } from './i18n'
import { apply, collapseHistory, useStore } from './store'

/** Hue in degrees, then how vivid and how bright, each from 0 to 1. */
interface Hsv {
  h: number
  s: number
  v: number
}

function toHsv(color: string): Hsv {
  const { r, g, b } = parseColor(color) ?? { r: 0, g: 0, b: 0 }
  const max = Math.max(r, g, b)
  const spread = max - Math.min(r, g, b)
  const h = spread === 0 ? 0 : max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  return { h: h * 60, s: max === 0 ? 0 : spread / max, v: max }
}

function toHex({ h, s, v }: Hsv): string {
  const part = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${part(5)}${part(3)}${part(1)}`
}

const RECENT_KEY = 'opencalque.recentColors'
const RECENT_MAX = 12

/** The colours picked lately, newest first, kept on this computer across drawings. */
const useRecent = create<{ colors: string[] }>(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return { colors: Array.isArray(stored) ? stored.filter((c) => typeof c === 'string').slice(0, RECENT_MAX) : [] }
  } catch {
    return { colors: [] }
  }
})

function remember(color: string): void {
  const colors = [color, ...useRecent.getState().colors.filter((other) => other !== color)].slice(0, RECENT_MAX)
  useRecent.setState({ colors })
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(colors))
  } catch {
    // Without storage the list lasts for this session.
  }
}

/**
 * Picks any colour: a square to choose how vivid and how bright, a band for the hue, and the
 * colour's code to read or type. `onChange` is called all along a drag; `onSettle` once it ends,
 * with the colour it ended on.
 */
function Picker({ value, onChange, onSettle }: { value: string; onChange: (color: string) => void; onSettle: (color: string) => void }) {
  const [hsv, setHsv] = useState(() => toHsv(value))
  const [code, setCode] = useState(value)
  // Follows a colour set from outside (a recent one, a reset) without losing the hue of a grey being dragged.
  useEffect(() => {
    if (toHex(hsv) !== toHex(toHsv(value))) {
      latest.current = toHsv(value)
      setHsv(latest.current)
    }
    setCode(toHex(toHsv(value)))
  }, [value])
  const mark = useRef(0)
  const dragging = useRef(false)
  const begin = () => {
    mark.current = useStore.getState().past.length
  }
  const settle = (color: string) => {
    // However far a drag went, it is one step to undo.
    collapseHistory(mark.current)
    onSettle(color)
  }
  // The colour as last set, for the end of a drag that comes before the picker is drawn again.
  const latest = useRef(hsv)
  const set = (next: Hsv) => {
    latest.current = next
    setHsv(next)
    onChange(toHex(next))
  }
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const area = e.currentTarget.getBoundingClientRect()
    const within = (n: number) => Math.max(0, Math.min(1, n))
    set({ h: hsv.h, s: within((e.clientX - area.left) / area.width), v: 1 - within((e.clientY - area.top) / area.height) })
  }
  const typed = () => {
    const text = code.trim().startsWith('#') ? code.trim() : `#${code.trim()}`
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return setCode(toHex(hsv))
    begin()
    const next = toHsv(text)
    set(next)
    settle(toHex(next))
  }

  return (
    <div className="color-picker">
      <div
        className="color-area"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={(e) => {
          // Capturing keeps the drag going when the pointer leaves the square; a pointer that cannot be captured still drags inside it.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // Nothing to do.
          }
          dragging.current = true
          begin()
          drag(e)
        }}
        onPointerMove={(e) => dragging.current && drag(e)}
        onPointerUp={() => {
          if (!dragging.current) return
          dragging.current = false
          settle(toHex(latest.current))
        }}
      >
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex(hsv) }} />
      </div>
      <input
        className="color-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h) % 360}
        title={t('Hue')}
        aria-label={t('Hue')}
        onPointerDown={begin}
        onChange={(e) => set({ ...hsv, h: Number(e.target.value) })}
        onPointerUp={() => settle(toHex(latest.current))}
      />
      <div className="color-code">
        <i style={{ background: toHex(hsv) }} />
        <input value={code} spellCheck={false} aria-label={t('Colour code')} title={t('Colour code')} onChange={(e) => setCode(e.target.value)} onBlur={typed} onKeyDown={(e) => e.key === 'Enter' && typed()} />
      </div>
    </div>
  )
}

/**
 * A colour property: what it is now, and a window to change it from. The window always opens on
 * a picker for any colour, then the colours picked lately, then the drawing's shared colours. A
 * property linked to a shared colour shows that colour's name with a link and follows it whenever
 * it changes; picking another colour gives it one of its own again. `compact` shows only the
 * swatch, for a row of a list or a bar, where there is no room for the name.
 */
export function ColorChoice({ stored, fallback, unset, commit, compact, title }: { stored: string | undefined; fallback: string; unset?: string; commit: (value: unknown) => void; compact?: boolean; title?: string }) {
  const doc = useStore((s) => s.doc)
  const recent = useRecent((s) => s.colors)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      // The window is drawn outside the field (see below), so a press in either is not a press elsewhere.
      if (!box.current?.contains(e.target as HTMLElement) && !menu.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    // The window is placed against the field once; when the panel scrolls under it, it closes.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element) || !menu.current?.contains(e.target)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  // The window has a width of its own, whatever the width of the field: it hangs under the field,
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
  }, [open, doc.colors, recent.length, stored === undefined, colorRefOf(stored)])

  const linked = colorRefOf(stored)
  const shared = linked === null ? undefined : doc.colors?.[linked]
  // What is painted: the shared colour's value, the property's own colour, or what it falls back on.
  const shown = resolveColor(doc, stored) ?? fallback
  const colors = colorsOf(doc)

  /** Makes a shared colour out of the one shown and links this property to it. */
  const share = () => {
    const id = newId('color')
    if (apply([{ op: 'add_color', color: { id, name: t('Colour {n}', { n: colors.length + 1 }), value: shown } }])) commit(colorRef(id))
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
        // transform would otherwise take the window along and put it somewhere else.
        createPortal(
          <div className="color-menu" ref={menu} style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <Picker value={shown} onChange={commit} onSettle={remember} />
            {linked && (
              <button type="button" className="color-option" title={t('Linked to a shared colour: it changes when that colour does')} onClick={() => commit(shown)}>
                <Unlink size={12} />
                <span>{t('Unlink from “{name}”', { name: shared?.name ?? t('Missing colour') })}</span>
              </button>
            )}
            {recent.length > 0 && (
              <>
                <h4>{t('Recent')}</h4>
                <div className="color-swatches">
                  {recent.map((color) => (
                    <button key={color} type="button" title={color} aria-label={color} className={!linked && color === shown ? 'active' : ''} style={{ background: color }} onClick={() => (commit(color), remember(color))} />
                  ))}
                </div>
              </>
            )}
            <h4>{t('Shared colours')}</h4>
            {colors.map((color) => (
              <button key={color.id} type="button" className={`color-option${color.id === linked ? ' active' : ''}`} title={t('Link to this shared colour')} onClick={() => commit(colorRef(color.id))}>
                <i style={{ background: color.value }} />
                <span>{color.name}</span>
                {color.id === linked && <Check size={12} />}
              </button>
            ))}
            {!linked && (
              <button type="button" className="color-option" onClick={share}>
                <Plus size={12} />
                <span>{t('New shared colour from this one')}</span>
              </button>
            )}
            {stored !== undefined && (
              <button type="button" className="color-option color-reset" onClick={() => (commit(undefined), setOpen(false))}>
                <span>
                  {t('Reset')}
                  {unset ? ` (${t(unset)})` : ''}
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}
