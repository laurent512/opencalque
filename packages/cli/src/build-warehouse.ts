// Generates the component libraries shipped in the warehouse (packages/warehouse/components).
// Run with `pnpm warehouse` after changing a definition below. Each library is an ordinary
// OpenCalque document whose components are the symbols; sizes are in millimetres, origin top-left.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, createDocument, pointInPolygon, roundCorners, serializeDocument, type NodeInput, type Op, type Vec2 } from '@opencalque/core'

type Shape = Record<string, unknown> & { type: string }
type Pt = [number, number]

/** A tenth of a millimetre is as fine as a symbol needs, and keeps the generated files short. */
const tenth = (v: number) => Math.round(v * 10) / 10
const vec = ([x, y]: Pt): Vec2 => ({ x: tenth(x), y: tenth(y) })

const rect = (x: number, y: number, width: number, height: number): Shape => ({ type: 'rect', x, y, width, height })
const oval = (cx: number, cy: number, rx: number, ry = rx): Shape => ({ type: 'ellipse', cx, cy, rx, ry })
const line = (x1: number, y1: number, x2: number, y2: number, dashed = false): Shape => ({
  type: 'line',
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  ...(dashed ? { style: { dash: [5, 4] } } : {}),
})
const text = (x: number, y: number, content: string, size: number): Shape => ({ type: 'text', x, y, text: content, size })
const INK = '#1f1f1f'
const filled = (shape: Shape): Shape => ({ ...shape, style: { fill: INK } })
const poly = (points: Pt[], closed = false): Shape => ({ type: 'polyline', points: points.map(vec), closed })
/** The points of part of a circle, from angle `from` to `to` in degrees, clockwise on the sheet from the right. */
const arcPoints = (cx: number, cy: number, r: number, from: number, to: number): [number, number][] =>
  Array.from({ length: 17 }, (_, i) => {
    const a = ((from + ((to - from) * i) / 16) * Math.PI) / 180
    return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))] as [number, number]
  })
/** Part of a circle as a polyline. */
const arc = (cx: number, cy: number, r: number, from: number, to: number): Shape => poly(arcPoints(cx, cy, r, from, to))
const cross = (cx: number, cy: number, r: number): Shape[] => {
  const d = Math.round(r * Math.SQRT1_2)
  return [line(cx - d, cy - d, cx + d, cy + d), line(cx - d, cy + d, cx + d, cy - d)]
}
// Electrical symbols that go on a wall are drawn hanging from their top edge: place that edge on the wall.
/** An earthed socket outlet: a half circle on a stem from the wall, with the earth contact as a bar where they meet. */
const socket = (x: number): Shape[] => [line(x + 150, 0, x + 150, 100), line(x + 90, 100, x + 210, 100), arc(x + 150, 250, 150, 180, 360)]
/** A switch: a small circle with a lever that ends in `ticks` strokes, drawn up to the right or down to the left. */
const lever = (cx: number, cy: number, up: boolean, ticks = 1): Shape[] => {
  const s = up ? 1 : -1
  const end = { x: cx + s * 225, y: cy - s * 225 }
  return [
    line(cx + s * 53, cy - s * 53, end.x, end.y),
    ...Array.from({ length: ticks }, (_, i) => line(end.x - s * i * 60, end.y + s * i * 60, end.x - s * i * 60 + s * 60, end.y + s * i * 60 + s * 60)),
  ]
}

// Furniture and fittings are drawn as they are seen from above, with what tells one from another:
// the cushions of a sofa, the pillows and turned-back duvet of a bed, the backrest of a chair. Their
// outlines are drawn at the usual weight and what lies within them in thin lines, the weight the
// built-in objects give their details. A placed component backs each of its closed shapes with
// white, under all of its lines: shapes that touch rather than overlap keep the drawing clear.

/** Drawn in thin lines: what lies within an outline. */
const thin = (shape: Shape): Shape => ({ ...shape, style: { ...(shape.style as object | undefined), strokeWidth: 0.5 } })
/** A path through the points with its corners rounded: one radius for all, or one for each point. */
const rounded = (points: Pt[], radius: number | number[], closed = true): Shape =>
  poly(
    roundCorners(
      points.map(([x, y]) => ({ x, y })),
      radius,
      closed,
    ).map((p): Pt => [p.x, p.y]),
    closed,
  )
/** A rectangle with rounded corners; four radii go clockwise from the top left. */
const roundRect = (x: number, y: number, width: number, height: number, radius: number | [number, number, number, number]): Shape =>
  rounded(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    radius,
  )
