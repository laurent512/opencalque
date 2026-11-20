import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serializeDocument, toSVG } from '@opencalque/core'
import { renderPng } from '../../cli/src/render'
import { evaluate, type Graded } from './evaluate'
import { PAGE, registry } from './plans'
import { makeProvider } from './providers'
import { markdown, summarize, type Summary } from './report'
import { runs, SURFACES, type Surface } from './surfaces'
import { TASKS } from './tasks'

/*
 * pnpm evals [--model claude-sonnet-5-5] [--surface assistant|outside|both] [--tasks a,b]
 *            [--repeat 1] [--concurrency 3] [--provider anthropic|compatible --base-url URL]
 *            [--no-pictures] [--baseline summary.json] [--min 0.8] [--out folder] [--list]
 *
 * Runs the tasks against a real model and writes, in a folder of results: summary.md and
 * summary.json, and for each run what the model was sent and did (run.json), the drawing it left
 * (final.opencalque) and a picture of it (final.png). It costs tokens: ARCHITECTURE, "Evals".
 */

const HELP = `pnpm evals [options]
  --model <id>          the model (default claude-sonnet-5-5)
  --provider <name>     anthropic (default, needs ANTHROPIC_API_KEY) or compatible (--base-url)
  --base-url <url>      a chat-completions service, e.g. http://localhost:11434/v1 for Ollama
  --surface <name>      assistant, outside (the MCP server) or both (default assistant)
  --tasks <ids>         some tasks only, separated by commas (default all; --list shows them)
  --repeat <n>          runs of each task (default 1)
  --concurrency <n>     runs at once (default 3)
  --no-pictures         for a model that cannot be shown pictures
  --timeout <s>         seconds allowed to one run (default 420)
  --baseline <file>     an earlier summary.json, to show what changed
  --min <rate>          exit with 1 when fewer than this share of runs pass, e.g. 0.8
  --out <folder>        where to write (default packages/evals/results/<date>-<model>)
  --list                list the tasks and stop`

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'claude-sonnet-5-5' },
    provider: { type: 'string', default: 'anthropic' },
    'base-url': { type: 'string' },
    surface: { type: 'string', default: 'assistant' },
    tasks: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '3' },
    'no-pictures': { type: 'boolean', default: false },
    timeout: { type: 'string', default: '420' },
    baseline: { type: 'string' },
    min: { type: 'string' },
    out: { type: 'string' },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

if (values.help) {
  console.log(HELP)
  process.exit(0)
}
if (values.list) {
  for (const task of TASKS) console.log(`${task.id.padEnd(26)} ${task.about}${task.selection ? ' (with a selection)' : ''}${task.pictures ? ' (needs pictures)' : ''}`)
  process.exit(0)
}

const surfaces: Surface[] = values.surface === 'both' ? SURFACES : SURFACES.includes(values.surface as Surface) ? [values.surface as Surface] : fail(`--surface is assistant, outside or both, not ${values.surface}.`)
const wanted = values.tasks?.split(',').map((id) => id.trim())
const unknown = wanted?.filter((id) => !TASKS.some((task) => task.id === id)) ?? []
if (unknown.length > 0) fail(`No task ${unknown.join(', ')}. pnpm evals --list shows them.`)
const tasks = wanted ? TASKS.filter((task) => wanted.includes(task.id)) : TASKS
const repeat = Math.max(1, Math.min(20, Number(values.repeat) || 1))
const concurrency = Math.max(1, Math.min(16, Number(values.concurrency) || 1))
const timeout = Math.max(30, Number(values.timeout) || 420) * 1000
const pictures = !values['no-pictures']
if (values.provider !== 'anthropic' && values.provider !== 'compatible') fail(`--provider is anthropic or compatible, not ${values.provider}.`)

let provider: ReturnType<typeof makeProvider>
try {
  provider = makeProvider({ provider: values.provider, model: values.model, baseUrl: values['base-url'], pictures })
} catch (error) {
  fail((error as Error).message)
}

const root = fileURLToPath(new URL('../../../', import.meta.url))
const date = new Date().toISOString().slice(0, 16).replace(':', '-')
const out = resolve(values.out ?? join(root, 'packages/evals/results', `${date}-${values.model.replace(/[^\w.-]+/g, '_')}`))
mkdirSync(out, { recursive: true })
const before: Summary | undefined = values.baseline ? (existsSync(values.baseline) ? JSON.parse(readFileSync(values.baseline, 'utf8')) : fail(`There is no ${values.baseline}.`)) : undefined
let commit: string | undefined
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
} catch {
  // Not a checkout.
}

const queue = surfaces.flatMap((surface) => tasks.filter((task) => runs(task, surface, pictures)).flatMap((task) => Array.from({ length: repeat }, (_, i) => ({ task, surface, attempt: i + 1 }))))
const skipped = surfaces.flatMap((surface) => tasks.filter((task) => !runs(task, surface, pictures)).map((task) => `${surface}/${task.id}`))
console.log(`${queue.length} runs of ${values.model} (${values.provider}), ${concurrency} at once, into ${out}${skipped.length > 0 ? `\nLeft out, as they cannot run here: ${skipped.join(', ')}` : ''}`)

const graded: Graded[] = []
let next = 0

/** Keeps what a run did and left, for reading afterwards. */
function keep(folder: string, result: Awaited<ReturnType<typeof evaluate>>): void {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'run.json'), JSON.stringify({ ...result.graded, reply: result.run.reply, transcript: result.run.transcript }, null, 2))
  writeFileSync(join(folder, 'final.opencalque'), serializeDocument(result.run.doc))
  try {
    writeFileSync(join(folder, 'final.png'), renderPng(toSVG(result.run.doc, PAGE, registry), 1600).png)
  } catch {
    // A drawing left with nothing to draw.
  }
}

async function worker(): Promise<void> {
  while (next < queue.length) {
    const { task, surface, attempt } = queue[next++]
    const result = await evaluate(task, surface, provider, attempt, timeout)
    graded.push(result.graded)
    keep(join(out, `${surface}-${task.id}${repeat > 1 ? `-${attempt}` : ''}`), result)
    const { passed, score, steps, error } = result.graded
    console.log(`${passed ? 'pass' : 'FAIL'}  ${surface}/${task.id}${repeat > 1 ? ` #${attempt}` : ''}  ${Math.round(score * 100)}% of checks, ${steps} steps${error ? `, ${error}` : ''}`)
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

graded.sort((a, b) => a.surface.localeCompare(b.surface) || TASKS.findIndex((t) => t.id === a.task) - TASKS.findIndex((t) => t.id === b.task) || a.attempt - b.attempt)
const summary = summarize(graded, { model: values.model, provider: values.provider === 'compatible' ? `compatible (${values['base-url']})` : 'anthropic', date: new Date().toISOString().slice(0, 10), commit })
const text = markdown(summary, before)
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))
writeFileSync(join(out, 'summary.md'), text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
console.log(`\n${text}`)

const min = values.min === undefined ? undefined : Number(values.min)
process.exit(min !== undefined && summary.passRate < min ? 1 : 0)
