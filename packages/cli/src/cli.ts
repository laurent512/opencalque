#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod'
import {
  applyOps,
  childrenOf,
  componentsOf,
  createDocument,
  DocumentSchema,
  layersOf,
  OpSchema,
  pagesOf,
  parseDocument,
  parseOps,
  Registry,
  serializeDocument,
  toDXF,
  toSVG,
  type Document,
  toPDF,
} from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'

const USAGE = `opencalque <command>

  new <file> [name]            Create an empty document
  validate <file>              Check that a file is a valid document
  describe <file>              Print a JSON summary: pages, layers, components, object counts
  apply <file> <ops.json>      Apply a JSON array of operations and save the file
  svg <file> [--page <id>] [--out <file.svg>]
                               Render a page (default: the first) to SVG
  pdf <file> [--out <file.pdf>] Export every paper as a page of a PDF, at its real size and scale
  dxf <file> [--page <id>] [--out <file.dxf>]
                               Export a page to DXF for other CAD programs
  schema [--out <dir>]         Print or write the JSON Schemas of documents and operations
`

const registry = new Registry().use(architecture)
const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  return args.splice(i, 2)[1]
}

const read = (file: string): Document => parseDocument(JSON.parse(readFileSync(file, 'utf8')))

function describe(doc: Document) {
  const container = (id: string) => {
    const counts: Record<string, number> = {}
    for (const n of childrenOf(doc, id)) counts[n.type] = (counts[n.type] ?? 0) + 1
    return counts
  }
  return {
    name: doc.name,
    unit: doc.unit,
    layers: layersOf(doc).map(({ id, name, visible, locked, color }) => ({ id, name, visible, locked, color })),
    pages: pagesOf(doc).map((p) => ({ id: p.id, name: p.name, objects: container(p.id) })),
    components: componentsOf(doc).map((c) => ({ id: c.id, name: c.name, objects: container(c.id) })),
    parametricKinds: [...registry.parametric.values()].map(({ kind, label, params }) => ({ kind, label, params })),
  }
}

function main(): void {
  const out = flag('out')
  const page = flag('page')
  const [command, file, extra] = args
  switch (command) {
    case 'new':
      writeFileSync(file, serializeDocument(createDocument(extra)))
      return
    case 'validate':
      read(file)
      console.log('OK')
      return
    case 'describe':
      console.log(JSON.stringify(describe(read(file)), null, 2))
      return
    case 'apply': {
      const ops = parseOps(JSON.parse(readFileSync(extra, 'utf8')))
      writeFileSync(file, serializeDocument(applyOps(read(file), ops)))
      console.log(`Applied ${ops.length} operations`)
      return
    }
    case 'svg': {
      const doc = read(file)
      const svg = toSVG(doc, page ?? pagesOf(doc)[0].id, registry)
      if (out) writeFileSync(out, svg)
      else process.stdout.write(svg)
      return
    }
    case 'pdf': {
      const doc = read(file)
      const pdf = toPDF(doc, registry)
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
        'document.schema.json': z.toJSONSchema(DocumentSchema),
        'ops.schema.json': z.toJSONSchema(z.array(OpSchema)),
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
    default:
      process.stdout.write(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
