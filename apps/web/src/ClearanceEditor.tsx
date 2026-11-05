import { clearanceOps } from '@opencalque/core'
import { useEffect, useRef } from 'react'
import { clearanceLabel, useClearances } from './canvas/clearances'
import { registry } from './extensions'
import { t } from './i18n'
import { apply, useStore } from './store'
import { formatNumber, parseLength } from './units'

/**
 * The length of a temporary dimension being typed, over where it is written: Enter moves the
 * object measured so that it is that far, Esc or a click elsewhere leaves it as it was. A length
 * is typed in the unit of the preferences, or with a unit after it.
 */
export function ClearanceEditor() {
  const measuring = useStore((s) => s.measuring)
  const view = useStore((s) => s.view)
  const measured = useClearances()
  const field = useRef<HTMLInputElement>(null)
  const clearance = measuring === null ? undefined : measured?.list[measuring]
  // Focused once the click that opened it has finished: focusing during it is undone when the
  // browser moves focus to what was clicked, which would close it at once.
  useEffect(() => {
    const timer = setTimeout(() => {
      field.current?.focus()
      field.current?.select()
    })
    return () => clearTimeout(timer)
  }, [clearance !== undefined, measuring])
  if (!measured || !clearance) return null
  const label = clearanceLabel(clearance, view)
  const close = () => useStore.setState({ measuring: null })
  const commit = (text: string) => {
    const length = parseLength(text)
    close()
    if (length === null || length < 0) return
    apply(clearanceOps(useStore.getState().doc, measured.node, clearance, length, registry))
  }
  return (
    <input
      ref={field}
      className="clearance-editor"
      aria-label={t('Distance to the wall')}
      style={{ left: label.x - 8, top: label.y - 2, width: label.width + 16 }}
      defaultValue={formatNumber(clearance.length)}
      key={`${measuring}:${clearance.length}`}
      onKeyDown={(e) => {
        // Its keys are its own: Delete or an arrow must not act on the drawing meanwhile.
        e.stopPropagation()
        if (e.key === 'Enter') commit(e.currentTarget.value)
        else if (e.key === 'Escape') close()
      }}
      onBlur={close}
    />
  )
}
