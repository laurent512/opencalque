import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** The shortest the thumb gets, in pixels, however long what it scrolls. */
const SHORTEST = 24
/** How long the thumb stays after the last scroll, when the pointer is not over the area, in ms. */
const LINGER = 900

/**
 * A scrollbar laid over the right edge of `of`, an area that scrolls without the system's (which
 * kept a strip of the panel for itself, `scrollbar-width: none` on it): a thin thumb, shown while
 * the pointer is over the area or it scrolls, and dragged to scroll. Nothing when everything is in
 * sight. It is put beside the area, in a parent that is `position: relative`.
 */
export function ScrollThumb({ of }: { of: HTMLElement | null }) {
  const [bar, setBar] = useState({ top: 0, height: 0, needed: false })
  const [awake, setAwake] = useState(false)
  const [dragging, setDragging] = useState(false)
  const sleep = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = useRef(false)

  useEffect(() => {
    if (!of) return
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = of
      const needed = scrollHeight > clientHeight + 1
      const height = needed ? Math.max(SHORTEST, (clientHeight * clientHeight) / scrollHeight) : 0
      const top = needed ? (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height) : 0
      setBar((was) => (was.top === top && was.height === height && was.needed === needed ? was : { top, height, needed }))
    }
    const wake = () => {
      setAwake(true)
      if (sleep.current) clearTimeout(sleep.current)
      sleep.current = setTimeout(() => !hovered.current && setAwake(false), LINGER)
    }
    const scrolled = () => {
      measure()
      wake()
    }
    const enter = () => {
      hovered.current = true
      measure()
      setAwake(true)
    }
    const leave = () => {
      hovered.current = false
      wake()
    }
    measure()
    of.addEventListener('scroll', scrolled, { passive: true })
    const area = of.parentElement ?? of
    area.addEventListener('pointerenter', enter)
    area.addEventListener('pointerleave', leave)
    // What it holds grows and shrinks as rows come and go, sections fold and the panel is resized.
    const resized = new ResizeObserver(measure)
    resized.observe(of)
    for (const child of of.children) resized.observe(child)
    const changed = new MutationObserver(() => {
      for (const child of of.children) resized.observe(child)
      measure()
    })
    changed.observe(of, { childList: true })
    return () => {
      of.removeEventListener('scroll', scrolled)
      area.removeEventListener('pointerenter', enter)
      area.removeEventListener('pointerleave', leave)
      resized.disconnect()
      changed.disconnect()
      if (sleep.current) clearTimeout(sleep.current)
    }
  }, [of])

  const grab = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!of || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const thumb = event.currentTarget
    thumb.setPointerCapture(event.pointerId)
    setDragging(true)
    const startY = event.clientY
    const startTop = of.scrollTop
    const ratio = (of.scrollHeight - of.clientHeight) / Math.max(1, of.clientHeight - bar.height)
    const move = (e: PointerEvent) => {
      of.scrollTop = startTop + (e.clientY - startY) * ratio
    }
    const end = () => {
      setDragging(false)
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', end)
      thumb.removeEventListener('pointercancel', end)
    }
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', end)
    thumb.addEventListener('pointercancel', end)
  }

  if (!bar.needed) return null
  return <div className={`scroll-thumb${awake || dragging ? ' awake' : ''}${dragging ? ' dragging' : ''}`} style={{ top: bar.top, height: bar.height }} onPointerDown={grab} aria-hidden="true" />
}
