import { dist, norm, pointInPolygon, sub, type Vec2 } from './geometry'
import type { Solid } from './massing'
import type { Primitive } from './primitives'
import type { NodeOf } from './schema'

/*
 * Viewpoints (ARCHITECTURE §4, "Viewpoints"): someone standing at `a` on the plan, looking level
 * towards `b`, as a photograph of a room is taken. Nothing of what is seen is stored: the editor
 * raises the plan to its heights (`massing.ts`) and looks at it from there each time, and
 * `perspective.ts` says in words what is in view.
 */

export type Camera = NodeOf<'camera'>

/** How wide a viewpoint sees, in degrees, when it does not say: about a 24 mm lens, as rooms are photographed. */
export const DEFAULT_FOV = 70
/** How high the eye is above the floor, in mm, when it does not say. */
export const DEFAULT_EYE_HEIGHT = 1500
/** How much wider than high a view is when its frame does not say: 16:9, as a screen. */
export const FRAME_SHAPE = 16 / 9
/** How high a viewpoint's view is, in mm: as its frame says, else 9/16 of its width. */
export const frameHeight = (frame: { width: number; height?: number }): number => frame.height ?? frame.width / FRAME_SHAPE

/**
 * How long a viewpoint's mark on the plan is, from the eye to the arc of what it sees, in mm:
 * always the same, since nothing of the view depends on it (`b` gives only the way it looks).
 */
export const MARK_LENGTH = 1500

/** The radius of the dot drawn where the eye is, in mm. */
const EYE = 120
/** How many straight pieces draw the arc across the far end of what it sees. */
const ARC_STEPS = 12

export const fovOf = (camera: Pick<Camera, 'fov'>): number => Math.min(150, Math.max(10, camera.fov ?? DEFAULT_FOV))
export const eyeHeightOf = (camera: Pick<Camera, 'eyeHeight'>): number => camera.eyeHeight ?? DEFAULT_EYE_HEIGHT
/** How far it looks up from level, in degrees (down when negative): 0 unless it says. */
export const pitchOf = (camera: Pick<Camera, 'pitch'>): number => Math.min(60, Math.max(-60, camera.pitch ?? 0))

/**
 * The focal length that sees `fov` degrees across, in mm, on a full-frame camera (a picture 36 mm
 * wide): how photographers name a lens. 70° is about 26 mm.
 */
export const focalOf = (fov: number): number => 18 / Math.tan((fov * Math.PI) / 360)
/** How wide a lens of `focal` mm sees, in degrees, within what a viewpoint allows (10° to 150°). */
export const fovOfFocal = (focal: number): number => Math.min(150, Math.max(10, (360 / Math.PI) * Math.atan(18 / Math.max(1e-6, focal))))

/** The way it looks, on the plan; null for a viewpoint whose two points are one. */
export function lookOf(camera: Pick<Camera, 'a' | 'b'>): Vec2 | null {
  return dist(camera.a, camera.b) < 1e-6 ? null : norm(sub(camera.b, camera.a))
}

/** The direction `turn` degrees clockwise on the plan from `d`. */
function turned(d: Vec2, turn: number): Vec2 {
  const r = (turn * Math.PI) / 180
  return { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) }
}

/**
 * How far to its right `p` is seen, in degrees from the middle of the view (negative on its left),
 * and how far it is ahead along the way it looks, in mm. Null for a viewpoint with no way.
 */
export function bearing(camera: Pick<Camera, 'a' | 'b'>, p: Vec2): { angle: number; ahead: number } | null {
  const look = lookOf(camera)
  if (!look) return null
  const v = sub(p, camera.a)
  const ahead = v.x * look.x + v.y * look.y
  // Y grows downward: a point to the right of the way it looks has a positive cross product.
  const right = look.x * v.y - look.y * v.x
  return { angle: (Math.atan2(right, ahead) * 180) / Math.PI, ahead }
}

/** The tip of its mark, ahead of the eye: the handle that turns it. Null for a viewpoint with no way. */
export function markTip(camera: Pick<Camera, 'a' | 'b'>): Vec2 | null {
  const look = lookOf(camera)
  return look && { x: camera.a.x + look.x * MARK_LENGTH, y: camera.a.y + look.y * MARK_LENGTH }
}

