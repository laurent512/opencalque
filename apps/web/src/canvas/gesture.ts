import type { Alignable, Node, NodeOf, ResizeFrame, Vec2 } from '@opencalque/core'
import type { Tool } from '../tools'

/** The interaction in progress on the canvas. Each kind is handled by its gesture module (`gestures/`). */
export type Gesture =
  | { kind: 'idle' }
  /** Button down on an object: becomes a move once the pointer travels far enough. */
  /** With `beside`, the press was on no object but inside the box around the selection: released without moving, it lets the selection go. */
  | { kind: 'press'; at: Vec2; start: Vec2; nodes: Node[]; beside?: boolean }
  /** `moving` and `others` are what is moved and what it can line up with, as they stood when the move began. */
  | { kind: 'move'; start: Vec2; nodes: Node[]; moving: Alignable | null; others: Alignable[] }
  | { kind: 'handle'; node: Node; index: number }
  /** A wall corner being dragged: every wall end at `from` follows, or with `only` just that wall's. */
  | { kind: 'corner'; from: Vec2; only?: string }
  /** A corner of a crop being dragged; `fixed` is the opposite corner, which stays where it is. */
  | { kind: 'crop'; node: Node; index: number; fixed: Vec2 }
  /** A corner of the box around the selection being dragged: everything scales about the opposite corner. */
  | { kind: 'scale'; nodes: Node[]; pivot: Vec2; corner: Vec2 }
  /** A box-shaped node (a rectangle, an ellipse) resized by grip `grip` of its frame (see resize.ts). */
  | { kind: 'resize'; node: Node; grip: number }
  /** The knob of that box being dragged: everything turns about the middle of the box. `from` is the angle the drag started at. */
  /** `box`: the box of a selection with no turn of its own (a group, several things), turned with the pointer while it is dragged. */
  | { kind: 'rotate'; nodes: Node[]; pivot: Vec2; from: number; box?: ResizeFrame }
  | { kind: 'marquee'; start: Vec2; keep: string[] }
  /**
   * A two-point shape whose first point is set. `press` is where and when the button went down,
   * until it is released. `origin`, `segments` and `since` describe the run of chained shapes this
   * one continues: where it began, how many are drawn, and when the last one was finished.
   */
  | { kind: 'draw'; id: string; start: Vec2; press: (Vec2 & { time: number }) | null; origin: Vec2; segments: number; since: number }
  /** A dimension whose two points are set; the pointer now chooses how far its line stands off. */
  | { kind: 'offset'; id: string; a: Vec2; b: Vec2 }
  /** An arc whose two ends are set; the pointer now chooses a point it goes through. */
  | { kind: 'arc'; id: string; a: Vec2; b: Vec2 }
  /** The offset tool has taken `node`; the pointer now chooses how far from it the copy goes. `copy` is the copy being shown. */
  | { kind: 'parallel'; node: Node; copy?: string }
  /** A live reading from `start`. Nothing is added to the drawing. */
  | { kind: 'measure'; start: Vec2 }
  | { kind: 'angle'; vertex: Vec2; a?: Vec2 }
  /** A polyline with the points clicked so far; `since` is when the last one was added. */
  | { kind: 'poly'; id: string; points: Vec2[]; since: number; press?: Vec2 & { time: number } }
  // The rotate tool: its pivot, then a point of the line the turn starts from.
  | { kind: 'turn'; nodes: Node[]; pivot: Vec2; from?: Vec2 }
  /**
   * A long face of the selected wall being dragged: the wall gets thicker or thinner from that
   * side, the other face staying where it is. `moving` is what moves with it, which the face does
   * not snap to.
   */
  | { kind: 'face'; wall: NodeOf<'wall'>; side: 'left' | 'right'; moving: string[] }
  | { kind: 'end'; wall: NodeOf<'wall'>; end: 'a' | 'b'; joined: { id: string; end: 'a' | 'b' }[] }

export type GestureOf<K extends Gesture['kind']> = Extract<Gesture, { kind: K }>

/** The parts of a pointer event the canvas uses. */
export interface PointerAt {
  clientX: number
  clientY: number
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/** The keys that change where a point goes: Alt leaves out snapping, Shift holds a direction. */
export interface Keys {
  altKey: boolean
  shiftKey: boolean
}

export const TWO_POINT: Tool[] = ['line', 'curve', 'arc', 'wall', 'divider', 'dimension', 'annotation', 'gridline', 'rect', 'ellipse', 'paper']
/** The tools that measure what is drawn: their points snap to it, never to the grid. A dimension's line is still placed by grid steps. */
export const MEASURING: Tool[] = ['dimension', 'measure', 'angle']
/** Tools whose two typed sizes are a width and a height. */
export const BOXES: Tool[] = ['rect', 'ellipse', 'paper']
/** How close, in screen pixels, the pointer must come to a standard format's corner for a paper to take that format. */
export const FORMAT_REACH = 14
export const CHAINED: Tool[] = ['wall', 'divider']
/** Things with a turn of their own that are not resized by a frame: the box around one of them turns with it. */
export const TURNING: Node['type'][] = ['text', 'image', 'parametric', 'instance']
/** How close, in screen pixels, the pointer must come to something for a point to snap to it, and for a moved object to line up with another. */
export const SNAP_REACH = 10
export const ALIGN_REACH = 6
/**
 * A press only counts as dragging out a shape when the pointer travelled this far (px) and the
 * button was held this long (ms). Anything less is a click whose hand slipped, and must not leave
 * a stub behind.
 */
export const DRAG_DISTANCE = 12
/** How close to the point just placed, in screen pixels, a click is taken as that point. */
export const SAME_POINT = 8
export const DRAG_TIME = 200
/** How thin a wall may be on screen, in pixels, and still have faces to drag: thinner, its faces and its middle are one. */
export const FACE_MIN = 8
/** How near the point at a wall's free end, in pixels, a press moves that end anywhere, as a corner; further along its line across, only along the wall. */
export const END_POINT = 5
