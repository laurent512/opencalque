import { parseColor, resolveColor } from './colors'
import { rootOf } from './document'
import { DEFAULT_INK } from './kinds'
import { add, dist, scale, sub, type Vec2 } from './geometry'
import type { Primitive } from './primitives'
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'
import { clockTime, sunAt, sunPath, towardsSun, type SunPosition } from './sun'
import { drawnAltitude, northOf, siteOf, sunlight, SUN_RADIUS } from './sunlight'

/*
 * A sun on the plan (ARCHITECTURE, "The sun"): the sky round its point seen from above, as a sun-path
 * diagram draws it. Its circle is the horizon, the zenith its centre, each place in the sky as far
 * from the centre as it is low (90° from the zenith on the circle), in the way it is on the plan (north
 * as the page says); across it, the day's path of the sun with a dot at each hour, the sun where it is
 * at its hour, and the line of its light to the centre; its day and hour are said in Properties, not
 * written here. Under all of it, the shade it casts and the floors it lights (`sunlight`).
 */

/**
 * The colours of the shade the sun casts on the plan and of the floors it lights, when it gives none
 * of its own (`shade`, `sunlit`): see-through, written as the colour window writes them; and of the sun itself.
 */
export const SHADE_FILL = '#34405c38'
export const SUNLIT_FILL = '#ffc42e6b'
export const SUN_FILL = '#f6b40e'

const radiusOf = (sun: NodeOf<'sun'>) => sun.radius ?? SUN_RADIUS

/** Where a place in the sky is drawn on a sun's circle: as far from its centre as it is low, on the horizon when below it. */
function skyPoint(sun: NodeOf<'sun'>, position: SunPosition, north: number): Vec2 {
  const reach = radiusOf(sun) * Math.min(1, Math.max(0, (90 - position.altitude) / 90))
  return add(sun, scale(towardsSun(position.azimuth, north), reach))
}

/** The day of a sun, every few minutes, each where its circle draws it. */
function dayOf(doc: Document, sun: NodeOf<'sun'>, step = 10): { minutes: number; position: SunPosition; at: Vec2 }[] {
  const north = northOf(doc, sun.parent)
  return sunPath(siteOf(doc), sun.date, step).map(({ minutes, sun: position }) => ({ minutes, position, at: skyPoint(sun, position, north) }))
}

/** Where a sun is drawn on its circle at its hour: what is dragged along its path to change the hour. */
export function sunSpot(doc: Document, sun: NodeOf<'sun'>): Vec2 {
  const now = sunAt(siteOf(doc), sun.date, sun.time)
  return now ? skyPoint(sun, now, northOf(doc, sun.parent)) : { x: sun.x, y: sun.y - radiusOf(sun) }
}

/** The hour, as 'HH:MM' in steps of `step` minutes, at which the sun of the day's path is nearest to `p` while it is up; null on a day it never rises. */
export function timeNear(doc: Document, sun: NodeOf<'sun'>, p: Vec2, step = 5): string | null {
  const up = dayOf(doc, sun, step).filter((at) => at.position.altitude > 0)
  if (up.length === 0) return null
  const best = up.reduce((a, b) => (dist(b.at, p) < dist(a.at, p) ? b : a))
  return clockTime(best.minutes)
}

