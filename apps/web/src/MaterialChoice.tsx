import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus } from 'lucide-react'
import type { Pattern } from '@opencalque/core'
import { showPanel } from './dock'
import { FillSwatch } from './FillChoice'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { IconButton } from './ui'

/**
 * Says where the look of a wall, or of a floor of a material, comes from, under its Material field:
 * it has no fill of its own, and is changed where the drawing's materials are.
 */
export function MaterialNote() {
  return (
    <p className="hint">
      {t('Its colour and hatch are those of its material.')}{' '}
      <button className="text-button" onClick={() => showPanel('materials')}>
        {t('Change them in Materials')}
      </button>
    </p>
  )
}

/** One material that can be picked: '' for the choice of none (the default material of walls, no material for a floor). */
export interface MaterialOption {
  id: string
  name: string
  fill: string
  pattern?: Pattern
}

/** A name as it is searched: without case or accents, so that "beton" finds "Béton". */
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * What something is made of, picked among the drawing's materials: a button with the swatch and
 * name of the one it is made of, which opens the list of them, each with its swatch. A box at the
 * top finds one by name, Enter picking the first found; the + beside it makes a new one, named as
 * typed, and picks it.
 */
export function MaterialChoice(props: { label: string; value: string | undefined; mixed: boolean; options: MaterialOption[]; pick: (id: string) => void; create: (name: string) => void }) {
  const { label, value, mixed, options, pick, create } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const { closing, style } = useFloating(open, close, box, menu)
  const now = mixed ? undefined : options.find((option) => option.id === (value ?? ''))
  const found = options.filter((option) => plain(option.name).includes(plain(query.trim())))
  const choose = (id: string) => {
    pick(id)
    close()
  }
  const make = () => {
    create(query.trim())
    close()
  }
  return (
    // A click in the chooser is about the material, not about the row it sits in.
    <span className="color-choice material-choice" ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="color-now"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (closing.current) return
          if (open) close()
          else setOpen(true)
        }}
      >
        {now ? <FillSwatch fill={now.fill} pattern={now.pattern} /> : <i className="none" />}
        {now ? <span>{now.name}</span> : <em className="faint">{t('Mixed')}</em>}
      </button>
      {open &&
        createPortal(
          <div className={`color-menu material-menu ${FLOATING}`} ref={menu} style={style} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
            <div className="material-search">
              <input
                autoFocus
                value={query}
                placeholder={t('Find a material…')}
                aria-label={t('Find a material…')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (found.length > 0) choose(found[0].id)
                  else if (query.trim()) make()
                }}
              />
              <IconButton title={query.trim() ? t('New material “{name}”', { name: query.trim() }) : t('Add a material')} onClick={make}>
                <Plus size={14} />
              </IconButton>
            </div>
            {found.map((option) => (
              <button key={option.id} type="button" className={`color-option${option.id === now?.id ? ' active' : ''}`} onClick={() => choose(option.id)}>
                <FillSwatch fill={option.fill} pattern={option.pattern} />
                <span>{option.name}</span>
                {option.id === now?.id && <Check size={12} />}
              </button>
            ))}
            {found.length === 0 && <p className="hint">{t('No material by that name: the + makes one.')}</p>}
          </div>,
          document.body,
        )}
    </span>
  )
}
