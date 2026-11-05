import { describe, expect, it } from 'vitest'
import { Registry, type Clearance, type Node } from '@opencalque/core'
import { usePrefs } from '../prefs'
import { FAR, shownClearances, type ScreenBox } from './clearances'

/** A view of 0.1 pixel per millimetre, from the origin: 1 m is 100 pixels. */
const view = { zoom: 0.1, x: 0, y: 0 }
const kinds = new Registry().use({
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({ kind: 'test.door', label: 'Door', params: [], opening: () => ({ from: 0, to: 900 }), build: () => [] })
    api.registerParametric({ kind: 'test.socket', label: 'Socket', params: [], build: () => [] })
  },
})
const placed = (kind: string): Node => ({ id: 'p', type: 'parametric', parent: 'page_1', order: 'a0', kind, props: {}, x: 0, y: 0 }) as Node
const across = (x: number, length: number): Clearance => ({ from: { x, y: 1000 }, to: { x: x + length, y: 1000 }, length })

usePrefs.setState({ unit: 'm', language: 'en' })

describe('temporary dimensions shown', () => {
  it('leave out what reaches across a room from an object, not from a door or a wall', () => {
    const list = [across(0, 600), across(0, FAR + 1766)]
    expect(shownClearances(placed('test.socket'), list, view, [], kinds).map((one) => one.label.text)).toEqual(['0.6 m'])
    expect(shownClearances(placed('test.door'), list, view, [], kinds)).toHaveLength(2)
  })

  it('write a length where it covers neither the object nor its sizes, or not at all', () => {
    // 60 mm is 6 pixels: written in its middle, it would cover the object it starts from.
    const object: ScreenBox = { x: -50, y: 80, width: 50, height: 40 }
    const [short] = shownClearances(placed('test.socket'), [across(0, 60)], view, [object], kinds)
    expect(short.label.x).toBeGreaterThan(6)
    // Hemmed in on every side, it is left out.
    const everywhere: ScreenBox = { x: -500, y: -500, width: 1000, height: 1000 }
    expect(shownClearances(placed('test.socket'), [across(0, 60)], view, [everywhere], kinds)).toEqual([])
  })

  it('never write two lengths over each other', () => {
    const [first, second] = shownClearances(placed('test.socket'), [across(0, 400), across(0, 400)], view, [], kinds)
    const apart = second.label.x >= first.label.x + first.label.width || second.label.y >= first.label.y + first.label.height || first.label.y >= second.label.y + second.label.height
    expect(apart).toBe(true)
  })
})
