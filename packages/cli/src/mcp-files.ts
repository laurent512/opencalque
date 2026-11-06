import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { applyEdit, createDocument, DRAWING_TOOLS, pagesOf, readDocument, runDrawingTool, serializeDocument, type Document, type DrawingHost, type Registry, type ToolOutcome, type ToolSpec } from '@opencalque/core'
import { schema, text, type Backend } from './mcp'
import { renderPicture } from './render'

/*
 * The MCP server on drawings on disk: read before each call, written after each edit. It looks at
 * them through `render.ts`, a native module, so it runs from a checkout and is not in the desktop
 * app, whose `--mcp` serves the drawing open in it.
 */

/** What can be opened and written: drawings, so that an agent cannot be talked into overwriting anything else. */
const DRAWING_FILES = ['.opencalque', '.opencad', '.json']

const OPEN_DRAWING: ToolSpec = {
  name: 'open_drawing',
  description: 'Chooses the drawing the other tools work on: a .opencalque file. It is created, empty, when it does not exist and "create" is true. Use an absolute path.',
  schema: schema({ file: { type: 'string', description: 'Path of the drawing.' }, create: { type: 'boolean', description: 'Create it when it does not exist.' } }, ['file']),
}

/** Writes by replacing, so that a drawing is never left half written. */
function writeDrawing(path: string, doc: Document): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, serializeDocument(doc))
  renameSync(temporary, path)
}

/** Drawings on disk. Each call reads the file again, so that what someone else saved is what is edited. */
export function fileBackend(start: string | undefined, registry: Registry): Backend {
  let path = start ? resolve(start) : null

  const open = (input: { file?: unknown; create?: unknown }): ToolOutcome => {
    if (typeof input.file !== 'string') return text('Give the path of the drawing as "file".', true)
    const wanted = resolve(input.file)
    if (!DRAWING_FILES.includes(extname(wanted).toLowerCase())) return text(`${wanted} is not a drawing: it should end in ${DRAWING_FILES.join(', ')}.`, true)
    if (!existsSync(wanted)) {
      if (input.create !== true) return text(`There is no file ${wanted}. Pass "create": true to make an empty drawing there.`, true)
      writeDrawing(wanted, createDocument(basename(wanted, extname(wanted))))
    }
    const { doc, repairs } = readDocument(JSON.parse(readFileSync(wanted, 'utf8')))
    path = wanted
    return text(JSON.stringify({ opened: wanted, pages: pagesOf(doc).map((page) => ({ id: page.id, name: page.name })), ...(repairs.length > 0 ? { repairs } : {}) }))
  }

  return {
    tools: [OPEN_DRAWING, ...DRAWING_TOOLS],
    call: async (name, input) => {
      if (name === 'open_drawing') return open(input as { file?: unknown })
      if (!path) return text('No drawing is open: call open_drawing first.', true)
      const file = path
      if (!existsSync(file)) return text(`${file} is no longer there. Call open_drawing with "create": true to make it again.`, true)
      let doc = readDocument(JSON.parse(readFileSync(file, 'utf8'))).doc
      const host: DrawingHost = {
        registry,
        doc: () => doc,
        scope: () => pagesOf(doc)[0].id,
        apply: (ops) => {
          doc = applyEdit(doc, ops, registry).doc
          writeDrawing(file, doc)
        },
        picture: async (svg, pixels) => renderPicture(svg, pixels),
      }
      return runDrawingTool(name, input, host)
    },
  }
}
