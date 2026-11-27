import { create } from 'zustand'
import { applyEdit, applyOps, span, createDocument, holdsChildren, layerIn, layersOf, newId, pagesOf, roomsAfterEdit, type Document, type NodeInput, type NodeOf, type Op, type Pattern, type Vec2, wallEndsAt } from '@opencalque/core'
import { registry } from './extensions'
import { t } from './i18n'
import { usePrefs } from './prefs'
import type { StoredFile } from './platform'
import type { Tool } from './tools'
import type { View } from './view'
import { closeWindows, toast } from './windows'

export type { Tool } from './tools'
export type { View } from './view'

/**
 * What the place tool puts down; `carried` while it is being dragged from the object library, to be
 * put down where the button is let go. A component of a library comes into the drawing with its
 * first placement, in the same step, so that none is left behind when the placing is given up;
 * `names` are the library's translations, in the language in use. A table of quantities is put
 * down as it is given, its top-left corner where the pointer is.
 */
export type Placing = (
  | { type: 'instance'; component: string }
  | { type: 'parametric'; kind: string; props?: Record<string, unknown> }
  | { type: 'library'; library: Document; component: string; names: Record<string, string> }
  | { type: 'table'; table: Omit<NodeOf<'table'>, 'id' | 'parent' | 'order' | 'x' | 'y'> }
  /**
   * A view, put down holding its line: its name, and what it sees. With `sided`, a section: the
   * side of its line it is put down on is the side it is seen from.
   */
  | { type: 'elevation'; name: string; line: { a: Vec2; b: Vec2; depth?: number }; sided?: boolean }
) & { carried?: boolean }

/**
 * One undoable step. In `past`, `doc` is the drawing before the step; in `future`, the drawing after
 * it. Either way `ops` are the operations that turn the earlier of the two into the later: every
 * change the editor records is a list of operations, which is what a shared drawing would send.
 */
export interface Step {
  doc: Document
  ops: Op[]
}

/** The open drawing, its history, and where in it the user is. Opening another drawing replaces all of it. */
interface Session {
  doc: Document
  past: Step[]
  future: Step[]
  /** The document before the gesture in progress; `doc` is then a preview that is not in history yet. */
  base: Document | null
  saved: Document
  file: StoredFile | null
  /** The page being shown, or the one to return to while a component is being edited. */
  page: string
  /** The page, component or group whose direct children are shown and edited. */
  scope: string
  /**
   * The instances double-clicked, outermost first, to reach the component being edited from the
   * page, so the view can keep it where it was drawn; null when it was opened some other way.
   */
  through: string[] | null
  /**
   * The deepest place left, with the placements it was reached through, while the way to the scope
   * still leads into it: the breadcrumb shows what is past the scope, to go back in at once.
   */
  trail: { scope: string; through: string[] | null } | null
  selection: string[]
  /**
   * The wall corner that is selected, as the point where the wall ends are: a corner is not an
   * object of its own, so it is known by where it is. It and `selection` are never both set.
   */
  corner: Vec2 | null
  activeLayer: string
  view: View
}

