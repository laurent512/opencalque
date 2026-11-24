import * as z from 'zod'
import { arcPoints, roundCorners } from './geometry'
import type { Primitive } from './primitives'
import type { Vec2 } from './geometry'
import type { Extension, KindSolid, ParametricKind } from './registry'

/**
 * Extensions written as data instead of code. A declarative extension describes parametric
 * objects with shapes whose coordinates are small arithmetic expressions over the object's
 * parameters. Because it contains no code it can be downloaded and installed safely: the worst a
 * bad one can do is draw nonsense.
 */

// ---------------------------------------------------------------------------- expressions

type Value = number | string | boolean
type Scope = Record<string, Value>
type Compiled = (scope: Scope) => Value

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  sin: (degrees) => Math.sin((degrees * Math.PI) / 180),
  cos: (degrees) => Math.cos((degrees * Math.PI) / 180),
}

const TOKEN = /\s*(\d+\.?\d*|\.\d+|[A-Za-z_]\w*|'[^']*'|"[^"]*"|==|!=|<=|>=|&&|\|\||[-+*/%()<>!?:,])/y

/**
 * Compiles an expression such as `width / 2 - 50` or `type == 'Double' ? 2 : 1`. Supports
 * numbers, quoted text, the names in scope, arithmetic, comparisons, `&&`, `||`, `!`, `?:` and the
 * functions min, max, abs, floor, ceil, round, sqrt, sin and cos (angles in degrees). Nothing else
 * is reachable from an expression.
 */
