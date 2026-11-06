import { create } from 'zustand'
import { platform } from './platform'
import { buildScene, componentsOf, pagesOf, unusedComponents } from '@opencalque/core'
import {
  deleteSelection,
  deleteUnusedComponents,
  copySelection,
  cutSelection,
  duplicateSelection,
  exportDxf,
  groupSelection,
  exportSvg,
  importLibrary,
  makeComponent,
  vectorizeSelection,
  newDocument,
  openDocument,
  paste,
  reorderSelection,
  runCommand,
  saveDocument,
  ungroupSelection,
  zoomBy,
  zoomToFit,
  zoomToSelection,
  selectAlike,
  nudgeSelection,
  transformSelection,
  addModifier,
  exportPdf,
  canFitWalls,
  canFlipSide,
  flipSide,
  canSplitWall,
  canClosePolylines,
  canOpenPolylines,
  canCurvePolylines,
  canStraightenPolylines,
  setPolylines,
  splitWall,
  dimensionWalls,
  fitWalls,
  importDxf,
  openExample,
  alignSelection,
  distributeSelection,
  browseSelectedInstances,
  stepInstance,
  guarded,
} from './actions'
import { registry } from './extensions'
import { editComponent, showPage } from './navigation'
import { apply, redo, select, setTool, undo, useStore } from './store'
import { type Tool } from './tools'
import { toast, useWindows } from './windows'
import { PANELS, resetLayout, togglePanel, useDock, type PanelId } from './dock'
import { drawing } from './canvas/drawing'
import { importFile } from './drop'
import { importFloorPlan } from './floorplan'
import { msg, t } from './i18n'
import { setPrefs, usePrefs } from './prefs'
import { toggleTheme, useTheme } from './theme'
import { labelOf } from './ui'
import { checkForUpdate, useUpdate } from './updates'
import { RESERVED_KEYS, readShortcutsFile, settleShortcuts, shortcutsFile } from './shortcuts'

/**
 * Everything the user can trigger, in one list. The command palette, the keyboard handler, the
 * main menu and the toolbar tooltips all read from here, so a command added here shows up in all
 * of them and its shortcut can be changed by the user.
 */
