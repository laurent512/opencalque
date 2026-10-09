/**
 * A way for controls outside the canvas to act on the shape being drawn. The canvas sets these
 * while it is mounted; the quick bar calls `commit` when Enter is pressed in one of its fields.
 */
export const drawing: { commit: (() => void) | null; refresh: (() => void) | null } = {
  commit: null,
  /** Redraws the shape in progress, after a size was typed without the pointer moving. */
  refresh: null,
}