export function compileExpression(source: string | number | boolean): Compiled {
  if (typeof source !== 'string') return () => source
  const tokens: string[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex
    const match = TOKEN.exec(source)
    if (!match) {
      if (source.slice(start).trim() === '') break
      throw new Error(`Cannot read "${source}" near "${source.slice(start, start + 12)}"`)
    }
    tokens.push(match[1])
  }
  let at = 0
  const peek = () => tokens[at]
  const take = (expected?: string) => {
    if (expected !== undefined && tokens[at] !== expected) throw new Error(`Expected "${expected}" in "${source}"`)
    return tokens[at++]
  }
  const number = (v: Value) => (typeof v === 'boolean' ? Number(v) : typeof v === 'number' ? v : NaN)

  const binary = (next: () => Compiled, ops: Record<string, (a: Value, b: Value) => Value>) => (): Compiled => {
    let left = next()
    while (peek() in ops) {
      const op = ops[take()]
      const a = left
      const b = next()
      left = (scope) => op(a(scope), b(scope))
    }
    return left
  }

  const primary = (): Compiled => {
    const token = take()
    if (token === undefined) throw new Error(`"${source}" ends too soon`)
    if (token === '(') {
      const inner = ternary()
      take(')')
      return inner
    }
    if (token === '-') {
      const inner = primary()
      return (scope) => -number(inner(scope))
    }
    if (token === '!') {
      const inner = primary()
      return (scope) => !inner(scope)
    }
    if (/^[\d.]/.test(token)) return () => Number(token)
    if (/^['"]/.test(token)) return () => token.slice(1, -1)
    if (!/^[A-Za-z_]/.test(token)) throw new Error(`Unexpected "${token}" in "${source}"`)
    if (peek() === '(') {
      const fn = FUNCTIONS[token]
      if (!fn) throw new Error(`Unknown function "${token}" in "${source}"`)
      take('(')
      const args: Compiled[] = []
      while (peek() !== ')') {
        args.push(ternary())
        if (peek() === ',') take()
      }
      take(')')
      return (scope) => fn(...args.map((arg) => number(arg(scope))))
    }
    return (scope) => {
      // Own names only: `in` would also find what every object inherits, such as "constructor".
      if (!Object.hasOwn(scope, token)) throw new Error(`Unknown name "${token}" in "${source}"`)
      return scope[token]
    }
  }
  const product = binary(primary, { '*': (a, b) => number(a) * number(b), '/': (a, b) => number(a) / number(b), '%': (a, b) => number(a) % number(b) })
  const sum = binary(product, { '+': (a, b) => number(a) + number(b), '-': (a, b) => number(a) - number(b) })
  const comparison = binary(sum, {
    '<': (a, b) => number(a) < number(b),
    '<=': (a, b) => number(a) <= number(b),
    '>': (a, b) => number(a) > number(b),
    '>=': (a, b) => number(a) >= number(b),
    '==': (a, b) => a === b,
    '!=': (a, b) => a !== b,
  })
  const and = binary(comparison, { '&&': (a, b) => Boolean(a) && Boolean(b) })
  const or = binary(and, { '||': (a, b) => Boolean(a) || Boolean(b) })
  function ternary(): Compiled {
    const condition = or()
    if (peek() !== '?') return condition
    take('?')
    const yes = ternary()
    take(':')
    const no = ternary()
    return (scope) => (condition(scope) ? yes(scope) : no(scope))
  }

  const compiled = ternary()
  if (at < tokens.length) throw new Error(`Unexpected "${tokens[at]}" in "${source}"`)
  return compiled
}

// ---------------------------------------------------------------------------- format

const Expr = z.union([z.number(), z.string(), z.boolean()]).describe('A number, or an expression over the parameters such as "width / 2".')
const Look = {
  when: Expr.optional().describe('Draw this shape only when the expression is true.'),
  repeat: z
    .object({ count: Expr, as: z.string().regex(/^[A-Za-z_]\w*$/).optional() })
    .optional()
    .describe('Draw the shape `count` times; the index (0, 1, 2…) is available under the name given by `as` (default "i").'),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  dash: z.array(z.number().positive()).optional(),
}

const ShapeSchema = z.union([
  z
    .object({
      ...Look,
      path: z.array(z.tuple([Expr, Expr])).min(2),
      closed: z.boolean().optional(),
      radius: Expr.optional().describe('Rounds its corners: each becomes an arc of this radius, made smaller where the sides are too short to hold it. The ends of an open path stay as they are.'),
    })
    .describe('Straight segments through the points.'),
  z.object({ ...Look, ellipse: z.object({ cx: Expr, cy: Expr, rx: Expr, ry: Expr }) }),
  z
    .object({ ...Look, arc: z.object({ cx: Expr, cy: Expr, r: Expr, from: Expr, to: Expr }), closed: z.boolean().optional().describe('Joins its ends with a straight line, so that it can be filled: a half disc.') })
    .describe('Part of a circle; angles in degrees, 0 pointing right and 90 down.'),
  z.object({ ...Look, text: z.object({ x: Expr, y: Expr, value: z.string(), size: Expr, align: z.enum(['left', 'center']).optional() }) }),
])

const Solid = {
  when: Look.when,
  repeat: Look.repeat,
  bottom: Expr.describe('Where it starts, in mm above where the object stands (the floor, or its height above it). An expression over the parameters, not the index of a repeat.'),
  top: Expr.describe('Where it ends, in mm, as "bottom".'),
  finish: z.enum(['plain', 'dark', 'metal', 'glass']).optional().describe('What it looks like: as the object (the default), dark (black glass, a screen), metal (steel, a tap) or glass, seen through (the panes of a window).'),
}
const SolidSchema = z
  .union([
    z.object({ ...Solid, path: z.array(z.tuple([Expr, Expr])).min(3), radius: Expr.optional().describe('Rounds its corners, as for a shape.') }),
    z.object({ ...Solid, ellipse: z.object({ cx: Expr, cy: Expr, rx: Expr, ry: Expr }) }),
  ])
  .describe('A slab of the object in 3D: an outline on the plan, in the same terms as "draw", standing from "bottom" to "top".')

export const DeclarativeExtensionSchema = z
  .object({
    format: z.literal('opencalque-extension'),
    formatVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    translations: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    objects: z
      .array(
        z.object({
          kind: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/).describe('Unique name of the object type, prefixed by the extension, e.g. "elec.socket".'),
          label: z.string(),
          description: z.string().optional(),
          params: z.array(
            z.object({
              key: z.string().regex(/^[A-Za-z_]\w*$/),
              label: z.string(),
              type: z.enum(['number', 'boolean', 'string']),
              default: z.union([z.number(), z.boolean(), z.string()]),
              options: z.array(z.string()).optional(),
              unit: z
                .enum(['length', 'angle', 'percent'])
                .optional()
                .describe("'length' marks a number as a length in mm, shown in the unit the user works in; 'angle' as an angle in degrees; 'percent' as a percentage from 0 to 100, set with a slider that keeps it there (expressions should still clamp it: a file may hold any number)."),
            }),
          ),
          opening: z.object({ from: Expr, to: Expr }).optional().describe('Makes the object cut walls along this stretch of its X axis, like a door.'),
          height: Expr.optional().describe('How tall it stands on the floor, in mm, for elevations: furniture, appliances. An elevation draws it as a box of its width and this height, unless it has a "front".'),
          sill: z.string().optional().describe('For an opening: the key of the length parameter that is how high above the floor it starts, as a window\'s sill. An elevation moves it up and down by it.'),
          mount: z
            .union([
              z.object({
                on: z.literal('wall'),
                back: z.number().optional().describe('The Y of its own laid along the face of the wall. Defaults to 0.'),
                out: z.enum(['down', 'up']).optional().describe("Which way along its own Y it stands out of the wall: 'down' (+Y, the default) or 'up'."),
                height: z.number().nonnegative().describe('How high above the floor it usually is, in mm, to its centre.'),
                measured: z.enum(['centre', 'bottom']).optional().describe("What its height is measured to: its centre (the default), or its underside ('bottom', a wall cabinet). Its front is drawn from that point."),
              }),
              z.object({
                on: z.literal('floor'),
                back: z.number().optional().describe('The Y of its own laid along the face of the wall. Defaults to 0.'),
                out: z.enum(['down', 'up']).optional().describe("Which way along its own Y it stands out of the wall: 'down' (+Y, the default) or 'up'."),
              }),
            ])
            .optional()
            .describe('Makes the object go against the face of a wall: fixed on it at a height ("on": "wall", like a socket), or standing on the floor with its back against it ("on": "floor", like a kitchen unit). It is laid against the face nearest the pointer and follows the wall when the wall changes.'),
          category: z
            .string()
            .optional()
            .describe('Where the component library lists it: a room ("living", "dining", "bedroom", "office"), "bathroom", "kitchen", "electrical", "architecture", "annotation", or a section of its own.'),
          size: z
            .object({ x: z.string() })
            .optional()
            .describe('The key of the length parameter that is its size along its X axis from the insertion point, such as a width. The object is then stretched on the canvas by the two ends of that size, rather than scaled.'),
          box: z
            .object({ width: z.string(), height: z.string() })
            .optional()
            .describe('The keys of the length parameters that are its width (along X) and height (along Y), the object filling the box from its insertion point to (width, height). It is then resized on the canvas by a frame, as a rectangle is: each side sets its parameter, in whole millimetres, and the knob above turns it.'),
          ports: z
            .array(
              z.object({
                key: z.string().regex(/^[A-Za-z_]\w*$/).describe('Its name, the same each time: what a link stores to say which connection it joins ("out", "out2").'),
                label: z.string().describe('What it is called where one is chosen, as "Second button".'),
                carries: z.string().describe('What goes through it: "control" (a switch\'s order to a light). Only ports that carry the same are linked.'),
                way: z.enum(['out', 'in']).describe('"out" gives (a switch), "in" takes (a light). A link goes from one that gives to one that takes.'),
                required: z.boolean().optional().describe('The object counts as unconnected while nothing is linked here: a light no switch controls. Left out, it does not: a socket that may be switched.'),
                when: Expr.optional().describe('It is there only when the expression is true: the second button of a switch made double.'),
              }),
            )
            .optional()
            .describe('Its connections, which links join to those of other objects: a switch controls lights through its "out" port, a light is controlled through its "in" port.'),
          draw: z.array(ShapeSchema).min(1),
          front: z
            .array(ShapeSchema)
            .optional()
            .describe('How it looks in an elevation, seen from in front: shapes in the same terms as "draw", X along its own X, Y down from its insertion point at the floor, or from its centre at its height for an object fixed on a wall. Left out, an elevation draws it as a box.'),
          side: z
            .array(ShapeSchema)
            .optional()
            .describe('How it looks in an elevation seen from its side (from either end; the elevation mirrors it): X along its own Y, from its back (0) to its front, Y as for "front". Drawn when the elevation sees it more from the side than from in front. Left out, a box.'),
          back: z
            .array(ShapeSchema)
            .optional()
            .describe('How it looks in an elevation seen from behind, in the same terms as "front": for what stands free, as a table. Left out, a box.'),
          solids: z
            .array(SolidSchema)
            .optional()
            .describe('What it is made of in 3D, for the view of a viewpoint: slabs, each an outline standing from a bottom to a top. A table its top on its legs, a chair its seat, its legs and its back. Left out, the outline its plan draws, raised to its "height".'),
        }),
      )
      .min(1),
  })
  .describe('An OpenCalque extension written as data: parametric objects drawn from expressions. Local coordinates are mm, origin at the insertion point, Y down. The name "wall" holds the thickness of the wall an opening sits in (0 when it is on none).')

export type DeclarativeExtension = z.infer<typeof DeclarativeExtensionSchema>

/** A cap on how much one object may draw, so a mistaken repeat count cannot freeze the app. */
const MAX_SHAPES = 5000

/** The box of an object said as data: from its insertion point to the values of two of its length parameters. */
function boxOf(width: string, height: string): NonNullable<ParametricKind['box']> {
  return {
    bounds: (props) => ({ left: 0, top: 0, right: Number(props[width]), bottom: Number(props[height]) }),
    resize: (_, size) => ({
      ...(size.width === undefined ? {} : { [width]: Math.round(Math.max(1, size.width)) }),
      ...(size.height === undefined ? {} : { [height]: Math.round(Math.max(1, size.height)) }),
    }),
  }
}

type Shape = DeclarativeExtension['objects'][number]['draw'][number]
type Draw = (scope: Scope, out: Primitive[]) => void

/** The shapes of an object said as data, each made a function of the scope it is drawn in. */
function compileShapes(draw: Shape[]): Draw[] {
  return draw.map((shape): Draw => {
    const look = { fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth, dash: shape.dash }
    const when = shape.when === undefined ? null : compileExpression(shape.when)
    const count = shape.repeat ? compileExpression(shape.repeat.count) : null
    const index = shape.repeat?.as ?? 'i'
    const n = (compiled: Compiled) => (scope: Scope) => Number(compiled(scope))
    let one: Draw
    if ('path' in shape) {
      const points = shape.path.map(([x, y]) => [n(compileExpression(x)), n(compileExpression(y))] as const)
      const radius = shape.radius === undefined ? null : n(compileExpression(shape.radius))
      one = (scope, out) => {
        const corners = points.map(([x, y]) => ({ x: x(scope), y: y(scope) }))
        out.push({ kind: 'path', points: radius ? roundCorners(corners, radius(scope), shape.closed === true) : corners, closed: shape.closed, ...look })
      }
    } else if ('ellipse' in shape) {
      const [cx, cy, rx, ry] = [shape.ellipse.cx, shape.ellipse.cy, shape.ellipse.rx, shape.ellipse.ry].map((e) => n(compileExpression(e)))
      one = (scope, out) => out.push({ kind: 'ellipse', cx: cx(scope), cy: cy(scope), rx: Math.abs(rx(scope)), ry: Math.abs(ry(scope)), ...look })
    } else if ('arc' in shape) {
      const [cx, cy, r, from, to] = [shape.arc.cx, shape.arc.cy, shape.arc.r, shape.arc.from, shape.arc.to].map((e) => n(compileExpression(e)))
      one = (scope, out) => out.push({ kind: 'path', points: arcPoints({ x: cx(scope), y: cy(scope) }, r(scope), from(scope), to(scope)), ...(shape.closed ? { closed: true } : {}), ...look })
    } else {
      const [x, y, size] = [shape.text.x, shape.text.y, shape.text.size].map((e) => n(compileExpression(e)))
      const { align } = shape.text
      // "{length / 1000} m": each pair of braces holds an expression, the rest is literal.
      const pieces = shape.text.value.split(/\{([^}]*)\}/).map((piece, k) => (k % 2 ? compileExpression(piece) : () => piece))
      const shown = (v: Value) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v))
      one = (scope, out) =>
        out.push({ kind: 'text', x: x(scope), y: y(scope), text: pieces.map((piece) => shown(piece(scope))).join(''), size: Math.max(1, size(scope)), align, stroke: look.stroke })
    }
    return (scope, out) => {
      // Counted in turns, not only in shapes drawn: a condition that is never true draws nothing,
      // and must not keep the loop going for ever.
      const wanted = count ? Math.floor(Number(count(scope))) : 1
      const times = Number.isFinite(wanted) ? Math.min(wanted, MAX_SHAPES) : 0
      for (let i = 0; i < times && out.length < MAX_SHAPES; i++) {
        const inner = count ? { ...scope, [index]: i } : scope
        if (!when || when(inner)) one(inner, out)
      }
    }
  })
}

