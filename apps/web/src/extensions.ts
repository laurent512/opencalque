import { create } from 'zustand'
import { declarativeExtension, Registry } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import { bundledExtensions } from '@opencalque/warehouse'
import { setPrefs, usePrefs } from './prefs'

/**
 * The ids of what ships with the app: the objects compiled in (doors, windows, stairs…) and those
 * written as data in `packages/warehouse/extensions` (electrical symbols, adjustable furniture,
 * annotations). They are part of the app, by the owner's choice: always in use, never installed,
 * removed or switched off, and not listed among extensions, which are what someone adds from a
 * file or a web catalog.
 */
export const SHIPPED = [architecture.id, ...bundledExtensions().map((extension) => extension.id)]

/**
 * The extensions in use. It is always this same object; `loadExtensions` refills it, and
 * `useExtensions`'s version changes so that whatever depends on it redraws.
 */
export const registry = new Registry()

/** Goes up whenever the set of extensions in use changes: what was drawn, listed or translated with the old set is out of date. */
export const useExtensions = create(() => ({ version: 0 }))

/**
 * Puts what ships with the app, and every extension installed, into the registry.
 * An installed extension that no longer loads is skipped, so one bad file cannot stop the app. A
 * copy of one that ships, installed when they were extensions (before 1.10), is forgotten: the one
 * that ships is in use. Called once at start (`main.tsx`) and after every change to what is installed.
 */
export function loadExtensions(): void {
  const stored = usePrefs.getState().extensions
  if (Object.keys(stored.installed).some((id) => SHIPPED.includes(id)) || stored.disabled.length > 0) {
    const installed = Object.fromEntries(Object.entries(stored.installed).filter(([id]) => !SHIPPED.includes(id)))
    setPrefs({ extensions: { installed, disabled: [] } })
  }
  registry.clear()
  registry.use(architecture)
  for (const extension of bundledExtensions()) registry.use(declarativeExtension(extension))
  for (const extension of Object.values(usePrefs.getState().extensions.installed)) {
    try {
      registry.use(declarativeExtension(extension))
    } catch (error) {
      console.warn(`Extension ${extension.id} was not loaded:`, error)
    }
  }
  useExtensions.setState((s) => ({ version: s.version + 1 }))
}
