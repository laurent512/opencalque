import * as z from 'zod'

// Zod otherwise probes for `eval` support, which trips the app's Content-Security-Policy.
z.config({ jitless: true })

export const FORMAT = 'opencalque'
/** What `format` was before the project was renamed. Such drawings are still read. */
export const FORMER_FORMAT = 'opencad'
export const FORMAT_VERSION = 2

const Id = z.string().min(1)

export const Vec2Schema = z.object({ x: z.number(), y: z.number() })

export const PatternSchema = z
  .object({
    kind: z.string().describe("Which pattern: 'Lines', 'Cross', 'Planks', 'Tiles', 'Dots' or 'Zigzag'; 'None' for no pattern where one would otherwise be taken from a material."),
    spacing: z.number().positive().optional().describe('Distance between its strokes, in mm. Each pattern has its own when not given.'),
    angle: z.number().optional().describe('Degrees its strokes are turned by. Each pattern has its own when not given.'),
    stroke: z.string().optional().describe('The colour of its strokes. A CSS colour or a shared colour reference.'),
    strokeWidth: z.number().positive().optional().describe('The weight of its strokes, in screen pixels as in a style. 0.6 when not given.'),
    opacity: z.number().min(0).max(1).optional().describe('How opaque its strokes are, from 0 (not at all) to 1 (the default), on top of the opacity of their colour.'),
  })
  .describe('A pattern of strokes drawn over a fill, inside each closed shape: the hatching that tells a material, or a floor.')

export type Pattern = z.infer<typeof PatternSchema>

export const StyleSchema = z
  .object({
    stroke: z.string().optional().describe("CSS color of lines and text, or 'none'. Any colour property may instead be a shared colour, \"var(--<id>)\", or \"var(--layer)\": the colour of the node's layer."),
    strokeWidth: z.number().positive().optional().describe('Line weight in screen pixels (does not scale with zoom). On paper one pixel prints as 0.25 mm, so 2 is a 0.5 mm line.'),
    fill: z.string().optional().describe("CSS fill color, or 'none', a shared colour \"var(--<id>)\", or \"var(--layer)\" to fill with the colour of the node's layer."),
    pattern: PatternSchema.optional(),
    dash: z.array(z.number().positive()).optional().describe('Dash pattern in screen pixels.'),
  })
  .describe('Overrides the look of a node. Unset values fall back to the node kind, then the layer color.')

export const LayerSchema = z
  .object({
    id: Id,
    name: z.string(),
    order: z.string().describe('Fractional index such as "a0"; layers sort by plain string comparison of this key.'),
    visible: z.boolean().optional().describe('Defaults to true.'),
    locked: z.boolean().optional().describe('Defaults to false.'),
    color: z.string().optional().describe('Default stroke color of nodes on this layer.'),
  })
  .describe('A drawing layer: a named set of nodes that can be hidden, locked and colored together.')

export const AssetSchema = z
  .object({
    id: Id,
    mime: z.string().describe("Media type, e.g. 'image/jpeg'."),
    data: z.string().describe('The file contents, base64-encoded.'),
    width: z.number().positive().optional().describe('Width of the picture in pixels.'),
    height: z.number().positive().optional().describe('Height of the picture in pixels.'),
  })
  .describe('A binary file embedded in the document, referenced by image nodes.')

/** How a wall end is finished where it meets one other wall. */
export const WALL_JOINS = ['miter', 'round', 'bevel', 'through', 'butt', 'free'] as const
const join = z.enum(WALL_JOINS).optional()

export const SharedColorSchema = z
  .object({
    id: Id,
    name: z.string(),
    value: z.string().describe('A CSS color, e.g. "#2563eb".'),
  })
  .describe(
    'A named colour that belongs to the drawing. A stroke, a fill or a layer colour refers to it by writing "var(--<id>)" in place of a colour; changing the value here then changes everything that refers to it.',
  )
/**
 * The id of the default material: what walls are made of until they are given another. Walls of
 * no material take its fill and pattern; it is never referred to, cannot be removed, and need not
 * be there, walls then being white.
 */
