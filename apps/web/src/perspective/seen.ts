import { useEffect, useRef, useState } from 'react'
import { FRAME_SHAPE, frameHeight, leavesOf, lookedAt, massing, rootOf, type Bounds, type Camera, type Document, type Solid } from '@opencalque/core'
import { registry, useExtensions } from '../extensions'
import type { Prefs } from '../prefs'
import { useStore } from '../store'
import type { View } from '../view'

/*
 * What a viewpoint sees (ARCHITECTURE, "Viewpoints"), followed as the plan changes, for its frame on
 * the plan and for the Perspective panel: the plan raised to its heights (`massing`), again only
 * when more than the viewpoints changed, so that turning one, or raising its eye, keeps what it
 * looks at. The plan edited, the views wait: while something is dragged on it, not at all; once it
 * is let go, one view after another, when the editor has nothing else to do (`later`), so that the
 * plan stays smooth however many views are in sight. A viewpoint moved on the plan is followed as it
 * moves, a few times a second.
 */

/** How long a viewpoint moved on the plan waits between two times its view follows it, in ms. */
const MOVED_WAIT = 100
/** The longest an edited plan waits for the editor to be idle before its views follow it anyway, in ms. */
const IDLE_AT_MOST = 400

/** Work to do one piece at a time when the editor is idle: the views of an edited plan, raised again. */
const waiting: (() => void)[] = []
let waking = false
export function later(job: () => void): void {
  if (!waiting.includes(job)) waiting.push(job)
  wake()
}
function wake(): void {
  if (waking || waiting.length === 0) return
  waking = true
  const one = () => {
    waking = false
    waiting.shift()?.()
    wake()
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(one, { timeout: IDLE_AT_MOST })
  else setTimeout(one, 50)
}

export type Look = Prefs['perspective']['look']

/** Whether nothing but viewpoints changed from one set of nodes to the next: what they see then stands as it was. */
function onlyViewpointsMoved(before: Document['nodes'], after: Document['nodes']): boolean {
  if (before === after) return true
  const keys = Object.keys(after)
  if (keys.length !== Object.keys(before).length) return false
  return keys.every((id) => before[id] === after[id] || (after[id].type === 'camera' && before[id]?.type === 'camera'))
}

/** The plan as `camera` sees it, raised from the drawing as it was then; null until it is, or while `active` is false. */
export function useSeen(camera: Camera | null, active: boolean): { doc: Document; solids: Solid[] } | null {
  const doc = useStore((s) => s.doc)
  const extensions = useExtensions((s) => s.version)
  const editing = useStore((s) => s.base !== null)
  // The plan it looks at: its own page's, or the one it says when its view is shown on another.
  const page = camera ? rootOf(doc, lookedAt(doc, camera)) : null
  const [seen, setSeen] = useState<{ doc: Document; solids: Solid[] } | null>(null)
  const raised = useRef<{ nodes: Document['nodes']; key: unknown[]; solids: Solid[] } | null>(null)
  // The raising to do next, the latest plan's: what a wait under way, or the idle queue, runs.
  const next = useRef<(() => void) | null>(null)
  const run = useRef(() => {
    const job = next.current
    next.current = null
    job?.()
  })
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!camera || !page || !active) return
    const key = [doc.layers, page.id, camera.a.x, camera.a.y, extensions]
    const last = raised.current
    const viewpoints = last !== null && last.key[0] === key[0] && last.key[1] === key[1] && last.key[4] === key[4] && onlyViewpointsMoved(last.nodes, doc.nodes)
    if (last && viewpoints && last.key.every((k, i) => k === key[i])) {
      last.nodes = doc.nodes
      setSeen({ doc, solids: last.solids })
      return
    }
    next.current = () => {
      const solids = massing(doc, page.id, registry, [camera.a], camera.a)
      raised.current = { nodes: doc.nodes, key, solids }
      setSeen({ doc, solids })
    }
    // The first time: when the editor is idle, not in the middle of what brought it into sight (a zoom).
    if (!last) return later(run.current)
    if (viewpoints) {
      // Its viewpoint moved on the plan: followed as it moves.
      if (timer.current === null)
        timer.current = window.setTimeout(() => {
          timer.current = null
          run.current()
        }, MOVED_WAIT)
      return
    }
    // The plan edited: not while it is dragged, and then when the editor is idle.
    if (!editing) later(run.current)
  }, [doc, page?.id, camera?.a.x, camera?.a.y, extensions, editing, active])
  useEffect(
    () => () => {
      window.clearTimeout(timer.current ?? undefined)
      next.current = null
    },
    [],
  )
  return seen
}

