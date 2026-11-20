import { drawingSettingsOps, settingsOf, TITLE_FIELDS, type DrawingSettings, type TitleField } from '@opencalque/core'
import { msg, t } from './i18n'
import { apply, useStore } from './store'
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

/**
 * What belongs to the drawing rather than to one object or to the user: how it writes its numbers
 * (the areas of its rooms, its tables of quantities, its dimensions and the CSV export), what it
 * says about itself in title blocks, and how the title blocks of all its sheets are laid out. A setting changed here is taken by everything in the drawing,
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
      </div>
    </div>
  )
}