export interface Command {
  id: string
  title: string
  /**
   * What the right-click menu calls it, where it is plain that it acts on what was clicked: "Delete"
   * rather than "Delete selection". The menu bar and the palette keep the title.
   */
  short?: string
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
const onlyInstance = () => get().selection.length === 1 && get().doc.nodes[get().selection[0]]?.type === 'instance'
/** One placement selected: an instance, or a parametric object, which is placed as a model is (`entries.ts`). */
const onlyPlacement = () => get().selection.length === 1 && ['instance', 'parametric'].includes(get().doc.nodes[get().selection[0]]?.type ?? '')
/** The placements of a component are being gone through (`InstanceBar`). */
const browsing = () => useWindows.getState().browsing !== null
/** One parametric object or one table of quantities selected: what can be made into the shapes it draws. */
const onlyVectorizable = () => get().selection.length === 1 && ['parametric', 'table'].includes(get().doc.nodes[get().selection[0]]?.type ?? '')
/** A line, a wall or a divider has its first point and is waiting for the next. */
const drawingLine = () => get().drawStep > 0 && ['line', 'curve', 'wall', 'divider'].includes(get().tool)
/** Something is being dragged with the select tool: moved, or reshaped by one of its points. */
const dragging = () => get().tool === 'select' && get().base !== null && !get().editingText
const canHold = () => drawingLine() || dragging()
/** Holds what is being drawn or dragged level or upright, or lets it go when it is already held that way. */
const lockAxis = (axis: 'x' | 'y') => {
  useStore.setState({ axisLock: get().axisLock === axis ? null : axis })
  drawing.refresh?.()
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const STORAGE_KEY = 'opencalque.shortcuts'
const SHORTCUTS_FILE = 'opencalque-shortcuts.json'

export { RESERVED_KEYS }

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
  { id: 'shortcuts.export', title: msg('Export keyboard shortcuts…'), category: 'General', keywords: 'export backup', run: exportShortcuts },
  { id: 'shortcuts.import', title: msg('Import keyboard shortcuts…'), category: 'General', keywords: 'import restore', run: importShortcuts },

  { id: 'file.new', title: msg('New drawing'), category: 'File', keys: ['Mod+N'], global: true, interrupts: true, run: newDocument },
  { id: 'file.open', title: msg('Open…'), category: 'File', keys: ['Mod+O'], global: true, interrupts: true, run: openDocument },
  { id: 'file.openExample', title: msg('Open the example drawing'), category: 'File', interrupts: true, run: openExample },
  { id: 'file.save', title: msg('Save'), category: 'File', keys: ['Mod+S'], global: true, interrupts: true, run: () => saveDocument() },
  { id: 'file.saveAs', title: msg('Save as…'), category: 'File', keys: ['Mod+Shift+S'], global: true, interrupts: true, run: () => saveDocument(true) },
  { id: 'file.autosave', title: msg('Save automatically'), category: 'File', checked: () => prefs().autosave, run: () => setPrefs({ autosave: !prefs().autosave }) },
  { id: 'file.import', title: msg('Import…'), category: 'File', keys: ['Mod+I'], global: true, interrupts: true, keywords: 'pdf picture image dxf library components extension plan', run: importFile },
  { id: 'file.drawingSettings', title: msg('Drawing settings…'), category: 'File', global: true, interrupts: true, keywords: 'units decimal comma square feet metres project client address author', run: () => useWindows.setState({ drawingSettingsOpen: true }) },
  { id: 'file.export', title: msg('Export…'), category: 'File', keys: ['Mod+P', 'Mod+E'], global: true, interrupts: true, keywords: 'pdf svg dxf print', run: () => useWindows.setState({ exportOpen: true }) },
  { id: 'file.importPlan', title: msg('Import floor plan (PDF or picture)…'), category: 'File', interrupts: true, run: importFloorPlan },
  { id: 'file.importDxf', title: msg('Import DXF (from other CAD programs)…'), category: 'File', interrupts: true, run: importDxf },
  { id: 'file.importLibrary', title: msg('Import component library…'), category: 'File', interrupts: true, run: importLibrary },
  { id: 'file.exportDxf', title: msg('Export DXF (for other CAD programs)…'), category: 'File', run: () => exportDxf() },
  { id: 'file.exportPdf', title: msg('Export PDF (sheets, to scale)…'), category: 'File', run: () => exportPdf() },
  { id: 'file.exportSvg', title: msg('Export SVG…'), category: 'File', run: () => exportSvg() },

  { id: 'edit.undo', title: msg('Undo'), category: 'Edit', keys: ['Mod+Z'], interrupts: true, run: undo },
  { id: 'edit.redo', title: msg('Redo'), category: 'Edit', keys: ['Mod+Shift+Z', 'Mod+Y'], interrupts: true, run: redo },
  { id: 'edit.delete', title: msg('Delete selection'), short: msg('Delete'), category: 'Edit', keys: ['Delete', 'Backspace'], interrupts: true, run: deleteSelection },
  { id: 'edit.cut', title: msg('Cut'), category: 'Edit', keys: ['Mod+X'], interrupts: true, when: selected, run: cutSelection },
  { id: 'edit.copy', title: msg('Copy'), category: 'Edit', keys: ['Mod+C'], when: selected, run: copySelection },
  { id: 'edit.paste', title: msg('Paste'), category: 'Edit', keys: ['Mod+V'], interrupts: true, run: () => paste() },
  { id: 'edit.pasteInPlace', title: msg('Paste in place'), category: 'Edit', keys: ['Mod+Shift+V'], interrupts: true, keywords: 'same position page floor', run: () => paste(true) },
  { id: 'edit.duplicate', title: msg('Duplicate selection'), short: msg('Duplicate'), category: 'Edit', keys: ['Mod+D'], interrupts: true, run: duplicateSelection },
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
  { id: 'edit.selectSimilar', title: msg('Select similar'), category: 'Edit', keys: ['Mod+Shift+A'], when: selected, keywords: 'same alike matching', run: () => selectAlike('similar') },
  { id: 'edit.selectSameType', title: msg('Select all of the same type'), category: 'Edit', when: selected, keywords: 'similar kind', run: () => selectAlike('type') },
  { id: 'edit.selectSameLayer', title: msg('Select all on the same layer'), category: 'Edit', when: selected, keywords: 'similar', run: () => selectAlike('layer') },
  { id: 'edit.selectSameMaterial', title: msg('Select all of the same material'), category: 'Edit', when: () => get().selection.some((id) => ['wall', 'room'].includes(get().doc.nodes[id]?.type)), keywords: 'similar walls floors', run: () => selectAlike('material') },
  { id: 'edit.deselect', title: msg('Deselect all'), category: 'Edit', run: () => select([]) },
  { id: 'edit.bringToFront', title: msg('Bring to front'), category: 'Edit', keys: [']'], when: selected, run: () => reorderSelection('front') },
  { id: 'edit.bringForward', title: msg('Bring forward'), category: 'Edit', keys: ['Mod+]'], when: selected, run: () => reorderSelection('forward') },
  { id: 'edit.sendBackward', title: msg('Send backward'), category: 'Edit', keys: ['Mod+['], when: selected, run: () => reorderSelection('backward') },
  { id: 'edit.sendToBack', title: msg('Send to back'), category: 'Edit', keys: ['['], when: selected, run: () => reorderSelection('back') },
  { id: 'edit.rotateRight', title: msg('Rotate 90° clockwise'), category: 'Edit', keys: ['Shift+R'], when: selected, run: () => transformSelection({ rotation: 90 }) },
  { id: 'edit.rotateLeft', title: msg('Rotate 90° counter-clockwise'), category: 'Edit', keys: ['Alt+Shift+R'], when: selected, run: () => transformSelection({ rotation: -90 }) },
  { id: 'edit.flipHorizontal', title: msg('Mirror horizontally'), category: 'Edit', keys: ['Shift+H'], when: selected, run: () => transformSelection({ mirror: 'horizontal' }) },
  { id: 'edit.flipVertical', title: msg('Mirror vertically'), category: 'Edit', keys: ['Shift+V'], when: selected, run: () => transformSelection({ mirror: 'vertical' }) },
  { id: 'edit.scaleUp', title: msg('Scale up by 10%'), category: 'Edit', when: selected, run: () => transformSelection({ scale: 1.1 }) },
  { id: 'edit.scaleDown', title: msg('Scale down by 10%'), category: 'Edit', when: selected, run: () => transformSelection({ scale: 1 / 1.1 }) },
  // Listed before the arrow keys' other use: while a line is being drawn there is nothing selected to move.
  { id: 'draw.lockLevel', title: msg('Keep what is being drawn or dragged level'), category: 'Tools', keys: ['ArrowLeft', 'ArrowRight'], keywords: 'axis lock horizontal', when: canHold, run: () => lockAxis('x') },
  { id: 'draw.lockUpright', title: msg('Keep what is being drawn or dragged upright'), category: 'Tools', keys: ['ArrowUp', 'ArrowDown'], keywords: 'axis lock vertical', when: canHold, run: () => lockAxis('y') },
  { id: 'edit.nudgeLeft', title: msg('Move left by one grid step'), category: 'Edit', keys: ['ArrowLeft'], when: selected, run: () => nudgeSelection(-1, 0) },
  { id: 'edit.nudgeRight', title: msg('Move right by one grid step'), category: 'Edit', keys: ['ArrowRight'], when: selected, run: () => nudgeSelection(1, 0) },
  { id: 'edit.nudgeUp', title: msg('Move up by one grid step'), category: 'Edit', keys: ['ArrowUp'], when: selected, run: () => nudgeSelection(0, -1) },
  { id: 'edit.nudgeDown', title: msg('Move down by one grid step'), category: 'Edit', keys: ['ArrowDown'], when: selected, run: () => nudgeSelection(0, 1) },
  { id: 'wall.split', title: msg('Split the wall in two'), category: 'Edit', keywords: 'split cut divide corner', when: canSplitWall, run: splitWall },
  { id: 'wall.extend', title: msg('Extend walls to the next wall'), category: 'Edit', keywords: 'extend lengthen', when: canFitWalls, run: () => fitWalls('extend') },
  { id: 'shape.close', title: msg('Close the shape'), category: 'Edit', keywords: 'polygon polyline join', when: canClosePolylines, run: () => setPolylines({ closed: true }) },
  { id: 'shape.open', title: msg('Open the shape'), category: 'Edit', keywords: 'polygon polyline', when: canOpenPolylines, run: () => setPolylines({ closed: null }) },
  { id: 'shape.curve', title: msg('Curve the line through its points'), category: 'Edit', keywords: 'smooth spline round polyline', when: canCurvePolylines, run: () => setPolylines({ smooth: true }) },
  { id: 'shape.straighten', title: msg('Straighten the line between its points'), category: 'Edit', keywords: 'straight sharp polyline', when: canStraightenPolylines, run: () => setPolylines({ smooth: null }) },
  { id: 'wall.dimension', title: msg('Dimension the selected walls'), category: 'Edit', keywords: 'chain dimensions openings', when: canFitWalls, run: dimensionWalls },
  { id: 'wall.trim', title: msg('Trim walls that stick out'), category: 'Edit', keywords: 'trim cut shorten', when: canFitWalls, run: () => fitWalls('trim') },
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
  { id: 'edit.group', title: msg('Group selection'), short: msg('Group together'), category: 'Edit', keys: ['Mod+G'], interrupts: true, when: selected, run: groupSelection },
  {
    id: 'edit.ungroup',
    title: msg('Ungroup'),
    category: 'Edit',
    keys: ['Mod+Shift+G'],
    interrupts: true,
    // A group, or a component, whose contents then become objects of the drawing.
    when: () => get().selection.some((id) => ['group', 'instance'].includes(get().doc.nodes[id]?.type ?? '')),
    run: ungroupSelection,
  },

  // A component alone is one already: making another from it would only wrap it.
  { id: 'component.vectorize', title: msg('Vectorize'), category: 'Edit', interrupts: true, when: onlyVectorizable, run: vectorizeSelection },
  { id: 'component.browse', title: msg('Go through the instances of this component'), category: 'Components', keywords: 'find placements next', when: onlyPlacement, run: browseSelectedInstances },
  { id: 'component.nextInstance', title: msg('Next instance'), category: 'Components', keys: ['Alt+ArrowRight'], when: browsing, run: () => stepInstance(1) },
  { id: 'component.previousInstance', title: msg('Previous instance'), category: 'Components', keys: ['Alt+ArrowLeft'], when: browsing, run: () => stepInstance(-1) },
  { id: 'component.create', title: msg('Make into a component'), category: 'Components', keys: ['Mod+Alt+K'], interrupts: true, when: () => selected() && !onlyInstance(), run: makeComponent },
  { id: 'component.purge', title: msg('Delete unused components'), category: 'Components', when: () => unusedComponents(get().doc).length > 0, run: deleteUnusedComponents },
  { id: 'component.finish', title: msg('Finish editing this group or component'), category: 'Components', when: () => get().scope !== get().page, run: () => editComponent(null) },

  { id: 'view.zoomToFit', title: msg('Zoom to fit'), category: 'View', keys: ['Shift+1'], run: zoomToFit },
  { id: 'view.zoomToSelection', title: msg('Zoom to selection'), short: msg('Zoom to it'), category: 'View', keys: ['Shift+2'], when: selected, run: zoomToSelection },
  { id: 'view.zoomIn', title: msg('Zoom in'), category: 'View', keys: ['+', 'Shift++', 'Mod+='], run: () => zoomBy(1.25) },
  { id: 'view.toggleTheme', title: msg('Dark theme'), category: 'View', keywords: 'dark light mode appearance colours', checked: () => useTheme.getState().dark, run: toggleTheme },
  { id: 'view.toggleGrid', title: msg('Show grid'), category: 'View', checked: () => prefs().showGrid, run: () => setPrefs({ showGrid: !prefs().showGrid }) },
  {
    id: 'view.toggleClearances',
    title: msg('Show temporary dimensions'),
    category: 'View',
    keywords: 'clearance distance walls revit',
    checked: () => prefs().showClearances,
    run: () => setPrefs({ showClearances: !prefs().showClearances }),
  },
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
  panel('components'),
  panel('objects'),
  panel('colors'),
  panel('materials'),
  panel('dimensionStyles'),
  panel('properties'),
  panel('assistant', ['Mod+J']),
  { id: 'view.resetLayout', title: msg('Reset the panel layout'), category: 'View', run: resetLayout },
  { id: 'help.welcome', title: msg('Welcome window…'), category: 'General', global: true, run: () => useWindows.setState({ welcomeOpen: true }) },
  { id: 'help.about', title: msg('About OpenCalque and what is new…'), category: 'General', global: true, run: () => useWindows.setState({ aboutOpen: true }) },
  { id: 'prefs.open', title: msg('Preferences…'), category: 'General', keys: ['Mod+,'], global: true, run: () => useWindows.setState({ preferencesOpen: true }) },
  { id: 'view.zoomOut', title: msg('Zoom out'), category: 'View', keys: ['-', 'Mod+-'], run: () => zoomBy(0.8) },

  tool('select', msg('Select'), 'V'),
  tool('hand', msg('Pan'), 'H'),
  tool('line', msg('Line'), 'L'),
  tool('curve', msg('Curved line'), 'Shift+L'),
  tool('arc', msg('Arc'), 'Shift+O'),
  // Listed before the rectangle tool so that R rotates while an object is being placed.
  {
    id: 'place.rotate',
    title: msg('Rotate the object being placed'),
    category: 'Tools',
    keys: ['R'],
    when: () => get().tool === 'place',
    run: () => useStore.setState({ placingRotation: (get().placingRotation + 90) % 360 }),
  },
  {
    id: 'edit.flipSide',
    title: msg('Flip: the wall being drawn to the other side, a door to its other hinge'),
    category: 'Edit',
    keywords: 'flip swap side hinge swing turn over',
    keys: ['Shift+Space'],
    when: canFlipSide,
    run: flipSide,
  },
  tool('rect', msg('Rectangle'), 'R'),
  tool('ellipse', msg('Ellipse'), 'O'),
  tool('wall', msg('Wall'), 'W'),
  tool('dimension', msg('Dimension'), 'D'),
  tool('measure', msg('Measure'), 'M'),
  tool('angle', msg('Measure an angle'), 'Shift+M'),
  tool('split', msg('Split'), 'K'),
  tool('trim', msg('Trim'), 'X'),
  tool('offset', msg('Offset a line or a shape'), 'Shift+X'),
  tool('rotate', msg('Rotate'), 'E'),
  tool('eyedropper', msg('Eyedropper: copy the look of an object'), 'I'),
  tool('text', msg('Text'), 'T'),
  tool('annotation', msg('Annotation'), 'Shift+T'),
  tool('gridline', msg('Grid line'), 'G'),
  tool('paper', msg('Paper'), 'F'),
  tool('room', msg('Room'), 'A'),
  tool('divider', msg('Room divider'), 'Shift+A'),
  { id: 'tool.calibrate', title: msg('Set the scale of an imported plan'), category: 'Tools', run: () => setTool('calibrate') },

  { id: 'warehouse.components', title: msg('Object library…'), category: 'Insert', global: true, run: () => useWindows.setState({ warehouse: 'components' }) },
  { id: 'warehouse.extensions', title: msg('Extensions…'), category: 'General', global: true, run: () => useWindows.setState({ preferencesOpen: true, preferencesPage: 'extensions' }) },
  { id: 'page.add', title: msg('Add page'), category: 'Pages', run: () => apply([{ op: 'add_node', node: { type: 'page', name: t('Page {n}', { n: pagesOf(get().doc).length + 1 }) } }]) },
  { id: 'layer.add', title: msg('Add layer'), category: 'Layers', run: () => apply([{ op: 'add_layer', layer: { name: t('Layer {n}', { n: Object.keys(get().doc.layers).length + 1 }) } }]) },
]

const update = useUpdate.getState

const UPDATES: Command[] = [
  { id: 'app.checkUpdate', title: msg('Check for a new version…'), category: 'General', keywords: 'update upgrade', run: checkForUpdate },
  { id: 'app.installUpdate', title: msg('Restart to install the new version'), category: 'General', keywords: 'update upgrade', when: () => update().status === 'ready', run: () => platform.installUpdate?.() },
  {
    id: 'app.downloadUpdate',
    title: msg('Download the new version'),
    category: 'General',
    keywords: 'update upgrade',
    when: () => update().status === 'available',
    // The desktop app opens the page in the browser.
    run: () => {
      const state = update()
      if (state.status === 'available') window.open(state.url, '_blank')
    },
  },
]

/** Every command available right now, including those that depend on the drawing and on extensions. */
export function allCommands(): Command[] {
  const { doc } = get()
  return [
    ...STATIC,
    // The desktop app copies a drawing before it first writes over it; the web app has no such folder.
    ...(platform.showBackups ? [{ id: 'file.backups', title: msg('Show backups of drawings'), category: 'File', run: () => platform.showBackups?.() }] : []),
    // The desktop app looks for newer versions of itself; the web app is always the newest.
    ...(platform.checkForUpdate ? UPDATES : []),
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

/** Saves the shortcuts the user changed to a file, to load them on another computer or after a reinstall. */
function exportShortcuts(): void {
  void guarded(async () => {
    const saved = await platform.save(shortcutsFile(useCommands.getState().overrides), SHORTCUTS_FILE)
    if (saved) toast(t('Keyboard shortcuts exported'))
  })
}

/** Replaces the user's shortcuts with those of a file saved by `exportShortcuts`. */
function importShortcuts(): void {
  void guarded(async () => {
    const file = await platform.open(['json'])
    if (!file) return
    let overrides
    try {
      overrides = readShortcutsFile(file.content)
    } catch {
      throw new Error(t('{file} is not a file of keyboard shortcuts', { file: file.name }))
    }
    storeOverrides(settleShortcuts(overrides, allCommands()))
    toast(t('Keyboard shortcuts imported'))
  })
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

/** Keys a slider moves by, which it keeps rather than letting them nudge the selection. */
const SLIDER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

/**
 * Whether a key pressed in a field is for the field rather than a command: every key in a text
 * field or a list, the keys that move a slider, none on a checkbox. So Ctrl+Z still undoes right
 * after a slider was dragged or a box ticked.
 */
function forTheField(e: KeyboardEvent): boolean {
  const field = (e.target as HTMLElement).closest('input, textarea, select')
  if (!(field instanceof HTMLInputElement)) return field !== null
  if (field.type === 'checkbox' || field.type === 'radio' || field.type === 'button') return false
  return field.type !== 'range' || SLIDER_KEYS.includes(e.key)
}

/** The command a key press runs, if any: one bound to it that applies now. */
export function commandFor(e: KeyboardEvent): Command | null {
  const { overrides, paletteOpen } = useCommands.getState()
  if (paletteOpen) return null
  const key = eventKey(e)
  if (!key) return null
  const typing = forTheField(e)
  return allCommands().find((c) => keysOf(c, overrides).includes(key) && (!typing || c.global) && (c.when?.() ?? true)) ?? null
}

/** Runs the command bound to a key press, if any. Installed once on the window. */
export function handleKeyDown(e: KeyboardEvent): void {
  const command = commandFor(e)
  if (!command) return
  e.preventDefault()
  execute(command)
}
