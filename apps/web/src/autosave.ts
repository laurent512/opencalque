import { serializeDocument } from '@opencalque/core'
import { t } from './i18n'
import { platform } from './platform'
import { usePrefs } from './prefs'
import { isDirty, toast, useStore } from './store'

/** How long the drawing must have been left alone before it is saved, in milliseconds. */
const DELAY = 2000

let timer: ReturnType<typeof setTimeout> | undefined
/** Set after a failure so that it is reported once, not every few seconds. */
let failing = false

/** Whether changes to the drawing that is open are being saved by themselves. */
export function autosaves(file = useStore.getState().file): boolean {
  // Only a drawing that already has a place to be written to: a path, or a file the browser may write.
  return usePrefs.getState().autosave && Boolean(file?.token)
}

async function save(): Promise<void> {
  const { doc, file, base, saved } = useStore.getState()
  if (!autosaves(file) || base || doc === saved) return
  try {
    const stored = await platform.save(serializeDocument(doc), file!.name, file!.token)
    // The drawing may have been changed, or another one opened, while this one was being written.
    if (stored && useStore.getState().file === file) useStore.setState({ saved: doc })
    failing = false
  } catch (error) {
    if (!failing) toast(t('The drawing could not be saved automatically: {reason}', { reason: (error as Error).message }))
    failing = true
  }
}

/**
 * Saves the drawing to its file a moment after each change, when the setting is on. A drawing that
 * was never saved has no file yet and is left alone until it is saved once. Returns a function
 * that stops it.
 */
export function startAutosave(): () => void {
  const check = () => {
    clearTimeout(timer)
    const s = useStore.getState()
    // Not in the middle of a gesture or of typing a text: what is on screen then is only a preview.
    if (autosaves(s.file) && !s.base && !s.editingText && isDirty(s)) timer = setTimeout(save, DELAY)
  }
  const stops = [useStore.subscribe(check), usePrefs.subscribe(check)]
  return () => {
    clearTimeout(timer)
    for (const stop of stops) stop()
  }
}
