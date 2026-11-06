import { checkDrawing, problemsMadeBy, type DrawingProblem } from './check'
import { childrenOf, componentsOf, layersOf, leavesOf, pagesOf, rootOf, withoutAssets } from './document'
import { opsJsonSchema } from './jsonschema'
import { parseOps, type Op } from './ops'
import { quantities, type Quantities } from './quantities'
import type { Registry } from './registry'
import type { Bounds } from './geometry'
import type { Document } from './schema'
import { svgBox, toSVG } from './svg'
import { unknownProperties } from './ops'

/*
 * What a model can do to a drawing: the tools of the assistant, of the MCP server and of the bridge
 * to the desktop app, which are the same ones. What differs is the `DrawingHost`, where the drawing
 * is: in the editor, or in a file. Nothing here speaks to the person: `note` says what happened and
 * each host says it, or not, in its own words.
 */

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the tool's input object. */
  schema: Record<string, unknown>
}

/** A picture for the model to look at, base64-encoded. */
export interface Picture {
  mime: string
  data: string
}

/** A picture of the drawing, as made by a host, with its size in pixels. */
export interface DrawnPicture extends Picture {
  width: number
  height: number
}

/** What happened, for a host to tell the person. */
export type ToolNote =
  | { kind: 'applied'; count: number }
  | { kind: 'looked-at-image'; name?: string }
  | { kind: 'looked-at-drawing' }
  | { kind: 'invalid-operations' }
  | { kind: 'not-in-drawing' }
  | { kind: 'no-such-tool' }
  | { kind: 'no-picture' }

export interface ToolOutcome {
  content: string
  isError?: boolean
  image?: Picture
  note?: ToolNote
}

/** Where the drawing is, for the tools. */
export interface DrawingHost {
  registry: Registry
  doc(): Document
  /** The page, component or group being worked on. */
  scope(): string
  /** What is selected, where someone can select. */
  selection?(): string[]
  /** Applies operations as one edit, or throws and changes nothing. */
  apply(ops: Op[]): void
  /** Draws an SVG as a picture `pixels` long on its longer side. Without it, drawings cannot be looked at. */
  picture?(svg: string, pixels: number): Promise<DrawnPicture>
}

/** Pixels on the longer side of a picture of the drawing: as much as models take without scaling it down. */
export const PICTURE_PIXELS = 1568
/** Problems reported with one edit, and in one list: a model has no use for a hundred at once. */
const MAX_PROBLEMS = 30
/** Above this many characters, measure_drawing says how much there is and asks which part. */
const MEASURE_LIMIT = 40_000

const QUANTITY_PARTS = ['rooms', 'walls', 'openings', 'floors', 'materials', 'objects'] as const
const UNITS = 'Areas are in m², lengths in m, volumes in m³, thicknesses and the sizes of doors and windows in mm. A room whose walls do not close has an area of 0.'

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const pageInput = { type: 'string', description: 'Id of a page or component. Leave it out for the one being worked on.' }

export const DRAWING_TOOLS: ToolSpec[] = [
  {
    name: 'apply_operations',
    description:
      'Changes the drawing. Takes a list of operations and applies them in order as a single edit. The list is all-or-nothing: if any operation is invalid nothing changes and the error is returned so you can correct it. Returns the ids of the nodes that were added, lists any property you wrote that the format does not know (usually a misspelling), which was kept but has no effect, and under "problems" what the edit left wrong: a room that does not close and the wall end that may be why, walls drawn over each other, a door outside its wall.',
    schema: schema({ operations: { ...opsJsonSchema(), $schema: undefined } }, ['operations']),
  },
  {
    name: 'read_document',
    description:
      'Returns the current drawing as JSON: its layers, shared colours, materials, dimension styles and nodes. Pass "ids" to get only those nodes, with everything inside the groups among them, or "container" (a page, component or group id) to get what it holds. Use it when the drawing was too large to include with the request, or to check the result of an edit.',
    schema: schema({
      container: { type: 'string', description: 'Id of a page, component or group.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Ids of the nodes to read.' },
    }),
  },
  {
    name: 'describe_drawing',
    description: 'Returns a short summary of the drawing: its name, layers, pages and components with what each holds, and what is being worked on and selected. Start here when you do not know the drawing: it is much smaller than read_document.',
    schema: schema({}),
  },
  {
    name: 'view_image',
    description:
      'Shows you a picture placed in the drawing, such as an imported floor plan, together with where it sits so you can convert positions in the picture to drawing coordinates.',
    schema: schema({ node: { type: 'string', description: 'Id of the image node.' } }, ['node']),
  },
  {
    name: 'view_drawing',
    description:
      'Shows you the drawing as it is printed: a picture of a page or component, or of part of it, and which coordinates it covers. Use it to check what you drew, and "area" to look closer at a corner or a room.',
    schema: schema({
      page: pageInput,
      area: {
        type: 'object',
        description: 'The part to show, in drawing millimetres. Leave it out for everything on the page.',
        properties: { minX: { type: 'number' }, minY: { type: 'number' }, maxX: { type: 'number' }, maxY: { type: 'number' } },
        required: ['minX', 'minY', 'maxX', 'maxY'],
        additionalProperties: false,
      },
    }),
  },
  {
    name: 'measure_drawing',
    description: `Returns what a page holds, measured from what is drawn: each room with its floor area and perimeter, each wall with its length, doors and windows by size, floors and walls by material, and objects placed. ${UNITS}`,
    schema: schema({
      page: pageInput,
      of: { type: 'array', items: { enum: QUANTITY_PARTS }, description: 'Which parts to return. Leave it out for all of them.' },
    }),
  },
  {
    name: 'check_drawing',
    description: 'Lists what is wrong with a page, whoever did it: rooms that have no floor, with the wall ends that may be why, rooms that share one, walls drawn over each other, doors and windows outside a wall, past its end or over one another. Each problem says what to do about it.',
    schema: schema({ page: { type: 'string', description: 'Id of a page or component. Leave it out for the whole drawing.' } }),
  },
]

