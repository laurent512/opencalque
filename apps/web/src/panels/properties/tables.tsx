import { useEffect, useState } from 'react'
import { pagesOf, SCHEDULES, settingsOf, tableItems, tableWord, unitless, withUnit, type NodeOf, type Schedule } from '@opencalque/core'
import { SCHEDULE_NAMES, scheduleFields, tableColumns } from '../../actions'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { apply, useStore } from '../../store'
import { YesNo } from '../../ui'

/*
 * What the Properties panel shows of a table of quantities, besides how it is written: what it
 * counts, on which page, its columns, each shown or not and with the words over it, and its rows:
 * all of them, or those chosen among what it counts now.
 */
export function TableSettings({ node }: { node: NodeOf<'table'> }) {
  const doc = useStore((s) => s.doc)
  const set = (patch: Record<string, unknown>) => apply([{ op: 'update_node', id: node.id, patch }])
  const fields = scheduleFields(node.schedule)
  const shown = tableColumns(node)
  // The words the table is drawn with: its own, or else the English ones the core gives it, with the
  // unit it writes in. Changed, they say "{unit}" again where that unit was, to keep following the drawing.
  const system = node.system ?? settingsOf(doc).system
  const labels: Record<string, string> = Object.fromEntries(fields.map((field) => [field, node.labels?.[field] !== undefined ? withUnit(node.labels[field], field, system) : tableWord(field, system)]))
  const pages = pagesOf(doc)
  /** Another kind of table: its usual columns, all its rows, and its usual title when the table had the usual one of its kind. */
  const schedule = (next: Schedule) => {
    const usual = (SCHEDULES as readonly string[]).includes(node.schedule) && node.title === t(SCHEDULE_NAMES[node.schedule as Schedule])
    set({ schedule: next, columns: null, only: null, ...(usual || !node.title ? { title: t(SCHEDULE_NAMES[next]) } : {}) })
  }
  // What it could list, and which of those it does: choosing starts from every one, to be taken away from.
  const items = tableItems(node, doc, registry)
  const only = node.only
  const pick = (key: string, on: boolean) => set({ only: items.map((item) => item.key).filter((k) => (k === key ? on : only!.includes(k))) })
  /** A column shown or left out, in the order the kind of table lists them. */
  const toggle = (field: string, on: boolean) => set({ columns: fields.filter((f) => (f === field ? on : shown.includes(f))) })
  return (
    <>
      <label className="field">
        <span>{t('Counts')}</span>
        <select value={node.schedule} onChange={(e) => schedule(e.target.value as Schedule)}>
          {!(SCHEDULES as readonly string[]).includes(node.schedule) && <option value={node.schedule}>{node.schedule}</option>}
          {SCHEDULES.map((one) => (
            <option key={one} value={one}>
              {t(SCHEDULE_NAMES[one])}
            </option>
          ))}
        </select>
      </label>
      {pages.length > 1 && (
        <label className="field">
          <span>{t('On the page')}</span>
          <select value={node.source && doc.nodes[node.source]?.type === 'page' ? node.source : ''} onChange={(e) => set({ source: e.target.value || null })}>
            <option value="">{t('This page')}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name ?? page.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {fields.length > 0 && (
        <div className="table-columns">
          <span className="faint">{t('Columns')}</span>
          {fields.map((field) => (
            <div key={field} className="type-prop">
              <YesNo value={shown.includes(field)} label={labels[field] ?? field} onChange={(on) => toggle(field, on)} />
              <Heading value={labels[field] ?? field} onCommit={(text) => set({ labels: { ...node.labels, [field]: unitless(text, field, system) } })} />
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="table-columns">
          <div className="field">
            <span>{t('Rows shown')}</span>
            <YesNo value={only === undefined} label={t('Rows shown')} words={[t('All'), t('Chosen')]} onChange={(all) => set({ only: all ? null : items.map((item) => item.key) })} />
          </div>
          {only !== undefined &&
            items.map((item) => (
              <div key={item.key} className="type-prop">
                <YesNo value={only.includes(item.key)} label={item.label} onChange={(on) => pick(item.key, on)} />
                <span className="row-name">{item.label}</span>
              </div>
            ))}
        </div>
      )}
      <p className="hint">{t('It counts what is on its page and changes with it. Its words stay as they were written: change them here.')}</p>
    </>
  )
}

/** The words over a column, kept once typed: when the field is left, or on Enter. */
function Heading({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => text !== value && onCommit(text)
  return <input className="column-heading" value={text} aria-label={t('Heading')} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
}
