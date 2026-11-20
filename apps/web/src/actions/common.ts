import { t } from '../i18n'
import { useStore } from '../store'
import { toast } from '../windows'
import { noteError } from '../feedback/errors'

/** The name of the drawing, to name what is exported from it. */
export const baseName = () => useStore.getState().doc.name.trim() || t('Untitled')

/** Runs an action, showing any failure to the user instead of losing it in the console. */
export async function guarded(action: () => void | Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    noteError(error)
    toast((error as Error).message)
  }
}
