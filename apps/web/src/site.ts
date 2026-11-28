import { clockTime, sunAt, type Site } from '@opencalque/core'
import { ZONE_PLACES } from './zones'

/*
 * Where a drawing's building is, as the editor first guesses it, and the moment a new sun is put at
 * (ARCHITECTURE, "The sun").
 */

/** The time zone of this computer, as IANA names it ('Europe/Paris'); null when the browser does not say. */
export function computerZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** Every time zone the browser knows, by name: what a site's zone is picked among. */
export function timeZones(): string[] {
  const listed = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return listed.length > 0 ? listed : Object.keys(ZONE_PLACES)
}

/**
 * Where the building is most likely to be when a drawing does not say: the main place of the
 * computer's time zone, which the person then corrects. Null when the zone is not known.
 */
export function guessedSite(): Site | null {
  const zone = computerZone()
  const place = zone ? ZONE_PLACES[zone] : undefined
  return zone && place ? { latitude: place[0], longitude: place[1], timeZone: zone } : null
}

/** Today on this computer's calendar, as 'YYYY-MM-DD'. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The moment a new sun shows: today, at the hour it is now to the quarter, or at 3 pm if the sun is down then. */
export function newSunMoment(site: Site): { date: string; time: string } {
  const now = new Date()
  const date = today()
  const time = clockTime(Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15)
  return { date, time: (sunAt(site, date, time)?.altitude ?? 0) > 0 ? time : '15:00' }
}
