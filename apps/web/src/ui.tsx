import { useEffect, useState, type ReactNode } from 'react'
import { BrickWall, Circle, Component, File, Group, Image, MessageSquare, Minus, RulerDimensionLine, Shapes, SeparatorVertical, Spline, Square, SquareDashed, StickyNote, Type, type LucideIcon } from 'lucide-react'
import type { Document, Node } from '@opencalque/core'
import { msg, t } from './i18n'
import { collapseHistory, registry, useStore } from './store'
import { formatNumber, parseLength, parseNumber } from './units'

const TYPE_LABELS: Record<Node['type'], string> = {
  page: msg('Page'),
  component: msg('Component'),
  group: msg('Group'),
  line: msg('Line'),
  polyline: msg('Polyline'),
  rect: msg('Rectangle'),
  paper: msg('Paper'),
  annotation: msg('Annotation'),
  room: msg('Room'),
  divider: msg('Room divider'),
  ellipse: msg('Ellipse'),
  text: msg('Text'),
  wall: msg('Wall'),
  dimension: msg('Dimension'),
  image: msg('Picture'),
  instance: msg('Instance'),
  parametric: msg('Object'),
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
  room: SquareDashed,
  divider: SeparatorVertical,
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
  const Icon = TYPE_ICONS[node.type]
  return (
    <i className={`type-icon ${node.type}`} title={t(TYPE_LABELS[node.type])}>
      <Icon size={13} />
    </i>
  )
}

/** The name shown for a node that the user has not named. */
export function labelOf(doc: Document, node: Node): string {
  if (node.name) return node.name
  if (node.type === 'text') return node.text
  if (node.type === 'instance') return labelOf(doc, doc.nodes[node.component] ?? node)
  if (node.type === 'parametric') return t(registry.parametric.get(node.kind)?.label ?? node.kind)
  return t(TYPE_LABELS[node.type])
}

export function IconButton(props: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className={`icon-button${props.active ? ' active' : ''}`}
      title={props.title}
      aria-label={props.title}
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
 * none to start from) and `write` is called with each new one. However far the drag goes, it is
 * one step to undo.
 */
export function scrub(read: () => number | null, write: (value: number) => void, step = 1, min = -Infinity) {
  return {
    onPointerDown(e: React.PointerEvent<HTMLInputElement>) {
      const start = read()
      if (!e.altKey || e.button !== 0 || start === null || !Number.isFinite(start)) return
      // No caret and no text selection: this press is a drag on the number.
      e.preventDefault()
      const input = e.currentTarget
      input.blur()
      input.setPointerCapture(e.pointerId)
      const from = e.clientX
      const mark = useStore.getState().past.length
      let last = start
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

export function Field(props: { label: string; value: string | number; numeric?: boolean; length?: boolean; optional?: boolean; step?: number; min?: number; onCommit: (value: any) => void }) {
  // A length is kept in mm and shown in the user's unit; any other number is shown as it is.
  const shown = typeof props.value !== 'number' ? props.value : props.length ? formatNumber(props.value) : String(Math.round(props.value * 100) / 100)
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
  return (
    <label className={`field${props.numeric ? ' numeric' : ''}`}>
      <span>{props.label}</span>
      <input
        value={text}
        title={props.numeric ? t('Hold Alt and drag sideways to change the value') : undefined}
        {...(props.numeric ? scrub(() => (typeof props.value === 'number' ? props.value : null), props.onCommit, props.step ?? (props.length ? LENGTH_STEP : 1), props.min) : {})}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

export function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3>
        {props.title}
        {props.action}
      </h3>
      {props.children}
    </section>
  )
}
