import { describe, expect, it } from 'vitest'
import { addEntry, ALL_ITEMS, canJoin, dropOn, itemOf, removeEntry, sameToolbar, saveToolbar, SEPARATOR, shownTool, tidyToolbar, TOOLBAR_DEFAULT, type ToolbarLayout } from './toolbar'

/* The floating toolbar: from left to right, buttons (a tool, a list of tools, or one of the others) and separators. */

const small: ToolbarLayout = [['select'], ['hand'], SEPARATOR, ['line', 'rect'], ['wall'], ['door'], SEPARATOR, ['undo']]

describe('the floating toolbar', () => {
  it('comes with every item it holds known, and the Connect tool not among them', () => {
    expect(tidyToolbar(TOOLBAR_DEFAULT)).toEqual(TOOLBAR_DEFAULT)
    expect(TOOLBAR_DEFAULT.flat()).not.toContain('connect')
    expect(ALL_ITEMS).toContain('connect')
    for (const id of ALL_ITEMS) expect(itemOf(id), id).not.toBeNull()
  })

  it('reads a stored toolbar: what it does not know left out, each item once, the others alone, no separator at an end or beside another', () => {
    expect(tidyToolbar([SEPARATOR, ['select', 'teleport'], ['select'], SEPARATOR, SEPARATOR, ['line', 'door', 'rect'], [], SEPARATOR])).toEqual([['select'], SEPARATOR, ['line', 'rect'], ['door']])
    // While it is set up, separators stay where they are put, to be moved on.
    expect(tidyToolbar([SEPARATOR, ['select'], SEPARATOR], true)).toEqual([SEPARATOR, ['select'], SEPARATOR])
    // A toolbar stored as something else (an earlier shape, a hand edit) gives the one that comes.
    expect(tidyToolbar([[['select']], [['wall']]])).toEqual(TOOLBAR_DEFAULT)
    expect(tidyToolbar('select')).toEqual(TOOLBAR_DEFAULT)
  })

  it('shows on a list the tool in use, else the one of it used last, else its first', () => {
    expect(shownTool(['line', 'rect'], 'rect', [])).toBe('rect')
    expect(shownTool(['line', 'rect'], 'wall', ['wall', 'rect', 'line'])).toBe('rect')
    expect(shownTool(['line', 'rect'], 'wall', ['wall'])).toBe('line')
  })
})

describe('setting up the toolbar by dragging', () => {
  it('moves a button or a separator between two others', () => {
    expect(dropOn(small, { kind: 'entry', at: 4 }, { kind: 'before', at: 0 })).toEqual([['wall'], ['select'], ['hand'], SEPARATOR, ['line', 'rect'], ['door'], SEPARATOR, ['undo']])
    expect(dropOn(small, { kind: 'entry', at: 2 }, { kind: 'before', at: 8 })).toEqual([['select'], ['hand'], ['line', 'rect'], ['wall'], ['door'], SEPARATOR, ['undo'], SEPARATOR])
    expect(dropOn(small, { kind: 'entry', at: 0 }, { kind: 'before', at: 3 })).toEqual([['hand'], SEPARATOR, ['select'], ['line', 'rect'], ['wall'], ['door'], SEPARATOR, ['undo']])
    // Let go where it was: nothing changes.
    expect(dropOn(small, { kind: 'entry', at: 4 }, { kind: 'before', at: 5 })).toBe(small)
  })

  it('joins a button onto a list or another tool, and takes a tool out of a list onto a button of its own', () => {
    expect(dropOn(small, { kind: 'entry', at: 4 }, { kind: 'join', at: 3 })).toEqual([['select'], ['hand'], SEPARATOR, ['line', 'rect', 'wall'], ['door'], SEPARATOR, ['undo']])
    expect(dropOn(small, { kind: 'entry', at: 1 }, { kind: 'join', at: 0 })).toEqual([['select', 'hand'], SEPARATOR, ['line', 'rect'], ['wall'], ['door'], SEPARATOR, ['undo']])
    expect(dropOn(small, { kind: 'tool', at: 3, index: 0 }, { kind: 'before', at: 5 })).toEqual([['select'], ['hand'], SEPARATOR, ['rect'], ['wall'], ['line'], ['door'], SEPARATOR, ['undo']])
    // In its list: put after the other.
    expect(dropOn(small, { kind: 'tool', at: 3, index: 0 }, { kind: 'list', at: 3, index: 2 })[3]).toEqual(['rect', 'line'])
    // The door and the separators are not tools: they join nothing, and nothing joins them.
    expect(canJoin(small, { kind: 'entry', at: 5 }, 4)).toBe(false)
    expect(canJoin(small, { kind: 'entry', at: 4 }, 5)).toBe(false)
    expect(canJoin(small, { kind: 'entry', at: 2 }, 3)).toBe(false)
    expect(dropOn(small, { kind: 'entry', at: 5 }, { kind: 'join', at: 4 })).toBe(small)
  })

  it('puts in what was not in it, separators any number of times, and takes out what is dragged out', () => {
    expect(dropOn(small, { kind: 'new', id: 'connect' }, { kind: 'join', at: 4 })[4]).toEqual(['wall', 'connect'])
    expect(dropOn(small, { kind: 'new', id: SEPARATOR }, { kind: 'before', at: 1 })).toEqual([['select'], SEPARATOR, ['hand'], SEPARATOR, ['line', 'rect'], ['wall'], ['door'], SEPARATOR, ['undo']])
    // What is in it already is not put in twice.
    expect(dropOn(small, { kind: 'new', id: 'wall' }, { kind: 'before', at: 0 })).toBe(small)
    expect(dropOn(small, { kind: 'entry', at: 4 }, { kind: 'remove' })).not.toContainEqual(['wall'])
    expect(removeEntry(small, 3, 1)[3]).toEqual(['line'])
    expect(addEntry(small, 'connect').at(-1)).toEqual(['connect'])
    // The toolbar given is left as it was.
    expect(small[3]).toEqual(['line', 'rect'])
  })
})

describe('saved toolbars', () => {
  it('are saved under a name, again in their place when the name is the same, and told apart by what they hold', () => {
    const once = saveToolbar([], ' Plans ', small)
    expect(once).toEqual([{ name: 'Plans', toolbar: small }])
    const twice = saveToolbar(saveToolbar(once, 'Details', TOOLBAR_DEFAULT), 'Plans', TOOLBAR_DEFAULT)
    expect(twice.map((one) => one.name)).toEqual(['Plans', 'Details'])
    expect(sameToolbar(twice[0].toolbar, TOOLBAR_DEFAULT)).toBe(true)
    expect(sameToolbar(small, TOOLBAR_DEFAULT)).toBe(false)
  })
})
