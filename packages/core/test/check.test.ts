import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyEdit, applyOps, checkDrawing, createDocument, problemsMadeBy, wallContains, type Document, type NodeOf, type Op } from '../src'
import { houseDoc, registry, wall } from './support/house'
import { planDocument, randomPlan } from './support/plans'

/** The four walls of a room 4 m by 3 m, meeting at their corners. */
const box = (): Record<string, unknown>[] => [wall('n', [0, 0], [4000, 0], 200), wall('e', [4000, 0], [4000, 3000], 200), wall('s', [4000, 3000], [0, 3000], 200), wall('w', [0, 3000], [0, 0], 200)]
const room = (id: string, x = 2000, y = 1500) => ({ type: 'room', id, name: id, x, y })
const door = (id: string, x: number, width = 900) => ({ type: 'parametric', id, kind: 'test.door', props: { width }, x, y: 0 })

const kinds = (doc: Document) => checkDrawing(doc, registry).map((problem) => problem.kind)

describe('what a drawing can tell is wrong with it', () => {
  it('finds nothing wrong with a room that closes, its door in its wall', () => {
    expect(checkDrawing(houseDoc([...box(), room('r'), door('d', 1000)]), registry)).toEqual([])
  })

  it('says a room has no floor, and where the wall stops short', () => {
    const [north, ...rest] = box()
    const problems = checkDrawing(houseDoc([{ ...north, b: { x: 3700, y: 0 } }, ...rest, room('r')]), registry)
    expect(problems.map((p) => p.kind).sort()).toEqual(['room-not-enclosed', 'wall-gap'])
    const gap = problems.find((p) => p.kind === 'wall-gap')!
    // The wall's end is 300 mm from the line of the east wall, whose face is 100 mm from that line.
    expect(gap.message).toContain('stops 200 mm short')
    expect(gap.nodes).toEqual(['e', 'n'])
    expect(gap.at).toEqual({ x: 3700, y: 0 })
  })

  it('takes a wall a hair short for one that reaches, as rooms do', () => {
    const [north, ...rest] = box()
    expect(checkDrawing(houseDoc([{ ...north, b: { x: 3880, y: 0 } }, ...rest, room('r')]), registry)).toEqual([])
  })

  it('finds the gap whichever wall stops short, at a T and at a corner where both do', () => {
    const [north, east, south, west] = box()
    const tee = [north, east, south, west, wall('mid', [2000, 0], [2000, 2700], 200), room('left', 1000), room('right', 3000)]
    // Stopping 200 mm short of the south wall, the wall between them leaves the two rooms one space.
    const problems = checkDrawing(houseDoc(tee), registry)
    expect(problems.map((p) => p.kind).sort()).toEqual(['rooms-in-one-space', 'wall-gap'])
    expect(problems.find((p) => p.kind === 'wall-gap')!.nodes).toEqual(['mid', 's'])
    const corner = checkDrawing(houseDoc([{ ...north, b: { x: 3800, y: 0 } }, { ...east, a: { x: 4000, y: 200 } }, south, west, room('r')]), registry)
    expect(corner.map((p) => p.kind).sort()).toEqual(['room-not-enclosed', 'wall-gap'])
    expect(corner.find((p) => p.kind === 'wall-gap')!.nodes).toEqual(['e', 'n'])
  })

  it('says nothing of a wall that stops well short, or of an end set loose, though the room stays open', () => {
    const [north, ...rest] = box()
    const far = houseDoc([{ ...north, b: { x: 3000, y: 0 } }, ...rest, room('r')])
    expect(kinds(far)).toEqual(['room-not-enclosed'])
    const loose = houseDoc([{ ...north, b: { x: 3700, y: 0 }, joins: { b: 'free' } }, ...rest, room('r')])
    expect(kinds(loose)).toEqual(['room-not-enclosed'])
  })

  it('leaves a wall standing free alone where every room closes', () => {
    expect(kinds(houseDoc([...box(), room('r'), wall('stub', [6000, 0], [6000, 3000], 200), wall('near', [6000, 3250], [9000, 3250], 200)]))).toEqual([])
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [2000, 250], [2000, 3000], 200)]))).toEqual([])
  })

  it('takes an end against the face of a wall for one that reaches it', () => {
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [2000, 100], [2000, 3000], 200)]))).toEqual([])
  })

  it('leaves the leaves of a cavity wall alone: running alongside is not stopping short', () => {
    expect(kinds(houseDoc([wall('outer', [0, 0], [4000, 0], 100), wall('inner', [0, 140], [4000, 140], 100)]))).toEqual([])
  })

  it('says a wall was drawn twice, once for each room it divides, whichever way round', () => {
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [4000, 0], [0, 0], 200)]))).toEqual(['walls-overlap'])
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [3000, 0], [6000, 0], 200)]))).toEqual(['walls-overlap'])
  })

  it('leaves walls laid against each other, walls of two materials, and walls end to end alone', () => {
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [0, 150], [4000, 150], 100)]))).toEqual([])
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200, 'brick'), wall('b', [0, 0], [4000, 0], 100, 'plaster')]))).toEqual([])
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [4000, 0], [8000, 0], 200)]))).toEqual([])
  })

  it('says two rooms are in one space', () => {
    expect(kinds(houseDoc([...box(), room('r1', 1000), room('r2', 3000)]))).toEqual(['rooms-in-one-space'])
  })

  it('says a door is in no wall, or runs past its end, or over another', () => {
    expect(kinds(houseDoc([...box(), { ...door('d', 1000), y: 800 }]))).toEqual(['opening-not-in-wall'])
    expect(kinds(houseDoc([wall('a', [0, 0], [4000, 0], 200), door('d', 3500)]))).toEqual(['opening-past-wall-end'])
    expect(kinds(houseDoc([...box(), door('d1', 1000), door('d2', 1500)]))).toEqual(['openings-overlap'])
  })

  it('leaves a door drawn on a sheet with no walls alone', () => {
    expect(kinds(houseDoc([door('d', 0)]))).toEqual([])
  })

  it('checks only what it is asked to', () => {
    const doc = applyOps(houseDoc([wall('a', [0, 0], [4000, 0], 200), wall('b', [0, 0], [4000, 0], 200)]), [{ op: 'add_node', node: { type: 'page', id: 'other', parent: null } }])
    expect(checkDrawing(doc, registry, ['other'])).toEqual([])
    expect(checkDrawing(doc, registry, ['gone'])).toEqual([])
    expect(checkDrawing(doc, registry, ['page_1'])).toHaveLength(1)
  })

  it('tells an edit only of what it made', () => {
    // A room the person left open, on a page the edit goes on working on.
    const [north, ...rest] = box()
    const before = houseDoc([{ ...north, b: { x: 3700, y: 0 } }, ...rest, room('r')])
    expect(checkDrawing(before, registry)).toHaveLength(2)
    const added = applyOps(before, [{ op: 'add_node', node: { ...wall('c', [6000, 0], [9000, 0], 200), parent: 'page_1' } as never }])
    expect(problemsMadeBy(before, added, registry)).toEqual([])
    const broken = applyOps(before, [{ op: 'add_node', node: { ...wall('d', [6000, 0], [9000, 0], 200), parent: 'page_1' } as never }, { op: 'add_node', node: { ...wall('d2', [6000, 0], [9000, 0], 200), parent: 'page_1' } as never }])
    expect(problemsMadeBy(before, broken, registry).map((p) => p.kind)).toEqual(['walls-overlap'])
    expect(problemsMadeBy(before, before, registry)).toEqual([])
  })

  it('tells an edit that took a wall away what it opened', () => {
    const before = houseDoc([...box(), room('r')])
    const after = applyOps(before, [{ op: 'remove_node', id: 'e' }])
    expect(problemsMadeBy(before, after, registry).map((p) => p.kind)).toEqual(['room-not-enclosed'])
  })
})

