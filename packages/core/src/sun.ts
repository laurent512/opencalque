import type { Vec2 } from './geometry'

/**
 * Where the sun is in the sky, seen from where the building stands, and the way it lies on a plan.
 *
 * Pure arithmetic, after NOAA's solar calculator (Meeus' formulas, about 0.01° from 1800 to 2100,
 * far finer than a plan needs). The only thing taken from the host is `Intl`, for the clock of a
 * time zone; without it, or for a zone it does not know, the clock is that of the longitude.
 */

/** Where the building is: latitude and longitude in degrees (north and east positive), and the time zone of its clocks. */
export interface Site {
  latitude: number
  longitude: number
  /** An IANA zone ('Europe/Paris'), whose clocks change with summer time. Left out, the hour of the longitude, 15° an hour. */
  timeZone?: string
}

/** Where the sun is: `azimuth` in degrees from true north, clockwise (east 90, south 180); `altitude` in degrees above the horizon, as seen through the air. */
export interface SunPosition {
  azimuth: number
  altitude: number
}

const RAD = Math.PI / 180
const sin = (deg: number) => Math.sin(deg * RAD)
const cos = (deg: number) => Math.cos(deg * RAD)
const DAY = 86_400_000

/** Where the sun is at an instant (milliseconds since 1970 UTC), seen from a latitude and longitude. */
export function sunPosition(latitude: number, longitude: number, instant: number): SunPosition {
  const julian = instant / DAY + 2440587.5
  const t = (julian - 2451545) / 36525
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const centre = sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * anomaly) * (0.019993 - 0.000101 * t) + sin(3 * anomaly) * 0.000289
  const omega = 125.04 - 1934.136 * t
  const apparent = meanLongitude + centre - 0.00569 - 0.00478 * sin(omega)
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * cos(omega)
  const declination = Math.asin(sin(obliquity) * sin(apparent)) / RAD
  const y = Math.tan((obliquity / 2) * RAD) ** 2
  const L = meanLongitude * RAD
  const M = anomaly * RAD
  // How far the sun's clock runs ahead of a steady one, in minutes.
  const equationOfTime =
    (4 / RAD) * (y * Math.sin(2 * L) - 2 * eccentricity * Math.sin(M) + 4 * eccentricity * y * Math.sin(M) * Math.cos(2 * L) - 0.5 * y * y * Math.sin(4 * L) - 1.25 * eccentricity * eccentricity * Math.sin(2 * M))
  const minutes = (((instant % DAY) + DAY) % DAY) / 60_000
  const solarTime = (((minutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440
  const hourAngle = solarTime / 4 - 180
  const cosZenith = Math.min(1, Math.max(-1, sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hourAngle)))
  const elevation = 90 - Math.acos(cosZenith) / RAD
  const azimuth = Math.atan2(sin(hourAngle), cos(hourAngle) * sin(latitude) - Math.tan(declination * RAD) * cos(latitude)) / RAD + 180
  return { azimuth: ((azimuth % 360) + 360) % 360, altitude: elevation + refraction(elevation) }
}

/** How much higher the air makes the sun look than it is, in degrees (NOAA's approximation). */
function refraction(elevation: number): number {
  if (elevation > 85) return 0
  const t = Math.tan(elevation * RAD)
  const seconds =
    elevation > 5 ? 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5 : elevation > -0.575 ? 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711))) : -20.772 / t
  return seconds / 3600
}

const clocks = new Map<string, Intl.DateTimeFormat | null>()

/** The clock of a time zone, or null when the host does not know it. */
function clockOf(zone: string): Intl.DateTimeFormat | null {
  if (!clocks.has(zone)) {
    let clock: Intl.DateTimeFormat | null = null
    try {
      clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    } catch {
      clock = null
    }
    clocks.set(zone, clock)
  }
  return clocks.get(zone) ?? null
}

/** Whether `zone` is a time zone the host knows ('Europe/Paris'). */
export function knownTimeZone(zone: string): boolean {
  return clockOf(zone) !== null
}

/** How far the site's clocks are ahead of UTC at an instant, in minutes. */
export function siteOffset(site: Site, instant: number): number {
  const clock = site.timeZone ? clockOf(site.timeZone) : null
  if (!clock) return Math.round(site.longitude / 15) * 60
  const parts = Object.fromEntries(clock.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
  return Math.round((shown - Math.floor(instant / 1000) * 1000) / 60_000)
}

/** A day written as 'YYYY-MM-DD' and an hour as 'HH:MM', read; null when either is not one. */
export function readMoment(date: string, time: string): { year: number; month: number; day: number; minutes: number } | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const h = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!d || !h) return null
  const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(h[1]), Number(h[2])]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59) return null
  return { year, month, day, minutes: hour * 60 + minute }
}

/** The instant the site's clocks show `minutes` after midnight on a day, summer time included; null for a day that is not one. */
export function siteInstant(site: Site, date: string, minutes: number): number | null {
  const moment = readMoment(date, '00:00')
  if (!moment) return null
  const shown = Date.UTC(moment.year, moment.month - 1, moment.day) + minutes * 60_000
  // The offset depends on the instant it is asked at: twice is enough, except in the hour a clock skips.
  let instant = shown - siteOffset(site, shown) * 60_000
  instant = shown - siteOffset(site, instant) * 60_000
  return instant
}

/** Where the sun is at the site when its clocks show `time` ('HH:MM') on `date` ('YYYY-MM-DD'); null for a moment that is not one. */
export function sunAt(site: Site, date: string, time: string): SunPosition | null {
  const moment = readMoment(date, time)
  if (!moment) return null
  const instant = siteInstant(site, date, moment.minutes)
  return instant === null ? null : sunPosition(site.latitude, site.longitude, instant)
}

/**
 * The way to the sun on a plan whose true north is `north` degrees clockwise from up (0: north is
 * up), as a unit vector, Y down: the light comes from there, shadows fall the other way.
 */
export function towardsSun(azimuth: number, north = 0): Vec2 {
  const angle = (north + azimuth) * RAD
  return { x: Math.sin(angle), y: -Math.cos(angle) }
}

/** How far a shadow reaches on level ground for each unit of height, with the sun `altitude` degrees up. Infinity at the horizon and below. */
export function shadowReach(altitude: number): number {
  return altitude <= 0 ? Infinity : 1 / Math.tan(altitude * RAD)
}

/** The sun's place every `step` minutes of a day, on the site's clocks, from midnight to midnight. */
export function sunPath(site: Site, date: string, step = 10): { minutes: number; sun: SunPosition }[] {
  const out: { minutes: number; sun: SunPosition }[] = []
  const every = Math.max(1, Math.min(240, step))
  const [start, end] = [siteInstant(site, date, 0), siteInstant(site, date, 1440)]
  if (start === null || end === null) return []
  // The clocks keep one offset all day but on the two days a year they change: reading the time
  // zone once a minute took 11 ms a day, drawn again at each change of the hour.
  const steady = end - start === DAY
  for (let minutes = 0; minutes <= 1440; minutes += every) {
    const instant = steady ? start + minutes * 60_000 : siteInstant(site, date, minutes)!
    out.push({ minutes, sun: sunPosition(site.latitude, site.longitude, instant) })
  }
  return out
}

/** An hour of the day, as minutes after midnight, written 'HH:MM'. */
export function clockTime(minutes: number): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