/** What compiled shapes draw in `scope`, leaving out paths whose points are not numbers. */
function drawShapes(shapes: Draw[], scope: Scope): Primitive[] {
  const out: Primitive[] = []
  for (const draw of shapes) draw(scope, out)
  return out.filter((p) => (p.kind === 'path' ? p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)) : true))
}

type SolidSource = NonNullable<DeclarativeExtension['objects'][number]['solids']>[number]

/** The slabs of an object said as data, each made a function of its parameters. */
function compileSolids(solids: SolidSource[]): (scope: Scope) => KindSolid[] {
  const compiled = solids.map(({ bottom, top, finish, ...shape }) => ({
    draw: compileShapes(['path' in shape ? { ...shape, closed: true } : shape] as Shape[])[0],
    bottom: compileExpression(bottom),
    top: compileExpression(top),
    finish,
  }))
  return (scope) => {
    const out: KindSolid[] = []
    for (const solid of compiled) {
      const [bottom, top] = [Number(solid.bottom(scope)), Number(solid.top(scope))]
      if (!Number.isFinite(bottom) || !Number.isFinite(top)) continue
      const drawn: Primitive[] = []
      solid.draw(scope, drawn)
      for (const p of drawn) {
        const ring = ringOf(p)
        if (ring) out.push({ outline: ring, bottom, top, ...(solid.finish ? { finish: solid.finish } : {}) })
      }
    }
    return out
  }
}

