import {
  childrenOf,
  layersOf,
  nodeJsonSchema,
  opsJsonSchema,
  parseOps,
  withoutAssets,
  type Document,
  type Op,
  type Registry,
} from '@opencalque/core'
import { t, tn } from '../i18n'
import type { ChatSession, Picture, ToolCall, ToolResult, ToolSpec, TurnInput } from './types'

/** What the assistant can see of the editor, and the one thing it can do to it. */
export interface AgentHost {
  state(): { doc: Document; scope: string; selection: string[] }
  /** Applies operations as an edit the user can undo. Throws when they are invalid, changing nothing. */
  apply(ops: Op[]): void
}

export interface AgentEvents {
  onText(delta: string): void
  /** A one-line note about something the assistant did or could not do. */
  onActivity(kind: 'done' | 'error', text: string): void
}

/** Model steps allowed for one request, so a confused model cannot loop forever. */
const MAX_STEPS = 16
/** Above this many characters the drawing is summarised and the model reads the parts it needs. */
const INLINE_LIMIT = 40_000

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const TOOLS: ToolSpec[] = [
  {
    name: 'apply_operations',
    description:
      'Changes the drawing. Takes a list of operations and applies them in order as a single edit. The list is all-or-nothing: if any operation is invalid nothing changes and the error is returned so you can correct it. Returns the ids of the nodes that were added.',
    schema: schema({ operations: { ...opsJsonSchema(), $schema: undefined } }, ['operations']),
  },
  {
    name: 'read_document',
    description:
      'Returns the current drawing as JSON: its layers and every node. Pass "container" (a page or component id) to get only the nodes inside it. Use it when the drawing was too large to include with the request, or to check the result of an edit.',
    schema: schema({ container: { type: 'string', description: 'Id of a page or component. Omit for the whole drawing.' } }),
  },
  {
    name: 'view_image',
    description:
      'Shows you a picture placed in the drawing, such as an imported floor plan, together with where it sits so you can convert positions in the picture to drawing coordinates.',
    schema: schema({ node: { type: 'string', description: 'Id of the image node.' } }, ['node']),
  },
]

