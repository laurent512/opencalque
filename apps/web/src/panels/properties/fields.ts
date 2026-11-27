import { add, CONTROL, DEFAULT_MATERIAL, sheetScaleAt, viewScale, type NodeOf, type Document, drawnSolid, frameGrips, heightInPlace, type Node, norm, OBJECT_FILL, type Op, type ParametricKind, portsOf, resizeFrame, resizePatch, scale, sub, TEXT_FIELDS, type Pattern } from '@opencalque/core'
import { msg, t } from '../../i18n'
import { registry } from '../../extensions'
import { frameShown } from '../../perspective/seen'

/* The fields of the Properties panel, by type of object: which properties are shown, under which heading, as what kind of field. */

export interface Option {
  value: string
  label: string
}

export interface FieldSpec {
  /** Property path, one or two levels deep: "x", "a.x", "props.width", "style.stroke". */
  path: string
  label: string
  /**
   * 'dash' is a checkbox standing for a dash pattern; 'opacity' a slider from 0 to 1, shown as a
   * percentage; 'fill' what covers the inside of a shape, `style.fill` and `style.pattern` together.
   */
  type: 'number' | 'string' | 'boolean' | 'color' | 'dash' | 'weight' | 'fill' | 'opacity' | 'list'
  /** Heading the field appears under. Defaults to "Geometry". */
  section?: string
  /** Shown when the property is unset. */
  fallback?: number | string | boolean
  /** Allowed values of a string property, shown as a dropdown. An empty value means unset. */
  options?: Option[]
  /** A text that may run over several lines. */
  multiline?: boolean
  /** The number is a length in mm, edited in the user's unit. */
  length?: boolean
  /** The number is an angle in degrees, which its box says. */
  angle?: boolean
  /** The number is a percentage, set with a slider and kept from 0 to 100 (`PercentField`). */
  percent?: boolean
  /** The property may be cleared by emptying the field. */
  optional?: boolean
  /** For a number with no fallback: what it means unset, written faint in the empty field. Dragged with Alt, it starts from 0. */
  empty?: string
  /** For a color: what an unset value means, e.g. "from layer". */
  unset?: string
  /** Shown only for objects this is true of: a polygon has no ends, a line no fill. */
  when?: (node: Node) => boolean
  /** For a fill: the colour and pattern it takes from elsewhere (a room's floor, from its material) when it has none of its own. */
  inherited?: { fill?: string; pattern?: Pattern }
  /** For a fill: no fill at all may not be chosen. */
  filled?: boolean
  /** The options are the symbols of a line's end, shown as pictures to pick from: of its first end or of its last. */
  ends?: 'start' | 'end'
  /** The choice is of one of the drawing's materials, picked from a list showing each with its swatch (`MaterialChoice`). */
  material?: boolean
  /** Said when the pointer rests on the field: what the number is measured to. */
  note?: string
  /** Written faint after the number in its box: its unit when it is not a length nor an angle, as "%". */
  suffix?: string
  /** Written faint before the number in its box, and may be typed: the "1:" of a scale. */
  prefix?: string
  /** The row it shares with the fields beside it, when its path does not say (`ROWS`): which, and what it is called there. */
  row?: { id: string; name: string; size?: boolean; label?: string }
  /** Shown, not typed, for objects this is true of: the height of a tall unit, which its sections make. */
  readOnly?: (node: Node, doc: Document) => boolean
  /** For a list: the parameter it is, which says the fields of its rows (`ListField`). */
  list?: ParametricKind['params'][number]
  /** For what is not a property of the node itself (a placement's width, its component's height): how it is read, and the operations that set it. */
  get?: (node: Node, doc: Document) => unknown
  set?: (node: Node, value: unknown, doc: Document) => Op[]
}

export const GEOMETRY = msg('Geometry')
/** The parts of a view's settings, as its parts are listed under it in Structure: its line of view (or a viewpoint's camera), on the plan; and its representation, on the sheet. */
export const VIEW_SEES = msg('Line of view')
/** The part of a view that is drawn on the sheet, a viewpoint's or an elevation's: where, how large, and how. */
export const REPRESENTATION = msg('Representation')
/** A viewpoint's part on the plan: where its eye is and how it looks, with its lens, its height and its tilt. */
export const CAMERA = msg('Camera')

/**
 * Where a viewpoint's view is on the plan and how large, as anything else's geometry: its frame's
 * corner, width and height, which give its picture its shape. A view with no frame yet has the one
 * it is shown in; given a width, it keeps the height it is shown at.
 */
