import { create } from 'zustand'
import type { StyleChange, TextStyle } from '@opencalque/core'

/*
 * The text being typed in place with its words set apart (rich text, `TextEditor.tsx`), as the
 * commands and the format bar above it reach it. The editor puts itself here while it is open;
 * the commands that set words bold, larger or in a colour (`text.*` in `commands.ts`) work only
 * then.
 */

/** The toggles of the format bar, each a property of `TextStyle` that is on or off. */
export type TextToggle = 'bold' | 'italic' | 'underline' | 'strike'

/** What the format bar sets for the whole of a text: its font, its alignment, its own colour (`style.stroke`; null for its layer's). */
export interface TextNodePatch {
  font?: string | null
  align?: 'center' | 'right' | null
  color?: string | null
}

export interface RichEditor {
  /** Gives the words selected `change`; with none selected, the words typed next. */
  format(change: StyleChange): void
  /** Turns a toggle on for the words selected, or off when they all have it already. */
  toggle(key: TextToggle): void
  /** Makes the words selected larger or smaller by `factor`. */
  grow(factor: number): void
  /** Writes `text` in place of the words selected, or at the caret, as if typed. */
  write(text: string): void
  /** Takes away everything that sets the words selected apart. */
  plain(): void
  /** Changes what is said of the whole text (its font, its alignment), with the words being typed: `null` takes a property away. */
  setNode(patch: TextNodePatch): void
  /** Gives the whole text its own colour (null: its layer's), taking away the colours of words within it. */
  colorAll(color: string | null): void
  /** Goes back one change of the typing, or forward again: the words, how they are set apart, and what the bar set for the whole text. */
  undo(): void
  redo(): void
  /** Gives the focus back to the words, with the selection they had. */
  focus(): void
}

export interface TextFormatState {
  editor: RichEditor | null
  /** The selection in the words, as offsets into the text: where it started and where it ends now. */
  anchor: number
  head: number
  /** What the words typed next take, set with nothing selected; it lasts until the caret moves. */
  pending: TextStyle | null
}

export const useTextFormat = create<TextFormatState>(() => ({ editor: null, anchor: 0, head: 0, pending: null }))

/** The editor of a text being typed with its words set apart, if one is open. */
export const richEditor = (): RichEditor | null => useTextFormat.getState().editor

/** How much larger or smaller one step of the format bar (or its shortcut) makes the words. */
export const SIZE_STEP = 1.25
