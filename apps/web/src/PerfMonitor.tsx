import { useEffect, useRef, useState } from 'react'
import { Copy, Pause, Play, X } from 'lucide-react'
import { setProfiling, takeMeasures, type Span } from '@opencalque/core'
import { t } from './i18n'
import { setPrefs, usePrefs } from './prefs'
import { VERSION } from './release'
import { useStore } from './store'
import { toast } from './windows'

/** One frame of the app as the monitor saw it: when it ended, how long since the last, what ran in it. */
interface Frame {
  at: number
  ms: number
  spans: Span[]
  counts: Map<string, number>
}

/** What a part of the app took, over the frames looked at. */
interface Row {
  name: string
  depth: number
  times: number
  total: number
  longest: number
}

/** How far back the table looks, in ms. */
const WINDOW = 2000
/** How long frames are kept to find the slowest, in ms. */
const KEPT = 30_000
/** A frame slower than this, in ms, is listed among the slowest. */
const SLOW = 50
/** How often the window is drawn again, in ms: often enough to follow, seldom enough to cost nothing worth measuring. */
const REFRESH = 250

/** What each named part took over `frames`: how many times it ran, in all, and at most. */
function rowsOf(frames: Frame[]): Row[] {
  const rows = new Map<string, Row>()
  for (const frame of frames) {
    for (const s of frame.spans) {
      const row = rows.get(s.name) ?? { name: s.name, depth: s.depth, times: 0, total: 0, longest: 0 }
      row.times++
      row.total += s.ms
      row.longest = Math.max(row.longest, s.ms)
      row.depth = Math.min(row.depth, s.depth)
      rows.set(s.name, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}

const countsOf = (frames: Frame[]) => {
  const all = new Map<string, number>()
  for (const frame of frames) for (const [name, n] of frame.counts) all.set(name, (all.get(name) ?? 0) + n)
  return [...all].sort((a, b) => b[1] - a[1])
}

/** The longest spans of a frame, those at the top of what ran first. */
const topOf = (frame: Frame, n: number) => [...frame.spans].filter((s) => s.depth <= 1).sort((a, b) => b.ms - a.ms).slice(0, n)

const ms = (value: number) => (value >= 10 ? value.toFixed(0) : value.toFixed(1))

/**
 * The performance monitor (View › Performance monitor, `perfMonitor`): while it is open the core
 * and the editor measure what they do (`span` in `perf.ts`), and it shows, every quarter of a
 * second, the frames a second, what each part took over the last two seconds, how many views were
 * kept or laid out again, and the slowest frames of the last half minute with what took their time.
 * Its report, copied, is what to send whoever looks into a slowness: the measures, the app's
 * version and how much the drawing holds. Closed, nothing is measured.
 */
export function PerfMonitor() {
  const on = usePrefs((p) => p.perfMonitor)
  const frames = useRef<Frame[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [, redraw] = useState(0)

  useEffect(() => {
    if (!on) return
    setProfiling(true)
    let last = performance.now()
    let shown = last
    let frame = 0
    const tick = () => {
      const now = performance.now()
      const { spans, counts } = takeMeasures()
      if (!pausedRef.current) {
        frames.current.push({ at: now, ms: now - last, spans, counts })
        while (frames.current.length > 0 && now - frames.current[0].at > KEPT) frames.current.shift()
      }
      last = now
      if (now - shown > REFRESH) {
        shown = now
        redraw((n) => n + 1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      setProfiling(false)
      frames.current = []
    }
  }, [on])

  if (!on) return null
  const now = frames.current.at(-1)?.at ?? 0
  const recent = frames.current.filter((f) => now - f.at <= WINDOW)
  const fps = recent.length / (WINDOW / 1000)
  const rows = rowsOf(recent)
  const counted = countsOf(recent)
  const slowest = [...frames.current].filter((f) => f.ms > SLOW).sort((a, b) => b.ms - a.ms).slice(0, 8)

  const copy = () => {
    const doc = useStore.getState().doc
    const types: Record<string, number> = {}
    for (const node of Object.values(doc.nodes)) types[node.type] = (types[node.type] ?? 0) + 1
    const report = {
      version: VERSION,
      at: new Date().toISOString(),
      framesPerSecond: Math.round(fps),
      lastTwoSeconds: rowsOf(recent).map((r) => ({ name: r.name, times: r.times, averageMs: +(r.total / r.times).toFixed(2), longestMs: +r.longest.toFixed(2) })),
      counted: Object.fromEntries(counted),
      slowestFrames: slowest.map((f) => ({ ms: +f.ms.toFixed(1), top: topOf(f, 5).map((s) => ({ name: s.name, ms: +s.ms.toFixed(1) })) })),
      drawing: types,
    }
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => toast(t('Report copied')))
  }

  return (
    <div className="perf-monitor" role="dialog" aria-label={t('Performance')}>
      <header>
        <strong>{t('Performance')}</strong>
        <span className={fps < 30 ? 'perf-slow' : ''}>{t('{fps} frames a second', { fps: Math.round(fps) })}</span>
        <button className="icon-button" title={paused ? t('Resume') : t('Pause')} aria-label={paused ? t('Resume') : t('Pause')} onClick={() => setPaused(!paused)}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button className="icon-button" title={t('Copy the report')} aria-label={t('Copy the report')} onClick={copy}>
          <Copy size={13} />
        </button>
        <button className="icon-button" title={t('Close')} aria-label={t('Close')} onClick={() => setPrefs({ perfMonitor: false })}>
          <X size={13} />
        </button>
      </header>
      <p className="hint">{t('What took the time over the last two seconds: how many times each part ran, and how long it took, on average and at most, in ms.')}</p>
      <table>
        <thead>
          <tr>
            <th>{t('Step')}</th>
            <th>{t('Times')}</th>
            <th>{t('Average')}</th>
            <th>{t('Longest')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 16).map((row) => (
            <tr key={row.name} className={row.longest > SLOW ? 'perf-slow' : ''}>
              <td style={{ paddingLeft: 4 + row.depth * 10 }}>{row.name}</td>
              <td>{row.times}</td>
              <td>{ms(row.total / row.times)}</td>
              <td>{ms(row.longest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {counted.length > 0 && (
        <p className="perf-counted">
          {t('Counted')}: {counted.map(([name, n]) => `${name} ${n}`).join(' · ')}
        </p>
      )}
      {slowest.length > 0 && (
        <>
          <h4>{t('Slowest frames')}</h4>
          <ul>
            {slowest.map((frame, i) => (
              <li key={i}>
                <strong>{ms(frame.ms)} ms</strong> {topOf(frame, 3).map((s) => `${s.name} ${ms(s.ms)}`).join(' · ')}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