/** What is being done right now: the tool, the shape in progress, what the pointer is on. Opening a drawing starts it afresh. */
interface Interaction {
  tool: Tool
  placing: Placing | null
  /** Rotation, in degrees, of the object following the cursor in the place tool. */
  placingRotation: number
  /**
   * Sizes typed in the quick bar for the shape being drawn; they win over the pointer. For a
   * rectangle or ellipse `a` is the width and `b` the height; for a line, wall or polyline segment
   * `a` is the length and `b` the angle in degrees, counter-clockwise from the right.
   */
  drawLocks: { a?: number; b?: number }
  /**
   * The direction the line being drawn is held to, with the arrow keys: 'x' keeps it level, 'y'
   * upright. The pointer then only says how far it goes, and may say so by pointing at something
   * elsewhere. Let go when the line is finished.
   */
  axisLock: 'x' | 'y' | null
  /** The same two sizes as they currently are while drawing, to show in the quick bar. */
  drawLive: { a: number; b: number } | null
  /**
   * How far the shape being drawn has got: 0 when nothing is started, then the number of points
   * placed so far. Hints and the size fields show only what applies at that step.
   */
  drawStep: number
  /** The two points picked with the calibrate tool, waiting for their real distance. */
  calibration: { a: Vec2; b: Vec2 } | null
  /** The line of a wall the pointer is over in the properties panel, to show on the drawing. */
  edgeHover: { wall: string; edge: 'left' | 'right' | 'a' | 'b' } | null
  /**
   * Set while the pointer is on a face of the selected wall, or drags one to change its thickness,
   * or is on the line across one of its free ends, or drags it to change its length: for the hints
   * to say so.
   */
  wallFace: 'hover' | 'drag' | 'end hover' | 'end drag' | null
  /**
   * The text being typed in place. `create` is the node to add when it is a new text that is not in
   * the drawing yet (it exists only as a preview until the typing ends).
   */
  /** The node whose words are being typed in place; for a grid line, which of its bubbles (`gridlineBubbles`). */
  editingText: { id: string; create?: NodeInput; bubble?: number } | null
  /** Which of the temporary dimensions of the one selected object (`clearances`) is being typed, by its place in their list. */
  measuring: number | null
  /**
   * Which part of the view selected was picked: its line or eye on the plan (`line`), or its
   * picture (`view`). Properties opens on that part's settings. Any other selecting forgets it.
   */
  viewPart: ViewPart | null
  /** Where the right-click menu is open, in window coordinates. */
  contextMenu: { x: number; y: number } | null
  /** Where on the drawing the last right-click was, for commands of its menu that act at that very place. */
  menuPoint: Vec2 | null
  status: string
}

/** How the tools draw, as the user left them: these belong to the session, not to a drawing, and outlive opening another. */
interface ToolSettings {
  wallThickness: number
  /** Where the points clicked with the wall tool lie on the wall: along its middle, or along its left or right face as it is drawn. */
  wallJustify: 'left' | 'center' | 'right'
  /** The material the wall tool draws walls of, by its id; null for the default. Left out of a drawing that does not have it. */
  wallMaterial: string | null
  /** The drawing scale (the N of 1:N) given to the papers the paper tool makes, which sets how large the standard formats are. */
  paperScale: number
  /**
   * The tools used, the last first, each once: a button of the toolbar that lists several shows
   * the one of them used last (`toolbar.ts`). It starts with those its lists showed before any was used.
   */
  recentTools: Tool[]
  /** Stroke colour given to the shapes drawn next, or null for the layer's colour. */
  drawColor: string | null
  /** The fill of the closed shapes drawn next, its colour and its pattern; null for none. */
  drawFill: string | null
  drawPattern: Pattern | null
  /** Look of the dimensions the dimension tool draws next: any dimension property except its points. */
  dimensionTemplate: Record<string, unknown>
  /** Likewise for the annotations the annotation tool draws next: their ends, curve and text size. */
  annotationTemplate: Record<string, unknown>
  /** Likewise for the grid lines drawn next, with the label of the next one, which goes up by one as each is drawn. */
  gridlineTemplate: Record<string, unknown>
}

/** The size of the drawing area on screen, which outlives drawings too. */
interface Screen {
  viewport: { width: number; height: number }
}

type State = Session & Interaction & ToolSettings & Screen

const HISTORY_LIMIT = 200

/** The layer a drawing opens on: the one in use when it was saved (`forFile`), if it is still there, else the first. */
function layerToOpen(doc: Document): string {
  const kept = doc.meta?.activeLayer
  return typeof kept === 'string' && Object.hasOwn(doc.layers, kept) ? kept : layersOf(doc)[0].id
}

function session(doc: Document, file: StoredFile | null): Session {
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
    through: [],
    trail: null,
    selection: [],
    corner: null,
    activeLayer: layerToOpen(doc),
    view: { x: 320, y: 220, zoom: 0.1 },
  }
}

const IDLE: Interaction = {
  tool: 'select',
  placing: null,
  placingRotation: 0,
  drawLocks: {},
  axisLock: null,
  drawLive: null,
  drawStep: 0,
  calibration: null,
  edgeHover: null,
  wallFace: null,
  editingText: null,
  measuring: null,
  viewPart: null,
  contextMenu: null,
  menuPoint: null,
  status: '',
}

