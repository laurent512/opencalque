import type { ModifierKind } from './modifiers'
import type { Op } from './ops'
import type { Primitive } from './primitives'
import type { Document } from './schema'
import type { Vec2 } from './geometry'

/** One row of a list parameter (`ParamDef` of type 'list'): its fields by key. */
export type ParamRow = Record<string, number | boolean | string>
/** What a parameter holds: a number, a boolean, a text, or for a list its rows. */
export type ParamValue = number | boolean | string | ParamRow[]

/** The most rows a list parameter is read with when its kind says no fewer (`ParamDef.most`): what drives a loop is capped. */
export const MOST_ROWS = 12

export interface ParamDef {
  key: string
  label: string
  /**
   * 'list' is a list of rows, each with the fields `items` gives (numbers, booleans, texts): a tall
   * unit's sections from the floor up. Stored as an array of objects in `props`, read with each
   * row's fields filled in and invalid rows left out, at most `most` of them.
   */
  type: 'number' | 'boolean' | 'string' | 'list'
  default: ParamValue
  /** For a list: the fields of each of its rows, none of them a list. */
  items?: ParamDef[]
  /** For a list: the most rows it is read with, `MOST_ROWS` when it does not say; those past it are left out. */
  most?: number
  /**
   * For a list: the rows an empty one stands for, given every value of the object (a tall unit with
   * no sections of its own has those its Contents says). Editors show them, and an edit starts from them.
   */
  emptyAs?: (props: Record<string, any>) => ParamRow[]
  /**
   * For a list: a row of its own, at most one, put in by a link under the list while it has none and
   * taken out by its cross, rather than chosen (a tall unit's filler): `row` the fields that make a
   * row it, `label` what the link says. Its choice is not offered for the other rows.
   */
  toggle?: { row: ParamRow; label: string }
  /** For a list: what the button that adds a row says ("Add a section"), in English, translated as the kind's other texts are. */
  adding?: string
  /**
   * For a list whose rows stand one over the other from the first up (a tall unit's sections):
   * editors show them as they stand, the last at the top, and add a row on top.
   */
  upward?: boolean
  /**
   * For a field of the rows of a list: the rows whose value of it the kind works out rather than
   * takes (a filler's height, what the other sections leave). Editors show it, as the list's `laid`
   * gives it, and let it not be typed.
   */
  auto?: (row: ParamRow) => boolean
  /** For a choice among the fields of a row: what the row's other fields become when it is chosen (a fridge its usual height). */
  sets?: (value: string) => ParamRow
  /** For a list: its rows with the values the kind works out filled in (`auto`), as many and in the same order, given every value of the object. */
  laid?: (props: Record<string, any>) => ParamRow[]
  /** For a string parameter: the allowed values, shown as a dropdown. */
  options?: string[]
  /**
   * Set on a number that is a length in mm, so editors can show and take it in the user's unit; an
   * angle, in degrees, so they can say so; or a percentage, from 0 to 100, which editors keep
   * within those bounds (a slider). What draws it must still take a value outside them, from a file.
   */
  unit?: 'length' | 'angle' | 'percent'
  /**
   * Whether editors show the parameter, given every value of the object (defaults filled in): a
   * door's open angle means nothing once it slides. Hidden, it keeps its value. Only kinds written
   * in code have it; with none, it is always shown.
   */
  shown?: (props: Record<string, any>) => boolean
}

/**
 * How an object goes against a wall's face (`ParametricKind.mount`): fixed on it at a height
 * ('wall': a socket, a switch), or standing on the floor with its back against it ('floor': a hob,
 * a sink, a fridge, a washbasin).
 */
export interface Mount {
  on: 'wall' | 'floor'
  /** The Y of its own laid along the face. Defaults to 0. */
  back?: number
  /** Which way along its own Y it stands out of the wall: 'down' (+Y, the default) or 'up'. */
  out?: 'down' | 'up'
  /** For an object fixed on a wall: how high above the floor it usually is, in mm, to its centre (or its underside, by `measured`). */
  height?: number
  /**
   * What its height above the floor is measured to: its centre (a socket, a switch: the default),
   * or its underside (a wall cabinet, as a fitter measures it). Its `front` is drawn from that point.
   */
  measured?: 'centre' | 'bottom'
}

