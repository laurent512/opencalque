import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, createDocument, mountedOn, mountOf, snapMountToWall, type Document, type NodeOf, type Op } from '@opencalque/core'
import { standardRegistry } from '../src'

/*
 * How every object that ships stands to walls (ARCHITECTURE §4, "Fixed on walls"). An object whose
 * kind says `mount` is put against the wall the pointer nears, turned to stand out of it, and
 * follows the wall when it changes; one that says nothing is left where it is put, as it was drawn.
 * A WC that said nothing once stayed square to the page beside a wall it should have gone against:
 * so each new kind is either made to go against walls or written below, with why it does not.
 */

/** The kinds that are not put against a wall, by why. Everything else that ships must say `mount`. */
const NOT_AGAINST_WALLS: Record<string, string[]> = {
  // In a wall, by their own snap (`snapOpeningToWall`), not against its face.
  'in a wall': ['arch.door', 'arch.window'],
  'standing in the room': ['arch.stair', 'arch.stair.l', 'arch.stair.u', 'arch.stair.spiral', 'arch.chair', 'arch.chair.high', 'arch.officechair', 'furn.table'],
  // Its two backs go against two walls, which a snap to one cannot put it against.
  'in a corner': ['arch.sofa.corner'],
  'on the ceiling': ['elec.light', 'elec.pendant', 'elec.spot', 'elec.strip', 'elec.junction', 'elec.smoke', 'elec.fan', 'elec.motion'],
  'notes on the drawing': ['arch.compass', 'note.north', 'note.scalebar', 'note.level'],
}

const registry = standardRegistry()
const free = new Set(Object.values(NOT_AGAINST_WALLS).flat())

/** A wall 6 m long and 200 thick along X: the face below it, the room's, at y = 100. */
const WALL = { type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 }
const FACE = 100

const plan = (...nodes: Record<string, unknown>[]): Document =>
  applyOps(createDocument('Plan'), [WALL, ...nodes].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))

describe('every object that ships', () => {
  it('either goes against walls or is listed as one that does not, with why', () => {
    const kinds = [...registry.parametric.keys()]
    const unsaid = kinds.filter((kind) => !free.has(kind) && !mountOf({ type: 'parametric', kind } as NodeOf<'parametric'>, registry))
    expect(unsaid, 'kinds that neither go against walls nor are listed here').toEqual([])
    // Nor is one listed that goes against walls, or that no longer ships.
    expect([...free].filter((kind) => !registry.parametric.has(kind) || mountOf({ type: 'parametric', kind } as NodeOf<'parametric'>, registry))).toEqual([])
  })

  const mounted = [...registry.parametric.values()].filter((kind) => kind.mount)
  it.each(mounted.map((kind) => [kind.kind]))('%s, put near a wall turned any way, goes on its face, turned to stand out of it into the room', (kind) => {
    for (const rotation of [0, 90, 180, 270]) {
      const at = snapMountToWall(plan(), 'page_1', registry, { kind, props: {}, rotation }, { x: 3000, y: 400 }, 600, 10)
      expect(at, `${kind} at ${rotation}°`).not.toBeNull()
      const doc = plan({ type: 'parametric', id: 'o', kind, props: {}, ...at })
      expect(mountedOn(doc, doc.nodes.o, registry)?.face, `${kind} at ${rotation}°`).toBe('right')
      // What it draws touches the face and stays out of the wall, on the room's side.
      const drawn = boundsOf(buildScene(doc, 'page_1', registry).find((item) => item.id === 'o')!.prims)!
      expect(drawn.minY, `${kind} at ${rotation}°: the side nearest the wall`).toBeCloseTo(FACE, 0)
      expect(drawn.maxY).toBeGreaterThan(FACE)
    }
  })
})
