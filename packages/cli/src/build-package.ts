import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/*
 * The CLI as the package `opencalque` on npm, so that `npx -y opencalque mcp` gives any agent the
 * drawing tools with nothing to clone or install. The workspace's packages export their TypeScript
 * source, which npm cannot install, so the CLI is bundled whole into `dist/cli.js`, with what it
 * uses of others; only the renderer, a native module with a build for each system, stays a
 * dependency. Beside it: Noto Sans (fonts.ts), the licences of what the bundle holds, and the
 * `server.json` that lists the package in the MCP registry.
 *
 *   pnpm package:npm                    writes packages/cli/npm
 *   cd packages/cli/npm && npm publish  (the release workflow does it on a version tag)
 */

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(cli, '../..')
const out = join(cli, 'npm')

const pkg = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> }
const version = pkg.version

/** The name the MCP registry knows the server by: it proves itself through the GitHub account that holds the repository. */
const MCP_NAME = 'io.github.laurent512/opencalque'
const REPOSITORY = 'https://github.com/laurent512/opencalque'
/** The registry takes at most 100 characters. */
const DESCRIPTION = 'Draw 2D floor plans as JSON: walls, doors, rooms, furniture. Check, measure, export PDF, DXF, SVG.'

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'fonts'), { recursive: true })

const { metafile } = await build({
  entryPoints: [join(cli, 'src/cli.ts')],
  outfile: join(out, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // A native module, with a build for each system that npm picks.
  external: ['@resvg/resvg-js'],
  // What is bundled from CommonJS may still call `require`, which a module does not have.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  metafile: true,
  // Where the paths of `metafile` start from.
  absWorkingDir: root,
  logLevel: 'warning',
})

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'opencalque',
      version,
      description: DESCRIPTION,
      keywords: ['floor plan', 'floorplan', 'architecture', 'cad', '2d', 'drawing', 'mcp', 'mcp-server', 'model context protocol', 'ai agent', 'dxf', 'svg', 'pdf', 'json'],
      homepage: 'https://opencalque.com',
      repository: { type: 'git', url: `git+${REPOSITORY}.git`, directory: 'packages/cli' },
      bugs: `${REPOSITORY}/issues`,
      license: 'MIT',
      type: 'module',
      bin: { opencalque: 'dist/cli.js' },
      files: ['dist', 'fonts', 'THIRD-PARTY-NOTICES.txt'],
      engines: { node: '>=22' },
      mcpName: MCP_NAME,
      dependencies: { '@resvg/resvg-js': pkg.dependencies['@resvg/resvg-js'] },
    },
    null,
    2,
  ) + '\n',
)

writeFileSync(
  join(out, 'server.json'),
  JSON.stringify(
    {
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: MCP_NAME,
      title: 'OpenCalque',
      description: DESCRIPTION,
      websiteUrl: 'https://opencalque.com',
      repository: { url: REPOSITORY, source: 'github', subfolder: 'packages/cli' },
      version,
      packages: [{ registryType: 'npm', identifier: 'opencalque', version, transport: { type: 'stdio' }, packageArguments: [{ type: 'positional', value: 'mcp' }] }],
    },
    null,
    2,
  ) + '\n',
)

copyFileSync(join(cli, 'README.md'), join(out, 'README.md'))
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
for (const font of ['NotoSans-Regular.ttf', 'OFL-NotoSans.txt']) copyFileSync(join(root, 'fonts', font), join(out, 'fonts', font))

// The licences of the packages of others the bundle holds, as `pnpm notices` writes them for the app.
const PACKAGE = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/
const folders = new Set(Object.keys(metafile.inputs).map((input) => PACKAGE.exec(resolve(root, input))?.[1]).filter((folder): folder is string => folder !== undefined))
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim()
const RULE = '='.repeat(78)
const entries = [...folders]
  .map((folder) => {
    const about = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { name: string; version: string; main?: string; license?: string | { type: string }; homepage?: string }
    const licence = typeof about.license === 'string' ? about.license : (about.license?.type ?? 'see below')
    const files = readdirSync(folder).filter((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name)).sort()
    // Clipper says its licence at the head of its main file, and has no licence file.
    const main = [about.main, 'index.js'].map((name) => name && join(folder, name)).find((file) => file && existsSync(file) && !file.endsWith(folder))
    const head = main ? /^\s*\/\*[\s\S]*?\*\//.exec(read(main))?.[0] : undefined
    const texts = files.length > 0 ? files.map((name) => read(join(folder, name))) : head && /licen[cs]e/i.test(head) ? [head] : ['(The package carries no licence file; its licence is the one named above.)']
    return { key: `${about.name}@${about.version}`, text: [RULE, `${about.name} ${about.version}`, `Licence: ${licence}${about.homepage ? `  ${about.homepage}` : ''}`, '', ...texts, ''].join('\n') }
  })
  .filter(({ key }) => !key.startsWith('@opencalque/'))
  .sort((a, b) => a.key.localeCompare(b.key))
writeFileSync(
  join(out, 'THIRD-PARTY-NOTICES.txt'),
  [
    'OpenCalque is free software under the MIT licence (LICENSE). dist/cli.js includes the following',
    'software by others, each under its own licence, and fonts/ holds Noto Sans, under the SIL Open',
    'Font Licence (fonts/OFL-NotoSans.txt). @resvg/resvg-js is installed beside it, under its own.',
    '',
    ...entries.map(({ text }) => text),
  ]
    .join('\n')
    .trimEnd() + '\n',
)

console.log(`Wrote packages/cli/npm: opencalque ${version}, bundling ${entries.length} packages of others.`)