/** What is checked here is meant to be nearly always a mistake: on plans known to be right, with a room in every space, it must stay silent. */
describe('nothing is wrong with plans that are right', () => {
  it('finds nothing wrong with the walls of plans drawn at random, a room in every cell', () => {
    const found: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const { walls, cells } = randomPlan(seed)
      const plain = planDocument(walls)
      const open = cells.filter((p) => !Object.values(plain.nodes).some((n) => n.type === 'wall' && wallContains(n, p)))
      const doc = applyOps(plain, open.map((p, i): Op => ({ op: 'add_node', node: { type: 'room', id: `r${i}`, parent: 'page_1', ...p } as never })))
      // Cells a wall was left out between are one space, which is what that problem says, rightly.
      for (const problem of checkDrawing(doc, registry)) if (problem.kind !== 'rooms-in-one-space') found.push(`plan ${seed}: ${problem.message}`)
    }
    expect(found.slice(0, 5)).toEqual([])
  })

  it('finds nothing wrong with a real plan', () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'rooms', 'real-plan-1.json'), 'utf8')) as {
      walls: { a: [number, number]; b: [number, number]; thickness: number; justify?: 'left' | 'right'; bulge?: number }[]
      dividers: { a: [number, number]; b: [number, number] }[]
      rooms: { at: [number, number] }[]
    }
    const point = ([x, y]: [number, number]) => ({ x, y })
    const doc = applyOps(createDocument(), [
      ...fixture.walls.map((w, i): Op => ({ op: 'add_node', node: { ...w, type: 'wall', id: `w${i}`, parent: 'page_1', a: point(w.a), b: point(w.b) } as never })),
      ...fixture.dividers.map((d, i): Op => ({ op: 'add_node', node: { type: 'divider', id: `d${i}`, parent: 'page_1', a: point(d.a), b: point(d.b) } as never })),
      ...fixture.rooms.map((r, i): Op => ({ op: 'add_node', node: { type: 'room', id: `r${i}`, parent: 'page_1', ...point(r.at) } as never })),
    ])
    expect(checkDrawing(doc, registry).map((p) => p.message)).toEqual([])
  })
})

describe('one edit makes one drawing, wherever it is applied', () => {
  const plan = houseDoc([wall('w', [0, 0], [6000, 0], 200), door('door', 1000)])
  const move: Op[] = [{ op: 'update_node', id: 'w', patch: { a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } } }]

  it('takes the doors of a wall along with it, which the operations alone do not', () => {
    expect((applyOps(plan, move).nodes.door as NodeOf<'parametric'>).y).toBe(0)
    const edit = applyEdit(plan, move, registry)
    expect((edit.doc.nodes.door as NodeOf<'parametric'>).y).toBe(1000)
  })

  it('returns the operations that make it', () => {
    const edit = applyEdit(plan, move, registry)
    expect(edit.ops.length).toBe(2)
    expect(applyOps(plan, edit.ops).nodes).toEqual(edit.doc.nodes)
  })

  it('applies nothing and throws on what is not valid', () => {
    expect(() => applyEdit(plan, [{ op: 'remove_node', id: 'nothing' }], registry)).toThrow()
  })
})
