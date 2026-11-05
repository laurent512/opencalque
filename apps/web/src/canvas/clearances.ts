import { useMemo } from 'react'
import { clearances, type Clearance, type Node, type Registry, type Vec2 } from '@opencalque/core'
import { registry, useExtensions } from '../extensions'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { formatLength } from '../units'
import type { View } from '../view'

/*
 * Temporary dimensions: how far the one object selected stands from the walls around it (the core's
 * `clearances`), drawn while it is selected and nothing is being dragged, each with its length in a
 * box that a click opens to type another (`ClearanceEditor`). Only those that say something are
 * shown, where they can be read (`shownClearances`).
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

/** A box on screen, in pixels. */
export interface ScreenBox {
  x: number
  y: number
  width: number
  height: number
  text?: string
}

/**
 * How far from a wall an object that is not a wall, a door or a window is still measured: farther,
 * across a room, the distance says nothing of where it stands. A wall is measured to the wall it
 * faces whatever the distance (the width of a room), a door along its wall to the next.
 */
export const FAR = 2000

/** The gap kept between a length and what it must not cover, in pixels. */
const GAP = 4

const overlaps = (a: ScreenBox, b: ScreenBox) => a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP

/** Where the length of a temporary dimension is written on screen: a box round `at`, the middle of its line unless given. */
export function clearanceLabel(clearance: Clearance, view: View, at?: Vec2): ScreenBox & { text: string } {
  const text = formatLength(clearance.length)
  const middle: Vec2 = at ?? { x: (clearance.from.x + clearance.to.x) / 2, y: (clearance.from.y + clearance.to.y) / 2 }
  const width = Math.max(28, text.length * 6.5 + 10)
  return { x: middle.x * view.zoom + view.x - width / 2, y: middle.y * view.zoom + view.y - 9, width, height: 18, text }
}

/**
 * The temporary dimensions worth showing for `node`, each with where its length is written: those
 * of an object that is not a wall, a door or a window reach no farther than `FAR`, and a length is
 * never written over the object, over its sizes (`avoid`) or over another length. One that does not
 * fit in the middle of its line goes past the wall it reaches, then beside its line; one that fits
 * nowhere is left out, line and all.
 */
export function shownClearances(node: Node, list: Clearance[], view: View, avoid: ScreenBox[], kinds: Registry = registry): { from: Vec2; to: Vec2; label: ScreenBox & { text: string } }[] {
  const opening = node.type === 'parametric' && !!kinds.parametric.get(node.kind)?.opening
  const near = node.type === 'wall' || opening ? list : list.filter((clearance) => clearance.length <= FAR)
  const taken = [...avoid]
  return near.flatMap((clearance) => {
    const { from, to } = clearance
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    const box = clearanceLabel(clearance, view)
    // Past the wall reached, by half the box along the line and a gap; beside the line, either way.
    const reach = (Math.abs(along.x) * box.width + Math.abs(along.y) * box.height) / 2 + GAP * 2
    const past = { x: to.x + (along.x * reach) / view.zoom, y: to.y + (along.y * reach) / view.zoom }
    const side = (Math.abs(along.y) * box.width + Math.abs(along.x) * box.height) / 2 + GAP * 2
    const beside = [1, -1].map((sign) => ({ x: middle.x - (along.y * side * sign) / view.zoom, y: middle.y + (along.x * side * sign) / view.zoom }))
    const label = [middle, past, ...beside].map((at) => clearanceLabel(clearance, view, at)).find((place) => !taken.some((other) => overlaps(place, other)))
    if (!label) return []
    taken.push(label)
    return [{ from, to, label }]
  })
}