/** What a sun draws on its plan. */
export function sunPrimitives(sun: NodeOf<'sun'>, doc: Document, registry: Registry): Primitive[] {
  const r = radiusOf(sun)
  const centre = { x: sun.x, y: sun.y }
  const north = northOf(doc, sun.parent)
  const out: Primitive[] = []
  const day = dayOf(doc, sun)
  const now = sunAt(siteOf(doc), sun.date, sun.time)
  // Under everything: the shade and the sunlit floors, not part of its box, nor to click.
  if (now && sun.shadows !== false && now.altitude > 0) {
    const page = rootOf(doc, sun.parent)
    // As long as it says (`reach`): the sun drawn lower or higher than it is.
    const light = page ? sunlight(doc, page.id, registry, towardsSun(now.azimuth, north), drawnAltitude(now.altitude, sun.reach)) : null
    // Each in layers, from a little wider to a little narrower, each as see-through as it takes for
    // all of them, laid over each other, to be of its colour: the edges fade.
    if (light) {
      const layerColor = sun.layer === undefined ? undefined : doc.layers[sun.layer]?.color
      for (const [outlines, colour] of [[light.layers.map((layer) => layer.shade), sun.shade ?? SHADE_FILL], [light.layers.map((layer) => layer.lit), sun.sunlit ?? SUNLIT_FILL]] as const) {
        const resolved = resolveColor(doc, colour, resolveColor(doc, layerColor) ?? DEFAULT_INK)
        const parsed = parseColor(resolved)
        if (!parsed) continue
        const fill = withOpacity(parsed, parsed.a >= 1 ? 1 : 1 - (1 - parsed.a) ** (1 / outlines.length))
        for (const layer of outlines) for (const outline of layer) out.push({ kind: 'path', points: outline, closed: true, fill, stroke: 'none', own: true, backdrop: 'floor', aside: true })
      }
    }
  }
  // The horizon, and the four ways, north named.
  out.push({ kind: 'ellipse', cx: sun.x, cy: sun.y, rx: r, ry: r, fill: 'none' })
  for (const [i, length] of [1, 0.5, 0.5, 0.5].entries()) {
    const way = towardsSun(i * 90, north)
    out.push({ kind: 'path', points: [add(centre, scale(way, r * (1 - 0.06 * length))), add(centre, scale(way, r * (1 + 0.06 * length)))] })
  }
  const northWay = towardsSun(0, north)
  // Its hours along the path as large as it says, or else in proportion to its circle; N in proportion to them.
  const text = sun.size ?? r * 0.055
  const letter = text * 1.8
  const named = add(centre, scale(northWay, r * 1.16))
  out.push({ kind: 'text', x: named.x, y: named.y + letter * 0.36, text: 'N', size: letter, align: 'center', bold: true })
  // The day's path, in pieces while the sun is up, with a dot at each hour and every third named.
  const pieces: Vec2[][] = []
  let piece: Vec2[] = []
  for (const at of day) {
    if (at.position.altitude > 0) piece.push(at.at)
    else if (piece.length > 0) {
      pieces.push(piece)
      piece = []
    }
  }
  if (piece.length > 0) pieces.push(piece)
  for (const points of pieces) if (points.length > 1) out.push({ kind: 'path', points, strokeWidth: 1 })
  const dot = r * 0.012
  const label = text
  for (const at of day) {
    if (at.minutes % 60 !== 0 || at.minutes >= 1440 || at.position.altitude <= 0) continue
    out.push({ kind: 'ellipse', cx: at.at.x, cy: at.at.y, rx: dot, ry: dot, fill: 'stroke' })
    const hour = at.minutes / 60
    if (hour % 3 !== 0) continue
    const away = dist(at.at, centre) > 1e-6 ? scale(sub(at.at, centre), 1 / dist(at.at, centre)) : { x: 0, y: -1 }
    const spot = add(at.at, scale(away, label * 1.2))
    out.push({ kind: 'text', x: spot.x, y: spot.y + label * 0.36, text: String(hour), size: label, align: 'center' })
  }
  // The sun at its hour: its light to the centre, dashed; the sun itself, hollow when it is down.
  if (now) {
    const spot = skyPoint(sun, now, north)
    const up = now.altitude > 0
    const disc = r * 0.06
    if (dist(spot, centre) > disc) out.push({ kind: 'path', points: [spot, centre], dash: [6, 4] })
    out.push({ kind: 'ellipse', cx: spot.x, cy: spot.y, rx: disc, ry: disc, fill: up ? SUN_FILL : 'none', own: true, ...(up ? {} : { dash: [3, 3] }) })
    for (let i = 0; i < 8; i++) {
      const way = towardsSun(i * 45)
      out.push({ kind: 'path', points: [add(spot, scale(way, disc * 1.35)), add(spot, scale(way, disc * 1.8))] })
    }
  }
  return out
}

/** A colour (red, green and blue from 0 to 1) at an opacity, written with eight hex digits. */
function withOpacity(colour: { r: number; g: number; b: number }, opacity: number): string {
  const hex = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
  return `#${hex(colour.r)}${hex(colour.g)}${hex(colour.b)}${hex(opacity)}`
}
