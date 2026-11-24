import type { BuildEnv, KindSolid, Vec2 } from '@opencalque/core'
import { atLeast, clamp, count, HINGED_WINDOW, hingedRight, LOOSE_WALL, onRails, pt, WINDOW_FRAME } from './shared'
import { box } from './solids'

/*
 * Doors and windows in 3D (`ParametricKind.solids`), in the terms their plan is drawn in: X along
 * the wall from 0 to their width, Y across it, 0 in the middle of its thickness, its faces at plus
 * and minus half of it; a hinged leaf opens towards +Y, and the sill of a window is on the -Y side,
 * outside. Heights are above the floor. Each of their settings shows: the panes and their glazing,
 * the sill, the leaves opened at their angle, which side they are hinged on or slide to.
 */

/** How wide a window's sashes' bars are seen from in front, in mm. */
const SASH = 45
/** How thick a pane of glass is, and the space between two, in mm. */
const PANE = 4
const PANE_GAP = 12
/** How wide a door's lining is seen from in front, how wide its architrave round it on each face and how far it stands out, in mm. */
const JAMB = 30
const ARCHITRAVE = 60
const PROUD = 12
/** How thick a door's leaf is, in mm, and how high its handle is above its sill. */
const LEAF = 40
const HANDLE_HEIGHT = 1000
/** The most panes a window is made of: a count typed by mistake must not make a thousand. */
const MOST_PANES = 12

type Props = Record<string, any>

/** Four bars round x0..x1 and z0..z1, `bar` wide (less where there is no room), y0..y1 across the wall. */
function frame(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, bar: number): KindSolid[] {
  const b = Math.max(1, Math.min(bar, (x1 - x0) / 3, (z1 - z0) / 3))
  return [
    { outline: box(x0, y0, x0 + b, y1), bottom: z0, top: z1 },
    { outline: box(x1 - b, y0, x1, y1), bottom: z0, top: z1 },
    { outline: box(x0 + b, y0, x1 - b, y1), bottom: z0, top: z0 + b },
    { outline: box(x0 + b, y0, x1 - b, y1), bottom: z1 - b, top: z1 },
  ]
}

/** Panes of glass across x0..x1 and z0..z1, about `y`: one, two or three, as the glazing says. */
function glass(x0: number, x1: number, z0: number, z1: number, y: number, glazing: string): KindSolid[] {
  const n = glazing === 'Triple' ? 3 : glazing === 'Single' ? 1 : 2
  return Array.from({ length: n }, (_, i) => {
    const c = y + (i - (n - 1) / 2) * (PANE + PANE_GAP)
    return { outline: box(x0, c - PANE / 2, x1, c + PANE / 2), bottom: z0, top: z1, finish: 'glass' as const }
  })
}

/** A sash, or a glazed leaf: its four bars and its glass, y0..y1 across the wall. */
function sash(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, glazing: string): KindSolid[] {
  const b = Math.min(SASH, (x1 - x0) / 3, (z1 - z0) / 3)
  return [...frame(x0, x1, z0, z1, y0, y1, b), ...glass(x0 + b, x1 - b, z0 + b, z1 - b, (y0 + y1) / 2, glazing)]
}

/** A grip standing upright out of a face at `y`, outwards `out` (+1 or -1), at `x`, from z0 to z1. */
const grip = (x: number, y: number, out: 1 | -1, z0: number, z1: number): KindSolid => ({ outline: box(x - 10, Math.min(y, y + out * 30), x + 10, Math.max(y, y + out * 30)), bottom: z0, top: z1, finish: 'metal' })

/** A shape seen in a mirror across the wall (Y to -Y), or along it (X to `w` - X). */
const across = (solids: KindSolid[]): KindSolid[] =>
  solids.map((s) => ({ ...s, outline: s.outline.map((p) => pt(p.x, -p.y)), ...(s.upper ? { upper: s.upper.map((p) => pt(p.x, -p.y)) } : {}), ...(s.side ? { side: s.side === 1 ? -1 : 1 } : {}) }))
const along = (solids: KindSolid[], w: number): KindSolid[] => solids.map((s) => ({ ...s, outline: s.outline.map((p) => pt(w - p.x, p.y)), ...(s.upper ? { upper: s.upper.map((p) => pt(w - p.x, p.y)) } : {}) }))

/** Where an opening starts and stops above the floor. */
function heights({ height, sillHeight }: Props): [number, number] {
  const s = Math.max(0, Number(sillHeight) || 0)
  return [s, s + atLeast(1, height)]
}

