import { MOST_ROWS, propsInPlace, resolveParams, rowsOf, type Document, type Node, type ParamDef, type ParamRow } from '@opencalque/core'
import { GripVertical, Plus, X } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { t } from '../../i18n'
import { registry } from '../../extensions'
import { Select } from '../../Select'
import { Field, IconButton } from '../../ui'
import { formatLength } from '../../units'
import { paramOptions, type FieldSpec } from './fields'

/*
 * A list parameter of a parametric object in the Properties panel (`ParamDef` of type 'list'): one
 * line for each row, its fields side by side under their names, dragged by its grip to another
 * place and taken out by its cross; one more added by the + at the end of the names, at the end of
 * the list. A list of rows that stand one over the other (`upward`: a tall unit's sections) shows
 * them as they stand, the top one first, so a row added there is on top. A field the kind works out
 * for a row (`auto`: a filler's height) is shown as it is laid out (`laid`), not to be typed; when
 * the row stops being so, it keeps that value, unless the choice made says what it becomes (`sets`:
 * a section chosen is made its usual height). A row of its own (`toggle`: a tall unit's filler) is
 * put in by a link under the list, shown only while there is none, and is moved and taken out as the
 * others are, what makes it so said rather than chosen. A list with no rows of its own shows those it stands for (`emptyAs`), and
 * the first change makes them its own.
 */

/** What a dragged row carries: only rows of a list are dropped among them. */
const LIST_ROW = 'application/x-opencalque-list-row'

/** How wide each field of a row is: a choice takes what the others leave, a length a number with its unit, any other number a short one. */
const widthOf = (item: ParamDef) => (item.type === 'string' && item.options ? 'minmax(0, 1fr)' : item.type === 'number' ? (item.unit === 'length' ? '78px' : '44px') : 'auto')