/** The points of part of a circle, unrounded, from angle `from` to `to` in degrees, clockwise from the right. */
const along = ([cx, cy]: Pt, r: number, from: number, to: number, steps = 16): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
/** A curved bar along part of a circle, with round ends, as the backrest of a chair is: `r` is the circle through its middle. */
function band(cx: number, cy: number, r: number, thickness: number, from: number, to: number): Shape {
  const h = thickness / 2
  const end = (a: number): Pt => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  return poly(
    [
      ...along([cx, cy], r + h, from, to, 24),
      ...along(end(to), h, to, to + 180, 8).slice(1, -1),
      ...along([cx, cy], r - h, to, from, 24),
      ...along(end(from), h, from + 180, from + 360, 8).slice(1, -1),
    ],
    true,
  )
}
/**
 * A bowl seen from above, its back toward the wall at the top: nearly square at the back (the
 * higher `square`, the squarer) and round at the front, `back` and `front` deep from (cx, cy).
 */
function bowl(cx: number, cy: number, halfWidth: number, back: number, front: number, square = 5): Pt[] {
  return Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * 2 * Math.PI
    const [c, s] = [Math.cos(t), Math.sin(t)]
    const power = (v: number, n: number) => Math.sign(v) * Math.abs(v) ** (2 / n)
    const n = s < 0 ? square : 2.2
    return [cx + halfWidth * power(c, n), cy + (s < 0 ? back : front) * power(s, n)]
  })
}
/** Where a horizontal line at `y` crosses a closed outline: its leftmost and rightmost points there. */
function across(outline: Pt[], y: number): [number, number] {
  const xs = outline.flatMap(([x1, y1], i) => {
    const [x2, y2] = outline[(i + 1) % outline.length]
    return (y1 - y) * (y2 - y) <= 0 && y1 !== y2 ? [x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)] : []
  })
  return [Math.min(...xs), Math.max(...xs)]
}
/** The points a shape is drawn through, for the transforms below. */
function pointsOf(shape: Shape): Vec2[] {
  if (shape.type === 'polyline') return shape.points as Vec2[]
  if (shape.type === 'line') return [shape.a as Vec2, shape.b as Vec2]
  if (shape.type === 'rect') {
    const { x, y, width, height } = shape as unknown as { x: number; y: number; width: number; height: number }
    return [
      { x, y },
      { x: x + width, y: y + height },
    ]
  }
  if (shape.type === 'ellipse') {
    const { cx, cy, rx, ry } = shape as unknown as { cx: number; cy: number; rx: number; ry: number }
    return [
      { x: cx - rx, y: cy - ry },
      { x: cx + rx, y: cy + ry },
    ]
  }
  return []
}
/**
 * Shapes moved by (dx, dy) after a turn of `turn` degrees about the origin: a whole symbol set in
 * place in a larger one, such as the chairs round a table. A rectangle turned becomes a polyline.
 */
function placed(shapes: Shape[], dx: number, dy: number, turn: 0 | 90 | 180 | 270 = 0): Shape[] {
  const [c, s] = [Math.round(Math.cos((turn * Math.PI) / 180)), Math.round(Math.sin((turn * Math.PI) / 180))]
  const map = ({ x, y }: Vec2): Vec2 => ({ x: tenth(x * c - y * s + dx), y: tenth(x * s + y * c + dy) })
  return shapes.map((shape): Shape => {
    if (shape.type === 'polyline') return { ...shape, points: (shape.points as Vec2[]).map(map) }
    if (shape.type === 'line') return { ...shape, a: map(shape.a as Vec2), b: map(shape.b as Vec2) }
    if (shape.type === 'ellipse') {
      const centre = map({ x: shape.cx as number, y: shape.cy as number })
      return { ...shape, cx: centre.x, cy: centre.y, ...(turn % 180 ? { rx: shape.ry, ry: shape.rx } : {}) }
    }
    if (shape.type === 'rect') {
      const { x, y, width, height } = shape as unknown as { x: number; y: number; width: number; height: number }
      if (turn === 0) return { ...shape, ...map({ x, y }) }
      const corners: Vec2[] = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ]
      const { width: _, height: __, x: ___, y: ____, ...rest } = shape
      return { ...rest, type: 'polyline', points: corners.map(map), closed: true }
    }
    return { ...shape, ...map({ x: shape.x as number, y: shape.y as number }) }
  })
}
/** Shapes moved so that what they cover starts at the origin, as every symbol of a library does. */
function fromOrigin(shapes: Shape[]): Shape[] {
  const points = shapes.flatMap(pointsOf)
  return placed(shapes, -Math.min(...points.map((p) => p.x)), -Math.min(...points.map((p) => p.y)))
}
/** The size of what shapes cover, rounded to the millimetre. */
function sizeOf(shapes: Shape[]): { width: number; height: number } {
  const points = shapes.flatMap(pointsOf)
  const span = (values: number[]) => Math.round(Math.max(...values) - Math.min(...values))
  return { width: span(points.map((p) => p.x)), height: span(points.map((p) => p.y)) }
}
/**
 * The stretches of a path that lie outside every closed shape in `cover`, as open paths: the base
 * of a chair seen where the seat above it does not hide it.
 */