const SETTINGS: ToolSettings = {
  wallThickness: 200,
  wallJustify: 'center',
  wallMaterial: null,
  paperScale: 100,
  recentTools: ['rect', 'room', 'text', 'measure', 'split', 'rotate'],
  drawColor: null,
  drawFill: null,
  drawPattern: null,
  dimensionTemplate: {},
  annotationTemplate: {},
  // Dash and dot, as an axis is drawn (the last of DASHES in strokes.ts).
  gridlineTemplate: { label: 'A', style: { dash: [9, 3, 1.5, 3] } },
}

export const useStore = create<State>(() => ({ ...session(createDocument(), null), ...IDLE, ...SETTINGS, viewport: { width: 0, height: 0 } }))
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
    through: scope === s.scope ? s.through : [],
    trail: scope === s.scope ? s.trail : null,
    // What is selected is in the place being edited; but something an elevation shows, inside a group
    // there, is picked where it is shown and stays selected while it stays in its group.
    selection: s.selection.filter((id) => doc.nodes[id]?.parent === scope || (scope === s.scope && doc.nodes[id] !== undefined && doc.nodes[id].parent === s.doc.nodes[id]?.parent)),
    // A corner is a place, not an object: after an undo no wall may end there any more.
    corner: s.corner && wallEndsAt(doc, scope, s.corner).length > 0 ? s.corner : null,
    activeLayer: doc.layers[s.activeLayer] ? s.activeLayer : layersOf(doc)[0].id,
  }
}

/** The operations of the preview shown now, computed from `base`; what `commit` records. */
let pending: Op[] = []

/**
 * Records `doc`, made from the document before the gesture (or the current one) by `ops`, as one
 * undoable step. Every change kept in history passes through here, with the operations that made it.
 */
function record(doc: Document, ops: Op[]): void {
  const s = get()
  const before = s.base ?? s.doc
  pending = []
  if (doc === before) return set({ ...settle(s, doc), base: null })
  set({ ...settle(s, doc), base: null, past: [...s.past, { doc: before, ops }].slice(-HISTORY_LIMIT), future: [] })
}

/**
 * Applies operations that keep in the drawing what is worked out from it (the picture of each 3D
 * view, `keepViewPictures`), outside the history: there is nothing to undo, and an undo leaves the
 * picture of the state it goes back to, made again when the drawing is next saved. A drawing that
 * was saved stays so. Not during a gesture: false then, and nothing is applied.
 */
export function keep(ops: Op[]): boolean {
  const s = get()
  if (s.base || ops.length === 0) return false
  const doc = applyEdit(s.doc, ops, registry).doc
  set({ ...settle(s, doc), saved: s.saved === s.doc ? doc : s.saved })
  return true
}

/**
 * `ops` applied to `doc`, with what follows from them (`applyEdit`), and, unless the person turned
 * it off, a room in each space the edit closed and a room it covered moved off the wall
 * (`roomsAfterEdit`), named as the Room tool names them: in the same step, so that one undo takes
 * back the walls and their room.
 */
function applied(doc: Document, ops: Op[]): { doc: Document; ops: Op[] } {
  return span('editor: edit', () => appliedNow(doc, ops))
}

function appliedNow(doc: Document, ops: Op[]): { doc: Document; ops: Op[] } {
  const done = applyEdit(doc, ops, registry)
  if (!usePrefs.getState().autoRooms) return done
  const s = get()
  const { moved, spots } = roomsAfterEdit(doc, done.doc, s.scope, done.ops)
  if (spots.length === 0 && moved.length === 0) return done
  const count = Object.values(done.doc.nodes).filter((n) => n.type === 'room').length
  const layer = layerHere({ doc: done.doc, scope: s.scope, activeLayer: s.activeLayer })
  const rooms = spots.map(
    (p, i): Op => ({ op: 'add_node', node: { id: newId(), type: 'room', parent: s.scope, ...layer, name: t('Room {n}', { n: String(count + i + 1).padStart(2, '0') }), x: p.x, y: p.y } as NodeInput }),
  )
  const follow: Op[] = [...moved.map(({ id, x, y }): Op => ({ op: 'update_node', id, patch: { x, y } })), ...rooms]
  return { doc: applyOps(done.doc, follow), ops: [...done.ops, ...follow] }
}

