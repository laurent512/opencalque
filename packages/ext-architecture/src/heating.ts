import type { ParametricKind, Primitive } from '@opencalque/core'
import { rect } from './fronts'
import { atLeast, circle, DEPTH, HEIGHT, line, outline, pt, roundBox, sizedBox, THIN, WIDTH } from './shared'

// A radiator stands against the wall by its top edge, as the kitchen pieces do.

/** The least a radiator is made long by pulling its sides, and the least it is made deep, in mm. */
const MIN_LENGTH = 200
const MIN_DEPTH = 40
/** How wide a section of a radiator is drawn, in mm: about that of a column or cast-iron radiator. */
const SECTION = 60
/** The most sections drawn: a length typed by mistake must not draw a million lines. */
const MAX_SECTIONS = 200
/** How high above the floor a radiator's body starts, in mm. */
export const RADIATOR_FOOT = 150
/** The least a radiator's body is made high, in mm: room for its valve and the ends of its sections. */
const MIN_BODY = 100
/** How high its body is, made at least `MIN_BODY`: what its top is dragged to in an elevation. */
const bodyOf = (height: number) => Math.max(MIN_BODY, Number.isFinite(height) ? height : 600)

/**
 * A heating radiator against a wall: its body, cut into sections that keep their width as it is
 * made longer, and, beside the end it is fed from, its valve on the pipe that comes to it.
 */
export const radiator: ParametricKind = {
  kind: 'arch.radiator',
  label: 'Radiator',
  category: 'heating',
  description: 'Against the wall by its back. Pull its sides to make it longer: its sections keep their width. Its valve is at one end.',
  // Its height is that of its body, which starts 15 cm above the floor.
  params: [{ ...WIDTH, label: 'Length', default: 800 }, DEPTH(100), HEIGHT(600), { key: 'valve', label: 'Valve', type: 'string', default: 'Right', options: ['Right', 'Left'] }],
  box: sizedBox('width', 'depth', MIN_LENGTH, MIN_DEPTH),
  mount: { on: 'floor' },
  height: ({ height }) => RADIATOR_FOOT + bodyOf(height),
  build({ width, depth, valve }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const sections = Math.min(MAX_SECTIONS, Math.max(1, Math.round(w / SECTION)))
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    for (let i = 1; i < sections; i++) prims.push(line([pt((i * w) / sections, 0), pt((i * w) / sections, d)], THIN))
    const r = Math.min(20, d / 3)
    const end = valve === 'Left' ? 0 : w
    const out = valve === 'Left' ? -1 : 1
    prims.push(line([pt(end, d / 2), pt(end + out * 10, d / 2)]), circle(end + out * (10 + r), d / 2, r))
    return prims
  },
  // Seen from in front, its sections from 15 cm above the floor, its valve on the pipe that comes up
  // from the floor at its end; from the side, its body off the wall on its brackets.
  front: ({ width, height, valve }) => {
    const w = atLeast(1, width)
    const top = RADIATOR_FOOT + bodyOf(height)
    const sections = Math.min(MAX_SECTIONS, Math.max(1, Math.round(w / SECTION)))
    const prims: Primitive[] = [outline([pt(0, -RADIATOR_FOOT), pt(w, -RADIATOR_FOOT), pt(w, -top), pt(0, -top)])]
    for (let i = 1; i < sections; i++) prims.push(line([pt((i * w) / sections, -RADIATOR_FOOT - 20), pt((i * w) / sections, -top + 20)], THIN))
    const end = valve === 'Left' ? 0 : w
    const out = valve === 'Left' ? -1 : 1
    prims.push(line([pt(end, -RADIATOR_FOOT - 30), pt(end + out * 40, -RADIATOR_FOOT - 30), pt(end + out * 40, 0)]), circle(end + out * 40, -RADIATOR_FOOT - 60, 18))
    return prims
  },
  side: ({ depth, height }) => {
    const d = atLeast(1, depth)
    const top = RADIATOR_FOOT + bodyOf(height)
    // Its brackets, a little in from its top and bottom.
    const bracket = Math.min(80, bodyOf(height) / 4)
    return [outline([pt(30, -RADIATOR_FOOT), pt(30 + d, -RADIATOR_FOOT), pt(30 + d, -top), pt(30, -top)]), line([pt(0, -RADIATOR_FOOT - bracket), pt(30, -RADIATOR_FOOT - bracket)]), line([pt(0, -top + bracket), pt(30, -top + bracket)])]
  },
}

