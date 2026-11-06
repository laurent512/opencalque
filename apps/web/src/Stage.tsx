import { InstanceBar } from './InstanceBar'
import { Fragment, useEffect, useRef, useState } from 'react'
import { rootOf, type Document } from '@opencalque/core'
import {
  BrickWall,
  ChevronRight,
  ChevronUp,
  Circle,
  DoorOpen,
  Grid2x2,
  Hand,
  LibraryBig,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  Pipette,
  Redo2,
  Ruler,
  Slice,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Triangle,
  RulerDimensionLine,
  SeparatorVertical,
  Square,
  SquareDashed,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  BringToFront,
  AlignVerticalSpaceAround,
  Scissors,
  Spline,
  Crosshair,
  Grid3x3,
  Magnet,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import { canFlipSide, MAX_ZOOM, MIN_ZOOM, zoomBy, zoomTo, zoomToFit } from './actions'
import { CanvasView } from './canvas/CanvasView'
import { executeById, formatKey, useShortcutLabel } from './commands'
import { Arc, GridLine, Offset } from './icons'
import { msg, t } from './i18n'
import { QuickBar } from './QuickBar'
import type { ScopeStep } from './scopePath'
import { registry, useExtensions } from './extensions'
import { leaveTo, returnTo, trailAhead } from './navigation'
import { redo, setTool, undo, useStore } from './store'
import { CUT_TOOLS, hintsFor, MEASURE_TOOLS, ROOM_TOOLS, SHAPE_TOOLS, TEXT_TOOLS, type Hint, type Tool } from './tools'
import { TextEditor } from './TextEditor'
import { ClearanceEditor } from './ClearanceEditor'
import { IconButton, labelOf, TypeIcon } from './ui'
import { useWindows } from './windows'
import { setPrefs, usePrefs, type Prefs } from './prefs'
import { screenScale } from './view'

const ICONS: Partial<Record<Tool, [title: string, icon: LucideIcon]>> = {
  select: [msg('Select'), MousePointer2],
  hand: [msg('Pan'), Hand],
  line: [msg('Line'), Minus],
  curve: [msg('Curved line: flows through the points you click'), Spline],
  arc: [msg('Arc: click its two ends, then a point it goes through'), Arc],
  rect: [msg('Rectangle'), Square],
  ellipse: [msg('Ellipse'), Circle],
  wall: [msg('Wall'), BrickWall],
  dimension: [msg('Dimension: annotate a distance on the drawing'), RulerDimensionLine],
  measure: [msg('Measure: read a distance without drawing anything'), Ruler],
  split: [msg('Split: cut a wall, a line or a polyline in two where you click'), Slice],
  trim: [msg('Trim: take away the stretch of a wall or a line you click, up to what crosses it'), Scissors],
  offset: [msg('Offset: a parallel copy of a line or a shape, at a distance'), Offset],
  rotate: [msg('Rotate: turn the selection about a point you click'), RotateCw],
  angle: [msg('Angle: read the angle between two directions'), Triangle],
  eyedropper: [msg('Eyedropper: copy the look of an object'), Pipette],
  text: [msg('Text'), Type],
  annotation: [msg('Annotation: a note with an arrow to what it is about'), MessageSquare],
  gridline: [msg('Grid line: an axis of the building, with its letter or number in a bubble'), GridLine],
  paper: [msg('Paper: a sheet that frames what goes on one page'), StickyNote],
  room: [msg('Room: name the space inside closed walls'), SquareDashed],
  divider: [msg('Room divider: separates two rooms where there is no wall'), SeparatorVertical],
}

/**
 * Stacking, aligning and spacing the selection: one button in the toolbar, its choices in a list,
 * each offered from the number of objects it needs. The properties panel has none of them.
 */
const ARRANGE: (GroupAction & { least: number })[] = [
  { command: 'edit.bringToFront', title: msg('Bring to front'), icon: ArrowUpToLine, least: 1 },
  { command: 'edit.bringForward', title: msg('Bring forward'), icon: ArrowUp, least: 1 },
  { command: 'edit.sendBackward', title: msg('Send backward'), icon: ArrowDown, least: 1 },
  { command: 'edit.sendToBack', title: msg('Send to back'), icon: ArrowDownToLine, least: 1 },
  { command: 'edit.align.left', title: msg('Align left'), icon: AlignStartVertical, least: 2 },
  { command: 'edit.align.center', title: msg('Align centres, across'), icon: AlignCenterVertical, least: 2 },
  { command: 'edit.align.right', title: msg('Align right'), icon: AlignEndVertical, least: 2 },
  { command: 'edit.align.top', title: msg('Align top'), icon: AlignStartHorizontal, least: 2 },
  { command: 'edit.align.middle', title: msg('Align middles, up and down'), icon: AlignCenterHorizontal, least: 2 },
  { command: 'edit.align.bottom', title: msg('Align bottom'), icon: AlignEndHorizontal, least: 2 },
  { command: 'edit.distribute.x', title: msg('Space evenly, across'), icon: AlignHorizontalSpaceAround, least: 3 },
  { command: 'edit.distribute.y', title: msg('Space evenly, up and down'), icon: AlignVerticalSpaceAround, least: 3 },
]

/** Flipping the selection on itself, listed with the rotate tool. */
const FLIPS: GroupAction[] = [
  { command: 'edit.flipHorizontal', title: msg('Mirror horizontally'), icon: FlipHorizontal2 },
  { command: 'edit.flipVertical', title: msg('Mirror vertically'), icon: FlipVertical2 },
]

/** A toolbar button whose tooltip shows the command's current shortcut. */
function CommandButton(props: { command: string; title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  const shortcut = useShortcutLabel(props.command)
  return (
    <IconButton title={shortcut ? `${props.title} (${shortcut})` : props.title} onClick={props.onClick} active={props.active} disabled={props.disabled}>
      {props.children}
    </IconButton>
  )
}

function ToolButton({ id }: { id: Tool }) {
  const active = useStore((s) => s.tool === id)
  const [title, Icon] = ICONS[id]!
  return (
    <CommandButton command={`tool.${id}`} title={t(title)} active={active} onClick={() => setTool(id)}>
      <Icon size={18} />
    </CommandButton>
  )
}

/** A button that places one kind of object, such as a door. It is absent when no extension in use provides the kind. */
function PlaceButton({ kind, icon: Icon }: { kind: string; icon: LucideIcon }) {
  useExtensions((s) => s.version)
  const active = useStore((s) => s.tool === 'place' && s.placing?.type === 'parametric' && s.placing.kind === kind)
  const object = registry.parametric.get(kind)
  if (!object) return null
  return (
    <CommandButton command={`place.${kind}`} title={t(object.label)} active={active} onClick={() => setTool('place', { type: 'parametric', kind })}>
      <Icon size={18} />
    </CommandButton>
  )
}

function ShapeChoice({ id, current, onPick }: { id: Tool; current: boolean; onPick: () => void }) {
  const shortcut = useShortcutLabel(`tool.${id}`)
  const [title, Icon] = ICONS[id]!
  return (
    // The tool in use is in the accent colour, as its button is: no tick in front, which would take room.
    <button role="menuitem" className={current ? 'current' : undefined} aria-current={current || undefined} onClick={onPick}>
      <Icon size={15} />
      {/* Just the name: the explanation after the colon belongs in the button's tooltip, not in a list. */}
      <span className="menu-title">{t(title).split(/\s*:/)[0]}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

/** Something done at once to the selection, listed with tools: a command, its name and its picture. */
type GroupAction = { command: string; title: string; icon: LucideIcon }

function ActionChoice({ action, disabled, onPick }: { action: GroupAction; disabled: boolean; onPick: () => void }) {
  const shortcut = useShortcutLabel(action.command)
  const Icon = action.icon
  return (
    <button role="menuitem" disabled={disabled} onClick={onPick}>
      <Icon size={15} />
      <span className="menu-title">{t(action.title)}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

/** A list that opens from a button: it closes on a press anywhere outside `ref`, or on any key. */
function useMenu<T extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    // A key pressed while the list is open is a shortcut or Esc: either way the list has had its turn.
    const onKeyDown = () => setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])
  return { open, setOpen, ref }
}

/**
 * One button for several related tools: it shows the one used last, and the arrow beside it lists
 * the others, then any `actions`, which act on the selection at once rather than being tools.
 */
function ToolGroup({ tools, current: shape, more, actions = [] }: { tools: Tool[]; current: Tool; more: string; actions?: GroupAction[] }) {
  const selected = useStore((s) => s.selection.length > 0)
  const { open, setOpen, ref: group } = useMenu<HTMLDivElement>()

  return (
    <div className="tool-group" ref={group}>
      <ToolButton id={shape} />
      <button className={`tool-more${open ? ' open' : ''}`} title={more} aria-label={more} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronUp size={12} />
      </button>
      {open && (
        <div className="menu-list tool-menu" role="menu">
          {tools.map((id) => (
            <ShapeChoice
              key={id}
              id={id}
              current={id === shape}
              onPick={() => {
                setOpen(false)
                setTool(id)
              }}
            />
          ))}
          {actions.length > 0 && <hr />}
          {actions.map((action) => (
            <ActionChoice
              key={action.command}
              action={action}
              disabled={!selected}
              onPick={() => {
                setOpen(false)
                executeById(action.command)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The button that aligns and spaces the selection; usable from two objects, spacing from three. */
function ArrangeMenu() {
  const count = useStore((s) => s.selection.length)
  const { open, setOpen, ref: group } = useMenu<HTMLDivElement>()
  // Nothing to arrange with nothing selected: the list closes rather than offering only greyed choices.
  useEffect(() => {
    if (count < 1) setOpen(false)
  }, [count])
  return (
    <div className="tool-group" ref={group}>
      <IconButton title={t('Arrange: stacking order, align, space evenly')} active={open} disabled={count < 1} onClick={() => setOpen(!open)}>
        <BringToFront size={18} />
      </IconButton>
      {open && (
        <div className="menu-list tool-menu" role="menu">
          {ARRANGE.map((action, i) => (
            <div key={action.command} style={{ display: 'contents' }}>
              {(i === 4 || i === 10) && <hr />}
              <ActionChoice
                action={action}
                disabled={count < action.least}
                onPick={() => {
                  setOpen(false)
                  executeById(action.command)
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


/** What is worth knowing about the space drawn in, once inside a component. */
const COMPONENT_NOTE = msg('The red and green axes cross at the insertion point of the component')
const SHEET_NOTE = msg('Drawn on a sheet as it prints, in millimetres of paper')

function Hints() {
  // Going through the placements of a component, its bar takes their place.
  const browsing = useWindows((s) => s.browsing !== null)
  const tool = useStore((s) => s.tool)
  const step = useStore((s) => s.drawStep)
  const typing = useStore((s) => s.editingText !== null)
  const selected = useStore((s) => s.selection.length > 0)
  const measured = useStore((s) => s.calibration !== null)
  const opening = useStore((s) => s.placing?.type === 'parametric' && Boolean(registry.parametric.get(s.placing.kind)?.opening))
  // Whether Shift+Space would flip something: the wall tool drawing by a face, a door being placed.
  const flips = useStore((s) => (s.tool === 'wall' ? s.wallJustify !== 'center' : canFlipSide()))
  // With the select tool, a preview in progress is an object being moved, reshaped, scaled or turned.
  const dragging = useStore((s) => s.tool === 'select' && s.base !== null && !s.editingText)
  const walls = useStore((s) => s.selection.some((id) => s.doc.nodes[id]?.type === 'wall'))
  const face = useStore((s) => s.wallFace)
  const inside = useStore((s) => {
    const root = rootOf(s.doc, s.scope)
    return root?.type !== 'component' ? null : root.sheet === undefined ? COMPONENT_NOTE : SHEET_NOTE
  })
  // A rectangle or an ellipse alone is resized by the frame around it (resize.ts).
  // A placed component is stretched by such a frame too, Shift keeping its proportions.
  const boxed = useStore((s) => s.tool === 'select' && s.selection.length === 1 && ['rect', 'ellipse', 'instance'].includes(s.doc.nodes[s.selection[0]]?.type ?? ''))
  // A stair is resized by such a frame too, but rounds what it is given (to whole steps), and has no proportions to keep.
  const stretchy = useStore((s) => {
    const node = s.tool === 'select' && s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
    return node?.type === 'parametric' && Boolean(registry.parametric.get(node.kind)?.box)
  })
  let hints: Hint[]
  if (typing) hints = [['', t('Type the text')], ['Enter', t('starts a new line')], ['Esc', t('finishes')]]
  else if (tool === 'eyedropper') hints = [['', selected ? t('Click an object to give its look to what is selected') : t('Click an object to draw the next shapes with its look')]]
  else if (tool === 'calibrate') {
    // Two points on the plan, then their real distance, which is typed in the panel.
    hints = measured
      ? [['', t('Type the real distance between the two points, in the panel on the right')]]
      : step === 0
        ? [['', t('Click the first of two points whose real distance you know')]]
        : [['', t('Click the second point')], ['Shift', t('keeps it level, upright or at 45°')]]
  }
  // Ctrl grows a wall both ways, as it resizes from the middle in office programs; Alt keeps its meaning.
  else if (face === 'drag') hints = [['', t('The other face stays where it is; joined walls stay joined')], [formatKey('Mod'), t('grows both sides, the middle staying put')], ['Alt', t('ignores the grid and snapping')]]
  else if (face === 'hover' && !dragging) hints = [['', t('Drag the face to make the wall thicker or thinner on this side')], [formatKey('Mod'), t('both sides at once')]]
  else if (face === 'end drag') hints = [['', t('The wall keeps its direction, its other end where it is')], ['Alt', t('ignores the grid and snapping')]]
  else if (face === 'end hover' && !dragging) hints = [['', t('Drag the end to make the wall longer or shorter')], ['', t('the point at the end moves it anywhere')]]
  else if (dragging && stretchy) hints = [['', t('The side opposite stays where it is')], ['Alt', t('ignores the grid and snapping')]]
  else if (stretchy) hints = [['', t('Drag a side to make it longer or wider, a corner for both')], ['', t('the knob above turns it')]]
  else if (dragging && boxed) hints = [['Shift', t('keeps its proportions, from a corner')], ['Alt', t('ignores the grid and snapping')]]
  else if (boxed) hints = [['', t('Drag the middle of a side to change one size, a corner to change both')], ['', t('the knob above turns it')]]
  else if (dragging) hints = walls ? [['', t('Joined walls stretch to stay joined')], ['↑ ←', t('holds it upright or level')], ['Alt', t('moves it alone, off the grid')]] : [['Shift', t('keeps an end on its own line, or level, upright or at 45° with its other end')], ['↑ ←', t('holds it upright or level')], ['Alt', t('ignores the grid and snapping')]]
  else hints = hintsFor(tool, step, opening, selected, flips)
  // With nothing else to say, inside a component: what its space is.
  if (hints.length === 0 && inside) hints = [['', t(inside)]]
  if (hints.length === 0 || browsing) return null
  return (
    <div className="hint-bar">
      {hints.map(([key, text], i) => (
        <span key={key + text} className={i === 0 && !key ? 'next' : undefined}>
          {key && <kbd>{key}</kbd>}
          {text}
        </span>
      ))}
    </div>
  )
}

function Toolbar() {
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const shapeTool = useStore((s) => s.shapeTool)
  const roomTool = useStore((s) => s.roomTool)
  const textTool = useStore((s) => s.textTool)
  const measureTool = useStore((s) => s.measureTool)
  const cutTool = useStore((s) => s.cutTool)
  return (
    <div className="toolbar">
      <ToolButton id="select" />
      <ToolButton id="hand" />
      <hr />
      <ToolGroup tools={SHAPE_TOOLS} current={shapeTool} more={t('More shapes')} />
      <ToolButton id="wall" />
      <ToolGroup tools={ROOM_TOOLS} current={roomTool} more={t('Room divider')} />
      <PlaceButton kind="arch.door" icon={DoorOpen} />
      <PlaceButton kind="arch.window" icon={Grid2x2} />
      <CommandButton command="warehouse.components" title={t('Object library: stairs, furniture and every other object')} onClick={() => executeById('warehouse.components')}>
        <LibraryBig size={18} />
      </CommandButton>
      <hr />
      <ToolGroup tools={CUT_TOOLS} current={cutTool} more={t('Trim, offset')} />
      {/* Mirroring is not a tool: the selection is flipped on itself, at once, from the same list. */}
      <ToolGroup tools={['rotate']} current="rotate" more={t('Mirror')} actions={FLIPS} />
      <ArrangeMenu />
      <ToolGroup tools={MEASURE_TOOLS} current={measureTool} more={t('Measure an angle')} />
      <ToolGroup tools={TEXT_TOOLS} current={textTool} more={t('Annotation, dimension, grid line')} />
      <hr />
      <CommandButton command="edit.undo" title={t('Undo')} onClick={undo} disabled={!canUndo}>
        <Undo2 size={18} />
      </CommandButton>
      <CommandButton command="edit.redo" title={t('Redo')} onClick={redo} disabled={!canRedo}>
        <Redo2 size={18} />
      </CommandButton>
    </div>
  )
}

/** The view settings the view bar switches on and off, each by the command that does it elsewhere. */
const VIEW_TOGGLES: [command: string, title: string, pref: keyof Prefs, icon: LucideIcon][] = [
  ['view.toggleGrid', msg('Show grid'), 'showGrid', Grid3x3],
  ['view.toggleSnapGrid', msg('Snap to grid'), 'snapToGrid', Magnet],
  ['view.toggleSnapObjects', msg('Snap to objects'), 'snapToObjects', Crosshair],
  ['view.toggleClearances', msg('Show temporary dimensions'), 'showClearances', RulerDimensionLine],
]

/** The slider's steps: the zoom on a scale of its logarithm, so that each step multiplies it alike. */
const [LOW, HIGH] = [Math.log(MIN_ZOOM), Math.log(MAX_ZOOM)]

/**
 * How the drawing is looked at, in the bottom right corner: a still square, which opens upwards
 * under the pointer (or when it has the focus, for a keyboard or a touch) into the settings that
 * change what is shown and what the pointer holds to, each lit while on, then zooming in and out,
 * the slider, the scale the drawing is seen at on screen as an architect reads one (1:50), and
 * zooming to fit. The scale is not on the square: changing with every zoom, it drew the eye.
 */
function ViewBar() {
  const zoom = useStore((s) => s.view.zoom)
  const prefs = usePrefs()
  return (
    <div className="view-bar">
      <div className="view-more" role="toolbar" aria-label={t('View')}>
        {VIEW_TOGGLES.map(([command, title, pref, Icon]) => (
          <ViewToggle key={command} command={command} title={t(title)} on={prefs[pref] === true} flip={() => setPrefs({ [pref]: !prefs[pref] })}>
            <Icon size={16} />
          </ViewToggle>
        ))}
        <hr />
        <CommandButton command="view.zoomIn" title={t('Zoom in')} onClick={() => zoomBy(1.25)}>
          <Plus size={16} />
        </CommandButton>
        <input
          type="range"
          className="zoom-slider"
          aria-label={t('Zoom')}
          min={LOW}
          max={HIGH}
          step={(HIGH - LOW) / 400}
          value={Math.log(zoom)}
          onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
        />
        <CommandButton command="view.zoomOut" title={t('Zoom out')} onClick={() => zoomBy(0.8)}>
          <Minus size={16} />
        </CommandButton>
        {/* The zoom itself, in pixels per millimetre, for scripts and tests: the scale shown is rounded. */}
        <span className="zoom-scale" data-zoom={zoom} title={t('The scale the drawing is seen at on screen, at 96 pixels to the inch')}>
          {screenScale(zoom)}
        </span>
        <CommandButton command="view.zoomToFit" title={t('Zoom to fit')} onClick={zoomToFit}>
          <Maximize size={16} />
        </CommandButton>
      </div>
      <button type="button" className="view-handle" title={t('View: zoom, grid and snapping')} aria-label={t('View: zoom, grid and snapping')}>
        <SlidersHorizontal size={16} />
      </button>
    </div>
  )
}

/** A view setting as a button, lit while on, its shortcut in its title when it has one. */
function ViewToggle(props: { command: string; title: string; on: boolean; flip: () => void; children: React.ReactNode }) {
  const shortcut = useShortcutLabel(props.command)
  return (
    <IconButton title={shortcut ? `${props.title} (${shortcut})` : props.title} pressed={props.on} onClick={props.flip}>
      {props.children}
    </IconButton>
  )
}

/** How many places the breadcrumb shows before folding the middle of the way into a list. */
const CRUMBS = 5

/** What a place on the way to the scope is called. */
function crumbName(doc: Document, id: string): string {
  const node = doc.nodes[id]
  return node.type === 'component' && node.sheet !== undefined ? t('On every sheet') : labelOf(doc, node)
}

/** A place on the way, with the picture the Structure list gives its kind. */
function CrumbName({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const node = doc.nodes[id]
  return (
    <>
      {node.type === 'component' && node.sheet !== undefined ? (
        <i className="type-icon">
          <StickyNote size={13} />
        </i>
      ) : (
        <TypeIcon node={node} />
      )}
      <span>{crumbName(doc, id)}</span>
    </>
  )
}

/** Places in a row, the middle folded into one list when there are more than `most`, keeping `head` first and `tail` last. */
function folded(steps: ScopeStep[], most: number, head: number, tail: number): (ScopeStep | ScopeStep[])[] {
  return steps.length > most ? [...steps.slice(0, head), steps.slice(head, steps.length - tail), ...steps.slice(steps.length - tail)] : steps
}

/** The middle of a long way, as one button listing the places it holds; `ahead`, places just left to go back into. */
function CrumbFold({ steps, ahead }: { steps: ScopeStep[]; ahead: boolean }) {
  const doc = useStore((s) => s.doc)
  const { open, setOpen, ref } = useMenu<HTMLDivElement>()
  return (
    <div className="crumb-fold" ref={ref}>
      <button className={`crumb${ahead ? ' ahead' : ''}`} title={steps.map((step) => crumbName(doc, step.id)).join(' › ')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>…</span>
      </button>
      {open && (
        <div className="menu-list crumb-menu" role="menu">
          {steps.map((step) => (
            <button
              key={step.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                ;(ahead ? returnTo : leaveTo)(step.id)
              }}
            >
              <CrumbName id={step.id} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Where the editing is, while inside a group or a component: the way there from the page, each
 * place on it a button that goes back out to it (Esc goes out one step). After it, faint, the
 * places just left (`trail` in the store), to go back into at once; they stay on the page too. It
 * sits in the corner, growing to the right, so that going one step further in or out moves nothing
 * that was there.
 */
function Breadcrumb() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const page = useStore((s) => s.page)
  const through = useStore((s) => s.through)
  const trail = useStore((s) => s.trail)
  const { path, steps: left } = trailAhead({ doc, page, scope, through, trail })
  if (scope === page && left.length === 0) return null
  const root = doc.nodes[path.steps[0]?.id]
  // A component opened from the library is not seen on any page.
  const unplaced = root?.type === 'component' && root.sheet === undefined
  const inside = rootOf(doc, scope)
  const note = inside?.type === 'component' ? t(inside.sheet === undefined ? COMPONENT_NOTE : SHEET_NOTE) : null
  const here = path.steps[path.steps.length - 1]
  // A long way keeps where it starts and the last places, the ones gone back to most; a long
  // trail, the place next in and the one left last.
  const shown = [...folded(path.steps, CRUMBS, 1, 3).map((item) => ({ item, ahead: false })), ...folded(left, 3, 1, 1).map((item) => ({ item, ahead: true }))]
  return (
    <nav className="breadcrumb" aria-label={t('Where you are editing')}>
      {unplaced && (
        <span className="crumb-lead">
          <i className="type-icon">
            <LibraryBig size={13} />
          </i>
          <span>{t('Object library')}</span>
        </span>
      )}
      {shown.map(({ item, ahead }, i) => {
        const separator = (i > 0 || unplaced) && <ChevronRight size={13} className={`crumb-sep${ahead ? ' ahead' : ''}`} aria-hidden />
        if (Array.isArray(item))
          return (
            <Fragment key={ahead ? 'fold ahead' : 'fold'}>
              {separator}
              <CrumbFold steps={item} ahead={ahead} />
            </Fragment>
          )
        const name = crumbName(doc, item.id)
        return (
          <Fragment key={item.id}>
            {separator}
            {item === here ? (
              <span className="crumb here" aria-current="location" title={note ? `${name}\n${note}` : name}>
                <CrumbName id={item.id} />
              </span>
            ) : ahead ? (
              <button className="crumb ahead" title={t('Back into “{name}”', { name })} onClick={() => returnTo(item.id)}>
                <CrumbName id={item.id} />
              </button>
            ) : (
              <button className="crumb" title={name} onClick={() => leaveTo(item.id)}>
                <CrumbName id={item.id} />
              </button>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/** The drawing area: the canvas with everything that floats over it. */
/**
 * A reading, out of the way in the corner: where the pointer is. A component of its own, as it
 * changes with every movement of the pointer: read by the stage, it redrew the tool bars each time.
 */
function Status() {
  const status = useStore((s) => s.status)
  return (
    <div className="status">
      <span>{status}</span>
    </div>
  )
}

export function Stage() {
  const toast = useWindows((s) => s.toast)
  return (
    <main className="stage">
      <CanvasView />
      <Breadcrumb />
      <Status />
      {toast && <div className="toast">{toast}</div>}
      <Hints />
      <InstanceBar />
      <TextEditor />
      <ClearanceEditor />
      <QuickBar />
      <Toolbar />
      <ViewBar />
    </main>
  )
}