export const DEFAULT_MATERIAL = 'default'

export const MaterialSchema = z
  .object({
    id: Id,
    name: z.string(),
    fill: z.string().optional().describe('The colour it is drawn in where it is cut, in a wall or a floor. A CSS colour or a shared colour reference. White when not given.'),
    pattern: PatternSchema.optional().describe('The pattern drawn over that colour: the hatching that tells the material.'),
  })
  .describe(
    'A material the drawing is built of: concrete, brick, insulation, plaster, a floor finish. It belongs to the drawing, as a shared colour does: walls and the floors of rooms refer to it by its id, are drawn in its colour and pattern, and are counted under its name. The material of id "default" is what walls are made of until given another: walls of no material take its fill and pattern, unless they give their own; it cannot be removed.',
  )

export type Material = z.infer<typeof MaterialSchema>

export type SharedColor = z.infer<typeof SharedColorSchema>
export type WallEdge = z.infer<typeof WallEdgeSchema>

export const ModifierSchema = z
  .object({
    type: z.string().describe("The kind of modifier: 'crop', or one registered by an extension. Unknown kinds are kept and skipped."),
    enabled: z.boolean().optional().describe('Defaults to true. A modifier that is switched off stays in the list.'),
    params: z.record(z.string(), z.unknown()).optional().describe('Parameters of the kind. Missing ones use the kind defaults.'),
    frame: z
      .object({ x: z.number(), y: z.number(), rotation: z.number().optional(), flipX: z.boolean().optional(), scale: z.number().positive().optional() })
      .optional()
      .describe('Where the modifier sits on the drawing: positions among its parameters are relative to it. It follows the node when the node is moved, turned or scaled.'),
  })
  .describe(
    "A non-destructive change to how a node is drawn; the node itself is not altered. 'crop' shows only what is inside the rectangle that starts at its frame and has params.width and params.height.",
  )
export type Modifier = z.infer<typeof ModifierSchema>

const base = {
  id: Id,
  name: z.string().optional(),
  parent: Id.nullable().describe('Id of the page, component or group this node is directly inside. Null for pages and components.'),
  order: z
    .string()
    .describe('Fractional index giving the z-order among siblings (plain string comparison, later = on top). A key of the fractional-indexing package, such as "a0", "a1" or "a0V"; leave it out when adding a node to put it on top.'),
  layer: Id.optional().describe('Id of the layer the node is on. A node inside a component has none: what a component holds is drawn on the layer of each of its instances.'),
  visible: z.boolean().optional().describe('Defaults to true.'),
  locked: z.boolean().optional().describe('Defaults to false.'),
  style: StyleSchema.optional().describe('Overrides the look of a node. Unset values fall back to the node kind, then the layer color. An instance has none: it looks as its component is drawn.'),
  modifiers: z
    .array(ModifierSchema)
    .optional()
    .describe('Modifiers applied to what this node draws, one after the other in this order. On a group or an instance they apply to everything it holds.'),
  meta: z.record(z.string(), z.unknown()).optional().describe('Free-form data for extensions and tools.'),
}

const rotation = z.number().optional().describe('Degrees, clockwise on screen.')
const font = z.string().optional().describe("CSS font family, e.g. 'serif'. Defaults to the system sans-serif.")

export const DIMENSION_MARKERS = ['tick', 'arrow', 'open-arrow', 'dot', 'none'] as const
const marker = z.enum(DIMENSION_MARKERS).optional().describe("Symbol at this end of the dimension line. Defaults to 'tick'.")
const tip = z.enum(DIMENSION_MARKERS).optional()
const markerSize = z.number().positive().optional().describe('Length of the end symbols in mm. Defaults to 150.')
/** The paths an annotation's leader can take. */
export const LEADER_SHAPES = ['curve', 'straight', 'elbow'] as const
/** Which ends of a grid line carry its bubble. */
export const GRIDLINE_BUBBLES = ['start', 'end', 'both', 'none'] as const

