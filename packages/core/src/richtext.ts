/**
 * Rich text: parts of a text set differently from the rest, bold, italic, underlined, struck
 * through, larger or smaller, or in another colour. A text keeps its words whole in `text`, as
 * it always has, and lays its `spans` over them, ranges of its characters each saying only what
 * it changes. A version that does not know spans draws the words plainly; a tool that reads only
 * the words reads them all.
 *
 * Offsets count UTF-16 units of `text`, as JavaScript strings do; `to` is excluded. Spans may
 * overlap as written by hand or by a model: for each property the last span that sets it wins.
 * What the editor writes is normalised (`spansOf`): in order, apart, and each saying something.
 */

/** How part of a text is set. What it leaves out is as the text says. `scale` multiplies the text's size. */
export interface TextStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  scale?: number
  /** A colour as a style's stroke is written: '#rrggbb', a shared colour `var(--id)` or `var(--layer)`. */
  color?: string
}

export interface TextSpan extends TextStyle {
  from: number
  to: number
}

export const TEXT_STYLE_KEYS = ['bold', 'italic', 'underline', 'strike', 'scale', 'color'] as const
export type TextStyleKey = (typeof TEXT_STYLE_KEYS)[number]

/** How far a part of a text can be made larger or smaller than the rest. */
export const MIN_TEXT_SCALE = 0.1
export const MAX_TEXT_SCALE = 20

/** A style with only what it says: nothing undefined, a scale of 1 left out, a scale out of reach brought within it. */
function cleanStyle(style: TextStyle): TextStyle {
  const out: TextStyle = {}
  for (const key of TEXT_STYLE_KEYS) {
    const value = style[key]
    if (value === undefined || value === null) continue
    if (key === 'scale') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value - 1) < 1e-9) continue
      out.scale = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value))
    } else if (key === 'color') {
      if (typeof value === 'string' && value !== '') out.color = value
    } else if (typeof value === 'boolean') out[key] = value
  }
  return out
}

export function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return TEXT_STYLE_KEYS.every((key) => a[key] === b[key])
}

/** The style of each character of a text of `length` characters. Characters share one object where they share a style. */
export function charStyles(length: number, spans: readonly TextSpan[] | undefined): TextStyle[] {
  const plain: TextStyle = {}
  const out: TextStyle[] = new Array(length).fill(plain)
  for (const span of spans ?? []) {
    const from = Math.max(0, Math.floor(span.from))
    const to = Math.min(length, Math.floor(span.to))
    if (!(from < to)) continue
    const own = cleanStyle(span)
    // Every character in a run of one style before this span gets the same new style.
    let last: TextStyle | null = null
    let made: TextStyle = plain
    for (let i = from; i < to; i++) {
      if (out[i] !== last) {
        last = out[i]
        made = { ...out[i], ...own }
      }
      out[i] = made
    }
  }
  return out
}

/** Spans that say a style for each character: in order, apart, joined where they touch with one style, none for plain characters. */
export function spansOf(styles: readonly TextStyle[]): TextSpan[] {
  const out: TextSpan[] = []
  for (let i = 0; i < styles.length; i++) {
    const style = cleanStyle(styles[i])
    if (Object.keys(style).length === 0) continue
    const last = out[out.length - 1]
    if (last && last.to === i && sameStyle(last, style)) last.to = i + 1
    else out.push({ from: i, to: i + 1, ...style })
  }
  return out
}

/** The spans of a text, normalised, or undefined when nothing in it is set apart. */
export function normalSpans(text: string, spans: readonly TextSpan[] | undefined): TextSpan[] | undefined {
  if (!spans || spans.length === 0) return undefined
  const out = spansOf(charStyles(text.length, spans))
  return out.length > 0 ? out : undefined
}

/** A change of style: each key given is set, or taken away when null. */
export type StyleChange = { [K in TextStyleKey]?: TextStyle[K] | null }

