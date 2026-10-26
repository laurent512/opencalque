import { describe, expect, it } from 'vitest'
import { readShortcutsFile, settleShortcuts, shortcutsFile } from './shortcuts'

describe('a file of keyboard shortcuts', () => {
  it('reads back what was saved, a command left without a key included', () => {
    const overrides = { 'file.save': ['Mod+Shift+S'], 'tool.wall': [], 'view.zoomIn': ['+'] }
    expect(readShortcutsFile(shortcutsFile(overrides))).toEqual(overrides)
  })

  it('is refused when it is not one', () => {
    expect(() => readShortcutsFile('not json')).toThrow()
    expect(() => readShortcutsFile('{"format":"opencalque","nodes":{}}')).toThrow()
    expect(() => readShortcutsFile('{"format":"opencalque-shortcuts","shortcuts":[]}')).toThrow()
  })

  it('leaves out what cannot be a shortcut, and keeps commands this version does not know', () => {
    const text = JSON.stringify({
      format: 'opencalque-shortcuts',
      version: 1,
      shortcuts: {
        'file.save': ['Mod+S', 'Mod+S', 'Escape', 'Ctrl+S', 42],
        'tool.line': ['Enter'],
        'tool.rect': 'R',
        'extension.someone.thing': ['Alt+Shift+F5'],
        ['x'.repeat(201)]: ['Q'],
        ['__proto__']: ['P'],
      },
    })
    const read = readShortcutsFile(text)
    expect(read).toEqual({ 'file.save': ['Mod+S'], 'extension.someone.thing': ['Alt+Shift+F5'], ['__proto__']: ['P'] })
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype)
  })

  it('reads no more than it should from a file made to be huge', () => {
    const shortcuts = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`c${i}`, Array.from({ length: 50 }, () => 'A')]))
    const read = readShortcutsFile(JSON.stringify({ format: 'opencalque-shortcuts', version: 1, shortcuts }))
    expect(Object.keys(read)).toHaveLength(2000)
    expect(read.c0).toEqual(['A'])
  })
})

describe('shortcuts loaded from a file', () => {
  const commands = [
    { id: 'file.save', keys: ['Mod+S'] },
    { id: 'file.saveAs', keys: ['Mod+Shift+S'] },
    { id: 'tool.wall', keys: ['W'] },
  ]

  it('take a key from the command that has it by default', () => {
    expect(settleShortcuts({ 'tool.wall': ['Mod+S'] }, commands)).toEqual({ 'tool.wall': ['Mod+S'], 'file.save': [] })
  })

  it('give a key named twice to the first command only', () => {
    expect(settleShortcuts({ 'file.save': ['K'], 'tool.wall': ['K', 'J'] }, commands)).toEqual({ 'file.save': ['K'], 'tool.wall': ['J'] })
  })

  it('leave the other commands with their defaults', () => {
    expect(settleShortcuts({ 'file.save': ['Mod+Alt+S'] }, commands)).toEqual({ 'file.save': ['Mod+Alt+S'] })
  })
})