/** Solids turned by `deg` about `pivot` in the plan, as a leaf on its hinge: +X towards +Y. */
function swung(solids: KindSolid[], pivot: Vec2, deg: number): KindSolid[] {
  const a = (deg * Math.PI) / 180
  const [c, sn] = [Math.cos(a), Math.sin(a)]
  const turn = (p: Vec2) => pt(pivot.x + (p.x - pivot.x) * c - (p.y - pivot.y) * sn, pivot.y + (p.x - pivot.x) * sn + (p.y - pivot.y) * c)
  return solids.map((s) => ({ ...s, outline: s.outline.map(turn), ...(s.upper ? { upper: s.upper.map(turn) } : {}) }))
}

/** Glazed leaves on two rails (`onRails`) from z0 to z1, each with a grip from g0 to g1 on its outer face, where it meets the next. */
function railSashes(leaves: ReturnType<typeof onRails>, z0: number, z1: number, g0: number, g1: number, glazing: string): KindSolid[] {
  return leaves.flatMap(({ x0, x1, y, thick }, i) => [
    ...sash(x0, x1, z0, z1, y - thick / 2, y + thick / 2, glazing),
    grip(i % 2 === 0 ? x1 - 60 : x0 + 60, y + (thick / 2) * (y > 0 ? 1 : -1), y > 0 ? 1 : -1, g0, g1),
  ])
}

/**
 * A window: its frame, a sash for each pane with its glass (two or three sheets for double or triple
 * glazing) and, unless it is fixed, its handle on the inside, on the side it opens from (sashes open
 * in pairs, from where they meet), each swung inside by its angle; or for a sliding one, its panes
 * as leaves on two rails; and outside its sill, as deep as it says.
 */
export function windowSolids(props: Props, env: BuildEnv): KindSolid[] {
  const w = atLeast(1, props.width)
  const h = (env.wallThickness ?? LOOSE_WALL) / 2
  const [s, t] = heights(props)
  const bar = Math.min(50, w / 4)
  const depth = Math.min(WINDOW_FRAME, 2 * h)
  const out: KindSolid[] = frame(0, w, s, t, -depth / 2, depth / 2, bar)
  const [z0, z1] = [s + bar, t - bar]
  const middle = (z0 + z1) / 2
  if (props.type === 'Sliding') out.push(...railSashes(onRails(w, bar, depth / 2, props.panes, props.opened, props.slide), z0, z1, middle - 60, middle + 60, props.glazing))
  else {
    const n = Math.min(MOST_PANES, count(props.panes))
    const each = (w - 2 * bar) / n
    const inner = depth / 2 - 10
    const hinged = HINGED_WINDOW.includes(props.type)
    const open = hinged ? clamp(Number(props.angle) || 0, 0, 180) : 0
    for (let i = 0; i < n; i++) {
      const [x0, x1] = [bar + i * each, bar + (i + 1) * each]
      const right = hingedRight(i, n, props.hinge)
      const leaf = sash(x0, x1, z0, z1, -inner, inner, props.glazing)
      // Its handle on the side it opens from.
      const b = Math.min(SASH, (x1 - x0) / 3)
      if (hinged && z1 - z0 > 200) leaf.push(grip(right ? x0 + b / 2 : x1 - b / 2, inner, 1, middle - 60, middle + 60))
      out.push(...(open > 0 ? swung(leaf, pt(right ? x1 : x0, inner), right ? -open : open) : leaf))
    }
  }
  const sill = Math.max(0, Number(props.sill) || 0)
  if (sill > 0) out.push({ outline: box(-30, -h - sill, w + 30, -depth / 2), bottom: s - 40, top: s })
  return props.flip ? across(out) : out
}

/** A lever handle on both faces of a leaf, `at` along it from its hinge `p` the way `d` goes, its faces `n` 0 and LEAF. */
function levers(p: Vec2, d: Vec2, n: Vec2, at: number, z: number): KindSolid[] {
  const quad = (l0: number, l1: number, a0: number, a1: number): Vec2[] =>
    [
      [l0, a0],
      [l1, a0],
      [l1, a1],
      [l0, a1],
    ].map(([l, a]) => pt(p.x + d.x * l + n.x * a, p.y + d.y * l + n.y * a))
  const metal = (outline: Vec2[], z0: number, z1: number): KindSolid => ({ outline, bottom: z0, top: z1, finish: 'metal' })
  return [
    // Its rose and its lever on each face, the lever towards the hinge.
    metal(quad(at - 25, at + 25, -30, LEAF + 30), z - 30, z + 30),
    metal(quad(at - 120, at + 15, -55, -30), z - 10, z + 10),
    metal(quad(at - 120, at + 15, LEAF + 30, LEAF + 55), z - 10, z + 10),
  ]
}

/**
 * A door: its lining across the wall and an architrave round it on each face (a glazed sliding door
 * has a frame instead), and its leaves as its type says, as the plan draws them: hinged, opened at
 * their angle, with a lever handle on each face; hung on the +Y face and shut, under their rail,
 * with a grip; in the middle of the wall, shut, for a pocket door; glazed, on two rails in its frame.
 * An opening only is the hole alone.
 */
