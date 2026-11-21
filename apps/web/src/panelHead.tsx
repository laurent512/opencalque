import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

/**
 * Where the buttons of a panel go: the row at its top, beside its name, which stays in place while
 * the panel scrolls. That row is the panel's own (`PanelFrame` in Layout.tsx) when it shares a rail
 * with others, and its group's header (`GroupHead`) when it is alone in its group. Null outside a
 * panel's frame.
 */
export const PanelHeadSlot = createContext<HTMLElement | null>(null)

/** The place for its buttons in the header of the group a panel is alone in, by panel id. */
export const useHeadSlots = create<Record<string, HTMLElement | null>>(() => ({}))

/**
 * Puts its children in the row at the top of the panel it is in, beside the panel's name: what is
 * done to the panel as a whole (add a layer, change the view). A panel has one; outside a panel's
 * frame nothing is shown.
 */
export function PanelActions({ children }: { children: ReactNode }) {
  const slot = useContext(PanelHeadSlot)
  return slot ? createPortal(children, slot) : null
}
