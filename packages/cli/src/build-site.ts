import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEdit, checkDrawing, createDocument, drawingGuide, pagesOf, serializeDocument, type Op } from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'
import { publishedSchemas, SCHEMA_URL } from './schemas'

/*
 * What opencalque.com serves besides the editor, for search engines and language models, which
 * do not run the editor's script and so see nothing of it: a page saying what OpenCalque is
 * (`apps/web/site/about.html`), `llms.txt` and `llms-full.txt` (llmstxt.org), the JSON Schemas at
 * the URLs their `$id` gives, `robots.txt` and a sitemap. Written into the web build after Vite,
 * from the code, so that the guide a model reads there is the one the tools give.
 *
 *   pnpm build:web   (runs it)
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const out = join(root, 'apps/web/dist')
const SITE = 'https://opencalque.com'
const REPOSITORY = 'https://github.com/laurent512/opencalque'

if (!existsSync(join(out, 'index.html'))) throw new Error('Build the editor first (pnpm --filter @opencalque/web build): the site is written into its build.')

const version: string = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version
const registry = standardRegistry()

const write = (path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  writeFileSync(join(out, path), content)
}

// The schemas, where their `$id` says they are.
for (const [name, schema] of Object.entries(publishedSchemas())) write(`schema/${name}`, JSON.stringify(schema, null, 2) + '\n')

// A small drawing made by operations, as an example of both; it must come out with nothing wrong.
let example = createDocument('Example')
const page = pagesOf(example)[0].id
const exampleOps: Op[] = [
  ...[
    [0, 0, 4000, 0],
    [4000, 0, 4000, 3000],
    [4000, 3000, 0, 3000],
    [0, 3000, 0, 0],
  ].map(([ax, ay, bx, by], i): Op => ({ op: 'add_node', node: { id: `wall_${i + 1}`, type: 'wall', parent: page, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 } })),
  { op: 'add_node', node: { id: 'room_1', type: 'room', parent: page, x: 2000, y: 1500, name: 'Bedroom' } },
]
example = applyEdit(example, exampleOps, registry).doc
const problems = checkDrawing(example, registry)
if (problems.length > 0) throw new Error(`The example drawing of llms-full.txt has problems: ${problems.map((problem) => problem.message).join('; ')}`)
const exampleFile = serializeDocument({ ...example, id: 'doc_example' })

const MCP_CONFIG = `{ "mcpServers": { "opencalque": { "command": "npx", "args": ["-y", "opencalque", "mcp"] } } }`

const SUMMARY = `> OpenCalque is a free, open-source (MIT) 2D architectural editor for floor plans and layouts: walls that join themselves, doors and windows that cut them, rooms with their areas, furniture, dimensions, sheets at scale. It runs in the browser at ${SITE} and as a desktop app for Windows, macOS and Linux. A drawing is plain JSON in millimetres with a published JSON Schema, and every edit is a small JSON operation, so programs and AI agents can draw, check and export plans: \`npx -y opencalque mcp\` serves the drawing tools over MCP.`

const FITS = `It fits when someone wants a 2D plan of a home, an apartment, an office or a room that they can open and keep editing by hand, print to scale as a PDF, or hand to other CAD software as DXF; when a program or an agent has to produce such a plan from a description; or when a plan has to stay readable without the program that made it. It does not do 3D models, BIM (IFC), or DWG files.`

write(
  'llms.txt',
  `# OpenCalque

${SUMMARY}

${FITS}

## Docs

- [Guide for language models](${SITE}/llms-full.txt): how a drawing is stored, the operations that edit it, how to check the result, and a complete example drawing
- [About OpenCalque](${SITE}/about/): what it does, the format, the command line and the MCP server
- [README](${REPOSITORY}#readme): features, download, the CLI and connecting an agent
- [The file format, operations and extensions](${REPOSITORY}/blob/main/docs/FORMAT.md): how a drawing is stored, every command and operation, what stays stable between versions

## Format

- [Drawing schema](${SCHEMA_URL}document.schema.json): JSON Schema of a \`.opencalque\` file
- [Operations schema](${SCHEMA_URL}ops.schema.json): JSON Schema of a list of edits
- [Extension schema](${SCHEMA_URL}extension.schema.json): JSON Schema of an extension written as data (new parametric objects)

## Tools

- [Web editor](${SITE}): opens a \`.opencalque\` file from disk or dropped on it; nothing to install
- [npm package \`opencalque\`](https://www.npmjs.com/package/opencalque): command line and MCP server (\`npx -y opencalque mcp\`); MCP client configuration: \`${MCP_CONFIG}\`
- [Desktop app](${REPOSITORY}/releases/latest): installers for Windows, macOS and Linux; it can let a local agent work on the drawing open in it

## Optional

- [Changelog](${REPOSITORY}/blob/main/CHANGELOG.md)
- [Architecture](${REPOSITORY}/blob/main/docs/ARCHITECTURE.md): how the code is organised, for contributors
`,
)

write(
  'llms-full.txt',
  `# OpenCalque: a guide for language models

${SUMMARY}

${FITS}

Version ${version}. Drawings saved by version 1.0 and later open in every later version.

# Three ways to make a drawing

1. With the tools, over MCP: \`npx -y opencalque mcp\` (MCP client configuration: \`${MCP_CONFIG}\`). Open or create a file with open_drawing, read the guide with read_guide, edit with apply_operations, then use check_drawing and view_drawing to see what came out.
2. On the command line: \`npx opencalque new plan.opencalque\`, write the operations to a JSON file, \`npx opencalque apply plan.opencalque ops.json\`, then \`npx opencalque check plan.opencalque\` and \`npx opencalque png plan.opencalque --out plan.png\`. \`npx opencalque --help\` lists every command (svg, pdf, dxf, quantities…).
3. Without any tool: write a whole drawing as JSON, like the example at the end of this guide, and give it to the person as a file whose name ends in \`.opencalque\`. They open it at ${SITE} (File › Open, or drop it on the editor) or in the desktop app.

The JSON Schema of every type of node is in ${SCHEMA_URL}document.schema.json; that of the operations in ${SCHEMA_URL}ops.schema.json. Where the guide below says to call read_guide with a type, read that type in the schema instead.

${drawingGuide(registry, { schema: false })}

# Example

These operations, applied to a new drawing (whose first page has the id "${page}"), draw a room of 4 by 3 m between wall lines, walls 200 mm thick, and name it:

${JSON.stringify(exampleOps)}

This is the whole drawing they make, as a \`.opencalque\` file:

${exampleFile}`,
)

write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)

const pages = ['/', '/about/', '/llms.txt', '/llms-full.txt']
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((path) => `  <url><loc>${SITE}${path}</loc></url>`).join('\n')}
</urlset>
`,
)

write('about/index.html', readFileSync(join(root, 'apps/web/site/about.html'), 'utf8').replaceAll('{{version}}', version))
for (const picture of ['screenshot.png', 'screenshot-sheet.png']) copyFileSync(join(root, 'docs', picture), join(out, 'about', picture))

console.log(`Wrote the site into apps/web/dist: about/, llms.txt, llms-full.txt, schema/, robots.txt, sitemap.xml (version ${version}).`)
