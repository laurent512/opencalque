import { create } from 'zustand'
import { buildScene, componentsOf, pagesOf } from '@opencalque/core'
import {
  deleteSelection,
  copySelection,
  cutSelection,
  duplicateSelection,
  exportDxf,
  groupSelection,
  exportSvg,
  importLibrary,
  makeComponent,
  newDocument,
  openDocument,
  paste,
  reorderSelection,
  runCommand,
  saveDocument,
  ungroupSelection,
  zoomBy,
  zoomToFit,
  nudgeSelection,
  transformSelection,
  addModifier,
  exportPdf,
  importDxf,
  openExample,
  alignSelection,
  distributeSelection,
} from './actions'
import { apply, editComponent, redo, registry, select, setTool, showPage, toast, undo, useStore, type Tool } from './store'
import { PANELS, resetLayout, togglePanel, useDock, type PanelId } from './dock'
import { importFloorPlan } from './floorplan'
import { msg, t } from './i18n'
import { setPrefs, usePrefs } from './prefs'
import { labelOf } from './ui'

/**
 * Everything the user can trigger, in one list. The command palette, the keyboard handler, the
 * main menu and the toolbar tooltips all read from here, so a command added here shows up in all
 * of them and its shortcut can be changed by the user.
 */
export interface Command {
  id: string
  title: string
  category: string
  /** Default shortcuts, written like "Mod+Shift+S". Mod is Ctrl, or Cmd on macOS. */
  keys?: string[]
  run(): void
  /** While this returns false the command cannot run, which lets another command share its key. */
  when?(): boolean
  /** Also works while the cursor is in a text field. */
  global?: boolean
  /** Abandons whatever is being drawn or dragged on the canvas. */
  interrupts?: boolean
  /** For a command that switches something on and off: whether it is on. */
  checked?(): boolean
  /** Extra words the palette search matches, for titles that are built already translated. */
  keywords?: string
}

const get = useStore.getState
const prefs = usePrefs.getState
const selected = () => get().selection.length > 0
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const STORAGE_KEY = 'opencalque.shortcuts'

/** Keys the canvas handles itself; they cannot be assigned to commands. */
export const RESERVED_KEYS = ['Escape', 'Enter', 'Space']

function loadOverrides(): Record<string, string[]> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

/** `overrides` holds the shortcuts the user changed, by command id; an empty list means "none". */
export const useCommands = create(() => ({ overrides: loadOverrides(), paletteOpen: false }))

function storeOverrides(overrides: Record<string, string[]>): void {
  useCommands.setState({ overrides })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Storage can be unavailable (private windows); the change then lasts for this session.
  }
}

const tool = (id: Tool, title: string, key: string): Command => ({ id: `tool.${id}`, title, category: 'Tools', keys: [key], run: () => setTool(id) })

/** The categories commands are grouped under, listed here so that their names get translated. */
export const CATEGORIES = [msg('General'), msg('File'), msg('Edit'), msg('Components'), msg('View'), msg('Panels'), msg('Tools'), msg('Pages'), msg('Layers'), msg('Insert'), msg('Extensions')]

const panel = (id: PanelId, keys?: string[]): Command => ({
  id: `view.panel.${id}`,
  title: PANELS[id],
  category: 'Panels',
  keys,
  global: true,
  checked: () => useDock.getState().open.includes(id),
  run: () => togglePanel(id),
})

