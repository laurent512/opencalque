import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { alignables, applyEdit, applyOps, buildScene, createDocument, declarativeExtension, heightAboveFloor, mountAt, mountedOn, moveAgainstWall, Registry, snapMountToWall, splitWallOps, wallMounted, type Document, type NodeOf, type Op } from '../src'

/*
 * Objects fixed on the face of a wall (walls/mount.ts): a socket, whose flat back is its own X axis
 * and which stands out of the wall towards its +Y, and a switch, a circle whose back is 60 below its
 * centre and which stands out the other way, as the electrical symbols are drawn.
 */
const registry = new Registry().use({
  id: 'test.electrical',
  name: 'Electrical',
  version: '1.0.0',
  activate(api) {
    api.registerParametric({ kind: 'test.socket', label: 'Socket', params: [], mount: { on: 'wall', height: 300 }, build: () => [{ kind: 'path', points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }] })
    api.registerParametric({ kind: 'test.switch', label: 'Switch', params: [], mount: { on: 'wall', back: 60, out: 'up', height: 1100 }, build: () => [{ kind: 'ellipse', cx: 0, cy: 0, rx: 60, ry: 60 }] })
    api.registerParametric({ kind: 'test.lamp', label: 'Lamp', params: [], build: () => [{ kind: 'ellipse', cx: 0, cy: 0, rx: 150, ry: 150 }] })
  },
})

/** A wall 6 m long and 200 thick from (0, 0) to (6000, 0): its right face (Y down, so below it) at y = 100, its left at y = -100. */
const WALL = { type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200 }