/** The least a heat pump's outdoor unit is made, long and deep, and how high its feet lift it, in mm. */
const MIN_UNIT_WIDTH = 400
const MIN_UNIT_DEPTH = 200
const FEET = 60

/**
 * The outdoor unit of a heat pump ("pompe à chaleur"), standing against an outside wall by its back:
 * its casing, its fan, and at one end the compartment its pipes come into. Seen from in front, the
 * fan's grille; set on brackets, it is given a height above the floor.
 */
export const heatPump: ParametricKind = {
  kind: 'arch.heatpump',
  label: 'Heat pump, outdoor unit',
  category: 'heating',
  description: 'Against an outside wall by its back. Pull its sides to make it longer or deeper. Give it a height above the floor to set it on brackets.',
  params: [{ ...WIDTH, default: 900 }, DEPTH(350), HEIGHT(700)],
  box: sizedBox('width', 'depth', MIN_UNIT_WIDTH, MIN_UNIT_DEPTH),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const r = Math.max(10, Math.min(d / 2 - 30, w * 0.3))
    const fan = w * 0.38
    return [
      outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]),
      circle(fan, d / 2, r, THIN),
      circle(fan, d / 2, r * 0.25, THIN),
      line([pt(w * 0.78, 0), pt(w * 0.78, d)], THIN),
    ]
  },
  front: ({ width, height }) => {
    const w = atLeast(1, width)
    const h = Math.max(FEET + 1, height)
    const body = h - FEET
    const r = Math.max(10, Math.min(body / 2 - 40, w * 0.3))
    return [
      rect(w * 0.08, 0, w * 0.18, -FEET),
      rect(w * 0.82, 0, w * 0.92, -FEET),
      rect(0, -FEET, w, -h),
      circle(w * 0.38, -FEET - body / 2, r),
      circle(w * 0.38, -FEET - body / 2, r * 0.25, THIN),
      line([pt(w * 0.78, -FEET), pt(w * 0.78, -h)], THIN),
    ]
  },
  side: ({ depth, height }) => {
    const d = atLeast(1, depth)
    const h = Math.max(FEET + 1, height)
    return [rect(d * 0.1, 0, d * 0.9, -FEET), rect(0, -FEET, d, -h)]
  },
}

/** The least a boiler is made, wide and deep, in mm. */
const MIN_BOILER = 250
/** How far its flue rises over it before it turns into the wall, in mm. */
const FLUE = 150

/**
 * A gas boiler ("chaudière"), hung on the wall at a height that is that of its underside: its casing
 * and, on top, the flue that goes out through the wall. Seen from in front, its control panel and
 * the pipes under it.
 */