/** The fixed part of the prompt: what the app is, how drawings are stored, and how to edit them. */
export function systemPrompt(registry: Registry): string {
  const kinds = [...registry.parametric.values()].map((k) => ({
    kind: k.kind,
    what: k.description ? `${k.label}. ${k.description}` : k.label,
    props: Object.fromEntries(k.params.map((p) => [p.key, p.options ? `one of ${p.options.join(' | ')} (default ${p.default})` : `${p.type} (default ${p.default})`])),
    cutsWalls: Boolean(k.opening),
  }))
  return `You are the drawing assistant built into OpenCalque, a 2D drafting application for floor plans and layouts. The person you are talking to has a drawing open in the app right now. When you change it, the result appears on their canvas immediately, and each request's changes can be undone with a single Ctrl+Z, so it is fine to act on a clear request without asking for confirmation first.

# How a drawing is stored

A drawing is a flat map of nodes. Each node has an "id", a "type", a "parent" (the id of the page or component it belongs to) and an "order" that sets its stacking position. Pages and components are the only containers; every other node sits directly inside one of them. Nodes may also carry "name", "layer" (a layer id), "visible", "locked" and "style" (stroke, strokeWidth, fill, dash).

All coordinates and lengths are in millimetres. X grows to the right and Y grows downward, as on a screen, so a point further down the sheet has a larger Y. Rotations are in degrees, clockwise.

This is the JSON Schema of a node, which lists every type and its properties:

${JSON.stringify(nodeJsonSchema())}

# Things that are not obvious from the schema

A wall may carry "joins": {"a": …, "b": …} to choose how an end meets one other wall: "round" or "bevel" on both ends at the corner, or "through" on the wall that runs past and "butt" on the one that stops against it. Without it the corner is mitred.

Walls are defined by their centerline from "a" to "b" plus a thickness. Two walls join cleanly only when their endpoints are exactly the same point, so reuse the same coordinates for a shared corner. A typical interior wall is 100 mm thick and an exterior one 200 to 300 mm.

A "parametric" node is an object drawn from parameters. These kinds are available:

${JSON.stringify(kinds)}

Kinds with "cutsWalls" are doors and windows. One cuts an opening when it lies on a wall: put its insertion point (x, y) on the wall's centerline and set its rotation to the wall's direction, the angle from the wall's "a" to "b". The opening then runs along the wall from the insertion point for its width. It adapts to the wall's thickness by itself.

A "group" holds several nodes so they are selected, moved and stacked as one. It has no coordinates of its own: to group nodes, add a group and set their "parent" to its id; to move a group, move the nodes inside it.

A "component" is a reusable definition and an "instance" places it. To repeat the same furniture or symbol several times, create one component and place instances of it.

A drawing can have shared colours ("colors" in the document, managed with add_color, update_color and remove_color). A colour property such as style.stroke, style.fill or a layer's color refers to one by being set to "var(--<id>)" instead of a colour; changing the shared colour then recolours everything that refers to it. Use them when several things must stay the same colour.

Any node may carry "modifiers": a list of non-destructive changes to how it is drawn, applied in order. The one built-in kind is {"type":"crop","frame":{"x":…,"y":…},"params":{"width":…,"height":…}}, which shows only what is inside that rectangle; on a group or an instance it crops everything inside. Setting "modifiers" replaces the whole list.

An "annotation" is a note with a leader: "a" is the tip on the thing it is about, "b" is where the text sits, "text" the note; "startMarker" and "endMarker" choose the symbol at each end (arrow, open-arrow, dot, tick, none) and "bend" how much the line curves.

A "room" names the space enclosed by the walls around its point (x, y): add one with a "name" at a point inside closed walls, and the floor outline and area are worked out from the walls. A "divider" (a-b) splits an open space into two rooms where there is no wall; its ends must lie on the walls. A {"type":"hatch","params":{"pattern":"Lines"|"Planks"|"Tiles","spacing":…,"angle":…}} modifier gives a room, or any closed shape, a floor pattern.

An "instance" may carry "scale" (a size multiplier) and "flipX"; an "ellipse" may carry "rotation".

A "paper" is a sheet laid on the drawing that frames what goes on one printed page. Its width and height are in drawing millimetres: the sheet's real size times its "scale" (an A3 lying at 1:100 is 42000 × 29700). It has no children; whatever lies inside its rectangle is on it. To move a paper with its contents, move those nodes too.

A "dimension" annotates the distance between two points; "offset" is how far its line stands off from them.

# Making changes

Call apply_operations with a list of operations. The operations are:

- add_node: {"op":"add_node","node":{...}}. Omit "id" and "order" unless you need to refer to the node later in the same list, in which case choose a short unique id. Pages and components take no parent.
- update_node: {"op":"update_node","id":"...","patch":{...}}. The patch replaces the properties it names; a null value removes a property. Nested objects such as "a", "props" and "style" are replaced whole, so include every field of the one you change. Setting "parent" or "order" moves the node.
- remove_node: {"op":"remove_node","id":"..."}.
- add_layer, update_layer, remove_layer, and set_document (renames the drawing).

Put new nodes on the page named in the request context unless the person says otherwise, and give them a suitable existing layer when there is one.

When a request leaves out a detail you need, choose a sensible architectural default and say what you chose, rather than asking. Ask a short question only when the request could mean substantially different drawings.

Before placing things relative to what is already drawn, look at the existing coordinates rather than assuming them. After an edit, reply with one or two plain sentences saying what you did, with the key dimensions. Do not restate the operations or the JSON. Write your replies, and any names you give to nodes and layers, in the language the person writes in.

The person can attach pictures to a message, such as a sketch or a photo of a plan. Treat what you read off one as approximate, and say which dimensions you assumed.`
}

/** The changing part of the prompt: what is on screen at the moment the person writes. */
export function describeState(host: AgentHost): string {
  const { doc, scope, selection } = host.state()
  const container = doc.nodes[scope]
  const json = JSON.stringify(withoutAssets(doc))
  const counts: Record<string, number> = {}
  for (const n of Object.values(doc.nodes)) counts[n.type] = (counts[n.type] ?? 0) + 1
  return [
    `The person is looking at the ${container?.type} "${container?.name ?? scope}" (id "${scope}").`,
    selection.length > 0 ? `They have selected these nodes: ${JSON.stringify(selection)}.` : 'Nothing is selected.',
    json.length <= INLINE_LIMIT
      ? `The drawing as it is now:\n${json}`
      : `The drawing is too large to include here (${JSON.stringify(counts)} nodes by type; layers ${JSON.stringify(layersOf(doc).map((l) => ({ id: l.id, name: l.name })))}). Use read_document to read the parts you need.`,
  ].join('\n')
}

