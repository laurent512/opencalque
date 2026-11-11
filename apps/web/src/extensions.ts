import { create } from 'zustand'
import { declarativeExtension, Registry } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import { bundledExtensions } from '@opencalque/warehouse'
import { setPrefs, usePrefs } from './prefs'

/** The one extension that is compiled into the app. It can be switched off but not removed. */
export const BUILT_IN_EXTENSION = architecture.id
/**
 * Extensions that ship with the app and are in use from the start, as the built-in one is: switched
 * off and on, never installed or removed, and always the copy that ships. The electrical symbols,
 * whose objects took the place of the library of electrical components.
 */
export const ALWAYS_ON = ['opencalque.electrical']

/**
 * The extensions in use. It is always this same object; `loadExtensions` refills it, and
 * `useExtensions`'s version changes so that whatever depends on it redraws.
 */
export const registry = new Registry()

/** Goes up whenever the set of extensions in use changes: what was drawn, listed or translated with the old set is out of date. */
export const useExtensions = create(() => ({ version: 0 }))

/** Whether version `a` ("1.2.0") is later than `b`. */
const later = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map((part) => parseInt(part, 10) || 0))
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/**
 * Puts the built-in extension and those always on (unless switched off), and every installed one,
 * into the registry.
 * An installed extension that no longer loads is skipped, so one bad file cannot stop the app. One
 * installed from those that ship with the app is replaced by the one that ships now, when that is
 * a later version: it was installed as a copy, and would otherwise never get what was added to it.
 * Called once at start (`main.tsx`) and after every change to what is installed or switched off.
 */
export function loadExtensions(): void {
  const stored = usePrefs.getState().extensions
  const newer = bundledExtensions().filter((extension) => stored.installed[extension.id] && later(extension.version, stored.installed[extension.id].version))
  if (newer.length > 0) setPrefs({ extensions: { ...stored, installed: { ...stored.installed, ...Object.fromEntries(newer.map((extension) => [extension.id, extension])) } } })
  const { installed, disabled } = usePrefs.getState().extensions
  registry.clear()
  if (!disabled.includes(BUILT_IN_EXTENSION)) registry.use(architecture)
  for (const extension of bundledExtensions()) if (ALWAYS_ON.includes(extension.id) && !disabled.includes(extension.id)) registry.use(declarativeExtension(extension))
  // A copy of one always on, installed before it was, is left for the one that ships.
  for (const extension of Object.values(installed).filter((one) => !ALWAYS_ON.includes(one.id))) {
    try {
      registry.use(declarativeExtension(extension))
    } catch (error) {
      console.warn(`Extension ${extension.id} was not loaded:`, error)
    }
  }
  useExtensions.setState((s) => ({ version: s.version + 1 }))
}