function plan(...nodes: Record<string, unknown>[]): Document {
  return applyOps(createDocument('Plan'), [WALL, ...nodes].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
}

/** A socket put on the wall by `snapMountToWall`, where a pointer at `p` would put it. */
function socketAt(p: { x: number; y: number }, kind = 'test.socket'): Record<string, unknown> {
  const at = snapMountToWall(plan(), 'page_1', registry, { kind, props: {} }, p, 500, 100)
  expect(at).not.toBeNull()
  return { type: 'parametric', id: 's', kind, props: {}, ...at }
}

const edited = (doc: Document, ops: Op[]) => applyEdit(doc, ops, registry).doc
const where = (doc: Document) => {
  const { x, y, rotation } = doc.nodes.s as NodeOf<'parametric'>
  return { x: Math.round(x), y: Math.round(y), rotation: Math.round(rotation ?? 0) }
}

describe('objects fixed on walls', () => {
  it('go on the face on the side of the pointer, standing out of the wall, along it by the grid', () => {
    expect(socketAt({ x: 1530, y: 400 })).toMatchObject({ x: 1500, y: 100, rotation: 0 })
    expect(socketAt({ x: 1530, y: -400 })).toMatchObject({ x: 1500, y: -100, rotation: 180 })
    // The switch's back is 60 below its centre, which therefore stands 60 off the face, and it stands out upwards.
    expect(socketAt({ x: 1530, y: 400 }, 'test.switch')).toMatchObject({ x: 1500, y: 160, rotation: 180 })
    expect(snapMountToWall(plan(), 'page_1', registry, { kind: 'test.socket', props: {} }, { x: 1500, y: 2000 }, 500, 100)).toBeNull()
    expect(snapMountToWall(plan(), 'page_1', registry, { kind: 'test.lamp', props: {} }, { x: 1500, y: 200 }, 500, 100)).toBeNull()
  })

  it('know which face they are on, and are on none when off it or turned from it', () => {
    const doc = plan(socketAt({ x: 1530, y: -400 }))
    expect(mountedOn(doc, doc.nodes.s, registry)).toMatchObject({ face: 'left', along: 1500 })
    expect(mountedOn(doc, doc.nodes.s, registry)?.wall.id).toBe('w')
    const off = plan({ type: 'parametric', id: 's', kind: 'test.socket', props: {}, x: 1500, y: 105 })
    expect(mountedOn(off, off.nodes.s, registry)).toBeNull()
    const turned = plan({ type: 'parametric', id: 's', kind: 'test.socket', props: {}, x: 1500, y: 100, rotation: 30 })
    expect(mountedOn(turned, turned.nodes.s, registry)).toBeNull()
    // Facing into the wall: on the right face, but standing out of it to the left.
    const backwards = plan({ type: 'parametric', id: 's', kind: 'test.socket', props: {}, x: 1500, y: 100, rotation: 180 })
    expect(mountedOn(backwards, backwards.nodes.s, registry)).toBeNull()
  })

  it('stand at their own height, else their kind’s', () => {
    const doc = plan(socketAt({ x: 1530, y: 400 }), { type: 'parametric', id: 't', kind: 'test.switch', props: {}, x: 0, y: 2000, z: 1300 }, { type: 'parametric', id: 'l', kind: 'test.lamp', props: {}, x: 0, y: 3000 })
    expect(heightAboveFloor(doc.nodes.s, registry)).toBe(300)
    expect(heightAboveFloor(doc.nodes.t, registry)).toBe(1300)
    expect(heightAboveFloor(doc.nodes.l, registry)).toBeNull()
  })

  it('follow their wall moved, turned, made shorter or thicker, and stay on their face', () => {
    const doc = plan(socketAt({ x: 1530, y: 400 }))
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } }]))).toEqual({ x: 1500, y: 1100, rotation: 0 })
    // A quarter turn about its start, down to (0, 6000): its right face is now to the left, at x = -100.
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { b: { x: 0, y: 6000 } } }]))).toEqual({ x: -100, y: 1500, rotation: 90 })
    // Its start dragged back 1 m: it keeps its distance from the end that stayed.
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: -1000, y: 0 } } }]))).toEqual({ x: 1500, y: 100, rotation: 0 })
    // Its end brought in past it: it stays at the end.
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { b: { x: 1000, y: 0 } } }]))).toEqual({ x: 1000, y: 100, rotation: 0 })
    // Thicker: the face it is on moves out, and it with it.
    const thicker = edited(doc, [{ op: 'update_node', id: 'w', patch: { thickness: 300 } }])
    expect(where(thicker)).toEqual({ x: 1500, y: 150, rotation: 0 })
    expect(mountedOn(thicker, thicker.nodes.s, registry)?.face).toBe('right')
  })

  it('are left where an edit put them, where they still are on a face, and when they were on no wall', () => {
    const doc = plan(socketAt({ x: 1530, y: 400 }))
    const moved = edited(doc, [
      { op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } },
      { op: 'update_node', id: 's', patch: { x: 3000, y: 3000 } },
    ])
    expect(where(moved)).toEqual({ x: 3000, y: 3000, rotation: 0 })
    // Made longer at its other end, turned round, or cut in two: it is on a face as it was.
    for (const ops of [[{ op: 'update_node', id: 'w', patch: { b: { x: 8000, y: 0 } } }], [{ op: 'update_node', id: 'w', patch: { a: { x: 6000, y: 0 }, b: { x: 0, y: 0 } } }], splitWallOps(doc.nodes.w as never, { x: 3000, y: 0 }, 'w2')!.ops] as Op[][]) {
      const after = applyEdit(doc, ops, registry)
      expect(after.doc.nodes.s).toBe(doc.nodes.s)
      expect(mountedOn(after.doc, after.doc.nodes.s, registry)).not.toBeNull()
    }
    const loose = plan({ type: 'parametric', id: 's', kind: 'test.socket', props: {}, x: 1500, y: 400 })
    expect(edited(loose, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } }]).nodes.s).toBe(loose.nodes.s)
  })

  it('are said so in an extension written as data', () => {
    const json = {
      format: 'opencalque-extension',
      formatVersion: 1,
      id: 'test.data',
      name: 'Data',
      version: '1.0.0',
      objects: [{ kind: 'data.switch', label: 'Switch', params: [], mount: { on: 'wall', back: 60, out: 'up', height: 1100 }, draw: [{ ellipse: { cx: 0, cy: 0, rx: 60, ry: 60 } }] }],
    }
    const data = new Registry().use(declarativeExtension(json))
    expect(data.parametric.get('data.switch')?.mount).toEqual({ on: 'wall', back: 60, out: 'up', height: 1100 })
    expect(() => declarativeExtension({ ...json, objects: [{ ...json.objects[0], mount: { on: 'ceiling', height: 0 } }] })).toThrow()
  })
})