function runTool(call: ToolCall, host: AgentHost, events: AgentEvents): ToolResult {
  // The model is told what went wrong in English; the person sees a short note in their language.
  const fail = (content: string, note: string): ToolResult => {
    events.onActivity('error', note)
    return { id: call.id, content, isError: true }
  }
  // Inputs arrive unvalidated (and possibly cut short), so each tool checks its own before acting.
  const input = (typeof call.input === 'object' && call.input !== null ? call.input : {}) as Record<string, unknown>
  const { doc } = host.state()

  if (call.name === 'apply_operations') {
    try {
      const ops = parseOps(input.operations)
      host.apply(ops)
      const added = Object.keys(host.state().doc.nodes).filter((id) => !doc.nodes[id])
      events.onActivity('done', tn(ops.length, 'Applied {n} change to the drawing', 'Applied {n} changes to the drawing'))
      return { id: call.id, content: JSON.stringify({ applied: ops.length, addedNodeIds: added }) }
    } catch (error) {
      return fail(`Nothing was changed. ${(error as Error).message}`, t('A change was not valid and was not applied. The assistant has been told why.'))
    }
  }

  if (call.name === 'read_document') {
    const { container } = input
    if (container === undefined) return { id: call.id, content: JSON.stringify(withoutAssets(doc)) }
    if (typeof container !== 'string' || !doc.nodes[container]) return fail(`There is no page or component with id ${JSON.stringify(container)}.`, t('The assistant asked for something that is not in the drawing.'))
    return { id: call.id, content: JSON.stringify({ layers: doc.layers, nodes: [doc.nodes[container], ...childrenOf(doc, container)] }) }
  }

  if (call.name === 'view_image') {
    const node = typeof input.node === 'string' ? doc.nodes[input.node] : undefined
    const asset = node?.type === 'image' ? doc.assets?.[node.asset] : undefined
    if (node?.type !== 'image' || !asset) return fail(`There is no image node with id ${JSON.stringify(input.node)}.`, t('The assistant asked for something that is not in the drawing.'))
    events.onActivity('done', t('Looked at {name}', { name: node.name ?? t('the picture') }))
    const size = asset.width && asset.height ? `It is ${asset.width} × ${asset.height} pixels, so pixel (px, py) is at x = ${node.x} + px × ${node.width / asset.width}, y = ${node.y} + py × ${node.height / asset.height}.` : ''
    return {
      id: call.id,
      content: `The picture covers x from ${node.x} to ${node.x + node.width} and y from ${node.y} to ${node.y + node.height} mm${node.rotation ? `, rotated ${node.rotation}° around its top-left corner` : ''}. ${size} Positions read off a picture are approximate; say so when you trace from it.`,
      image: { mime: asset.mime, data: asset.data },
    }
  }

  return fail(`There is no tool called "${call.name}".`, t('The assistant tried something it cannot do here.'))
}

/**
 * Carries out one request from the user: sends it with the current state of the drawing, then
 * keeps running the tools the model asks for until it has nothing more to do.
 */
export async function runRequest(session: ChatSession, host: AgentHost, text: string, events: AgentEvents, signal: AbortSignal, images: Picture[] = []): Promise<void> {
  let input: TurnInput = { text: `<drawing_state>\n${describeState(host)}\n</drawing_state>\n\n${text}`, images }
  for (let step = 0; step < MAX_STEPS; step++) {
    const output = await session.send(input, events.onText, signal)
    if (output.stop === 'refused') return events.onActivity('error', t('The model declined this request.'))
    if (output.stop === 'truncated') return events.onActivity('error', t('The reply was cut off before it finished. Try asking for less at once.'))
    if (output.stop === 'done') return
    input = { results: output.calls.map((call) => runTool(call, host, events)) }
  }
  events.onActivity('error', t('Stopped after {n} steps without finishing.', { n: MAX_STEPS }))
}
