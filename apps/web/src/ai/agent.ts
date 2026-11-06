import {
  boundsOf,
  cornerJoin,
  DRAWING_TOOLS,
  drawingGuide,
  layersOf,
  leavesOf,
  nodePrimitives,
  roomAt,
  rootOf,
  runDrawingTool,
  wallEndsAt,
  wallLength,
  withoutAssets,
  type Bounds,
  type Document,
  type DrawingHost,
  type Node,
  type Op,
  type Registry,
  type ToolNote,
  type Vec2,
} from '@opencalque/core'
import { t, tn } from '../i18n'
import type { ChatSession, Picture, ToolCall, ToolResult, TurnInput } from './types'

/** What the assistant can see of the editor, and the one thing it can do to it. */
export interface AgentHost {
  state(): {
    doc: Document
    /** The page, component or group being edited. */
    scope: string
    selection: string[]
    /** The wall corner selected in place of objects, if one is. */
    corner?: Vec2 | null
    /** The layer new objects go on; none inside a component. */
    activeLayer?: string
    /** The part of the drawing that is on screen, in millimetres. */
    visible?: Bounds | null
  }
  /** Applies operations as an edit the user can undo. Throws when they are invalid, changing nothing. */
  apply(ops: Op[]): void
  /** The extensions in use, to work out what the selected objects measure. */
  registry: Registry
  /** Draws an SVG as a picture, for the model to look at the drawing. */
  picture?: DrawingHost['picture']
}