function uncovered(path: Pt[], cover: Shape[]): Shape[] {
  const outlines = cover.flatMap((shape) => (shape.type === 'polyline' && shape.closed ? [shape.points as Vec2[]] : []))
  const hidden = ([x, y]: Pt) => outlines.some((outline) => pointInPolygon({ x, y }, outline))
  // The path walked in steps of a millimetre or two, each point kept or not.
  const walked = path.slice(1).flatMap((b, i) => {
    const a = path[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2))
    return Array.from({ length: steps + (i === path.length - 2 ? 1 : 0) }, (_, k): Pt => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps])
  })
  const out: Shape[] = []
  let run: Pt[] = []
  const flush = () => {
    // Only the points where the path turns are kept, and the two ends.
    const kept = run.filter((p, i) => i === 0 || i === run.length - 1 || path.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 1e-6))
    if (run.length > 1) out.push(thin(poly(kept)))
    run = []
  }
  for (const p of walked) {
    if (hidden(p)) flush()
    else run.push(p)
  }
  flush()
  return out
}

/** A dining chair, 450 × 480, its back at the top: a seat rounder at the front, and a curved backrest behind it. */
const chair = (): Shape[] => [band(225, 662, 640, 44, 253, 287), roundRect(0, 76, 450, 404, [30, 30, 75, 75])]

/**
 * An office chair, its back at the top: a curved backrest, a seat rounder at the front, two
 * armrests, and the five legs of its base on their casters, seen where the seat does not hide them.
 */
function officeChair(): Shape[] {
  const body = [band(330, 900, 820, 70, 253, 287), roundRect(92, 150, 476, 440, [60, 60, 110, 110]), roundRect(46, 215, 42, 290, 21), roundRect(572, 215, 42, 290, 21)]
  const [cx, cy, reach] = [330, 370, 330]
  // One leg straight back, under the backrest: the others then show at the front corners and beside the armrests.
  const base = [270, 342, 54, 126, 198].flatMap((angle) => {
    const [dx, dy] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]
    const ring = along([cx + reach * dx, cy + reach * dy], 28, 0, 360, 24)
    const caster = poly(ring, true)
    // The two sides of a leg, narrowing toward its caster.
    const sides = [1, -1].flatMap((side) =>
      uncovered(
        [
          [cx - side * 18 * dy, cy + side * 18 * dx],
          [cx + reach * dx - side * 12 * dy, cy + reach * dy + side * 12 * dx],
        ],
        [...body, caster],
      ),
    )
    return [...uncovered(ring, body), ...sides]
  })
  return fromOrigin([...base, ...body])
}
const OFFICE_CHAIR = sizeOf(officeChair())

/** A sofa of `seats` seats, its back at the top: a frame round its back and arms, a back cushion and a seat cushion for each seat. */
function sofa(width: number, seats: number, depth = 850): Shape[] {
  const [arm, back] = [170, 170]
  const seat = (width - 2 * arm) / seats
  const frame = rounded(
    [
      [0, 0],
      [width, 0],
      [width, depth],
      [width - arm, depth],
      [width - arm, back],
      [arm, back],
      [arm, depth],
      [0, depth],
    ],
    [60, 60, 50, 50, 10, 10, 50, 50],
  )
  return [
    frame,
    ...Array.from({ length: seats }, (_, k) => [
      roundRect(arm + k * seat + 6, back + 6, seat - 12, 160, 40),
      roundRect(arm + k * seat + 6, back + 178, seat - 12, depth - back - 186, 45),
    ]).flat(),
  ]
}

/** A bed, its head at the top: a headboard, a pillow or two, and the duvet with one corner turned back. */
function bed(width: number, length = 2000): Shape[] {
  const pillows = width >= 1400 ? 2 : 1
  const pillow = (width - 160 - (pillows - 1) * 60) / pillows
  const fold = Math.min(500, width * 0.3)
  const edge = 620
  return [
    roundRect(0, 0, width, length, 25),
    line(0, 50, width, 50),
    ...Array.from({ length: pillows }, (_, i) => roundRect(80 + i * (pillow + 60), 100, pillow, 380, 90)),
    line(0, edge, width - fold, edge),
    poly(
      [
        [width - fold, edge],
        [width, edge + fold],
        [width - fold, edge + fold],
      ],
      true,
    ),
  ]
}

