import { alignCandidates, type AlignCandidate, type Alignable, type Document, type MoveSnap, type Node, type Vec2 } from '@opencalque/core'
import { platform } from '../platform'

/**
 * A log of moves, to see what a moved object lined up with and why, and what it did not and how
 * far it was: in development builds only. The desktop app writes it to `snap.log` in its logs
 * folder (`Platform.log`); a browser shows it in the console. For developers, in English.
 *
 * Each move gives its object, its box and the reaches in millimetres at the zoom of the moment;
 * each time what it lines up with changes as the pointer goes, a line; and when it is let go, where
 * it is and, along each axis, the nearest candidates of each kind, those out of reach too.
 */
export const LOGGING = import.meta.env.DEV

interface Move {
  lines: string[]
  reach: number
  touch: number
  pointer: Vec2
  d: Vec2
  said: string
}

let move: Move | null = null

const mm = (v: number) => (Math.round(v * 10) / 10).toString()
const signed = (v: number) => (v >= 0 ? '+' : '') + mm(v)

function nodeName(node: Node | undefined, id: string): string {
  if (!node) return id
  const what = node.type === 'parametric' ? node.kind : node.type
  return `${'name' in node && node.name ? `"${node.name}" ` : ''}${what} ${node.id}`
}

function thing(doc: Document, others: Alignable[], i: number): string {
  const id = others[i]?.id
  return id ? nodeName(doc.nodes[id.replace(/^around:/, '')], id) : `thing #${i}`
}

function told(doc: Document, others: Alignable[], c: AlignCandidate | null): string {
  if (!c) return 'nothing'
  if (c.rule === 'space') return `equal gaps (${signed(c.change)})`
  return `${c.rule}: its ${c.own} on the ${c.target} of ${thing(doc, others, c.other)} (${signed(c.change)})`
}

const box = (a: Alignable | null, d: Vec2 = { x: 0, y: 0 }) =>
  a ? `x ${mm(a.bounds.minX + d.x)}..${mm(a.bounds.maxX + d.x)}, y ${mm(a.bounds.minY + d.y)}..${mm(a.bounds.maxY + d.y)}` : 'no box'

export function logMoveStart(doc: Document, nodes: Node[], moving: Alignable | null, others: Alignable[], zoom: number, reach: number, touch: number): void {
  if (!LOGGING) return
  move = { lines: [], reach, touch, pointer: { x: 0, y: 0 }, d: { x: 0, y: 0 }, said: '' }
  move.lines.push(`--- ${new Date().toISOString()} move ${nodes.map((n) => nodeName(n, n.id)).join(', ')}`)
  move.lines.push(`  box ${box(moving)}; zoom ${zoom.toFixed(3)} px/mm; reach ${mm(reach)} mm to line up, ${mm(touch)} mm to touch; ${others.length} things in sight to line up with`)
}

/** One movement of the pointer: written only when what decides the move changes. */
export function logMoveStep(doc: Document, others: Alignable[], pointer: Vec2, d: Vec2, how: string, fit?: MoveSnap): void {
  if (!move) return
  move.pointer = pointer
  move.d = d
  const said = fit ? `x: ${told(doc, others, fit.why.x)}; y: ${told(doc, others, fit.why.y)}` : how
  if (said === move.said) return
  move.said = said
  move.lines.push(`  pointer ${signed(pointer.x)}, ${signed(pointer.y)} -> moved ${signed(d.x)}, ${signed(d.y)}: ${fit ? `${how}; ${said}` : said}`)
}

/** The move let go: where it ended, and what was near along each axis, in reach or not. Then written. */
export function logMoveEnd(doc: Document, moving: Alignable | null, others: Alignable[]): void {
  if (!move) return
  const { lines, pointer, d, reach, touch } = move
  lines.push(`  let go: pointer ${signed(pointer.x)}, ${signed(pointer.y)}; moved ${signed(d.x)}, ${signed(d.y)}; box now ${box(moving, d)}`)
  if (moving) {
    for (const axis of ['x', 'y'] as const) {
      // Where the pointer alone would have put it: what was within reach of that.
      const all = alignCandidates(moving, others, pointer, axis, reach)
      for (const rule of ['touch', 'line', 'space'] as const) {
        const near = all.filter((c) => c.rule === rule).sort((p, q) => Math.abs(p.change) - Math.abs(q.change)).slice(0, 3)
        const within = rule === 'touch' ? touch : reach
        lines.push(`  nearest along ${axis}, ${rule} (reach ${mm(within)}): ${near.length === 0 ? 'none' : near.map((c) => `${told(doc, others, c)}${Math.abs(c.change) <= within ? '' : ' out of reach'}`).join(' | ')}`)
      }
    }
  }
  const text = lines.join('\n') + '\n'
  move = null
  if (platform.log) platform.log('snap', text)
  else console.debug(text)
}
