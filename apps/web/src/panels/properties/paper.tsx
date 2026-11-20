import { paperRescaled, sheetContentOf, sheetContentOps, DEFAULT_PAPER_SCALE, PAPER_FORMATS, PAPER_SERIES, paperFormat, paperSize, type Node, type Op, titleBlockHidden, titleBlockValues, type TitleField } from '@opencalque/core'
import { openComponent } from '../../actions'
import { msg, t } from '../../i18n'
import { apply, useStore } from '../../store'
import { Field, YesNo } from '../../ui'
import type { Update } from './FieldRow'
import { Select } from '../../Select'

/* A paper in the Properties panel: its format and scale, its title block, and what is on every sheet. */

/** What each entry of a title block is called. */
const TITLE_NAMES: Record<TitleField, string> = {
  project: msg('Project'),
  client: msg('Client'),
  address: msg('Address'),
  sheet: msg('Sheet'),
  page: msg('Page'),
  author: msg('Author'),
  scale: msg('Scale'),
  format: msg('Format'),
  date: msg('Date'),
  number: msg('Sheet no.'),
  revisions: msg('Revisions'),
}

/** The entries said once for the whole drawing, and those typed for one sheet; the others are read from the sheet itself. */
const DRAWING_ENTRIES: TitleField[] = ['project', 'client', 'address', 'author']

const SHEET_ENTRIES: TitleField[] = ['sheet', 'page', 'scale', 'format', 'date', 'number', 'revisions']

/**
 * The entries of a paper's title block: a tick for each says whether this sheet shows it, and an
 * entry with nothing in it takes no room whatever its tick. Project, client, address and author
 * belong to the drawing and are the same on all its sheets; date and number belong to the sheet;
 * its name, its page, its scale and its format are read from the sheet as it is.
 */