/** A drawing of the given walls and nodes on its page, as they are given. */
function drawing(...nodes: Record<string, unknown>[]): Document {
  return applyOps(createDocument('Plan'), nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
}
const wallAt = (id: string, a: [number, number], b: [number, number], thickness = 200, extra: Record<string, unknown> = {}) => ({ type: 'wall', id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, ...extra })
const snapped = (doc: Document, p: { x: number; y: number }, kind = 'test.socket', step = 100) => snapMountToWall(doc, 'page_1', registry, { kind, props: {} }, p, 500, step)
const rounded = (at: { x: number; y: number; rotation: number } | null) => at && { x: Math.round(at.x), y: Math.round(at.y), rotation: Math.round(at.rotation) }
const socket = (at: object, id = 's') => ({ type: 'parametric', id, kind: 'test.socket', props: {}, ...at })

describe('objects fixed on walls, on every kind of wall', () => {
  it('go on the faces of a wall drawn by one of its faces', () => {
    // Drawn by its left face, the whole thickness to its right (below): its faces at y = 0 and y = 200.
    const doc = drawing(wallAt('w', [0, 0], [6000, 0], 200, { justify: 'left' }))
    expect(rounded(snapped(doc, { x: 1000, y: 500 }))).toEqual({ x: 1000, y: 200, rotation: 0 })
    expect(rounded(snapped(doc, { x: 1000, y: -300 }))).toEqual({ x: 1000, y: 0, rotation: 180 })
    // Pointing inside it, between its line and its middle, is on the side of its upper face.
    expect(rounded(snapped(doc, { x: 1000, y: 50 }))).toEqual({ x: 1000, y: 0, rotation: 180 })
  })

  it('turn with a wall at any angle, and are found on it', () => {
    // A wall going down and to the right at 45°: its right face is down and to the left of its line.
    const doc = drawing(wallAt('w', [0, 0], [3000, 3000]))
    const at = snapped(doc, { x: 1300, y: 1700 }, 'test.socket', 0)!
    expect(Math.round(at.rotation)).toBe(45)
    const placed = applyOps(doc, [{ op: 'add_node', node: { parent: 'page_1', ...socket(at) } as never }])
    expect(mountedOn(placed, placed.nodes.s, registry)).toMatchObject({ face: 'right' })
    expect(mountedOn(placed, placed.nodes.s, registry)!.along).toBeCloseTo(Math.hypot(1500, 1500), 3)
  })

  it('stay within the wall, at its ends or past them', () => {
    const doc = drawing(wallAt('w', [0, 0], [6000, 0]))
    expect(rounded(snapped(doc, { x: 6300, y: 300 }))).toEqual({ x: 6000, y: 100, rotation: 0 })
    expect(rounded(snapped(doc, { x: -300, y: 300 }))).toEqual({ x: 0, y: 100, rotation: 0 })
  })

  it('go on the nearest wall, and exactly under the pointer with no grid', () => {
    const doc = drawing(wallAt('w', [0, 0], [6000, 0]), wallAt('v', [0, 1000], [6000, 1000]))
    expect(rounded(snapped(doc, { x: 2000, y: 300 }))).toEqual({ x: 2000, y: 100, rotation: 0 })
    expect(rounded(snapped(doc, { x: 2000, y: 700 }))).toEqual({ x: 2000, y: 900, rotation: 180 })
    expect(snapped(doc, { x: 2037, y: 300 }, 'test.socket', 0)?.x).toBeCloseTo(2037, 6)
  })

  it('go on a curved wall, turned to its curve, and are found on it', () => {
    const doc = drawing(wallAt('w', [0, 0], [4000, 0], 200, { bulge: 1000 }))
    // Its middle line bows 1 m off its chord, one way or the other: 1.3 m off is beside its outer face.
    const at = (snapped(doc, { x: 2000, y: -1300 }, 'test.socket', 0) ?? snapped(doc, { x: 2000, y: 1300 }, 'test.socket', 0))!
    expect(at).not.toBeNull()
    const placed = applyOps(doc, [{ op: 'add_node', node: { parent: 'page_1', ...socket(at) } as never }])
    expect(mountedOn(placed, placed.nodes.s, registry)?.wall.id).toBe('w')
  })

  it('are found on a face 1 mm off at most, whatever group they are in', () => {
    const near = drawing(wallAt('w', [0, 0], [6000, 0]), socket({ x: 1500, y: 100.9 }))
    expect(mountedOn(near, near.nodes.s, registry)).not.toBeNull()
    const far = drawing(wallAt('w', [0, 0], [6000, 0]), socket({ x: 1500, y: 101.5 }))
    expect(mountedOn(far, far.nodes.s, registry)).toBeNull()
    const grouped = drawing(wallAt('w', [0, 0], [6000, 0]), { type: 'group', id: 'g' }, { ...socket({ x: 1500, y: 100 }), parent: 'g' })
    expect(mountedOn(grouped, grouped.nodes.s, registry)?.wall.id).toBe('w')
    expect(wallMounted(grouped, grouped.nodes.w as never, registry).map((n) => n.id)).toEqual(['s'])
  })

  it('are on the face of a lining laid against a wall, not on the wall under it', () => {
    // A wall 200 thick along y = 0, and a lining 50 thick laid against its lower face, from y = 100 to 150.
    const lining = wallAt('lining', [0, 100], [6000, 100], 50, { justify: 'left' })
    const doc = drawing(wallAt('w', [0, 0], [6000, 0]), lining, socket(snapped(drawing(lining), { x: 2000, y: 400 })!))
    expect((doc.nodes.s as NodeOf<'parametric'>).y).toBe(150)
    expect(mountedOn(doc, doc.nodes.s, registry)?.wall.id).toBe('lining')
  })

  it('keep their back on the face mirrored, and stand at the floor when their height is 0', () => {
    const wallNode = drawing(wallAt('w', [0, 0], [6000, 0])).nodes.w as never
    const switchAt = mountAt({ kind: 'test.switch', props: {}, flipX: true }, { on: 'wall', back: 60, out: 'up', height: 1100 }, wallNode, 'right', 1000)
    expect(rounded(switchAt)).toEqual({ x: 1000, y: 160, rotation: 180 })
    const doc = drawing(wallAt('w', [0, 0], [6000, 0]), socket({ x: 1000, y: 100, z: 0 }))
    expect(heightAboveFloor(doc.nodes.s, registry)).toBe(0)
  })
})

describe('objects fixed on walls follow every edit of their wall', () => {
  const doc = drawing(wallAt('w', [0, 0], [6000, 0]), socket({ x: 1500, y: 100 }))

  it('stay where they are on a wall made longer at both ends, and keep their share of one also moved', () => {
    // Still on its face, it has not moved: the wall goes on past it either way.
    expect(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: -1000, y: 0 }, b: { x: 7000, y: 0 } } }]).nodes.s).toBe(doc.nodes.s)
    // Moved down 500 as well: 1500 of 6000 is a quarter, 2000 of 8000, so at x = 1000.
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: -1000, y: 500 }, b: { x: 7000, y: 500 } } }]))).toEqual({ x: 1000, y: 600, rotation: 0 })
  })

  it('stay on their face when the wall is drawn by its other face', () => {
    // Drawn by its middle, then by its upper face: its lower face moves from 100 to 200.
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { justify: 'left' } }]))).toEqual({ x: 1500, y: 200, rotation: 0 })
  })

  it('turn half round with a wall turned about its middle', () => {
    expect(where(edited(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 6000, y: 1000 }, b: { x: 0, y: 1000 } } }]))).toEqual({ x: 4500, y: 900, rotation: 180 })
  })

  it('are put back by operations given with the edit, so that undo and others see them', () => {
    const { ops } = applyEdit(doc, [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 500 }, b: { x: 6000, y: 500 } } }], registry)
    expect(ops).toContainEqual({ op: 'update_node', id: 's', patch: { x: 1500, y: 600, rotation: 0 } })
  })

  it('stay where they are when their wall is taken away, or made curved', () => {
    expect(edited(doc, [{ op: 'remove_node', id: 'w' }]).nodes.s).toBe(doc.nodes.s)
    expect(edited(doc, [{ op: 'update_node', id: 'w', patch: { bulge: 500 } }]).nodes.s).toBe(doc.nodes.s)
  })

  it('follow a wall moved together with them only once', () => {
    const both = edited(doc, [
      { op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } },
      { op: 'update_node', id: 's', patch: { y: 1100 } },
    ])
    expect(where(both)).toEqual({ x: 1500, y: 1100, rotation: 0 })
  })
})

