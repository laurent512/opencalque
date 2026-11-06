import { t } from './i18n'

/**
 * The editor's tools: which there are, which share a toolbar button, and what the hint bar says at
 * each step of using one (`hintsFor`). What a tool does on the drawing is in `canvas/gestures/`
 * (`PRESSES`, and the gestures it starts); its command and shortcut are in `commands.ts` (`tool(…)`).
 */
export type Tool = 'select' | 'hand' | 'line' | 'curve' | 'arc' | 'rect' | 'ellipse' | 'wall' | 'dimension' | 'measure' | 'angle' | 'split' | 'trim' | 'offset' | 'rotate' | 'calibrate' | 'eyedropper' | 'text' | 'annotation' | 'gridline' | 'paper' | 'room' | 'divider' | 'place'

/** The plain shapes, which share one toolbar button. */
// A paper is drawn as a rectangle is, by its corners: it is offered with the shapes.
export const SHAPE_TOOLS: Tool[] = ['line', 'curve', 'arc', 'rect', 'ellipse', 'paper']
/** The tools for naming spaces, which share another. */
export const ROOM_TOOLS: Tool[] = ['room', 'divider']
/** The tools for writing on the drawing, which share a third. */
export const TEXT_TOOLS: Tool[] = ['text', 'annotation', 'dimension', 'gridline']
/** The tools that work on the lines of what is drawn: cutting them in two or a stretch away, or copying them alongside. */
export const CUT_TOOLS: Tool[] = ['split', 'trim', 'offset']
/** The tools that read something off the drawing without adding to it. */
export const MEASURE_TOOLS: Tool[] = ['measure', 'angle']

/** A key and what it does; an empty key is a plain instruction. */
export type Hint = [key: string, text: string]

/**
 * What to do next with the tool in use, and the keys that matter at this very step: nothing is
 * shown that cannot be used yet. Each hint is a key and what it does; an empty key is a plain
 * instruction, and the first one is always the next thing to do.
 */
export function hintsFor(tool: Tool, step: number, opening: boolean, selected = false, flips = false): Hint[] {
  const free: Hint = ['Alt', t('ignores the grid and snapping')]
  // What measures the drawing never takes a point from the grid (MEASURING in canvas/gesture.ts).
  const unsnapped: Hint = ['Alt', t('ignores snapping')]
  const onDrawing: Hint = ['', t('points go on what is drawn, not on the grid')]
  const heldStraight: Hint = ['Shift', t('keeps to 45° steps and stops on the lines it crosses')]
  const angles: Hint = ['Shift', t('keeps to 45° steps')]
  const typed: Hint = ['0-9', t('type an exact length')]
  const held: Hint = ['↑ ←', t('holds it upright or level')]
  const rested: Hint = ['', t('rest on a point to line up with it')]
  // Shift+Space flips (the command edit.flipSide): offered only where it does something.
  const flip = (what: string): Hint[] => (flips ? [['Shift+Space', what]] : [])
  switch (tool) {
    case 'wall':
      if (step === 0) return [['', t('Click where the wall starts')], rested, ...flip(t('puts it on the other side of the points'))]
      // A loop needs at least two walls drawn before a third can close it.
      return [['', t('Click the next corner')], typed, angles, held, ...flip(t('puts it on the other side of the points')), free, ...(step >= 3 ? [['', t('Double-click closes the loop')] as Hint] : []), ['Esc', t('finishes')]]
    case 'room':
      return [['', t('Click inside a closed region of walls')]]
    case 'divider':
      return step === 0 ? [['', t('Click where the divider starts, on a wall')]] : [['', t('Click where it ends, on the wall opposite')], angles, held, free, ['Esc', t('finishes')]]
    case 'line':
    case 'curve':
      // One segment is a line, several a polyline; closed, a shape that can be filled.
      if (step === 0) return [['', tool === 'curve' ? t('Click where the curve starts') : t('Click where the line starts')], rested]
      return [['', step === 1 && tool === 'line' ? t('Click where it ends') : t('Click the next point')], typed, angles, held, free, ...(step >= 3 ? [['', t('Double-click, or click the first point, to close the shape')] as Hint] : []), ['Esc', t('finishes')]]
    case 'arc':
      if (step === 0) return [['', t('Click where the arc starts')], rested]
      if (step === 1) return [['', t('Click where the arc ends')], typed, angles, free, ['Esc', t('cancels')]]
      return [['', t('Click a point the arc goes through')], ['0-9', t('type a radius')], ['Shift', t('makes a half circle')], free, ['Esc', t('cancels')]]
    case 'rect':
    case 'ellipse':
      return step === 0 ? [['', t('Click a corner, or type a width and a height first and click to place it')]] : [['', t('Click the opposite corner')], ['0-9', t('type an exact size')], free]
    case 'paper':
      return step === 0 ? [['', t('Click a corner of the sheet')]] : [['', t('Pull towards a format to take it, or click anywhere for a size of your own')], ['Alt', t('any size')]]
    case 'dimension':
      return step === 0 ? [['', t('Click the first point to measure from')], onDrawing] : step === 1 ? [['', t('Click the second point')], onDrawing, heldStraight, unsnapped] : [['', t('Click where the dimension line should sit')], free]
    case 'rotate':
      if (!selected) return [['', t('Select what to turn first: click it')]]
      if (step === 0) return [['', t('Click the point to turn it about')]]
      if (step === 1) return [['', t('Click where the turn starts from: the line from the pivot to there')], angles, free, ['Esc', t('cancels')]]
      return [['', t('Click where that line goes: the selection turns with it')], ['0-9', t('type an exact angle')], ['Shift', t('keeps to 15° steps')], ['Alt', t('turns freely')], ['Esc', t('cancels')]]
    case 'split':
      return [['', t('Click a wall, a line or a polyline where it should be cut')], ['', t('the lengths either side are shown')], ['Alt', t('ignores the grid')]]
    case 'trim':
      return [['', t('Click the stretch of a wall or a line to take away, up to what crosses it')], ['', t('walls are cut against the line of the wall crossing them')]]
    case 'offset':
      if (step === 0) return [['', t('Click a line or a shape to offset')], ['0-9', t('type the distance first')]]
      return [['', t('Click where the copy goes')], ['0-9', t('type an exact distance')], free, ['Esc', t('cancels')]]
    case 'measure':
      return step === 0 ? [['', t('Click the first point')], onDrawing] : [['', t('Click the second point')], onDrawing, heldStraight, unsnapped]
    case 'angle':
      return step === 0 ? [['', t('Click the corner of the angle')], onDrawing] : step === 1 ? [['', t('Click a point along its first side')], unsnapped] : [['', t('Click a point along its second side')], unsnapped]
    case 'text':
      return [['', t('Click where the text starts, then type')]]
    case 'annotation':
      return step === 0 ? [['', t('Click what the note is about')]] : [['', t('Click where the note goes, then type it')], free]
    case 'gridline':
      return step === 0 ? [['', t('Click where the grid line starts, at its bubble')], rested] : [['', t('Click where it ends')], typed, angles, free, ['', t('the next one takes the next letter or number')]]
    case 'place':
      return opening ? [['', t('Click a wall to place it')], ['R', t('rotates')], ...flip(t('hinges it on its other side')), ['Alt', t('places it freely, off walls and grid')]] : [['', t('Click to place it')], ['R', t('rotates')], free]
    default:
      return []
  }
}