export function ListField({ node, doc, field, mixed, commit }: { node: Node; doc: Document; field: FieldSpec; mixed: boolean; commit: (rows: ParamRow[]) => void }) {
  const param = field.list!
  // The row whose grip is held, which only then can be dragged (its fields stay to type and pick in), and where it would go.
  const [held, setHeld] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const kind = node.type === 'parametric' ? registry.parametric.get(node.kind) : undefined
  if (!kind || node.type !== 'parametric') return null
  // As it stands where it is: a unit up to the ceiling as high as its wall.
  const props = propsInPlace(doc, node, registry)
  const rows = rowsOf(param, props)
  const laid = param.laid?.(props) ?? rows
  const items = param.items ?? []
  const most = Math.max(0, param.most ?? MOST_ROWS)
  const upward = !!param.upward
  // The rows by their place in the list as it is shown: the indexes of the rows, the top one first for rows that stand.
  const shown = rows.map((_, i) => i)
  if (upward) shown.reverse()
  const columns = `12px ${items.map(widthOf).join(' ')} 20px`
  // The row a link puts in (a tall unit's filler): at most one, its choice not offered for the others.
  const toggle = param.toggle
  const toggled = (row: ParamRow) => !!toggle && Object.entries(toggle.row).every(([key, value]) => row[key] === value)
  const on = rows.some(toggled)
  const change = (i: number, key: string, value: ParamRow[string]) => {
    const next: ParamRow = { ...rows[i], [key]: value }
    // What was worked out and no longer is keeps the value it had, or its default when that was nothing.
    for (const item of items) {
      const was = laid[i]?.[item.key]
      if (item.auto?.(rows[i]) && !item.auto(next)) next[item.key] = typeof was === 'number' && was > 0 ? was : (item.default as ParamRow[string])
    }
    // A choice made gives the row what goes with it: another section its usual height.
    const chosen = items.find((item) => item.key === key)
    if (chosen?.sets && typeof value === 'string' && value !== rows[i][key]) Object.assign(next, chosen.sets(value))
    commit(rows.map((row, j) => (j === i ? next : row)))
  }
  /** The row `from` put before the one shown at `at` (after the last when `at` is their count). */
  const move = (from: number, at: number) => {
    const before = shown.slice(0, at).filter((i) => i !== from).length
    const rest = shown.filter((i) => i !== from)
    rest.splice(before, 0, from)
    if (upward) rest.reverse()
    if (rest.some((i, k) => i !== k)) commit(rest.map((i) => rows[i]))
  }
  /**
   * Where a row dragged over the list would go: before the first row whose middle is under the
   * pointer, else after the last. Anywhere over the list, between its rows or over their fields, so
   * that the pointer never says it cannot be dropped there.
   */
  const over = (e: DragEvent<HTMLDivElement>) => {
    if (held === null || !e.dataTransfer.types.includes(LIST_ROW)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const middles = [...e.currentTarget.querySelectorAll('.list-row')].map((row) => {
      const box = row.getBoundingClientRect()
      return box.top + box.height / 2
    })
    const at = middles.findIndex((middle) => e.clientY < middle)
    setDropAt(at < 0 ? middles.length : at)
  }
  const end = () => {
    setHeld(null)
    setDropAt(null)
  }
  return (
    <div
      className="list-field"
      role="group"
      aria-label={t(field.label)}
      onDragOver={over}
      // Entering each row, box or button within it is asked too: unanswered, the pointer said for a moment that it could not be dropped.
      onDragEnter={(e) => {
        if (held === null || !e.dataTransfer.types.includes(LIST_ROW)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Element | null) && setDropAt(null)}
      onDrop={(e) => {
        if (held === null || dropAt === null || !e.dataTransfer.types.includes(LIST_ROW)) return
        e.preventDefault()
        move(held, dropAt)
        end()
      }}
    >
      {mixed && <p className="hint">{t('Mixed')}</p>}
      <div className="list-head" style={{ gridTemplateColumns: columns }}>
        <span />
        {items.map((item) => (
          <span key={item.key} title={t(item.label)} aria-hidden="true">
            {t(item.label)}
          </span>
        ))}
        <IconButton title={param.adding ? t(param.adding) : t('Add')} disabled={rows.length >= most} onClick={() => commit([...rows, resolveParams(items, {}) as ParamRow])}>
          <Plus size={13} />
        </IconButton>
      </div>
      <div className="list-rows">
        {shown.map((i, at) => {
          const row = rows[i]
          const line = dropAt === at ? ' drop-before' : dropAt === shown.length && at === shown.length - 1 ? ' drop-after' : ''
          return (
            <div
              key={i}
              className={`list-row${held === i ? ' dragged' : ''}${line}`}
              style={{ gridTemplateColumns: columns }}
              draggable={held === i}
              onDragStart={(e) => {
                e.dataTransfer.setData(LIST_ROW, String(i))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={end}
            >
              <span className="list-grip" title={t('Drag to move it')} onPointerDown={() => setHeld(i)} onPointerUp={() => setHeld(null)}>
                <GripVertical size={13} />
              </span>
              {items.map((item) =>
                !(item.shown?.(row) ?? true) ? (
                  <span key={item.key} />
                ) : toggled(row) && item.key in toggle!.row ? (
                  // What the switch made it is said, not chosen.
                  <span key={item.key} className="list-fixed">
                    {t(paramOptions(item)?.find((option) => option.value === row[item.key])?.label ?? String(row[item.key]))}
                  </span>
                ) : item.auto?.(row) ? (
                  <span key={item.key} className="list-auto" title={t('What the others leave')}>
                    {item.unit === 'length' ? formatLength(Number(laid[i]?.[item.key]) || 0) : String(laid[i]?.[item.key] ?? '')}
                  </span>
                ) : (
                  <RowField key={item.key} item={item} value={row[item.key]} exclude={toggle && item.key in toggle.row ? [String(toggle.row[item.key])] : []} onChange={(value) => change(i, item.key, value)} />
                ),
              )}
              {/* The last row stays: with none, the list would stand for others again. */}
              <IconButton title={t('Remove')} disabled={rows.length <= 1} onClick={() => commit(rows.filter((_, j) => j !== i))}>
                <X size={12} />
              </IconButton>
            </div>
          )
        })}
      </div>
      {toggle && !on && rows.length < most && (
        // Put on top of what stands; dragged from there to any place.
        <button type="button" className="list-add-link" onClick={() => commit([...rows, resolveParams(items, toggle.row) as ParamRow])}>
          {t(toggle.label)}
        </button>
      )}
    </div>
  )
}

/** One field of a row, named by the heading over it: a choice (but those of `exclude`), a number (a length in the user's unit), or yes or no. */
function RowField({ item, value, exclude, onChange }: { item: ParamDef; value: ParamRow[string] | undefined; exclude: string[]; onChange: (value: ParamRow[string]) => void }) {
  if (item.type === 'string' && item.options) {
    const options = paramOptions(item)!.filter((option) => !exclude.includes(option.value))
    return <Select aria-label={t(item.label)} value={String(value ?? item.default)} onChange={(chosen) => chosen && onChange(chosen)} options={options.map((option) => ({ value: option.value, label: t(option.label) }))} />
  }
  if (item.type === 'boolean') return <input type="checkbox" aria-label={t(item.label)} title={t(item.label)} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  return (
    <Field
      label={t(item.label)}
      numeric={item.type === 'number'}
      length={item.unit === 'length'}
      min={item.type === 'number' ? 0 : undefined}
      value={(value as string | number | undefined) ?? ''}
      onCommit={(next) => onChange(next ?? (item.type === 'number' ? 0 : ''))}
    />
  )
}
