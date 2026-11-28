import { useEffect, useState } from 'react'
import { clockTime, DEFAULT_SITE, northOf, readMoment, rootOf, sunOf, sunPath, siteOf, sunsOf, type NodeOf, type Op, type Site } from '@opencalque/core'
import { t } from '../../i18n'
import { Select } from '../../Select'
import { timeZones } from '../../site'
import { apply, useStore } from '../../store'
import { Field, scrub } from '../../ui'

/*
 * What a sun is set to, in its Properties (ARCHITECTURE, "The sun"): its day and its hour, each typed
 * or dragged with Alt; where it is in the sky then; and where the building is, the drawing's, with
 * which way north is on the page, the page's.
 */

const DAY = 86_400_000

/** A day as a count of days since 1970, and back, for dragging it with Alt. */
const dayNumber = (date: string) => {
  const m = readMoment(date, '00:00')
  return m ? Date.UTC(m.year, m.month - 1, m.day) / DAY : null
}
const dayOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)

/** An hour as typed, read: '15:30', '15h30', '1530', '15'; null when it is not one. */
export function readHour(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:\s*[:h.]\s*(\d{2})?|(\d{2}))?\s*$/i.exec(text)
  if (!m) return null
  const [hours, minutes] = [Number(m[1]), Number(m[2] ?? m[3] ?? 0)]
  return hours <= 23 && minutes <= 59 ? clockTime(hours * 60 + minutes) : null
}

/** A day as typed, read: '2026-06-21', and with one figure for the month or the day; null when it is not one. */
export function readDay(text: string): string | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text)
  if (!m) return null
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const n = dayNumber(date)
  // 2026-02-30 is not a day: it would come back as another.
  return n !== null && dayOf(n) === date ? date : null
}