/** The look of a dimension: everything about it but where it is and what it says in place of its length. A dimension style may define any of it. */
const dimensionLook = {
  startMarker: marker,
  endMarker: marker,
  markerSize: z.number().positive().optional().describe('Length of the end markers in mm. Defaults to 100.'),
  extension: StyleSchema.pick({ stroke: true, strokeWidth: true, dash: true })
    .optional()
    .describe('Look of the two extension lines. Unset values follow the dimension line.'),
  extensionGap: z.number().nonnegative().optional().describe('Gap in mm between a measured point and its extension line. Defaults to 0.'),
  size: z.number().positive().optional().describe('Text size in mm. Defaults to 150.'),
  font,
  textColor: z.string().optional().describe('Defaults to the color of the dimension line.'),
  textPosition: z.enum(['above', 'center', 'below']).optional().describe("Where the text sits relative to the dimension line. Defaults to 'above'."),
  textRotation: z.enum(['aligned', 'horizontal']).optional().describe("Defaults to 'aligned' (along the dimension line)."),
  verticalText: z
    .enum(['up', 'down'])
    .optional()
    .describe(
      "Which way text along a vertical dimension line reads: 'up', from bottom to top, read with the head turned to the left or from the right-hand side of the sheet (as ISO 129 asks); 'down' (the default), from top to bottom, read with the head turned to the right. A line within a degree of vertical counts as vertical; text along any other line reads from below.",
    ),
  unit: z.enum(['mm', 'cm', 'm', 'in', 'ft', 'ft-in']).optional().describe("Unit the measured value is shown in. Defaults to 'mm'. 'ft-in' writes feet and inches with a fraction, as 7' 6 1/2\". Coordinates stay in mm whatever this is."),
  fraction: z.number().int().positive().optional().describe("With unit 'ft-in': the fraction of an inch the value is rounded to, as its lower number (2, 4, 8, 16, 32). Defaults to 16."),
  decimals: z.number().int().min(0).max(6).optional().describe('Decimal places. Defaults to 0 for mm, 1 for cm and in, 2 for m and ft.'),
  showUnit: z.boolean().optional().describe('Append the unit to the value.'),
  decimal: z.enum(['.', ',']).optional().describe("The decimal separator of the value, in place of the drawing's (\"settings\"). Left out, the drawing's."),
}

export const DimensionStyleSchema = z
  .object({
    id: Id,
    name: z.string(),
    style: StyleSchema.pick({ stroke: true, strokeWidth: true, dash: true }).optional().describe('The dimension line and its end markers, as the "style" of a dimension.'),
    ...dimensionLook,
  })
  .describe(
    'A way of drawing dimensions that belongs to the drawing. It holds the properties of a dimension that it gives a value to, under the same names, and only those. A dimension refers to it by "dimensionStyle" and takes what it defines; a value the dimension gives itself wins, and what the style leaves out stays the dimension\'s own.',
  )

export type DimensionStyle = z.infer<typeof DimensionStyleSchema>
export type DimensionStyleProperty = Exclude<keyof DimensionStyle, 'id' | 'name'>
/** What a dimension style can define for its dimensions: the properties of a dimension that make its look. */
export const DIMENSION_STYLE_PROPERTIES = Object.keys(DimensionStyleSchema.shape).filter((key) => key !== 'id' && key !== 'name') as DimensionStyleProperty[]

/** One line of a wall's outline: whether it is drawn, and its own colour, weight and kind of line over the wall's. */
export const WallEdgeSchema = z.object({
  show: z.boolean().optional(),
  stroke: z.string().optional().describe('A CSS colour or a shared colour reference.'),
  strokeWidth: z.number().positive().optional().describe('In screen pixels, as in a style.'),
  dash: z.array(z.number().positive()).optional().describe('Dash pattern in screen pixels, as in a style.'),
})

