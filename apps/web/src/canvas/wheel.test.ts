import { describe, expect, it } from 'vitest'
import { looksLikeTrackpad, readScrollPref, wheelMove } from './wheel'

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
    const pinch = wheelMove(event(-5, { ctrlKey: true }), 'auto', null, 0, 800).move as { zoom: number }
    const wheel = wheelMove(event(-33, { ctrlKey: true, deltaMode: 1 }), 'auto', null, 0, 800).move as { zoom: number }
    expect(pinch.zoom).toBeGreaterThan(1)
    expect(wheel.zoom).toBeGreaterThan(1)
    expect(wheelMove(event(100, { metaKey: true }), 'auto', null, 0, 800).move).toHaveProperty('zoom')
  })

  it('takes the device the preference names for what it is, and moves sideways with Shift', () => {
    expect(wheelMove(notch, 'trackpad', null, 0, 800).move).toEqual({ pan: { x: 0, y: -100 } })
    expect(wheelMove(event(100, { shiftKey: true }), 'mouse', null, 0, 800).move).toEqual({ pan: { x: -100, y: 0 } })
    // In lines, as some systems count a wheel: 16 pixels each.
    expect(wheelMove(event(3, { deltaMode: 1 }), 'trackpad', null, 0, 800).move).toEqual({ pan: { x: 0, y: -48 } })
  })

  it('zooms with a mouse whose fine wheel would pass for a trackpad, once the mouse is chosen', () => {
    // A fine wheel sends small steps, as two fingers do.
    const fine = event(4)
    expect(wheelMove(fine, 'auto', null, 0, 800).move).toHaveProperty('pan')
    expect(wheelMove(fine, 'mouse', null, 0, 800).move).toHaveProperty('zoom')
    // With Ctrl, it zooms at a wheel's pace, not a pinch's.
    const zoom = (pref: 'auto' | 'mouse') => (wheelMove(event(40, { ctrlKey: true }), pref, null, 0, 800).move as { zoom: number }).zoom
    expect(zoom('mouse')).toBeCloseTo(Math.exp(-40 * 0.0015), 9)
    expect(zoom('auto')).toBeLessThan(zoom('mouse'))
  })

  it('reads what was stored before the device was asked: a wheel that zoomed is a mouse, one that moved the view a trackpad', () => {
    expect([readScrollPref('zoom'), readScrollPref('pan'), readScrollPref('mouse'), readScrollPref(undefined), readScrollPref('nonsense')]).toEqual(['mouse', 'trackpad', 'mouse', 'auto', 'auto'])
  })
})
