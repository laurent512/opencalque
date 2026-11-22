import { GRID_DIVISIONS, type Bounds, type Vec2 } from '@opencalque/core'

/** How the drawing is laid on the screen: `screen = world * zoom + (x, y)`. */
export interface View {
  /** Screen position of the world origin, in CSS pixels. */
  x: number
  y: number
  /** Pixels per millimetre. */
  zoom: number
}

/** A point of the drawing area (CSS pixels from its corner) in drawing millimetres. */
export const toWorld = (p: Vec2, view: View): Vec2 => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom })

/** What is on screen, in millimetres: the drawing area's corners taken back through the view. Null before the area has a size. */
export function visibleArea(view: View, viewport: { width: number; height: number }): Bounds | null {
  if (viewport.width <= 0) return null
  return { minX: -view.x / view.zoom, minY: -view.y / view.zoom, maxX: (viewport.width - view.x) / view.zoom, maxY: (viewport.height - view.y) / view.zoom }
}

/** CSS pixels in a millimetre of screen: 96 to the inch. */
const PX_PER_MM = 96 / 25.4

/**
 * The scale the drawing is seen at on screen, as a drawing scale: "1:50" when a metre of the
 * drawing is 2 cm of screen, "5:1" when enlarged. Taken at 96 pixels to the inch, which screens
 * only roughly are.
 */
export function screenScale(zoom: number): string {
  const n = PX_PER_MM / zoom
  if (n >= 1) return `1:${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}`
  return `${Math.round(10 / n) / 10}:1`
}

/** The drawing's own grid (`settings.grid`): main lines `spacing` mm apart, each square divided into `divisions`. */
export type GridSetting = { spacing: number; divisions?: number }

/** How small, in pixels on screen, the squares of the grid may get before their lines are left out. */
const GRID_MIN_PX = 8
/** The automatic grid's steps, in mm. */
const AUTOMATIC = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000]
/** How many times ten times the main lines a grid shows, zoomed far out: past that the drawing is a dot. */
const MAIN_LEVELS = 6

/**
 * The grid's lines for a zoom, in mm: the finer ones (`minor`, also the step that snapping and
 * moving go by) and the darker ones over them (`major`). Without a grid of the drawing's, the
 * finest automatic step whose squares are at least 8 pixels on screen, every tenth line darker.
 * With one, its finer lines and its main ones; zoomed out until the finer lines would crowd, the
 * main lines become the finer ones and every tenth of them is darker, and so on. Zoomed in, the
 * grid stays at its finer lines: Alt, or the grid's snapping switched off, gives anything between.
 */
export function gridLevels(zoom: number, grid?: GridSetting): { minor: number; major: number } {
  const own = grid && grid.spacing > 0 && Number.isFinite(grid.spacing) ? grid : undefined
  const steps = own ? ownSteps(own) : AUTOMATIC
  const i = steps.findIndex((step) => step * zoom >= GRID_MIN_PX)
  if (!own) {
    const minor = i < 0 ? steps[steps.length - 1] : steps[i]
    return { minor, major: minor * 10 }
  }
  const at = i < 0 ? steps.length - 1 : i
  return { minor: steps[at], major: steps[at + 1] ?? steps[at] * 10 }
}

/** The steps of a grid of the drawing's, finest first: its finer lines (when it has any), its main ones, then ten times them, a hundred times… */
function ownSteps(grid: GridSetting): number[] {
  const divisions = Math.min(GRID_DIVISIONS, Math.max(1, Math.round(grid.divisions ?? 1)))
  const main = Array.from({ length: MAIN_LEVELS }, (_, k) => grid.spacing * 10 ** k)
  return divisions > 1 ? [grid.spacing / divisions, ...main] : main
}

/** The step, in mm, that snapping, moving and nudging go by at a zoom: the grid's finer lines as shown (`gridLevels`). */
export const gridStep = (zoom: number, grid?: GridSetting): number => gridLevels(zoom, grid).minor
