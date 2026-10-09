import { useEffect, useRef, useState } from 'react'
import {
  BrickWall,
  Check,
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
  Redo2,
  Ruler,
  RulerDimensionLine,
  Search,
  Spline,
  SeparatorVertical,
  Square,
  SquareDashed,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { zoomToFit } from './actions'
import { CanvasView } from './canvas/CanvasView'
import { executeById, useShortcutLabel } from './commands'
import { msg, t } from './i18n'
import { QuickBar } from './QuickBar'
import { editComponent, redo, registry, ROOM_TOOLS, setTool, SHAPE_TOOLS, TEXT_TOOLS, undo, useStore, type Tool } from './store'
import { TextEditor } from './TextEditor'
import { IconButton, labelOf } from './ui'

const ICONS: Partial<Record<Tool, [title: string, icon: LucideIcon]>> = {
  select: [msg('Select'), MousePointer2],
  hand: [msg('Pan'), Hand],
  line: [msg('Line'), Minus],
  rect: [msg('Rectangle'), Square],
  ellipse: [msg('Ellipse'), Circle],
  polyline: [msg('Polyline'), Spline],
  wall: [msg('Wall'), BrickWall],
  dimension: [msg('Dimension: annotate a distance on the drawing'), RulerDimensionLine],
  measure: [msg('Measure: read a distance without drawing anything'), Ruler],
  text: [msg('Text'), Type],
  annotation: [msg('Annotation: a note with an arrow to what it is about'), MessageSquare],
  paper: [msg('Paper: a sheet that frames what goes on one page'), StickyNote],
  room: [msg('Room: name the space inside closed walls'), SquareDashed],
  divider: [msg('Room divider: separates two rooms where there is no wall'), SeparatorVertical],
}

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
  useStore((s) => s.extensionsVersion)
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
    <button role="menuitem" onClick={onPick}>
      <span className="menu-check">{current && <Check size={12} />}</span>
      <Icon size={15} />
      {/* Just the name: the explanation after the colon belongs in the button's tooltip, not in a list. */}
      <span className="menu-title">{t(title).split(/\s*:/)[0]}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

/** One button for several related tools: it shows the one used last, and the arrow beside it lists the others. */
function ToolGroup({ tools, current: shape, more }: { tools: Tool[]; current: Tool; more: string }) {
  const [open, setOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!group.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

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
        </div>
      )}
    </div>
  )
}

type Hint = [key: string, text: string]

/**
 * What to do next with the tool in use, and the keys that matter at this very step: nothing is
 * shown that cannot be used yet. Each hint is a key and what it does; an empty key is a plain
 * instruction, and the first one is always the next thing to do.
 */
function hintsFor(tool: Tool, step: number, opening: boolean): Hint[] {
  const free: Hint = ['Alt', t('ignores the grid and snapping')]
  const angles: Hint = ['Shift', t('keeps to 45° steps')]
  const typed: Hint = ['0-9', t('type an exact length')]
  switch (tool) {
    case 'wall':
      if (step === 0) return [['', t('Click where the wall starts')]]
      // A loop needs at least two walls drawn before a third can close it.
      return [['', t('Click the next corner')], typed, angles, free, ...(step >= 3 ? [['', t('Double-click closes the loop')] as Hint] : []), ['Esc', t('finishes')]]
    case 'room':
      return [['', t('Click inside a closed region of walls')]]
    case 'divider':
      return step === 0 ? [['', t('Click where the divider starts, on a wall')]] : [['', t('Click where it ends, on the wall opposite')], angles, free, ['Esc', t('finishes')]]
    case 'line':
      return step === 0 ? [['', t('Click where the line starts')]] : [['', t('Click where it ends')], typed, angles, free, ['Esc', t('finishes')]]
    case 'polyline':
      if (step === 0) return [['', t('Click the first point')]]
      return [['', t('Click the next point')], typed, angles, free, ...(step >= 3 ? [['', t('Click the first point again to close the shape')] as Hint] : []), ['Enter', t('finishes')]]
    case 'rect':
    case 'ellipse':
      return step === 0 ? [['', t('Click a corner, or type a width and a height first and click to place it')]] : [['', t('Click the opposite corner')], ['0-9', t('type an exact size')], free]
    case 'paper':
      return step === 0 ? [['', t('Click a corner of the sheet')]] : [['', t('Pull towards a format to take it, or click anywhere for a size of your own')], ['Alt', t('any size')]]
    case 'dimension':
      return step === 0 ? [['', t('Click the first point to measure from')]] : step === 1 ? [['', t('Click the second point')], angles, free] : [['', t('Click where the dimension line should sit')], free]
    case 'measure':
      return step === 0 ? [['', t('Click the first point')]] : [['', t('Click the second point')], angles, free]
    case 'text':
      return [['', t('Click where the text starts, then type')]]
    case 'annotation':
      return step === 0 ? [['', t('Click what the note is about')]] : [['', t('Click where the note goes, then type it')], free]
    case 'place':
      return opening ? [['', t('Click a wall to place it')], ['R', t('rotates')], ['Alt', t('places it freely, off walls and grid')]] : [['', t('Click to place it')], ['R', t('rotates')], free]
    default:
      return []
  }
}

