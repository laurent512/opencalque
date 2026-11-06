import { nodeJsonSchema } from './jsonschema'
import type { Registry } from './registry'

/*
 * How drawings are stored and edited, written for a model. It is the part of what the assistant is
 * told that holds for anyone editing a drawing with the tools of tools.ts, so the assistant's prompt
 * takes it whole, the MCP server gives it to outside agents, and `opencalque guide` prints it.
 */

const CHECKING = `# Checking your work

The result of apply_operations lists under "problems" what the edit got wrong that the drawing can tell: a room whose walls do not close and the wall end that may be why, walls drawn over each other, a door or window outside its wall. Put right those you caused. check_drawing lists every such problem of a page, those that were there before you included.

A room's area is not stored: it comes from the walls each time. Use measure_drawing for floor areas, wall lengths and counts rather than working them out, and to confirm what you report.`

const LOOKING = `Use view_drawing to look at what you drew after anything more than a small edit: rooms that close can still be the wrong shape, and furniture can stand in a doorway.`

/** The JSON Schema of each type of node, by type. */
function schemasByType(): Map<string, unknown> {
  const { oneOf } = nodeJsonSchema() as unknown as { oneOf: { properties: { type: { const: string } } }[] }
  return new Map(oneOf.map((schema) => [schema.properties.type.const, schema]))
}

/** The types of node there are. */
export const nodeTypes = (): string[] => [...schemasByType().keys()]

/** The JSON Schema of one type of node, or undefined when there is no such type. */
export const nodeTypeSchema = (type: string): unknown => schemasByType().get(type)

/**
 * What anyone editing a drawing with the tools needs to know: the format, what is not obvious from
 * it, the operations, and how to check the result. `pictures` says whether the reader can be shown
 * pictures, and so use view_drawing. The schema of every node is seven parts in eight of it, which
 * a client would keep out of the conversation as too large, so with `schema` false the types are only
 * named, for the reader to ask for those it uses (`nodeTypeSchema`).
 */