/** A wardrobe, its back at the top: doors along the front, and in each half a rail with clothes on hangers. */
function wardrobe(width = 1800, depth = 600): Shape[] {
  const front = depth - 25
  const doors = Math.max(1, Math.round(width / 450))
  const rail = front / 2
  // Hangers lean a little this way and that, as they do on a rail.
  const lean = [12, -8, 4, -14, 9, -5, 13, -10, 6]
  const half = (x0: number, x1: number): Shape[] => {
    const count = Math.floor((x1 - x0 - 140) / 95) + 1
    const offset = (x1 - x0 - (count - 1) * 95) / 2
    return [
      thin(line(x0 + 40, rail, x1 - 40, rail)),
      ...Array.from({ length: count }, (_, i) => {
        const x = x0 + offset + i * 95
        return thin(line(x - lean[i % lean.length], rail - 220, x + lean[i % lean.length], rail + 220))
      }),
    ]
  }
  return [
    rect(0, 0, width, depth),
    line(0, front, width, front),
    ...Array.from({ length: doors - 1 }, (_, i) => line(((i + 1) * width) / doors, front, ((i + 1) * width) / doors, depth)),
    line(width / 2, 0, width / 2, front),
    ...half(0, width / 2),
    ...half(width / 2, width),
  ]
}

/** A desk with a screen, a keyboard and a mouse on it, and its office chair pulled up to it. */
function desk(width = 1400, depth = 700): Shape[] {
  const mid = width / 2
  return [
    rect(0, 0, width, depth),
    thin(roundRect(mid - 70, 100, 140, 80, 20)),
    thin(roundRect(mid - 280, 180, 560, 32, 12)),
    thin(roundRect(mid - 220, 380, 440, 150, 16)),
    thin(oval(mid + 310, 455, 30, 48)),
    ...placed(officeChair(), mid + OFFICE_CHAIR.width / 2, depth + 20 + OFFICE_CHAIR.height, 180),
  ]
}

/** A toilet standing on the floor: its cistern against the wall with a dual flush button, the bowl, and the opening of its seat. */
function toilet(): Shape[] {
  return [
    roundRect(0, 0, 380, 170, [8, 8, 30, 30]),
    thin(oval(190, 85, 32)),
    thin(line(158, 85, 222, 85)),
    poly(bowl(190, 300, 180, 130, 400), true),
    oval(190, 445, 118, 205),
  ]
}

/** A toilet hung on the wall, its cistern in the wall: the bowl, the opening of its seat, and the line of its hinge. */
function wallHungToilet(): Shape[] {
  const outline = bowl(180, 150, 180, 150, 390, 6)
  const [left, right] = across(outline, 100)
  return [poly(outline, true), oval(180, 330, 112, 180), thin(line(tenth(left), 100, tenth(right), 100))]
}

