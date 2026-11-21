import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { BrickWall, Cable, ChevronDown, Link2, Link2Off, MoveHorizontal, ScanEye, Circle, Hexagon, Component, File, Group, Image, Lock, LockOpen, MessageSquare, Minus, RulerDimensionLine, Shapes, SeparatorVertical, Spline, Square, SquareDashed, StickyNote, Table, Type, type LucideIcon } from 'lucide-react'
import type { Document, Node } from '@opencalque/core'
import { GridLine } from './icons'
import { msg, t } from './i18n'
import { registry } from './extensions'
import { setPrefs, usePrefs } from './prefs'
import { collapseHistory, useStore } from './store'
import { dashIndex, DASHES } from './strokes'
import { formatNumber, parseLength, parseNumber, unitSuffix } from './units'
import { Select } from './Select'

const TYPE_LABELS: Record<Node['type'], string> = {
  page: msg('Page'),
  component: msg('Component'),
  group: msg('Group'),
  line: msg('Line'),
  polyline: msg('Polyline'),
  rect: msg('Rectangle'),
  paper: msg('Paper'),
  annotation: msg('Annotation'),
  gridline: msg('Grid line'),
  room: msg('Room'),
  divider: msg('Room divider'),
  elevation: msg('Elevation'),
  viewline: msg('View line'),
  link: msg('Link'),
  table: msg('Table of quantities'),
  ellipse: msg('Ellipse'),
  text: msg('Text'),
  wall: msg('Wall'),
  dimension: msg('Dimension'),
  image: msg('Picture'),
  instance: msg('Instance'),
  parametric: msg('Parametric object'),
}

const TYPE_ICONS: Record<Node['type'], LucideIcon> = {
  page: File,
  component: Component,
  group: Group,
  line: Minus,
  polyline: Spline,
  rect: Square,
  paper: StickyNote,
  annotation: MessageSquare,
  gridline: GridLine,
  room: SquareDashed,
  divider: SeparatorVertical,
  elevation: ScanEye,
  viewline: MoveHorizontal,
  link: Cable,
  table: Table,
  ellipse: Circle,
  text: Type,
  wall: BrickWall,
  dimension: RulerDimensionLine,
  image: Image,
  instance: Component,
  parametric: Shapes,
}

/** The small picture that tells kinds of object apart at a glance. Components and their instances are tinted. */
export function TypeIcon({ node }: { node: Node }) {
  const shut = node.type === 'polyline' && node.closed
  const Icon = shut ? Hexagon : TYPE_ICONS[node.type]
  return (
    <i className={`type-icon ${node.type}`} title={shut ? t('Polygon') : t(TYPE_LABELS[node.type])}>
      <Icon size={13} />
    </i>
  )
}

/** The name shown for a node that the user has not named. */
export function labelOf(doc: Document, node: Node): string {
  if (node.name) return node.name
  // A text is known by its first line; a note by its words, when it has some.
  if (node.type === 'text' || (node.type === 'annotation' && node.text.trim())) return node.text.split('\n')[0]
  if (node.type === 'gridline' && node.label.trim()) return t('Grid line {label}', { label: node.label })
  if (node.type === 'instance') return labelOf(doc, doc.nodes[node.component] ?? node)
  if (node.type === 'parametric') return t(registry.parametric.get(node.kind)?.label ?? node.kind)
  // A link by what it joins: "Switch → Ceiling light".
  if (node.type === 'link') {
    const [from, to] = [doc.nodes[node.from], doc.nodes[node.to]]
    if (from && to && from.type !== 'link' && to.type !== 'link') return `${labelOf(doc, from)} → ${labelOf(doc, to)}`
  }
  // A closed polyline is a polygon: what it is called says which.
  if (node.type === 'polyline' && node.closed) return t('Polygon')
  return t(TYPE_LABELS[node.type])
}