/** The outline of a closed path or an ellipse, as a ring of points; null for anything else or what is not a number. */
function ringOf(p: Primitive): Vec2[] | null {
  const ring =
    p.kind === 'path'
      ? p.points
      : p.kind === 'ellipse'
        ? Array.from({ length: 24 }, (_, i) => ({ x: p.cx + p.rx * Math.cos((i * Math.PI) / 12), y: p.cy + p.ry * Math.sin((i * Math.PI) / 12) }))
        : null
  return ring && ring.length >= 3 && ring.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)) ? ring : null
}

/** Turns the JSON of a declarative extension into an extension. Throws, with the reason, when it is not valid. */
export function declarativeExtension(json: unknown): Extension {
  const parsed = DeclarativeExtensionSchema.safeParse(json)
  if (!parsed.success) throw new Error(`Not a valid extension:\n${z.prettifyError(parsed.error)}`)
  const source = parsed.data

  const kinds: ParametricKind[] = source.objects.map((object) => {
    const shapes = compileShapes(object.draw)
    const front = object.front && compileShapes(object.front)
    const side = object.side && compileShapes(object.side)
    const back = object.back && compileShapes(object.back)
    const solids = object.solids && compileSolids(object.solids)
    const tall = object.height === undefined ? null : compileExpression(object.height)
    const from = object.opening && compileExpression(object.opening.from)
    const to = object.opening && compileExpression(object.opening.to)
    const ports = object.ports?.map(({ when, ...port }) => ({ port, when: when === undefined ? null : compileExpression(when) }))
    return {
      kind: object.kind,
      label: object.label,
      description: object.description,
      params: object.params,
      opening: from && to ? (props) => ({ from: Number(from({ ...props, wall: 0 })), to: Number(to({ ...props, wall: 0 })) }) : undefined,
      size: object.size,
      sill: object.sill,
      height: tall ? (props) => Number(tall(props)) : undefined,
      mount: object.mount,
      category: object.category,
      box: object.box && boxOf(object.box.width, object.box.height),
      build: (props, env) => drawShapes(shapes, { ...props, wall: env.wallThickness ?? 0 }),
      front: front ? (props) => drawShapes(front, { ...props, wall: 0 }) : undefined,
      side: side ? (props) => drawShapes(side, { ...props, wall: 0 }) : undefined,
      back: back ? (props) => drawShapes(back, { ...props, wall: 0 }) : undefined,
      solids: solids ? (props, env) => solids({ ...props, wall: env?.wallThickness ?? 0 }) : undefined,
      ports: ports ? (props) => ports.filter(({ when }) => !when || when({ ...props, wall: 0 })).map(({ port }) => port) : undefined,
    }
  })

  // Building every object once with its defaults finds unknown names before anyone places it.
  for (const [i, kind] of kinds.entries()) {
    const defaults = Object.fromEntries(source.objects[i].params.map((p) => [p.key, p.default]))
    try {
      kind.build(defaults, {})
      kind.front?.(defaults)
      kind.side?.(defaults)
      kind.back?.(defaults)
      kind.solids?.(defaults, {})
      kind.height?.(defaults)
      kind.opening?.(defaults)
      kind.ports?.(defaults)
    } catch (error) {
      throw new Error(`Not a valid extension: object "${kind.kind}": ${(error as Error).message}`)
    }
  }

  return {
    id: source.id,
    name: source.name,
    version: source.version,
    translations: source.translations,
    activate(api) {
      for (const kind of kinds) api.registerParametric(kind)
    },
  }
}
