import { useEffect, useRef, useState } from 'react'
import { FileText, Image as Picture, LoaderCircle, PenTool, Ruler, Table2, type LucideIcon } from 'lucide-react'
import { pagesOf, pdfFontCharacters } from '@opencalque/core'
import { exportDxf, exportPdf, exportPng, exportQuantities, exportSvg, PNG_SIZES, type PdfExportStage } from './actions'
import { language, msg, t } from './i18n'
import { preparePdfFonts } from './pdfFonts'
import { registry } from './extensions'
import { apply, useStore } from './store'
import { Field, labelOf } from './ui'
import { useWindows } from './windows'

const close = () => useWindows.setState({ exportOpen: false })

type Format = 'pdf' | 'svg' | 'png' | 'dxf' | 'csv'
const PROGRESS: Record<PdfExportStage, string> = {
  fonts: msg('Preparing PDF fonts…'),
  rendering: msg('Generating PDF…'),
  saving: msg('Saving file…'),
}

/** What a drawing can be exported as: a name, what it is for, and what it takes. */
const FORMATS: [Format, string, string, LucideIcon][] = [
  ['pdf', 'PDF', msg('Sheets at their true size and scale, to print or send'), FileText],
  ['svg', 'SVG', msg('A picture that stays sharp at any size, for the web or a layout program'), PenTool],
  ['png', 'PNG', msg('A picture to send or show, readable everywhere'), Picture],
  ['dxf', 'DXF', msg('Lines, circles and text for other CAD programs'), Ruler],
  ['csv', 'CSV', msg('Quantities for a spreadsheet: room areas, walls, doors and windows'), Table2],
]

/**
 * The one place a drawing is exported from: choose the format, then what goes in it. A PDF is
 * made of papers, one page each; an SVG, a PNG or a DXF holds one page of the drawing.
 */
export function ExportDialog() {
  const open = useWindows((s) => s.exportOpen)
  const doc = useStore((s) => s.doc)
  const page = useStore((s) => s.page)
  const selection = useStore((s) => s.selection)
  const [format, setFormat] = useState<Format>('pdf')
  const [pixels, setPixels] = useState(PNG_SIZES[1])
  const [chosen, setChosen] = useState<string[]>([])
  const [from, setFrom] = useState(page)
  const [progress, setProgress] = useState<PdfExportStage | null>(null)
  const running = useRef<AbortController | null>(null)
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
  // A PDF that needs a font gets it loading now, while the papers are chosen: the Chinese one is large.
  useEffect(() => {
    if (open && format === 'pdf' && papers.length > 0) preparePdfFonts(pdfFontCharacters(doc, registry), language())
  }, [open, format])
  useEffect(() => () => running.current?.abort(), [])

  if (!open) return null
  const ready = format !== 'pdf' || chosen.length > 0
  const exported = doc.nodes[from]
  const height = exported?.type === 'page' ? exported.wallHeight : undefined
  const exporting = progress !== null
  const dismiss = () => {
    running.current?.abort()
    running.current = null
    setProgress(null)
    close()
  }
  const run = async () => {
    if (running.current || !ready) return
    if (format !== 'pdf') {
      close()
      if (format === 'svg') await exportSvg(from)
      else if (format === 'png') await exportPng(from, pixels)
      else if (format === 'dxf') await exportDxf(from)
      else await exportQuantities(from)
      return
    }
    const job = new AbortController()
    running.current = job
    // The clicked button becomes disabled; keep keyboard focus in the dialog so Esc still works.
    box.current?.focus()
    const reportProgress = async (stage: PdfExportStage) => {
      if (job.signal.aborted) return
      setProgress(stage)
      // Let the status paint and process queued Cancel clicks before generating or saving.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    try {
      const saved = await exportPdf(papers.filter((paper) => chosen.includes(paper.id)).map((paper) => paper.id), reportProgress, job.signal)
      if (saved && !job.signal.aborted) close()
    } finally {
      // An older canceled job must not reset a newly started export.
      if (running.current === job) {
        running.current = null
        setProgress(null)
      }
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={dismiss} onKeyDown={(e) => {
      if (running.current || e.key === 'Escape') e.stopPropagation()
      if (e.key === 'Escape') dismiss()
    }}>
      <div className="dialog export" role="dialog" aria-label={t('Export')} tabIndex={-1} ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Export')}</h2>
          <button className="text-button" onClick={dismiss}>
            {t('Cancel')}
          </button>
        </header>
        <div className="export-formats" role="radiogroup" aria-label={t('Format')}>
          {FORMATS.map(([id, name, note, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={id === format} disabled={exporting} className={`welcome-choice${id === format ? ' active' : ''}`} onClick={() => setFormat(id)}>
              <Icon size={20} strokeWidth={1.6} />
              <strong>{name}</strong>
              <span>{t(note)}</span>
            </button>
          ))}
        </div>
        <fieldset className="export-options" disabled={exporting}>
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
          {format === 'png' && (
            <label className="pref-field">
              <span>{t('Size')}</span>
              <select value={pixels} onChange={(e) => setPixels(Number(e.target.value))}>
                {PNG_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t('{n} pixels on its longer side', { n: size })}
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
        </fieldset>
        {progress && (
          <div className="export-progress" role="status" aria-live="polite" aria-atomic="true">
            <span className="export-spinner" aria-hidden="true"><LoaderCircle size={20} /></span>
            <div>
              <strong>{t(PROGRESS[progress])}</strong>
              {progress === 'fonts' && <p>{t('The first PDF export may take longer while fonts download. You can cancel and try again later.')}</p>}
            </div>
          </div>
        )}
        <footer>
          <button className="pill active" disabled={!ready || exporting} onClick={run}>
            {exporting ? t('Exporting…') : t('Export…')}
          </button>
        </footer>
      </div>
    </div>
  )
}