export function drawingGuide(registry: Registry, { pictures = true, schema = true }: { pictures?: boolean; schema?: boolean } = {}): string {
  const kinds = [...registry.parametric.values()].map((k) => ({
    kind: k.kind,
    what: k.description ? `${k.label}. ${k.description}` : k.label,
    props: Object.fromEntries(k.params.map((p) => [p.key, `${p.options ? `one of ${p.options.join(' | ')}` : p.type}${p.unit === 'length' ? ' in mm' : ''} (default ${p.default})`])),
    cutsWalls: Boolean(k.opening),
  }))
  return `# How a drawing is stored

A drawing is a flat map of nodes, plus its layers, shared colours, materials and dimension styles. Each node has an "id", a "type", a "parent" and an "order". Pages and components are the roots: their parent is null. Every other node sits in a page, in a component, or in a group, which may itself be in a group, to any depth. "order" sets the stacking among siblings; it is a fractional-indexing key such as "a0" or "a1V". Leave it out when adding a node, which puts the node on top; never invent one such as "top" or "1". Nodes may also carry "name", "layer" (a layer id), "visible", "locked", "style" (stroke, strokeWidth, fill, dash, pattern), "modifiers" and "meta".

All coordinates and lengths are millimetres. X grows to the right and Y grows downward, as on a screen, so a point further down the sheet has a larger Y. Rotations are in degrees, clockwise. A line weight (strokeWidth) is in screen pixels; one pixel prints as 0.25 mm.

${
    schema
      ? `This is the JSON Schema of a node, which lists every type and its properties:

${JSON.stringify(nodeJsonSchema())}`
      : `The types of node are ${nodeTypes().join(', ')}. Before you first use a type, get the JSON Schema that lists its properties: call read_guide with its "type" (on the command line, opencalque guide --type <type>).`
  }

# Things that are not obvious from the schema

Walls are defined by a line from "a" to "b" plus a thickness. The line is the wall's middle, or with "justify": "left" or "right" that face of it (as it runs from a to b), the whole thickness then lying on the other side: draw outside walls by their inner face so that rooms keep their size and walls of different thicknesses stay flush inside. Two walls join cleanly only when their ends are exactly the same point, so reuse the same coordinates for a shared corner. A typical interior wall is 100 mm thick and an exterior one 200 to 300 mm. "bulge" bends a wall into an arc. "joins" chooses how an end meets one other wall: "round" or "bevel" on both ends of the corner, or "through" on the wall that runs past and "butt" on the one that stops against it; without it the corner is mitred. "free" on an end joins it to no wall, even where other walls end at the same point.

A dimension style (the document's "dimensionStyles", managed with add_dimension_style, update_dimension_style and remove_dimension_style) defines whichever properties of a dimension it gives a value to; dimensions take it with "dimensionStyle": "<id>" and may still give a value of their own.

A material (the document's "materials", managed with add_material, update_material and remove_material) is what something is built of: a name, and the "fill" and "pattern" it is drawn with. A wall is of one material, with "material": "<id>", and drawn in its colour and pattern; walls of one material that meet are drawn as one, and a line is drawn between walls of different materials that touch. A wall built of several materials (brick, an insulation lining, plaster) is several walls side by side, each of one material and its own thickness, laid face to face: draw them with "justify" on the face they share so that they stay flush. A door or window set in one of them goes through those laid against it. The material of id "default" is what walls are made of until given another: walls of no material take its fill and pattern; it cannot be removed. A room's floor may be of a material too, with "material": "<id>", for its colour and to be counted under it.

A "table" node shows quantities measured on a page, kept up to date: put it at "x", "y" with a "schedule" ("objects", "floors", "rooms", "walls", "materials" or "openings") and a "title". It counts the page it is on unless "source" names another page.

A "parametric" node is an object drawn from parameters. These kinds are available:

${JSON.stringify(kinds)}

Kinds with "cutsWalls" are doors and windows. One cuts an opening when it lies on a wall: put its insertion point (x, y) in the middle of the wall's thickness (on its line for a wall without "justify", half its thickness off it towards the wall otherwise) and set its rotation to the wall's direction, the angle from the wall's "a" to "b". The opening then runs along the wall from the insertion point for its width. It adapts to the wall's thickness by itself, and moves with the wall only by being on it.

A "group" holds several nodes so they are selected, moved and stacked as one. It has no coordinates of its own: to group nodes, add a group and set their "parent" to its id; to move a group, move the nodes inside it. Its "opacity" (0 to 1, 1 when left out) makes everything inside it see-through.

A "component" is a reusable definition and an "instance" places it, with "x", "y", "rotation", "scale" and "flipX", and "scaleX" and "scaleY" to stretch it wider or taller than it is drawn. To repeat the same furniture or symbol several times, make one component and place instances of it; changing the component changes them all. An instance has no look of its own, and what a component holds has no layer: what the component draws without a colour takes the colour of the layer of each instance, so to show placed furniture grey (existing) or red (to demolish), put the instances on a layer of that colour. Giving an instance a "style", or a node inside a component a "layer", is refused.

A shared colour (the document's "colors", managed with add_color, update_color and remove_color) is used by setting a colour property, such as style.stroke, style.fill or a layer's color, to "var(--<id>)"; changing the shared colour then recolours everything that refers to it. A colour property may also be "var(--layer)": the colour of the layer the node is on, for a fill or a text that should follow its layer as a stroke with no colour of its own already does.

"modifiers" is a list of non-destructive changes to how a node is drawn, applied in order: {"type":"crop","frame":{"x":…,"y":…},"params":{"width":…,"height":…}} shows only what is inside that rectangle; {"type":"hatch","params":{"pattern":"Lines"|"Planks"|"Tiles","spacing":…,"angle":…}} gives a closed shape or a room a floor pattern; {"type":"repeat",…} draws copies in rows and columns. Setting "modifiers" replaces the whole list.

A "room" names the space enclosed by the walls around its point (x, y): add one with a "name" at a point inside closed walls, and its floor and area are worked out from the walls each time it is drawn. A "divider" (a to b) splits an open space into two rooms where there is no wall; its ends must lie on walls.

A "paper" is a sheet laid over the drawing that frames what goes on one printed page. Its width and height are in drawing millimetres: the sheet's real size times its "scale" (an A3 lying at 1:100 is 42000 × 29700). It has no children; whatever lies inside its rectangle is on it. Give it "titleBlock": {} (optionally with "project", "author", "date", "number") for a border and a title block; the person exports papers to PDF at their true scale from the File menu.

A "dimension" shows the distance between "a" and "b"; "offset" is how far its line stands off them. An "annotation" is a note with a leader from the tip "a" to the text at "b". Texts may hold fields that are filled in when drawn: {date}, {page}, {page-number}, {pages}, {document}.

# Making changes

Call apply_operations with a list of operations:

- add_node: {"op":"add_node","node":{...}}. Omit "id" and "order" unless you need to refer to the node later in the same list, in which case choose a short unique id. Pages and components take no parent.
- update_node: {"op":"update_node","id":"...","patch":{...}}. The patch replaces the properties it names; a null value removes a property. Nested objects such as "a", "props" and "style" are replaced whole, so include every field of the one you change. Setting "parent" or "order" moves the node.
- remove_node: {"op":"remove_node","id":"..."}. It takes along everything inside the node; removing a component also removes its instances.
- add_layer, update_layer, remove_layer; add_color, update_color, remove_color; add_dimension_style, update_dimension_style, remove_dimension_style, as described above.
- set_document: renames the drawing, and with "info" sets its project, client, address and author, which every sheet's title block shows.
- add_asset embeds a picture's file for an image node; it is for the app's own imports, and you will not need it.

${CHECKING}${pictures ? ` ${LOOKING}` : ''}`
}
