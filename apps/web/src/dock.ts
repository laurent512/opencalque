import { create } from 'zustand'
import { msg } from './i18n'

/**
 * The panels that can be moved, gathered in one rail, floated and closed. The drawing itself is not in
 * this list: it always fills the space the panels leave.
 *
 * This module holds no components, so anything can import it to show a panel without pulling in
 * the whole layout (which would create import cycles).
 */
export const PANELS = {
  pages: msg('Pages'),
  layers: msg('Layers'),
  components: msg('Components'),
  objects: msg('Structure'),
  colors: msg('Colours'),
  materials: msg('Materials'),
  dimensionStyles: msg('Dimension styles'),
  properties: msg('Properties'),
  assistant: msg('Assistant'),
} as const

export type PanelId = keyof typeof PANELS

/**
 * Which panels are currently open, for menus and buttons that reflect it, and which of them are
 * alone in their group, and so have their name and buttons in the group's header rather than a row
 * of their own under a rail.
 */
export const useDock = create(() => ({ open: [] as string[], alone: [] as string[] }))

interface Dock {
  show(id: PanelId): void
  toggle(id: PanelId): void
  reset(): void
}

let dock: Dock | null = null

/** Called by the layout once it exists, and again with null when it goes away. */
export function registerDock(next: Dock | null): void {
  dock = next
}

/** Opens a panel if it was closed and brings it to the front of its group. */
export const showPanel = (id: PanelId) => dock?.show(id)
export const togglePanel = (id: PanelId) => dock?.toggle(id)
/** Puts every panel back where it is in a fresh install. */
export const resetLayout = () => dock?.reset()