/**
 * A connection of an object, which links join (`link` nodes, `networks/`): a switch gives control
 * ('out'), a light takes it ('in'). What goes through it is an open word, `carries`: 'control' for
 * now; a cable, cold or hot water, a drain later, without a change of format.
 */
export interface Port {
  key: string
  label: string
  carries: string
  way: 'out' | 'in'
  /**
   * Whether the object is left unconnected while nothing is linked here: a light that no switch
   * controls. A socket's control is not: most sockets are on all the time.
   */
  required?: boolean
}

/** What a parametric object can know about its surroundings when it is drawn. */
export interface BuildEnv {
  /** Thickness of the wall the object sits in, when it is an opening placed on one. */
  wallThickness?: number
}

/** An object type drawn from parameters. `build` returns primitives in local coordinates (origin = insertion point). */
export interface ParametricKind {
  kind: string
  label: string
  description?: string
  /**
   * Where the component library lists it, among the components of the same kind: a room
   * ('living', 'dining', 'bedroom', 'office'), one of the libraries' ids ('bathroom', 'kitchen',
   * 'electrical'), 'architecture' or 'annotation'; any other is a section of its own. Left out, it
   * is listed with the other objects.
   */
  category?: string
  params: ParamDef[]
  /**
   * Makes the object a wall opening (door, window): the stretch of its local X axis that it cuts
   * out of a wall it is placed on. Such objects also snap to walls when placed or dragged.
   */
  opening?(props: Record<string, any>): { from: number; to: number }
  /**
   * For an opening that does not start at the floor: the key of the length parameter that is how
   * high above the floor it starts (a window's sill). An elevation then moves it up and down by it.
   */
  sill?: string
  /**
   * Makes the object one that goes against the face of a wall: fixed on it (`on: 'wall'`: a socket,
   * a switch, a wall light) or standing on the floor against it (`on: 'floor'`: a hob, a sink, a
   * fridge). Placed or dragged, it is laid against the face nearest the pointer, centred under the
   * pointer and kept within the face, and it follows that wall when the wall is changed. Its back is
   * the line of its own Y = `back` (0 when left out), laid along the face; it stands out of the wall
   * towards its own +Y, or -Y when `out` is 'up'. `height`, for one fixed on a wall, is how high
   * above the floor it usually is, in mm (to its centre), unless the object says otherwise (`z`).
   */
  mount?: Mount
  /**
   * The length parameter that is its size along its own X axis, from its insertion point: a door's
   * or a window's width. With it, the object is stretched on the canvas by the two ends of that
   * size, each moving alone, rather than scaled as a whole.
   */
  size?: { x: string }
  /**
   * The object as a box to resize on the canvas, as a rectangle is, its knob above turning it.
   * `bounds` is the box it fills in its own coordinates (the insertion point at 0, 0); `resize`
   * gives the parameters that make it fill a box of another width or height (only what changed is
   * given), rounded to what it can be: whole steps for a stair. The object is then placed so that
   * the side or corner held still stays where it was.
   */
  box?: {
    bounds(props: Record<string, any>): { left: number; top: number; right: number; bottom: number }
    resize(props: Record<string, any>, size: { width?: number; height?: number }): Record<string, unknown>
  }
  build(props: Record<string, any>, env: BuildEnv): Primitive[]
  /**
   * How it looks in an elevation, seen from in front, in its own coordinates: X along its own X,
   * Y down from its insertion point at the floor (a door goes up from 0 to minus its height), or
   * from its centre at its height above the floor for an object fixed on a wall (`mount`). Left
   * out, an elevation draws a door or a window as the box its opening and its height make, and
   * what is fixed on a wall as a small square.
   */
  front?(props: Record<string, any>): Primitive[]
  /**
   * How it looks in an elevation seen from its side (from either end of its own X, the elevation
   * mirroring it as it must): X along its own Y, from its back (0, against the wall) to its front,
   * Y as for `front`. An elevation that sees it more from the side than from in front (past 45°)
   * draws this; left out, the box its plan and its `height` make.
   */
  side?(props: Record<string, any>): Primitive[]
  /**
   * How it looks in an elevation seen from behind, in the same terms as `front` (X along its own X,
   * which an elevation from behind mirrors). For what stands free: a table, a chair, an island.
   * Left out, the box its plan and its `height` make.
   */
  back?(props: Record<string, any>): Primitive[]
  /**
   * How tall it stands on the floor, in mm: furniture, appliances. An elevation draws what stands
   * in front of the face it looks at as a box of its width and this height (or by its `front`).
   * Left out, it is not drawn there.
   */
  height?(props: Record<string, any>): number
  /**
   * How tall it is where it stands, when that is not its `height` parameter, given `room`: how high
   * the top of the wall it is against is over its underside (of its page's walls when it is against
   * none). A wall cabinet up to the ceiling is `room`; a tall unit of sections as high as they are,
   * or `room` with a filler. Null when its `height` stands. Worked out each time it is drawn
   * (`heightInPlace`, `propsInPlace`), never stored.
   */
  heightIn?(props: Record<string, any>, room: number): number | null
  /**
   * The parameters that make it `height` tall where its height is worked out (`heightIn`), when a
   * height is typed or dragged: a wall cabinet that no longer goes up to the ceiling. Left out, or
   * null, its height cannot be set there: it is shown, not typed.
   */
  heightSet?(props: Record<string, any>, height: number): Record<string, unknown> | null
  /**
   * Lines across its front that an elevation lets be dragged up and down, as heights above where it
   * stands: a tall unit's lines between its sections. Left out, it has none.
   */
  splits?(props: Record<string, any>): number[]
  /** The parameters that put the `i`-th of its `splits` at `at` above where it stands (only what changes), or null when it cannot be moved. */
  moveSplit?(props: Record<string, any>, i: number, at: number): Record<string, unknown> | null
  /**
   * What it is made of in 3D, for a viewpoint's view (`massing`): slabs standing from a bottom to a
   * top, each an outline in its own coordinates (as `build` draws), with holes. What identifies it
   * is given its shape there, as a hole or as what stands out: a sink's bowls sunk into its worktop
   * and its tap, a hob's glass. Left out, it is the outline its plan draws, raised to its `height`.
   * An opening (a door, a window) is told the thickness of its wall, as `build` is, and its heights
   * are above the floor; left out, it is the hole it cuts, with glass across it if it starts above
   * the floor.
   */
  solids?(props: Record<string, any>, env: BuildEnv): KindSolid[]
  /**
   * The opening it goes through to another floor, in 3D (`Stairwell`): a stair's. Left out, or
   * null, it opens nothing.
   */
  stairwell?(props: Record<string, any>): Stairwell | null
  /**
   * Its connections, which links join to those of other objects: a switch's control, given out, one
   * more for a double switch; a light's, taken in. Left out, it has none and nothing links to it.
   */
  ports?(props: Record<string, any>): Port[]
}