export const gasBoiler: ParametricKind = {
  kind: 'arch.boiler',
  label: 'Gas boiler',
  category: 'heating',
  description: 'Hung on the wall by its back, its flue on top. Its height above the floor is that of its underside.',
  params: [{ ...WIDTH, default: 400 }, DEPTH(300), HEIGHT(700)],
  box: sizedBox('width', 'depth', MIN_BOILER),
  mount: { on: 'wall', height: 1000, measured: 'bottom' },
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const r = Math.min(62, w / 5, d / 4)
    return [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), circle(w / 2, d * 0.45, r), circle(w / 2, d * 0.45, r * 0.65, THIN)]
  },
  front: ({ width, height }) => {
    const w = atLeast(1, width)
    const h = atLeast(1, height)
    const r = Math.min(62, w / 5)
    const prims: Primitive[] = [rect(0, 0, w, -h), rect(w * 0.2, -40, w * 0.8, -Math.min(140, h / 4), THIN), rect(w / 2 - r, -h, w / 2 + r, -h - FLUE)]
    // Its pipes, coming down from its underside: heating out and back, gas, hot and cold water.
    for (let i = 0; i < 5; i++) prims.push(line([pt(w * (0.2 + i * 0.15), 0), pt(w * (0.2 + i * 0.15), 120)], THIN))
    return prims
  },
  side: ({ depth, height }) => {
    const d = atLeast(1, depth)
    const h = atLeast(1, height)
    const r = Math.min(62, d / 4)
    const x = d * 0.45
    return [rect(0, 0, d, -h), outline([pt(x - r, -h), pt(x - r, -h - FLUE + r), pt(0, -h - FLUE + r), pt(0, -h - FLUE - r), pt(x + r, -h - FLUE - r), pt(x + r, -h)])]
  },
}

/** The least a water heater is made across, in mm. */
const MIN_TANK = 300

/**
 * A water heater ("chauffe-eau", "ballon", or "boiler" where it is called so), a round tank standing
 * against the wall: its shell, its insulation, and the hot and cold pipes on top at the back. Seen
 * from in front, the tank with its rounded ends.
 */
export const waterHeater: ParametricKind = {
  kind: 'arch.waterheater',
  label: 'Water heater',
  category: 'heating',
  description: 'A round tank against the wall. Pull its sides to make it larger. Give it a height above the floor to hang it on the wall.',
  params: [{ key: 'diameter', label: 'Diameter', type: 'number', default: 570, unit: 'length' }, HEIGHT(1600)],
  box: {
    bounds: ({ diameter }) => ({ left: 0, top: 0, right: atLeast(1, diameter), bottom: atLeast(1, diameter) }),
    resize: (_, size) => {
      const given = [size.width, size.height].filter((v): v is number => v !== undefined)
      return given.length === 0 ? {} : { diameter: Math.round(atLeast(MIN_TANK, Math.max(...given))) }
    },
  },
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build({ diameter }) {
    const r = atLeast(1, diameter) / 2
    const pipe = Math.min(15, r / 8)
    return [circle(r, r, r), circle(r, r, Math.max(r * 0.5, r - 50), THIN), circle(r * 0.76, r * 0.6, pipe, THIN), circle(r * 1.24, r * 0.6, pipe, THIN)]
  },
  front: ({ diameter, height }) => tank(atLeast(1, diameter), atLeast(1, height)),
  side: ({ diameter, height }) => tank(atLeast(1, diameter), atLeast(1, height)),
}

/** A water heater seen from in front or from its side: its tank with rounded ends, and its pipes out of the top. */
function tank(d: number, h: number): Primitive[] {
  return [roundBox(0, -h, d, 0, Math.min(d * 0.2, h / 4)), line([pt(d * 0.38, -h), pt(d * 0.38, -h - 100)], THIN), line([pt(d * 0.62, -h), pt(d * 0.62, -h - 100)], THIN)]
}

/** The least a fireplace's breast is made, wide and deep, in mm. */
const MIN_FIREPLACE = 400
const MIN_FIREPLACE_DEPTH = 250
/** How high the mantel of an open fireplace is, and its opening under it, in mm. */
const MANTEL = 1200
const OPENING = 800
/** How high above the floor a cassette's frame starts, and how high it is, in mm. */
const CASSETTE_SILL = 450
const CASSETTE_HEIGHT = 600
/** The frame round a cassette's glass, in mm. */
const CASSETTE_FRAME = 50

/**
 * A fireplace ("cheminée"): its chimney breast against the wall by its back, as wide and deep as
 * its parameters, and in it either a cassette, a closed insert behind glass set flush with the
 * front of the breast, or an open hearth, the firebox splayed towards the room with the hearth
 * slab laid on the floor in front of it. Seen from in front, the cassette's glass in the breast, or
 * the opening under the mantel with the hood rising over it.
 */
