import {
  ArrowRightToLine,
  BrickWall,
  BringToFront,
  Cable,
  Camera,
  Circle,
  CircleDot,
  DoorOpen,
  Grid2x2,
  Hand,
  LibraryBig,
  MessageSquare,
  Minus,
  Move,
  MousePointer2,
  Pipette,
  RotateCw,
  Ruler,
  RulerDimensionLine,
  ScanEye,
  Scissors,
  SeparatorVertical,
  Slice,
  Spline,
  Square,
  SquareDashed,
  Sun,
  SquareRoundCorner,
  StickyNote,
  Triangle,
  Type,
  Undo2,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { Arc, GridLine, Offset } from './icons'
import { msg } from './i18n'
import { CUT_TOOLS, MEASURE_TOOLS, ROOM_TOOLS, SHAPE_TOOLS, TEXT_TOOLS, TRANSFORM_TOOLS, type Tool } from './tools'

/*
 * What the floating toolbar holds, a preference (`toolbar`) set on the Toolbar page of Preferences,
 * by dragging, which `Toolbar` in Stage.tsx draws. From left to right: buttons and separators. A
 * button is one tool, or a list of tools, which shows the one of them used last and lists them all
 * from the arrow beside it, or one of the others (the door, the window, the object library, the
 * arrange list, undo with redo beside it), always alone. Toolbars can be saved under a name
 * (`savedToolbars`) and switched between.
 */

/** Each tool with its button's tooltip and picture. */
export const ICONS: Record<Exclude<Tool, 'calibrate' | 'place'>, [title: string, icon: LucideIcon]> = {
  select: [msg('Select'), MousePointer2],
  hand: [msg('Pan'), Hand],
  line: [msg('Line'), Minus],
  curve: [msg('Curved line: flows through the points you click'), Spline],
  spline: [msg('Spline: a curve the points you click pull, as in CAD programs'), Waypoints],
  arc: [msg('Arc: click its two ends, then a point it goes through'), Arc],
  rect: [msg('Rectangle'), Square],
  ellipse: [msg('Ellipse'), Circle],
  circle: [msg('Circle: click its centre, then a point it goes through'), CircleDot],
  wall: [msg('Wall'), BrickWall],
  dimension: [msg('Dimension: annotate a distance on the drawing'), RulerDimensionLine],
  measure: [msg('Measure: read a distance without drawing anything'), Ruler],
  split: [msg('Split: cut a wall, a line or a polyline in two where you click'), Slice],
  trim: [msg('Trim: take away the stretch of a wall or a line you click, up to what crosses it'), Scissors],
  extend: [msg('Extend: carry a line or a wall on, from the end you click, to the next thing in its way'), ArrowRightToLine],
  fillet: [msg('Fillet: make two lines meet at a corner, or round it with a radius'), SquareRoundCorner],
  offset: [msg('Offset: a parallel copy of a wall, a line or a shape, at a distance'), Offset],
  rotate: [msg('Rotate: turn the selection about a point you click'), RotateCw],
  move: [msg('Move: take the selection by a point and put that point down on another'), Move],
  angle: [msg('Angle: read the angle between two directions'), Triangle],
  eyedropper: [msg('Eyedropper: copy the look of an object'), Pipette],
  text: [msg('Text'), Type],
  annotation: [msg('Annotation: a note with an arrow to what it is about'), MessageSquare],
  gridline: [msg('Grid line: an axis of the building, with its letter or number in a bubble'), GridLine],
  paper: [msg('Paper: a sheet that frames what goes on one page'), StickyNote],
  room: [msg('Room: name the space inside closed walls'), SquareDashed],
  divider: [msg('Room divider: separates two rooms where there is no wall'), SeparatorVertical],
  elevation: [msg('Elevation: the face of a wall seen from in front, the walls of a room, a side of the building, or a section along a line, drawn from the plan'), ScanEye],
  camera: [msg('Viewpoint: where you stand and the way you look, for a picture of the room in perspective'), Camera],
  sun: [msg('Sun: where the light comes from on a day at an hour, and the shade it casts'), Sun],
  connect: [msg('Connect: click a switch, then the lights and sockets it controls'), Cable],
}

/** The tools that can have a button. */
export type ButtonTool = keyof typeof ICONS

/** What is not a tool: placing a door or a window, the object library, the arrange list, undo with redo beside it. Each is a button alone. */
export const OTHERS = {
  door: { title: msg('Door'), icon: DoorOpen },
  window: { title: msg('Window'), icon: Grid2x2 },
  library: { title: msg('Object library: stairs, furniture and every other object'), icon: LibraryBig },
  arrange: { title: msg('Arrange: stacking order, align, space evenly'), icon: BringToFront },
  undo: { title: msg('Undo and redo'), icon: Undo2 },
} satisfies Record<string, { title: string; icon: LucideIcon }>

/** A button: the ids of what it holds, one tool or several (a list), or one of the others. */
export type ToolbarButton = string[]
/** A line between two buttons. */
export const SEPARATOR = '|'
/** One entry of the toolbar, from left to right: a button or a separator. */
export type ToolbarEntry = ToolbarButton | typeof SEPARATOR
export type ToolbarLayout = ToolbarEntry[]

/** The toolbar as it comes. */
export const TOOLBAR_DEFAULT: ToolbarLayout = [
  ['select'],
  ['hand'],
  SEPARATOR,
  [...SHAPE_TOOLS],
  ['wall'],
  [...ROOM_TOOLS],
  ['door'],
  ['window'],
  ['library'],
  SEPARATOR,
  [...CUT_TOOLS],
  [...TRANSFORM_TOOLS],
  ['arrange'],
  [...MEASURE_TOOLS],
  [...TEXT_TOOLS],
  SEPARATOR,
  ['undo'],
]

export const isTool = (id: string): id is ButtonTool => Object.hasOwn(ICONS, id)
const isOther = (id: string) => Object.hasOwn(OTHERS, id)

/** What an item is called and pictured as; null for one this version does not know. */
export function itemOf(id: string): { title: string; icon: LucideIcon } | null {
  if (isOther(id)) return OTHERS[id as keyof typeof OTHERS]
  if (isTool(id)) return { title: ICONS[id][0], icon: ICONS[id][1] }
  return null
}

/** Every item there is: the others, then every tool. */
export const ALL_ITEMS: string[] = [...Object.keys(OTHERS), ...Object.keys(ICONS)]

/** What a toolbar holds, wherever in it. */
export const itemsIn = (layout: ToolbarLayout): Set<string> => new Set(layout.flatMap((entry) => (entry === SEPARATOR ? [] : entry)))

/**
 * A toolbar as a stored value makes it: what is not a toolbar of this version gives the one that
 * comes; what this version does not know is left out (a toolbar saved by a later one), each item
 * once, one of the others alone on its button (one in a list comes out of it, after it), empty
 * buttons gone. For the toolbar itself (`editing` false), no separator at an end or beside another;
 * while it is set up, separators stay where they are put, to be moved on.
 */
export function tidyToolbar(stored: unknown, editing = false): ToolbarLayout {
  const entry = (value: unknown) => value === SEPARATOR || (Array.isArray(value) && value.every((id) => typeof id === 'string'))
  if (!Array.isArray(stored) || !stored.every(entry)) return TOOLBAR_DEFAULT
  const seen = new Set<string>()
  const layout = (stored as (string | unknown[])[]).flatMap((entry): ToolbarEntry[] => {
    if (entry === SEPARATOR) return [SEPARATOR]
    const known = (entry as string[]).filter((id) => itemOf(id) !== null && !seen.has(id))
    known.forEach((id) => seen.add(id))
    const tools = known.filter(isTool)
    return [...(tools.length > 0 ? [tools] : []), ...known.filter(isOther).map((id) => [id])]
  })
  if (editing) return layout
  return layout.filter((entry, i) => entry !== SEPARATOR || (i > 0 && layout[i - 1] !== SEPARATOR && layout.slice(i + 1).some((next) => next !== SEPARATOR)))
}

/** The tool a button of several shows: the one in use, else the one of them used last, else its first. */
export function shownTool(tools: ButtonTool[], active: string, recent: readonly string[]): ButtonTool {
  if (tools.includes(active as ButtonTool)) return active as ButtonTool
  return (recent.find((tool) => tools.includes(tool as ButtonTool)) as ButtonTool | undefined) ?? tools[0]
}

/** What is dragged while the toolbar is set up: an entry of it, one tool of a list, or an item not in it yet (a separator, which can be put in any number of times, among them). */
export type DragSource = { kind: 'entry'; at: number } | { kind: 'tool'; at: number; index: number } | { kind: 'new'; id: string }

/**
 * Where it is let go: before an entry (`at` the length of the toolbar for its end), onto a button to
 * join its list, before a tool of a list (`index` its length for the list's end), or out of the toolbar.
 */
export type DropTarget = { kind: 'before'; at: number } | { kind: 'join'; at: number } | { kind: 'list'; at: number; index: number } | { kind: 'remove' }

/** Whether what is dragged can join the list of the button at `at`: tools only, onto tools only, and not onto itself. */
export function canJoin(layout: ToolbarLayout, source: DragSource, at: number): boolean {
  const target = layout[at]
  if (!target || target === SEPARATOR || !target.every(isTool)) return false
  if (source.kind === 'entry') return source.at !== at && layout[source.at] !== SEPARATOR && (layout[source.at] as ToolbarButton).every(isTool)
  if (source.kind === 'tool') return source.at !== at
  return isTool(source.id)
}

/**
 * The toolbar once what is dragged is let go somewhere: moved, joined into a list, taken out of one
 * onto a button of its own, put in, or taken out. Returns the toolbar given, untouched, when the drop
 * would do nothing. A list left with one tool is a plain button; an emptied one goes.
 */
export function dropOn(layout: ToolbarLayout, source: DragSource, target: DropTarget): ToolbarLayout {
  // Each entry wrapped in an object, so that where it is let go is still found once what is dragged has left its place.
  const entries = layout.map((entry) => ({ entry: entry === SEPARATOR ? SEPARATOR : [...entry] }) as { entry: ToolbarEntry })
  const aim = target.kind === 'remove' ? undefined : entries[target.at]
  if (target.kind === 'join' && !canJoin(layout, source, target.at)) return layout
  if (target.kind === 'list' && (!aim || aim.entry === SEPARATOR)) return layout
  let moving: ToolbarEntry
  if (source.kind === 'new') {
    if (target.kind === 'remove' || (source.id !== SEPARATOR && itemsIn(layout).has(source.id))) return layout
    moving = source.id === SEPARATOR ? SEPARATOR : [source.id]
  } else if (source.kind === 'entry') {
    if (target.kind === 'before' && (target.at === source.at || target.at === source.at + 1)) return layout
    moving = entries[source.at].entry
    entries.splice(source.at, 1)
  } else {
    const list = entries[source.at].entry as ToolbarButton
    if (target.kind === 'list' && target.at === source.at && (target.index === source.index || target.index === source.index + 1)) return layout
    moving = [list[source.index]]
    list.splice(source.index, 1)
  }
  if (target.kind === 'before') {
    const at = aim ? entries.indexOf(aim) : entries.length
    entries.splice(at, 0, { entry: moving })
  } else if (target.kind === 'join') {
    ;(aim!.entry as ToolbarButton).push(...(moving as ToolbarButton))
  } else if (target.kind === 'list') {
    const list = aim!.entry as ToolbarButton
    const index = source.kind === 'tool' && source.at === target.at && source.index < target.index ? target.index - 1 : target.index
    if (moving === SEPARATOR || !moving.every(isTool) || !list.every(isTool)) return layout
    list.splice(index, 0, ...moving)
  }
  return entries.map(({ entry }) => entry).filter((entry) => entry === SEPARATOR || entry.length > 0)
}

/** An entry taken out, or one tool of a list (`index`). */
export function removeEntry(layout: ToolbarLayout, at: number, index?: number): ToolbarLayout {
  return dropOn(layout, index === undefined || layout[at] === SEPARATOR || layout[at].length < 2 ? { kind: 'entry', at } : { kind: 'tool', at, index }, { kind: 'remove' })
}

/** An item, or a separator, put in at the end of the toolbar. */
export const addEntry = (layout: ToolbarLayout, id: string): ToolbarLayout => dropOn(layout, { kind: 'new', id }, { kind: 'before', at: layout.length })

/** A toolbar saved under a name, to switch to again. */
export interface SavedToolbar {
  name: string
  toolbar: ToolbarLayout
}

/** Whether two toolbars hold the same entries in the same order. */
export const sameToolbar = (a: ToolbarLayout, b: ToolbarLayout): boolean => JSON.stringify(tidyToolbar(a, true)) === JSON.stringify(tidyToolbar(b, true))

/** The saved toolbars with `toolbar` saved as `name`: in the place of one so named, else after the others. */
export function saveToolbar(saved: readonly SavedToolbar[], name: string, toolbar: ToolbarLayout): SavedToolbar[] {
  const kept = { name: name.trim(), toolbar }
  return saved.some((one) => one.name === kept.name) ? saved.map((one) => (one.name === kept.name ? kept : one)) : [...saved, kept]
}