describe('objects fixed on walls, said as data', () => {
  it('take a front drawing and angles, and refuse a front that names what is not there', () => {
    const json = {
      format: 'opencalque-extension',
      formatVersion: 1,
      id: 'test.front',
      name: 'Front',
      version: '1.0.0',
      objects: [
        {
          kind: 'front.plate',
          label: 'Plate',
          params: [
            { key: 'size', label: 'Size', type: 'number', default: 80, unit: 'length' },
            { key: 'turn', label: 'Turn', type: 'number', default: 0, unit: 'angle' },
          ],
          mount: { on: 'wall', height: 300 },
          draw: [{ path: [[-50, 0], [50, 0]] }],
          front: [{ path: [['-size / 2', '-size / 2'], ['size / 2', '-size / 2'], ['size / 2', 'size / 2'], ['-size / 2', 'size / 2']], closed: true }],
        },
      ],
    }
    const kind = new Registry().use(declarativeExtension(json)).parametric.get('front.plate')!
    expect(kind.params[1].unit).toBe('angle')
    expect(kind.front!({ size: 100, turn: 0 })).toEqual([{ kind: 'path', points: [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }], closed: true }])
    expect(() => declarativeExtension({ ...json, objects: [{ ...json.objects[0], front: [{ path: [['width', 0], [0, 0]] }] }] })).toThrow(/front.plate/)
  })
})