/** The viewpoints of the page `scope` is on, in the order of the drawing. */
export function camerasOf(doc: Document, scope: string): Camera[] {
  // Inside an elevation or a section, what is shown is in its coordinates: no 3D view is placed there.
  if (doc.nodes[scope]?.type === 'elevation') return []
  const page = rootOf(doc, scope)
  return page ? leavesOf(doc, page.id).filter((n): n is Camera => n.type === 'camera') : []
}

/** Where a viewpoint's view is shown on its page, and how large: its own frame, or the one it is given beside the plan when it has none. */
export function frameShown(doc: Document, camera: Camera): Frame {
  return framesOf(doc, camera.frame ? [camera] : camerasOf(doc, camera.parent ?? '')).get(camera.id) ?? { x: 0, y: 0, width: 4000, height: Math.round(4000 / FRAME_SHAPE) }
}

/** A frame on the page, in mm: its top left corner, its width and its height, which give the shape of its picture. */
export type Frame = Required<NonNullable<Camera['frame']>>

/** How much of what is on screen a new viewpoint's view takes across, and how far it keeps from its edges, in pixels. */
const NEW_SHARE = 0.34
const NEW_MARGIN = { right: 24, top: 56 }

/** Where a viewpoint drawn now puts its view: in the upper right of what is on screen, a third of its width. */
export function newFrame(view: View, viewport: { width: number; height: number }): Frame | undefined {
  if (viewport.width <= 0) return undefined
  const width = (viewport.width * NEW_SHARE) / view.zoom
  const right = (viewport.width - NEW_MARGIN.right - view.x) / view.zoom
  const top = (NEW_MARGIN.top - view.y) / view.zoom
  return { x: Math.round(right - width), y: Math.round(top), width: Math.round(width), height: Math.round(width / FRAME_SHAPE) }
}

/** How far from the plan, and from one another, the views of viewpoints with no frame of their own are put, in mm. */
const BESIDE = 1000

/**
 * Where each viewpoint's view is on the page: its own frame, or for one with none (from a file, or
 * an agent), beside the plan, to the right of its walls, one under the other.
 */
export function framesOf(doc: Document, cameras: Camera[]): Map<string, Frame> {
  const out = new Map<string, Frame>()
  const loose = cameras.filter((c) => !c.frame)
  let box: Bounds | null = null
  if (loose.length > 0) {
    const page = rootOf(doc, loose[0].parent)
    const points = page ? leavesOf(doc, page.id).flatMap((n) => (n.type === 'wall' ? [n.a, n.b] : [])) : []
    const all = points.length > 0 ? points : loose.flatMap((c) => [c.a, c.b])
    box = { minX: Math.min(...all.map((p) => p.x)), minY: Math.min(...all.map((p) => p.y)), maxX: Math.max(...all.map((p) => p.x)), maxY: Math.max(...all.map((p) => p.y)) }
  }
  const width = box ? Math.min(12000, Math.max(3000, (box.maxX - box.minX) * 0.6)) : 4000
  let y = box ? box.minY : 0
  for (const camera of cameras) {
    if (camera.frame) out.set(camera.id, { ...camera.frame, height: frameHeight(camera.frame) })
    else {
      const height = Math.round(width / FRAME_SHAPE)
      out.set(camera.id, { x: (box?.maxX ?? 0) + BESIDE, y, width, height })
      y += height + BESIDE
    }
  }
  return out
}
