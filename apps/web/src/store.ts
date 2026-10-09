import { create } from 'zustand'
import { applyOps, createDocument, declarativeExtension, holdsChildren, layersOf, pagesOf, Registry, type Document, type NodeInput, type Op, type Vec2 } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import type { StoredFile } from './platform'
import { usePrefs } from './prefs'

/** The one extension that is compiled into the app. It can be switched off but not removed. */
export const BUILT_IN_EXTENSION = architecture.id

/**
 * The extensions in use. It is always this same object; `loadExtensions` refills it, and
 * `extensionsVersion` in the store changes so that whatever depends on it redraws.
 */
export const registry = new Registry()

export type Tool = 'select' | 'hand' | 'line' | 'rect' | 'ellipse' | 'polyline' | 'wall' | 'dimension' | 'measure' | 'calibrate' | 'eyedropper' | 'text' | 'annotation' | 'paper' | 'room' | 'divider' | 'place'
/** The plain shapes, which share one toolbar button. */
export const SHAPE_TOOLS: Tool[] = ['line', 'rect', 'ellipse', 'polyline']
/** The tools for naming spaces, which share another. */
export const ROOM_TOOLS: Tool[] = ['room', 'divider']
/** The tools for writing on the drawing, which share a third. */
export const TEXT_TOOLS: Tool[] = ['text', 'annotation']

export type Placing = { type: 'instance'; component: string } | { type: 'parametric'; kind: string }

export interface View {
  /** Screen position of the world origin, in CSS pixels. */
  x: number
  y: number
  /** Pixels per millimetre. */
  zoom: number
}

interface State {
  doc: Document
  past: Document[]
  future: Document[]
  /** The document before the gesture in progress; `doc` is then a preview that is not in history yet. */
  base: Document | null
  saved: Document
  file: StoredFile | null
  /** The page being shown, or the one to return to while a component is being edited. */
  page: string
  /** The page, component or group whose direct children are shown and edited. */
  scope: string
  selection: string[]
  /**
   * The wall corner that is selected, as the point where the wall ends are: a corner is not an
   * object of its own, so it is known by where it is. It and `selection` are never both set.
   */
  corner: Vec2 | null
  tool: Tool
  placing: Placing | null
  /** Rotation, in degrees, of the object following the cursor in the place tool. */
  placingRotation: number
  activeLayer: string
  wallThickness: number
  /** The drawing scale (the N of 1:N) given to the papers the paper tool makes, which sets how large the standard formats are. */
  paperScale: number
  /** The shape tool used last, shown on the toolbar's shape button. */
  shapeTool: Tool
  /** Likewise for the room button. */
  roomTool: Tool
  /** And for the text button. */
  textTool: Tool
  /**
   * Sizes typed in the quick bar for the shape being drawn; they win over the pointer. For a
   * rectangle or ellipse `a` is the width and `b` the height; for a line, wall or polyline segment
   * `a` is the length and `b` the angle in degrees, counter-clockwise from the right.
   */
  drawLocks: { a?: number; b?: number }
  /** The same two sizes as they currently are while drawing, to show in the quick bar. */
  drawLive: { a: number; b: number } | null
  /**
   * How far the shape being drawn has got: 0 when nothing is started, then the number of points
   * placed so far. Hints and the size fields show only what applies at that step.
   */
  drawStep: number
  /** Stroke colour given to the shapes drawn next, or null for the layer's colour. */
  drawColor: string | null
  /** Likewise their line weight, in pixels, and their pattern of dashes; null leaves each as it comes. */
  drawWeight: number | null
  drawDash: number[] | null
  /** Look of the dimensions the dimension tool draws next: any dimension property except its points. */
  dimensionTemplate: Record<string, unknown>
  /** Likewise for the annotations the annotation tool draws next: their ends, curve and text size. */
  annotationTemplate: Record<string, unknown>
  /** The two points picked with the calibrate tool, waiting for their real distance. */
  calibration: { a: Vec2; b: Vec2 } | null
  preferencesOpen: boolean
  welcomeOpen: boolean
  aboutOpen: boolean
  /**
   * The text being typed in place. `create` is the node to add when it is a new text that is not in
   * the drawing yet (it exists only as a preview until the typing ends).
   */
  editingText: { id: string; create?: NodeInput } | null
  /** Which tab of the warehouse dialog is open, if any. */
  warehouse: 'components' | 'extensions' | null
  /** Bumped whenever the set of extensions in use changes. */
  extensionsVersion: number
  /** Where the right-click menu is open, in window coordinates. */
  contextMenu: { x: number; y: number } | null
  view: View
  viewport: { width: number; height: number }
  status: string
  toast: string | null
}

const HISTORY_LIMIT = 200

function initial(doc: Document, file: StoredFile | null): State {
  const page = pagesOf(doc)[0].id
  return {
    doc,
    past: [],
    future: [],
    base: null,
    saved: doc,
    file,
    page,
    scope: page,
    selection: [],
    corner: null,
    tool: 'select',
    placing: null,
    placingRotation: 0,
    activeLayer: layersOf(doc)[0].id,
    wallThickness: 200,
    paperScale: 100,
    shapeTool: 'rect',
    roomTool: 'room',
    textTool: 'text',
    annotationTemplate: {},
    drawLocks: {},
    drawLive: null,
    drawStep: 0,
    drawColor: null,
    drawWeight: null,
    drawDash: null,
    dimensionTemplate: {},
    calibration: null,
    preferencesOpen: false,
    welcomeOpen: false,
    aboutOpen: false,
    contextMenu: null,
    warehouse: null,
    editingText: null,
    extensionsVersion: 0,
    view: { x: 320, y: 220, zoom: 0.1 },
    viewport: { width: 0, height: 0 },
    status: '',
    toast: null,
  }
}