/*
 * Moving what stands against walls (`moveAgainstWall`), as kitchen units are moved: a wall along
 * y = 0, its face below it at y = 100, and units 600 wide and deep standing against it, turned 0
 * (their back, their own Y = 0, on that face). A pillar, a wall 400 thick across the face from
 * x = 800 to 1200, makes a corner on its left. Reaches as at a zoom of 0.25 px/mm: 150 to go against
 * the wall, 50 to go against what is beside it.
 */
describe('moving what stands against walls', () => {
  const arch = new Registry().use(architecture)
  const unit = (id: string, x: number, y: number, rotation = 0) => ({ type: 'parametric', id, kind: 'arch.baseunit', props: {}, x, y, rotation })
  const PILLAR = { type: 'wall', id: 'pillar', a: { x: 1000, y: 100 }, b: { x: 1000, y: 900 }, thickness: 400 }
  const kitchen = (...nodes: Record<string, unknown>[]) => applyOps(createDocument('Plan'), [PILLAR, WALL, ...nodes].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
  /** Where unit `id` goes, moved by `d` from where it is. */
  const moved = (doc: Document, id: string, d: { x: number; y: number }) => {
    const { moving, others } = alignables(buildScene(doc, 'page_1', arch), doc, arch, new Set([id]))
    const found = moveAgainstWall(doc, 'page_1', arch, doc.nodes[id] as NodeOf<'parametric'>, moving!, others, d, 150, 50, 0)
    return found && { ...found.patch, x: Math.round(found.patch.x * 10) / 10, y: Math.round(found.patch.y * 10) / 10, against: found.why && found.why.target + ' of ' + others.length }
  }

  it('goes against the wall when its box comes near, turned to it whichever way it faced', () => {
    // Turned the wrong way, its doors to the wall, its box from y = 300 to 900: 200 off the face, out of reach.
    const doc = kitchen(unit('u', 2600, 900, 180))
    expect(moved(doc, 'u', { x: 0, y: 0 })).toBeNull()
    // Its box's top 50 from the face: it turns round, its back on the face, where it was along the wall.
    expect(moved(doc, 'u', { x: 0, y: -150 })).toMatchObject({ x: 2000, y: 100, rotation: 0 })
  })

  it('goes where its box was moved, wherever it was taken: along the wall it follows the pointer exactly', () => {
    const doc = kitchen(unit('u', 2000, 100))
    for (let dx = 0; dx <= 300; dx += 10) expect(moved(doc, 'u', { x: dx, y: 37 })).toMatchObject({ x: 2000 + dx, y: 100, rotation: 0, against: null })
  })

  it('stays on the face on the side of its middle, however far it is pushed into the wall', () => {
    const doc = kitchen(unit('u', 2000, 100))
    expect(moved(doc, 'u', { x: 0, y: -250 })).toMatchObject({ x: 2000, y: 100, rotation: 0 })
    // Its middle past the wall's: the face on the other side, turned to stand out of it.
    expect(moved(doc, 'u', { x: 0, y: -700 })).toMatchObject({ x: 2600, y: -100, rotation: 180 })
  })

  it('goes against the unit beside it, and against a pillar standing across the wall', () => {
    const doc = kitchen(unit('u', 2000, 100), unit('next', 3000, 100))
    // Its right side 20 short of the next unit's left: against it.
    expect(moved(doc, 'u', { x: 380, y: 0 })).toMatchObject({ x: 2400, y: 100 })
    // Its left side 20 short of the pillar's face at x = 1200: against it, in the corner.
    expect(moved(doc, 'u', { x: -780, y: 0 })).toMatchObject({ x: 1200, y: 100, rotation: 0 })
    // 80 short of the pillar, out of reach: where it was moved to.
    expect(moved(doc, 'u', { x: -720, y: 0 })).toMatchObject({ x: 1280, y: 100 })
    // Pushed 150 into the pillar, it stops against it, as a wardrobe does against the wall at the end of a room.
    expect(moved(doc, 'u', { x: -950, y: 0 })).toMatchObject({ x: 1200, y: 100, rotation: 0 })
  })

  it('goes against what is beside it on a wall a hair off level, as traced walls are, and stays on its face', () => {
    // The wall 0.00003° off level: 5 µm over 9 m, as one of a traced plan was; the units turned to match.
    const slanted = { ...WALL, b: { x: 9000, y: -0.005 } }
    const turn = (Math.atan2(-0.005, 9000) * 180) / Math.PI
    const doc = applyOps(createDocument('Plan'), [PILLAR, slanted, unit('u', 2000, 100, turn), unit('next', 3000, 100, turn)].map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never })))
    expect(moved(doc, 'u', { x: 380, y: 0 })).toMatchObject({ x: 2400, y: 100 })
    expect(moved(doc, 'u', { x: -780, y: 0 })).toMatchObject({ x: 1200, y: 100 })
  })

  it('in a corner, against both walls, keeps facing the wall it stood against', () => {
    // Pushed into the pillar as well as against the wall: the pillar is as near, and comes first in the drawing.
    const doc = kitchen(unit('u', 2000, 100))
    expect(moved(doc, 'u', { x: -820, y: 0 })).toMatchObject({ y: 100, rotation: 0 })
  })
})
