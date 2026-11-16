import type { ParametricKind, Primitive } from '@opencalque/core'
import { atLeast, circle, DEPTH, line, outline, pt, sizedBox, THIN, WIDTH } from './shared'

// A radiator stands against the wall by its top edge, as the kitchen pieces do.

/** The least a radiator is made long by pulling its sides, and the least it is made deep, in mm. */
const MIN_LENGTH = 200
const MIN_DEPTH = 40
/** How wide a section of a radiator is drawn, in mm: about that of a column or cast-iron radiator. */
const SECTION = 60
/** The most sections drawn: a length typed by mistake must not draw a million lines. */
const MAX_SECTIONS = 200
/** How high above the floor a radiator's body starts and ends, in mm. */
export const RADIATOR_FOOT = 150
export const RADIATOR_TOP = 750

/**
 * A heating radiator against a wall: its body, cut into sections that keep their width as it is
 * made longer, and, beside the end it is fed from, its valve on the pipe that comes to it.
 */
export const radiator: ParametricKind = {
  kind: 'arch.radiator',
  label: 'Radiator',
  category: 'heating',
  description: 'Against the wall by its back. Pull its sides to make it longer: its sections keep their width. Its valve is at one end.',
  params: [{ ...WIDTH, label: 'Length', default: 800 }, DEPTH(100), { key: 'valve', label: 'Valve', type: 'string', default: 'Right', options: ['Right', 'Left'] }],
  box: sizedBox('width', 'depth', MIN_LENGTH, MIN_DEPTH),
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
  front: ({ width, valve }) => {
    const w = atLeast(1, width)
    const sections = Math.min(MAX_SECTIONS, Math.max(1, Math.round(w / SECTION)))
    const prims: Primitive[] = [outline([pt(0, -RADIATOR_FOOT), pt(w, -RADIATOR_FOOT), pt(w, -RADIATOR_TOP), pt(0, -RADIATOR_TOP)])]
    for (let i = 1; i < sections; i++) prims.push(line([pt((i * w) / sections, -RADIATOR_FOOT - 20), pt((i * w) / sections, -RADIATOR_TOP + 20)], THIN))
    const end = valve === 'Left' ? 0 : w
    const out = valve === 'Left' ? -1 : 1
    prims.push(line([pt(end, -RADIATOR_FOOT - 30), pt(end + out * 40, -RADIATOR_FOOT - 30), pt(end + out * 40, 0)]), circle(end + out * 40, -RADIATOR_FOOT - 60, 18))
    return prims
  },
  side: ({ depth }) => {
    const d = atLeast(1, depth)
    return [outline([pt(30, -RADIATOR_FOOT), pt(30 + d, -RADIATOR_FOOT), pt(30 + d, -RADIATOR_TOP), pt(30, -RADIATOR_TOP)]), line([pt(0, -RADIATOR_FOOT - 80), pt(30, -RADIATOR_FOOT - 80)]), line([pt(0, -RADIATOR_TOP + 80), pt(30, -RADIATOR_TOP + 80)])]
  },
}
