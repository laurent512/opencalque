import type { Node, ResizeFrame, SceneItem, Snap, Vec2 } from '@opencalque/core'
import { cancel, useStore, type View } from '../store'
import type { AngleMark, Overlay, SizeLabel } from './draw'
import type { Gesture, GestureOf, Keys, PointerAt } from './gesture'

/** The frame a single box-shaped object (a rectangle, an ellipse) is resized by: its eight grips, and where its knob is. */
export interface BoxFrame {
  node: Node
  box: ResizeFrame
  grips: Vec2[]
  corners: Vec2[]
  centre: Vec2
  up: Vec2
}

/** The name of a paper, written above its corner. */
export interface PaperTitle {
  id: string
  at: Vec2
  text: string
  selected: boolean
}

/** The outline of a modifier of the selected object; `handles` when its corners can be dragged. */
export interface ModifierOutline {
  index: number
  outline: Vec2[]
  handles: boolean
}

/**
 * What the canvas keeps between events, and what the gestures (`gestures/`) work with. It is one
 * object for the life of the canvas: the component refreshes what it works out at each render
 * (the scene, the handles and frames of the selection), and the gestures read it from here.
 */
export interface Canvas {
  /** The interaction in progress. */
  gesture: Gesture
  /** A view being dragged, tracked apart from the gesture so that panning can interrupt a drawing without losing it. */
  pan: { at: Vec2; view: View } | null
  lastPointer: PointerAt | null
  /** Where the pointer last was, for finishing a shape from the keyboard. */
  lastWorld: { world: Vec2 } & Keys
  space: boolean
  /** When Space went down, and whether the view was dragged with it: let go quickly, unused, it was a tap. */
  spaceTap: { at: number; used: boolean } | null
  /** A run of walls just ended by clicking its last corner again, which the double-click of the system may still close. */
  ended: { start: Vec2; origin: Vec2; time: number } | null
  /** Where on the screen the last click of a drawing landed, before snapping moved its point. */
  lastClick: Vec2 | null
  /** A line of several segments just ended by clicking its last point again, which the double-click of the system may still close. */
  endedLine: { id: string; time: number } | null
  /** Id of the object following the cursor while the place tool is active. */
  placed: string
  /** The points the pointer rested on lately with a tool, the latest first, which what it draws lines up with (`snap`), and the one it rests on now. */
  tracked: { tool: string; points: Vec2[]; resting: { p: Vec2; since: number } | null }

  /** What the canvas shows, as worked out for the latest render. */
  scene: SceneItem[]
  titles: PaperTitle[]
  frames: ModifierOutline[]
  /** The handles of the one selected object. */
  handles: Vec2[]
  frame: BoxFrame | null
  /** The box around one selected object that turns but has no frame (a text, a picture, a compass). */
  ownBox: ResizeFrame | null
  /** Where the lengths of the temporary dimensions are written on screen, in their order, for a click to open one. */
  clearanceLabels: { x: number; y: number; width: number; height: number }[]
  /** The pointer shown over a grip, so it says what dragging there does. */
  gripCursor: string | null

  element(): HTMLCanvasElement
  setOverlay(overlay: Overlay | ((o: Overlay) => Overlay)): void
  setGripCursor(cursor: string | null): void
}

/** What a movement of the pointer shows: filled in by the gesture, then laid on the canvas and the status bar. */
export interface Shown {
  marker: Snap | null
  smart?: Overlay['smart']
  link?: Overlay['link']
  labels?: SizeLabel[]
  /** The temporary dimension whose length the pointer is on, by its place in the list shown. */
  clearanceHover?: number
  angle?: AngleMark
  axis?: Overlay['axis']
  guide?: Overlay['guide']
  ghosts?: Overlay['ghosts']
  live: { a: number; b: number } | null
  measure?: Overlay['measure']
  cut?: Overlay['cut']
  trim?: Overlay['trim']
  lit?: Overlay['lit']
  angleReading?: Overlay['angleReading']
  face?: Overlay['face']
  turning?: Overlay['box']
  marquee?: Overlay['marquee']
  status: string
  /** False when a preview failed, which has put its reason in the status bar. */
  previewed: boolean
}

/** A press of the main button with a tool, at `at` on the canvas and `world` in the drawing. */
export type Press = (c: Canvas, e: PointerAt, at: Vec2, world: Vec2) => void
/** The pointer moved during a gesture of kind K (or with none, `idle`). */
export type Move<K extends Gesture['kind']> = (c: Canvas, g: GestureOf<K>, e: PointerAt, at: Vec2, world: Vec2, out: Shown) => void
/** The button let go during a gesture of kind K. */
export type Release<K extends Gesture['kind']> = (c: Canvas, g: GestureOf<K>, e: PointerAt, at: Vec2, world: Vec2) => void

export const get = useStore.getState

/** A pointer position in canvas pixels. */
export function local(c: Canvas, e: { clientX: number; clientY: number }): Vec2 {
  const rect = c.element().getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/** Tells the rest of the interface how far the shape in progress has got. Called after anything that may have changed it. */
export function syncStep(c: Canvas): void {
  const g = c.gesture
  const step = g.kind === 'draw' ? 1 + g.segments : g.kind === 'poly' ? g.points.length : g.kind === 'offset' || g.kind === 'arc' ? 2 : g.kind === 'measure' || g.kind === 'parallel' ? 1 : g.kind === 'angle' ? (g.a ? 2 : 1) : g.kind === 'turn' ? (g.from ? 2 : 1) : 0
  if (get().drawStep !== step) useStore.setState({ drawStep: step })
}

/** Abandons the gesture in progress. */
export function reset(c: Canvas): void {
  cancel()
  c.tracked = { tool: get().tool, points: [], resting: null }
  if (get().axisLock) useStore.setState({ axisLock: null })
  if (get().wallFace) useStore.setState({ wallFace: null })
  c.gesture = { kind: 'idle' }
  c.setOverlay({})
  syncStep(c)
}