const STATIC: Command[] = [
  { id: 'palette.open', title: msg('Show all commands'), category: 'General', keys: ['Mod+K'], global: true, run: () => useCommands.setState({ paletteOpen: true }) },
  { id: 'shortcuts.reset', title: msg('Reset all keyboard shortcuts'), category: 'General', run: () => (storeOverrides({}), toast(t('Keyboard shortcuts reset'))) },

  { id: 'file.new', title: msg('New drawing'), category: 'File', keys: ['Mod+N'], global: true, interrupts: true, run: newDocument },
  { id: 'file.open', title: msg('Open…'), category: 'File', keys: ['Mod+O'], global: true, interrupts: true, run: openDocument },
  { id: 'file.openExample', title: msg('Open the example drawing'), category: 'File', interrupts: true, run: openExample },
  { id: 'file.save', title: msg('Save'), category: 'File', keys: ['Mod+S'], global: true, interrupts: true, run: () => saveDocument() },
  { id: 'file.saveAs', title: msg('Save as…'), category: 'File', keys: ['Mod+Shift+S'], global: true, interrupts: true, run: () => saveDocument(true) },
  { id: 'file.autosave', title: msg('Save automatically'), category: 'File', checked: () => prefs().autosave, run: () => setPrefs({ autosave: !prefs().autosave }) },
  { id: 'file.importPlan', title: msg('Import floor plan (PDF or picture)…'), category: 'File', interrupts: true, run: importFloorPlan },
  { id: 'file.importDxf', title: msg('Import DXF (from other CAD programs)…'), category: 'File', interrupts: true, run: importDxf },
  { id: 'file.importLibrary', title: msg('Import component library…'), category: 'File', interrupts: true, run: importLibrary },
  { id: 'file.exportDxf', title: msg('Export DXF (for other CAD programs)…'), category: 'File', run: exportDxf },
  { id: 'file.exportPdf', title: msg('Export PDF (sheets, to scale)…'), category: 'File', keys: ['Mod+P'], global: true, run: exportPdf },
  { id: 'file.exportSvg', title: msg('Export SVG…'), category: 'File', run: exportSvg },

  { id: 'edit.undo', title: msg('Undo'), category: 'Edit', keys: ['Mod+Z'], interrupts: true, run: undo },
  { id: 'edit.redo', title: msg('Redo'), category: 'Edit', keys: ['Mod+Shift+Z', 'Mod+Y'], interrupts: true, run: redo },
  { id: 'edit.delete', title: msg('Delete selection'), category: 'Edit', keys: ['Delete', 'Backspace'], interrupts: true, run: deleteSelection },
  { id: 'edit.cut', title: msg('Cut'), category: 'Edit', keys: ['Mod+X'], interrupts: true, when: selected, run: cutSelection },
  { id: 'edit.copy', title: msg('Copy'), category: 'Edit', keys: ['Mod+C'], when: selected, run: copySelection },
  { id: 'edit.paste', title: msg('Paste'), category: 'Edit', keys: ['Mod+V'], interrupts: true, run: paste },
  { id: 'edit.duplicate', title: msg('Duplicate selection'), category: 'Edit', keys: ['Mod+D'], interrupts: true, run: duplicateSelection },
  {
    id: 'edit.selectAll',
    title: msg('Select all'),
    category: 'Edit',
    keys: ['Mod+A'],
    interrupts: true,
    run: () => {
      const { doc, scope } = get()
      select(buildScene(doc, scope, registry).filter((item) => !item.locked).map((item) => item.id))
    },
  },
  { id: 'edit.deselect', title: msg('Deselect all'), category: 'Edit', run: () => select([]) },
  { id: 'edit.bringToFront', title: msg('Bring to front'), category: 'Edit', keys: [']'], when: selected, run: () => reorderSelection('front') },
  { id: 'edit.bringForward', title: msg('Bring forward'), category: 'Edit', keys: ['Mod+]'], when: selected, run: () => reorderSelection('forward') },
  { id: 'edit.sendBackward', title: msg('Send backward'), category: 'Edit', keys: ['Mod+['], when: selected, run: () => reorderSelection('backward') },
  { id: 'edit.sendToBack', title: msg('Send to back'), category: 'Edit', keys: ['['], when: selected, run: () => reorderSelection('back') },
  { id: 'edit.rotateRight', title: msg('Rotate 90° clockwise'), category: 'Edit', keys: ['Shift+R'], when: selected, run: () => transformSelection({ rotation: 90 }) },
  { id: 'edit.rotateLeft', title: msg('Rotate 90° counter-clockwise'), category: 'Edit', keys: ['Alt+Shift+R'], when: selected, run: () => transformSelection({ rotation: -90 }) },
  { id: 'edit.flipHorizontal', title: msg('Flip left to right'), category: 'Edit', keys: ['Shift+H'], when: selected, run: () => transformSelection({ mirror: 'horizontal' }) },
  { id: 'edit.flipVertical', title: msg('Flip top to bottom'), category: 'Edit', keys: ['Shift+V'], when: selected, run: () => transformSelection({ mirror: 'vertical' }) },
  { id: 'edit.scaleUp', title: msg('Scale up by 10%'), category: 'Edit', when: selected, run: () => transformSelection({ scale: 1.1 }) },
  { id: 'edit.scaleDown', title: msg('Scale down by 10%'), category: 'Edit', when: selected, run: () => transformSelection({ scale: 1 / 1.1 }) },
  { id: 'edit.nudgeLeft', title: msg('Move left by one grid step'), category: 'Edit', keys: ['ArrowLeft'], when: selected, run: () => nudgeSelection(-1, 0) },
  { id: 'edit.nudgeRight', title: msg('Move right by one grid step'), category: 'Edit', keys: ['ArrowRight'], when: selected, run: () => nudgeSelection(1, 0) },
  { id: 'edit.nudgeUp', title: msg('Move up by one grid step'), category: 'Edit', keys: ['ArrowUp'], when: selected, run: () => nudgeSelection(0, -1) },
  { id: 'edit.nudgeDown', title: msg('Move down by one grid step'), category: 'Edit', keys: ['ArrowDown'], when: selected, run: () => nudgeSelection(0, 1) },
  { id: 'modifier.crop', title: msg('Crop'), category: 'Edit', when: selected, run: () => addModifier('crop') },
  { id: 'edit.align.left', title: msg('Align left'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('left') },
  { id: 'edit.align.center', title: msg('Align centres, across'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('center') },
  { id: 'edit.align.right', title: msg('Align right'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('right') },
  { id: 'edit.align.top', title: msg('Align top'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('top') },
  { id: 'edit.align.middle', title: msg('Align middles, up and down'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('middle') },
  { id: 'edit.align.bottom', title: msg('Align bottom'), category: 'Edit', when: () => get().selection.length > 1, run: () => alignSelection('bottom') },
  { id: 'edit.distribute.x', title: msg('Space evenly, across'), category: 'Edit', when: () => get().selection.length > 2, run: () => distributeSelection('x') },
  { id: 'edit.distribute.y', title: msg('Space evenly, up and down'), category: 'Edit', when: () => get().selection.length > 2, run: () => distributeSelection('y') },
  { id: 'modifier.array', title: msg('Repeat in rows and columns'), category: 'Edit', when: selected, run: () => addModifier('array') },
  { id: 'modifier.hatch', title: msg('Hatch or floor pattern'), category: 'Edit', when: selected, run: () => addModifier('hatch') },
  { id: 'edit.group', title: msg('Group selection'), category: 'Edit', keys: ['Mod+G'], interrupts: true, when: selected, run: groupSelection },
  {
    id: 'edit.ungroup',
    title: msg('Ungroup'),
    category: 'Edit',
    keys: ['Mod+Shift+G'],
    interrupts: true,
    when: () => get().selection.some((id) => get().doc.nodes[id]?.type === 'group'),
    run: ungroupSelection,
  },

  { id: 'component.create', title: msg('Create component from selection'), category: 'Components', keys: ['Mod+Alt+K'], interrupts: true, when: selected, run: makeComponent },
  { id: 'component.finish', title: msg('Finish editing this group or component'), category: 'Components', when: () => get().scope !== get().page, run: () => editComponent(null) },

  { id: 'view.zoomToFit', title: msg('Zoom to fit'), category: 'View', keys: ['Shift+1'], run: zoomToFit },
  { id: 'view.zoomIn', title: msg('Zoom in'), category: 'View', keys: ['+', 'Shift++', 'Mod+='], run: () => zoomBy(1.25) },
  { id: 'view.toggleGrid', title: msg('Show grid'), category: 'View', checked: () => prefs().showGrid, run: () => setPrefs({ showGrid: !prefs().showGrid }) },
  { id: 'view.toggleSnapGrid', title: msg('Snap to grid'), category: 'View', checked: () => prefs().snapToGrid, run: () => setPrefs({ snapToGrid: !prefs().snapToGrid }) },
  {
    id: 'view.toggleSnapObjects',
    title: msg('Snap to objects'),
    category: 'View',
    checked: () => prefs().snapToObjects,
    run: () => setPrefs({ snapToObjects: !prefs().snapToObjects }),
  },
  panel('pages'),
  panel('layers'),
  panel('objects'),
  panel('colors'),
  panel('properties'),
  panel('assistant', ['Mod+J']),
  { id: 'view.resetLayout', title: msg('Reset the panel layout'), category: 'View', run: resetLayout },
  { id: 'help.welcome', title: msg('Welcome window…'), category: 'General', global: true, run: () => useStore.setState({ welcomeOpen: true }) },
  { id: 'help.about', title: msg('About OpenCalque and what is new…'), category: 'General', global: true, run: () => useStore.setState({ aboutOpen: true }) },
  { id: 'prefs.open', title: msg('Preferences…'), category: 'General', keys: ['Mod+,'], global: true, run: () => useStore.setState({ preferencesOpen: true }) },
  { id: 'view.zoomOut', title: msg('Zoom out'), category: 'View', keys: ['-', 'Mod+-'], run: () => zoomBy(0.8) },

  tool('select', msg('Select'), 'V'),
  tool('hand', msg('Pan'), 'H'),
  tool('line', msg('Line'), 'L'),
  // Listed before the rectangle tool so that R rotates while an object is being placed.
  {
    id: 'place.rotate',
    title: msg('Rotate the object being placed'),
    category: 'Tools',
    keys: ['R'],
    when: () => get().tool === 'place',
    run: () => useStore.setState({ placingRotation: (get().placingRotation + 90) % 360 }),
  },
  tool('rect', msg('Rectangle'), 'R'),
  tool('ellipse', msg('Ellipse'), 'O'),
  tool('polyline', msg('Polyline'), 'P'),
  tool('wall', msg('Wall'), 'W'),
  tool('dimension', msg('Dimension'), 'D'),
  tool('measure', msg('Measure'), 'M'),
  tool('eyedropper', msg('Eyedropper: copy the look of an object'), 'I'),
  tool('text', msg('Text'), 'T'),
  tool('annotation', msg('Annotation'), 'Shift+T'),
  tool('paper', msg('Paper'), 'F'),
  tool('room', msg('Room'), 'A'),
  tool('divider', msg('Room divider'), 'Shift+A'),
  { id: 'tool.calibrate', title: msg('Set the scale of an imported plan'), category: 'Tools', run: () => setTool('calibrate') },

  { id: 'warehouse.components', title: msg('Component library…'), category: 'Insert', global: true, run: () => useStore.setState({ warehouse: 'components' }) },
  { id: 'warehouse.extensions', title: msg('Extension warehouse…'), category: 'General', global: true, run: () => useStore.setState({ warehouse: 'extensions' }) },
  { id: 'page.add', title: msg('Add page'), category: 'Pages', run: () => apply([{ op: 'add_node', node: { type: 'page', name: t('Page {n}', { n: pagesOf(get().doc).length + 1 }) } }]) },
  { id: 'layer.add', title: msg('Add layer'), category: 'Layers', run: () => apply([{ op: 'add_layer', layer: { name: t('Layer {n}', { n: Object.keys(get().doc.layers).length + 1 }) } }]) },
]

/** Every command available right now, including those that depend on the drawing and on extensions. */
export function allCommands(): Command[] {
  const { doc } = get()
  return [
    ...STATIC,
    ...[...registry.parametric.values()].map((kind): Command => ({
      id: `place.${kind.kind}`,
      title: t('Place: {name}', { name: t(kind.label) }),
      keywords: `Place ${kind.label}`,
      category: 'Insert',
      run: () => setTool('place', { type: 'parametric', kind: kind.kind }),
    })),
    // Modifier kinds brought by extensions; the built-in ones have commands of their own above.
    ...[...registry.modifiers.values()].map((kind): Command => ({
      id: `modifier.${kind.type}`,
      title: t('Add modifier: {name}', { name: t(kind.label) }),
      keywords: `Add modifier ${kind.label}`,
      category: 'Edit',
      when: selected,
      run: () => addModifier(kind.type),
    })),
    ...componentsOf(doc).map((component): Command => ({
      id: `place.component.${component.id}`,
      title: t('Place component: {name}', { name: labelOf(doc, component) }),
      keywords: 'Place component',
      category: 'Insert',
      run: () => setTool('place', { type: 'instance', component: component.id }),
    })),
    ...pagesOf(doc).map((page): Command => ({
      id: `page.show.${page.id}`,
      title: t('Go to page: {name}', { name: labelOf(doc, page) }),
      keywords: 'Go to page',
      category: 'Pages',
      run: () => showPage(page.id),
    })),
    ...[...registry.commands.values()].map((command): Command => ({
      id: `extension.${command.id}`,
      title: command.title,
      category: 'Extensions',
      interrupts: true,
      run: () => runCommand(command.id),
    })),
  ]
}

/** The shortcuts currently bound to a command: the user's choice if they made one, else the defaults. */
export function keysOf(command: Command, overrides = useCommands.getState().overrides): string[] {
  return overrides[command.id] ?? command.keys ?? []
}

export const isCustomised = (id: string) => id in useCommands.getState().overrides

/**
 * Binds `key` to a command (or unbinds the command when `key` is null). A key belongs to one
 * command, so it is taken away from any other that had it; their titles are returned.
 */
export function setShortcut(id: string, key: string | null): string[] {
  const overrides = { ...useCommands.getState().overrides }
  const taken: string[] = []
  if (key) {
    for (const other of allCommands()) {
      if (other.id === id || !keysOf(other).includes(key)) continue
      overrides[other.id] = keysOf(other).filter((k) => k !== key)
      taken.push(other.title)
    }
  }
  overrides[id] = key ? [key] : []
  storeOverrides(overrides)
  return taken
}

export function resetShortcut(id: string): void {
  const { [id]: _, ...rest } = useCommands.getState().overrides
  storeOverrides(rest)
}

/**
 * The shortcut a key event stands for, e.g. "Mod+Shift+S", or null for a bare modifier. Letters
 * follow the keyboard layout; digits follow the key's position, so Shift+1 works on any layout.
 */
export function eventKey(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null
  const digit = /^Digit(\d)$/.exec(e.code)
  const name = digit ? digit[1] : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [(e.ctrlKey || e.metaKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift', name].filter(Boolean).join('+')
}

const SYMBOLS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: 'Del' }
const MAC_MODIFIERS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' }

/** A shortcut as shown to the user on this platform. */
export function formatKey(key: string): string {
  // The key itself may be "+", so only the separators before it are split on.
  const parts = key.match(/[^+]+|\+$/g) ?? [key]
  const shown = parts.map((part) => (isMac ? MAC_MODIFIERS[part] : part === 'Mod' ? 'Ctrl' : undefined) ?? SYMBOLS[part] ?? part)
  return shown.join(isMac ? '' : '+')
}

/** The first shortcut of a command, formatted, or '' when it has none. Re-renders when shortcuts change. */
export function useShortcutLabel(id: string): string {
  const overrides = useCommands((s) => s.overrides)
  const command = STATIC.find((c) => c.id === id)
  const key = command && keysOf(command, overrides)[0]
  return key ? formatKey(key) : ''
}

export const commandTitle = (id: string) => allCommands().find((c) => c.id === id)?.title ?? id

const listeners = new Set<(command: Command) => void>()

/** Calls `listener` after every command that ran. Returns the function that stops it. */
export function onCommand(listener: (command: Command) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function execute(command: Command): void {
  if (command.when && !command.when()) return
  command.run()
  for (const listener of listeners) listener(command)
}

export const executeById = (id: string) => {
  const command = allCommands().find((c) => c.id === id)
  if (command) execute(command)
}

/** Runs the command bound to a key press, if any. Installed once on the window. */
export function handleKeyDown(e: KeyboardEvent): void {
  const { overrides, paletteOpen } = useCommands.getState()
  if (paletteOpen) return
  const key = eventKey(e)
  if (!key) return
  const typing = (e.target as HTMLElement).closest('input, textarea, select') !== null
  const command = allCommands().find((c) => keysOf(c, overrides).includes(key) && (!typing || c.global) && (c.when?.() ?? true))
  if (!command) return
  e.preventDefault()
  execute(command)
}
