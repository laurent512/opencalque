import type { Bounds, Vec2 } from '@opencalque/core'

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

/** The grid step, in mm, for a zoom: the finest whose squares are at least 8 pixels on screen. */
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

export function gridStep(zoom: number): number {
  for (const step of [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]) if (step * zoom >= 8) return step
  return 100000
}