export const NodeSchema = z
  .discriminatedUnion('type', [
    z
      .object({ ...base, type: z.literal('page'), wallHeight: z.number().positive().optional().describe('How high the walls of this page stand, in mm, unless a wall gives its own. Used to measure wall faces; nothing is drawn with it.') })
      .describe('A drawing sheet. Top-level container.'),
    z
      .object({
        ...base,
        type: z.literal('component'),
        description: z.string().optional(),
        sheet: z
          .object({ width: z.number().positive(), height: z.number().positive() })
          .optional()
          .describe(
            'Makes the component what is on every sheet of the drawing: a title, a logo, a north arrow. It is the size, in millimetres of real paper, of the sheet its children are drawn on (297 × 210 for an A4 lying), from that sheet\'s top-left corner. Every paper draws them over itself at its own scale, each kept at its distance from the corner of the sheet it is nearest to, so a sheet of another size has them in its own corners. In their texts, {sheet}, {scale}, {format}, {page}, {project} and the other fields are filled in for each sheet. A drawing has one such component; a paper that is "plain" leaves it out.',
          ),
      })
      .describe('A reusable definition. Its children are drawn wherever an instance references it.'),
    z
      .object({
        ...base,
        type: z.literal('group'),
        opacity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('How opaque everything in the group is drawn, from 0 (not at all) to 1, on top of the opacity of each thing and of the groups around it. Defaults to 1.'),
      })
      .describe(
        'Several nodes treated as one object: selected, moved and stacked together. It has no geometry; the nodes whose parent is this group keep their own coordinates. Groups can be nested.',
      ),
    z
      .object({ ...base, type: z.literal('line'), a: Vec2Schema, b: Vec2Schema, startMarker: tip.describe("Symbol at a. Defaults to 'none'."), endMarker: tip.describe("Symbol at b. Defaults to 'none'."), markerSize })
      .describe('A straight line from a to b, optionally with an arrow or another symbol at either end.'),
    z
      .object({
        ...base,
        type: z.literal('polyline'),
        points: z.array(Vec2Schema).min(2),
        closed: z.boolean().optional(),
        smooth: z.boolean().optional().describe('Drawn as a curve flowing through the points instead of straight segments.'),
        startMarker: tip.describe("Symbol at the first point of an open polyline. Defaults to 'none'."),
        endMarker: tip.describe("Symbol at its last point. Defaults to 'none'."),
        markerSize,
      })
      .describe('A line through several points; closed, it is a polygon.'),
    z
      .object({
        ...base,
        type: z.literal('rect'),
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        rotation,
      })
      .describe('Rectangle with its top-left corner at (x, y), rotated around that corner.'),
    z
      .object({
        ...base,
        type: z.literal('room'),
        x: z.number(),
        y: z.number(),
        size: z.number().positive().optional().describe('Size of the name and area written at (x, y), in mm. Defaults to 250.'),
        showArea: z.boolean().optional().describe('Whether the floor area is written under the name. Defaults to true.'),
        showPerimeter: z.boolean().optional().describe('Whether how far it is round the floor (along the faces of its walls, doors included) is written under the name and area, in m or ft as the drawing settings say. Defaults to false.'),
        system: z.enum(['metric', 'imperial']).optional().describe("'imperial' writes the floor area in square feet, 'metric' in square metres, in place of the drawing's \"settings\". Left out (as it should be), the drawing's."),
        decimal: z.enum(['.', ',']).optional().describe("The decimal separator of the area, in place of the drawing's \"settings\". Left out (as it should be), the drawing's."),
        material: Id.optional().describe('The id of the material its floor is made of, among the document\'s "materials": the floor takes its colour and pattern, unless the room gives its own in "style", and is counted under it.'),
      })
      .describe(
        'A room: the space enclosed by the walls and dividers around the point (x, y), which is also where its name and area are written. Its outline is not stored: it is found from the walls each time, so it follows them. Give it a "name". style.fill colours the floor and style.pattern covers it (tiles, planks); style.stroke is the colour of the name and area. If the walls around the point do not close, only the name is drawn.',
      ),
    z
      .object({
        ...base,
        type: z.literal('table'),
        x: z.number(),
        y: z.number(),
        schedule: z
          .string()
          .describe(
            "What it counts, which is worked out again each time it is drawn: 'objects' (each component and each kind of parametric object, with how many are placed), 'floors' (the floor area of each material), 'rooms' (each room and its area), 'walls' (the walls by material and thickness: how many, length, face and volume) or 'openings' (doors and windows by kind and size). An unknown one draws an empty table.",
          ),
        title: z.string().optional().describe('Written above the table.'),
        columns: z
          .array(z.string())
          .optional()
          .describe("The fields shown, in order. Left out, the schedule's usual ones. Fields: objects: symbol (each drawn as it is on the plan), name, count; floors: material, rooms, area; rooms: name, material, area; walls: material, thickness, count, length, area, volume; openings: kind, width, height, count."),
        labels: z
          .record(z.string(), z.string())
          .optional()
          .describe("The words the table is written with, by field (the heading of its column), and 'total' (the last row) and 'none' (what stands for no material or no type). Left out, English ones."),
        size: z.number().positive().optional().describe('Text size in mm. Defaults to 200.'),
        source: Id.optional().describe('The id of the page whose contents it counts. Defaults to the page it is on.'),
        totals: z.boolean().optional().describe('Whether a last row adds up the columns that can be added up. Defaults to true.'),
        rowsPerBlock: z
          .number()
          .positive()
          .optional()
          .describe('At most this many rows of things counted one under the other: the next ones go into a block beside it, with the headings again, and so on, the total at the end of the last. Left out, all in one block.'),
        only: z
          .array(z.string())
          .optional()
          .describe(
            "The rows shown, by their keys; the others are left out of the table and its total, and what comes on the plan later is not shown. Keys: objects 'component:<id>', or for a parametric object 'parametric:' then its kind and every one of its parameters, defaults filled in, as JSON with its keys in order ('parametric:arch.radiator {\"length\":800,...}': a model with other parameters is another row); floors 'material:<id>' ('material:' for the floors of no material); rooms 'room:<id>'; walls 'material:<id>' and the thickness in mm, as 'material:brick 200' ('material: 200' for the default material); openings the kind, then width and height in metres, as 'arch.door 0.9 2.1', whatever the table's units. Left out, every row.",
          ),
        decimal: z.enum(['.', ',']).optional().describe("The decimal separator of its numbers, in place of the drawing's \"settings\". Left out (as it should be), the drawing's."),
        system: z.enum(['metric', 'imperial']).optional().describe("'imperial' gives lengths in feet, areas in square feet, volumes in cubic feet and thicknesses in inches, in place of the drawing's \"settings\". Left out (as it should be), the drawing's."),
        language: z.string().optional().describe('The language code its rows are named in where they take a name from an extension, as "fr".'),
      })
      .describe('A table of quantities placed on the drawing, its top-left corner at (x, y): what is on a page, counted and measured, and kept up to date as the drawing changes.'),
    z
      .object({ ...base, type: z.literal('divider'), a: Vec2Schema, b: Vec2Schema })
      .describe('A line that separates two rooms where there is no wall, for example between a kitchen and a living room in one open space. It bounds rooms as a wall does and takes no space.'),
    z
      .object({
        ...base,
        type: z.literal('paper'),
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        scale: z.number().positive().optional().describe('The drawing scale of the sheet, as the N of 1:N. Default 100. An A3 sheet (420 × 297 mm of paper) at 1:100 is 42000 × 29700 here.'),
        plain: z.boolean().optional().describe('When true, this sheet leaves out what the drawing puts on every sheet (the component that has a "sheet" size).'),
        titleBlock: z
          .object({
            project: z.string().optional().describe('Overrides the project of the drawing on this sheet.'),
            author: z.string().optional().describe('Overrides the author of the drawing on this sheet.'),
            date: z.string().optional(),
            number: z.string().optional(),
            hide: z.array(z.string()).optional().describe("Entries this sheet leaves out, among project, client, address, sheet, page, author, scale, format, date and number. Defaults to ['page']."),
          })
          .optional()
          .describe(
            'When present (even empty), the sheet gets a border and a title block in its bottom right corner. The block is made of the entries that have something to say and are not hidden: the project, client and address (from the document\'s "info"; the project falls back on the document name), the name of the paper and of its page, the author, the scale and format, and the date and sheet number given here. An entry with nothing in it takes no room. Texts may hold fields such as {date} or {page-number}.',
          ),
      })
      .describe(
        'A sheet of paper laid on the drawing, with its top-left corner at (x, y): it frames the part of the drawing meant for one printed sheet. Width and height are in drawing millimetres like everything else. It has no children: whatever lies entirely inside its rectangle is on it, and is moved and copied with it in the editor.',
      ),
    z.object({
      ...base,
      type: z.literal('ellipse'),
      cx: z.number(),
      cy: z.number(),
      rx: z.number().nonnegative(),
      ry: z.number().nonnegative(),
      rotation,
      from: z.number().optional().describe('With `to`, makes it an arc: the angle in degrees where the arc starts, measured clockwise on screen from the X axis.'),
      to: z.number().optional().describe('The angle where the arc ends, going clockwise from `from`.'),
    }),
    z
      .object({
        ...base,
        type: z.literal('text'),
        x: z.number(),
        y: z.number(),
        text: z.string(),
        size: z.number().positive(),
        rotation,
        font,
        bold: z.boolean().optional(),
        align: z.enum(['left', 'center', 'right']).optional().describe("Which part of each line is at x: its left end (the default), its middle, or its right end."),
      })
      .describe(
        'Text anchored at the left end of the baseline of its first line; a line break in the text starts a new line below. Size is the font size in mm. These fields are filled in when it is drawn: {date}, {page} (name of the page it is on), {page-number}, {pages} (how many pages there are), {document}.',
      ),
    z
      .object({
        ...base,
        type: z.literal('annotation'),
        a: Vec2Schema.describe('The tip: the point the note is about.'),
        b: Vec2Schema.describe('Where the leader ends and the text sits. The text runs away from the tip: to the right of b when b is right of a, otherwise ending at b.'),
        text: z.string().describe('The note. May be empty, which leaves an arrow.'),
        size: z.number().positive().optional().describe('Text size in mm. Defaults to 200.'),
        font,
        startMarker: tip.describe("Symbol at the tip (a). Defaults to 'arrow'."),
        endMarker: tip.describe("Symbol at the text end (b). Defaults to 'none'."),
        markerSize: z.number().positive().optional().describe('Length of the end symbols in mm. Defaults to three quarters of the text size.'),
        shape: z.enum(LEADER_SHAPES).optional().describe("The path of the leader: 'curve' (the default, see bend), 'straight', or 'elbow', which leaves the text level and then turns square to reach the tip."),
        bend: z.number().optional().describe('How much a curved leader bows, as a fraction of its length: 0 is straight, positive bows one way and negative the other. Defaults to 0.2.'),
      })
      .describe('A note pointing at something: a leader line from the tip a to the point b, with text beside b.'),
    z
      .object({
        ...base,
        type: z.literal('gridline'),
        a: Vec2Schema,
        b: Vec2Schema,
        label: z.string().describe('What its bubble says, as "A" or "1".'),
        bubbles: z.enum(GRIDLINE_BUBBLES).optional().describe("Which ends carry the bubble: 'start' (at a, the default), 'end' (at b), 'both' or 'none'."),
        size: z.number().positive().optional().describe('The diameter of the bubble in mm. Defaults to 800; the label is half as tall.'),
        font,
      })
      .describe(
        'A grid line: a line of the building\'s grid from a to b, with a circle (its bubble) past one end or both, the label written upright inside; a label too wide for the circle stretches it level into a pill. Its "style" is the line, usually dashed; the bubble and the label take its colour and weight but are never dashed.',
      ),
    z
      .object({
        ...base,
        type: z.literal('wall'),
        a: Vec2Schema,
        b: Vec2Schema,
        thickness: z.number().positive().describe('In mm.'),
        material: Id.optional().describe(
          'The id of the material it is made of, among the drawing\'s "materials": it is drawn in its colour and pattern unless its style gives its own, and counted under it. Left out, it is of the default material. Walls of one material that meet are drawn as one; between walls of different materials that touch, a line is drawn. A wall built of several materials (brick lined with insulation, then plaster) is several walls side by side, each of one.',
        ),
        justify: z
          .enum(['left', 'center', 'right'])
          .optional()
          .describe(
            'Which line of the wall a and b are: absent or "center", its middle; "left" or "right", that face, as the wall runs from a to b, the whole thickness then lying on the other side. Corners are where these lines meet, so walls drawn by the same face keep that face flush whatever their thicknesses, and a change of thickness grows away from the line.',
          ),
        bulge: z
          .number()
          .optional()
          .describe(
            'Makes the wall curved: how far, in mm, the middle of its line (see "justify") stands off the straight line from a to b, the wall then following the arc of a circle through a, that point and b. Positive bows to the right of the direction a to b as seen on screen, negative to the left. At most half the distance from a to b, which is a half circle. Absent or 0 is a straight wall.',
          ),
        height: z.number().positive().optional().describe('How high it stands, in mm, when that differs from its page. Used to measure its face; nothing is drawn with it.'),
        edges: z
          .object({ left: WallEdgeSchema.optional(), right: WallEdgeSchema.optional(), a: WallEdgeSchema.optional(), b: WallEdgeSchema.optional() })
          .optional()
          .describe(
            'The lines of its outline one by one, each with a look of its own over the wall\'s style. "left" and "right" are its two faces, as it runs from a to b; "a" and "b" are the lines across its ends. "show": false hides a line. Across an end, left out, the line is drawn when the end is free or stops against another wall, and not where two walls are joined into one; "show": true draws the line between two joined walls (what cutting a wall in two gives).',
          ),
        joins: z
          .object({ a: join, b: join })
          .optional()
          .describe(
            "How each end is finished where it meets exactly one other wall. Left out (the default), the corner is automatic: a sharp point, cut off when the walls meet at less than 60° and the point would stick out. 'miter' keeps the sharp point at any angle, 'round' and 'bevel' round or cut that corner off, and 'through' with 'butt' on the other wall's end lets this wall run past while the other stops against it. Give both ends of a corner the same value, or the through/butt pair. 'free' joins this end to nothing, even where other walls end at the same point: it ends square, or cut along the side of a wall it stops against, and moving those walls leaves it where it is.",
          ),
      })
      .describe('A wall along the line a-b (its middle, or one of its faces with "justify"), straight or, with "bulge", an arc. Walls sharing an endpoint are drawn joined.'),
    z
      .object({
        ...base,
        type: z.literal('dimension'),
        a: Vec2Schema,
        b: Vec2Schema,
        offset: z.number().describe('Signed distance from the measured points to the dimension line.'),
        text: z.string().optional().describe('Replaces the measured value when set.'),
        dimensionStyle: Id.optional().describe('The id of the dimension style it is drawn in, among the document\'s "dimensionStyles". It takes what the style defines, except where it gives itself a value.'),
        ...dimensionLook,
      })
      .describe(
        'A linear dimension: an annotation showing the distance between a and b. The node "style" styles the dimension line and its end markers.',
      ),
    z
      .object({
        ...base,
        type: z.literal('image'),
        asset: Id.describe('Id of the asset holding the picture.'),
        x: z.number(),
        y: z.number(),
        width: z.number().positive().describe('Width the picture covers, in mm. Together with height this sets its scale.'),
        height: z.number().positive(),
        rotation,
        opacity: z.number().min(0).max(1).optional().describe('Defaults to 1.'),
      })
      .describe('A picture placed with its top-left corner at (x, y), typically a scanned plan to trace over.'),
    z
      .object({
        ...base,
        type: z.literal('instance'),
        component: Id.describe('Id of the component node being placed.'),
        x: z.number(),
        y: z.number(),
        rotation,
        flipX: z.boolean().optional(),
        scale: z.number().positive().optional().describe('Size multiplier of this placement. Defaults to 1.'),
        scaleX: z.number().positive().optional().describe('Stretch of this placement along the component\'s own X axis, on top of "scale": wider than it is drawn. Defaults to 1.'),
        scaleY: z.number().positive().optional().describe('Stretch of this placement along the component\'s own Y axis, on top of "scale": taller than it is drawn. Defaults to 1.'),
      })
      .describe('A placement of a component. Editing the component updates every instance.'),
    z
      .object({
        ...base,
        type: z.literal('parametric'),
        kind: z.string().describe("Parametric kind registered by an extension, e.g. 'arch.stair'."),
        props: z.record(z.string(), z.unknown()).describe('Parameters of the kind. Missing ones use the kind defaults.'),
        x: z.number(),
        y: z.number(),
        rotation,
        flipX: z.boolean().optional(),
      })
      .describe('An object generated from parameters by an extension. Unknown kinds are preserved and drawn as a placeholder.'),
  ])
  .describe('All coordinates and lengths are millimetres. X grows to the right, Y grows downward.')

