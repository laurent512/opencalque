import { describe, expect, it } from 'vitest'
import { applyOps, autoJoinCuts, connectedWalls, splitOps, splitPlace, boundsOf, buildScene, cornerJoin, endLineOps, endLineShown, cornerJoinOps, createDocument, extendWallOps, trimWallOps, moveCornerOps, Registry, roomAt, splitWallOps, wallEndsAt, wallEndState, looseEndOps, wallEndFollowOps, wallFollowOps, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })
// An L: one wall along the top, one down the right, meeting at (4000, 0).
const ell = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('side', 4000, 0, 4000, 3000), wall('apart', 9000, 0, 9000, 3000)])
const corner = { x: 4000, y: 0 }
const outline = (doc: Document, id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims[0] as any
const reach = (doc: Document, id: string) => boundsOf([outline(doc, id)])!
const joined = (join: 'auto' | 'miter' | 'round' | 'bevel' | 'butt', through = 0) => applyOps(ell, cornerJoinOps(wallEndsAt(ell, 'page_1', corner), join, through))

describe('wall corners', () => {
  it('are the wall ends that share a point', () => {
    expect(wallEndsAt(ell, 'page_1', corner).map((e) => `${e.wall.id}.${e.end}`)).toEqual(['top.b', 'side.a'])
    expect(wallEndsAt(ell, 'page_1', { x: 0, y: 0 }).map((e) => e.wall.id)).toEqual(['top'])
    expect(wallEndsAt(ell, 'page_1', { x: 2000, y: 0 })).toEqual([])
  })

  it('move as one: every wall that ends there follows', () => {
    const moved = applyOps(ell, moveCornerOps(ell, 'page_1', corner, { x: 5000, y: -500 }))
    expect((moved.nodes.top as any).b).toEqual({ x: 5000, y: -500 })
    expect((moved.nodes.side as any).a).toEqual({ x: 5000, y: -500 })
    expect(moved.nodes.apart).toBe(ell.nodes.apart)
  })

  it('are cut off rather than drawn as a spike when two walls meet at a sharp angle', () => {
    // How far the outer point of the corner reaches from the joint (it lies behind the joint, on
    // the side away from both walls), for two walls opening by so many degrees.
    const tip = (degrees: number) => {
      const turn = (degrees * Math.PI) / 180
      const doc = applyOps(createDocument(), [wall('a', 0, 0, 3000, 0), wall('b', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn))])
      return Math.max(...(outline(doc, 'a').points as { x: number; y: number }[]).filter((p) => p.x < 0).map((p) => Math.hypot(p.x, p.y)))
    }
    // At 30 degrees a mitre would stick out 386 mm from the joint of two 200 mm walls: it is chamfered instead.
    expect(tip(30)).toBeLessThan(101)
    expect(tip(50)).toBeLessThan(101)
    // From 60 degrees up the point is short enough to keep: 141 mm at a right angle.
    expect(Math.round(tip(90))).toBe(141)
    expect(Math.round(tip(70))).toBe(174)
  })

  it('extends a wall to the next wall ahead, and trims what sticks out past one', () => {
    // A long wall along the top, and a short one below it pointing up at it without reaching.
    const short = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('stem', 2000, 3000, 2000, 1000)])
    const stem = (doc: Document) => doc.nodes.stem as any
    const extended = applyOps(short, extendWallOps(short, [stem(short)]))
    // Its far end runs up to the middle line of the wall above; the end with nothing ahead stays.
    expect(stem(extended)).toMatchObject({ a: { x: 2000, y: 3000 }, b: { x: 2000, y: 0 } })
    expect(extendWallOps(extended, [stem(extended)])).toEqual([])
    // The same wall drawn too long, through the one above: what sticks out is cut back to it.
    const long = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('stem', 2000, 3000, 2000, -600)])
    const trimmed = applyOps(long, trimWallOps(long, [stem(long)]))
    expect(stem(trimmed)).toMatchObject({ a: { x: 2000, y: 3000 }, b: { x: 2000, y: 0 } })
    expect(trimWallOps(trimmed, [stem(trimmed)])).toEqual([])
    // An end that another wall already ends at is a corner, not a free end: it is left alone.
    const corner = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('side', 4000, 0, 4000, 3000), wall('far', 0, 5000, 8000, 5000)])
    expect((applyOps(corner, extendWallOps(corner, [corner.nodes.side as any])).nodes.side as any).a).toEqual({ x: 4000, y: 0 })
    expect((applyOps(corner, extendWallOps(corner, [corner.nodes.side as any])).nodes.side as any).b).toEqual({ x: 4000, y: 5000 })
  })

  it('are mitred to a sharp point unless told otherwise', () => {
    expect(cornerJoin(wallEndsAt(ell, 'page_1', corner))).toBe('auto')
    // The outer corner of the L is the point (4100, -100).
    expect(reach(ell, 'top')).toMatchObject({ maxX: 4100, minY: -100 })
    expect(outline(ell, 'top').points).toContainEqual({ x: 4100, y: -100 })
  })

  it('can be rounded: the outer corner becomes an arc around the joint', () => {
    const doc = joined('round')
    expect(cornerJoin(wallEndsAt(doc, 'page_1', corner))).toBe('round')
    const points: { x: number; y: number }[] = [...outline(doc, 'top').points, ...outline(doc, 'side').points]
    expect(points).not.toContainEqual({ x: 4100, y: -100 })
    // Every point of the outer side is 100 from the joint, where the sharp corner was 141 away.
    const outer = points.filter((p) => p.x > 4000 && p.y < 0)
    expect(outer.length).toBeGreaterThan(3)
    for (const p of outer) expect(Math.hypot(p.x - 4000, p.y)).toBeCloseTo(100, 3)
  })

  it('can be cut off straight', () => {
    const doc = joined('bevel')
    const points = outline(doc, 'top').points
    expect(points).not.toContainEqual({ x: 4100, y: -100 })
    // The cut runs between the two square corners, through their middle.
    expect(points).toContainEqual({ x: 4050, y: -50 })
  })

  it('are rounded and cut off alike whichever line the walls are drawn by', () => {
    // The L drawn by a face of its walls: the outer one ('left' here), whose joint is then the
    // outer corner itself, or the inner one, the corner then reaching out a whole thickness.
    for (const [justify, outer] of [
      ['left', { x: 4000, y: 0 }],
      ['right', { x: 4200, y: -200 }],
    ] as const) {
      const drawn = applyOps(ell, [
        { op: 'update_node', id: 'top', patch: { justify } },
        { op: 'update_node', id: 'side', patch: { justify } },
      ])
      const at = (join: 'miter' | 'round' | 'bevel') => {
        const doc = applyOps(drawn, cornerJoinOps(wallEndsAt(drawn, 'page_1', corner), join))
        return [...outline(doc, 'top').points, ...outline(doc, 'side').points] as { x: number; y: number }[]
      }
      expect(at('miter')).toContainEqual(outer)
      // The middles cross half a thickness in from the outer corner, and the corner is worked out
      // about there, as for walls drawn by their middle: cut 50 in along each way, rounded 100 round.
      const middles = { x: outer.x - 100, y: outer.y + 100 }
      const cut = at('bevel')
      expect(cut).not.toContainEqual(outer)
      expect(cut).toContainEqual({ x: middles.x + 50, y: middles.y - 50 })
      const round = at('round').filter((p) => p.x > middles.x && p.y < middles.y)
      expect(round.length).toBeGreaterThan(3)
      for (const p of round) expect(Math.hypot(p.x - middles.x, p.y - middles.y)).toBeCloseTo(100, 3)
    }
  })

  it('are rounded by a circle touching both faces, as wide as the thinner wall, when the walls differ in thickness', () => {
    // The top wall 300 thick, from -150 to 150; the side one 200, from 3900 to 4100. The outer corner is (4100, -150).
    const thick = applyOps(ell, [{ op: 'update_node', id: 'top', patch: { thickness: 300 } }])
    const doc = applyOps(thick, cornerJoinOps(wallEndsAt(thick, 'page_1', corner), 'round'))
    const points: { x: number; y: number }[] = [...outline(doc, 'top').points, ...outline(doc, 'side').points]
    // A circle of 100 about (4000, -50), touching the top face at (4000, -150) and the side face at (4100, -50).
    expect(points).toContainEqual({ x: 4000, y: -150 })
    expect(points).toContainEqual({ x: 4100, y: -50 })
    const arc = points.filter((p) => p.x > 4000 && p.y < -50)
    expect(arc.length).toBeGreaterThan(3)
    for (const p of arc) expect(Math.hypot(p.x - 4000, p.y + 50)).toBeCloseTo(100, 3)
    // Nothing reaches past either face.
    expect(Math.max(...points.map((p) => p.x))).toBeLessThanOrEqual(4100)
    expect(Math.min(...points.map((p) => p.y))).toBeGreaterThanOrEqual(-150)
  })

  it('can let one wall run through while the other stops against it', () => {
    // The top wall passes: it runs on to the far face of the side wall, which stops at its near face.
    const topPasses = joined('butt', 0)
    expect((topPasses.nodes.top as any).joins).toEqual({ b: 'through' })
    expect((topPasses.nodes.side as any).joins).toEqual({ a: 'butt' })
    expect(reach(topPasses, 'top')).toMatchObject({ maxX: 4100, minY: -100, maxY: 100 })
    expect(reach(topPasses, 'side')).toMatchObject({ minY: 100, minX: 3900, maxX: 4100 })
    // The wall that stops shows the line of its end, which the merged painting of walls would otherwise hide.
    const drawn = buildScene(topPasses, 'page_1', registry)
    expect(drawn.find((item) => item.id === 'side')!.prims.map((p: any) => p.closed ?? false)).toEqual([true, false])
    expect(drawn.find((item) => item.id === 'top')!.prims).toHaveLength(1)
    // Swapped, it is the side wall that passes.
    const sidePasses = joined('butt', 1)
    expect(reach(sidePasses, 'side')).toMatchObject({ minY: -100 })
    expect(reach(sidePasses, 'top')).toMatchObject({ maxX: 3900 })
    expect(cornerJoin(wallEndsAt(sidePasses, 'page_1', corner))).toBe('butt')
  })

  it('go back to a mitre, leaving nothing behind on the walls', () => {
    const round = joined('round')
    const back = applyOps(round, cornerJoinOps(wallEndsAt(round, 'page_1', corner), 'auto'))
    expect((back.nodes.top as any).joins).toBeUndefined()
    expect(outline(back, 'top').points).toEqual(outline(ell, 'top').points)
  })

  it('can be added in the middle of a wall, which becomes two', () => {
    const split = splitWallOps(ell.nodes.top, { x: 1500, y: 80 }, 'second')!
    expect(split.at).toEqual({ x: 1500, y: 0 })
    const doc = applyOps(ell, split.ops)
    expect(doc.nodes.top).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 1500, y: 0 } })
    expect(doc.nodes.second).toMatchObject({ a: { x: 1500, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 })
    expect(wallEndsAt(doc, 'page_1', split.at)).toHaveLength(2)
    // The two are joined like any walls, with the line between them drawn: that is all a cut is.
    expect(cornerJoin(wallEndsAt(doc, 'page_1', split.at))).toBe('auto')
    expect(endLineShown(doc, doc.nodes.top as any, 'b')).toBe(true)
    // Hiding that line, from either wall, makes them read as one wall again.
    const hidden = applyOps(doc, endLineOps(doc, doc.nodes.second as any, 'a', false))
    expect(endLineShown(hidden, hidden.nodes.top as any, 'b')).toBe(false)
    expect(['top', 'second'].flatMap((id) => buildScene(hidden, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && !p.closed))).toHaveLength(0)
    const seams = (id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && !p.closed)
    expect(seams('top').length + seams('second').length).toBeGreaterThan(0)
    expect(seams('side')).toHaveLength(0)
    // Not at an end, where there is a corner already.
    expect(splitWallOps(ell.nodes.top, { x: 0, y: 0 }, 'x')).toBeNull()
  })

  it('keeps the two halves of a split wall meeting at the cut, even once the cut is moved a little', () => {
    const straight = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0)])
    const split = splitWallOps(straight.nodes.w, { x: 2000, y: 0 }, 'second')!
    // The corner dragged 150 mm off the line: the two walls now bend by a few degrees.
    const cut = applyOps(straight, split.ops)
    const doc = applyOps(cut, moveCornerOps(cut, 'page_1', split.at, { x: 2000, y: 150 }))
    const at = { x: 2000, y: 150 }
    // How far the outline of a wall goes past the corner, measured along the wall away from its own body.
    const past = (id: string, body: { x: number; y: number }) => {
      const d = { x: at.x - body.x, y: at.y - body.y }
      const length = Math.hypot(d.x, d.y)
      return Math.max(...(outline(doc, id).points as { x: number; y: number }[]).map((p) => ((p.x - at.x) * d.x + (p.y - at.y) * d.y) / length))
    }
    // Neither runs on past the corner by more than the sliver a slight bend makes (they are 200 thick).
    expect(past('w', { x: 0, y: 0 })).toBeLessThan(20)
    expect(past('second', { x: 4000, y: 0 })).toBeLessThan(20)
    // And the line between them is still drawn, through the corner.
    const seams = ['w', 'second'].flatMap((id) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && !p.closed)) as any[]
    expect(seams).toHaveLength(1)
    const [from, to] = seams[0].points
    expect(Math.abs((from.x + to.x) / 2 - at.x)).toBeLessThan(1)
    expect(Math.abs((from.y + to.y) / 2 - at.y)).toBeLessThan(1)
  })

  it('lays a stopping wall flat against the passing one at any angle, with no gap and nothing sticking out', () => {
    // Two walls 200 thick from the same corner, the second turned away from the first by so many degrees.
    for (const degrees of [35, 60, 90, 120, 130]) {
      const turn = (degrees * Math.PI) / 180
      const doc = applyOps(createDocument(), [
        wall('passing', 0, 0, 3000, 0, { joins: { a: 'through' } }),
        wall('stopping', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn), { joins: { a: 'butt' } }),
      ])
      const points = (id: string) => outline(doc, id).points as { x: number; y: number }[]
      // The stopping wall goes off to the +y side: its end lies on the passing wall's face at y = 100, all of it.
      const end = points('stopping').filter((p) => Math.hypot(p.x, p.y) < 1000)
      expect(end.length, `${degrees}°`).toBe(2)
      for (const p of end) expect(p.y, `${degrees}°`).toBeCloseTo(100, 6)
      // The passing wall ends square, and reaches at least as far back as the stopping wall's end does.
      const back = Math.min(...points('passing').map((p) => p.x))
      expect(back, `${degrees}°`).toBeLessThanOrEqual(Math.min(...end.map((p) => p.x)) + 1e-6)
      expect(points('passing').filter((p) => Math.abs(p.x - back) < 1e-6), `${degrees}°`).toHaveLength(2)
      // And no further than it needs to: never more than its own thickness and a quarter past the corner.
      expect(back, `${degrees}°`).toBeGreaterThanOrEqual(-250)
    }
  })

  it('joins walls that nearly carry on from one another on the line between them, at every small bend', () => {
    // A wall cut in two, its far half then swung by a few degrees to forty: never a gap, never an overrun.
    for (const bend of [0.5, 3, 10, 20, 30, 40]) {
      const turn = ((180 - bend) * Math.PI) / 180
      const doc = applyOps(createDocument(), [
        wall('passing', 0, 0, 3000, 0, { joins: { a: 'through' } }),
        wall('stopping', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn), { joins: { a: 'butt' } }),
      ])
      const points = (id: string) => outline(doc, id).points as { x: number; y: number }[]
      // Both outlines pass through the corner itself, and neither goes past it by more than a sliver.
      for (const id of ['passing', 'stopping']) expect(points(id).some((p) => Math.hypot(p.x, p.y) < 1e-6), `${bend}° ${id}`).toBe(true)
      expect(Math.min(...points('passing').map((p) => p.x)), `${bend}°`).toBeGreaterThan(-45)
      // One line is drawn between them, through the corner.
      const seams = ['passing', 'stopping'].flatMap((id) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && !p.closed)) as any[]
      expect(seams, `${bend}°`).toHaveLength(1)
      const [from, to] = seams[0].points
      expect(Math.hypot((from.x + to.x) / 2, (from.y + to.y) / 2), `${bend}°`).toBeLessThan(1)
    }
  })

  it('draws the line between two joined walls when one of them asks for it, at every angle', () => {
    for (const degrees of [5, 20, 45, 60, 90, 135, 179]) {
      const turn = (degrees * Math.PI) / 180
      const doc = applyOps(createDocument(), [wall('one', 0, 0, 3000, 0, { edges: { a: { show: true } } }), wall('two', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn))])
      // The shape of the corner is not touched: each wall has the outline it has without the line.
      const plain = applyOps(createDocument(), [wall('one', 0, 0, 3000, 0), wall('two', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn))])
      for (const id of ['one', 'two']) expect(outline(doc, id).points, `${degrees}° ${id}`).toEqual(outline(plain, id).points)
      // And one line, drawn once, through the corner.
      const seams = ['one', 'two'].flatMap((id) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims.filter((p) => p.kind === 'path' && !p.closed)) as any[]
      expect(seams, `${degrees}°`).toHaveLength(1)
      const [from, to] = seams[0].points
      const off = Math.abs(from.x * to.y - from.y * to.x) / Math.hypot(to.x - from.x, to.y - from.y)
      expect(off, `${degrees}°`).toBeLessThan(1e-6)
    }
  })

  it('hides the faces and ends of a wall it is told to, and still fills it whole', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 3000, 0, { edges: { left: { show: false }, b: { show: false } } })])
    const prims = buildScene(doc, 'page_1', registry).find((item) => item.id === 'w')!.prims as any[]
    // The fill is the whole wall, with no outline of its own.
    const fill = prims.find((p) => p.closed)
    expect(fill).toMatchObject({ stroke: 'none' })
    expect(boundsOf([fill])).toEqual({ minX: 0, minY: -100, maxX: 3000, maxY: 100 })
    // The lines drawn: the right face (y = 100, the right of a wall going towards +x on screen) and the start, as one run.
    const runs = prims.filter((p) => !p.closed && p.union).map((p) => p.points.map((q: any) => [q.x + 0, q.y + 0]))
    // Each edge is a line of its own: the start, and the right face. Whichever way round each is drawn.
    const key = (run: number[][]) => JSON.stringify([...run].sort((p, q) => p[0] - q[0] || p[1] - q[1]))
    expect(runs.map(key).sort()).toEqual([key([[0, -100], [0, 100]]), key([[0, 100], [3000, 100]])].sort())
    // A free end that is hidden says so; a joint left alone shows no line.
    expect(endLineShown(doc, doc.nodes.w as any, 'b')).toBe(false)
    expect(endLineShown(doc, doc.nodes.w as any, 'a')).toBe(true)
    expect(endLineShown(ell, ell.nodes.top as any, 'b')).toBe(false)
  })

  it('does what suits the angle when left to itself, and what it is told when told', () => {
    // Two walls 200 thick opening by 30 degrees: too sharp for a point, left to itself.
    const turn = (30 * Math.PI) / 180
    const sharp = applyOps(createDocument(), [wall('a', 0, 0, 3000, 0), wall('b', 0, 0, 3000 * Math.cos(turn), 3000 * Math.sin(turn))])
    const ends = (doc: Document) => wallEndsAt(doc, 'page_1', { x: 0, y: 0 })
    const tip = (doc: Document) => Math.max(...(outline(doc, 'a').points as { x: number; y: number }[]).filter((p) => p.x < 0).map((p) => Math.hypot(p.x, p.y)))
    expect(cornerJoin(ends(sharp))).toBe('auto')
    expect(autoJoinCuts(ends(sharp))).toBe(true)
    expect(tip(sharp)).toBeLessThan(101)
    // Told to keep its point, it keeps it, however long: 100 / sin(15°) = 386 mm from the corner.
    const pointed = applyOps(sharp, cornerJoinOps(ends(sharp), 'miter'))
    expect((pointed.nodes.a as any).joins).toEqual({ a: 'miter' })
    expect(cornerJoin(ends(pointed))).toBe('miter')
    expect(Math.round(tip(pointed))).toBe(386)
    // Told to be cut off, a right angle is cut off; left to itself it has its point and is not cut.
    expect(autoJoinCuts(wallEndsAt(ell, 'page_1', corner))).toBe(false)
    expect(reach(joined('bevel'), 'top').maxX).toBeLessThan(4100)
    // Back to automatic is having nothing asked.
    const back = applyOps(pointed, cornerJoinOps(ends(pointed), 'auto'))
    expect((back.nodes.a as any).joins).toBeUndefined()
    expect(tip(back)).toBeLessThan(101)
  })

  it('joins a curved wall where its curved face really meets the other wall, not along its tangent', () => {
    // A half circle from (0,0) to (4000,0), bulging up, and a straight wall leaving its end steeply.
    for (const [bx, by] of [[3200, -3000], [4600, -3500], [2000, -1500]]) {
      const doc = applyOps(createDocument(), [wall('arc', 0, 0, 4000, 0, { bulge: -2000 }), wall('straight', 4000, 0, bx, by)])
      // Every point of the arc's outline is close to one of its faces (radius 2000 ± 100) or to the joint.
      const centre = { x: 2000, y: 0 }
      const off = (outline(doc, 'arc').points as { x: number; y: number }[]).map((p) => {
        const r = Math.hypot(p.x - centre.x, p.y - centre.y)
        return Math.min(Math.abs(r - 1900), Math.abs(r - 2100), Math.hypot(p.x - 4000, p.y))
      })
      expect(Math.max(...off), `towards ${bx},${by}`).toBeLessThan(200)
    }
  })

  it('joins two walls, curved either way or straight, at any angle without a stray point', () => {
    // Every point of each outline lies on one of its own faces, or near the joint or its free end.
    const offFace = (w: any) => {
      const chord = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
      return (q: { x: number; y: number }) => {
        if (!w.bulge) return Math.abs(Math.abs(((q.x - w.a.x) * (w.b.y - w.a.y) - (q.y - w.a.y) * (w.b.x - w.a.x)) / chord) - 100)
        const r = (chord * chord) / (8 * Math.abs(w.bulge)) + Math.abs(w.bulge) / 2
        const [nx, ny] = [-(w.b.y - w.a.y) / chord, (w.b.x - w.a.x) / chord]
        const shift = w.bulge - Math.sign(w.bulge) * r
        const c = { x: (w.a.x + w.b.x) / 2 + nx * shift, y: (w.a.y + w.b.y) / 2 + ny * shift }
        const d = Math.hypot(q.x - c.x, q.y - c.y)
        return Math.min(Math.abs(d - r - 100), Math.abs(d - r + 100))
      }
    }
    for (const b1 of [0, 800, -800, 1400]) for (const b2 of [0, 800, -800, -1400]) for (let degrees = 20; degrees <= 340; degrees += 20) {
      if (!b1 && !b2) continue
      const turn = (degrees * Math.PI) / 180
      const one = { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, ...(b1 ? { bulge: b1 } : {}) }
      const two = { a: { x: 0, y: 0 }, b: { x: Math.round(3000 * Math.cos(turn)), y: Math.round(3000 * Math.sin(turn)) }, ...(b2 ? { bulge: b2 } : {}) }
      const doc = applyOps(createDocument(), [wall('one', 0, 0, 0, 0, one), wall('two', 0, 0, 0, 0, two)])
      for (const [id, w] of [['one', one], ['two', two]] as const) {
        const stray = (outline(doc, id).points as { x: number; y: number }[]).filter((q) => offFace(w)(q) > 5 && Math.hypot(q.x, q.y) > 450 && Math.hypot(q.x - w.b.x, q.y - w.b.y) > 150)
        expect(stray, `${b1} ${b2} ${degrees}° ${id}`).toEqual([])
      }
    }
  })

  it('leaves no sliver between two walls at their joint, even when they leave it almost the same way and curve apart', () => {
    type P = { x: number; y: number }
    const inside = (q: P, poly: P[]) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [a, b] = [poly[i], poly[j]]
        if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c
      }
      return c
    }
    const onEdge = (q: P, poly: P[]) =>
      poly.some((a, k) => {
        const b = poly[(k + 1) % poly.length]
        const d = { x: b.x - a.x, y: b.y - a.y }
        const l = d.x * d.x + d.y * d.y
        const t = l ? Math.max(0, Math.min(1, ((q.x - a.x) * d.x + (q.y - a.y) * d.y) / l)) : 0
        return Math.hypot(q.x - a.x - d.x * t, q.y - a.y - d.y * t) < 0.3
      })
    // On circles about the joint, no narrow wedge is left uncovered between the two walls: that is the double line.
    const slivers = (doc: Document, ids: string[], p: P) => {
      const polys = ids.map((id) => outline(doc, id).points as P[])
      const found: number[] = []
      for (const r of [20, 50, 90]) {
        const n = 360
        const covered = Array.from({ length: n }, (_, i) => {
          const q = { x: p.x + r * Math.cos((i / n) * 2 * Math.PI), y: p.y + r * Math.sin((i / n) * 2 * Math.PI) }
          return polys.some((poly) => inside(q, poly) || onEdge(q, poly))
        })
        const start = covered.findIndex((c, i) => c && !covered[(i + n - 1) % n])
        if (start < 0) continue
        let run = 0
        for (let k = 1; k <= n; k++) {
          if (!covered[(start + k) % n]) run++
          else if (run > 0) (run * (360 / n) < 6 && found.push(r), (run = 0))
        }
      }
      return found
    }
    // Two tightly curved walls whose curves leave the joint nearly the same way (a wall cut in two,
    // then each half bent): their faces cross close by, not where their tangents would. Both walls
    // end on the same two points either side of the joint, and the line drawn between them runs
    // across to where their faces meet, not alongside the cut-off corner.
    const pair = applyOps(createDocument(), [wall('up', -1269, 1805, -884, 2390, { bulge: -350, edges: { b: { show: true } } }), wall('down', -884, 2390, -547, 2901, { bulge: -274, edges: { a: { show: true } } })])
    const joint = { x: -884, y: 2390 }
    const beside = (id: string) => {
      const points = outline(pair, id).points as P[]
      const i = points.findIndex((q) => Math.hypot(q.x - joint.x, q.y - joint.y) < 1e-6)
      return [points[(i + points.length - 1) % points.length], points[(i + 1) % points.length]]
    }
    const [up, down] = [beside('up'), beside('down')]
    for (const q of up) expect(down.some((r) => Math.hypot(q.x - r.x, q.y - r.y) < 0.01)).toBe(true)
    const seam = buildScene(pair, 'page_1', registry).flatMap((item) => item.prims).find((p) => p.kind === 'path' && !p.union && !p.closed) as any
    for (const end of seam.points as P[]) expect(up.some((q) => Math.hypot(q.x - end.x, q.y - end.y) < 0.01)).toBe(true)
    expect(slivers(pair, ['up', 'down'], joint)).toEqual([])
    for (const chord of [3000, 700]) for (const f1 of [0, 0.35, -0.5]) for (const f2 of [0.15, -0.35, 0.5]) for (let degrees = 0; degrees < 360; degrees += 30) {
      const turn = (degrees * Math.PI) / 180
      const doc = applyOps(createDocument(), [
        wall('one', 0, 0, chord, 0, f1 ? { bulge: f1 * chord } : {}),
        wall('two', 0, 0, Math.round(chord * Math.cos(turn)), Math.round(chord * Math.sin(turn)), { bulge: f2 * chord }),
      ])
      expect(slivers(doc, ['one', 'two'], { x: 0, y: 0 }), `${chord} ${f1} ${f2} ${degrees}°`).toEqual([])
    }
  }, 60_000)

  it('cuts walls, lines and polylines in two where asked, and says how long each part is', () => {
    const doc = applyOps(createDocument(), [
      wall('w', 0, 0, 4000, 0),
      add({ type: 'line', id: 'l', a: { x: 0, y: 1000 }, b: { x: 3000, y: 1000 }, endMarker: 'arrow' }),
      add({ type: 'polyline', id: 'p', points: [{ x: 0, y: 2000 }, { x: 1000, y: 2000 }, { x: 1000, y: 3000 }] }),
    ])
    const wallPlace = splitPlace(doc.nodes.w, { x: 1234, y: 80 }, 100)!
    expect(wallPlace).toMatchObject({ at: { x: 1200, y: 0 }, before: 1200, after: 2800 })
    expect(splitPlace(doc.nodes.w, { x: 10, y: 0 }, 100)).toBeNull()
    const line = applyOps(doc, splitOps(doc.nodes.l, splitPlace(doc.nodes.l, { x: 1000, y: 1000 })!, 'l2')!)
    expect(line.nodes.l).toMatchObject({ a: { x: 0, y: 1000 }, b: { x: 1000, y: 1000 } })
    expect((line.nodes.l as any).endMarker).toBeUndefined()
    expect(line.nodes.l2).toMatchObject({ a: { x: 1000, y: 1000 }, b: { x: 3000, y: 1000 }, endMarker: 'arrow' })
    const placeP = splitPlace(doc.nodes.p, { x: 1050, y: 2500 })!
    expect(placeP).toMatchObject({ before: 1500, after: 500 })
    const poly = applyOps(doc, splitOps(doc.nodes.p, placeP, 'p2')!)
    expect((poly.nodes.p as any).points).toEqual([{ x: 0, y: 2000 }, { x: 1000, y: 2000 }, { x: 1000, y: 2500 }])
    expect((poly.nodes.p2 as any).points).toEqual([{ x: 1000, y: 2500 }, { x: 1000, y: 3000 }])
  })

  it('draws each edge of a wall with its own look, over the look of the wall', () => {
    const doc = applyOps(createDocument(), [wall('w', 0, 0, 3000, 0, { style: { stroke: '#111111', strokeWidth: 2 }, edges: { right: { stroke: '#e11d48', dash: [6, 4] } } })])
    const lines = (buildScene(doc, 'page_1', registry).find((item) => item.id === 'w')!.prims as any[]).filter((p) => !p.closed && p.union)
    // The right face in red and dashed, at the weight of the wall; the rest in the wall's colour, solid.
    const face = lines.find((p) => p.points.every((q: any) => Math.abs(q.y - 100) < 1e-6))
    expect(face).toMatchObject({ stroke: '#e11d48', strokeWidth: 2, dash: [6, 4] })
    const others = lines.filter((p) => p !== face)
    expect(others.length).toBeGreaterThan(0)
    for (const p of others) expect(p).toMatchObject({ stroke: '#111111', strokeWidth: 2 })
    expect(others.every((p) => p.dash === undefined)).toBe(true)
  })

  it('finds the walls joined end to end to a wall: its run, stopping where three meet, or all that hold together', () => {
    // A square room of four walls, and from its corner at (4000, 0) a run of two walls going on to the right, then a stray wall apart.
    const doc = applyOps(createDocument(), [
      wall('n', 0, 0, 4000, 0),
      wall('e', 4000, 0, 4000, 3000),
      wall('s', 4000, 3000, 0, 3000),
      wall('w', 0, 3000, 0, 0),
      wall('out1', 4000, 0, 7000, 0),
      wall('out2', 7000, 0, 7000, -2000),
      wall('apart', 9000, 0, 12000, 0),
    ])
    const ids = (id: string, network = false) => connectedWalls(doc, doc.nodes[id] as any, network).sort()
    // The south wall's run goes round the room both ways and stops at the corner where three walls meet.
    expect(ids('s')).toEqual(['e', 'n', 's', 'w'])
    expect(ids('out2')).toEqual(['out1', 'out2'])
    expect(ids('apart')).toEqual(['apart'])
    // Everything that holds together, through that corner.
    expect(ids('s', true)).toEqual(['e', 'n', 'out1', 'out2', 's', 'w'])
    expect(ids('apart', true)).toEqual(['apart'])
  })

  it('draws the line between two joined walls once, in the look given to it by either of them', () => {
    // A mitred corner and a wall stopping against another, the line styled from one wall, then from the other.
    for (const [second, join] of [[[0, 3000], undefined], [[-2000, 2500], undefined], [[0, 3000], 'butt'], [[1500, 2500], 'through']] as const) {
      for (const styled of ['one', 'two']) {
        const edge = (id: string) => (id === styled ? { show: true, stroke: '#de0000', strokeWidth: 3 } : { show: true })
        const doc = applyOps(createDocument(), [
          wall('one', 0, 0, 3000, 0, { edges: { a: edge('one') }, ...(join ? { joins: { a: join } } : {}) }),
          wall('two', 0, 0, second[0], second[1], { edges: { a: edge('two') } }),
        ])
        const seams = buildScene(doc, 'page_1', registry).flatMap((item) => item.prims).filter((p: any) => p.kind === 'path' && !p.union && !p.closed)
        expect(seams, `${second} ${join} ${styled}`).toHaveLength(1)
        expect(seams[0], `${second} ${join} ${styled}`).toMatchObject({ stroke: '#de0000', strokeWidth: 3 })
      }
    }
  })

  it('do not change the rooms: those are found from the centerlines', () => {
    const room = (doc: Document) => roomAt(applyOps(doc, [wall('w3', 4000, 3000, 0, 3000), wall('w4', 0, 3000, 0, 0)]), 'page_1', { x: 2000, y: 1500 })!.area
    expect(room(joined('round'))).toBe(room(ell))
    expect(room(joined('butt'))).toBe(room(ell))
  })
})

