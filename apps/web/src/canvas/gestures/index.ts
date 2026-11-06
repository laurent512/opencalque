import type { Tool } from '../../tools'
import type { Gesture } from '../gesture'
import type { Move, Press, Release } from '../runtime'
import { arcMove, drawDown, drawMove, drawUp, lineDown, offsetMove, polyMove, polyUp, textDown } from './drawTools'
import { angleDown, angleMove, measureDown, measureMove } from './measure'
import { offsetDown, parallelMove } from './offset'
import { eyedropperDown, placeDown, splitDown, toolHover, trimDown } from './place'
import { cornerMove, cropMove, dragUp, endMove, faceMove, handleMove, hover, marqueeMove, marqueeUp, moveMove, pressMove, pressUp, resizeMove, rotateMove, scaleMove, selectDown } from './select'
import { rotateDown, turnMove } from './turn'

/*
 * What the canvas does, by tool and by gesture: `CanvasView` only dispatches. A new tool adds its
 * press here (the two-point drawing tools share `drawDown`), and a new kind of gesture its movement
 * and, if it has one, its release.
 */

/** What a press of the main button does with each tool. */
export const PRESSES: Partial<Record<Tool, Press>> = {
  select: selectDown,
  eyedropper: eyedropperDown,
  text: textDown,
  place: placeDown,
  room: placeDown,
  split: splitDown,
  trim: trimDown,
  offset: offsetDown,
  angle: angleDown,
  rotate: rotateDown,
  measure: measureDown,
  calibrate: measureDown,
  line: lineDown,
  curve: lineDown,
}
/** The tools that draw by two points (and a dimension's third), and any not listed above. */
export const DRAW_PRESS: Press = drawDown

/** What a movement of the pointer does during each gesture. With none, it shows what a press would do. */
export const MOVES: { [K in Gesture['kind']]: Move<K> } = {
  idle: (c, g, e, at, world, out) => {
    hover(c, g, e, at, world, out)
    toolHover(c, g, e, at, world, out)
  },
  press: pressMove,
  move: moveMove,
  handle: handleMove,
  corner: cornerMove,
  crop: cropMove,
  scale: scaleMove,
  resize: resizeMove,
  rotate: rotateMove,
  marquee: marqueeMove,
  draw: drawMove,
  offset: offsetMove,
  arc: arcMove,
  parallel: parallelMove,
  measure: measureMove,
  angle: angleMove,
  poly: polyMove,
  turn: turnMove,
  face: faceMove,
  end: endMove,
}

/** What letting go of the button does during each gesture that cares. */
export const RELEASES: { [K in Gesture['kind']]?: Release<K> } = {
  press: pressUp,
  move: dragUp,
  handle: dragUp,
  corner: dragUp,
  crop: dragUp,
  scale: dragUp,
  resize: dragUp,
  rotate: dragUp,
  face: dragUp,
  end: dragUp,
  marquee: marqueeUp,
  poly: polyUp,
  draw: drawUp,
}
