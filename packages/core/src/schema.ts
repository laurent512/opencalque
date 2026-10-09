import * as z from 'zod'

// Zod otherwise probes for `eval` support, which trips the app's Content-Security-Policy.
z.config({ jitless: true })

export const FORMAT = 'opencalque'
/** What `format` was before the project was renamed. Such drawings are still read. */
export const FORMER_FORMAT = 'opencad'
export const FORMAT_VERSION = 1

const Id = z.string().min(1)

export const Vec2Schema = z.object({ x: z.number(), y: z.number() })

export const StyleSchema = z
  .object({
    stroke: z.string().optional().describe("CSS color of lines and text, or 'none'."),
    strokeWidth: z.number().positive().optional().describe('Line weight in screen pixels (does not scale with zoom).'),
    fill: z.string().optional().describe("CSS fill color, or 'none'."),
    dash: z.array(z.number().positive()).optional().describe('Dash pattern in screen pixels.'),
  })
  .describe('Overrides the look of a node. Unset values fall back to the node kind, then the layer color.')

export const LayerSchema = z
  .object({
    id: Id,
    name: z.string(),
    order: z.string().describe('Fractional index; layers sort by plain string comparison of this key.'),
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
export const WALL_JOINS = ['miter', 'round', 'bevel', 'through', 'butt'] as const
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
export type SharedColor = z.infer<typeof SharedColorSchema>

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
    .describe('Fractional index giving the z-order among siblings (plain string comparison, later = on top).'),
  layer: Id.optional(),
  visible: z.boolean().optional().describe('Defaults to true.'),
  locked: z.boolean().optional().describe('Defaults to false.'),
  style: StyleSchema.optional(),
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

export const NodeSchema = z
  .discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('page') }).describe('A drawing sheet. Top-level container.'),
    z
      .object({ ...base, type: z.literal('component'), description: z.string().optional() })
      .describe('A reusable definition. Its children are drawn wherever an instance references it.'),
    z
      .object({ ...base, type: z.literal('group') })
      .describe(
        'Several nodes treated as one object: selected, moved and stacked together. It has no geometry; the nodes whose parent is this group keep their own coordinates. Groups can be nested.',
      ),
    z.object({ ...base, type: z.literal('line'), a: Vec2Schema, b: Vec2Schema }),
    z.object({ ...base, type: z.literal('polyline'), points: z.array(Vec2Schema).min(2), closed: z.boolean().optional() }),
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
      })
      .describe(
        'A room: the space enclosed by the walls and dividers around the point (x, y), which is also where its name and area are written. Its outline is not stored: it is found from the walls each time, so it follows them. Give it a "name". style.fill colours the floor. If the walls around the point do not close, only the name is drawn.',
      ),
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
    }),
    z
      .object({ ...base, type: z.literal('text'), x: z.number(), y: z.number(), text: z.string(), size: z.number().positive(), rotation, font })
      .describe('Single-line text anchored at the left end of its baseline. Size is the font size in mm.'),
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
        bend: z.number().optional().describe('How much the leader curves, as a fraction of its length: 0 is straight, positive bows one way and negative the other. Defaults to 0.2.'),
      })
      .describe('A note pointing at something: a leader line from the tip a to the point b, with text beside b.'),
    z
      .object({
        ...base,
        type: z.literal('wall'),
        a: Vec2Schema,
        b: Vec2Schema,
        thickness: z.number().positive(),
        joins: z
          .object({ a: join, b: join })
          .optional()
          .describe(
            "How each end is finished where it meets exactly one other wall. 'miter' (the default) brings both to a sharp corner, 'round' and 'bevel' round or cut that corner off, and 'through' with 'butt' on the other wall's end lets this wall run past while the other stops against it. Give both ends of a corner the same value, or the through/butt pair.",
          ),
      })
      .describe('A wall along the centerline a-b. Walls sharing an endpoint are drawn joined.'),
    z
      .object({
        ...base,
        type: z.literal('dimension'),
        a: Vec2Schema,
        b: Vec2Schema,
        offset: z.number().describe('Signed distance from the measured points to the dimension line.'),
        startMarker: marker,
        endMarker: marker,
        markerSize: z.number().positive().optional().describe('Length of the end markers in mm. Defaults to 100.'),
        extension: StyleSchema.pick({ stroke: true, strokeWidth: true, dash: true })
          .optional()
          .describe('Look of the two extension lines. Unset values follow the dimension line.'),
        extensionGap: z.number().nonnegative().optional().describe('Gap in mm between a measured point and its extension line. Defaults to 0.'),
        text: z.string().optional().describe('Replaces the measured value when set.'),
        size: z.number().positive().optional().describe('Text size in mm. Defaults to 150.'),
        font,
        textColor: z.string().optional().describe('Defaults to the color of the dimension line.'),
        textPosition: z.enum(['above', 'center', 'below']).optional().describe("Where the text sits relative to the dimension line. Defaults to 'above'."),
        textRotation: z.enum(['aligned', 'horizontal']).optional().describe("Defaults to 'aligned' (along the dimension line)."),
        unit: z.enum(['mm', 'cm', 'm', 'in', 'ft']).optional().describe("Unit the measured value is shown in. Defaults to 'mm'. Coordinates stay in mm whatever this is."),
        decimals: z.number().int().min(0).max(6).optional().describe('Decimal places. Defaults to 0 for mm, 1 for cm and in, 2 for m and ft.'),
        showUnit: z.boolean().optional().describe('Append the unit to the value.'),
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

export const DocumentSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(FORMAT_VERSION),
    id: Id,
    name: z.string(),
    unit: z.literal('mm'),
    layers: z.record(Id, LayerSchema).describe('Layers by id.'),
    colors: z.record(Id, SharedColorSchema).optional().describe('Shared colours by id, referred to from colour properties as "var(--<id>)".'),
    assets: z.record(Id, AssetSchema).optional().describe('Embedded files by id. Large; tools that only need the drawing can ignore it.'),
    nodes: z
      .record(Id, NodeSchema)
      .describe('Every node by id, as a flat map. The tree is expressed by each node\'s "parent" and "order".'),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .describe('An OpenCalque document (.opencalque file).')

export type Style = z.infer<typeof StyleSchema>
export type Layer = z.infer<typeof LayerSchema>
export type Asset = z.infer<typeof AssetSchema>
export type Node = z.infer<typeof NodeSchema>
export type NodeType = Node['type']
export type NodeOf<T extends NodeType> = Extract<Node, { type: T }>
export type ContainerNode = NodeOf<'page'> | NodeOf<'component'>
export type Document = z.infer<typeof DocumentSchema>
