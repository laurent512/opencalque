import type { Extension, Op, ParametricKind } from '@opencalque/core'
import { bathtub, washbasin } from './bathroom'
import { compass } from './compass'
import { cornerSofa } from './furniture'
import { radiator } from './heating'
import { fridge, hob, sink, wallCabinet } from './kitchen'
import { door, windowKind } from './openings'
import { pt } from './shared'
import { lStair, spiralStair, straightStair, uStair } from './stairs'
import { translations } from './translations'

/**
 * Bundled extension, and the reference for writing one: it depends only on @opencalque/core and
 * contributes doors, windows, stairs, washbasins, a bathtub, a hob, a sink and fridges for the
 * kitchen, a corner sofa, a radiator, and one command.
 *
 * Every object is drawn in local coordinates with the insertion point at the origin. Doors and
 * windows run along +X (the wall centerline) and are told the thickness of the wall they sit in.
 */
export const architecture: Extension = {
  id: 'opencalque.architecture',
  name: 'Architecture',
  version: '0.5.0',
  translations,
  activate(api) {
    for (const kind of [door, windowKind, straightStair, lStair, uStair, spiralStair]) api.registerParametric(kind)
    // How tall each stands on the floor, which an elevation draws them as, and, for those whose back
    // goes against a wall (their own Y = 0), standing against it: they snap to walls and follow them.
    const tall = (kind: ParametricKind, mm: number, against = true): ParametricKind => ({ ...kind, height: () => mm, ...(against ? { mount: { on: 'floor' } } : {}) })
    api.registerParametric(tall(washbasin('arch.washbasin', 'Washbasin', 600, 450, 1), 850))
    api.registerParametric(tall(washbasin('arch.washbasin.double', 'Double washbasin', 1200, 500, 2), 850))
    api.registerParametric(tall(bathtub, 580))
    // On a worktop.
    api.registerParametric(tall(hob, 900))
    api.registerParametric(tall(sink, 900))
    api.registerParametric(tall(fridge('arch.fridge', 'Fridge', 600, 650, 1), 1850))
    api.registerParametric(tall(fridge('arch.fridge.american', 'American fridge', 910, 730, 2), 1780))
    // Hung on the wall at its height, not standing on the floor.
    api.registerParametric(wallCabinet)
    // Against two walls, which a snap to one cannot put it against.
    api.registerParametric(tall(cornerSofa, 850, false))
    api.registerParametric(tall(radiator, 600))
    api.registerParametric(compass)

    api.registerCommand({
      id: 'arch.room',
      title: 'Insert 4 × 3 m room',
      run(host) {
        const corners = [pt(0, 0), pt(4000, 0), pt(4000, 3000), pt(0, 3000)]
        host.apply(
          corners.map((a, i): Op => ({
            op: 'add_node',
            node: { type: 'wall', parent: host.scope, layer: host.activeLayer, a, b: corners[(i + 1) % 4], thickness: 200 },
          })),
        )
      },
    })
  },
}
