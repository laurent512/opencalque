import { describe, expect, it } from 'vitest'
import { clockTime, readMoment, shadowReach, siteInstant, siteOffset, sunAt, sunPath, sunPosition, towardsSun, type Site } from '../src/sun'

const PARIS: Site = { latitude: 48.857, longitude: 2.352, timeZone: 'Europe/Paris' }
const SYDNEY: Site = { latitude: -33.87, longitude: 151.21, timeZone: 'Australia/Sydney' }
const TROMSO: Site = { latitude: 69.65, longitude: 18.96, timeZone: 'Europe/Oslo' }

/** The highest the sun goes on a day, and where it is then. */
const noon = (site: Site, date: string) => sunPath(site, date, 1).reduce((best, at) => (at.sun.altitude > best.sun.altitude ? at : best))

describe('where the sun is', () => {
  it('is as high at noon as the latitude and the season say', () => {
    // At an equinox the sun is over the equator: at noon it stands 90° less the latitude.
    expect(noon(PARIS, '2026-03-20').sun.altitude).toBeCloseTo(90 - 48.857, 0)
    // At the June solstice, 23.44° higher.
    expect(noon(PARIS, '2026-06-21').sun.altitude).toBeCloseTo(90 - 48.857 + 23.44, 0)
    expect(noon(PARIS, '2026-12-21').sun.altitude).toBeCloseTo(90 - 48.857 - 23.44, 0)
  })

  it('is due south at noon in the north, due north in the south', () => {
    expect(noon(PARIS, '2026-06-21').sun.azimuth).toBeGreaterThan(178)
    expect(noon(PARIS, '2026-06-21').sun.azimuth).toBeLessThan(182)
    const south = noon(SYDNEY, '2026-06-21')
    expect(Math.min(south.sun.azimuth, 360 - south.sun.azimuth)).toBeLessThan(2)
    expect(south.sun.altitude).toBeCloseTo(90 - 33.87 - 23.44, 0)
  })

  it('reaches noon in Paris after 13:00 in summer, its clocks being two hours ahead of the sun there', () => {
    const at = noon(PARIS, '2026-06-21').minutes
    expect(at).toBeGreaterThan(13 * 60 + 45)
    expect(at).toBeLessThan(14 * 60)
    // In winter an hour earlier, and the equation of time moves it a quarter of an hour.
    expect(noon(PARIS, '2026-12-21').minutes).toBeGreaterThan(12 * 60 + 40)
    expect(noon(PARIS, '2026-12-21').minutes).toBeLessThan(12 * 60 + 55)
  })

  it('rises in the east and sets in the west at an equinox', () => {
    const day = sunPath(PARIS, '2026-03-20', 1).filter((at) => at.sun.altitude > 0)
    expect(day[0].sun.azimuth).toBeGreaterThan(85)
    expect(day[0].sun.azimuth).toBeLessThan(95)
    expect(day[day.length - 1].sun.azimuth).toBeGreaterThan(265)
    expect(day[day.length - 1].sun.azimuth).toBeLessThan(275)
    // About twelve hours of day.
    expect(day.length / 60).toBeGreaterThan(11.9)
    expect(day.length / 60).toBeLessThan(12.4)
  })

  it('stays down all day in the polar night and up all night in the midnight sun', () => {
    expect(sunPath(TROMSO, '2026-12-21').every((at) => at.sun.altitude < 0)).toBe(true)
    expect(sunAt(TROMSO, '2026-06-21', '00:30')!.altitude).toBeGreaterThan(0)
  })

  it('is the same seen from anywhere at one instant, by longitude only through the time', () => {
    const instant = Date.UTC(2026, 5, 21, 12)
    const greenwich = sunPosition(51.48, 0, instant)
    const later = sunPosition(51.48, -15, instant + 3_600_000)
    expect(later.altitude).toBeCloseTo(greenwich.altitude, 0)
    expect(later.azimuth).toBeCloseTo(greenwich.azimuth, 0)
  })
})

describe("the site's clocks", () => {
  it('follow the summer time of the time zone', () => {
    expect(siteInstant(PARIS, '2026-07-01', 12 * 60)).toBe(Date.UTC(2026, 6, 1, 10))
    expect(siteInstant(PARIS, '2026-01-15', 12 * 60)).toBe(Date.UTC(2026, 0, 15, 11))
    expect(siteInstant(SYDNEY, '2026-01-15', 12 * 60)).toBe(Date.UTC(2026, 0, 15, 1))
    expect(siteOffset(PARIS, Date.UTC(2026, 6, 1))).toBe(120)
  })

  it('are those of the longitude without a time zone, or with one the host does not know', () => {
    expect(siteOffset({ latitude: 0, longitude: 2.35 }, 0)).toBe(0)
    expect(siteOffset({ latitude: 0, longitude: -74 }, 0)).toBe(-300)
    expect(siteOffset({ latitude: 0, longitude: 139.7, timeZone: 'Nowhere/Else' }, 0)).toBe(540)
  })

  it('read days and hours as they are written, and refuse what is not one', () => {
    expect(readMoment('2026-06-21', '15:30')).toEqual({ year: 2026, month: 6, day: 21, minutes: 930 })
    expect(readMoment('21/06/2026', '15:30')).toBeNull()
    expect(readMoment('2026-06-21', '15h30')).toBeNull()
    expect(sunAt(PARIS, '2026-13-01', '12:00')).toBeNull()
    expect(clockTime(930)).toBe('15:30')
    expect(clockTime(1440)).toBe('00:00')
  })
})

describe('the sun on a plan', () => {
  it('comes from the bottom of a plan with north up when it is in the south', () => {
    const v = towardsSun(180)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(1)
    // East is to the right with north up; with north turned to the right, east is down.
    expect(towardsSun(90).x).toBeCloseTo(1)
    expect(towardsSun(90, 90).y).toBeCloseTo(1)
  })

  it('casts shadows as long as the object is high at 45°, longer when lower', () => {
    expect(shadowReach(45)).toBeCloseTo(1)
    expect(shadowReach(10)).toBeGreaterThan(5)
    expect(shadowReach(0)).toBe(Infinity)
  })
})
