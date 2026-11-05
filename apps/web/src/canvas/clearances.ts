import { useMemo } from 'react'
import { clearances, type Clearance, type Node, type Vec2 } from '@opencalque/core'
import { registry, useExtensions } from '../extensions'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { formatLength } from '../units'
import type { View } from '../view'

/*
 * Temporary dimensions: how far the one object selected stands from the walls around it (the core's
 * `clearances`), drawn while it is selected and nothing is being dragged, each with its length in a
 * box that a click opens to type another (`ClearanceEditor`).
 */

/** The temporary dimensions shown now, with the object they measure; null when none are. */
export function useClearances(): { node: Node; list: Clearance[] } | null {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  // Not while something is dragged, drawn or typed: they would jump about, and take the place of what is measured then.
  const shown = useStore((s) => s.tool === 'select' && s.base === null && s.editingText === null && s.selection.length === 1)
  const on = usePrefs((s) => s.showClearances)
  const extensions = useExtensions((s) => s.version)
  return useMemo(() => {
    const node = shown && on ? doc.nodes[selection[0]] : undefined
    const list = node ? clearances(doc, node, registry) : []
    return node && list.length > 0 ? { node, list } : null
  }, [doc, selection, shown, on, extensions])
}

/** Where the length of a temporary dimension is written on screen: a box round its middle. */
export function clearanceLabel(clearance: Clearance, view: View): { x: number; y: number; width: number; height: number; text: string } {
  const text = formatLength(clearance.length)
  const middle: Vec2 = { x: (clearance.from.x + clearance.to.x) / 2, y: (clearance.from.y + clearance.to.y) / 2 }
  const width = Math.max(28, text.length * 6.5 + 10)
  return { x: middle.x * view.zoom + view.x - width / 2, y: middle.y * view.zoom + view.y - 9, width, height: 18, text }
}
