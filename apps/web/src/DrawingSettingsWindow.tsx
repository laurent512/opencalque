import { drawingSettingsOps, GRID_DIVISIONS, settingsOf, TITLE_FIELDS, type DrawingSettings, type TitleField } from '@opencalque/core'
import { msg, t } from './i18n'
import { usePrefs } from './prefs'
import { apply, useStore } from './store'
import { formatLength, imperialUnit, parseLength, parseNumber } from './units'
import type { GridSetting } from './view'
import { useWindows } from './windows'
import { Select } from './Select'

const close = () => useWindows.setState({ drawingSettingsOpen: false })

/** What the drawing says about itself, shown in the title block of every sheet. */
const INFO: [field: 'project' | 'client' | 'address' | 'author', label: string][] = [
  ['project', msg('Project')],
  ['client', msg('Client')],
  ['address', msg('Address')],
  ['author', msg('Author')],
]

/** What the strip down the right edge calls each entry on the sheet, in the usual words of US sheets: "Drawn by" for the author. */
const STRIP_CAPTIONS: Record<TitleField, string> = {
  project: msg('Project'),
  client: msg('Client'),
  address: msg('Address'),
  sheet: msg('Sheet title'),
  page: msg('Page'),
  author: msg('Drawn by'),
  scale: msg('Scale'),
  format: msg('Format'),
  date: msg('Date'),
  number: msg('Sheet no.'),
  revisions: msg('Revisions'),
}

/** The captions the strip is given when it is chosen, in the language in use: the drawing keeps them, as a table keeps its words. */
const stripLabels = (): Record<string, string> => Object.fromEntries(TITLE_FIELDS.map((field) => [field, t(STRIP_CAPTIONS[field])]))

/** The grid a drawing is given when its spacing is first fixed: a metre in tenths, or a foot in inches. */
const firstGrid = (): GridSetting => (imperialUnit() ? { spacing: 304.8, divisions: 12 } : { spacing: 1000, divisions: 10 })

/** Sets the drawing's grid, or with null gives it back to the zoom. */
const setGrid = (grid: GridSetting | null) => apply([{ op: 'set_document', settings: { grid } }])

/**
 * The grid the drawing is shown and snapped on: changing with the zoom (stored as nothing), or main
 * lines a length apart, each square divided into a number of finer ones, as a module of 910 mm
 * halved is drawn on. A length or a count that cannot be one is put back as it was.
 */
