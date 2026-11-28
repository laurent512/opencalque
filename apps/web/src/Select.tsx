import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'

/*
 * The app's dropdown, in place of the system's: a button that says what is chosen, and under it a
 * list drawn as the app's menus are, the chosen one ticked. It is driven from the keyboard as the
 * system's is (arrows, Home, End, Enter or Space, a letter to go to what starts with it, Escape),
 * the focus staying on the button. Every list of choices in the app is one of these. A long one (the
 * time zones) has a box at the top of its list to find what is typed in it (`search`), and is
 * `SEARCHED_HEIGHT` tall whatever is left in it, so that it stays against its field; the keys then go
 * to that box.
 */

/** How tall the list of a Select with a box to search it is, in pixels (`.select-list.searched`), less where the window has no room. */
const SEARCHED_HEIGHT = 360

/** The options whose label, value or group holds what is typed; a group named so keeps all of its own. */
function found(items: SelectItem[], typed: string): SelectItem[] {
  const words = typed.trim().toLocaleLowerCase()
  if (!words) return items
  const has = (text: string) => text.toLocaleLowerCase().includes(words)
  return items.flatMap((item): SelectItem[] => {
    if (!('group' in item)) return has(item.label) || has(item.value) ? [item] : []
    if (has(item.group)) return [item]
    const options = item.options.filter((option) => has(option.label) || has(option.value))
    return options.length > 0 ? [{ ...item, options }] : []
  })
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Said when the pointer rests on it. */
  title?: string
  /**
   * A small drawing of it (the end of a line, a kind of dashes): shown before its name in the list,
   * and alone on the button when it is the one chosen, its name said when the pointer rests there.
   */
  picture?: ReactNode
}

/** Options under a heading of their own. */
export interface SelectGroup {
  group: string
  options: SelectOption[]
}

export type SelectItem = SelectOption | SelectGroup

/** The class of the button, by which the shortcuts know a key pressed on it is for it. */
export const SELECT_BUTTON = 'select'

const flatten = (items: SelectItem[]): SelectOption[] => items.flatMap((item) => ('group' in item ? item.options : [item]))

