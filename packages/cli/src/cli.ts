#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import {
  applyEdit,
  applyOps,
  checkDrawing,
  createDocument,
  describeDrawing,
  documentJsonSchema,
  drawingGuide,
  dxfOps,
  newId,
  nodeTypes,
  nodeTypeSchema,
  extensionJsonSchema,
  opsJsonSchema,
  pagesOf,
  parseOps,
  problemsMadeBy,
  quantities,
  readDocument,
  serializeDocument,
  toDXF,
  toSVG,
  type Document,
  toPDF,
  pdfFontCharacters,
  pdfFontNames,
  unknownProperties,
} from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'
import { liveBackend, serve } from './mcp'
import { fileBackend } from './mcp-files'
import { renderPng } from './render'

const USAGE = `opencalque <command>

  new <file> [name] [--force]  Create an empty document (--force replaces an existing file)
  validate <file>              Check that a file is a valid document; lists what opening it would repair
  describe <file>              Print a JSON summary: pages, layers, components, object counts
  check <file> [--page <id>]   List what is wrong with the drawing as JSON (rooms that do not close,
                               walls drawn twice, doors outside a wall); exits 1 if anything is
  quantities <file> [--page <id>]
                               Print what a page holds as JSON: rooms and their areas, walls, doors, objects
  apply <file> <ops.json>      Apply a JSON array of operations and save the file; warns of what they left wrong
  import <file> <drawing.dxf>...
                               Add each DXF as a page of the drawing, which is created when it does
                               not exist. A DXF laid out as a sheet comes in as its paper.
  svg <file> [--page <id>] [--out <file.svg>]
                               Render a page (default: the first) to SVG
  png <file> [--page <id>] [--size <pixels>] [--out <file.png>]
                               Draw a page as a picture, 2000 pixels on its longer side unless told otherwise
  pdf <file> [--out <file.pdf>] Export every paper as a page of a PDF, at its real size and scale
  dxf <file> [--page <id>] [--out <file.dxf>]
                               Export a page to DXF for other CAD programs
  schema [--out <dir>]         Print or write the JSON Schemas of documents, operations and extensions written as data
  guide [--type <type>]        Print how drawings are stored and edited, written for an AI agent, or
                               the JSON Schema of one type of node
  mcp [<file>] [--live]        Serve the drawing tools to an AI agent over MCP (stdin and stdout): a file,
                               one the agent opens, or with --live the drawing open in the desktop app
  --version                    Print the version
`

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

// The built-in extension and those that ship with the app, so that what the editor draws is drawn here too.
const registry = standardRegistry()
const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  return args.splice(i, 2)[1]
}

/** Whether a flag that takes no value was given; it is taken out of the arguments. */
function toggle(name: string): boolean {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}

/** What `read` had to put right in the files it read, to say before anything else. */
const repaired: string[] = []

/** Reads a drawing, putting right what would stop it from being edited (see repairDocument), and noting what was. */
function read(file: string): Document {
  const { doc, repairs } = readDocument(JSON.parse(readFileSync(file, 'utf8')))
  for (const repair of repairs) {
    repaired.push(repair)
    console.error(`warning: ${file}: ${repair}`)
  }
  return doc
}

const describe = (doc: Document) => ({ ...describeDrawing(doc), parametricKinds: [...registry.parametric.values()].map(({ kind, label, params }) => ({ kind, label, params })) })