/** The spans once the characters from `from` to `to` have been given `change`. */
export function formatSpans(text: string, spans: readonly TextSpan[] | undefined, from: number, to: number, change: StyleChange): TextSpan[] | undefined {
  const styles = charStyles(text.length, spans)
  const [a, b] = [Math.max(0, Math.min(from, to)), Math.min(text.length, Math.max(from, to))]
  for (let i = a; i < b; i++) {
    const next: TextStyle = { ...styles[i] }
    for (const [key, value] of Object.entries(change) as [TextStyleKey, unknown][]) {
      if (value === null || value === undefined) delete next[key]
      else (next as Record<string, unknown>)[key] = value
    }
    styles[i] = next
  }
  const out = spansOf(styles)
  return out.length > 0 ? out : undefined
}

/**
 * The style words typed at `at` take: those of the character before, unless that ends a line,
 * when it is those of the character after, as in a word processor.
 */
export function styleAt(text: string, spans: readonly TextSpan[] | undefined, at: number): TextStyle {
  if (!spans || spans.length === 0) return {}
  const styles = charStyles(text.length, spans)
  if (at > 0 && text[at - 1] !== '\n') return styles[at - 1]
  if (at < text.length && text[at] !== '\n') return styles[at]
  return at > 0 ? styles[at - 1] : {}
}

/**
 * Replaces the characters from `from` to `to` with `inserted`, set in `style` (by default the
 * style at `from`, `styleAt`). The other characters keep theirs.
 */
export function replaceText(text: string, spans: readonly TextSpan[] | undefined, from: number, to: number, inserted: string, style?: TextStyle): { text: string; spans: TextSpan[] | undefined } {
  const [a, b] = [Math.max(0, Math.min(from, to)), Math.min(text.length, Math.max(from, to))]
  const styles = charStyles(text.length, spans)
  const own = style ?? styleAt(text, spans, a)
  const next = text.slice(0, a) + inserted + text.slice(b)
  const out = spansOf([...styles.slice(0, a), ...new Array(inserted.length).fill(own), ...styles.slice(b)])
  return { text: next, spans: out.length > 0 ? out : undefined }
}

/**
 * The spans of a text whose words were changed from `before` to `after` by something that knows
 * nothing of spans (a field of the Properties panel): what the two share at their start and at
 * their end keeps its style, and what was typed between takes the style of where it was typed.
 */
export function respan(before: string, after: string, spans: readonly TextSpan[] | undefined): TextSpan[] | undefined {
  if (!spans || spans.length === 0) return undefined
  let start = 0
  const most = Math.min(before.length, after.length)
  while (start < most && before[start] === after[start]) start++
  let end = 0
  while (end < most - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return replaceText(before, spans, start, before.length - end, after.slice(start, after.length - end)).spans
}

/** The patch that gives a text node new words, its spans moved to stay over the words they were on. */
export function retextPatch(node: { text: string; spans?: TextSpan[] }, text: string): { text: string; spans?: TextSpan[] | null } {
  if (!node.spans) return { text }
  return { text, spans: respan(node.text, text, node.spans) ?? null }
}

/**
 * What all the characters from `from` to `to` share: each key they all have the same value for.
 * An empty range asks what typing there would give (`styleAt`).
 */
export function commonStyle(text: string, spans: readonly TextSpan[] | undefined, from: number, to: number): TextStyle {
  const [a, b] = [Math.max(0, Math.min(from, to)), Math.min(text.length, Math.max(from, to))]
  if (a === b) return styleAt(text, spans, a)
  const styles = charStyles(text.length, spans)
  const out: Record<string, unknown> = { ...styles[a] }
  for (let i = a + 1; i < b; i++) {
    for (const key of TEXT_STYLE_KEYS) if (out[key] !== styles[i][key]) delete out[key]
  }
  return out as TextStyle
}

/** A piece of a line set in one style. */
export interface StyledRun {
  text: string
  style: TextStyle
}

/** A text cut into its lines, each line into runs of one style. An empty line has no runs. */
export function styledLines(text: string, spans: readonly TextSpan[] | undefined): StyledRun[][] {
  const styles = charStyles(text.length, spans)
  const lines: StyledRun[][] = [[]]
  let run: StyledRun | null = null
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push([])
      run = null
      continue
    }
    if (run && sameStyle(run.style, styles[i])) run.text += text[i]
    else {
      run = { text: text[i], style: styles[i] }
      lines[lines.length - 1].push(run)
    }
  }
  return lines
}