function frameField(key: 'x' | 'y' | 'width' | 'height', label: string): FieldSpec {
  return {
    ...len(`frame.${key}`, label, undefined, REPRESENTATION),
    get: (node, doc) => (node.type === 'camera' ? frameShown(doc, node)[key] : undefined),
    set: (node, value, doc) => {
      if (node.type !== 'camera' || typeof value !== 'number' || ((key === 'width' || key === 'height') && !(value > 0))) return []
      return [{ op: 'update_node', id: node.id, patch: { frame: { ...frameShown(doc, node), [key]: Math.round(value) } } }]
    },
  }
}

/**
 * Fields shown side by side on one row when they follow one another, by their paths: which row, and
 * what each is called there; the row is called by those it has ("X, Y" or "X, Y, Z"), or by its
 * `label`. A `size` row can keep its proportions. A field may also say its row itself (`row`).
 */
const ROWS: Record<string, { id: string; name: string; size?: boolean; label?: string }> = {
  x: { id: 'xyz', name: 'X' },
  y: { id: 'xyz', name: 'Y' },
  z: { id: 'xyz', name: 'Z' },
  cx: { id: 'centre', name: 'X' },
  cy: { id: 'centre', name: 'Y' },
  'a.x': { id: 'a', name: 'X1' },
  'a.y': { id: 'a', name: 'Y1' },
  'b.x': { id: 'b', name: 'X2' },
  'b.y': { id: 'b', name: 'Y2' },
  width: { id: 'size', name: 'W', size: true },
  height: { id: 'size', name: 'H', size: true },
  rx: { id: 'radii', name: 'rx', size: true, label: msg('Radii') },
  ry: { id: 'radii', name: 'ry', size: true, label: msg('Radii') },
}

/** The row a field is shown on with others, if any. */
export const rowOf = (field: FieldSpec) => field.row ?? ROWS[field.path]

/** What a row of fields is called, and whether it is a size, which can keep its proportions. */
export function rowName(fields: FieldSpec[]): { label: string; size: boolean } {
  const rows = fields.map(rowOf)
  return { label: rows[0]?.label ?? rows.map((row) => row!.name).join(', '), size: !!rows[0]?.size }
}

/** Fields in the rows they are shown on: those of one row (`ROWS`) that follow one another together, any other alone. */
export function rowsOf(fields: FieldSpec[]): FieldSpec[][] {
  const rows: FieldSpec[][] = []
  for (const field of fields) {
    const last = rows[rows.length - 1]
    const row = rowOf(field)
    if (row && last && rowOf(last[0])?.id === row.id) last.push(field)
    else rows.push([field])
  }
  return rows
}

const num = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ path, label, type: 'number', fallback, section })

/** A number that is a distance: shown and typed in the user's unit. */
const len = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ ...num(path, label, fallback, section), length: true })

const options = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))

const FONTS = options(['', msg('Sans-serif')], ['"Arial Narrow", sans-serif', msg('Condensed')], ['serif', msg('Serif')], ['monospace', msg('Monospace')])