async function main(): Promise<void> {
  const out = flag('out')
  const page = flag('page')
  const size = flag('size')
  const type = flag('type')
  const force = toggle('force')
  const live = toggle('live')
  if (toggle('version')) return void console.log(VERSION)
  if (toggle('help') || toggle('h')) return void process.stdout.write(USAGE)
  const [command, file, extra] = args
  switch (command) {
    case 'new':
      if (!file) throw new Error('Give the name of the file to create.')
      if (existsSync(file) && !force) throw new Error(`${file} already exists. Add --force to replace it with an empty drawing.`)
      writeFileSync(file, serializeDocument(createDocument(extra)))
      return
    case 'validate':
      read(file)
      // A file that had to be put right to open is readable, but not as it should be.
      if (repaired.length > 0) {
        console.log(`${file} opens, but ${repaired.length} problem${repaired.length === 1 ? ' was' : 's were'} repaired (listed above). Applying any operation, or saving it from the app, writes the repaired drawing.`)
        process.exitCode = 1
      } else console.log('OK')
      return
    case 'describe':
      console.log(JSON.stringify(describe(read(file)), null, 2))
      return
    case 'apply': {
      const ops = parseOps(JSON.parse(readFileSync(extra, 'utf8')))
      const doc = read(file)
      const after = applyEdit(doc, ops, registry).doc
      writeFileSync(file, serializeDocument(after))
      for (const warning of unknownProperties(doc, ops)) console.error(`warning: not a property of the format, kept but without effect: ${warning}`)
      for (const problem of problemsMadeBy(doc, after, registry)) console.error(`warning: ${problem.message}`)
      console.log(`Applied ${ops.length} operations`)
      return
    }
    case 'check': {
      const problems = checkDrawing(read(file), registry, page ? [page] : undefined)
      console.log(JSON.stringify(problems, null, 2))
      if (problems.length > 0) process.exitCode = 1
      return
    }
    case 'quantities': {
      const doc = read(file)
      console.log(JSON.stringify(quantities(doc, page ?? pagesOf(doc)[0].id, registry), null, 2))
      return
    }
    case 'import': {
      const sources = args.slice(2)
      if (!file || sources.length === 0) throw new Error('Give the drawing, then the DXF files to add to it.')
      const fresh = !existsSync(file)
      let doc = fresh ? createDocument(basename(file, extname(file))) : read(file)
      const texts = sources.map((source) => readFileSync(source, 'utf8'))
      // A file names its pictures from the folder it is in.
      const picture = (source: string) => (path: string) => {
        const found = join(dirname(source), path)
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(found).toLowerCase()]
        if (!mime || !existsSync(found)) return undefined
        const data = readFileSync(found)
        return { mime, data: data.toString('base64'), ...(mime === 'image/png' ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : {}) }
      }
      // A sheet that shows nothing at a scale of its own takes the scale of the others, so that the pages go together.
      const scales = texts.map((text) => dxfOps(doc, pagesOf(doc)[0].id, text).sheet?.scale).filter((scale) => scale !== undefined && scale !== 1)
      const scale = scales.sort((a, b) => scales.filter((s) => s === b).length - scales.filter((s) => s === a).length)[0]
      sources.forEach((source, i) => {
        const id = fresh && i === 0 ? pagesOf(doc)[0].id : newId('page')
        if (!doc.nodes[id]) doc = applyOps(doc, [{ op: 'add_node', node: { type: 'page', id, parent: null } }])
        const result = dxfOps(doc, id, texts[i], { picture: picture(source), scale })
        // The page is named after the sheet when the file is one, after the file otherwise.
        doc = applyOps(doc, [{ op: 'update_node', id, patch: { name: result.sheet?.name || basename(source, extname(source)) } }, ...result.ops])
        console.log(`${source}: ${result.added} objects${result.sheet ? `, a sheet at 1:${result.sheet.scale}` : ''}${result.skipped ? `, ${result.skipped} left out` : ''}`)
      })
      writeFileSync(file, serializeDocument(doc))
      return
    }
    case 'svg': {
      const doc = read(file)
      const svg = toSVG(doc, page ?? pagesOf(doc)[0].id, registry)
      if (out) writeFileSync(out, svg)
      else process.stdout.write(svg)
      return
    }
    case 'png': {
      const doc = read(file)
      const pixels = size === undefined ? 2000 : Number(size)
      if (!(pixels >= 16 && pixels <= 16000)) throw new Error('--size is a number of pixels from 16 to 16000.')
      const { png } = renderPng(toSVG(doc, page ?? pagesOf(doc)[0].id, registry), pixels)
      if (out) writeFileSync(out, png)
      else process.stdout.write(png)
      return
    }
    case 'pdf': {
      const doc = read(file)
      // Letters the standard PDF fonts lack are printed in the fonts the app ships; Chinese
      // characters in their Japanese or Korean forms when the drawing has kana or Hangul.
      const characters = pdfFontCharacters(doc, registry)
      const fonts = characters.length === 0 ? [] : pdfFontNames(characters).map((name) => new Uint8Array(readFileSync(new URL(`../../../fonts/${name}-Regular.ttf`, import.meta.url))))
      const pdf = toPDF(doc, registry, undefined, { fonts })
      if (out) writeFileSync(out, pdf)
      else process.stdout.write(pdf)
      return
    }
    case 'dxf': {
      const doc = read(file)
      const dxf = toDXF(doc, page ?? pagesOf(doc)[0].id, registry)
      if (out) writeFileSync(out, dxf)
      else process.stdout.write(dxf)
      return
    }
    case 'schema': {
      const schemas = {
        'document.schema.json': documentJsonSchema(),
        'ops.schema.json': opsJsonSchema(),
        'extension.schema.json': extensionJsonSchema(),
      }
      for (const [name, schema] of Object.entries(schemas)) {
        const json = JSON.stringify(schema, null, 2) + '\n'
        if (out) {
          mkdirSync(out, { recursive: true })
          writeFileSync(join(out, name), json)
        } else process.stdout.write(json)
      }
      return
    }
    case 'guide': {
      if (type === undefined) return void console.log(drawingGuide(registry, { schema: false }))
      const schema = nodeTypeSchema(type)
      if (!schema) throw new Error(`There is no type of node "${type}". The types are ${nodeTypes().join(', ')}.`)
      return void console.log(JSON.stringify(schema, null, 2))
    }
    case 'mcp':
      if (live && file) throw new Error('Give a file, or --live for the drawing open in the app, not both.')
      return serve(live ? liveBackend() : fileBackend(file, registry), registry, VERSION)
    default:
      process.stdout.write(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