/**
 * The opening a stair goes through, in 3D (`ParametricKind.stairwell`): an outline in its own
 * coordinates, cut out of the ceiling over it when it goes 'up' to the floor above, or out of the
 * floor when it goes 'down' to the floor below, with walls round it `depth` deep and that floor at
 * their foot, so that what is seen through it is a stairwell.
 */
export interface Stairwell {
  outline: Vec2[]
  way: 'up' | 'down'
  /** How far below the floor the floor under it is, in mm: for one going down. */
  depth?: number
}

/** A slab of an object in 3D (`ParametricKind.solids`), in the object's own coordinates. */
export interface KindSolid {
  outline: Vec2[]
  holes?: Vec2[][]
  /** From and to, in mm above where the object stands: the floor, or its height above it. */
  bottom: number
  top: number
  /** What it looks like: as the object (the default), dark (a hob's glass), metal (a sink, a tap), or glass, seen through (a window's panes). */
  finish?: Finish | 'glass'
  /**
   * Its outline at its top, when it narrows or widens as it goes up (a hood's canopy): as many points
   * as `outline`, each where that one has gone. Ignored on a slab with holes.
   */
  upper?: Vec2[]
  /** Stands up to the ceiling over it, whatever `top` says, when the ceiling is higher than its bottom: a hood's chimney, or its box. */
  toCeiling?: boolean
  /**
   * For a door or a window: seen only from that side of its wall, its own +Y (1) or -Y (-1). A leaf
   * opened out of a room is left out of a view from inside it, where through the doorway it would
   * seem to close it.
   */
  side?: 1 | -1
}

