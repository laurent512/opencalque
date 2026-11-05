import { create } from 'zustand'

/**
 * The windows laid over the editor, and the message shown at its foot. They are no part of the
 * drawing or of what is being done to it, so they live apart from the editor's store; opening a
 * drawing closes them all (`loadDocument`).
 */
interface Windows {
  welcomeOpen: boolean
  preferencesOpen: boolean
  /** The page Preferences opens on next, when something asked for one; otherwise the one it was left on. */
  preferencesPage: string | null
  exportOpen: boolean
  /** Whether File › Drawing settings is open. */
  drawingSettingsOpen: boolean
  aboutOpen: boolean
  /** Whether the object library is open. */
  warehouse: 'components' | null
  /** What is asked before it is done (`ask`), while its window is open. */
  question: Question | null
  toast: string | null
  /** The placements of an entry of the Components panel (a component, or a model of parametric objects: `entries.ts`) being gone through one by one (`InstanceBar`), and the one shown. */
  browsing: { entry: string; current: string } | null
}

/** Something to be done once the user says yes: what the window says, and the button that does it. */
export interface Question {
  title: string
  message: string
  /** The words on the button that does it, such as "Delete". */
  action: string
  run: () => void
}

const CLOSED: Windows = { welcomeOpen: false, preferencesOpen: false, preferencesPage: null, exportOpen: false, drawingSettingsOpen: false, aboutOpen: false, warehouse: null, question: null, toast: null, browsing: null }

export const useWindows = create<Windows>(() => CLOSED)

/** Closes every window and lets the message go. */
export function closeWindows(): void {
  useWindows.setState(CLOSED)
}

/** Asks before doing something that takes more away than it seems (`QuestionWindow`): it is done only on yes. */
export function ask(question: Question): void {
  useWindows.setState({ question })
}

/** Shows a message at the foot of the editor for a few seconds. */
export function toast(message: string): void {
  useWindows.setState({ toast: message })
  setTimeout(() => useWindows.getState().toast === message && useWindows.setState({ toast: null }), 4000)
}