/** A box for a day or an hour: typed and checked when left, put back as it was when it is not one; dragged with Alt by `step`. */
function MomentField(props: { label: string; value: string; read: (text: string) => string | null; drag: { from: () => number | null; to: (n: number) => string; step: number }; note: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  const commit = () => {
    const value = props.read(text)
    if (value === null) return setText(props.value)
    if (value !== props.value) props.onCommit(value)
    else setText(value)
  }
  return (
    <label className="field numeric">
      <span>{props.label}</span>
      <input
        value={text}
        title={`${props.note}\n${t('Hold Alt and drag sideways to change the value')}`}
        {...scrub(props.drag.from, (n) => props.onCommit(props.drag.to(n)), props.drag.step)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

const minutesOf = (time: string) => readMoment('2000-01-01', time)?.minutes ?? null

/** The day and hour of a sun, where it is in the sky then, and when it rises and sets that day. */
export function SunMoment({ sun }: { sun: NodeOf<'sun'> }) {
  const doc = useStore((s) => s.doc)
  const set = (patch: Record<string, unknown>) => apply([{ op: 'update_node', id: sun.id, patch }])
  const where = sunOf(doc, sun)
  const up = sunPath(siteOf(doc), sun.date, 1).filter((at) => at.sun.altitude > 0)
  const day = up.length === 0 ? t('The sun does not rise on that day.') : up.length >= 1440 ? t('The sun does not set on that day.') : t('Sunrise at {rise}, sunset at {set}.', { rise: clockTime(up[0].minutes), set: clockTime(up[up.length - 1].minutes) })
  return (
    <>
      <MomentField
        label={t('Day')}
        value={sun.date}
        read={readDay}
        note={t('Written year-month-day: 2026-06-21.')}
        drag={{ from: () => dayNumber(sun.date), to: dayOf, step: 1 }}
        onCommit={(date) => set({ date })}
      />
      <MomentField
        label={t('Hour')}
        value={sun.time}
        read={readHour}
        note={t('On the clocks of the site, summer time included.')}
        drag={{ from: () => minutesOf(sun.time), to: (n) => clockTime(Math.max(0, Math.min(1435, n))), step: 5 }}
        onCommit={(time) => set({ time })}
      />
      <Field
        label={t('Shade length')}
        numeric
        suffix="%"
        decimals={0}
        min={25}
        step={5}
        value={Math.round((sun.reach ?? 1) * 100)}
        note={t("How far its shade reaches, as a share of the real sun's at that hour: the sun is drawn lower for more, higher for less, on the plan and in 3D views. At 100%, the real sun.")}
        onCommit={(percent: number) => percent > 0 && set({ reach: Math.abs(percent - 100) < 0.5 ? null : Math.min(400, Math.max(25, percent)) / 100 })}
      />
      <p className="hint">
        {where && where.position.altitude > 0
          ? t('The sun is {altitude}° above the horizon, {azimuth}° from north.', { altitude: where.position.altitude.toFixed(0), azimuth: where.position.azimuth.toFixed(0) })
          : t('The sun is down at that hour.')}{' '}
        {day}
      </p>
      {sun.reach !== undefined && <p className="hint">{t("Its shade is {percent}% as long as the real sun's at that hour.", { percent: String(Math.round(sun.reach * 100)) })}</p>}
      <p className="hint">{t('Drag the sun along its path on the plan to change the hour.')}</p>
    </>
  )
}

/** Degrees typed, with a point or a comma for the decimals. */
const degrees = (text: string) => Number(text.trim().replace(',', '.'))

/** Two numbers typed or pasted from a map, as '48.857, 2.352' or '48.857 2.352'; null when they are not two. */
export function readCoordinates(text: string): [number, number] | null {
  const parts = text.trim().split(/\s*[;,]\s*|\s+/).filter(Boolean)
  // '48,857, 2,352': two numbers each with a comma for its decimals.
  const numbers = parts.length === 4 ? [`${parts[0]}.${parts[1]}`, `${parts[2]}.${parts[3]}`].map(degrees) : parts.map(degrees)
  if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n))) return null
  const [latitude, longitude] = numbers
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? [latitude, longitude] : null
}

/** The time zones, under the part of the world they are in, each by its city. */
function zoneOptions(current: string | undefined) {
  const zones = timeZones()
  const all = current && !zones.includes(current) ? [current, ...zones] : zones
  const groups = new Map<string, { value: string; label: string }[]>()
  for (const zone of all) {
    const [region, ...rest] = zone.split('/')
    const list = groups.get(region) ?? []
    list.push({ value: zone, label: (rest.join(' / ') || region).replace(/_/g, ' ') })
    groups.set(region, list)
  }
  return [...groups].map(([group, options]) => ({ group, options }))
}

/**
 * Where the building stands, for every sun of the drawing: its latitude and longitude, and the time
 * zone of its clocks; and which way north is on the plan of the page `page`.
 */
export function SiteFields({ page }: { page: string | null }) {
  const doc = useStore((s) => s.doc)
  const site = doc.settings?.site
  const shown: Site = site ?? DEFAULT_SITE
  const setSite = (patch: Partial<Site>) => apply([{ op: 'set_document', settings: { site: { ...shown, ...patch } } } as Op])
  const pageNode = page ? rootOf(doc, page) : undefined
  return (
    <>
      <Field
        label={t('Latitude, longitude')}
        value={`${shown.latitude}, ${shown.longitude}`}
        note={t('In degrees, north and east positive: 48.857, 2.352. Paste them from a map.')}
        onCommit={(text: string) => {
          const read = readCoordinates(text)
          if (read) setSite({ latitude: read[0], longitude: read[1] })
        }}
      />
      <div className="field">
        <span>{t('Time zone')}</span>
        <Select aria-label={t('Time zone')} value={shown.timeZone ?? ''} placeholder={t('Of the longitude')} search={t('Find a city or a region…')} options={zoneOptions(shown.timeZone)} onChange={(timeZone) => setSite({ timeZone })} />
      </div>
      {!site && <p className="hint">{t('Not set yet: the sun is taken as seen from Paris.')}</p>}
      {pageNode?.type === 'page' && (
        <Field
          label={t('North')}
          numeric
          suffix="°"
          value={northOf(doc, pageNode.id)}
          note={t("Which way north is on this page's plan, in degrees clockwise from up: 90 when it is to the right.")}
          onCommit={(north: number) => apply([{ op: 'update_node', id: pageNode.id, patch: { north: Math.abs(north % 360) < 1e-9 ? null : ((north % 360) + 360) % 360 } }])}
        />
      )}
      <p className="hint">{sunsOf(doc, pageNode?.id ?? '').length > 1 ? t('Where the building is goes for every sun of the drawing, and north for every sun on this page.') : t('Where the building is goes for the whole drawing, and north for this page.')}</p>
    </>
  )
}
