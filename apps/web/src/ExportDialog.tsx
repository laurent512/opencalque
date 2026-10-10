import { useEffect, useRef, useState } from 'react'
import { FileText, PenTool, Ruler, Table2, type LucideIcon } from 'lucide-react'
import { pagesOf } from '@opencalque/core'
import { exportDxf, exportPdf, exportQuantities, exportSvg } from './actions'
import { msg, t } from './i18n'
import { apply, useStore } from './store'
import { Field, labelOf } from './ui'

const close = () => useStore.setState({ exportOpen: false })

type Format = 'pdf' | 'svg' | 'dxf' | 'csv'

/** What a drawing can be exported as: a name, what it is for, and what it takes. */
const FORMATS: [Format, string, string, LucideIcon][] = [
  ['pdf', 'PDF', msg('Sheets at their true size and scale, to print or send'), FileText],
  ['svg', 'SVG', msg('A picture that stays sharp at any size, for the web or a layout program'), PenTool],
  ['dxf', 'DXF', msg('Lines, circles and text for other CAD programs'), Ruler],
  ['csv', 'CSV', msg('Quantities for a spreadsheet: room areas, walls, doors and windows'), Table2],
]

/**
 * The one place a drawing is exported from: choose the format, then what goes in it. A PDF is
 * made of papers, one page each; an SVG or a DXF holds one page of the drawing.
 */
export function ExportDialog() {
  const open = useStore((s) => s.exportOpen)
  const doc = useStore((s) => s.doc)
  const page = useStore((s) => s.page)
  const selection = useStore((s) => s.selection)
  const [format, setFormat] = useState<Format>('pdf')
  const [chosen, setChosen] = useState<string[]>([])
  const [from, setFrom] = useState(page)
  const box = useRef<HTMLDivElement>(null)

  const pages = pagesOf(doc)
  const papers = pages.flatMap((p) => Object.values(doc.nodes).filter((node) => node.type === 'paper' && node.parent === p.id))
  // Opened afresh each time: the papers that are selected, or all of them, and the page in view.
  useEffect(() => {
    if (!open) return
    const picked = papers.filter((paper) => selection.includes(paper.id)).map((paper) => paper.id)
    setChosen(picked.length > 0 ? picked : papers.map((paper) => paper.id))
    setFrom(page)
    box.current?.focus()
  }, [open])

  if (!open) return null
  const ready = format !== 'pdf' || chosen.length > 0
  const exported = doc.nodes[from]
  const height = exported?.type === 'page' ? exported.wallHeight : undefined
  const run = async () => {
    close()
    if (format === 'pdf') await exportPdf(papers.filter((paper) => chosen.includes(paper.id)).map((paper) => paper.id))
    else if (format === 'svg') await exportSvg(from)
    else if (format === 'dxf') await exportDxf(from)
    else await exportQuantities(from)
  }

  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog export" role="dialog" aria-label={t('Export')} tabIndex={-1} ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Export')}</h2>
          <button className="text-button" onClick={close}>
            {t('Cancel')}
          </button>
        </header>
        <div className="export-formats" role="radiogroup" aria-label={t('Format')}>
          {FORMATS.map(([id, name, note, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={id === format} className={`welcome-choice${id === format ? ' active' : ''}`} onClick={() => setFormat(id)}>
              <Icon size={20} strokeWidth={1.6} />
              <strong>{name}</strong>
              <span>{t(note)}</span>
            </button>
          ))}
        </div>
        <div className="export-options">
          {format === 'pdf' ? (
            papers.length === 0 ? (
              <p className="hint">{t('Add a paper first (F): it sets the size and the scale of the printed sheet.')}</p>
            ) : (
              <>
                <h3>
                  {t('Sheets')}
                  <button className="text-button" onClick={() => setChosen(chosen.length === papers.length ? [] : papers.map((paper) => paper.id))}>
                    {chosen.length === papers.length ? t('Untick all') : t('Tick all')}
                  </button>
                </h3>
                {papers.map((paper) => (
                  <label key={paper.id} className="pref-row">
                    <input type="checkbox" checked={chosen.includes(paper.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, paper.id] : chosen.filter((id) => id !== paper.id))} />
                    {labelOf(doc, paper)}
                    <span className="faint">
                      1:{paper.type === 'paper' ? (paper.scale ?? 100) : ''}
                      {pages.length > 1 && paper.parent ? ` · ${labelOf(doc, doc.nodes[paper.parent])}` : ''}
                    </span>
                  </label>
                ))}
              </>
            )
          ) : (
            <label className="pref-field">
              <span>{t('Page')}</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {labelOf(doc, p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {format === 'dxf' && <p className="hint">{t('Fills, line weights and pictures are not carried over to a DXF.')}</p>}
          {format === 'csv' && (
            <>
              {/* Kept on the page: it is asked once, and a wall that stands higher or lower says so itself. */}
              <Field
                label={t('Wall height')}
                numeric
                length
                optional
                min={1}
                value={height ?? ''}
                placeholder={t('not given')}
                onCommit={(value: number | undefined) => apply([{ op: 'update_node', id: from, patch: { wallHeight: value && value > 0 ? value : null } }])}
              />
              <p className="hint">
                {height
                  ? t('Each wall is measured along its middle line. The area of its face is its length by this height, less its doors and windows.')
                  : t('Without a height, walls are given by their length and the ground they stand on. Give one to get the area of their faces, less doors and windows.')}
              </p>
            </>
          )}
        </div>
        <footer>
          <button className="pill active" disabled={!ready} onClick={run}>
            {t('Export…')}
          </button>
        </footer>
      </div>
    </div>
  )
}
