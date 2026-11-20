import type { Graded } from './evaluate'
import type { Surface } from './surfaces'

/*
 * What a set of runs comes to: by task and surface, how many passed, the mean score, steps,
 * failed tool calls and tokens; and against an earlier summary, what changed.
 */

export interface Line {
  task: string
  surface: Surface
  runs: number
  passed: number
  score: number
  steps: number
  toolErrors: number
  /** Tokens per run: input including what came from the cache, and output. */
  input: number
  output: number
  seconds: number
  /** The checks that failed, with how many runs each failed in. */
  failing: Record<string, number>
}

export interface Summary {
  model: string
  provider: string
  date: string
  /** The commit the evals ran on, when known. */
  commit?: string
  passRate: number
  lines: Line[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)

export function summarize(graded: Graded[], meta: Pick<Summary, 'model' | 'provider' | 'date' | 'commit'>): Summary {
  const groups = new Map<string, Graded[]>()
  for (const g of graded) groups.set(`${g.surface}\u0000${g.task}`, [...(groups.get(`${g.surface}\u0000${g.task}`) ?? []), g])
  const lines: Line[] = [...groups.values()].map((runs) => {
    const failing: Record<string, number> = {}
    for (const run of runs) {
      for (const c of run.checks) if (!c.pass) failing[c.name] = (failing[c.name] ?? 0) + 1
      if (run.error) failing[`error: ${run.error}`] = (failing[`error: ${run.error}`] ?? 0) + 1
    }
    return {
      task: runs[0].task,
      surface: runs[0].surface,
      runs: runs.length,
      passed: runs.filter((r) => r.passed).length,
      score: mean(runs.map((r) => r.score)),
      steps: mean(runs.map((r) => r.steps)),
      toolErrors: mean(runs.map((r) => r.toolErrors)),
      input: mean(runs.map((r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite)),
      output: mean(runs.map((r) => r.usage.output)),
      seconds: mean(runs.map((r) => r.seconds)),
      failing,
    }
  })
  const total = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => graded.reduce((sum, g) => sum + g.usage[key], 0)
  return {
    ...meta,
    passRate: graded.length === 0 ? 0 : graded.filter((g) => g.passed).length / graded.length,
    lines,
    usage: { input: total('input'), output: total('output'), cacheRead: total('cacheRead'), cacheWrite: total('cacheWrite') },
  }
}

const percent = (n: number) => `${Math.round(n * 100)}%`
const thousands = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))

/** The summary as Markdown, with what changed since `before` when given. */
export function markdown(summary: Summary, before?: Summary): string {
  const earlier = (line: Line) => before?.lines.find((l) => l.task === line.task && l.surface === line.surface)
  const change = (line: Line) => {
    const was = earlier(line)
    if (!was) return ''
    const delta = line.passed / line.runs - was.passed / was.runs
    return delta === 0 ? ' (=)' : ` (${delta > 0 ? '+' : ''}${Math.round(delta * 100)})`
  }
  const rows = summary.lines.map(
    (l) =>
      `| ${l.surface} | ${l.task} | ${l.passed}/${l.runs}${change(l)} | ${percent(l.score)} | ${l.steps.toFixed(1)} | ${l.toolErrors.toFixed(1)} | ${thousands(l.input)} / ${thousands(l.output)} | ${Math.round(l.seconds)} s | ${
        Object.entries(l.failing)
          .map(([name, n]) => (l.runs > 1 ? `${name} (${n})` : name))
          .join('; ')
          .replace(/\|/g, '\\|') || ''
      } |`,
  )
  const { usage } = summary
  return [
    `# Evals: ${summary.model}`,
    '',
    `${summary.provider}, ${summary.date}${summary.commit ? `, commit ${summary.commit}` : ''}. **${percent(summary.passRate)} of runs passed**${before ? ` (was ${percent(before.passRate)} with ${before.model} on ${before.date})` : ''}.`,
    '',
    `Tokens: ${thousands(usage.input)} input, ${thousands(usage.cacheRead)} read from the cache, ${thousands(usage.cacheWrite)} written to it, ${thousands(usage.output)} output.`,
    '',
    '| Surface | Task | Passed | Score | Steps | Tool errors | Tokens in / out | Time | What failed |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}
