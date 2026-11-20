/*
 * What a turn of the wheel, or a swipe on a trackpad, does to the view. A trackpad sends wheel
 * events too: two fingers moved send small, often fractional steps, and sideways ones; a pinch sends
 * them with Ctrl held, as browsers do. A mouse wheel sends whole notches. So, as drawing programs do:
 * a pinch, or Ctrl (⌘) with the wheel, always zooms; otherwise a trackpad moves the view and a
 * mouse wheel zooms, as the wheel always did here. Shift with the wheel moves the view sideways.
 * Which of the two sends the events is the preference, the device the person says they use; on
 * 'auto' it is guessed from the events, and a mouse with a fine wheel can pass for a trackpad.
 */

export type ScrollPref = 'auto' | 'mouse' | 'trackpad'

/**
 * The preference as stored, read: before 1.13 it said what scrolling did rather than with what,
 * 'zoom' (as a mouse wheel does) or 'pan' (as two fingers on a trackpad do).
 */
export function readScrollPref(stored: unknown): ScrollPref {
  if (stored === 'mouse' || stored === 'zoom') return 'mouse'
  if (stored === 'trackpad' || stored === 'pan') return 'trackpad'
  return 'auto'
}

/** What one wheel event does: zoom about the pointer by a factor, or move the view by pixels. */
export type WheelMove = { zoom: number } | { pan: { x: number; y: number } }

/** What the stream of wheel events in progress was found to be: a swipe sends dozens, and all of them do the same. */
export interface WheelStream {
  at: number
  trackpad: boolean
}

/** Events closer together than this, in ms, are one swipe or one turn of the wheel. */
const STREAM_GAP = 300
/** Pixels in a line and a page, for the rare event that counts in those. */
const LINE = 16

interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** Whether an event looks like it comes from a trackpad: steps in pixels that are small, fractional, or sideways. */
export function looksLikeTrackpad(e: WheelLike): boolean {
  return e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50)
}

/**
 * What a wheel event does with the preference `pref`, given the stream it may belong to (the last
 * one, or null) and the time now; with the stream it belongs to, to give to the next event.
 */
export function wheelMove(e: WheelLike, pref: ScrollPref, last: WheelStream | null, now: number, page: number): { move: WheelMove; stream: WheelStream } {
  const continues = last !== null && now - last.at < STREAM_GAP
  const trackpad = pref === 'auto' ? (continues ? last.trackpad : looksLikeTrackpad(e)) : pref === 'trackpad'
  const stream = { at: now, trackpad }
  const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? page : 1
  const [dx, dy] = [e.deltaX * unit, e.deltaY * unit]
  if (e.ctrlKey || e.metaKey) {
    // A pinch sends small steps, a wheel with Ctrl notches of a hundred or so: both zoom at a pace that feels alike.
    return { move: { zoom: Math.exp(-dy * (trackpad ? 0.01 : 0.0015)) }, stream }
  }
  const pans = trackpad || e.shiftKey
  if (!pans) return { move: { zoom: Math.exp(-dy * 0.0015) }, stream }
  // Shift turns a wheel that only goes up and down into one that goes sideways.
  return { move: { pan: e.shiftKey && dx === 0 ? { x: 0 - dy, y: 0 } : { x: 0 - dx, y: 0 - dy } }, stream }
}
