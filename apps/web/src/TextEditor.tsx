import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  annotationText,
  charStyles,
  spansOf,
  commonStyle,
  formatSpans,
  gridlineBubbles,
  replaceText,
  resolveColor,
  respan,
  styleAt,
  styledLines,
  TEXT_STYLE_KEYS,
  type Node,
  type NodeInput,
  type NodeOf,
  type StyleChange,
  type TextSpan,
  type TextStyle,
} from '@opencalque/core'
import { finishTextEdit } from './actions'
import { commandFor, execute } from './commands'
import { darkInk } from './canvas/draw'
import { FLOATING } from './floating'
import { preview, useStore } from './store'
import { useTextFormat, type RichEditor, type TextNodePatch } from './textFormat'
import { TEXT_FORMAT_BAR, TextFormatBar } from './TextFormatBar'
import { useTheme } from './theme'

/** The font the canvas draws text in when a text has none of its own. */
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

interface Wording {
  x: number
  y: number
  size: number
  text: string
  rotation?: number
  right?: boolean
  font?: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  /** The property the words are, and whether they are one line only (Enter then ends the typing). */
  key?: 'text' | 'label'
  single?: boolean
}

/** Where and how the words of a node that has some are drawn: a text, the note of an annotation, or the label in a grid line's bubble. */
function wording(node: Node | undefined, bubble = 0): Wording | null {
  if (node?.type === 'text') return node
  if (node?.type === 'annotation') return { ...annotationText(node), text: node.text, font: node.font }
  if (node?.type === 'gridline') {
    const bubbles = gridlineBubbles(node)
    const { centre, r } = bubbles[bubble] ?? bubbles[0] ?? {}
    // As gridlinePrimitives writes it: upright and centred in the bubble, half its diameter tall.
    return centre ? { x: centre.x, y: centre.y + r * 0.35, size: r, text: node.label, font: node.font, align: 'center', key: 'label', single: true } : null
  }
  return null
}

/**
 * Words being typed in place. A box sits exactly where they are drawn, at the same size, while
 * the canvas leaves them out; every keystroke goes into the drawing, so what is typed is what is
 * there. Enter starts a new line, except in a grid line's label, which it ends; Esc, Ctrl+Enter
 * or a click elsewhere ends the typing. What is
 * shown while typing is the text as written, with its fields ({date}, {page}…) not yet filled in.
 * A text node is typed in a box that sets its words apart (`RichTextEditor`), with the format
 * bar over it; a note and a label are plain.
 */
export function TextEditor() {
  const editing = useStore((s) => s.editingText)
  const node = useStore((s) => (s.editingText ? s.doc.nodes[s.editingText.id] : undefined))
  if (!editing || !node) return null
  if (node.type === 'text') return <RichTextEditor key={editing.id} node={node} create={editing.create} />
  return <PlainTextEditor />
}

