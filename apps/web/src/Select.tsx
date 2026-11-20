import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { FLOATING, useFloating } from './floating'

/*
 * The app's dropdown, in place of the system's: a button that says what is chosen, and under it a
 * list drawn as the app's menus are, the chosen one ticked. It is driven from the keyboard as the
 * system's is (arrows, Home, End, Enter or Space, a letter to go to what starts with it, Escape),
 * the focus staying on the button. Every list of choices in the app is one of these.
 */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Said when the pointer rests on it. */
  title?: string
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
  className?: string
  title?: string
  disabled?: boolean
  'aria-label'?: string
  style?: CSSProperties
}) {
  const { value, options, onChange } = props
  const [open, setOpen] = useState(false)
  /** The option the keyboard is on, as an index into every option. */
  const [active, setActive] = useState(-1)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const all = flatten(options)
  const chosen = all.findIndex((option) => option.value === value)
  const close = () => setOpen(false)
  const { closing, style } = useFloating(open, close, button, list)

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
        <span className={`select-value${chosen < 0 ? ' faint' : ''}`}>{chosen >= 0 ? all[chosen].label : (props.placeholder ?? '')}</span>
        <ChevronDown className="select-chevron" size={12} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={`${id}-list`}
            className={`select-list ${FLOATING}`}
            role="listbox"
            aria-label={props['aria-label']}
            style={{ ...style, minWidth: button.current?.getBoundingClientRect().width }}
            // The focus stays on the button, which the keys go to; and a press or a click in the list is
            // the list's, not that of what the field is in (a row, a window), where React would carry it.
            onPointerDown={(e) => (e.preventDefault(), e.stopPropagation())}
            onClick={(e) => e.stopPropagation()}
          >
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
