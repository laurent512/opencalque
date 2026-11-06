import { createLucideIcon } from 'lucide-react'

/*
 * Icons that Lucide does not have, drawn on its 24 × 24 grid with its stroke so that they sit
 * among its own. Each is a LucideIcon, used wherever one of Lucide's is.
 */

/** An arc: half a circle, unlike Lucide's curve with a point at each end, which it stands beside. */
export const Arc = createLucideIcon('arc', [['path', { d: 'M4 18a8 8 0 0 1 16 0', key: 'arc' }]])

/** An offset: a line, and another running alongside it. */
export const Offset = createLucideIcon('offset', [
  ['path', { d: 'M4 20A16 16 0 0 1 20 4', key: 'line' }],
  ['path', { d: 'M10 20A10 10 0 0 1 20 10', key: 'copy' }],
])

/** A grid line: its bubble with a letter in it, over the start of its line in dash and dot. */
export const GridLine = createLucideIcon('grid-line', [
  ['circle', { cx: '12', cy: '9', r: '7', key: 'bubble' }],
  ['path', { d: 'M9.5 12.5 12 5.5l2.5 7', key: 'letter' }],
  ['path', { d: 'M10.4 10h3.2', key: 'bar' }],
  ['path', { d: 'M12 16v2', key: 'dash' }],
  ['path', { d: 'M12 21v1', key: 'dot' }],
])
