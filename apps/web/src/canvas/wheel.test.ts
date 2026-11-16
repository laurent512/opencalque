import { describe, expect, it } from 'vitest'
import { looksLikeTrackpad, wheelMove } from './wheel'

const event = (deltaY: number, more: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, deltaY, ...more })
/** A notch of a mouse wheel in Chromium, and steps of two fingers on a trackpad. */
const notch = event(100)
const swipe = event(7.5, { deltaX: -3 })

describe('scrolling over the drawing', () => {
  it('tells a trackpad from a mouse wheel by its steps', () => {
    expect(looksLikeTrackpad(notch)).toBe(false)
    expect(looksLikeTrackpad(event(120))).toBe(false)
    expect(looksLikeTrackpad(swipe)).toBe(true)
    expect(looksLikeTrackpad(event(4))).toBe(true)
    expect(looksLikeTrackpad(event(3, { deltaMode: 1 }))).toBe(false)
  })

  it('moves the view with a trackpad and zooms with a mouse wheel, by default', () => {
    expect(wheelMove(swipe, 'auto', null, 0, 800).move).toEqual({ pan: { x: 3, y: -7.5 } })
    expect(wheelMove(notch, 'auto', null, 0, 800).move).toHaveProperty('zoom')
  })

  it('keeps doing what a swipe started with, even when a step of it is large', () => {
    const first = wheelMove(swipe, 'auto', null, 0, 800)
    expect(wheelMove(event(120), 'auto', first.stream, 50, 800).move).toHaveProperty('pan')
    // Long after, a notch is a notch again.
    expect(wheelMove(event(120), 'auto', first.stream, 2000, 800).move).toHaveProperty('zoom')
  })

  it('always zooms with a pinch or Ctrl, in at a pace that feels alike from both', () => {
    const pinch = wheelMove(event(-5, { ctrlKey: true }), 'pan', null, 0, 800).move as { zoom: number }
    const wheel = wheelMove(event(-33, { ctrlKey: true, deltaMode: 1 }), 'pan', null, 0, 800).move as { zoom: number }
    expect(pinch.zoom).toBeGreaterThan(1)
    expect(wheel.zoom).toBeGreaterThan(1)
    expect(wheelMove(event(100, { metaKey: true }), 'auto', null, 0, 800).move).toHaveProperty('zoom')
  })

  it('does what the preference says, and moves sideways with Shift', () => {
    expect(wheelMove(notch, 'pan', null, 0, 800).move).toEqual({ pan: { x: 0, y: -100 } })
    expect(wheelMove(swipe, 'zoom', null, 0, 800).move).toHaveProperty('zoom')
    expect(wheelMove(event(100, { shiftKey: true }), 'zoom', null, 0, 800).move).toEqual({ pan: { x: -100, y: 0 } })
    // In lines, as some systems count a wheel: 16 pixels each.
    expect(wheelMove(event(3, { deltaMode: 1 }), 'pan', null, 0, 800).move).toEqual({ pan: { x: 0, y: -48 } })
  })
})
