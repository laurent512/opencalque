import { useEffect, useRef } from 'react'
import { annotationText, type Node, type NodeInput } from '@opencalque/core'
import { finishTextEdit } from './actions'
import { preview, useStore } from './store'

/** The font the canvas draws text in when a text has none of its own. */
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** Where and how the words of a node that has some are drawn: a text, or the note of an annotation. */
function wording(node: Node | undefined): { x: number; y: number; size: number; text: string; rotation?: number; right?: boolean; font?: string; bold?: boolean; align?: 'left' | 'center' | 'right' } | null {
  if (node?.type === 'text') return node
  if (node?.type === 'annotation') return { ...annotationText(node), text: node.text, font: node.font }
  return null
}

/**
 * Words being typed in place. A box sits exactly where they are drawn, at the same size, while
 * the canvas leaves them out; every keystroke goes into the drawing, so what is typed is what is
 * there. Enter starts a new line; Esc, Ctrl+Enter or a click elsewhere ends the typing. What is
 * shown while typing is the text as written, with its fields ({date}, {page}…) not yet filled in.
 */
export function TextEditor() {
  const editing = useStore((s) => s.editingText)
  const node = useStore((s) => (s.editingText ? s.doc.nodes[s.editingText.id] : undefined))
  const view = useStore((s) => s.view)
  const input = useRef<HTMLTextAreaElement>(null)

  // Focus after the click that placed the text has finished, or the browser takes focus back.
  useEffect(() => {
    if (!editing) return
    const timer = setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    })
    return () => clearTimeout(timer)
  }, [editing?.id])

  const words = wording(node)
  if (!editing || !node || !words) return null
  const size = words.size * view.zoom
  const lines = words.text.split('\n')
  const write = (text: string) =>
    preview([editing.create ? { op: 'add_node', node: { ...editing.create, text } as NodeInput } : { op: 'update_node', id: editing.id, patch: { text } }])

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
        color: node.style?.stroke ?? undefined,
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
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finishTextEdit()
        }
        // Keep typing from reaching the canvas and command shortcuts.
        e.stopPropagation()
      }}
    />
  )
}
