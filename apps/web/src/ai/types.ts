/**
 * The seam between the assistant and whichever model service answers it. A provider turns these
 * neutral shapes into its own wire format and keeps the conversation history in that format, so
 * nothing provider-specific (reasoning blocks, tool-call ids) is lost in translation.
 */

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the tool's input object. */
  schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

/** A picture for the model to look at, base64-encoded. */
export interface Picture {
  mime: string
  data: string
}

export interface ToolResult {
  id: string
  content: string
  isError?: boolean
  image?: Picture
}

/** What is sent to the model: the user's words and pictures, or the results of the tools it just called. */
export type TurnInput = { text: string; images?: Picture[] } | { results: ToolResult[] }

export interface TurnOutput {
  calls: ToolCall[]
  /** 'done': nothing more to run. 'refused': the model declined. 'truncated': it ran out of output mid-call. */
  stop: 'done' | 'tools' | 'refused' | 'truncated'
}

export interface ChatSession {
  /** Runs one model step. Text is reported through `onText` as it arrives. */
  send(input: TurnInput, onText: (delta: string) => void, signal: AbortSignal): Promise<TurnOutput>
  /**
   * The conversation so far, as plain JSON in the provider's own format, to keep and hand back to
   * `createSession` later. It is made small enough to store: pictures and old copies of the drawing
   * are left out.
   */
  snapshot(): unknown
}

export interface Provider {
  /** Whether pictures attached to a message reach the model. */
  pictures: boolean
  /** `history` is a snapshot taken from a session of this same provider, to carry a conversation on. */
  createSession(setup: { system: string; tools: ToolSpec[]; history?: unknown }): ChatSession
  /** A message for the user explaining a failed request, or '' when they cancelled it. */
  describeError(error: unknown): string
}

const STATE = /<drawing_state>[\s\S]*?<\/drawing_state>/g
/** Longest text kept from one message when a conversation is stored. */
const KEEP = 4000

/**
 * Shortens a message for a stored conversation. Each request carries the whole drawing as it was
 * then, and tools return it again; neither is worth keeping, since the next request sends the
 * drawing as it is now.
 */
export function shorten(text: string): string {
  const slim = text.replace(STATE, '<drawing_state>(The drawing as it was then; left out.)</drawing_state>')
  return slim.length > KEEP ? `${slim.slice(0, KEEP)}… (shortened)` : slim
}

export const PICTURE_GONE = '(A picture was here; it is no longer available.)'