/** A short account of a drawing, much smaller than the drawing: layers, pages and components with how many objects of each type they hold. */
export function describeDrawing(doc: Document) {
  const held = (id: string) => {
    const counts: Record<string, number> = {}
    for (const node of childrenOf(doc, id)) counts[node.type] = (counts[node.type] ?? 0) + 1
    return counts
  }
  return {
    name: doc.name,
    unit: doc.unit,
    layers: layersOf(doc).map(({ id, name, visible, locked, color }) => ({ id, name, visible, locked, color })),
    pages: pagesOf(doc).map((page) => ({ id: page.id, name: page.name, objects: held(page.id) })),
    components: componentsOf(doc).map((component) => ({ id: component.id, name: component.name, objects: held(component.id) })),
  }
}

/** At most `MAX_PROBLEMS` of a list of problems, saying how many there are when that is not all. */
function listed(problems: DrawingProblem[]) {
  const shown = problems.map(({ kind, message, nodes, at }) => ({ kind, message, nodes, at }))
  return problems.length <= MAX_PROBLEMS ? { problems: shown } : { problems: shown.slice(0, MAX_PROBLEMS), totalProblems: problems.length }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The area asked for, or undefined when none or none that can be drawn was. */
function areaOf(input: unknown): Bounds | undefined {
  const area = input as Partial<Bounds> | undefined
  return area && finite(area.minX) && finite(area.minY) && finite(area.maxX) && finite(area.maxY) && area.maxX > area.minX && area.maxY > area.minY ? (area as Bounds) : undefined
}

/** Runs one tool on a drawing. Inputs arrive unvalidated (and possibly cut short), so each tool checks its own before acting. */
export async function runDrawingTool(name: string, given: unknown, host: DrawingHost): Promise<ToolOutcome> {
  const input = (typeof given === 'object' && given !== null ? given : {}) as Record<string, unknown>
  const { registry } = host
  const doc = host.doc()
  const fail = (content: string, kind: ToolNote['kind']): ToolOutcome => ({ content, isError: true, note: { kind } as ToolNote })
  const missing = (content: string) => fail(content, 'not-in-drawing')
  /** The page or component a tool was asked about, or the one being worked on. */
  const rootAsked = (): string | null => {
    if (input.page === undefined) return rootOf(doc, host.scope())?.id ?? pagesOf(doc)[0]?.id ?? null
    return typeof input.page === 'string' && rootOf(doc, input.page)?.id === input.page ? input.page : null
  }
  const noPage = () => missing(`There is no page or component with id ${JSON.stringify(input.page)}.`)

  switch (name) {
    case 'apply_operations': {
      let ops: Op[]
      try {
        ops = parseOps(input.operations)
        host.apply(ops)
      } catch (error) {
        return fail(`Nothing was changed. ${(error as Error).message}`, 'invalid-operations')
      }
      const after = host.doc()
      const added = Object.keys(after.nodes).filter((id) => !doc.nodes[id])
      const unknown = unknownProperties(doc, ops)
      const warning = unknown.length > 0 ? { unknownProperties: unknown, note: 'These properties are not part of the format: they were kept but do nothing. Correct them if you meant something else.' } : {}
      const problems = problemsMadeBy(doc, after, registry)
      return {
        content: JSON.stringify({ applied: ops.length, addedNodeIds: added, ...warning, ...(problems.length > 0 ? listed(problems) : {}) }),
        note: { kind: 'applied', count: ops.length },
      }
    }

    case 'read_document': {
      const { container, ids } = input
      if (Array.isArray(ids)) {
        const absent = ids.filter((id) => typeof id !== 'string' || !doc.nodes[id])
        if (absent.length > 0) return missing(`There are no nodes with ids ${JSON.stringify(absent)}.`)
        const nodes = (ids as string[]).map((id) => doc.nodes[id])
        const inside = nodes.filter((node) => node.type === 'group').flatMap((group) => leavesOf(doc, group.id))
        return { content: JSON.stringify({ nodes, insideGroups: inside.length > 0 ? inside : undefined }) }
      }
      if (container === undefined) return { content: JSON.stringify(withoutAssets(doc)) }
      if (typeof container !== 'string' || !doc.nodes[container]) return missing(`There is no page, component or group with id ${JSON.stringify(container)}.`)
      const { nodes: _, ...rest } = withoutAssets(doc)
      return { content: JSON.stringify({ ...rest, nodes: [doc.nodes[container], ...childrenOf(doc, container)] }) }
    }

    case 'describe_drawing':
      return { content: JSON.stringify({ ...describeDrawing(doc), workingOn: host.scope(), ...(host.selection ? { selection: host.selection() } : {}) }) }

    case 'view_image': {
      const node = typeof input.node === 'string' ? doc.nodes[input.node] : undefined
      const asset = node?.type === 'image' ? doc.assets?.[node.asset] : undefined
      if (node?.type !== 'image' || !asset) return missing(`There is no image node with id ${JSON.stringify(input.node)}.`)
      const size = asset.width && asset.height ? `It is ${asset.width} × ${asset.height} pixels, so pixel (px, py) is at x = ${node.x} + px × ${node.width / asset.width}, y = ${node.y} + py × ${node.height / asset.height}.` : ''
      return {
        content: `The picture covers x from ${node.x} to ${node.x + node.width} and y from ${node.y} to ${node.y + node.height} mm${node.rotation ? `, rotated ${node.rotation}° around its top-left corner` : ''}. ${size} Positions read off a picture are approximate; say so when you trace from it.`,
        image: { mime: asset.mime, data: asset.data },
        note: { kind: 'looked-at-image', name: node.name },
      }
    }

    case 'view_drawing': {
      if (!host.picture) return fail('Pictures of the drawing cannot be made here.', 'no-picture')
      const root = rootAsked()
      if (!root) return noPage()
      if (input.area !== undefined && !areaOf(input.area)) return missing('"area" must give numbers with maxX above minX and maxY above minY.')
      const svg = toSVG(doc, root, registry, { area: areaOf(input.area) })
      const picture = await host.picture(svg, PICTURE_PIXELS)
      const box = svgBox(svg)
      const mm = (n: number) => Math.round(n)
      return {
        content: `This is what is drawn on "${doc.nodes[root].name ?? root}". The picture is ${picture.width} × ${picture.height} pixels and covers x from ${mm(box.minX)} to ${mm(box.maxX)} and y from ${mm(box.minY)} to ${mm(box.maxY)} mm, so one pixel is ${Math.round(((box.maxX - box.minX) / picture.width) * 10) / 10} mm, with y growing downward.`,
        image: { mime: picture.mime, data: picture.data },
        note: { kind: 'looked-at-drawing' },
      }
    }

    case 'measure_drawing': {
      const root = rootAsked()
      if (!root) return noPage()
      const all = quantities(doc, root, registry)
      const parts = Array.isArray(input.of) ? QUANTITY_PARTS.filter((part) => (input.of as unknown[]).includes(part)) : QUANTITY_PARTS
      const chosen = Object.fromEntries(parts.map((part) => [part, all[part]])) as Partial<Quantities>
      const content = JSON.stringify({ page: root, units: UNITS, ...chosen })
      if (content.length <= MEASURE_LIMIT) return { content }
      const sizes = Object.fromEntries(parts.map((part) => [part, all[part].length]))
      return { content: JSON.stringify({ page: root, tooMuchAtOnce: sizes, note: 'Ask for fewer parts with "of".' }) }
    }

    case 'check_drawing': {
      if (input.page === undefined) return { content: JSON.stringify(listed(checkDrawing(doc, registry))) }
      const root = rootAsked()
      return root ? { content: JSON.stringify(listed(checkDrawing(doc, registry, [root]))) } : noPage()
    }

    default:
      return fail(`There is no tool called "${name}".`, 'no-such-tool')
  }
}
