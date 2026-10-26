/**
 * The file the user's keyboard shortcuts are saved to and read back from, to take them to another
 * computer or keep them through a reinstall. It holds what `useCommands` keeps as `overrides`: the
 * shortcuts that differ from the defaults, by command id, an empty list meaning "none".
 */

/** Keys the canvas handles itself; they cannot be assigned to commands. */
export const RESERVED_KEYS = ['Escape', 'Enter', 'Space']

export const SHORTCUTS_FORMAT = 'opencalque-shortcuts'
export const SHORTCUTS_VERSION = 1

/** How much of a file is read: it may come from anywhere. */
const MAX_COMMANDS = 2000
const MAX_KEYS = 8
const MAX_ID = 200

/** A shortcut as `eventKey` writes it: modifiers in that order, then one character or a key's name. */
const KEY = /^(?:Mod\+)?(?:Alt\+)?(?:Shift\+)?(?:\S|[A-Za-z][A-Za-z0-9]{1,24})$/

export type Overrides = Record<string, string[]>

/** The text of a shortcuts file. */
export function shortcutsFile(overrides: Overrides): string {
  return JSON.stringify({ format: SHORTCUTS_FORMAT, version: SHORTCUTS_VERSION, shortcuts: overrides }, null, 2) + '\n'
}

/**
 * The shortcuts a file holds. Throws when it is not a shortcuts file; an entry that cannot be a
 * shortcut is left out. Commands this version does not know are kept: they may come from an
 * extension not loaded yet, and do nothing otherwise.
 */
export function readShortcutsFile(text: string): Overrides {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('not JSON')
  }
  const file = data as { format?: unknown; shortcuts?: unknown }
  if (!file || typeof file !== 'object' || file.format !== SHORTCUTS_FORMAT || !file.shortcuts || typeof file.shortcuts !== 'object' || Array.isArray(file.shortcuts)) {
    throw new Error('not a shortcuts file')
  }
  const entries: [string, string[]][] = []
  for (const [id, keys] of Object.entries(file.shortcuts).slice(0, MAX_COMMANDS)) {
    if (!id || id.length > MAX_ID || !Array.isArray(keys)) continue
    const valid = keys.slice(0, MAX_KEYS).filter((key): key is string => typeof key === 'string' && KEY.test(key) && !RESERVED_KEYS.includes(key))
    // A list with nothing usable left would unbind the command, which the file did not ask for.
    if (keys.length > 0 && valid.length === 0) continue
    entries.push([id, [...new Set(valid)]])
  }
  // `fromEntries` defines each id as the object's own, whatever it is called.
  return Object.fromEntries(entries)
}

/**
 * `overrides` made to give each key to one command, as `setShortcut` does: a key the file gives
 * one command is taken from any other that has it by default, and a key the file gives two
 * commands stays with the first.
 */
export function settleShortcuts(overrides: Overrides, commands: { id: string; keys?: string[] }[]): Overrides {
  const owner = new Map<string, string>()
  const settled = new Map<string, string[]>()
  for (const [id, keys] of Object.entries(overrides)) {
    const kept = keys.filter((key) => !owner.has(key))
    for (const key of kept) owner.set(key, id)
    settled.set(id, kept)
  }
  for (const command of commands) {
    if (settled.has(command.id) || !command.keys) continue
    const kept = command.keys.filter((key) => !owner.has(key))
    if (kept.length < command.keys.length) settled.set(command.id, kept)
  }
  return Object.fromEntries(settled)
}