export const useStore = create<State>(() => initial(createDocument(), null))
const get = useStore.getState
const set = useStore.setState

/** State that refers to things in the document, repaired after the document changed under it. */
function settle(s: State, doc: Document): Partial<State> {
  const page = doc.nodes[s.page]?.type === 'page' ? s.page : pagesOf(doc)[0].id
  const scopeNode = doc.nodes[s.scope]
  const scope = scopeNode && holdsChildren(scopeNode) ? s.scope : page
  return {
    doc,
    page,
    scope,
    selection: s.selection.filter((id) => doc.nodes[id]?.parent === scope),
    activeLayer: doc.layers[s.activeLayer] ? s.activeLayer : layersOf(doc)[0].id,
  }
}

/**
 * Puts the built-in extension (unless switched off) and every installed one into the registry.
 * An installed extension that no longer loads is skipped, so one bad file cannot stop the app.
 */
export function loadExtensions(): void {
  const { installed, disabled } = usePrefs.getState().extensions
  registry.clear()
  if (!disabled.includes(BUILT_IN_EXTENSION)) registry.use(architecture)
  for (const extension of Object.values(installed)) {
    try {
      registry.use(declarativeExtension(extension))
    } catch (error) {
      console.warn(`Extension ${extension.id} was not loaded:`, error)
    }
  }
  set({ extensionsVersion: get().extensionsVersion + 1 })
}

export function toast(message: string): void {
  set({ toast: message })
  setTimeout(() => get().toast === message && set({ toast: null }), 4000)
}

/** Replaces the document as one undoable step. */
export function replaceDoc(doc: Document): void {
  const s = get()
  const before = s.base ?? s.doc
  if (doc === before) return set({ ...settle(s, doc), base: null })
  set({ ...settle(s, doc), base: null, past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] })
}

/** Applies operations as one undoable step. Reports failures to the user and returns false. */
export function apply(ops: Op[]): boolean {
  try {
    replaceDoc(applyOps(get().doc, ops))
    return true
  } catch (error) {
    toast((error as Error).message)
    return false
  }
}

/**
 * Shows the result of operations without recording them, always computed from the document as it
 * was when the gesture started. Follow with `commit` or `cancel`.
 */
export function preview(ops: Op[]): boolean {
  const s = get()
  const base = s.base ?? s.doc
  try {
    set({ ...settle(s, applyOps(base, ops)), base })
    return true
  } catch (error) {
    set({ status: (error as Error).message.split('\n')[0] })
    return false
  }
}

/**
 * Merges every undo step taken since the history was `mark` entries long into one, so that a
 * request carried out in several edits (as the assistant does) is undone in one go.
 */
export function collapseHistory(mark: number): void {
  const { past } = get()
  if (past.length > mark + 1) set({ past: past.slice(0, mark + 1) })
}

export function commit(): void {
  if (get().base) replaceDoc(get().doc)
}

export function cancel(): void {
  const s = get()
  if (s.base) set({ ...settle(s, s.base), base: null })
}

export function undo(): void {
  cancel()
  const s = get()
  const doc = s.past.at(-1)
  if (doc) set({ ...settle(s, doc), past: s.past.slice(0, -1), future: [...s.future, s.doc] })
}

export function redo(): void {
  cancel()
  const s = get()
  const doc = s.future.at(-1)
  if (doc) set({ ...settle(s, doc), future: s.future.slice(0, -1), past: [...s.past, s.doc] })
}

export function loadDocument(doc: Document, file: StoredFile | null): void {
  // Tool settings belong to the session, not the document.
  const { viewport, wallThickness, paperScale, dimensionTemplate, annotationTemplate, extensionsVersion, shapeTool, roomTool, textTool, drawColor, drawWeight, drawDash } = get()
  set({ ...initial(doc, file), viewport, wallThickness, paperScale, dimensionTemplate, annotationTemplate, extensionsVersion, shapeTool, roomTool, textTool, drawColor, drawWeight, drawDash })
}

export function setTool(tool: Tool, placing: Placing | null = null): void {
  const shapeTool = SHAPE_TOOLS.includes(tool) ? tool : get().shapeTool
  const roomTool = ROOM_TOOLS.includes(tool) ? tool : get().roomTool
  const textTool = TEXT_TOOLS.includes(tool) ? tool : get().textTool
  set({ tool, placing, shapeTool, roomTool, textTool, corner: null, placingRotation: 0, calibration: null, drawLocks: {}, drawLive: null, drawStep: 0, status: '' })
}

export function select(ids: string[]): void {
  set({ selection: ids, corner: null })
}

/** Selects the wall corner at a point, in place of any objects. */
export function selectCorner(at: Vec2 | null): void {
  set({ selection: [], corner: at })
}

export function showPage(id: string): void {
  set({ page: id, scope: id, selection: [] })
}

/**
 * Goes inside a component or group to edit what it contains, or with null comes back out: from a
 * group to whatever holds it (leaving the group selected), from a component to the page.
 */
export function editComponent(id: string | null): void {
  if (id !== null) return set({ scope: id, selection: [] })
  const { doc, scope, page } = get()
  const inside = doc.nodes[scope]
  if (inside?.type === 'group' && inside.parent) set({ scope: inside.parent, selection: [inside.id] })
  else set({ scope: page, selection: [] })
}

export const isDirty = (s: State = get()) => (s.base ?? s.doc) !== s.saved

loadExtensions()