function PlainTextEditor() {
  const editing = useStore((s) => s.editingText)
  const node = useStore((s) => (s.editingText ? s.doc.nodes[s.editingText.id] : undefined))
  const view = useStore((s) => s.view)
  const darkCanvas = useTheme((s) => s.darkCanvas)
  const input = useRef<HTMLTextAreaElement>(null)

  // Focused as soon as it shows, so that what is typed at once goes into it rather than to the
  // shortcuts (the letters of "Note" are tools); the canvas keeps the click that placed it from
  // taking the focus back (its `onMouseDown`). Again once that click has finished, in case.
  useLayoutEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
    const timer = setTimeout(() => {
      if (document.activeElement === input.current) return
      input.current?.focus()
      input.current?.select()
    })
    return () => clearTimeout(timer)
  }, [editing?.id])

  const words = wording(node, editing?.bubble)
  if (!editing || !node || !words) return null
  const size = words.size * view.zoom
  const lines = words.text.split('\n')
  const key = words.key ?? 'text'
  const write = (typed: string) => {
    const text = words.single ? typed.replace(/\n/g, '') : typed
    preview([editing.create ? { op: 'add_node', node: { ...editing.create, [key]: text } as NodeInput } : { op: 'update_node', id: editing.id, patch: { [key]: text } }])
  }

  return (
    <textarea
      ref={input}
      className="text-editor"
      value={words.text}
      spellCheck={false}
      wrap="off"
      rows={lines.length}
      style={{
        left: words.x * view.zoom + view.x,
        // The anchor is the baseline of the first line; the box starts one ascent above it.
        top: words.y * view.zoom + view.y - size * 0.95,
        height: size * 1.25 * lines.length,
        font: `${size}px/1.25 ${words.font ?? FONT}`,
        width: `calc(${Math.max(4, ...lines.map((line) => line.length)) + 1}ch + 8px)`,
        // The words in the colour the canvas will draw them in.
        color: darkCanvas ? darkInk(node.style?.stroke ?? '#1f1f1f', true) : (node.style?.stroke ?? undefined),
        fontWeight: words.bold ? 'bold' : undefined,
        textAlign: words.right ? 'right' : words.align,
        // Words that end at their anchor grow leftwards from it; centred ones, both ways.
        transform:
          [words.rotation ? `rotate(${words.rotation}deg)` : '', words.right || words.align === 'right' ? 'translateX(-100%)' : words.align === 'center' ? 'translateX(-50%)' : ''].filter(Boolean).join(' ') || undefined,
        transformOrigin: `0 ${size * 0.95}px`,
      }}
      onChange={(e) => write(e.target.value)}
      onBlur={finishTextEdit}
      onKeyDown={(e) => {
        // A label is one line: Enter ends it, as Ctrl+Enter ends a text.
        if (e.key === 'Escape' || (e.key === 'Enter' && (words.single || e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finishTextEdit()
        }
        // Keep typing from reaching the canvas and command shortcuts.
        e.stopPropagation()
      }}
    />
  )
}

/** The words and how they are set apart, as the editor holds them while they are typed. */
interface Words {
  text: string
  spans: TextSpan[] | undefined
}

/** A step of the editor's own undo: the words, the selection and what the bar set for the whole text, before a change. */
interface Kept extends Words {
  anchor: number
  head: number
  extra: TextNodePatch
}

/** How many changes the editor can undo while the text is typed; the drawing's undo takes the whole typing as one. */
const MAX_KEPT = 200

/** Where in the box an offset into the words is: in the text node that holds it, or before the mark that ends a last empty line. */
function positionAt(root: HTMLElement, offset: number): { node: globalThis.Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let at = 0
  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    const length = text.data.length
    // At the end of a line break, the caret is at the start of what follows.
    if (offset < at + length || (offset === at + length && !text.data.endsWith('\n'))) return { node: text, offset: offset - at }
    at += length
  }
  const end = root.querySelector('br[data-end]')
  return end ? { node: root, offset: Array.prototype.indexOf.call(root.childNodes, end) } : { node: root, offset: root.childNodes.length }
}