/**
 * The two far ends of what it sees on the plan, left then right: the ends of its arc, which are
 * dragged to make it see wider or narrower. Empty for a viewpoint with no way.
 */
export function cameraEdges(camera: Camera): Vec2[] {
  const look = lookOf(camera)
  if (!look) return []
  const reach = MARK_LENGTH
  const half = fovOf(camera) / 2
  return [-half, half].map((turn) => {
    const d = turned(look, turn)
    return { x: camera.a.x + d.x * reach, y: camera.a.y + d.y * reach }
  })
}

/**
 * How wide it sees once an end of its arc is dragged to `p`: twice the angle between the way it
 * looks and `p`, whichever side `p` is on. Rounded to the degree; the way it looks is kept.
 */
export function fovThrough(camera: Camera, p: Vec2): number | null {
  const b = bearing(camera, p)
  if (!b) return null
  return Math.min(150, Math.max(10, Math.round(2 * Math.abs(b.angle))))
}

/**
 * What a viewpoint becomes once it looks `turn` degrees further to its right (left when negative)
 * and `tilt` degrees further up (down when negative), standing where it is: `b` turned about `a`,
 * as far from it as it was, and its tilt kept within ±60° and to the whole degree (left out when
 * level). Null for a viewpoint with no way. This is how dragging its view looks around.
 */
export function lookAround(camera: Camera, turn: number, tilt: number): Pick<Camera, 'b' | 'pitch'> | null {
  const look = lookOf(camera)
  if (!look) return null
  const reach = dist(camera.a, camera.b)
  const d = turned(look, turn)
  const pitch = Math.round(Math.min(60, Math.max(-60, pitchOf(camera) + tilt)))
  return { b: { x: Math.round(camera.a.x + d.x * reach), y: Math.round(camera.a.y + d.y * reach) }, pitch: pitch || undefined }
}

/** The lowest an eye is put by moving it, in mm. */
const LOWEST_EYE = 100

/**
 * What a viewpoint becomes once it steps `right` mm to its right (left when negative) and `ahead`
 * mm forward (back when negative), its way of looking kept, and its eye `up` mm higher (lower when
 * negative, down to 100 mm). Rounded to the millimetre. Null for a viewpoint with no way. This is
 * how dragging its view, or turning the wheel over it, moves it.
 */
export function stepAside(camera: Camera, right: number, up: number, ahead = 0): Pick<Camera, 'a' | 'b' | 'eyeHeight'> | null {
  const look = lookOf(camera)
  if (!look) return null
  // Its right, Y growing downward: a quarter turn clockwise from the way it looks; then ahead.
  const [dx, dy] = [-look.y * right + look.x * ahead, look.x * right + look.y * ahead]
  const moved = (p: Vec2) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) })
  return { a: moved(camera.a), b: moved(camera.b), eyeHeight: Math.max(LOWEST_EYE, Math.round(eyeHeightOf(camera) + up)) }
}

/**
 * A viewpoint on the plan: a dot where the eye is, and the two lines of what it sees, as long as
 * from `a` to `b`, closed by an arc across, dashed: what a photograph taken from there takes in.
 */
export function cameraPrimitives(camera: Camera): Primitive[] {
  const eye: Primitive = { kind: 'ellipse', cx: camera.a.x, cy: camera.a.y, rx: EYE, ry: EYE, fill: 'stroke', own: true }
  const look = lookOf(camera)
  if (!look) return [eye]
  const reach = MARK_LENGTH
  const half = fovOf(camera) / 2
  const at = (turn: number) => {
    const d = turned(look, turn)
    return { x: camera.a.x + d.x * reach, y: camera.a.y + d.y * reach }
  }
  const arc = Array.from({ length: ARC_STEPS + 1 }, (_, i) => at(-half + (2 * half * i) / ARC_STEPS))
  return [
    { kind: 'path', points: [arc[0], camera.a, arc[ARC_STEPS]], own: true },
    { kind: 'path', points: arc, dash: [6, 4], own: true },
    { kind: 'path', points: [camera.a, markTip(camera)!], dash: [2, 4], own: true },
    eye,
  ]
}

