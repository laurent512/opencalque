import { buildScene, type Document, type SceneItem } from '@opencalque/core'
import { registry, useExtensions } from './extensions'

/**
 * The scene of what is shown, built once for each state of the drawing and shared by everything on
 * screen that needs it: the canvas, which builds it (or brings it up to date from the last one,
 * `sceneAfterViewpoints`) and keeps it here (`keepScene`), the names of views, which go by what
 * covers them, and the frames of viewpoints. Each of them built it again for itself, three times a
 * step of a drag on a plan with views.
 */
const kept = new WeakMap<Document['nodes'], Map<string, SceneItem[]>>()

const key = (scope: string) => `${scope} ${useExtensions.getState().version}`

/** The scene of `scope` in `doc`, as kept, else built and kept. */
export function sceneOf(doc: Document, scope: string): SceneItem[] {
  let byScope = kept.get(doc.nodes)
  if (!byScope) kept.set(doc.nodes, (byScope = new Map()))
  let scene = byScope.get(key(scope))
  if (!scene) byScope.set(key(scope), (scene = buildScene(doc, scope, registry)))
  return scene
}

/** The scene of `scope` in `doc` as already kept, if it is. */
export const keptScene = (doc: Document, scope: string): SceneItem[] | undefined => kept.get(doc.nodes)?.get(key(scope))

/** Keeps the scene the canvas made, for the rest of the screen to take. */
export function keepScene(doc: Document, scope: string, scene: SceneItem[]): void {
  let byScope = kept.get(doc.nodes)
  if (!byScope) kept.set(doc.nodes, (byScope = new Map()))
  byScope.set(key(scope), scene)
}
