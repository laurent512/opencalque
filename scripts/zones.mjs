// Makes apps/web/src/zones.ts, where the main place of each time zone is, from the tz database's
// zone1970.tab and zone.tab (public domain), downloaded beforehand:
//   curl -sSfLO https://raw.githubusercontent.com/eggert/tz/main/zone.tab
//   curl -sSfLO https://raw.githubusercontent.com/eggert/tz/main/zone1970.tab
//   node scripts/zones.mjs zone.tab zone1970.tab apps/web/src/zones.ts
import { readFileSync, writeFileSync } from 'node:fs'
const [, , zoneTab, zone1970, out] = process.argv
const places = new Map()
const angle = (text, degreeDigits) => {
  const sign = text[0] === '-' ? -1 : 1
  const d = text.slice(1)
  const deg = Number(d.slice(0, degreeDigits)), min = Number(d.slice(degreeDigits, degreeDigits + 2)), sec = Number(d.slice(degreeDigits + 2) || 0)
  return sign * (deg + min / 60 + sec / 3600)
}
for (const file of [zone1970, zoneTab]) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [, coords, zone] = line.split('\t')
    if (!zone || places.has(zone)) continue
    const m = /^([+-]\d+)([+-]\d+)$/.exec(coords)
    if (!m) throw new Error(line)
    const lat = angle(m[1], 2), lon = angle(m[2], 3)
    places.set(zone, [Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000])
  }
}
const entries = [...places].sort(([a], [b]) => (a < b ? -1 : 1))
const body = entries.map(([zone, [lat, lon]]) => `  '${zone}': [${lat}, ${lon}],`).join('\n')
writeFileSync(out, `/*
 * Where the main place of each time zone is, by its IANA name: [latitude, longitude] in degrees,
 * north and east positive. Made from zone1970.tab and zone.tab of the tz database
 * (https://www.iana.org/time-zones), which are in the public domain, by scripts/zones.mjs; to be made again
 * rather than edited. Only the first guess of where a drawing's building is comes from it
 * (\`guessedSite\` in site.ts): the person corrects it.
 */
export const ZONE_PLACES: Record<string, [latitude: number, longitude: number]> = {
${body}
}
`)
console.log(entries.length, 'zones')