/** How near the eye something is seen from, in mm: what is nearer is not drawn (the renderer's near plane), so not picked either. */
const NEAREST = 100

/**
 * What is seen at a point of a viewpoint's picture: the solid nearest the eye along the line of
 * sight through it (`u` across from the left, `v` down from the top, both from 0 to 1, the
 * picture `aspect` times as wide as high), and where on the plan and how high that line meets it.
 * Null where nothing is in the way, the ground or the sky. The line of sight is the renderer's:
 * the eye at its height, looking the way it looks, tilted up or down, seeing `fov` across. A slab
 * that narrows as it goes up (`upper`) is taken as its outline at its foot.
 */
export function solidAt(solids: Solid[], camera: Camera, u: number, v: number, aspect: number): { solid: Solid; at: Vec2; height: number } | null {
  const look = lookOf(camera) ?? { x: 0, y: -1 }
  const eye = { x: camera.a.x, y: camera.a.y, z: eyeHeightOf(camera) }
  // Ahead, level then tilted; to the right, level (Y grows downward: a quarter turn clockwise); up, across both.
  const tilt = (pitchOf(camera) * Math.PI) / 180
  const ahead = { x: look.x * Math.cos(tilt), y: look.y * Math.cos(tilt), z: Math.sin(tilt) }
  const right = { x: -look.y, y: look.x, z: 0 }
  const up = { x: ahead.y * right.z - ahead.z * right.y, y: ahead.z * right.x - ahead.x * right.z, z: ahead.x * right.y - ahead.y * right.x }
  // Whichever way that cross product turns with Y down on the plan, the one that points up.
  const upward = up.z < 0 ? { x: -up.x, y: -up.y, z: -up.z } : up
  const across = Math.tan((fovOf(camera) * Math.PI) / 360)
  const [sx, sy] = [(2 * u - 1) * across, (1 - 2 * v) * (across / Math.max(1e-6, aspect))]
  const d = { x: ahead.x + sx * right.x + sy * upward.x, y: ahead.y + sx * right.y + sy * upward.y, z: ahead.z + sx * right.z + sy * upward.z }
  const [flat, high] = [{ x: d.x, y: d.y }, d.z]
  let best: { solid: Solid; t: number } | null = null
  const consider = (solid: Solid, t: number) => {
    // `ahead` is of unit length and square to the rest of `d`: `t` is how far ahead of the eye the point is, where the near plane cuts.
    if (t < NEAREST || (best && best.t <= t)) return
    best = { solid, t }
  }
  for (const solid of solids) {
    const rings = [solid.outline, ...(solid.holes ?? [])]
    const inside = (p: Vec2) => pointInPolygon(p, solid.outline) && !(solid.holes ?? []).some((hole) => pointInPolygon(p, hole))
    // Its top and its underside.
    if (Math.abs(high) > 1e-9) {
      for (const z of [solid.top, solid.bottom]) {
        const t = (z - eye.z) / high
        if (t > 0 && inside({ x: eye.x + flat.x * t, y: eye.y + flat.y * t })) consider(solid, t)
      }
    }
    // Its sides: where the line of sight crosses an edge on the plan, between its foot and its top.
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [p, q] = [ring[i], ring[(i + 1) % ring.length]]
        const e = { x: q.x - p.x, y: q.y - p.y }
        const den = flat.x * e.y - flat.y * e.x
        if (Math.abs(den) < 1e-12) continue
        const w = { x: p.x - eye.x, y: p.y - eye.y }
        const t = (w.x * e.y - w.y * e.x) / den
        const s = (w.x * flat.y - w.y * flat.x) / den
        if (t <= 0 || s < 0 || s > 1) continue
        const z = eye.z + high * t
        if (z >= solid.bottom && z <= solid.top) consider(solid, t)
      }
    }
  }
  if (!best) return null
  const { solid, t } = best as { solid: Solid; t: number }
  return { solid, at: { x: eye.x + flat.x * t, y: eye.y + flat.y * t }, height: eye.z + high * t }
}
