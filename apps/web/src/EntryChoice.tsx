import { useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { toSVG } from '@opencalque/core'
import { svgUrl } from './carry'
import { entriesOf, entryName, modelOf } from './entries'
import { registry } from './extensions'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { parametricPicture } from './pictures'
import { useStore } from './store'

/** A name as it is searched: without case or accents, so that "prise" finds "Prisé". */
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * One of the entries of the Components panel (a component, or a model of parametric objects),
 * picked from a list showing each with its picture, found by name, Enter picking the first found.
 * Opened by a button showing the one chosen (`value`, or "Mixed"), or by `trigger`, a button of the
 * caller's (an icon in a row). Those `exclude` says cannot be picked are left out of the list.
 */
export function EntryChoice(props: { label: string; value?: string; mixed?: boolean; exclude?: (entry: string) => boolean; pick: (entry: string) => void; trigger?: (open: () => void, shown: boolean) => ReactNode }) {
  const { label, value, mixed, exclude, pick, trigger } = props
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const { closing, style } = useFloating(open, close, box, menu)
  // Listed only while open: the list goes through the whole drawing, and the chooser is drawn closed
  // each time an object is selected.
  const entries = useMemo(
    () =>
      open
        ? entriesOf(doc)
            .filter((entry) => !exclude?.(entry))
            .map((entry) => ({ entry, name: entryName(doc, entry) }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        : [],
    [open, doc, exclude],
  )
  const pictures = useMemo(() => {
    if (!open) return new Map<string, string>()
    return new Map(
      entriesOf(doc).map((entry) => {
        const model = modelOf(doc, entry)
        const kind = model && registry.parametric.get(model.kind)
        return [entry, model ? (kind ? parametricPicture(kind, model.props) : '') : svgUrl(toSVG(doc, entry, registry))]
      }),
    )
  }, [open, doc])
  const found = entries.filter((one) => plain(one.name).includes(plain(query.trim())))
  const toggle = () => {
    if (closing.current) return
    if (open) close()
    else setOpen(true)
  }
  const choose = (entry: string) => {
    pick(entry)
    close()
  }
  // A click or a press in it is about the choice, not about the row it may sit in (which places one).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <span className="color-choice component-choice" ref={box} onClick={stop} onPointerDown={stop}>
      {trigger ? (
        trigger(toggle, open)
      ) : (
        <button type="button" className="color-now" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
          {!mixed && value ? <span>{entryName(doc, value)}</span> : <em className="faint">{t('Mixed')}</em>}
        </button>
      )}
      {open &&
        createPortal(
          <div className={`color-menu material-menu ${FLOATING}`} ref={menu} style={style} role="dialog" aria-label={label} onClick={stop} onPointerDown={stop}>
            <div className="material-search">
              <input
                autoFocus
                value={query}
                placeholder={t('Find a component…')}
                aria-label={t('Find a component…')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && found.length > 0 && choose(found[0].entry)}
              />
            </div>
            {found.map(({ entry, name }) => (
              <button key={entry} type="button" className={`color-option${entry === value && !mixed ? ' active' : ''}`} onClick={() => choose(entry)}>
                {pictures.get(entry) ? <img className="thumb" src={pictures.get(entry)} alt="" /> : <i className="thumb" />}
                <span>{name}</span>
                {entry === value && !mixed && <Check size={12} />}
              </button>
            ))}
            {found.length === 0 && <p className="hint">{t('Nothing matches.')}</p>}
          </div>,
          document.body,
        )}
    </span>
  )
}