/** What a slab looks like in a view: as the object, dark, or metal. */
export type Finish = 'plain' | 'dark' | 'metal'

/** What a command can see and do. Documents are immutable: changes go through `apply`. */
export interface CommandHost {
  doc: Document
  /** The page or component currently being edited. */
  scope: string
  selection: string[]
  /** The layer new objects go on; none inside a component, whose content takes the layer of each placement. */
  activeLayer?: string
  apply(ops: Op[]): void
}

export interface Command {
  id: string
  title: string
  run(host: CommandHost): void
}

export interface ExtensionApi {
  registerParametric(kind: ParametricKind): void
  registerCommand(command: Command): void
  registerModifier(kind: ModifierKind): void
}

export interface Extension {
  id: string
  name: string
  version: string
  /**
   * Translations of the texts this extension shows (labels, descriptions, option names, command
   * titles), by language code and then by the English text. Option values stored in documents
   * stay in English; only what is displayed is translated.
   */
  translations?: Record<string, Record<string, string>>
  activate(api: ExtensionApi): void
}

export class Registry {
  readonly extensions: Extension[] = []
  readonly parametric = new Map<string, ParametricKind>()
  readonly commands = new Map<string, Command>()
  /** Modifier kinds contributed by extensions. The built-in ones are not in here; see `modifierKind`. */
  readonly modifiers = new Map<string, ModifierKind>()
  /** The translations of every extension in use, merged, by language code. */
  readonly translations: Record<string, Record<string, string>> = {}
  /** Goes up whenever the set of extensions changes, so that what was worked out with the old set is not reused. */
  version = 0

  use(extension: Extension): this {
    this.version++
    extension.activate({
      registerParametric: (kind) => this.parametric.set(kind.kind, kind),
      registerCommand: (command) => this.commands.set(command.id, command),
      registerModifier: (kind) => this.modifiers.set(kind.type, kind),
    })
    for (const [language, texts] of Object.entries(extension.translations ?? {})) {
      this.translations[language] = { ...this.translations[language], ...texts }
    }
    this.extensions.push(extension)
    return this
  }

  /** Forgets every extension, so a different set can be put in use. The registry object stays the same. */
  clear(): this {
    this.version++
    this.extensions.length = 0
    this.parametric.clear()
    this.commands.clear()
    this.modifiers.clear()
    for (const language of Object.keys(this.translations)) delete this.translations[language]
    return this
  }

  /** Props of a parametric node completed with the kind's defaults. */
  resolveProps(kind: ParametricKind, props: Record<string, unknown>): Record<string, any> {
    return resolveParams(kind.params, props)
  }
}

/**
 * Values completed with the defaults of `params`: each that is not of its parameter's type, or not
 * one of its options, is its default. A list keeps its rows that are objects, each completed with the
 * fields of its rows the same way, at most as many as it says (`most`); one that is not an array is its default.
 */
export function resolveParams(params: ParamDef[], props: Record<string, unknown>): Record<string, any> {
  const out: Record<string, unknown> = {}
  for (const p of params) {
    const value = props[p.key]
    if (p.type === 'list') {
      const rows = Array.isArray(value) ? value.slice(0, Math.max(0, p.most ?? MOST_ROWS)).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) : null
      out[p.key] = rows ? rows.map((row) => resolveParams(p.items ?? [], row)) : p.default
      continue
    }
    const valid = typeof value === typeof p.default && (!p.options || p.options.includes(value as string))
    out[p.key] = valid ? value : p.default
  }
  return out
}

/** The rows of a list parameter as an object has them, the defaults filled in: its own, or when it has none those its kind says an empty list stands for (`emptyAs`). */
export function rowsOf(param: ParamDef, props: Record<string, any>): ParamRow[] {
  const own = Array.isArray(props[param.key]) ? (props[param.key] as ParamRow[]) : []
  if (own.length > 0 || !param.emptyAs) return own
  try {
    return param.emptyAs(props).slice(0, Math.max(0, param.most ?? MOST_ROWS)).map((row) => resolveParams(param.items ?? [], row) as ParamRow)
  } catch {
    return []
  }
}