function GridSettings({ grid }: { grid: GridSetting | undefined }) {
  usePrefs((prefs) => prefs.unit)
  const divisions = grid?.divisions ?? 1
  return (
    <section>
      <h3>{t('Grid')}</h3>
      <label className="pref-field">
        <span>{t('Spacing')}</span>
        <Select
          value={grid ? 'fixed' : 'zoom'}
          onChange={(value) => setGrid(value === 'fixed' ? firstGrid() : null)}
          options={[
            { value: 'zoom', label: t('Changes with the zoom') },
            { value: 'fixed', label: t('Always the same') },
          ]}
        />
      </label>
      {grid && (
        <>
          <label className="pref-field">
            <span>{t('Main lines every')}</span>
            <input
              key={`spacing ${grid.spacing} ${formatLength(grid.spacing)}`}
              defaultValue={formatLength(grid.spacing)}
              onBlur={(e) => {
                const spacing = parseLength(e.target.value)
                if (spacing !== null && Number.isFinite(spacing) && spacing > 0 && spacing !== grid.spacing) setGrid({ ...grid, spacing })
                else e.target.value = formatLength(grid.spacing)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
          <label className="pref-field">
            <span>{t('Divided into')}</span>
            <input
              key={`divisions ${divisions}`}
              inputMode="numeric"
              defaultValue={String(divisions)}
              onBlur={(e) => {
                const count = Math.round(parseNumber(e.target.value))
                if (Number.isFinite(count) && count >= 1 && count <= GRID_DIVISIONS && count !== divisions) setGrid({ spacing: grid.spacing, ...(count > 1 ? { divisions: count } : {}) })
                else e.target.value = String(divisions)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </>
      )}
      <p className="hint">
        {grid && divisions > 1
          ? t('Finer lines every {length}. Drawing, moving and snapping go by them; zoomed out, only the main lines show.', { length: formatLength(grid.spacing / divisions) })
          : grid
            ? t('Drawing, moving and snapping go by the main lines.')
            : t('The lines get finer as you zoom in, every tenth one darker.')}
      </p>
    </section>
  )
}

/**
 * What belongs to the drawing rather than to one object or to the user: how it writes its numbers
 * (the areas of its rooms, its tables of quantities, its dimensions and the CSV export), what it
 * says about itself in title blocks, how the title blocks of all its sheets are laid out, and the
 * grid it is drawn on. A setting changed here is taken by everything in the drawing,
 * which stops writing its numbers its own way (`drawingSettingsOps`), in one step to undo.
 */
export function DrawingSettingsWindow() {
  const open = useWindows((s) => s.drawingSettingsOpen)
  const doc = useStore((s) => s.doc)
  if (!open) return null
  const settings = settingsOf(doc)
  const set = (next: DrawingSettings) => apply(drawingSettingsOps(doc, next))
  const info = (field: (typeof INFO)[number][0]) => doc.info?.[field] ?? ''
  const write = (field: (typeof INFO)[number][0], text: string) => text.trim() !== info(field) && apply([{ op: 'set_document', info: { [field]: text.trim() || null } }])
  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog drawing-settings" role="dialog" aria-label={t('Drawing settings')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Drawing settings')}</h2>
          <button className="text-button" onClick={close}>
            {t('Done')}
          </button>
        </header>
        <section>
          <h3>{t('Numbers')}</h3>
          <label className="pref-field">
            <span>{t('Units')}</span>
            <Select
              value={settings.system}
              onChange={(system) => set({ system: system as 'metric' | 'imperial' })}
              options={[
                { value: 'metric', label: t('Metric: m², m') },
                { value: 'imperial', label: t('Imperial: ft², ft') },
              ]}
            />
          </label>
          <label className="pref-field">
            <span>{t('Decimal mark')}</span>
            <Select
              value={settings.decimal}
              onChange={(decimal) => set({ decimal: decimal as '.' | ',' })}
              options={[
                { value: '.', label: t('With a point: 1.5') },
                { value: ',', label: t('With a comma: 1,5') },
              ]}
            />
          </label>
          <p className="hint">{t('The areas of the rooms, the tables of quantities, the dimensions and the quantities exported are written so, everywhere in this drawing. Lengths in the panels are in the unit of the preferences.')}</p>
        </section>
        <section>
          <h3>{t('Project')}</h3>
          {INFO.map(([field, label]) => (
            <label key={field} className="pref-field">
              <span>{t(label)}</span>
              {field === 'address' ? (
                <textarea key={`${doc.id} ${info(field)}`} rows={2} defaultValue={info(field)} onBlur={(e) => write(field, e.target.value)} />
              ) : (
                <input
                  key={`${doc.id} ${info(field)}`}
                  defaultValue={info(field)}
                  placeholder={field === 'project' ? doc.name : undefined}
                  onBlur={(e) => write(field, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              )}
            </label>
          ))}
          <label className="pref-field">
            <span>{t('Title block')}</span>
            <Select
              value={doc.settings?.titleBlock?.layout ?? 'corner'}
              onChange={(layout) => set({ titleBlock: layout === 'strip' ? { layout: 'strip', labels: stripLabels() } : {} })}
              options={[
                { value: 'corner', label: t('In the bottom right corner') },
                { value: 'strip', label: t('Down the right edge, with captions') },
              ]}
            />
          </label>
          <p className="hint">{t('Shown in the title block of every sheet, and where a text says {project}, {client}, {address} or {author}.')}</p>
        </section>
        <GridSettings key={doc.id} grid={doc.settings?.grid} />
      </div>
    </div>
  )
}