/** How a whole drawing writes its numbers. What is placed in it follows, unless it says otherwise itself. */
export const DrawingSettingsSchema = z.object({
  system: z.enum(['metric', 'imperial']).optional().describe("'imperial': areas in square feet, and the lengths, volumes and thicknesses of tables of quantities in feet and inches. Defaults to 'metric' (square metres, metres)."),
  decimal: z.enum(['.', ',']).optional().describe("The decimal separator of the areas, tables and dimensions. Defaults to '.'."),
})

export const DocumentSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(FORMAT_VERSION),
    id: Id,
    name: z.string(),
    unit: z.literal('mm'),
    layers: z.record(Id, LayerSchema).describe('Layers by id.'),
    colors: z.record(Id, SharedColorSchema).optional().describe('Shared colours by id, referred to from colour properties as "var(--<id>)".'),
    materials: z.record(Id, MaterialSchema).optional().describe('Materials by id, referred to from walls and the floors of rooms by "material".'),
    dimensionStyles: z.record(Id, DimensionStyleSchema).optional().describe('Dimension styles by id, referred to from dimensions by "dimensionStyle".'),
    assets: z.record(Id, AssetSchema).optional().describe('Embedded files by id. Large; tools that only need the drawing can ignore it.'),
    nodes: z
      .record(Id, NodeSchema)
      .describe('Every node by id, as a flat map. The tree is expressed by each node\'s "parent" and "order".'),
    info: z
      .object({ project: z.string().optional(), client: z.string().optional(), address: z.string().optional(), author: z.string().optional() })
      .optional()
      .describe('What the drawing says about itself, shown in the title block of every sheet: the project (the document name when not given), the client, the address of the site (lines separated by a line break), the author.'),
    settings: DrawingSettingsSchema.optional().describe('How the drawing writes its numbers: the floor areas of its rooms, its tables of quantities, its dimensions. Left out, in metric with a decimal point.'),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .describe('An OpenCalque document (.opencalque file).')

/** Every type of node this version of the format knows. */
export const NODE_TYPES: string[] = NodeSchema.options.map((option) => option.shape.type.value)

export type Style = z.infer<typeof StyleSchema>
export type Layer = z.infer<typeof LayerSchema>
export type Asset = z.infer<typeof AssetSchema>
export type Node = z.infer<typeof NodeSchema>
export type NodeType = Node['type']
export type NodeOf<T extends NodeType> = Extract<Node, { type: T }>
export type ContainerNode = NodeOf<'page'> | NodeOf<'component'>
export type Document = z.infer<typeof DocumentSchema>
export type DrawingSettings = z.infer<typeof DrawingSettingsSchema>
