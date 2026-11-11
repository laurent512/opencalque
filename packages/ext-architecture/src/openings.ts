import { arcPoints, type ParametricKind, type Primitive } from '@opencalque/core'
import { atLeast, clamp, count, HEAVY, HEIGHT, line, LOOSE_WALL, mirrorAcross, mirrorAlong, OTHER_SIDE, outline, pt, THIN, WIDTH } from './shared'

/* Doors and windows: openings that cut the wall they are placed on, drawn along +X, the wall's line, and told its thickness. */

export const door: ParametricKind = {
  kind: 'arch.door',
  category: 'architecture',
  label: 'Door',
  description: 'Place it on a wall: it cuts the opening and follows the wall. Off a wall it stands alone.',
  params: [
    WIDTH,
    HEIGHT(2040),
    { key: 'type', label: 'Type', type: 'string', default: 'Single', options: ['Single', 'Double', 'Sliding', 'Opening only'] },
    { key: 'hinge', label: 'Hinge', type: 'string', default: 'Left', options: ['Left', 'Right'] },
    { key: 'angle', label: 'Open angle', type: 'number', default: 90, unit: 'angle' },
    OTHER_SIDE,
  ],
  opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
  size: { x: 'width' },
  build({ width, type, hinge, angle, flip }, env) {
    const w = atLeast(1, width)
    const h = (env.wallThickness ?? LOOSE_WALL) / 2
    const open = clamp(angle, 5, 180)
    // A leaf hinged on the +Y face. `dir` is +1 when it closes towards +X, -1 towards -X.
    const leaf = (hingeX: number, length: number, dir: 1 | -1): Primitive[] => {
      const hingePoint = pt(hingeX, h)
      const closed = dir === 1 ? 0 : 180
      const opened = closed + dir * open
      const tip = arcPoints(hingePoint, length, opened, opened, 1)[0]
      return [line([hingePoint, tip], HEAVY), line(arcPoints(hingePoint, length, closed, opened), THIN)]
    }
    let prims: Primitive[] = [line([pt(0, -h), pt(w, -h)], THIN), line([pt(0, h), pt(w, h)], THIN)]
    if (type === 'Single') prims.push(...leaf(0, w, 1))
    else if (type === 'Double') prims.push(...leaf(0, w / 2, 1), ...leaf(w, w / 2, -1))
    else if (type === 'Sliding') {
      const offset = h * 0.3
      prims.push(line([pt(0, -offset), pt(w * 0.55, -offset)], HEAVY), line([pt(w * 0.45, offset), pt(w, offset)], HEAVY))
    }
    if (hinge === 'Right') prims = mirrorAlong(prims, w)
    return flip ? mirrorAcross(prims) : prims
  },
  // Seen from in front: its frame from the floor to its height, the leaves, and a handle on the side that opens.
  front({ width, height, type, hinge }) {
    const w = atLeast(1, width)
    const top = -atLeast(1, height)
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, top), pt(0, top)])]
    if (type === 'Double' || type === 'Sliding') prims.push(line([pt(w / 2, 0), pt(w / 2, top)], THIN))
    const handle = (x: number, toward: 1 | -1) => line([pt(x, -1000), pt(x + toward * 100, -1000)], HEAVY)
    if (type === 'Single') prims.push(hinge === 'Right' ? handle(80, 1) : handle(w - 80, -1))
    else if (type === 'Double') prims.push(handle(w / 2 - 80, -1), handle(w / 2 + 80, 1))
    return prims
  },
}

export const windowKind: ParametricKind = {
  kind: 'arch.window',
  category: 'architecture',
  label: 'Window',
  description: 'Place it on a wall: it cuts the opening and follows the wall. The sill marks the outside.',
  params: [
    { ...WIDTH, default: 1200 },
    { key: 'panes', label: 'Panes', type: 'number', default: 2 },
    { key: 'glazing', label: 'Glazing', type: 'string', default: 'Double', options: ['Single', 'Double', 'Triple'] },
    HEIGHT(1250),
    { key: 'sill', label: 'Sill depth', type: 'number', default: 50, unit: 'length' },
    { key: 'sillHeight', label: 'Sill height', type: 'number', default: 900, unit: 'length' },
    OTHER_SIDE,
  ],
  opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
  size: { x: 'width' },
  sill: 'sillHeight',
  build({ width, panes, glazing, sill, flip }, env) {
    const w = atLeast(1, width)
    const h = (env.wallThickness ?? LOOSE_WALL) / 2
    const frame = Math.min(50, w / 4)
    // A line for each pane of glass, evenly across the middle of the wall.
    const gap = Math.min(h * 0.3, 25)
    const glass = glazing === 'Triple' ? [-gap, 0, gap] : glazing === 'Double' ? [-gap, gap] : [0]
    const n = count(panes)
    const prims: Primitive[] = [
      line([pt(0, -h), pt(w, -h)]),
      line([pt(0, h), pt(w, h)]),
      line([pt(frame, -h), pt(frame, h)], THIN),
      line([pt(w - frame, -h), pt(w - frame, h)], THIN),
      ...glass.map((y) => line([pt(frame, y), pt(w - frame, y)], THIN)),
    ]
    for (let i = 1; i < n; i++) {
      const x = frame + ((w - 2 * frame) * i) / n
      prims.push(line([pt(x, -h), pt(x, h)], THIN))
    }
    if (sill > 0) prims.push(outline([pt(-30, -h), pt(w + 30, -h), pt(w + 30, -h - sill), pt(-30, -h - sill)], THIN))
    return flip ? mirrorAcross(prims) : prims
  },
  // Seen from in front: from its sill height up, its frame, and a line between each pane.
  front({ width, height, panes, sillHeight }) {
    const w = atLeast(1, width)
    const bottom = -Math.max(0, Number(sillHeight) || 0) || 0
    const top = bottom - atLeast(1, height)
    const frame = Math.min(50, w / 4)
    const prims: Primitive[] = [outline([pt(0, bottom), pt(w, bottom), pt(w, top), pt(0, top)]), outline([pt(frame, bottom - frame), pt(w - frame, bottom - frame), pt(w - frame, top + frame), pt(frame, top + frame)], THIN)]
    const n = count(panes)
    for (let i = 1; i < n; i++) {
      const x = frame + ((w - 2 * frame) * i) / n
      prims.push(line([pt(x, bottom - frame), pt(x, top + frame)], THIN))
    }
    return prims
  },
}
