/**
 * The app's scrollbars. The system's take a strip of whatever scrolls, and appear and disappear
 * with its content, moving everything beside them; they are switched off everywhere
 * (`scrollbar-width: none` on every element, styles.css). In their place, one thin thumb is laid
 * over the edge of whatever scrolls under the pointer, or has just scrolled: shown while the
 * pointer is over it and for a moment after it scrolls, dragged to scroll. One per direction for
 * the whole app, so any area that scrolls has it, a window, a menu, a list or a panel alike,
 * without anything to add to it.
 */

/** The shortest a thumb gets, in pixels, however long what it scrolls. */
const SHORTEST = 24
/** How long a thumb stays after the last scroll when the pointer is not over the area, in ms. */
const LINGER = 900
/** The strip along the edge a thumb takes, in pixels: wider than the bar it shows, to be easy to grab. */
const STRIP = 12

type Axis = 'y' | 'x'

const scrolls = (el: HTMLElement, axis: Axis) => {
  const style = getComputedStyle(el)
  const overflow = axis === 'y' ? style.overflowY : style.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
}

/** The innermost area holding `node` that scrolls either way. */
function scrollerOf(node: EventTarget | null): HTMLElement | null {
  for (let el = node instanceof Element ? node : null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el instanceof HTMLElement && (scrolls(el, 'y') || scrolls(el, 'x'))) return el
  }
  return null
}

/** Starts the app's scrollbars; returns what stops them. */
export function startScrollbars(): () => void {
  const thumbs = { y: document.createElement('div'), x: document.createElement('div') }
  for (const axis of ['y', 'x'] as const) {
    thumbs[axis].className = `scroll-thumb ${axis === 'y' ? 'vertical' : 'horizontal'}`
    thumbs[axis].setAttribute('aria-hidden', 'true')
    document.body.append(thumbs[axis])
  }

  /** The area the thumbs are on. */
  let target: HTMLElement | null = null
  /** The area under the pointer, if one scrolls. */
  let hovered: HTMLElement | null = null
  let dragging: Axis | null = null
  let awake = false
  let frame = 0
  let sleep: ReturnType<typeof setTimeout> | null = null

  const place = (axis: Axis) => {
    const thumb = thumbs[axis]
    if (!target || !target.isConnected || !scrolls(target, axis)) return void (thumb.style.display = 'none')
    const box = target.getBoundingClientRect()
    const left = box.left + target.clientLeft
    const top = box.top + target.clientTop
    thumb.style.display = ''
    if (axis === 'y') {
      const seen = target.clientHeight
      const length = Math.max(SHORTEST, (seen * seen) / target.scrollHeight)
      const at = (target.scrollTop / (target.scrollHeight - seen)) * (seen - length)
      Object.assign(thumb.style, { left: `${left + target.clientWidth - STRIP}px`, top: `${top + at}px`, width: `${STRIP}px`, height: `${length}px` })
    } else {
      const seen = target.clientWidth
      const length = Math.max(SHORTEST, (seen * seen) / target.scrollWidth)
      const at = (Math.abs(target.scrollLeft) / (target.scrollWidth - seen)) * (seen - length)
      Object.assign(thumb.style, { left: `${left + at}px`, top: `${top + target.clientHeight - STRIP}px`, width: `${length}px`, height: `${STRIP}px` })
    }
  }

  // While awake, the thumbs follow the area every frame: it scrolls, grows as rows come, moves with its window.
  const follow = () => {
    place('y')
    place('x')
    frame = awake ? requestAnimationFrame(follow) : 0
  }

  const setAwake = (on: boolean) => {
    awake = on
    for (const thumb of Object.values(thumbs)) thumb.classList.toggle('awake', on)
    if (on && !frame) frame = requestAnimationFrame(follow)
  }

  /** Shows the thumbs, and lets them go after a moment unless the pointer is on the area or one is held. */
  const wake = () => {
    setAwake(true)
    if (sleep) clearTimeout(sleep)
    sleep = setTimeout(() => {
      if (!dragging && hovered !== target) setAwake(false)
    }, LINGER)
  }

  const over = (event: PointerEvent) => {
    if (dragging || event.target === thumbs.y || event.target === thumbs.x) return
    const found = scrollerOf(event.target)
    if (found === hovered) return
    hovered = found
    if (found) target = found
    wake()
  }

  const out = (event: PointerEvent) => {
    // The pointer left the window.
    if (event.relatedTarget === null && !dragging) {
      hovered = null
      wake()
    }
  }

  const scrolled = (event: Event) => {
    const el = event.target
    if (!(el instanceof HTMLElement) || dragging) return
    if (el !== target && !(scrolls(el, 'y') || scrolls(el, 'x'))) return
    target = el
    wake()
  }

  // Caught on the window before anything else (`startScrollbars` runs before the app does), so that
  // grabbing the thumb of an open menu's list does not count as a click outside it, which closes it.
  const press = (event: PointerEvent) => {
    const axis = event.target === thumbs.y ? 'y' : event.target === thumbs.x ? 'x' : null
    const area = target
    if (!axis || !area || event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const thumb = thumbs[axis]
    thumb.setPointerCapture(event.pointerId)
    dragging = axis
    thumb.classList.add('dragging')
    const start = axis === 'y' ? event.clientY : event.clientX
    const from = axis === 'y' ? area.scrollTop : area.scrollLeft
    const seen = axis === 'y' ? area.clientHeight : area.clientWidth
    const whole = axis === 'y' ? area.scrollHeight : area.scrollWidth
    const length = axis === 'y' ? thumb.offsetHeight : thumb.offsetWidth
    const ratio = (whole - seen) / Math.max(1, seen - length)
    const move = (e: PointerEvent) => {
      const to = from + ((axis === 'y' ? e.clientY : e.clientX) - start) * ratio
      if (axis === 'y') area.scrollTop = to
      else area.scrollLeft = to
    }
    const end = () => {
      dragging = null
      thumb.classList.remove('dragging')
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', end)
      thumb.removeEventListener('pointercancel', end)
      hovered = scrollerOf(document.elementFromPoint(lastX, lastY))
      wake()
    }
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', end)
    thumb.addEventListener('pointercancel', end)
  }
  let lastX = 0
  let lastY = 0
  const moved = (event: PointerEvent) => {
    lastX = event.clientX
    lastY = event.clientY
  }

  window.addEventListener('pointerdown', press, true)
  document.addEventListener('pointerover', over, true)
  document.addEventListener('pointerout', out, true)
  document.addEventListener('pointermove', moved, { capture: true, passive: true })
  document.addEventListener('scroll', scrolled, { capture: true, passive: true })

  return () => {
    window.removeEventListener('pointerdown', press, true)
    document.removeEventListener('pointerover', over, true)
    document.removeEventListener('pointerout', out, true)
    document.removeEventListener('pointermove', moved, true)
    document.removeEventListener('scroll', scrolled, true)
    if (sleep) clearTimeout(sleep)
    if (frame) cancelAnimationFrame(frame)
    thumbs.y.remove()
    thumbs.x.remove()
  }
}