export const fireplace: ParametricKind = {
  kind: 'arch.fireplace',
  label: 'Fireplace',
  category: 'heating',
  description: 'Its chimney breast goes against the wall by its back. A cassette is a closed insert behind glass, set in the breast; an open hearth has its slab on the floor in front. Pull its sides to make it wider or deeper.',
  params: [
    { ...WIDTH, default: 1000 },
    DEPTH(500),
    HEIGHT(2500),
    { key: 'style', label: 'Style', type: 'string', default: 'Cassette', options: ['Cassette', 'Open hearth'] },
    { key: 'hearth', label: 'Hearth', type: 'number', default: 400, unit: 'length', shown: ({ style }) => style === 'Open hearth' },
  ],
  box: sizedBox('width', 'depth', MIN_FIREPLACE, MIN_FIREPLACE_DEPTH),
  mount: { on: 'floor' },
  height: ({ height }) => atLeast(1, height),
  build({ width, depth, style, hearth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    if (style === 'Open hearth') {
      // The masonry round the firebox, open at the front, and the slab in front of it.
      const slab = Math.max(0, Number(hearth) || 0)
      const prims: Primitive[] = [outline([pt(w * 0.2, d), pt(0, d), pt(0, 0), pt(w, 0), pt(w, d), pt(w * 0.8, d), pt(w * 0.7, d * 0.25), pt(w * 0.3, d * 0.25)])]
      if (slab > 0) prims.push(outline([pt(0, d), pt(w, d), pt(w, d + slab), pt(0, d + slab)], THIN))
      return prims
    }
    // The cassette, flush with the front of the breast, its glass along the front.
    const m = Math.min(150, w * 0.15)
    const glass = d - Math.min(30, d * 0.08)
    return [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), outline([pt(m, d * 0.25), pt(w - m, d * 0.25), pt(w - m, d), pt(m, d)]), line([pt(m, glass), pt(w - m, glass)], THIN)]
  },
  front: ({ width, height, style }) => {
    const w = atLeast(1, width)
    const h = atLeast(1, height)
    if (style === 'Open hearth') {
      const mantel = Math.min(MANTEL, h)
      const opening = Math.min(OPENING, mantel * 0.7)
      const prims: Primitive[] = [rect(0, 0, w, -mantel), line([pt(w * 0.2, 0), pt(w * 0.2, -opening), pt(w * 0.8, -opening), pt(w * 0.8, 0)]), rect(-30, -mantel, w + 30, -mantel - 50, THIN)]
      // The hood, narrower than the mantel, up to the top of the breast.
      if (h > mantel + 50) prims.push(rect(w * 0.15, -mantel - 50, w * 0.85, -h))
      return prims
    }
    const m = Math.min(150, w * 0.15)
    const sill = Math.min(CASSETTE_SILL, h / 3)
    const top = Math.min(sill + CASSETTE_HEIGHT, h * 0.8)
    const frame = Math.min(CASSETTE_FRAME, (top - sill) / 4, (w - 2 * m) / 4)
    return [rect(0, 0, w, -h), rect(m, -sill, w - m, -top), rect(m + frame, -sill - frame, w - m - frame, -top + frame, THIN)]
  },
  side: ({ depth, height, style, hearth }) => {
    const d = atLeast(1, depth)
    const h = atLeast(1, height)
    if (style === 'Open hearth') {
      const mantel = Math.min(MANTEL, h)
      const slab = Math.max(0, Number(hearth) || 0)
      const prims: Primitive[] = [rect(0, 0, d, -mantel)]
      if (h > mantel) prims.push(rect(0, -mantel, d * 0.7, -h))
      if (slab > 0) prims.push(rect(d, 0, d + slab, -30, THIN))
      return prims
    }
    const sill = Math.min(CASSETTE_SILL, h / 3)
    const top = Math.min(sill + CASSETTE_HEIGHT, h * 0.8)
    return [rect(0, 0, d, -h), rect(d * 0.25, -sill, d, -top, THIN)]
  },
}