export function doorSolids(props: Props, env: BuildEnv): KindSolid[] {
  const { type } = props
  if (type === 'Opening only') return []
  const w = atLeast(1, props.width)
  const h = (env.wallThickness ?? LOOSE_WALL) / 2
  const [s, t] = heights(props)
  const out: KindSolid[] = []
  if (type === 'Sliding') {
    // Its frame, and its glazed leaves on two rails, each overlapping the next, as the plan draws them.
    const bar = Math.min(50, w / 8)
    const depth = Math.min(2 * h, 100)
    out.push(...frame(0, w, s, t, -depth / 2, depth / 2, bar), ...railSashes(onRails(w, bar, h, props.leaves, props.opened, props.slide), s + bar, t - bar, s + 900, s + 1150, 'Double'))
    return props.flip ? across(out) : out
  }
  // Its lining, through the whole thickness of the wall and out as far as its architrave on each
  // face, so that the two make one face round the opening.
  const jamb = Math.min(JAMB, w / 10)
  out.push(...frame(0, w, s, t, -h - PROUD, h + PROUD, jamb).slice(0, 2), { outline: box(0, -h - PROUD, w, h + PROUD), bottom: t - jamb, top: t })
  for (const [y0, y1] of [
    [h, h + PROUD],
    [-h - PROUD, -h],
  ]) {
    out.push(
      { outline: box(-ARCHITRAVE, y0, 0, y1), bottom: s, top: t + ARCHITRAVE },
      { outline: box(w, y0, w + ARCHITRAVE, y1), bottom: s, top: t + ARCHITRAVE },
      { outline: box(0, y0, w, y1), bottom: t, top: t + ARCHITRAVE },
    )
  }
  const top = t - jamb
  const open = clamp(Number(props.angle) || 0, 5, 180)
  // A leaf hinged at `x` on the +Y face, `length` long, closing towards +X (`dir` 1) or -X, opened by the angle.
  const leaf = (x: number, length: number, dir: 1 | -1): KindSolid[] => {
    const a = (((dir === 1 ? 0 : 180) + dir * open) * Math.PI) / 180
    const d = pt(Math.cos(a), Math.sin(a))
    // Its thickness, into the wall when shut.
    const n = pt(d.y * dir, -d.x * dir)
    const p = pt(x, h)
    const q = pt(p.x + d.x * length, p.y + d.y * length)
    const slab: KindSolid = { outline: [p, q, pt(q.x + n.x * LEAF, q.y + n.y * LEAF), pt(p.x + n.x * LEAF, p.y + n.y * LEAF)], bottom: s, top }
    // Seen only from where it opens to: from the other side, through the doorway, it would seem to close it.
    return [slab, ...levers(p, d, n, length - 70, s + HANDLE_HEIGHT)].map((part) => ({ ...part, side: 1 as const }))
  }
  // A leaf hung in front of the +Y face over x0 to x1, a little wider and higher than what it closes, shut.
  const over = Math.min(50, w / 10)
  const hung = (x0: number, x1: number): KindSolid[] => {
    const [a, b] = [x0 === 0 ? -over : x0, x1 === w ? w + over : x1]
    return [{ outline: box(a, h + PROUD + 10, b, h + PROUD + 50), bottom: s, top: t + over }]
  }
  const rail = (x0: number, x1: number): KindSolid => ({ outline: box(x0, h + PROUD + 5, x1, h + PROUD + 60), bottom: t + over, top: t + over + 40, finish: 'metal' })
  const face = h + PROUD + 50
  if (type === 'Single') out.push(...leaf(jamb, w - 2 * jamb, 1))
  else if (type === 'Double') out.push(...leaf(jamb, w / 2 - jamb, 1), ...leaf(w - jamb, w / 2 - jamb, -1))
  else if (type === 'Sliding on wall') out.push(...hung(0, w), rail(-over, 2 * w + over), grip(80, face, 1, s + 900, s + 1150))
  else if (type === 'Double sliding on wall')
    out.push(...hung(0, w / 2), ...hung(w / 2, w), rail(-w / 2 - over, (3 * w) / 2 + over), grip(w / 2 - 80, face, 1, s + 900, s + 1150), grip(w / 2 + 80, face, 1, s + 900, s + 1150))
  else if (type === 'Pocket') {
    // In the middle of the wall, shut across the opening, a grip on each face.
    const half = Math.min(20, h / 2)
    out.push({ outline: box(jamb, -half, w, half), bottom: s, top }, grip(jamb + 60, half, 1, s + 900, s + 1150), grip(jamb + 60, -half, -1, s + 900, s + 1150))
  }
  let made = out
  if ((type === 'Single' && props.hinge === 'Right') || ((type === 'Sliding on wall' || type === 'Pocket') && props.slide === 'Left')) made = along(made, w)
  return props.flip ? across(made) : made
}