/**
 * A button that is an icon. `active` and `pressed` light it in the accent colour, as a tool in use;
 * `on` marks a setting of a row that is switched on (locked, hidden), which keeps its icon dark
 * where the row's other icons are light until the pointer comes over them.
 */
export function IconButton(props: { title: string; onClick: () => void; active?: boolean; pressed?: boolean; on?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className={`icon-button${props.active || props.pressed ? ' active' : ''}${props.on ? ' on' : ''}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      {props.children}
    </button>
  )
}

/** Text that turns into an input on double-click. */
export function EditableText({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <span className="editable" title={t('Double-click to rename')} onDoubleClick={() => setEditing(true)}>
        {value}
      </span>
    )
  }
  return (
    <input
      className="inline-input"
      autoFocus
      defaultValue={value}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        setEditing(false)
        const next = e.target.value.trim()
        if (next && next !== value) onChange(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.value = value
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

/** A labelled input that commits on Enter or blur, so half-typed values never reach the document. */
/** Millimetres a length changes by for each pixel it is dragged. */
const LENGTH_STEP = 10

/**
 * Lets a number be changed by holding Alt and dragging sideways on its field: right for more, left
 * for less, Shift for ten times faster. `read` gives the number as it is now (null when there is
 * none to start from) and `write` is called with each new one. With `snap`, the number starts from
 * the nearest multiple of it, so that the steps land on whole values. However far the drag goes,
 * it is one step to undo.
 */
export function scrub(read: () => number | null, write: (value: number) => void, step = 1, min = -Infinity, snap?: number) {
  return {
    onPointerDown(e: React.PointerEvent<HTMLInputElement>) {
      const now = read()
      if (!e.altKey || e.button !== 0 || now === null || !Number.isFinite(now)) return
      const start = snap ? Math.round(now / snap) * snap : now
      // No caret and no text selection: this press is a drag on the number.
      e.preventDefault()
      const input = e.currentTarget
      input.blur()
      input.setPointerCapture(e.pointerId)
      const from = e.clientX
      const mark = useStore.getState().past.length
      let last = now
      const move = (m: PointerEvent) => {
        const next = Math.max(min, Math.round((start + Math.round(m.clientX - from) * step * (m.shiftKey ? 10 : 1)) * 1e6) / 1e6)
        if (next === last) return
        last = next
        write(next)
      }
      const end = () => {
        input.removeEventListener('pointermove', move)
        input.removeEventListener('pointerup', end)
        input.removeEventListener('pointercancel', end)
        collapseHistory(mark)
      }
      input.addEventListener('pointermove', move)
      input.addEventListener('pointerup', end)
      input.addEventListener('pointercancel', end)
    },
  }
}

/**
 * An opacity from 0 to 1, as a slider and the percentage it is at (or "Mixed" when the objects
 * selected do not agree). Each position is written as the slider moves, so the drawing follows it;
 * however far it moves in one press, it is one step to undo.
 */
export function OpacitySlider({ value, onChange }: { value: number | undefined; onChange: (value: number) => void }) {
  const percent = Math.round((value ?? 1) * 100)
  return (
    <div className="opacity-slider">
      <input
        className="color-alpha"
        type="range"
        min={0}
        max={100}
        value={percent}
        aria-label={t('Opacity')}
        onPointerDown={() => {
          const mark = useStore.getState().past.length
          // Let go wherever the pointer is: over the slider or not.
          window.addEventListener('pointerup', () => collapseHistory(mark), { once: true })
        }}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span>{value === undefined ? t('Mixed') : `${percent} %`}</span>
    </div>
  )
}

/**
 * While Alt is held, number fields show a sideways arrow to say they can be dragged. Returns a
 * function that stops it.
 */
export function watchScrubKey(): () => void {
  const set = (on: boolean) => document.body.classList.toggle('scrubbing', on)
  const onKey = (e: KeyboardEvent) => {
    set(e.altKey)
    // Alt on its own would otherwise put the keyboard focus on the window's menu.
    if (e.key === 'Alt') e.preventDefault()
  }
  const off = () => set(false)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  window.addEventListener('blur', off)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    window.removeEventListener('blur', off)
  }
}

/** `from`: where dragging the number with Alt starts while the field is empty; `note`: said when the pointer rests on it. */
export function Field(props: { label: string; value: string | number; from?: number; note?: string; numeric?: boolean; length?: boolean; optional?: boolean; step?: number; min?: number; snap?: number; decimals?: number; placeholder?: string; multiline?: boolean; lead?: ReactNode; suffix?: string; onCommit: (value: any) => void }) {
  // What the number is counted in, written faint inside the box after it and not part of what is
  // typed: the user's unit for a length (none for feet and inches, which carry their marks), or `suffix`.
  usePrefs((prefs) => prefs.unit)
  const suffix = props.suffix ?? (props.length ? unitSuffix() : '')
  // A length is kept in mm and shown in the user's unit; any other number is shown as it is, to `decimals` places (2 unless said).
  const places = 10 ** (props.decimals ?? 2)
  const shown = typeof props.value !== 'number' ? props.value : props.length ? formatNumber(props.value) : String(Math.round(props.value * places) / places)
  const [text, setText] = useState(shown)
  useEffect(() => {
    setText(shown)
  }, [shown])
  const commit = () => {
    if (text === shown) return
    // Emptying an optional field unsets the property.
    if (props.optional && text.trim() === '') return props.onCommit(undefined)
    const value = props.length ? parseLength(text) : props.numeric ? parseNumber(text) : text
    if (props.numeric && (value === null || !Number.isFinite(value))) return setText(shown)
    props.onCommit(value)
  }
  if (props.multiline) {
    // A text of several lines: Enter makes a new one, and leaving the box keeps what was typed.
    return (
      <label className="field tall">
        <span>{props.label}</span>
        <textarea value={text} rows={Math.min(6, Math.max(2, text.split('\n').length))} placeholder={props.placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.currentTarget.blur()} />
      </label>
    )
  }
  return (
    <label className={`field${props.numeric ? ' numeric' : ''}${props.lead ? ' with-lead' : ''}${suffix ? ' with-unit' : ''}`}>
      <span>{props.label}</span>
      {props.lead}
      <input
        value={text}
        placeholder={props.placeholder}
        title={[props.note, props.numeric ? t('Hold Alt and drag sideways to change the value') : undefined].filter(Boolean).join('\n') || undefined}
        {...(props.numeric ? scrub(() => (typeof props.value === 'number' ? props.value : (props.from ?? null)), props.onCommit, props.step ?? (props.length ? LENGTH_STEP : 1), props.min, props.snap) : {})}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {suffix && (
        <span className="field-unit" aria-hidden="true">
          {suffix}
        </span>
      )}
    </label>
  )
}

/**
 * Two values on one row under one name: X and Y, a width and a height. Each is a field of its own,
 * whose name is hidden here but still names its box for a screen reader. `lock` goes after the name.
 */
export function FieldPair(props: { label: string; lock?: ReactNode; three?: boolean; children: ReactNode }) {
  return (
    <div className={`field-pair${props.three ? ' three' : ''}`}>
      <span className="field-pair-name">
        {props.label}
        {props.lock}
      </span>
      {props.children}
    </div>
  )
}

/** Whether a width and a height typed change together, for whatever is selected: a choice of the person's, not of the drawing's. */
export function ProportionLock() {
  const kept = usePrefs((prefs) => prefs.keepProportions)
  return (
    <IconButton on={kept} title={kept ? t('Proportions kept: click to set width and height apart') : t('Keep the proportions: width and height change together')} onClick={() => setPrefs({ keepProportions: !kept })}>
      {kept ? <Link2 size={13} /> : <Link2Off size={13} />}
    </IconButton>
  )
}

/**
 * Yes or no (or two other `words`, which may be pictures, then said by `titles`), as two tabs side
 * by side, the one that holds lit, in place of a checkbox, which reads less plainly. Neither is lit
 * when what it is about disagrees (several things selected). Not to be put in a label: a label would
 * hand every click to the first tab.
 */
export function YesNo(props: { value: boolean | undefined; onChange: (value: boolean) => void; label: string; title?: string; words?: [yes: ReactNode, no: ReactNode]; titles?: [yes: string, no: string] }) {
  return (
    <div className="yes-no" role="radiogroup" aria-label={props.label} title={props.title}>
      {[true, false].map((one) => (
        <button key={String(one)} type="button" role="radio" aria-checked={props.value === one} aria-label={props.titles?.[one ? 0 : 1]} title={props.titles?.[one ? 0 : 1]} className={props.value === one ? 'active' : ''} onClick={() => props.value !== one && props.onChange(one)}>
          {props.words ? props.words[one ? 0 : 1] : one ? t('Yes') : t('No')}
        </button>
      ))}
    </div>
  )
}

/** Provided by a panel whose sections fold under their headings. */
export const FoldingSections = createContext(false)

/**
 * A heading and what is under it. In a panel that says so (`FoldingSections`) a click on the heading
 * folds it, and it stays folded for whatever is selected next, known by its title. `count` is shown
 * after the title and is no part of it, so that a section stays folded whatever it counts.
 */
export function Section(props: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  const folding = useContext(FoldingSections)
  const folded = usePrefs((prefs) => folding && prefs.foldedSections.includes(props.title))
  const heading = props.count === undefined ? props.title : `${props.title} (${props.count})`
  const toggle = () => {
    const list = usePrefs.getState().foldedSections
    setPrefs({ foldedSections: folded ? list.filter((title) => title !== props.title) : [...list, props.title] })
  }
  return (
    <section className={`section${folded ? ' folded' : ''}`}>
      <h3>
        {folding ? (
          <button type="button" className="section-fold" aria-expanded={!folded} onClick={toggle}>
            <ChevronDown size={10} strokeWidth={2.5} />
            {heading}
          </button>
        ) : (
          heading
        )}
        {props.action}
      </h3>
      {!folded && props.children}
    </section>
  )
}

/**
 * The kinds of line as a row of small pictures to pick from: each a short stroke drawn with its
 * dashes. `value` is the pattern in use (none for a solid line); one that is not among the kinds
 * leaves no picture chosen.
 */
/** Where the line of a wall can be, and where it is in its picture: along the left face of a wall drawn from left to right, along its middle, or along its right face. */
const JUSTIFY_LINES: ['left' | 'center' | 'right', number][] = [
  ['left', 5],
  ['center', 9],
  ['right', 13],
]

/** The least room a picture of a row of choices needs, in pixels: with less, the row is a dropdown. */
const PICTURE_ROOM = 30

/**
 * A row of small pictures to pick one from (the ends of a line, its dashes, the joint of a wall),
 * each named when the pointer rests on it. Where the row has no room for them all, in a narrow
 * panel, it is a dropdown of them instead, the chosen one drawn on it and each drawn beside its
 * name in its list, which stays on its row rather than going under its label. None is lit when
 * `value` is none of them (several objects that differ). The row takes the width it is given
 * (`align-self: stretch` in a column), never its content's, and goes back to pictures only with a
 * few pixels to spare, so that it cannot go back and forth between the two.
 */
export function PictureRow<T extends string>(props: {
  className: string
  label?: string
  value: T | undefined
  choices: { value: T; name: string; picture: ReactNode }[]
  onPick: (value: T) => void
  onHover?: (value: T | null) => void
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const count = props.choices.length
  useLayoutEffect(() => {
    if (!box) return
    const need = count * PICTURE_ROOM + 4
    const fit = () => setNarrow((was) => box.clientWidth > 0 && box.clientWidth < (was ? need + 8 : need))
    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(box)
    return () => resized.disconnect()
  }, [box, count])
  return (
    <div ref={setBox} className="picture-row">
      {narrow ? (
        <Select value={props.value ?? ''} placeholder="—" aria-label={props.label} className={`picture-select ${props.className}`} options={props.choices.map((choice) => ({ value: choice.value, label: choice.name, picture: choice.picture }))} onChange={(value) => props.onPick(value as T)} />
      ) : (
        <div className={`end-picker ${props.className}`} role="radiogroup" aria-label={props.label} onMouseLeave={() => props.onHover?.(null)}>
          {props.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={choice.value === props.value}
              className={choice.value === props.value ? 'active' : ''}
              title={choice.name}
              aria-label={choice.name}
              onClick={() => props.onPick(choice.value)}
              onMouseEnter={() => props.onHover?.(choice.value)}
            >
              {choice.picture}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Three pictures to choose the line of a wall by: its left face, its middle, its right face, as
 * the wall runs. None is lit when `value` is undefined (several walls that differ). `onHover` is
 * told which one the pointer is on, and null when it leaves them.
 */
export function JustifyPicker(props: {
  value: 'left' | 'center' | 'right' | undefined
  names: Record<'left' | 'center' | 'right', string>
  label: string
  onPick: (value: 'left' | 'center' | 'right') => void
  onHover?: (value: 'left' | 'center' | 'right' | null) => void
}) {
  return (
    <PictureRow
      className="justify-picker"
      label={props.label}
      value={props.value}
      onPick={props.onPick}
      onHover={props.onHover}
      choices={JUSTIFY_LINES.map(([value, y]) => ({
        value,
        name: props.names[value],
        // The wall as a band, and its line as a dashed line with its two corners.
        picture: (
          <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3" y="5" width="22" height="8" fill="currentColor" fillOpacity="0.18" />
            <path d={`M3 ${y}h22`} strokeWidth="1.6" strokeDasharray="3 2" />
            <circle cx="3" cy={y} r="1.8" fill="currentColor" stroke="none" />
            <circle cx="25" cy={y} r="1.8" fill="currentColor" stroke="none" />
          </svg>
        ),
      }))}
    />
  )
}

export function DashPicker(props: { value: unknown; none?: boolean; label?: string; onPick: (pattern: number[] | null) => void; hidden?: { chosen: boolean; onPick: () => void }; faint?: boolean }) {
  // With `hidden`, the line can also be no line at all, the last choice; `faint` shows the choice as one that is inherited.
  const current = props.none || props.hidden?.chosen ? -1 : dashIndex(props.value)
  const choices = DASHES.map(([name, pattern], i) => ({
    value: String(i),
    name: t(name),
    picture: (
      <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.6">
        {/* The patterns are in screen pixels of a drawn line; here they are shown a little tighter to fit a few repeats. */}
        <path d="M2 9h24" strokeDasharray={pattern?.map((length) => length * 0.6).join(' ')} />
      </svg>
    ),
  }))
  if (props.hidden)
    choices.push({
      value: 'none',
      name: t('No line'),
      picture: (
        <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5">
          <path d="M2 9h24" strokeDasharray="1 2.5" />
          <path d="M10 4l8 10" strokeWidth="1.3" />
        </svg>
      ),
    })
  return (
    <PictureRow
      className={`dash-picker${props.faint ? ' faint-choice' : ''}`}
      label={props.label}
      value={props.hidden?.chosen ? 'none' : current >= 0 ? String(current) : undefined}
      choices={choices}
      onPick={(value) => (value === 'none' ? props.hidden?.onPick() : props.onPick(DASHES[Number(value)][1]))}
    />
  )
}

/**
 * A choice among a few, all in sight: a row of tabs. The tabs take equal widths when the names
 * fit, so moving from one to another moves nothing; use it where a `Select` would hide choices
 * that are better seen side by side.
 */
export function Tabs<T extends string>(props: { label: string; value: T | undefined; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={props.className ? `segments ${props.className}` : 'segments'} role="tablist" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === props.value} className={option.value === props.value ? 'active' : ''} onClick={() => props.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