describe('a wall end set loose', () => {
  const loose = applyOps(ell, looseEndOps(ell.nodes.side as never, 'a', true))

  it('is joined to nothing, though another wall ends at the same point', () => {
    expect((loose.nodes.side as any).joins).toEqual({ a: 'free' })
    expect(wallEndsAt(loose, 'page_1', corner).map((e) => `${e.wall.id}.${e.end}`)).toEqual(['top.b'])
    // Square, both of them: no mitre reaching past the corner.
    expect(reach(loose, 'side').minY).toBeCloseTo(0, 6)
    expect(reach(loose, 'top').maxX).toBeCloseTo(4000, 6)
  })

  it('stays where it is when the corner moves, and says what it touches', () => {
    const moved = applyOps(loose, moveCornerOps(loose, 'page_1', corner, { x: 5000, y: -500 }))
    expect((moved.nodes.top as any).b).toEqual({ x: 5000, y: -500 })
    expect((moved.nodes.side as any).a).toEqual(corner)
    const state = wallEndState(loose, loose.nodes.side as never, 'a')
    expect(state.loose).toBe(true)
    expect(state.joined).toEqual([])
    expect(state.touching.map((w) => w.id)).toEqual(['top'])
  })

  it('is joined again as it was asked', () => {
    const again = applyOps(loose, looseEndOps(loose.nodes.side as never, 'a', false))
    expect((again.nodes.side as any).joins).toBeUndefined()
    expect(wallEndsAt(again, 'page_1', corner)).toHaveLength(2)
    expect(looseEndOps(again.nodes.side as never, 'a', false)).toEqual([])
  })
})