function TitleBlockEntries({ node }: { node: Extract<Node, { type: 'paper' }> }) {
  const doc = useStore((s) => s.doc)
  const values = titleBlockValues(node, doc)
  const hidden = titleBlockHidden(node)
  const block = node.titleBlock ?? {}
  const setBlock = (next: Record<string, unknown>) => ({ op: 'update_node', id: node.id, patch: { titleBlock: next } }) as Op
  const without = (key: string) => {
    const { [key]: _, ...rest } = block as Record<string, unknown>
    return rest
  }
  const show = (field: TitleField, on: boolean) => apply([setBlock({ ...block, hide: on ? hidden.filter((other) => other !== field) : [...hidden, field] })])
  const write = (field: TitleField, text: string) => {
    const value = text.trim()
    if (DRAWING_ENTRIES.includes(field)) {
      // Said for the drawing; what an older file kept on this one sheet gives way to it.
      apply([{ op: 'set_document', info: { [field]: value || null } }, ...(field in block ? [setBlock(without(field))] : [])])
    } else apply([setBlock(value ? { ...block, [field]: value } : without(field))])
  }
  // What is typed, as against what is shown: fields such as {date} stay as written here.
  const written = (field: TitleField) => ((block as Record<string, unknown>)[field] as string | undefined) ?? (doc.info as Record<string, string> | undefined)?.[field] ?? ''
  const typed = (field: TitleField) => DRAWING_ENTRIES.includes(field) || field === 'date' || field === 'number' || field === 'revisions'
  // Only the strip lists revisions; the drawing says whether its sheets have it.
  const strip = doc.settings?.titleBlock?.layout === 'strip'
  const placeholder: Partial<Record<TitleField, string>> = { project: doc.name, date: '{date}', number: '{page-number} / {pages}' }

  const row = (field: TitleField) => (
    <div key={field} className={`title-entry${hidden.includes(field) ? ' off' : ''}`}>
      <YesNo value={!hidden.includes(field)} title={t('Show it on this sheet')} label={t(TITLE_NAMES[field])} onChange={(on) => show(field, on)} />
      <span>{t(TITLE_NAMES[field])}</span>
      {typed(field) ? (
        field === 'address' || field === 'revisions' ? (
          <textarea key={`${node.id} ${written(field)}`} rows={2} defaultValue={written(field)} onBlur={(e) => e.target.value.trim() !== written(field) && write(field, e.target.value)} />
        ) : (
          <input
            key={`${node.id} ${written(field)}`}
            defaultValue={written(field)}
            placeholder={placeholder[field]}
            onBlur={(e) => e.target.value.trim() !== written(field) && write(field, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )
      ) : (
        <em className={values[field] ? '' : 'faint'}>{values[field] || t('none')}</em>
      )}
    </div>
  )
  return (
    <>
      <h4 className="title-heading">{t('For the whole drawing')}</h4>
      {DRAWING_ENTRIES.map(row)}
      <h4 className="title-heading">{t('For this sheet')}</h4>
      {SHEET_ENTRIES.filter((field) => strip || field !== 'revisions').map(row)}
      {strip && <p className="hint">{t('One revision per line: its mark, its date and what changed, separated by |.')}</p>}
      <p className="hint">{t('An entry left empty takes no room in the block. Write {date} for the day’s date, {page-number} and {pages} for the page and how many there are.')}</p>
    </>
  )
}

/** The sheet a paper stands for: a standard format or a custom size, which way up, and at what drawing scale. Shown under Sheet. */
export function PaperSheet({ node, update }: { node: Extract<Node, { type: 'paper' }>; update: Update }) {
  const doc = useStore((s) => s.doc)
  const common = sheetContentOf(doc)
  // What is on every sheet starts empty, on a sheet the size of this one, and is opened to be drawn.
  const start = () => {
    const at = node.scale ?? DEFAULT_PAPER_SCALE
    const { ops, id } = sheetContentOps({ width: node.width / at, height: node.height / at }, t('On every sheet'))
    if (apply(ops)) openComponent(id)
  }
  const scale = node.scale ?? DEFAULT_PAPER_SCALE
  const format = paperFormat(node)
  const landscape = node.width > node.height
  const resize = (name: string, lying: boolean, at: number) => {
    const size = paperSize(name, lying, at)
    // The sheet keeps its middle, so that what it frames stays in the middle of it.
    update(() => (size ? { ...size, x: node.x + (node.width - size.width) / 2, y: node.y + (node.height - size.height) / 2, scale: at } : { scale: at }))
  }
  return (
    <>
      <label className="field">
        <span>{t('Format')}</span>
        <Select
          value={format?.name ?? ''}
          placeholder={t('Custom')}
          onChange={(name) => resize(name, landscape, scale)}
          options={PAPER_SERIES.map((series) => ({ group: series, options: PAPER_FORMATS.filter((f) => f.series === series).map((f) => ({ value: f.name, label: f.name })) }))}
        />
      </label>
      <label className="field">
        <span>{t('Direction')}</span>
        <Select
          value={landscape ? 'landscape' : 'portrait'}
          onChange={(way) => update(() => ((way === 'landscape') === landscape ? {} : { width: node.height, height: node.width }))}
          options={[
            { value: 'portrait', label: t('Upright') },
            { value: 'landscape', label: t('Lying') },
          ]}
        />
      </label>
      {/* Changing the scale keeps the sheet the sheet it is, as pulling a corner does: it covers more or less of the drawing. */}
      <Field label={t('Scale 1:')} numeric min={1} value={scale} onCommit={(v) => v > 0 && update(() => paperRescaled(node, v))} />
      <p className="hint">{t('A paper moves on its own, over the drawing: put it where it frames what to print. Pulling a corner changes its scale, or its size with Alt. Copying or duplicating it takes along what lies on it.')}</p>
      <div className="field">
        <span>{t('Title block')}</span>
        <YesNo value={node.titleBlock !== undefined} label={t('Title block')} onChange={(on) => update(() => ({ titleBlock: on ? {} : null }))} />
      </div>
      {node.titleBlock && <TitleBlockEntries node={node} />}
      <h4 className="title-heading">{t('On every sheet')}</h4>
      {common ? (
        <>
          <div className="field">
            <span>{t('Show it here')}</span>
            <YesNo value={!node.plain} label={t('Show it here')} onChange={(on) => update(() => ({ plain: on ? null : true }))} />
          </div>
          <button className="text-button" onClick={() => openComponent(common.id)}>
            {t('Edit what is on every sheet…')}
          </button>
        </>
      ) : (
        <button className="text-button" onClick={start}>
          {t('Draw something for every sheet…')}
        </button>
      )}
      <p className="hint">{t('What is drawn there shows on every sheet of the drawing: a title, a logo, a north arrow. It is drawn once, in millimetres of paper, and each sheet shows it at its own scale, each thing in the corner of the sheet it was drawn nearest to. In its texts, fields such as {sheet}, {scale} or {page} say each sheet’s own.')}</p>
    </>
  )
}
