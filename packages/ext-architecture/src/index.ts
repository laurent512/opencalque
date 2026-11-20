import type { Extension, Op, ParametricKind } from '@opencalque/core'
import { bathtub, showerHead, showerTray, toilet, wallHungToilet, washbasin } from './bathroom'
import { compass } from './compass'
import { banquette, chair, cornerSofa, desk, officeChair, sofa } from './furniture'
import { fireplace, gasBoiler, heatPump, radiator, RADIATOR_TOP, waterHeater } from './heating'
import { bedsideTable, chestOfDrawers, wardrobe } from './bedroom'
import { baseUnit, dishwasher, fridge, hob, hood, sink, splashback, tallUnit, wallCabinet, washingMachine, worktop } from './kitchen'
import { door, windowKind } from './openings'
import { pt } from './shared'
import { lStair, spiralStair, straightStair, uStair } from './stairs'
import { translations } from './translations'

/**
 * Bundled extension, and the reference for writing one: it depends only on @opencalque/core and
 * contributes doors, windows, stairs, washbasins, a bathtub, toilets, a shower tray and its
 * fittings, the kitchen (units, worktop, hob, sink, appliances, hood, splashback), bedroom
 * furniture, a corner sofa, a banquette, heating (a radiator, a heat pump's outdoor unit, a gas boiler, a water heater, a fireplace), and one command.
 * Furniture and appliances draw themselves in elevations, from in front and from the side
 * (`front`, `side`, in fronts.ts).
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
    for (const kind of [toilet, wallHungToilet, showerTray, showerHead]) api.registerParametric(kind)
    // On a worktop.
    api.registerParametric(tall(hob, 900))
    api.registerParametric(tall(sink, 900))
    api.registerParametric(tall(fridge('arch.fridge', 'Fridge', 600, 650, 1, 1850), 1850))
    api.registerParametric(tall(fridge('arch.fridge.american', 'American fridge', 910, 730, 2, 1780), 1780))
    // Standing against the wall, as tall as their height says.
    for (const kind of [baseUnit, worktop, tallUnit, dishwasher, washingMachine, bedsideTable, chestOfDrawers, wardrobe]) api.registerParametric(kind)
    // Hung on the wall at its height, not standing on the floor.
    api.registerParametric(wallCabinet)
    api.registerParametric(hood)
    api.registerParametric(splashback)
    // Against two walls, which a snap to one cannot put it against.
    api.registerParametric(tall(cornerSofa, 850, false))
    for (const kind of [sofa('arch.sofa', 'Sofa', 1600, 2), sofa('arch.armchair', 'Armchair', 850, 1), chair, banquette, desk, officeChair]) api.registerParametric(kind)
    api.registerParametric(tall(radiator, RADIATOR_TOP))
    for (const kind of [heatPump, gasBoiler, waterHeater, fireplace]) api.registerParametric(kind)
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
