import { drawingSettingsOps, settingsOf, type DrawingSettings } from '@opencalque/core'
import { msg, t } from './i18n'
import { apply, useStore } from './store'
import { useWindows } from './windows'

const close = () => useWindows.setState({ drawingSettingsOpen: false })

/** What the drawing says about itself, shown in the title block of every sheet. */
const INFO: [field: 'project' | 'client' | 'address' | 'author', label: string][] = [
  ['project', msg('Project')],
  ['client', msg('Client')],
  ['address', msg('Address')],
  ['author', msg('Author')],
]

/**
 * What belongs to the drawing rather than to one object or to the user: how it writes its numbers
 * (the areas of its rooms, its tables of quantities, its dimensions and the CSV export) and what it
 * says about itself in title blocks. A setting changed here is taken by everything in the drawing,
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
            <select value={settings.system} onChange={(e) => set({ system: e.target.value as 'metric' | 'imperial' })}>
              <option value="metric">{t('Metric: m², m')}</option>
              <option value="imperial">{t('Imperial: ft², ft')}</option>
            </select>
          </label>
          <label className="pref-field">
            <span>{t('Decimal mark')}</span>
            <select value={settings.decimal} onChange={(e) => set({ decimal: e.target.value as '.' | ',' })}>
              <option value=".">{t('With a point: 1.5')}</option>
              <option value=",">{t('With a comma: 1,5')}</option>
            </select>
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
          <p className="hint">{t('Shown in the title block of every sheet, and where a text says {project}, {client}, {address} or {author}.')}</p>
        </section>
      </div>
    </div>
  )
}