const MARKERS = options(['tick', msg('Tick')], ['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['none', msg('None')])

const AB = [len('a.x', msg('X1')), len('a.y', msg('Y1')), len('b.x', msg('X2')), len('b.y', msg('Y2'))]

// No "mirror" box: it could only say left to right (top to bottom is that and a half turn), so a
// thing mirrored top to bottom read as mirrored and turned 180°. Mirroring is a command (Shift+H,
// Shift+V), which knows both.
const PLACEMENT: FieldSpec[] = [len('x', msg('X')), len('y', msg('Y')), num('rotation', msg('Rotation'), 0)]

const stroke = (section: string): FieldSpec[] => [
  { path: 'style.stroke', label: msg('Color'), type: 'color', section, fallback: '#1f1f1f', unset: msg('from layer') },
  { path: 'style.strokeWidth', label: msg('Weight'), type: 'weight', section, fallback: 1 },
  { path: 'style.dash', label: msg('Line'), type: 'dash', section },
]

/** The look of a shape in two parts, each said by its name: its outline, and what covers its inside. */
export const STROKE = msg('Stroke')

const FILL = msg('Fill')

/**
 * What covers the inside of a shape: none, a colour, or a pattern over one, in one window. `fallback`
 * is what is drawn when the shape says nothing: a colour, or 'none'.
 */
const fill = (fallback: string, unset: string, more: Partial<FieldSpec> = {}): FieldSpec => ({ path: 'style.fill', label: msg('Fill'), type: 'fill', section: FILL, fallback, unset, ...more })

/** A plain shape is filled with nothing until it is given a fill. */
const SHAPE_STYLE: FieldSpec[] = [...stroke(STROKE), fill('none', msg('none'))]

/** A parametric object draws its own fills, white unless its style says. */
const STYLE: FieldSpec[] = [...stroke(STROKE), fill('#ffffff', msg('default'))]

/** A room in two parts: what is written in it (its name, its area), and its floor. */
const ROOM_LABEL = msg('Label')

export const FLOOR = msg('Floor')

/** Where the look of a selection is changed, and so where it can be taken from another object. */
export const LOOK_SECTIONS = [STROKE, 'Style', FLOOR]

export const DIMENSION: FieldSpec[] = [
  ...AB,
  len('offset', msg('Offset')),
  ...stroke(msg('Dimension line')),
  { path: 'startMarker', label: msg('Start'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS, ends: 'start' },
  { path: 'endMarker', label: msg('End'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS, ends: 'end' },
  len('markerSize', msg('Size'), 100, msg('Ends')),
  { path: 'extension.stroke', label: msg('Color'), type: 'color', section: msg('Extension lines'), fallback: '#1f1f1f', unset: msg('from line') },
  { ...num('extension.strokeWidth', msg('Weight'), undefined, msg('Extension lines')), optional: true },
  { path: 'extension.dash', label: msg('Dashed'), type: 'dash', section: msg('Extension lines') },
  len('extensionGap', msg('Gap'), 0, msg('Extension lines')),
  { path: 'text', label: msg('Override'), type: 'string', section: msg('Text'), optional: true },
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
  len('size', msg('Size'), 150, msg('Text')),
  { path: 'textColor', label: msg('Color'), type: 'color', section: msg('Text'), fallback: '#1f1f1f', unset: msg('from line') },
  { path: 'textPosition', label: msg('Position'), type: 'string', section: msg('Text'), fallback: 'above', options: options(['above', msg('Above line')], ['center', msg('On line')], ['below', msg('Below line')]) },
  { path: 'textRotation', label: msg('Rotation'), type: 'string', section: msg('Text'), fallback: 'aligned', options: options(['aligned', msg('Along line')], ['horizontal', msg('Horizontal')]) },
  // Which way the head turns to read the text of a vertical dimension.
  {
    path: 'verticalText',
    label: msg('Vertical text'),
    type: 'string',
    section: msg('Text'),
    fallback: 'down',
    options: options(['up', msg('Bottom to top (head turned left)')], ['down', msg('Top to bottom (head turned right)')]),
  },
  { path: 'unit', label: msg('Unit'), type: 'string', section: msg('Text'), fallback: 'mm', options: options(['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft'], ['ft-in', msg('ft and in')]) },
  { ...num('decimals', msg('Decimals'), undefined, msg('Text')), optional: true },
  { path: 'showUnit', label: msg('Show unit'), type: 'boolean', section: msg('Text'), fallback: false },
]

/** The symbols an annotation's leader can end in. A bullet is the dot. */
const TIPS = options(['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['tick', msg('Tick')], ['none', msg('None')])

export const ANNOTATION: FieldSpec[] = [
  { path: 'text', label: msg('Text'), type: 'string', multiline: true },
  ...AB,
  { path: 'startMarker', label: msg('At the tip'), type: 'string', section: msg('Ends'), fallback: 'arrow', options: TIPS, ends: 'start' },
  { path: 'endMarker', label: msg('At the text'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'end' },
  { ...len('markerSize', msg('Size'), undefined, msg('Ends')), optional: true },
  { path: 'shape', label: msg('Path'), type: 'string', section: msg('Line'), fallback: 'curve', options: options(['curve', msg('Curved')], ['straight', msg('Straight')], ['elbow', msg('Elbow (square turn)')]) },
  num('bend', msg('Curve'), 0.2, msg('Line')),
  ...stroke(msg('Line')),
  len('size', msg('Size'), 200, msg('Text')),
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
]

/** A grid line: what its bubble says and where it is, and its line, usually dashed. */
export const GRIDLINE: FieldSpec[] = [
  { path: 'label', label: msg('Label'), type: 'string', section: msg('Bubble') },
  { path: 'bubbles', label: msg('At'), type: 'string', section: msg('Bubble'), fallback: 'start', options: options(['start', msg('Start')], ['end', msg('End')], ['both', msg('Both ends')], ['none', msg('None')]) },
  len('size', msg('Size'), 800, msg('Bubble')),
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Bubble'), options: FONTS },
  ...AB,
  ...stroke(msg('Line')),
]

/** The symbols at the ends of a plain line, which has none unless asked. */
const LINE_ENDS: FieldSpec[] = [
  { path: 'startMarker', label: msg('Start'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'start' },
  { path: 'endMarker', label: msg('End'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'end' },
  len('markerSize', msg('Size'), 150, msg('Ends')),
]

const FIELDS: Partial<Record<Node['type'], FieldSpec[]>> = {
  line: [...AB, ...LINE_ENDS, ...stroke(STROKE)],
  // A wall's fill is its material's: it has none of its own to set.
  wall: [...AB, len('bulge', msg('Curve'), 0), len('thickness', msg('Thickness')), { ...len('height', msg('Height')), optional: true }, ...stroke(STROKE)],
  dimension: DIMENSION,
  annotation: ANNOTATION,
  gridline: GRIDLINE,
  rect: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), ...SHAPE_STYLE],
  // A paper's size is its format and scale, set under Sheet: here only where it lies.
  paper: [{ ...len('x', msg('X')), row: { id: 'at', name: 'X', label: msg('Position') } }, { ...len('y', msg('Y')), row: { id: 'at', name: 'Y', label: msg('Position') } }],
  // Where the name is written is where the room is: its X and Y are the name's.
  room: [
    len('x', msg('X'), undefined, ROOM_LABEL),
    len('y', msg('Y'), undefined, ROOM_LABEL),
    // Said as the text's: a bare size or colour could be taken for the room's.
    len('size', msg('Text size'), 250, ROOM_LABEL),
    { path: 'style.stroke', label: msg('Text colour'), type: 'color', section: ROOM_LABEL, fallback: '#1f1f1f', unset: msg('from layer') },
    { path: 'showArea', label: msg('Show area'), type: 'boolean', section: ROOM_LABEL, fallback: true },
    { path: 'showPerimeter', label: msg('Show perimeter'), type: 'boolean', section: ROOM_LABEL, fallback: false },
    fill('#dfe6f0', msg('default'), { section: FLOOR }),
  ],
  divider: AB,
  // What it counts, and its columns, are set above (`TableSettings`); here, how it is written.
  // A view, in its two parts, each a section named as its row under the view in Structure (the
  // owner's choice): its representation, where it is drawn, at what scale (as dragged by its label
  // and its corners) and how; then its line of view, on the plan (from its start to its end, as
  // dragged there, and how far it sees), apart, so that its X and Y are not taken for its place.
  // Its name, above, names it in the Structure list; it is not written on the drawing. Its
  // dimensions are what it holds (`autodimensions`), each set apart.
  elevation: [
    { ...len('x', msg('X'), undefined, REPRESENTATION), row: { id: 'at', name: 'X', label: msg('Position') } },
    { ...len('y', msg('Y'), undefined, REPRESENTATION), row: { id: 'at', name: 'Y', label: msg('Position') } },
    // Its scale on the sheet it lies on, the N of 1:N, a number dragged with Alt as any other; kept
    // as a factor of the plan's (`scale`), so that it stays as large on the page when the sheet's
    // scale changes.
    {
      path: 'scale',
      label: msg('Scale'),
      type: 'number',
      section: REPRESENTATION,
      prefix: '1:',
      note: msg('The scale it is drawn at on the sheet it lies on (on none, at 1:100): at 1:50 on a sheet at 1:100 it is twice as large as the plan. Its dimensions still say the real lengths.'),
      get: (node, doc) => {
        const n = sheetScaleAt(doc, node.parent, node as NodeOf<'elevation'>) / viewScale(node as NodeOf<'elevation'>)
        return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10
      },
      set: (node, value, doc) => {
        if (typeof value !== 'number' || !(value > 0)) return []
        const factor = Math.min(20, sheetScaleAt(doc, node.parent, node as NodeOf<'elevation'>) / value)
        return [{ op: 'update_node', id: node.id, patch: { scale: Math.abs(factor - 1) < 1e-9 ? null : factor } }]
      },
    },
    { ...len('a.x', msg('X'), undefined, VIEW_SEES), row: { id: 'a', name: 'X', label: msg('Start') } },
    { ...len('a.y', msg('Y'), undefined, VIEW_SEES), row: { id: 'a', name: 'Y', label: msg('Start') } },
    { ...len('b.x', msg('X'), undefined, VIEW_SEES), row: { id: 'b', name: 'X', label: msg('End') } },
    { ...len('b.y', msg('Y'), undefined, VIEW_SEES), row: { id: 'b', name: 'Y', label: msg('End') } },
    len('depth', msg('Depth'), 6000, VIEW_SEES),
    { path: 'walls', label: msg('Walls in front'), type: 'boolean', fallback: true, section: REPRESENTATION, note: msg('The walls between its line and the faces it looks at, cut or in the way, drawn grey; without them, all of each face shows.') },
  ],
  // A viewpoint: where the eye is and what it looks towards, also dragged on the plan. How far it
  // looks towards says nothing of what it sees: it has no length to show. Its lens, its eye's height
  // and its tilt are in sections of their own (`viewpoint.tsx`), with how its view is drawn.
  camera: [
    { ...frameField('x', msg('X')), row: { id: 'at', name: 'X', label: msg('Position') } },
    { ...frameField('y', msg('Y')), row: { id: 'at', name: 'Y', label: msg('Position') } },
    { ...frameField('width', msg('W')), row: { id: 'size', name: 'W', size: true, label: msg('Size') } },
    { ...frameField('height', msg('H')), row: { id: 'size', name: 'H', size: true, label: msg('Size') } },
    { ...len('a.x', msg('X'), undefined, CAMERA), row: { id: 'a', name: 'X', label: msg('Eye') } },
    { ...len('a.y', msg('Y'), undefined, CAMERA), row: { id: 'a', name: 'Y', label: msg('Eye') } },
    { ...len('b.x', msg('X'), undefined, CAMERA), row: { id: 'b', name: 'X', label: msg('Looks towards') } },
    { ...len('b.y', msg('Y'), undefined, CAMERA), row: { id: 'b', name: 'Y', label: msg('Looks towards') } },
  ],
  table: [
    { path: 'title', label: msg('Title'), type: 'string', optional: true },
    len('x', msg('X')),
    len('y', msg('Y')),
    len('size', msg('Text size'), 200),
    { path: 'totals', label: msg('Total row'), type: 'boolean', fallback: true },
    // Past this many, its rows go on in a block beside it: a long legend stays on the sheet.
    { ...num('rowsPerBlock', msg('Rows per block')), optional: true },
    ...stroke(STROKE),
    fill('#ffffff', msg('default'), { filled: true }),
  ],
  ellipse: [
    len('cx', msg('X')),
    len('cy', msg('Y')),
    len('rx', msg('Radius X')),
    len('ry', msg('Radius Y')),
    num('rotation', msg('Rotation'), 0),
    // Given a start or an end, the ellipse is drawn as an arc between them; emptied, it is whole again.
    { ...num('from', msg('Arc from (°)')), optional: true },
    { ...num('to', msg('Arc to (°)')), optional: true },
    ...SHAPE_STYLE,
  ],
  text: [
    { path: 'text', label: msg('Text'), type: 'string', multiline: true },
    len('x', msg('X')),
    len('y', msg('Y')),
    len('size', msg('Size')),
    num('rotation', msg('Rotation'), 0),
    { path: 'font', label: msg('Font'), type: 'string', options: FONTS },
    { path: 'bold', label: msg('Bold'), type: 'boolean', fallback: false },
    { path: 'align', label: msg('Alignment'), type: 'string', options: options(['', msg('Left')], ['center', msg('Centred')], ['right', msg('Right')]) },
    { path: 'style.stroke', label: msg('Color'), type: 'color', section: msg('Style'), fallback: '#1f1f1f', unset: msg('from layer') },
  ],
  // Open, a polyline has ends and nothing inside it; closed, a polygon, the other way round. Closing,
  // opening, curving and straightening it are commands (Object menu, right-click), not properties.
  polyline: [
    ...LINE_ENDS.map((field) => ({ ...field, when: (node: Node) => !(node.type === 'polyline' && node.closed) })),
    ...stroke(STROKE),
    fill('none', msg('none'), { when: (node) => node.type === 'polyline' && !!node.closed }),
  ],
  image: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), { path: 'opacity', label: msg('Opacity'), type: 'opacity', fallback: 1 }],
  // Of everything in it, on top of the opacity of each thing. Not under Style, whose eyedropper takes a stroke and a fill.
  group: [{ path: 'opacity', label: msg('Opacity'), type: 'opacity', fallback: 1, section: msg('Appearance') }],
  // A placed component looks as the component does, in the colour of its layer where the
  // component gives none: it has no stroke or fill of its own to set (see fieldsOf).
  instance: PLACEMENT,
  parametric: PLACEMENT,
}

/** The fields only a sheet can fill in: offered for the texts of what is on every sheet, and not elsewhere, where they would stay as written. */
export const SHEET_FIELDS: string[] = ['sheet', 'scale', 'format']

/** What each field of a text is called. */
export const FIELD_NAMES: Record<(typeof TEXT_FIELDS)[number], string> = {
  date: msg('Today’s date'),
  page: msg('Name of the page'),
  'page-number': msg('Number of the page'),
  pages: msg('Number of pages'),
  document: msg('Name of the drawing'),
  project: msg('Project'),
  client: msg('Client'),
  address: msg('Address'),
  author: msg('Author'),
  sheet: msg('Name of the sheet'),
  scale: msg('Scale of the sheet'),
  format: msg('Format of the sheet'),
}

/**
 * A room's fields, with what its floor is made of among the drawing's materials. A floor of a
 * material looks as the material does, as a wall does, and has no fill to set: its look is changed
 * in the Materials panel. One given a fill of its own before (by a script, a file of 1.3) shows it,
 * to be taken off.
 */
function roomFields(node: Extract<Node, { type: 'room' }>, doc: Document): FieldSpec[] {
  // The default material is what walls are made of, not floors.
  const materials = Object.values(doc.materials ?? {}).filter((m) => m.id !== DEFAULT_MATERIAL)
  const material = node.material ? doc.materials?.[node.material] : undefined
  const choice: FieldSpec = { path: 'material', label: msg('Material'), type: 'string', section: FLOOR, material: true, options: [{ value: '', label: msg('None') }, ...materials.map((m) => ({ value: m.id, label: m.name }))] }
  const own = !!node.style && ('fill' in node.style || 'pattern' in node.style)
  return (FIELDS.room ?? []).flatMap((field) =>
    field.type !== 'fill' ? [field] : !material ? [choice, field] : own ? [choice, { ...field, inherited: { fill: material.fill, pattern: material.pattern }, unset: msg('from its material') }] : [choice],
  )
}

/** The properties several objects all have, to be set on all of them at once. */
export function commonFields(nodes: Node[], doc: Document): FieldSpec[] {
  const [first, ...rest] = nodes.map((node) => fieldsOf(node, doc))
  return first.filter((field) => rest.every((fields) => fields.some((other) => other.path === field.path && other.type === field.type && other.label === field.label)))
}

/**
 * A shape left unfilled in a component is backed with white wherever the component is placed
 * (`objectBacking`): its fill says so, and choosing None then writes 'none', which is see-through.
 */
const placedFill = (field: FieldSpec): FieldSpec => (field.type === 'fill' && field.fallback === 'none' ? { ...field, fallback: OBJECT_FILL, unset: msg('default') } : field)



/**
 * A link's fields: which button of a double switch it starts from (a choice only where there are
 * several), how much it bows, and its line.
 */
function linkFields(node: Extract<Node, { type: 'link' }>, doc: Document): FieldSpec[] {
  const buttons = portsOf(doc.nodes[node.from], registry).filter((port) => port.way === 'out' && port.carries === CONTROL)
  const button: FieldSpec[] =
    (node.role ?? 'control') === 'control' && buttons.length > 1
      ? [{ path: 'fromPort', label: msg('Button'), type: 'string', fallback: buttons[0].key, options: buttons.map((port) => ({ value: port.key, label: port.label })) }]
      : []
  // Empty, it bows into the plan by itself (`linkBend`).
  return [...button, { ...num('bend', msg('Curve')), optional: true }, ...stroke(STROKE)]
}

/** Rounded to a thousandth of a millimetre, as lengths are kept. */
const tidy = (n: number) => Math.round(n * 1000) / 1000

/** A field of the size of a placed object, on the row of its width, depth and height. */
const SIZE = (name: string) => ({ id: 'object size', name, size: true })

/** How high above the floor an object is, as Z: its underside, unless it is fixed on a wall by its centre. Empty, it is on the floor, which it says. */
const aboveFloor = (fixed?: ParametricKind['mount']): FieldSpec => ({
  path: 'z',
  label: msg('Height above floor'),
  type: 'number',
  length: true,
  optional: true,
  ...(fixed?.on === 'wall' ? { fallback: fixed.height ?? 0 } : { empty: msg('Floor') }),
  note: fixed?.on === 'wall' && fixed.measured !== 'bottom' ? msg('Height above the floor, to its centre') : msg('Height above the floor, to its underside'),
})

/** The side `moving` of a placement's frame (`frameGrips`) put `value` from the side across it, `fixed`, which stays. */
function frameSideTo(node: Node, value: unknown, doc: Document, moving: number, fixed: number): Op[] {
  const frame = resizeFrame(node, registry, doc)
  if (!frame || typeof value !== 'number' || !(value > 0)) return []
  const grips = frameGrips(frame)
  const patch = resizePatch(node, moving, add(grips[fixed], scale(norm(sub(grips[moving], grips[fixed])), value)), false, registry, doc)
  return patch ? [{ op: 'update_node', id: node.id, patch }] : []
}

/** How large a placement of a component is: as wide and deep as it is drawn on the plan, as tall as its component says (which every placement of it shares). */
const PLACEMENT_SIZE: FieldSpec[] = [
  { path: 'size.width', label: msg('Width'), type: 'number', length: true, row: SIZE('W'), get: (n, doc) => resizeFrame(n, registry, doc)?.width, set: (n, v, doc) => frameSideTo(n, v, doc, 5, 7) },
  { path: 'size.depth', label: msg('Depth'), type: 'number', length: true, row: SIZE('D'), get: (n, doc) => resizeFrame(n, registry, doc)?.height, set: (n, v, doc) => frameSideTo(n, v, doc, 6, 4) },
  {
    path: 'size.height',
    label: msg('Height'),
    type: 'number',
    length: true,
    optional: true,
    empty: msg('None'),
    row: SIZE('H'),
    get: (n, doc) => {
      const component = n.type === 'instance' ? doc.nodes[n.component] : undefined
      return n.type === 'instance' && component?.type === 'component' && component.height ? tidy(component.height * (n.scale ?? 1)) : undefined
    },
    set: (n, v) => (n.type === 'instance' ? [{ op: 'update_node', id: n.component, patch: { height: typeof v === 'number' && v > 0 ? tidy(v / (n.scale ?? 1)) : null } }] : []),
  },
]

/**
 * The parameters a kind is sized by on the plan, found by asking its box (`ParametricKind.box`) for
 * another width, then another depth, and seeing which parameter it changes; else its size along its X
 * (a door's width). And its height, a `height` parameter. Each only when it is one number.
 */
function sizeKeys(kind: ParametricKind, props: Record<string, unknown>): { W?: string; D?: string; H?: string } {
  const numeric = (key: string | undefined) => (key && kind.params.some((p) => p.key === key && p.type === 'number') ? key : undefined)
  const changed = (size: { width?: number; height?: number }) => {
    const keys = Object.keys(kind.box!.resize(props, size))
    return keys.length === 1 ? keys[0] : undefined
  }
  return {
    W: numeric(kind.box ? changed({ width: 1000 }) : kind.size?.x),
    D: numeric(kind.box ? changed({ height: 1000 }) : undefined),
    H: numeric('height'),
  }
}

/** The choices of a parameter, each said as "Parameter: Value" where its kind says it so for that parameter: "Single" glazing is not a "Single" door. */
export const paramOptions = (p: ParametricKind['params'][number]): Option[] | undefined =>
  p.options?.map((value) => ({ value, label: t(`${p.label}: ${value}`) !== `${p.label}: ${value}` ? `${p.label}: ${value}` : value }))

/**
 * The height of what its kind may work out where it stands (`heightIn`): when it does, the height it
 * has there (a wall cabinet up to the ceiling, a tall unit as high as its sections). Typed, it makes
 * it that high as its kind says (`heightSet`: a wall cabinet no longer up to the ceiling); where its
 * kind says nothing, it is shown, not typed.
 */
const heightThere = (field: FieldSpec): FieldSpec => {
  const key = field.path.slice('props.'.length)
  const worked = (node: Node, doc: Document) => (node.type === 'parametric' ? heightInPlace(doc, node, registry) : null)
  return {
    ...field,
    get: (node, doc) => worked(node, doc) ?? (node.type === 'parametric' ? node.props[key] : undefined),
    set: (node, value, doc) => {
      const kind = node.type === 'parametric' ? registry.parametric.get(node.kind) : undefined
      if (!kind || node.type !== 'parametric' || typeof value !== 'number') return []
      const patch = worked(node, doc) === null ? { [key]: value } : kind.heightSet?.(registry.resolveProps(kind, node.props), value)
      return patch ? [{ op: 'update_node', id: node.id, patch: { props: { ...node.props, ...patch } } }] : []
    },
    readOnly: (node, doc) => worked(node, doc) !== null && !(node.type === 'parametric' && registry.parametric.get(node.kind)?.heightSet),
  }
}

/** A view's automatic dimensions: the rows it draws, each on unless it says not, and the dimension style they are drawn in, among the drawing's. */
function autoDimensionFields(doc: Document): FieldSpec[] {
  const ROWS_OF = msg('Dimensions drawn')
  const styles = Object.values(doc.dimensionStyles ?? {})
  return [
    { path: 'fixed', label: msg('Fixed on the face'), type: 'boolean', fallback: true, section: ROWS_OF, note: msg('Sockets, switches and wall cabinets, from the start of the view to each.') },
    { path: 'pieces', label: msg('Along the floor'), type: 'boolean', fallback: true, section: ROWS_OF, note: msg('The sides of the doors, windows and furniture, one after the other.') },
    { path: 'overall', label: msg('End to end'), type: 'boolean', fallback: true, section: ROWS_OF, note: msg('The face from end to end, and its height.') },
    { path: 'heights', label: msg('Heights'), type: 'boolean', fallback: true, section: ROWS_OF, note: msg('Of what is fixed on the face, and of a door\'s or a window\'s sill and top.') },
    { path: 'dimensionStyle', label: msg('Dimension style'), type: 'string', section: ROWS_OF, options: [{ value: '', label: msg('default') }, ...styles.map((style) => ({ value: style.id, label: style.name }))] },
    { path: 'unit', label: msg('Unit'), type: 'string', section: ROWS_OF, fallback: 'mm', options: options(['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft'], ['ft-in', msg('ft and in')]), note: msg('Unless their dimension style gives one.') },
  ]
}

/** The dimensions a plan draws by itself round its building: what each side shows, and how they are written. */
function planDimensionFields(doc: Document): FieldSpec[] {
  const SIDES = msg('Dimensions drawn')
  const styles = Object.values(doc.dimensionStyles ?? {})
  const rows = options(['overall', msg('End to end')], ['detailed', msg('Wall by wall, with the openings')], ['both', msg('Both')], ['none', msg('None')])
  return [
    { path: 'top', label: msg('Top'), type: 'string', section: SIDES, fallback: 'overall', options: rows },
    { path: 'left', label: msg('Left'), type: 'string', section: SIDES, fallback: 'overall', options: rows },
    { path: 'bottom', label: msg('Bottom'), type: 'string', section: SIDES, fallback: 'detailed', options: rows },
    { path: 'right', label: msg('Right'), type: 'string', section: SIDES, fallback: 'detailed', options: rows, note: msg('Worked out from the walls each time: they follow every change. The detailed row is nearer the building, the overall one beyond it.') },
    { path: 'dimensionStyle', label: msg('Dimension style'), type: 'string', section: SIDES, options: [{ value: '', label: msg('default') }, ...styles.map((style) => ({ value: style.id, label: style.name }))] },
    { path: 'unit', label: msg('Unit'), type: 'string', section: SIDES, fallback: 'mm', options: options(['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft'], ['ft-in', msg('ft and in')]), note: msg('Unless their dimension style gives one.') },
  ]
}

export function fieldsOf(node: Node, doc: Document): FieldSpec[] {
  const fields =
    node.type === 'room' ? roomFields(node, doc) : node.type === 'link' ? linkFields(node, doc) : node.type === 'autodimensions' ? autoDimensionFields(doc) : node.type === 'plandimensions' ? planDimensionFields(doc) : (FIELDS[node.type] ?? [])
  // What every placed object has, first: where it is (X, Y, and Z, its height above the floor),
  // how it is turned, and how large it is (W, D, H). What is its own comes after.
  const [x, y, rotation] = PLACEMENT
  // A placement looks as its component is drawn: it has no look of its own to set.
  if (node.type === 'instance') return [x, y, aboveFloor(), rotation, ...PLACEMENT_SIZE]
  if (node.type !== 'parametric') return drawnSolid(doc, node.parent) ? fields.map(placedFill) : fields
  const kind = registry.parametric.get(node.kind)
  const params = kind?.params ?? []
  const asField = (p: ParametricKind['params'][number]): FieldSpec =>
    p.type === 'list'
      ? { path: `props.${p.key}`, label: p.label, type: 'list', list: p }
      : {
          path: `props.${p.key}`,
          label: p.label,
          type: p.type,
          length: p.unit === 'length',
          angle: p.unit === 'angle',
          percent: p.unit === 'percent',
          fallback: Array.isArray(p.default) ? undefined : p.default,
          options: paramOptions(p),
        }
  // A door or a window is as high above the floor as its sill: that parameter is its Z, beside X and Y
  // (it is kept with the rest of its parameters, where elevations and extensions read it).
  const sill = kind?.sill ? params.find((p) => p.key === kind.sill && p.type === 'number') : undefined
  const z = kind?.opening
    ? sill
      ? [{ ...asField(sill), label: msg('Height above floor'), note: msg('Height above the floor, to its sill'), row: ROWS.z }]
      : []
    : [aboveFloor(kind?.mount)]
  const shown = kind?.mount?.on === 'wall' ? [{ path: 'showHeight', label: msg('Height on plan'), type: 'boolean' as const, fallback: false }] : []
  const props = kind ? registry.resolveProps(kind, node.props) : {}
  const keys = kind ? sizeKeys(kind, props) : {}
  const sized = (['W', 'D', 'H'] as const).flatMap((name): FieldSpec[] => {
    const param = params.find((p) => p.key === keys[name])
    if (!param) return []
    const field = { ...asField(param), row: SIZE(name) }
    return [name === 'H' && kind?.heightIn ? heightThere(field) : field]
  })
  // The rest of its parameters, under its own name, those that mean something with the values it has.
  const own = params.filter((p) => !Object.values(keys).includes(p.key) && p !== sill && (p.shown?.(props) ?? true)).map((p): FieldSpec => ({ ...asField(p), section: kind!.label }))
  return [x, y, ...z, rotation, ...shown, ...sized, ...own, ...STYLE]
}
