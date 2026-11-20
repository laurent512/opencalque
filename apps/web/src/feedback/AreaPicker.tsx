import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { Area } from './capture'
import { LIMITS } from './report'

/** A rectangle of the window, in CSS pixels. */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Where a frame is shown when fitted inside the window, and at what scale. */
function fitted(frame: HTMLCanvasElement): Box & { scale: number } {
  const scale = Math.min(innerWidth / frame.width, innerHeight / frame.height)
  const width = frame.width * scale
  const height = frame.height * scale
  return { left: (innerWidth - width) / 2, top: (innerHeight - height) / 2, width, height, scale }
}

/** Under this many pixels a drag is a click, which takes the whole frame. */
const CLICK = 6

/**
 * The frozen frame over the whole window, to drag the area to take or record over it; a click
 * takes all of it, Escape gives up. The frame is the page as it was, so choosing on it is
 * choosing on the app, whatever the browser shared.
 */
export function AreaPicker(props: { frame: HTMLCanvasElement; recording: boolean; onPick: (area: Area) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null)
  const fit = fitted(props.frame)

  useLayoutEffect(() => {
    const shown = canvas.current
    if (!shown) return
    shown.width = props.frame.width
    shown.height = props.frame.height
    shown.getContext('2d')?.drawImage(props.frame, 0, 0)
    root.current?.focus()
  }, [props.frame])

  const clamp = (e: React.PointerEvent) => ({
    x: Math.min(fit.left + fit.width, Math.max(fit.left, e.clientX)),
    y: Math.min(fit.top + fit.height, Math.max(fit.top, e.clientY)),
  })
  const box: Box | null = start && end ? { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) } : null
  const dragged = box !== null && (box.width >= CLICK || box.height >= CLICK)

  const release = () => {
    if (!start) return
    if (!box || !dragged) return props.onPick({ x: 0, y: 0, width: props.frame.width, height: props.frame.height })
    const x = Math.round((box.left - fit.left) / fit.scale)
    const y = Math.round((box.top - fit.top) / fit.scale)
    props.onPick({ x, y, width: Math.max(1, Math.min(props.frame.width - x, Math.round(box.width / fit.scale))), height: Math.max(1, Math.min(props.frame.height - y, Math.round(box.height / fit.scale))) })
  }

  return (
    <div
      ref={root}
      className="area-picker"
      tabIndex={-1}
      role="dialog"
      aria-label={props.recording ? t('Record an area') : t('Capture an area')}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') props.onCancel()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return props.onCancel()
        e.currentTarget.setPointerCapture(e.pointerId)
        setStart(clamp(e))
        setEnd(clamp(e))
      }}
      onPointerMove={(e) => start && setEnd(clamp(e))}
      onPointerUp={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }} />
      {dragged ? <div className="area-picker-box" style={box} /> : <div className="area-picker-dim" />}
      {!start && <p className="area-picker-hint">{props.recording ? t('Drag over the part to record, or click to record all of it. Escape to cancel.') : t('Drag over the part to show, or click to take all of it. Escape to cancel.')}</p>}
    </div>
  )
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/**
 * While recording: the area outlined on the app (when the frame was the page, so the outline is
 * in the right place), and a bar to stop, put beside the area rather than in it.
 */
export function RecordingBar(props: { area: Box | null; elapsed: () => number; ready: boolean; stopping: boolean; onStop: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [])
  const BAR = 44
  const { area } = props
  // Centred under the area, or over it, or at the foot of the window; never past its sides.
  const left = area ? Math.min(innerWidth - 120, Math.max(120, area.left + area.width / 2)) : innerWidth / 2
  const place: React.CSSProperties =
    area && area.top + area.height + BAR + 8 <= innerHeight
      ? { top: area.top + area.height + 8, left }
      : area && area.top >= BAR + 8
        ? { top: area.top - BAR - 8, left }
        : { bottom: 16, left }
  return (
    <>
      {area && <div className="recording-outline" style={area} />}
      <div className="recording-bar" style={place} role="status">
        <span className="recording-dot" />
        <span className="recording-time">
          {clock(props.elapsed())} / {clock(LIMITS.seconds)}
        </span>
        <button className="pill active" disabled={!props.ready || props.stopping} onClick={props.onStop}>
          {props.stopping ? t('Stopping…') : t('Stop')}
        </button>
      </div>
    </>
  )
}

/** Where an area of the frame lies in the window, when the frame is the page. */
export function boxOf(frame: HTMLCanvasElement, area: Area): Box {
  const scale = innerWidth / frame.width
  return { left: area.x * scale, top: area.y * scale, width: area.width * scale, height: area.height * scale }
}