/** What goes with one request besides the person's words. */
export interface RequestContext {
  /** Whether to tell the model what is selected. The person can leave it out of a message. */
  selection: boolean
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
/** Above this many characters the selected objects are listed by id and type rather than given whole. */
const SELECTION_LIMIT = 20_000

/** The tools of the assistant, which every agent has (`DRAWING_TOOLS`). */
export const TOOLS = DRAWING_TOOLS

/** The tools a provider can use: looking at the drawing is no use to one that cannot be shown pictures. */
export const toolsFor = (pictures: boolean) => (pictures ? TOOLS : TOOLS.filter((tool) => tool.name !== 'view_drawing'))

/** The fixed part of the prompt: what the app is, how drawings are stored, and how to edit them. */
export function systemPrompt(registry: Registry, pictures = true): string {
  return `You are the drawing assistant built into OpenCalque, a 2D drafting application for architectural plans and layouts. The person you are talking to has a drawing open in the app right now. When you change it, the result appears on their canvas immediately, and all the changes made for one request are undone together by a single Ctrl+Z, so it is fine to act on a clear request without asking for confirmation first.

# What comes with each message

Each message from the person starts with a <drawing_state> block written by the app, not by them. It says what they are looking at (a page, or a component or group they opened to edit), which layer new objects go on, which part of the drawing is on screen, and the drawing itself as JSON, or a summary of it when it is too large (then use read_document for the parts you need).

When the person has selected something, the block contains a <selection> with the selected nodes in full, and what they measure (a wall's length, a room's area, where each lies). That is what they mean by "this", "these", "it", "the selected walls" and the like, as a person pointing at the screen would; act on those nodes unless they name others. If nothing is selected and the request needs a target that is not obvious, say what you took it to mean. Only the person's own words after the block are their request.

${drawingGuide(registry, { pictures })}

Put new nodes where the person is working (the page, component or group named in the request context) unless they say otherwise, on the layer it names, or on another existing layer that suits them better; inside a component, on no layer.

When a request leaves out a detail you need, choose a sensible architectural default and say what you chose, rather than asking. Ask a short question only when the request could mean substantially different drawings. Change only what was asked: leave other nodes, and the properties you were not asked about, as they are.

Before placing things relative to what is already drawn, look at the existing coordinates rather than assuming them. After an edit, reply with one or two plain sentences saying what you did, with the key dimensions. Do not restate the operations or the JSON. If the result of apply_operations lists properties the format does not know, you probably misspelt one or put it on the wrong type of node: correct it. Write your replies, and any names you give to nodes and layers, in the language the person writes in.

The person can attach pictures to a message, such as a sketch or a photo of a plan. Treat what you read off one as approximate, and say which dimensions you assumed.`
}

/** How a number of millimetres is written to the model: rounded to a tenth. */
const mm = (n: number) => Math.round(n * 10) / 10
const point = (p: Vec2) => `(${mm(p.x)}, ${mm(p.y)})`
const span = (b: Bounds) => `x from ${mm(b.minX)} to ${mm(b.maxX)}, y from ${mm(b.minY)} to ${mm(b.maxY)}`

/** What a selected node measures, in a few words the model would otherwise have to work out. */
function measure(doc: Document, node: Node, registry: Registry | undefined): string[] {
  const facts: string[] = []
  if (node.type === 'wall') facts.push(`length ${mm(wallLength(node))} mm along its line, ${mm(node.thickness)} mm thick, from ${point(node.a)} to ${point(node.b)}${node.justify === 'left' || node.justify === 'right' ? `, drawn by its ${node.justify} face` : ''}`)
  if (node.type === 'line' || node.type === 'divider' || node.type === 'dimension') facts.push(`length ${mm(Math.hypot(node.b.x - node.a.x, node.b.y - node.a.y))} mm`)
  if (node.type === 'room') {
    const floor = roomAt(doc, node.parent, node)
    facts.push(floor ? `floor area ${(floor.area / 1e6).toFixed(2)} m²` : 'the walls around it do not close, so it has no floor')
  }
  if (node.type === 'instance') facts.push(`places the component "${doc.nodes[node.component]?.name ?? node.component}"`)
  if (node.type === 'parametric') facts.push(`a ${registry?.parametric.get(node.kind)?.label ?? node.kind}`)
  if (node.type === 'group') {
    const inside = leavesOf(doc, node.id)
    const counts: Record<string, number> = {}
    for (const leaf of inside) counts[leaf.type] = (counts[leaf.type] ?? 0) + 1
    facts.push(`holds ${inside.length} objects: ${Object.entries(counts).map(([type, n]) => `${n} ${type}`).join(', ')}`)
  }
  if (registry) {
    const box = boundsOf(nodePrimitives(node, { doc, registry, depth: 0 }))
    if (box) facts.push(`drawn over ${span(box)}`)
  }
  return facts
}

/** The <selection> part of the request context: what the person points at, in full, with what it measures. */
function describeSelection(host: AgentHost): string | null {
  const { doc, selection, corner } = host.state()
  if (corner) {
    const ends = wallEndsAt(doc, host.state().scope, corner)
    const walls = ends.map(({ wall, end }) => `"${wall.id}" (its end ${end})`).join(' and ')
    return `<selection>\nThe person has selected the wall corner at ${point(corner)}, where ${ends.length === 1 ? `the wall ${walls} ends freely` : `the walls ${walls} meet, joined ${cornerJoin(ends)}`}. Moving it means moving every wall end there to the same new point.\n</selection>`
  }
  const nodes = selection.flatMap((id) => (doc.nodes[id] ? [doc.nodes[id]] : []))
  if (nodes.length === 0) return null
  const items = nodes.map((node) => ({ node, facts: measure(doc, node, host.registry) }))
  // A group comes with what it holds, so that "this" can be changed inside.
  const inside = nodes.filter((node) => node.type === 'group').flatMap((group) => leavesOf(doc, group.id))
  const whole = JSON.stringify({ selected: nodes, insideSelectedGroups: inside.length > 0 ? inside : undefined })
  const listed =
    whole.length <= SELECTION_LIMIT
      ? whole
      : `${JSON.stringify(nodes.map((node) => ({ id: node.id, type: node.type, name: node.name })))}\n(Too many to give whole: use read_document with their ids.)`
  const together = boundsOf(items.flatMap(({ node }) => (host.registry ? nodePrimitives(node, { doc, registry: host.registry, depth: 0 }) : [])))
  return [
    '<selection>',
    `The person has selected ${nodes.length === 1 ? 'one node' : `${nodes.length} nodes`}:`,
    ...items.map(({ node, facts }) => `- "${node.id}", a ${node.type}${node.name ? ` named "${node.name}"` : ''}${facts.length > 0 ? `: ${facts.join('; ')}` : ''}`),
    ...(together && nodes.length > 1 ? [`Together they are drawn over ${span(together)}.`] : []),
    listed,
    '</selection>',
  ].join('\n')
}

/** Where the person is working: a page, or a component or group opened to edit, by name and id. */
function describeScope(doc: Document, scope: string): string {
  const here = doc.nodes[scope]
  const named = (node: Node | undefined) => `${node?.type} "${node?.name ?? node?.id}" (id "${node?.id}")`
  if (here?.type === 'group') return `They are editing inside the ${named(here)}, on the ${named(rootOf(doc, scope))}: new nodes they ask for go in this group.`
  if (here?.type === 'component') return `They are editing the ${named(here)}: what they ask for goes in the component, and changes every instance of it.`
  return `They are looking at the ${named(here)}.`
}

/** The changing part of the prompt: what is on screen at the moment the person writes. */
export function describeState(host: AgentHost, context: RequestContext = { selection: true }): string {
  const { doc, scope, activeLayer, visible } = host.state()
  const json = JSON.stringify(withoutAssets(doc))
  const counts: Record<string, number> = {}
  for (const n of Object.values(doc.nodes)) counts[n.type] = (counts[n.type] ?? 0) + 1
  const layer = activeLayer ? doc.layers[activeLayer] : undefined
  const selection = context.selection ? describeSelection(host) : null
  return [
    describeScope(doc, scope),
    ...(layer ? [`New objects go on the layer "${layer.name}" (id "${layer.id}") unless they say otherwise.`] : []),
    ...(visible ? [`On their screen: ${span(visible)}.`] : []),
    selection ?? (context.selection ? 'Nothing is selected.' : 'They chose not to send what is selected with this message.'),
    json.length <= INLINE_LIMIT
      ? `The drawing as it is now:\n${json}`
      : `The drawing is too large to include here (${JSON.stringify(counts)} nodes by type; layers ${JSON.stringify(layersOf(doc).map((l) => ({ id: l.id, name: l.name })))}). Use read_document to read the parts you need.`,
  ].join('\n')
}

/** The editor as the tools see it. */
export const drawingHost = (host: AgentHost): DrawingHost => ({
  registry: host.registry,
  doc: () => host.state().doc,
  scope: () => host.state().scope,
  selection: () => host.state().selection,
  apply: (ops) => host.apply(ops),
  picture: host.picture,
})

/** A short note for the person, in their language, about what a tool did; the model is told what went wrong in English. */
function noteOf(note: ToolNote): { kind: 'done' | 'error'; text: string } {
  switch (note.kind) {
    case 'applied':
      return { kind: 'done', text: tn(note.count, 'Applied {n} change to the drawing', 'Applied {n} changes to the drawing') }
    case 'looked-at-image':
      return { kind: 'done', text: t('Looked at {name}', { name: note.name ?? t('the picture') }) }
    case 'looked-at-drawing':
      return { kind: 'done', text: t('Looked at the drawing') }
    case 'invalid-operations':
      return { kind: 'error', text: t('A change was not valid and was not applied. The assistant has been told why.') }
    case 'not-in-drawing':
      return { kind: 'error', text: t('The assistant asked for something that is not in the drawing.') }
    case 'no-such-tool':
    case 'no-picture':
      return { kind: 'error', text: t('The assistant tried something it cannot do here.') }
  }
}

async function runTool(call: ToolCall, host: AgentHost, events: AgentEvents): Promise<ToolResult> {
  const { note, ...result } = await runDrawingTool(call.name, call.input, drawingHost(host))
  if (note) {
    const { kind, text } = noteOf(note)
    events.onActivity(kind, text)
  }
  return { id: call.id, ...result }
}

/**
 * Carries out one request from the user: sends it with the current state of the drawing, then
 * keeps running the tools the model asks for until it has nothing more to do.
 */
export async function runRequest(
  session: ChatSession,
  host: AgentHost,
  text: string,
  events: AgentEvents,
  signal: AbortSignal,
  images: Picture[] = [],
  context: RequestContext = { selection: true },
): Promise<void> {
  let input: TurnInput = { text: `<drawing_state>\n${describeState(host, context)}\n</drawing_state>\n\n${text}`, images }
  for (let step = 0; step < MAX_STEPS; step++) {
    const output = await session.send(input, events.onText, signal)
    if (output.stop === 'refused') return events.onActivity('error', t('The model declined this request.'))
    if (output.stop === 'truncated') return events.onActivity('error', t('The reply was cut off before it finished. Try asking for less at once.'))
    if (output.stop === 'done') return
    // One after the other: each may change what the next one sees.
    const results: ToolResult[] = []
    for (const call of output.calls) results.push(await runTool(call, host, events))
    input = { results }
  }
  events.onActivity('error', t('Stopped after {n} steps without finishing.', { n: MAX_STEPS }))
}
