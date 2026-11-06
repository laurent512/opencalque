import { runDrawingTool } from '@opencalque/core'
import { platform } from '../platform'
import { usePrefs } from '../prefs'
import { openDrawing } from './chat'

/*
 * Lets agents outside the app work on the open drawing, while the person allows it: the desktop app
 * hands calls over from `opencalque mcp --live`, and they run here, on the same tools as the
 * assistant, so that each edit is a step of the undo like any other.
 */
export function startAgentBridge(): void {
  const bridge = platform.agentBridge
  if (!bridge) return
  bridge.onCall(async (name, input) => {
    try {
      const { note: _, ...result } = await runDrawingTool(name, input, openDrawing)
      return result
    } catch (error) {
      return { content: (error as Error).message, isError: true }
    }
  })
  bridge.set(usePrefs.getState().agentBridge)
  usePrefs.subscribe((now, before) => {
    if (now.agentBridge !== before.agentBridge) bridge.set(now.agentBridge)
  })
}