function Hints() {
  const tool = useStore((s) => s.tool)
  const step = useStore((s) => s.drawStep)
  const typing = useStore((s) => s.editingText !== null)
  const measured = useStore((s) => s.calibration !== null)
  const opening = useStore((s) => s.placing?.type === 'parametric' && Boolean(registry.parametric.get(s.placing.kind)?.opening))
  // With the select tool, a preview in progress is an object being moved, reshaped, scaled or turned.
  const dragging = useStore((s) => s.tool === 'select' && s.base !== null && !s.editingText)
  const walls = useStore((s) => s.selection.some((id) => s.doc.nodes[id]?.type === 'wall'))
  let hints: Hint[]
  if (typing) hints = [['', t('Type the text')], ['Enter', t('finishes')]]
  else if (tool === 'calibrate') {
    // Two points on the plan, then their real distance, which is typed in the panel.
    hints = measured
      ? [['', t('Type the real distance between the two points, in the panel on the right')]]
      : step === 0
        ? [['', t('Click the first of two points whose real distance you know')]]
        : [['', t('Click the second point')], ['Shift', t('keeps it level, upright or at 45°')]]
  }
  else if (dragging) hints = walls ? [['', t('Joined walls stretch to stay joined')], ['Alt', t('moves it alone, off the grid')]] : [['Alt', t('ignores the grid and snapping')]]
  else hints = hintsFor(tool, step, opening)
  if (hints.length === 0) return null
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
  const zoom = useStore((s) => s.view.zoom)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const shapeTool = useStore((s) => s.shapeTool)
  const roomTool = useStore((s) => s.roomTool)
  const textTool = useStore((s) => s.textTool)
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
      <CommandButton command="warehouse.components" title={t('Component library: stairs, furniture and every other object')} onClick={() => executeById('warehouse.components')}>
        <LibraryBig size={18} />
      </CommandButton>
      <hr />
      <ToolButton id="dimension" />
      <ToolButton id="measure" />
      <ToolGroup tools={TEXT_TOOLS} current={textTool} more={t('Annotation')} />
      <ToolButton id="paper" />
      <hr />
      <CommandButton command="edit.undo" title={t('Undo')} onClick={undo} disabled={!canUndo}>
        <Undo2 size={18} />
      </CommandButton>
      <CommandButton command="edit.redo" title={t('Redo')} onClick={redo} disabled={!canRedo}>
        <Redo2 size={18} />
      </CommandButton>
      <hr />
      <CommandButton command="view.zoomToFit" title={t('Zoom to fit')} onClick={zoomToFit}>
        <Maximize size={18} />
      </CommandButton>
      <CommandButton command="palette.open" title={t('All commands and shortcuts')} onClick={() => executeById('palette.open')}>
        <Search size={18} />
      </CommandButton>
      <span className="zoom" title={t('Screen pixels per metre')}>
        {Math.round(zoom * 1000)} px/m
      </span>
    </div>
  )
}

/** The drawing area: the canvas with everything that floats over it. */
export function Stage() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const page = useStore((s) => s.page)
  const status = useStore((s) => s.status)
  const toast = useStore((s) => s.toast)
  return (
    <main className="stage">
      <CanvasView />
      {scope !== page && (
        <div className="banner">
          {doc.nodes[scope]?.type === 'group'
            ? t('Editing inside the group “{name}”.', { name: labelOf(doc, doc.nodes[scope]) })
            : t('Editing component “{name}”. The red and green axes cross at its insertion point.', { name: labelOf(doc, doc.nodes[scope]) })}
          <button onClick={() => editComponent(null)}>{t('Done')}</button>
        </div>
      )}
      <div className="status">{status}</div>
      {toast && <div className="toast">{toast}</div>}
      <Hints />
      <TextEditor />
      <QuickBar />
      <Toolbar />
    </main>
  )
}