/** A shower tray: its rim, the slopes to the drain in the middle, and the drain's grating. */
function showerTray(size = 900): Shape[] {
  const c = size / 2
  // From the middle of each rounded inner corner to the edge of the drain.
  const corner = 40 + 30 * (1 - Math.SQRT1_2)
  const drain = c - 50 * Math.SQRT1_2
  const slopes = (
    [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const
  ).map(([sx, sy]) => thin(line(tenth(c - sx * (c - corner)), tenth(c - sy * (c - corner)), tenth(c - sx * (c - drain)), tenth(c - sy * (c - drain)))))
  return [roundRect(0, 0, size, size, 10), thin(roundRect(40, 40, size - 80, size - 80, 30)), ...slopes, oval(c, c, 50), thin(oval(c, c, 28))]
}

interface Library {
  id: string
  name: string
  description: string
  /**
   * In the order they keep: a component is known by its place (see below). One taken out leaves
   * its place empty (null), so that those after it keep theirs. A component may say the room it
   * is for ('bedroom', 'dining'…), under which the component library lists it rather than under
   * the library's name.
   */
  components: ([name: string, description: string, shapes: Shape[], room?: string] | null)[]
}

const LIBRARIES: Library[] = [
  {
    id: 'furniture',
    name: 'Furniture',
    description: 'Beds, seating, tables and storage for furnishing a plan.',
    components: [
      ['Double bed', '1600 × 2000', bed(1600), 'bedroom'],
      ['Single bed', '900 × 2000', bed(900), 'bedroom'],
      ['Sofa, two seats', '1600 × 850', sofa(1600, 2), 'living'],
      ['Armchair', '850 × 850', sofa(850, 1), 'living'],
      ['Chair', '450 × 480', chair(), 'dining'],
      ['Dining table, six chairs', '1800 × 900 table', [rect(0, 530, 1800, 900), ...[150, 675, 1200].flatMap((x) => [...placed(chair(), x, 0), ...placed(chair(), x + 450, 1960, 180)])], 'dining'],
      ['Desk with chair', '1400 × 700', desk(), 'office'],
      ['Wardrobe', '1800 × 600', wardrobe(), 'bedroom'],
      ['Coffee table, round', 'Ø 900', [oval(450, 450, 450), thin(oval(450, 450, 410))], 'living'],
    ],
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    description: 'Sanitary fittings.',
    components: [
      ['Toilet', '380 × 700', toilet()],
      // The washbasin is a parametric object now (in the built-in extension): its counter is resized, its bowls keep their size.
      null,
      // The bathtub is a parametric object now (in the built-in extension): its rim keeps its thickness when it is resized.
      null,
      ['Shower tray', '900 × 900', showerTray()],
      // Added after the others: a component already imported from a library is known by its place in it.
      // This place held a double washbasin while it was being made, then the wall-hung toilet in
      // 1.0.0-rc.3; drawings hold either under it, so it stays empty, neither to be taken for the other.
      null,
      // Hung on the wall with its cistern in it: a straight back, a rounded front, the hinge of its seat.
      ['Toilet, wall-hung', '360 × 540', wallHungToilet()],
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    description: 'Units and appliances on a 600 mm module.',
    components: [
      ['Base unit', '600 × 600', [rect(0, 0, 600, 600)]],
      // The sink unit, the hob and the fridge are parametric objects now (in the built-in extension),
      // made wider by their sides: a sink with or without its draining board, a hob of 80 or 90 cm,
      // an American fridge beside the plain one.
      null,
      null,
      null,
      // Its controls along the back, its door in front of the drum.
      ['Washing machine', '600 × 600', [roundRect(0, 0, 600, 600, 20), line(0, 110, 600, 110), thin(roundRect(60, 35, 200, 45, 8)), thin(oval(480, 55, 28)), oval(300, 355, 200), thin(oval(300, 355, 150))]],
    ],
  },
]

LIBRARIES.push({
  id: 'electrical',
  name: 'Electrical',
  description: 'Lights, wall lights, sockets, switches and other symbols for an electrical plan.',
  components: [
    ['Ceiling light', 'Ø 300', [oval(150, 150, 150), ...cross(150, 150, 150)]],
    ['Pendant light', 'Ø 300', [oval(150, 150, 150), oval(150, 150, 90), ...cross(150, 150, 90)]],
    ['Wall light', 'Top edge on the wall', [line(0, 0, 300, 0), arc(150, 0, 150, 0, 180), line(150, 0, 256, 106), line(150, 0, 44, 106)]],
    ['Recessed spotlight', 'Ø 120', [oval(60, 60, 60), filled(oval(60, 60, 25))]],
    ['Light strip', '1200 × 100', [rect(0, 0, 1200, 100), line(0, 50, 1200, 50)]],
    ['Socket', 'Top edge on the wall', socket(0)],
    ['Double socket', 'Top edge on the wall', [...socket(0), ...socket(330)]],
    ['Socket, 32 A', 'For a cooker. Top edge on the wall', [line(150, 0, 150, 100), filled({ ...arc(150, 250, 150, 180, 360), closed: true })]],
    ['TV socket', 'Top edge on the wall', [...socket(0), text(75, 400, 'TV', 130)]],
    ['Network socket', 'RJ45', [rect(0, 0, 300, 300), text(25, 195, 'RJ45', 100)]],
    ['Switch', 'One-way', [oval(75, 300, 75), ...lever(75, 300, true)]],
    ['Double switch', 'Two circuits', [oval(75, 300, 75), ...lever(75, 300, true, 2)]],
    ['Two-way switch', 'One of two controlling the same light', [oval(300, 300, 75), ...lever(300, 300, true), ...lever(300, 300, false)]],
    ['Push button', 'Ø 200', [oval(100, 100, 100), oval(100, 100, 45)]],
    ['Dimmer', 'Switch with a dimmer', [oval(75, 300, 75), ...lever(75, 300, true), filled(poly([[75, 262], [108, 322], [42, 322]], true))]],
    ['Consumer unit', '600 × 250', [rect(0, 0, 600, 250), filled(poly([[0, 250], [600, 0], [600, 250]], true))]],
    ['Junction box', '200 × 200', [rect(0, 0, 200, 200), ...cross(100, 100, 141)]],
    ['Smoke detector', '300 × 300', [rect(0, 0, 300, 300), oval(150, 150, 100), filled(oval(150, 150, 30))]],
    ['Extractor fan', 'Ø 400', [oval(200, 200, 200), poly([[60, 100], [340, 300], [340, 100], [60, 300]], true)]],
    ['Electric radiator', '1000 × 120', [rect(0, 0, 1000, 120), ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((x) => line(x, 0, x, 120))]],
  ],
})

/** Names and descriptions in French, Spanish, German, Chinese, Japanese, Korean and Turkish, in that order, by the English text. Sizes need none. */
const TRANSLATIONS: Record<string, [fr: string, es: string, de: string, zh: string, ja: string, ko: string, tr: string]> = {
  Furniture: ['Mobilier', 'Mobiliario', 'Möbel', '家具', '家具', '가구', 'Mobilya'],
  'Beds, seating, tables and storage for furnishing a plan.': ['Lits, sièges, tables et rangements pour meubler un plan.', 'Camas, asientos, mesas y almacenaje para amueblar un plano.', 'Betten, Sitzmöbel, Tische und Stauraum zum Möblieren eines Plans.', '床、座椅、桌子和储物家具，用于平面布置。', 'ベッド、いす、テーブル、収納で図面に家具を配置します。', '평면도에 가구를 배치하기 위한 침대, 의자, 테이블, 수납가구.', 'Bir planı döşemek için yataklar, oturma elemanları, masalar ve dolaplar.'],
  'Double bed': ['Lit double', 'Cama doble', 'Doppelbett', '双人床', 'ダブルベッド', '더블 침대', 'Çift kişilik yatak'],
  'Single bed': ['Lit simple', 'Cama individual', 'Einzelbett', '单人床', 'シングルベッド', '싱글 침대', 'Tek kişilik yatak'],
  'Sofa, two seats': ['Canapé deux places', 'Sofá de dos plazas', 'Sofa, Zweisitzer', '双人沙发', '2 人掛けソファ', '2인용 소파', 'İki kişilik kanepe'],
  Armchair: ['Fauteuil', 'Sillón', 'Sessel', '扶手椅', 'アームチェア', '안락의자', 'Koltuk'],
  Chair: ['Chaise', 'Silla', 'Stuhl', '椅子', 'いす', '의자', 'Sandalye'],
  'Dining table, six chairs': ['Table à manger, six chaises', 'Mesa de comedor, seis sillas', 'Esstisch, sechs Stühle', '餐桌，六把椅子', 'ダイニングテーブル（いす 6 脚）', '식탁, 의자 6개', 'Yemek masası, altı sandalye'],
  '1800 × 900 table': ['table 1800 × 900', 'mesa 1800 × 900', 'Tisch 1800 × 900', '1800 × 900 桌', '1800 × 900 テーブル', '1800 × 900 테이블', '1800 × 900 masa'],
  'Desk with chair': ['Bureau avec chaise', 'Escritorio con silla', 'Schreibtisch mit Stuhl', '书桌和椅子', 'デスクといす', '책상과 의자', 'Sandalyeli çalışma masası'],
  Wardrobe: ['Armoire', 'Armario', 'Kleiderschrank', '衣柜', 'ワードローブ', '옷장', 'Gardırop'],
  'Coffee table, round': ['Table basse ronde', 'Mesa de centro redonda', 'Couchtisch, rund', '圆形茶几', '丸いローテーブル', '원형 커피 테이블', 'Sehpa, yuvarlak'],
  Bathroom: ['Salle de bain', 'Baño', 'Bad', '卫生间', '浴室・トイレ', '욕실', 'Banyo'],
  'Sanitary fittings.': ['Appareils sanitaires.', 'Aparatos sanitarios.', 'Sanitärobjekte.', '卫生洁具。', '衛生器具。', '위생 기구.', 'Vitrifiye ve armatürler.'],
  Toilet: ['WC', 'Inodoro', 'WC', '坐便器', '便器', '양변기', 'Klozet'],
  'Shower tray': ['Receveur de douche', 'Plato de ducha', 'Duschwanne', '淋浴底盘', 'シャワーパン', '샤워 트레이', 'Duş teknesi'],
  'Toilet, wall-hung': ['WC suspendu', 'Inodoro suspendido', 'Wand-WC', '壁挂式坐便器', '壁掛け便器', '벽걸이 양변기', 'Asma klozet'],
  Kitchen: ['Cuisine', 'Cocina', 'Küche', '厨房', 'キッチン', '주방', 'Mutfak'],
  'Units and appliances on a 600 mm module.': ['Meubles et appareils sur un module de 600 mm.', 'Muebles y electrodomésticos en módulo de 600 mm.', 'Schränke und Geräte im 600-mm-Raster.', '按 600 mm 模数排布的橱柜和电器。', '600 mm モジュールのキャビネットと家電。', '600 mm 모듈의 수납장과 가전.', '600 mm modülde dolaplar ve cihazlar.'],
  'Base unit': ['Meuble bas', 'Mueble bajo', 'Unterschrank', '地柜', 'ベースキャビネット', '하부장', 'Alt dolap'],
  'Washing machine': ['Lave-linge', 'Lavadora', 'Waschmaschine', '洗衣机', '洗濯機', '세탁기', 'Çamaşır makinesi'],
  Electrical: ['Électricité', 'Electricidad', 'Elektro', '电气', '電気', '전기', 'Elektrik'],
  'Lights, wall lights, sockets, switches and other symbols for an electrical plan.': ['Luminaires, appliques, prises, interrupteurs et autres symboles pour un plan électrique.', 'Luminarias, apliques, enchufes, interruptores y otros símbolos para un plano eléctrico.', 'Leuchten, Wandleuchten, Steckdosen, Schalter und weitere Symbole für einen Elektroplan.', '灯具、壁灯、插座、开关及其他电气平面图符号。', '照明、ブラケット、コンセント、スイッチなど電気設備図の記号。', '전기 설비도에 쓰는 조명, 벽등, 콘센트, 스위치 등의 기호.', 'Bir elektrik planı için armatürler, aplikler, prizler, anahtarlar ve diğer semboller.'],
  'Ceiling light': ['Plafonnier', 'Luz de techo', 'Deckenleuchte', '吸顶灯', 'シーリングライト', '천장등', 'Tavan armatürü'],
  'Pendant light': ['Suspension', 'Lámpara colgante', 'Pendelleuchte', '吊灯', 'ペンダントライト', '펜던트 조명', 'Sarkıt armatür'],
  'Wall light': ['Applique murale', 'Aplique de pared', 'Wandleuchte', '壁灯', 'ブラケット', '벽등', 'Aplik'],
  'Top edge on the wall': ['Bord supérieur contre le mur', 'Borde superior contra la pared', 'Oberkante an die Wand', '上边靠墙', '上辺を壁に付ける', '위쪽 변을 벽에 붙임', 'Üst kenarı duvara'],
  'Recessed spotlight': ['Spot encastré', 'Foco empotrado', 'Einbaustrahler', '嵌入式射灯', 'ダウンライト', '매입등', 'Gömme spot'],
  'Light strip': ['Réglette lumineuse', 'Regleta de luz', 'Lichtleiste', '灯带', 'ライン照明', '라인 조명', 'Işık şeridi'],
  Socket: ['Prise de courant', 'Enchufe', 'Steckdose', '插座', 'コンセント', '콘센트', 'Priz'],
  'Double socket': ['Prise double', 'Enchufe doble', 'Doppelsteckdose', '双联插座', '2 口コンセント', '2구 콘센트', 'İkili priz'],
  'Socket, 32 A': ['Prise 32 A', 'Enchufe de 32 A', 'Steckdose, 32 A', '32 A 插座', '32 A コンセント', '32 A 콘센트', 'Priz, 32 A'],
  'For a cooker. Top edge on the wall': ['Pour une cuisinière. Bord supérieur contre le mur', 'Para una cocina. Borde superior contra la pared', 'Für einen Herd. Oberkante an die Wand', '用于电灶。上边靠墙', '電気コンロ用。上辺を壁に付ける', '전기레인지용. 위쪽 변을 벽에 붙임', 'Elektrikli ocak için. Üst kenarı duvara'],
  'TV socket': ['Prise TV', 'Toma de TV', 'TV-Dose', '电视插座', 'テレビ端子', 'TV 단자', 'TV prizi'],
  'Network socket': ['Prise réseau', 'Toma de red', 'Netzwerkdose', '网络插座', 'LAN 端子', 'LAN 단자', 'Ağ prizi'],
  Switch: ['Interrupteur', 'Interruptor', 'Schalter', '开关', 'スイッチ', '스위치', 'Anahtar'],
  'One-way': ['Simple allumage', 'Simple', 'Ausschalter', '单控', '片切', '단로', 'Tek yönlü'],
  'Double switch': ['Interrupteur double', 'Interruptor doble', 'Serienschalter', '双联开关', '2 連スイッチ', '2구 스위치', 'Komütatör anahtar'],
  'Two circuits': ['Deux circuits', 'Dos circuitos', 'Zwei Stromkreise', '两路', '2 回路', '2회로', 'İki devre'],
  'Two-way switch': ['Va-et-vient', 'Conmutador', 'Wechselschalter', '双控开关', '3 路スイッチ', '3로 스위치', 'Vaviyen anahtar'],
  'One of two controlling the same light': ['L’un des deux qui commandent la même lumière', 'Uno de los dos que controlan la misma luz', 'Einer von zweien für dieselbe Leuchte', '两个开关之一，共同控制同一盏灯', '同じ照明を 2 か所で入り切りするスイッチの一方', '같은 조명을 두 곳에서 켜고 끄는 스위치 중 하나', 'Aynı lambayı yöneten iki anahtardan biri'],
  'Push button': ['Bouton-poussoir', 'Pulsador', 'Taster', '按钮开关', '押しボタン', '푸시 버튼', 'Buton'],
  Dimmer: ['Variateur', 'Regulador de luz', 'Dimmer', '调光器', '調光器', '조광기', 'Dimmer'],
  'Switch with a dimmer': ['Interrupteur avec variateur', 'Interruptor con regulador', 'Schalter mit Dimmer', '带调光的开关', '調光スイッチ', '조광 스위치', 'Dimmerli anahtar'],
  'Consumer unit': ['Tableau électrique', 'Cuadro eléctrico', 'Sicherungskasten', '配电箱', '分電盤', '분전반', 'Sigorta kutusu'],
  'Junction box': ['Boîte de dérivation', 'Caja de derivación', 'Abzweigdose', '接线盒', 'ジョイントボックス', '정션 박스', 'Buat'],
  'Smoke detector': ['Détecteur de fumée', 'Detector de humo', 'Rauchmelder', '烟雾探测器', '煙感知器', '연기 감지기', 'Duman dedektörü'],
  'Extractor fan': ['Extracteur d’air (VMC)', 'Extractor de aire', 'Abluftventilator', '排气扇', '換気扇', '환풍기', 'Aspiratör'],
  'Electric radiator': ['Radiateur électrique', 'Radiador eléctrico', 'Elektroheizkörper', '电暖器', '電気ヒーター', '전기 라디에이터', 'Elektrikli radyatör'],
}

/** The translations of the texts one library shows, by language code and then by the English text. */
function translationsOf(library: Library): Record<string, Record<string, string>> {
  const texts = [library.name, library.description, ...library.components.flatMap((component) => (component ? [component[0], component[1]] : []))]
  const out: Record<string, Record<string, string>> = { fr: {}, es: {}, de: {}, zh: {}, ja: {}, ko: {}, tr: {} }
  for (const english of texts) {
    const found = TRANSLATIONS[english]
    if (!found) continue
    ;(['fr', 'es', 'de', 'zh', 'ja', 'ko', 'tr'] as const).forEach((language, i) => (out[language][english] = found[i]))
  }
  return out
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../../warehouse/components')
mkdirSync(out, { recursive: true })
const index = LIBRARIES.map((library) => {
  const ops: Op[] = []
  library.components.forEach((component, i) => {
    if (!component) return
    const [name, description, shapes] = component
    const id = `${library.id}_${i + 1}`
    ops.push({ op: 'add_node', node: { type: 'component', id, name, description } })
    // Ids of their own, the same each time, so that a library changes only where its components do.
    shapes.forEach((shape, j) => ops.push({ op: 'add_node', node: { ...shape, id: `${id}_${j + 1}`, parent: id } as NodeInput }))
  })
  // A fixed document id, so a component imported twice (even after an update) is recognised.
  const doc = { ...applyOps(createDocument(library.name), ops), id: `warehouse.${library.id}` }
  writeFileSync(join(out, `${library.id}.opencalque`), serializeDocument(doc))
  // The room each component is for, by its id, for those that say one.
  const rooms = Object.fromEntries(library.components.flatMap((component, i) => (component?.[3] ? [[`${library.id}_${i + 1}`, component[3]]] : [])))
  return {
    id: library.id,
    name: library.name,
    description: library.description,
    file: `${library.id}.opencalque`,
    components: library.components.filter(Boolean).length,
    ...(Object.keys(rooms).length > 0 ? { categories: rooms } : {}),
    translations: translationsOf(library),
  }
})
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Wrote ${index.length} libraries, ${index.reduce((n, l) => n + l.components, 0)} components, to ${out}`)