describe('the state of a wall end', () => {
  it('names the walls joined there, and an end of another wall that nearly meets it', () => {
    expect(wallEndState(ell, ell.nodes.top as never, 'b').joined.map((w) => w.id)).toEqual(['side'])
    // Three millimetres short of the corner: not joined, and pointed out.
    const off = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('side', 4003, 0, 4003, 3000)])
    const state = wallEndState(off, off.nodes.top as never, 'b')
    expect(state.joined).toEqual([])
    expect(state.near).toMatchObject({ end: 'a', distance: 3 })
    expect(state.near?.wall.id).toBe('side')
    // Further than that, nothing nearly meets it.
    const far = applyOps(createDocument(), [wall('top', 0, 0, 4000, 0), wall('side', 4020, 0, 4020, 3000)])
    expect(wallEndState(far, far.nodes.top as never, 'b').near).toBeNull()
  })
})

describe('moving a wall with an end set loose', () => {
  const loose = applyOps(ell, looseEndOps(ell.nodes.side as never, 'a', true))

  it('by its end leaves the wall it was set loose from where it is, and the other way round', () => {
    const side = loose.nodes.side as never
    expect(wallEndFollowOps(loose, side, 0, { x: 4200, y: 300 })).toEqual([])
    expect(wallEndFollowOps(loose, loose.nodes.top as never, 1, { x: 4200, y: 300 })).toEqual([])
    // Joined, the other end comes along.
    expect(wallEndFollowOps(ell, ell.nodes.side as never, 0, { x: 4200, y: 300 })).toEqual([{ op: 'update_node', id: 'top', patch: { b: { x: 4200, y: 300 } } }])
  })

  it('whole leaves it behind too', () => {
    expect(wallFollowOps(loose, [loose.nodes.side], { x: 500, y: 0 }, registry)).toEqual([])
    expect(wallFollowOps(ell, [ell.nodes.side], { x: 500, y: 0 }, registry)).toEqual([{ op: 'update_node', id: 'top', patch: { b: { x: 4500, y: 0 } } }])
  })
})