/** The offset into the words of a place in the box. */
function offsetOf(root: HTMLElement, node: globalThis.Node, offset: number): number {
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

/** The CSS of a run of the words, at the size they are seen at. */
function runCss(style: TextStyle, size: number, color: (value: string) => string): Partial<CSSStyleDeclaration> {
  const lines = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  return {
    fontSize: style.scale === undefined ? '' : `${size * style.scale}px`,
    fontWeight: style.bold === undefined ? '' : style.bold ? 'bold' : 'normal',
    fontStyle: style.italic ? 'italic' : '',
    textDecoration: lines,
    color: style.color === undefined ? '' : color(style.color),
  }
}

/**
 * A text typed in place with its words set apart: an editable box drawn from the text and its
 * spans, in which every change is made to the words and drawn again (typing, deleting, a new
 * line, pasting plain words), so that what the box holds is always what the drawing will. Only
 * what an input method composes (Chinese, Japanese…) is left to the browser, and read back from
 * the box once composed. The selection is kept as offsets into the words (`textFormat.ts`),
 * which the format bar and the commands act on.
 */
function RichTextEditor({ node, create }: { node: NodeOf<'text'>; create?: NodeInput }) {
  const view = useStore((s) => s.view)
  const doc = useStore((s) => s.doc)
  const darkCanvas = useTheme((s) => s.darkCanvas)
  const root = useRef<HTMLDivElement>(null)
  const words = useRef<Words>({ text: node.text, spans: node.spans })
  const past = useRef<Kept[]>([])
  const future = useRef<Kept[]>([])
  /** What the last change was, so that letters typed one after another are undone together. */
  const lastChange = useRef<string | null>(null)
  const composing = useRef(false)
  /** What the format bar changed of the whole text. */
  const extra = useRef<TextNodePatch>({})

  const size = node.size * view.zoom
  const layerColor = resolveColor(doc, node.layer === undefined ? undefined : doc.layers[node.layer]?.color)
  const inkOf = (value: string | undefined) => {
    const color = resolveColor(doc, value, layerColor ?? '#1f1f1f') ?? layerColor ?? '#1f1f1f'
    return darkCanvas ? darkInk(color, true) : color
  }
  const look = useRef({ size, inkOf })
  look.current = { size, inkOf }

  // The selection as it is now: read from the box while it has the focus, since the browser tells
  // of a change of selection only later (`selectionchange`), after keys pressed quickly may have
  // acted on it; otherwise (a field of the bar has the focus) as it was kept.
  const selection = () => {
    const box = root.current
    const sel = document.getSelection()
    if (box && document.activeElement === box && sel && sel.rangeCount > 0 && box.contains(sel.anchorNode) && box.contains(sel.focusNode)) {
      const anchor = offsetOf(box, sel.anchorNode!, sel.anchorOffset)
      const head = offsetOf(box, sel.focusNode!, sel.focusOffset)
      const kept = useTextFormat.getState()
      if (kept.anchor !== anchor || kept.head !== head) useTextFormat.setState({ anchor, head, pending: null })
    }
    const { anchor, head } = useTextFormat.getState()
    return { anchor, head, from: Math.min(anchor, head), to: Math.max(anchor, head) }
  }

  const select = (anchor: number, head: number) => {
    const box = root.current
    if (!box) return
    const length = words.current.text.length
    const [a, h] = [Math.min(Math.max(0, anchor), length), Math.min(Math.max(0, head), length)]
    useTextFormat.setState({ anchor: a, head: h })
    if (document.activeElement !== box) return
    const start = positionAt(box, a)
    const end = positionAt(box, h)
    document.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset)
  }

  /** Draws the words into the box again, from the text and its spans. */
  const render = () => {
    const box = root.current
    if (!box) return
    const { text, spans } = words.current
    const { size, inkOf } = look.current
    const children: globalThis.Node[] = []
    // Each line is held at the height the canvas draws it at (`textNodePrimitives`): its letters
    // take no room of their own (line-height 0), and a prop at its start, drawn by the line break
    // before it (the box itself for the first), reaches as high above the baseline as the line's
    // largest letters and a quarter of them below it. From one baseline to the next is then what
    // the canvas puts between them, whatever the font says of its own heights.
    const prop = (element: HTMLElement, tallest: number) => {
      element.style.setProperty('--up', `${tallest * size}px`)
      element.style.setProperty('--down', `${tallest * size * 0.25}px`)
    }
    styledLines(text, spans).forEach((line, i) => {
      const tallest = line.length === 0 ? 1 : Math.max(...line.map((run) => run.style.scale ?? 1))
      if (i === 0) prop(box, tallest)
      else {
        const lineBreak = document.createElement('span')
        lineBreak.className = 'line-break'
        lineBreak.textContent = '\n'
        prop(lineBreak, tallest)
        children.push(lineBreak)
      }
      for (const run of line) {
        const span = document.createElement('span')
        span.textContent = run.text
        Object.assign(span.style, runCss(run.style, size, inkOf))
        children.push(span)
      }
    })
    // An empty last line has nothing to hold the caret: a line break that is not part of the words does.
    if (text === '' || text.endsWith('\n')) {
      const end = document.createElement('br')
      end.dataset.end = ''
      children.push(end)
    }
    box.replaceChildren(...children)
  }

  /** Shows the words as they are now in the drawing: the text added, or changed. */
  const show = () => {
    const { text, spans } = words.current
    // What the bar set for the whole text goes with the words: a preview replaces the one before.
    const { color, ...whole } = extra.current
    const added = Object.fromEntries(Object.entries(whole).filter(([, value]) => value !== null))
    // Its own colour is its style's stroke; none is its layer's.
    const styled = (style: Record<string, unknown> | undefined) => {
      const { stroke: _, ...others } = style ?? {}
      const next = color ? { ...others, stroke: color } : others
      return Object.keys(next).length > 0 ? next : undefined
    }
    const recoloured = color === undefined ? {} : { style: styled(create ? (create.style as Record<string, unknown> | undefined) : node.style) ?? null }
    preview([
      create
        ? { op: 'add_node', node: { ...create, ...added, ...(color === undefined ? {} : { style: styled(create.style as Record<string, unknown> | undefined) }), text, ...(spans ? { spans } : {}) } as NodeInput }
        : { op: 'update_node', id: node.id, patch: { ...whole, ...recoloured, text, spans: spans ?? null } },
    ])
  }

  /** Changes the words, keeping what they were for the editor's undo, and puts the selection where it ends. */
  const change = (next: Words, anchor: number, head: number, kind: string | null = null) => {
    const before = selection()
    // Letters typed one after another are one step; a space ends it, as in a word processor.
    if (kind === null || kind !== lastChange.current) {
      past.current.push({ ...words.current, anchor: before.anchor, head: before.head, extra: extra.current })
      if (past.current.length > MAX_KEPT) past.current.shift()
    }
    future.current = []
    lastChange.current = kind
    words.current = next
    render()
    show()
    select(anchor, head)
  }

  /** Puts `inserted` in place of what is selected, or of `from`-`to`, in the style waiting for it if there is one. */
  const insert = (inserted: string, from = selection().from, to = selection().to, kind: string | null = null) => {
    const { pending } = useTextFormat.getState()
    const next = replaceText(words.current.text, words.current.spans, from, to, inserted, pending ?? undefined)
    change(next, from + inserted.length, from + inserted.length, kind)
    useTextFormat.setState({ pending: null })
  }

  const restore = (from: Kept[], to: Kept[]) => {
    const step = from.pop()
    if (!step) return
    const now = selection()
    to.push({ ...words.current, anchor: now.anchor, head: now.head, extra: extra.current })
    lastChange.current = null
    words.current = { text: step.text, spans: step.spans }
    extra.current = step.extra
    render()
    show()
    select(step.anchor, step.head)
  }

  /**
   * Whether the focus is in a window opened from the bar (a colour's): it stays there until the
   * window closes, which gives it back. Taken from it during a key, it would take the key with it:
   * Enter typed in the colour code wrote a new line in place of the words selected.
   */
  const inWindow = () => document.activeElement instanceof Element && document.activeElement.closest(`.${FLOATING}`) !== null

  const editor: RichEditor = {
    format(styleChange: StyleChange) {
      const { from, to, anchor, head } = selection()
      if (from === to) {
        // Nothing selected: what is typed next takes it.
        const base = useTextFormat.getState().pending ?? styleAt(words.current.text, words.current.spans, from)
        const pending: Record<string, unknown> = { ...base }
        for (const [key, value] of Object.entries(styleChange)) {
          if (value === null || value === undefined) delete pending[key]
          else pending[key] = value
        }
        useTextFormat.setState({ pending: pending as TextStyle })
        return inWindow() ? undefined : this.focus()
      }
      change({ text: words.current.text, spans: formatSpans(words.current.text, words.current.spans, from, to, styleChange) }, anchor, head)
    },
    toggle(key) {
      const { from, to } = selection()
      const pending = useTextFormat.getState().pending
      const style = from === to && pending ? pending : commonStyle(words.current.text, words.current.spans, from, to)
      const on = style[key] ?? (key === 'bold' ? !!node.bold : false)
      // Off where the whole text is bold says so; elsewhere off is no setting at all.
      this.format({ [key]: on ? (key === 'bold' && node.bold ? false : null) : true })
    },
    grow(factor) {
      const { from, to, anchor, head } = selection()
      if (from === to) {
        const style = useTextFormat.getState().pending ?? styleAt(words.current.text, words.current.spans, from)
        return this.format({ scale: (style.scale ?? 1) * factor })
      }
      // Each part keeps its size against the others.
      const { text } = words.current
      const styles = charStyles(text.length, words.current.spans).map((style, i) => (i >= from && i < to ? { ...style, scale: (style.scale ?? 1) * factor } : style))
      const spans = spansOf(styles)
      change({ text, spans: spans.length > 0 ? spans : undefined }, anchor, head)
    },
    setNode(patch) {
      const now = selection()
      past.current.push({ ...words.current, anchor: now.anchor, head: now.head, extra: extra.current })
      if (past.current.length > MAX_KEPT) past.current.shift()
      future.current = []
      lastChange.current = null
      extra.current = { ...extra.current, ...patch }
      show()
      this.focus()
    },
    colorAll(color) {
      const { anchor, head } = selection()
      // One step: the words lose their colours, then the text takes its own.
      const { text, spans } = words.current
      change({ text, spans: text.length > 0 ? formatSpans(text, spans, 0, text.length, { color: null }) : spans }, anchor, head)
      extra.current = { ...extra.current, color }
      show()
      // Picked in the colour window, which gives the focus back to the words when it closes.
      if (!inWindow()) this.focus()
    },
    undo() {
      restore(past.current, future.current)
      this.focus()
    },
    redo() {
      restore(future.current, past.current)
      this.focus()
    },
    plain() {
      const { from, to, anchor, head } = selection()
      const all = Object.fromEntries(TEXT_STYLE_KEYS.map((key) => [key, null])) as StyleChange
      if (from === to) {
        useTextFormat.setState({ pending: {} })
        return this.focus()
      }
      change({ text: words.current.text, spans: formatSpans(words.current.text, words.current.spans, from, to, all) }, anchor, head)
    },
    write(text) {
      this.focus()
      insert(text)
    },
    focus() {
      const box = root.current
      if (!box) return
      if (document.activeElement !== box) box.focus({ preventScroll: true })
      const { anchor, head } = useTextFormat.getState()
      select(anchor, head)
    },
  }
  const handle = useRef(editor)
  handle.current = editor

  // The editor is reachable for as long as it is open, by a handle that always calls what it is now.
  useLayoutEffect(() => {
    const reach: RichEditor = {
      format: (c) => handle.current.format(c),
      toggle: (k) => handle.current.toggle(k),
      grow: (f) => handle.current.grow(f),
      plain: () => handle.current.plain(),
      setNode: (patch) => handle.current.setNode(patch),
      colorAll: (color) => handle.current.colorAll(color),
      undo: () => handle.current.undo(),
      redo: () => handle.current.redo(),
      write: (text) => handle.current.write(text),
      focus: () => handle.current.focus(),
    }
    const length = words.current.text.length
    useTextFormat.setState({ editor: reach, anchor: 0, head: length, pending: null })
    render()
    // Focused as soon as it shows, all its words selected, so that what is typed at once goes into
    // it rather than to the shortcuts; the canvas keeps the click that placed it from taking the
    // focus back (its `onMouseDown`). Again once that click has finished, in case.
    const focus = () => {
      if (document.activeElement === root.current) return
      root.current?.focus({ preventScroll: true })
      select(0, length)
    }
    focus()
    const timer = setTimeout(focus)
    return () => {
      clearTimeout(timer)
      useTextFormat.setState({ editor: null, pending: null })
    }
  }, [])

  // Drawn again at the size and in the colours it is seen at.
  useLayoutEffect(() => {
    if (composing.current) return
    const { anchor, head } = useTextFormat.getState()
    render()
    select(anchor, head)
  }, [size, darkCanvas, doc.colors, layerColor])

  // The selection, followed as it changes, by the keyboard or the pointer. A caret moved elsewhere drops the style waiting to be typed.
  useEffect(() => {
    const onSelection = () => {
      const box = root.current
      const sel = document.getSelection()
      if (!box || !sel || sel.rangeCount === 0 || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) return
      const anchor = offsetOf(box, sel.anchorNode!, sel.anchorOffset)
      const head = offsetOf(box, sel.focusNode!, sel.focusOffset)
      const now = useTextFormat.getState()
      if (now.anchor === anchor && now.head === head) return
      lastChange.current = null
      useTextFormat.setState({ anchor, head, pending: null })
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  // Every change the browser would make itself is made to the words instead.
  useEffect(() => {
    const box = root.current
    if (!box) return
    const targetRange = (e: InputEvent): { from: number; to: number } | null => {
      const [range] = e.getTargetRanges?.() ?? []
      if (!range) return null
      const a = offsetOf(box, range.startContainer, range.startOffset)
      const b = offsetOf(box, range.endContainer, range.endOffset)
      return { from: Math.min(a, b), to: Math.max(a, b) }
    }
    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || e.inputType === 'insertCompositionText') return
      e.preventDefault()
      const { from, to } = selection()
      const text = words.current.text
      switch (e.inputType) {
        case 'insertText':
        case 'insertReplacementText': {
          const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
          const range = e.inputType === 'insertReplacementText' ? targetRange(e) : null
          return insert(data, range?.from ?? from, range?.to ?? to, e.inputType === 'insertText' && data !== ' ' ? 'type' : null)
        }
        case 'insertParagraph':
        case 'insertLineBreak':
          return insert('\n')
        case 'insertFromPaste':
        case 'insertFromDrop':
          return insert((e.dataTransfer?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n'))
        case 'historyUndo':
          return restore(past.current, future.current)
        case 'historyRedo':
          return restore(future.current, past.current)
        case 'formatBold':
          return handle.current.toggle('bold')
        case 'formatItalic':
          return handle.current.toggle('italic')
        case 'formatUnderline':
          return handle.current.toggle('underline')
        case 'formatStrikeThrough':
          return handle.current.toggle('strike')
        default:
          if (!e.inputType.startsWith('delete')) return
          {
            const range = targetRange(e)
            let [a, b] = range && range.from !== range.to ? [range.from, range.to] : [from, to]
            if (a === b) {
              // Nothing said: a letter before or after, both halves of one written in two.
              const back = e.inputType.endsWith('Backward')
              if (back && a > 0) a -= /[\udc00-\udfff]/.test(text[a - 1]) && a > 1 ? 2 : 1
              else if (!back && b < text.length) b += /[\ud800-\udbff]/.test(text[b]) ? 2 : 1
            }
            if (a !== b) insert('', a, b, e.inputType === 'deleteContentBackward' ? 'delete' : null)
          }
      }
    }
    // What an input method composed is in the box already: read back, in the style of where it was typed.
    const onCompositionStart = () => {
      composing.current = true
    }
    const onCompositionEnd = () => {
      composing.current = false
      const sel = document.getSelection()
      const caret = sel && sel.rangeCount > 0 && box.contains(sel.focusNode) ? offsetOf(box, sel.focusNode!, sel.focusOffset) : null
      const typed = Array.from(box.childNodes, (child) => (child instanceof HTMLElement && child.dataset.end !== undefined ? '' : (child.textContent ?? ''))).join('')
      if (typed === words.current.text) return
      const spans = respan(words.current.text, typed, words.current.spans)
      const at = caret ?? typed.length
      change({ text: typed, spans }, at, at)
    }
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      insert((e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n'))
    }
    const onCopy = (e: ClipboardEvent) => {
      const { from, to } = selection()
      if (from === to) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', words.current.text.slice(from, to))
      if (e.type === 'cut') insert('', from, to)
    }
    box.addEventListener('beforeinput', onBeforeInput)
    box.addEventListener('compositionstart', onCompositionStart)
    box.addEventListener('compositionend', onCompositionEnd)
    box.addEventListener('paste', onPaste)
    box.addEventListener('copy', onCopy)
    box.addEventListener('cut', onCopy)
    // A drop would bring in what the browser makes of it; pasting is the way.
    const noDrop = (e: DragEvent) => e.preventDefault()
    box.addEventListener('drop', noDrop)
    return () => {
      box.removeEventListener('beforeinput', onBeforeInput)
      box.removeEventListener('compositionstart', onCompositionStart)
      box.removeEventListener('compositionend', onCompositionEnd)
      box.removeEventListener('paste', onPaste)
      box.removeEventListener('copy', onCopy)
      box.removeEventListener('cut', onCopy)
      box.removeEventListener('drop', noDrop)
    }
  }, [])

  // The focus going anywhere but into the box, the format bar or a window opened from it ends the typing.
  useEffect(() => {
    const ours = (target: EventTarget | null) => target instanceof Element && (root.current?.contains(target) || target.closest(`.${TEXT_FORMAT_BAR}, .${FLOATING}`) !== null)
    const onFocusIn = (e: FocusEvent) => {
      if (!ours(e.target)) finishTextEdit()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // The first line stands as high above the anchor as its largest letters.
  const [first] = styledLines(words.current.text, words.current.spans)
  const tallest = first && first.length > 0 ? Math.max(...first.map((run) => run.style.scale ?? 1)) : 1
  // The first baseline is as far below the top of the box as the prop of the first line reaches above it (`render`).
  const ascent = size * tallest
  return (
    <>
      <div
        ref={root}
        className="text-editor rich"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        style={{
          left: node.x * view.zoom + view.x,
          top: node.y * view.zoom + view.y - ascent,
          font: `${size}px/0 ${node.font ?? FONT}`,
          color: inkOf(node.style?.stroke),
          fontWeight: node.bold ? 'bold' : undefined,
          textAlign: node.align,
          transform: [node.rotation ? `rotate(${node.rotation}deg)` : '', node.align === 'right' ? 'translateX(-100%)' : node.align === 'center' ? 'translateX(-50%)' : ''].filter(Boolean).join(' ') || undefined,
          transformOrigin: `0 ${ascent}px`,
        }}
        onBlur={(e) => {
          // Into the format bar, or a window of it (a colour), the typing goes on.
          const to = e.relatedTarget
          if (to instanceof Element && to.closest(`.${TEXT_FORMAT_BAR}, .${FLOATING}`)) return
          finishTextEdit()
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey
          const key = e.key.toLowerCase()
          if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
            e.preventDefault()
            finishTextEdit()
          } else if (mod && !e.altKey && (key === 'z' || key === 'y')) {
            // Back through the typing, a word at a time, and forward again: the browser keeps no
            // history of words it never changed itself (every change is made to the words, `insert`).
            e.preventDefault()
            if (key === 'y' || e.shiftKey) handle.current.redo()
            else handle.current.undo()
          } else {
            // Setting words apart (Ctrl+B…) is a command, whatever key it was given.
            const command = commandFor(e.nativeEvent)
            if (command?.id.startsWith('text.')) {
              e.preventDefault()
              execute(command)
            }
          }
          // Keep typing from reaching the canvas and command shortcuts.
          e.stopPropagation()
        }}
      />
      <TextFormatBar node={node} box={root} />
    </>
  )
}

