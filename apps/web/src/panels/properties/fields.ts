import { DEFAULT_MATERIAL, type Document, drawnSolid, type Node, OBJECT_FILL, TEXT_FIELDS, type Pattern } from '@opencalque/core'
import { msg, t } from '../../i18n'
import { registry } from '../../extensions'

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
  type: 'number' | 'string' | 'boolean' | 'color' | 'dash' | 'weight' | 'fill' | 'opacity'
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
  /** The property may be cleared by emptying the field. */
  optional?: boolean
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
}

export const GEOMETRY = msg('Geometry')

/**
 * Fields shown side by side when one follows the other, by the path of the first: what the second
 * is and what the row is called. Those that are `size` can keep their proportions.
 */
export const PAIRS: Record<string, { second: string; label: string; size?: boolean }> = {
  x: { second: 'y', label: msg('X, Y') },
  cx: { second: 'cy', label: msg('X, Y') },
  'a.x': { second: 'a.y', label: msg('X1, Y1') },
  'b.x': { second: 'b.y', label: msg('X2, Y2') },
  width: { second: 'height', label: msg('W, H'), size: true },
  rx: { second: 'ry', label: msg('Radii'), size: true },
}

/** Fields in the rows they are shown on: a pair (`PAIRS`) on one, any other alone. */
export function rowsOf(fields: FieldSpec[]): FieldSpec[][] {
  const rows: FieldSpec[][] = []
  for (const field of fields) {
    const last = rows[rows.length - 1]
    if (last?.length === 1 && PAIRS[last[0].path]?.second === field.path) last.push(field)
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

const FLOOR = msg('Floor')

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
  // A paper's size is its format and scale, and where it lies is typed at the top of its panel: it has no geometry section.
  paper: [],
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

export function fieldsOf(node: Node, doc: Document): FieldSpec[] {
  const fields = node.type === 'room' ? roomFields(node, doc) : (FIELDS[node.type] ?? [])
  // A placement looks as its component is drawn: it has no look of its own to set.
  if (node.type === 'instance') return fields
  if (node.type !== 'parametric') return drawnSolid(doc, node.parent) ? fields.map(placedFill) : fields
  const params = registry.parametric.get(node.kind)?.params ?? []
  const own = params.map((p): FieldSpec => ({
    path: `props.${p.key}`,
    label: p.label,
    type: p.type,
    length: p.unit === 'length',
    fallback: p.default,
    // A value may be said differently for one parameter: "Single" glazing is not a "Single" door.
    options: p.options?.map((value) => ({ value, label: t(`${p.label}: ${value}`) !== `${p.label}: ${value}` ? `${p.label}: ${value}` : value })),
  }))
  return [...fields, ...own, ...STYLE]
}