/**
 * Applies operations as one undoable step, or throws when one fails. During a gesture they go on
 * top of its preview, which becomes part of the same step.
 */
export function applyOrThrow(ops: Op[]): void {
  const s = get()
  const done = applied(s.doc, ops)
  record(done.doc, s.base ? [...pending, ...done.ops] : done.ops)
}

/** Applies operations as one undoable step. Reports failures to the user and returns false. */
export function apply(ops: Op[]): boolean {
  try {
    applyOrThrow(ops)
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
    const done = applied(base, ops)
    set({ ...settle(s, done.doc), base })
    pending = done.ops
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
  if (past.length <= mark + 1) return
  const merged = past.slice(mark)
  set({ past: [...past.slice(0, mark), { doc: merged[0].doc, ops: merged.flatMap((step) => step.ops) }] })
}

export function commit(): void {
  if (get().base) record(get().doc, pending)
}

export function cancel(): void {
  const s = get()
  pending = []
  if (s.base) set({ ...settle(s, s.base), base: null })
}

export function undo(): void {
  cancel()
  const s = get()
  const step = s.past.at(-1)
  if (step) set({ ...settle(s, step.doc), past: s.past.slice(0, -1), future: [...s.future, { doc: s.doc, ops: step.ops }] })
}

export function redo(): void {
  cancel()
  const s = get()
  const step = s.future.at(-1)
  if (step) set({ ...settle(s, step.doc), future: s.future.slice(0, -1), past: [...s.past, { doc: s.doc, ops: step.ops }] })
}

/** Opens a drawing: its session and what is being done start afresh, every window closes, and how the tools draw stays as it was. */
export function loadDocument(doc: Document, file: StoredFile | null): void {
  pending = []
  set({ ...session(doc, file), ...IDLE })
  closeWindows()
}

export function setTool(tool: Tool, placing: Placing | null = null): void {
  const recentTools = [tool, ...get().recentTools.filter((one) => one !== tool)]
  set({ tool, placing, recentTools, corner: null, placingRotation: 0, calibration: null, measuring: null, drawLocks: {}, axisLock: null, drawLive: null, drawStep: 0, status: '' })
}

export function select(ids: string[]): void {
  set({ selection: ids, corner: null, measuring: null, viewPart: null })
}

/** The parts of a view, a viewpoint or an elevation: its line or eye on the plan, and its picture. */
export type ViewPart = 'line' | 'view'

/** Selects a view by one of its parts, which Properties then opens on. */
export function selectViewPart(id: string, part: ViewPart): void {
  set({ selection: [id], corner: null, measuring: null, viewPart: part })
}

/** Selects the wall corner at a point, in place of any objects. */
export function selectCorner(at: Vec2 | null): void {
  set({ selection: [], corner: at })
}

/**
 * The layer of what is drawn or placed where the user is: the active one, but none inside a
 * component, whose content is drawn on the layer of each placement. Spread into the new node.
 */
export function layerHere(s: Pick<State, 'doc' | 'scope' | 'activeLayer'> = get()): { layer?: string } {
  const layer = layerIn(s.doc, s.scope, s.activeLayer)
  return layer === undefined ? {} : { layer }
}

export const isDirty = (s: State = get()) => (s.base ?? s.doc) !== s.saved

/**
 * The drawing as it goes into its file: with the layer in use, so that it opens on it, unless that
 * is the first, on which it opens anyway. This is a copy made for writing and never the document:
 * choosing a layer is not an edit, and neither takes a step of undo nor counts as a change to save.
 */
export function forFile(doc: Document, s: State = get()): Document {
  const { meta, ...rest } = doc
  const { activeLayer: _, ...others } = meta ?? {}
  const kept = Object.hasOwn(doc.layers, s.activeLayer) && s.activeLayer !== layersOf(doc)[0].id ? { activeLayer: s.activeLayer } : {}
  const written = { ...others, ...kept }
  return Object.keys(written).length > 0 ? { ...rest, meta: written } : rest
}