export function Select(props: {
  value: string
  options: SelectItem[]
  onChange: (value: string) => void
  /** Shown on the button when the value is none of the options: what choosing does ("Add…"). */
  placeholder?: string
  /** Shown on the button instead of the placeholder, where a word would take too much room (a bar of icons); `title` then says what it does. */
  icon?: ReactNode
  className?: string
  title?: string
  disabled?: boolean
  'aria-label'?: string
  style?: CSSProperties
  /** A box at the top of the list to find an option by what is typed in it, this its hint: for a long list. */
  search?: string
}) {
  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const options = props.search ? found(props.options, typed) : props.options
  const current = flatten(props.options).find((option) => option.value === value)
  const searchBox = useRef<HTMLInputElement>(null)
  /** The option the keyboard is on, as an index into every option. */
  const [active, setActive] = useState(-1)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const all = flatten(options)
  const chosen = all.findIndex((option) => option.value === value)
  const close = () => {
    setOpen(false)
    setTyped('')
    // The keys were the search box's: they go back to the button, unless the click that closed it was on something else.
    if (list.current?.contains(document.activeElement)) button.current?.focus()
  }
  const { closing, style, placed } = useFloating(open, close, button, list)
  // The search box takes the keys once the list is in place (hidden until then, it could not).
  useEffect(() => {
    if (open && placed && props.search) searchBox.current?.focus()
  }, [open, placed])
  // What is typed changes the list: the keyboard goes to the first of what is left.
  useEffect(() => {
    if (open && props.search) setActive(typed.trim() ? next(-1, 1) : chosen >= 0 ? chosen : next(-1, 1))
  }, [typed])

  const show = () => {
    setActive(chosen >= 0 && !all[chosen].disabled ? chosen : next(-1, 1))
    setOpen(true)
  }
  const choose = (index: number) => {
    const option = all[index]
    if (!option || option.disabled) return
    close()
    if (option.value !== value) onChange(option.value)
  }
  /** The next option that can be chosen from `from`, going `by`; where it was when there is none. */
  function next(from: number, by: 1 | -1): number {
    for (let i = from + by; i >= 0 && i < all.length; i += by) if (!all[i].disabled) return i
    return from
  }

  // The option the keyboard goes to is kept in sight.
  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])
  // Closed with it when it is disabled (the assistant, while it works).
  useEffect(() => {
    if (props.disabled) close()
  }, [props.disabled])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        e.preventDefault()
        show()
      }
      return
    }
    // Escape is the floating window's: it closes this list only.
    if (key === 'ArrowDown' || key === 'ArrowUp') setActive((at) => next(at, key === 'ArrowDown' ? 1 : -1))
    else if (key === 'Home') setActive(next(-1, 1))
    else if (key === 'End') setActive(next(all.length, -1))
    else if (key === 'Enter' || key === ' ') choose(active)
    else if (key === 'Tab') return close()
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // A letter goes to the next option that starts with it, round to the first.
      const letter = key.toLocaleLowerCase()
      const order = [...all.keys()].map((i) => (active + 1 + i) % all.length)
      const found = order.find((i) => !all[i].disabled && all[i].label.trim().toLocaleLowerCase().startsWith(letter))
      if (found !== undefined) setActive(found)
    } else return
    e.preventDefault()
  }

  let index = -1
  const row = (option: SelectOption) => {
    const i = ++index
    const on = i === chosen
    return (
      <div
        key={`${i}:${option.value}`}
        id={`${id}-${i}`}
        data-index={i}
        role="option"
        aria-selected={on}
        aria-disabled={option.disabled || undefined}
        title={option.title}
        className={`select-option${i === active ? ' active' : ''}${option.disabled ? ' disabled' : ''}`}
        onPointerMove={() => !option.disabled && i !== active && setActive(i)}
        onClick={() => choose(i)}
      >
        <span className="select-tick">{on && <Check size={12} />}</span>
        {option.picture && <span className="select-picture">{option.picture}</span>}
        <span className="select-label">{option.label}</span>
      </div>
    )
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${SELECT_BUTTON}${props.className ? ` ${props.className}` : ''}`}
        style={props.style}
        title={props.title}
        aria-label={props['aria-label']}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        disabled={props.disabled}
        onClick={() => {
          if (closing.current) return
          if (open) close()
          else show()
        }}
        onKeyDown={onKeyDown}
      >
        {current?.picture ? (
          <span className="select-value select-picture" title={current.label}>
            {current.picture}
          </span>
        ) : !current && props.icon ? (
          <span className="select-value select-picture">{props.icon}</span>
        ) : (
          <span className={`select-value${current ? '' : ' faint'}`}>{current ? current.label : (props.placeholder ?? '')}</span>
        )}
        <ChevronDown className="select-chevron" size={12} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={`${id}-list`}
            className={`select-list${props.search ? ' searched' : ''} ${FLOATING}`}
            role="listbox"
            aria-label={props['aria-label']}
            style={{ ...style, ...(props.search && 'maxHeight' in style ? { maxHeight: `min(${SEARCHED_HEIGHT}px, ${style.maxHeight})` } : {}), minWidth: button.current?.getBoundingClientRect().width }}
            // The focus stays on the button, which the keys go to; and a press or a click in the list is
            // the list's, not that of what the field is in (a row, a window), where React would carry it.
            onPointerDown={(e) => (e.preventDefault(), e.stopPropagation())}
            onClick={(e) => e.stopPropagation()}
          >
            {props.search && (
              <input
                ref={searchBox}
                className="select-search"
                value={typed}
                placeholder={props.search}
                aria-label={props.search}
                aria-controls={`${id}-list`}
                aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  // Arrows, Enter and Tab move in the list and choose; Escape closes it (`useFloating`); the rest is typed.
                  if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) onKeyDown(e)
                }}
              />
            )}
            {props.search && all.length === 0 && <div className="select-none">{t('Nothing matches')}</div>}
            {options.map((item) =>
              'group' in item ? (
                <div key={`group:${item.group}`} role="group" aria-label={item.group}>
                  <div className="select-group">{item.group}</div>
                  {item.options.map(row)}
                </div>
              ) : (
                row(item)
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
