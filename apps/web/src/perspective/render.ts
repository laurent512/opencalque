import * as THREE from 'three'
import { eyeHeightOf, fovOf, lookOf, pitchOf, seenFrom, type Camera, type Primitive, type Solid, type Vec2 } from '@opencalque/core'

/*
 * What a viewpoint sees, drawn with three.js: the solids of the plan (`massing`) raised and looked
 * at from the eye. Loaded only when the Perspective panel shows, so that the editor does not carry
 * three.js until it is needed.
 *
 * Its lines are found on the picture, not on the solids: a first pass draws which way each surface
 * faces and how far it is, a second draws a line where either changes suddenly. So a wall cut in
 * stretches around a window shows no line where the stretches meet, only its real edges, and the
 * outline of anything against what is behind it.
 *
 * Each object's faces carry what the drawing draws of it (`drawings` on its solid): its plan on its
 * top, its front, side and back on the faces that look that way, so that a sink shows its bowls and
 * tap, a hob its rings, a base unit its doors. They are painted into pictures, kept while they do not
 * change, and drawn in a pass of their own (`inkScene`) that the last pass lays over the view, so
 * that they show in every look but the depth map.
 *
 * The plan's (x, y), and the height h above the floor, are three.js's (x, h, y): Y up.
 */

/** How the view is drawn: black lines on white, shaded grey with its lines, or how far each point is. */
export type Look = 'lines' | 'clay' | 'depth'

const COLOURS: Record<Solid['role'] | 'ground', number> = {
  wall: 0xf4f4f2,
  object: 0xd8d2c8,
  glass: 0xb9cfe0,
  ceiling: 0xfafafa,
  shaft: 0xf4f4f2,
  ground: 0xe4e2de,
}

/**
 * How the finishes kinds give their slabs look (`KindSolid.finish`): shaded, and in the pass of
 * drawings, which every look but the depth map lays over the view.
 */
const FINISHES: Record<NonNullable<Solid['finish']>, { shaded: number; ink: number }> = {
  plain: { shaded: 0xd8d2c8, ink: 0xffffff },
  dark: { shaded: 0x232323, ink: 0x6a6a6a },
  metal: { shaded: 0xc4c8cc, ink: 0xdedede },
}

/** How near and how far the eye sees, in mm. */
const NEAR = 100
const FAR = 200000

const EDGES = /* glsl */ `
  uniform sampler2D normals;
  uniform sampler2D depths;
  uniform sampler2D shaded;
  uniform sampler2D inks;
  uniform vec2 texel;
  // How far apart, in pixels, the points compared to find a line are: how thick the lines are.
  uniform float spread;
  uniform float near;
  uniform float far;
  uniform int look;
  uniform float reach;
  // What is selected, where it is seen (white), and whether anything is; drawn tinted and outlined in the accent colour.
  uniform sampler2D mask;
  uniform bool marked;
  uniform vec3 accent;
  varying vec2 vUv;

  // 1/z is what is linear across a flat surface on the picture: its second difference is 0 there.
  float inverseZ(vec2 uv) {
    float d = texture2D(depths, uv).x;
    if (d >= 1.0) return 0.0;
    float z = near * far / (far - d * (far - near));
    return 1.0 / z;
  }
  vec3 normalAt(vec2 uv) { return texture2D(normals, uv).xyz * 2.0 - 1.0; }

  // The colour of a point, with what is selected tinted, and outlined where it meets anything else.
  vec4 chosen(vec3 colour) {
    if (!marked) return vec4(colour, 1.0);
    float m = texture2D(mask, vUv).r;
    vec2 ox = vec2(texel.x * (spread + 1.0), 0.0);
    vec2 oy = vec2(0.0, texel.y * (spread + 1.0));
    float around = texture2D(mask, vUv - ox).r + texture2D(mask, vUv + ox).r + texture2D(mask, vUv - oy).r + texture2D(mask, vUv + oy).r;
    float rim = m > 0.5 ? step(around, 3.5) : step(0.5, around);
    vec3 tinted = mix(colour, accent, 0.28 * m);
    return vec4(mix(tinted, accent, rim), 1.0);
  }

  void main() {
    float c = inverseZ(vUv);
    if (look == 2) {
      // A depth map: near is white, as depth models expect.
      float z = c > 0.0 ? 1.0 / c : far;
      float v = 1.0 - clamp(z / reach, 0.0, 1.0);
      gl_FragColor = chosen(vec3(v));
      return;
    }
    vec2 dx = vec2(texel.x * spread, 0.0);
    vec2 dy = vec2(0.0, texel.y * spread);
    float l = inverseZ(vUv - dx), r = inverseZ(vUv + dx), u = inverseZ(vUv + dy), b = inverseZ(vUv - dy);
    float scale = max(max(c, max(l, r)), max(u, b));
    float jump = scale > 0.0 ? max(abs(l + r - 2.0 * c), abs(u + b - 2.0 * c)) / scale : 0.0;
    vec3 n = normalAt(vUv);
    float turn = 0.0;
    if (c > 0.0) {
      turn = max(turn, l > 0.0 ? 1.0 - dot(n, normalAt(vUv - dx)) : 1.0);
      turn = max(turn, r > 0.0 ? 1.0 - dot(n, normalAt(vUv + dx)) : 1.0);
      turn = max(turn, u > 0.0 ? 1.0 - dot(n, normalAt(vUv + dy)) : 1.0);
      turn = max(turn, b > 0.0 ? 1.0 - dot(n, normalAt(vUv - dy)) : 1.0);
    } else {
      turn = (l > 0.0 || r > 0.0 || u > 0.0 || b > 0.0) ? 1.0 : 0.0;
    }
    // A step of 1% in how far things are is a line: the glass of a window 10 cm behind the face of
    // a wall seen from 5 m. Flat surfaces have none, however steeply they are seen.
    float edge = max(smoothstep(0.004, 0.012, jump), smoothstep(0.08, 0.2, turn));
    // What the objects' own drawings put on their faces, over white or the shaded picture; both
    // are in linear light, made sRGB here as the screen shows it.
    vec3 light = look == 1 ? texture2D(shaded, vUv).rgb : vec3(1.0);
    vec3 base = pow(light * texture2D(inks, vUv).rgb, vec3(1.0 / 2.2));
    vec3 ink = look == 1 ? vec3(0.25) : vec3(0.0);
    gl_FragColor = chosen(mix(base, ink, edge));
  }
`

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/** The faces a drawing goes on; a face of none is plain (material 0), the others follow in this order. */
type Slot = 'top' | 'front' | 'side' | 'back'
const SLOTS: Slot[] = ['top', 'front', 'side', 'back']

/** A drawing painted as a picture, and the rectangle of the drawing's coordinates it covers. */
interface Painted {
  texture: THREE.CanvasTexture
  rect: { x: number; y: number; w: number; h: number }
  /** What the pass of drawings lays it with, made once. */
  ink: THREE.MeshBasicMaterial
}

/** One solid as drawn: its geometry in the three scenes, kept while the plan holds it unchanged. */
interface Piece {
  geometry: THREE.BufferGeometry
  /** Its material in the shaded pass, and in the pass of drawings, for each of its groups. */
  shaded: THREE.Material
  inks: THREE.Material[]
  /** The drawings painted on it, which are kept while it is. */
  drawings: string[]
  /** The node of the plan it is of: what selecting that node lights in the view. */
  node: string
}

/** A mesh of the view, with the geometry it is the only one to draw: what `drop` takes out and frees. */
interface Drawn {
  geometry: THREE.BufferGeometry
  meshes: { scene: THREE.Scene; mesh: THREE.Mesh }[]
}

/**
 * Stretches of geometries made one: their faces one after the other, for one draw of them all. A
 * plan of a few rooms is thousands of slabs, which drawn one by one, three times over, made each
 * step of a drag wait on as many draws.
 */
function merged(parts: { geometry: THREE.BufferGeometry; start: number; count: number }[]): THREE.BufferGeometry {
  const total = parts.reduce((n, part) => n + part.count, 0)
  const sizes = { position: 3, normal: 3, uv: 2 } as const
  const geometry = new THREE.BufferGeometry()
  for (const [name, size] of Object.entries(sizes)) {
    const out = new Float32Array(total * size)
    let at = 0
    for (const { geometry: from, start, count } of parts) {
      const array = from.getAttribute(name).array as Float32Array
      out.set(array.subarray(start * size, (start + count) * size), at)
      at += count * size
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size))
  }
  return geometry
}

/** Pixels of a painted drawing to a millimetre, and the most it has on a side. */
const DENSITY = 1
const LARGEST = 2048
/** How thick a line of a drawing is painted, in mm for each pixel of its weight on the plan. */
const INK_MM = 3
/**
 * And at least this share of the drawing's smaller side, so that what is far, or small in the
 * picture, keeps lines that can be seen: a unit 60 cm wide has lines 10 mm thick at the least. Its
 * smaller side, so that a unit made taller (a tall unit up to the ceiling) keeps the lines of the
 * units beside it.
 */
const INK_SHARE = 1 / 60
const INK = '#262626'

/** Paints a drawing as a picture, white round it so that what of a face lies outside it stays plain. */
function paintDrawing(prims: Primitive[]): Omit<Painted, 'ink'> | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  const take = (x: number, y: number) => {
    ;[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
  }
  for (const p of prims) {
    if (p.kind === 'path') for (const q of p.points) take(q.x, q.y)
    else if (p.kind === 'ellipse') {
      const r = Math.max(Math.abs(p.rx), Math.abs(p.ry))
      take(p.cx - r, p.cy - r)
      take(p.cx + r, p.cy + r)
    }
  }
  if (!Number.isFinite(x0) || Math.max(x1 - x0, y1 - y0) < 1) return null
  const pad = Math.max(10, 0.05 * Math.max(x1 - x0, y1 - y0))
  const ink = Math.max(INK_MM, INK_SHARE * Math.min(x1 - x0, y1 - y0))
  const rect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
  const scale = Math.min(DENSITY, LARGEST / Math.max(rect.w, rect.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.ceil(rect.w * scale))
  canvas.height = Math.max(2, Math.ceil(rect.h * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const p of prims) {
    ctx.beginPath()
    if (p.kind === 'path') {
      if (p.points.length === 0) continue
      ctx.moveTo(p.points[0].x, p.points[0].y)
      for (const q of p.points.slice(1)) ctx.lineTo(q.x, q.y)
      if (p.closed) ctx.closePath()
    } else if (p.kind === 'ellipse') {
      ctx.ellipse(p.cx, p.cy, Math.abs(p.rx), Math.abs(p.ry), ((p.rotation ?? 0) * Math.PI) / 180, 0, 2 * Math.PI)
    } else continue
    const closed = p.kind === 'ellipse' || p.closed
    // A fill of the stroke's colour is ink; any other hides what is under it, as on paper, in its own colour.
    if (closed && p.fill && p.fill !== 'none') {
      ctx.fillStyle = '#ffffff'
      ctx.fillStyle = p.fill === 'stroke' ? INK : p.fill.startsWith('var(') ? '#ffffff' : p.fill
      ctx.fill()
    }
    if (p.stroke !== 'none') {
      ctx.lineWidth = Math.max(0.6, p.strokeWidth ?? 1) * ink
      ctx.setLineDash(p.dash ? p.dash.map((d) => d * ink) : [])
      ctx.strokeStyle = INK
      ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return { texture, rect }
}

/** Twice the area inside a ring of points: positive one way round, negative the other. */
function turning(ring: Vec2[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) area += ring[i].x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * ring[i].y
  return area
}

/**
 * A solid raised from its outline on the plan, in three.js's axes, face by face: its top, its
 * bottom and its sides, each in the group of the material of the drawing it takes (0 for none).
 */
/** The ground: a square `span` wide round (cx, cy) on the plan, just under the floor, facing up, with `holes` cut out of it. */
function groundGeometry(cx: number, cy: number, span: number, holes: Vec2[][]): THREE.BufferGeometry {
  const half = span / 2
  const square = [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ]
  const cut = holes.filter((hole) => hole.length >= 3)
  const all = [square, ...cut].flat()
  const triangles = THREE.ShapeUtils.triangulateShape(
    square.map((p) => new THREE.Vector2(p.x, p.y)),
    cut.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.y))),
  )
  const positions: number[] = []
  for (const corners of triangles) {
    const [a, b, c] = corners.map((i) => new THREE.Vector3(all[i].x, -1, all[i].y))
    // Facing up: three.js takes as the front the side its points go round anticlockwise.
    const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0
    for (const p of up ? [a, b, c] : [a, c, b]) positions.push(p.x, p.y, p.z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  return geometry
}

function solidGeometry(solid: Solid, painted: Partial<Record<Slot, Painted>>): THREE.BufferGeometry | null {
  if (solid.outline.length < 3 || !(solid.top - solid.bottom > 0)) return null
  const bySlot: { positions: number[]; normals: number[]; uvs: number[] }[] = SLOTS.concat(['top']).map(() => ({ positions: [], normals: [], uvs: [] }))
  const at = (p: Vec2, h: number) => new THREE.Vector3(p.x, h, p.y)
  /** A triangle, turned to face `normal`: three.js draws as its front the side its points go round anticlockwise. */
  const triangle = (points: THREE.Vector3[], uv: [number, number][], normal: THREE.Vector3, slot: number) => {
    const facing = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0])).dot(normal)
    const into = bySlot[slot]
    for (const i of facing < 0 ? [0, 2, 1] : [0, 1, 2]) {
      into.positions.push(points[i].x, points[i].y, points[i].z)
      into.normals.push(normal.x, normal.y, normal.z)
      into.uvs.push(uv[i][0], uv[i][1])
    }
  }
  const uvOf = (slot: Slot, x: number, y: number): [number, number] => {
    const rect = painted[slot]!.rect
    return [(x - rect.x) / rect.w, 1 - (y - rect.y) / rect.h]
  }
  const none = (): [number, number] => [0, 0]

  // Its top and its bottom: of a slab that narrows as it goes up, its top is its upper outline, point for point.
  const holes = (solid.holes ?? []).filter((hole) => hole.length >= 3)
  const upper = !holes.length && solid.upper?.length === solid.outline.length ? solid.upper : null
  const all = [solid.outline, ...holes].flat()
  const raised = upper ?? all
  const caps = THREE.ShapeUtils.triangulateShape(
    solid.outline.map((p) => new THREE.Vector2(p.x, p.y)),
    holes.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.y))),
  )
  const up = new THREE.Vector3(0, 1, 0)
  const down = new THREE.Vector3(0, -1, 0)
  const top = painted.top ? SLOTS.indexOf('top') + 1 : 0
  for (const [a, b, c] of caps) {
    const ring = [all[a], all[b], all[c]]
    const over = [raised[a], raised[b], raised[c]]
    triangle(over.map((p) => at(p, solid.top)), over.map((p) => (top ? uvOf('top', p.x, p.y) : none())), up, top)
    triangle(ring.map((p) => at(p, solid.bottom)), ring.map(none), down, 0)
  }

  // Its sides, each taking the drawing of the way it looks.
  const drawings = solid.drawings
  for (const [index, ring] of [solid.outline, ...holes].entries()) {
    // Out of the solid: away from the inside of its outline, into a hole.
    const out = (turning(ring) > 0 ? 1 : -1) * (index === 0 ? 1 : -1)
    const over = index === 0 && upper ? upper : ring
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      const [p, q] = [ring[i], ring[j]]
      const length = Math.hypot(q.x - p.x, q.y - p.y)
      if (length < 1e-6) continue
      const n = { x: ((q.y - p.y) / length) * out, y: (-(q.x - p.x) / length) * out }
      const corners: [Vec2, number][] = [
        [p, solid.bottom],
        [q, solid.bottom],
        [over[j], solid.top],
        [over[i], solid.top],
      ]
      // A side that leans: the way it faces, out of the solid, from three of its corners.
      let normal = new THREE.Vector3(n.x, 0, n.y)
      if (over !== ring) {
        const [c0, c1, c3] = [at(...corners[0]), at(...corners[1]), at(...corners[3])]
        const leaning = new THREE.Vector3().subVectors(c1, c0).cross(new THREE.Vector3().subVectors(c3, c0))
        if (leaning.lengthSq() > 1e-12) normal = leaning.normalize().multiplyScalar(leaning.dot(normal) < 0 ? -1 : 1)
      }
      let slot = 0
      let uv: [number, number][] = corners.map(none)
      if (drawings) {
        const seen = seenFrom(drawings.facing, n)
        if (painted[seen]) {
          slot = SLOTS.indexOf(seen) + 1
          const { along, facing, origin, base } = drawings
          const k = along.x * along.x + along.y * along.y || 1
          uv = corners.map(([r, h]) => {
            const d = { x: r.x - origin.x, y: r.y - origin.y }
            const x = seen === 'side' ? d.x * facing.x + d.y * facing.y : (d.x * along.x + d.y * along.y) / k
            return uvOf(seen, x, base - h)
          })
        }
      }
      const points = corners.map(([r, h]) => at(r, h))
      triangle([points[0], points[1], points[2]], [uv[0], uv[1], uv[2]], normal, slot)
      triangle([points[0], points[2], points[3]], [uv[0], uv[2], uv[3]], normal, slot)
    }
  }

  // One after the other by material, as three.js draws groups.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bySlot.flatMap((s) => s.positions), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bySlot.flatMap((s) => s.normals), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bySlot.flatMap((s) => s.uvs), 2))
  let start = 0
  for (const [slot, { positions }] of bySlot.entries()) {
    const count = positions.length / 3
    if (count > 0) geometry.addGroup(start, count, slot)
    start += count
  }
  return geometry
}

/** A view of solids from a viewpoint, kept to be drawn again as the plan changes; `dispose` frees what it holds. */
export class PerspectiveView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private shadedScene = new THREE.Scene()
  /** The drawings on the objects' faces, ink on white, everything else white. */
  private inkScene = new THREE.Scene()
  private eye = new THREE.PerspectiveCamera(60, 16 / 9, NEAR, FAR)
  private target: THREE.WebGLRenderTarget
  private shadedTarget: THREE.WebGLRenderTarget
  private inkTarget: THREE.WebGLRenderTarget
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private quadScene = new THREE.Scene()
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
  private white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  /** The corners of the solids on the plan: how far the view reaches decides the shades of a depth map. */
  private corners: Vec2[] = []
  /** The drawings painted, by what they draw, kept while some object in view draws them. */
  private painted = new Map<string, Painted | null>()
  /**
   * The solids drawn, by what they are: a change of the plan makes again only those it changed, so
   * that the view keeps up with an edit of a large plan.
   */
  private pieces = new Map<string, Piece>()
  /** The ground under them, made again with them. */
  private ground: Drawn | null = null
  /** The meshes the pieces are drawn with, a few for all of them (`batch`). */
  private batches: Drawn[] = []
  /** The nodes selected, lit in the view, and the mesh of their pieces drawn into the mask (`maskScene`). */
  private selected = new Set<string>()
  private chosen: Drawn | null = null
  private maskScene = new THREE.Scene()
  private maskTarget: THREE.WebGLRenderTarget
  private black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
  // Drawn over the same faces as the black: it wins where they are as near (`LessEqualDepth`), and a little nearer still.
  private whiteOver = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  /** The materials of the shaded pass and of the finishes, one for each colour, shared by every solid. */
  private materials = new Map<string, THREE.Material>()
  /** What a drawing of an object is, as text, while the same drawing is looked at: an object of several slabs shares its own. */
  private drawingKeys = new WeakMap<Primitive[], string>()
  /** What a solid is, as text, while the same solid is looked at: the plan raised again keeps those of objects it did not change. */
  private solidKeys = new WeakMap<Solid, string>()

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
    this.renderer.setClearColor(0xffffff, 1)
    const depthTexture = new THREE.DepthTexture(1, 1)
    depthTexture.type = THREE.UnsignedIntType
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture, depthBuffer: true })
    this.shadedTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 4 })
    this.inkTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 4 })
    this.maskTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: EDGES,
      uniforms: {
        normals: { value: this.target.texture },
        depths: { value: depthTexture },
        shaded: { value: this.shadedTarget.texture },
        inks: { value: this.inkTarget.texture },
        texel: { value: new THREE.Vector2(1, 1) },
        spread: { value: 1 },
        near: { value: NEAR },
        far: { value: FAR },
        look: { value: 0 },
        reach: { value: 10000 },
        mask: { value: this.maskTarget.texture },
        marked: { value: false },
        // As the page gives it: the last pass writes its colours as they are, with no conversion from linear light.
        accent: { value: new THREE.Color().setStyle('#2f80ed', THREE.LinearSRGBColorSpace) },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.quadScene.add(this.quad)
    this.shadedScene.add(new THREE.HemisphereLight(0xffffff, 0xb8b4ac, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(0.4, 1, 0.25)
    this.shadedScene.add(sun)
    this.shadedScene.background = new THREE.Color(0xffffff)
  }

  /** What a drawing draws, as text: the key of what is painted of it. */
  private keyOf(prims: Primitive[]): string {
    let key = this.drawingKeys.get(prims)
    if (key === undefined) {
      key = JSON.stringify(prims)
      this.drawingKeys.set(prims, key)
    }
    return key
  }

  /** A drawing painted, once for as long as it is drawn the same. */
  private paint(key: string, prims: Primitive[]): Painted | null {
    if (!this.painted.has(key)) {
      const made = paintDrawing(prims)
      this.painted.set(key, made && { ...made, ink: new THREE.MeshBasicMaterial({ map: made.texture, side: THREE.DoubleSide }) })
    }
    return this.painted.get(key) ?? null
  }

  /** A material shared by every solid that wants it. */
  private material(key: string, make: () => THREE.Material): THREE.Material {
    let material = this.materials.get(key)
    if (!material) {
      material = make()
      this.materials.set(key, material)
    }
    return material
  }

  /** One solid made to be drawn, with the drawings painted on it; null for one with no volume. */
  private piece(solid: Solid, drawings: Partial<Record<Slot, string>>): Piece | null {
    const painted: Partial<Record<Slot, Painted>> = {}
    for (const slot of SLOTS) {
      const key = drawings[slot]
      const done = key === undefined ? null : this.paint(key, solid.drawings![slot]!)
      if (done) painted[slot] = done
    }
    const geometry = solidGeometry(solid, painted)
    if (!geometry) return null
    const shaded = this.material(`shaded ${solid.finish ?? solid.role}`, () =>
      new THREE.MeshLambertMaterial({ color: solid.finish ? FINISHES[solid.finish].shaded : COLOURS[solid.role], side: THREE.DoubleSide, ...(solid.role === 'glass' ? { transparent: true, opacity: 0.55 } : {}) }),
    )
    // In the pass of drawings, a slab of a finish is its tone, which every look shows: a black hob reads as one far off.
    const plain = solid.finish ? this.material(`ink ${solid.finish}`, () => new THREE.MeshBasicMaterial({ color: FINISHES[solid.finish!].ink, side: THREE.DoubleSide })) : this.white
    const inks = [plain, ...SLOTS.map((slot) => painted[slot]?.ink ?? plain)]
    return { geometry, shaded, inks, drawings: Object.values(drawings) as string[], node: solid.node }
  }

  /** Takes a mesh out of the view and frees its geometry; the materials it used are shared. */
  private drop(drawn: Drawn): void {
    for (const { scene, mesh } of drawn.meshes) scene.remove(mesh)
    drawn.geometry.dispose()
  }

  /**
   * The pieces drawn together: in each pass, one mesh for each material, made of the faces of every
   * piece that takes it. Made again when the pieces change, not as the view turns.
   */
  private batch(): void {
    for (const drawn of this.batches) this.drop(drawn)
    this.batches = []
    const pieces = [...this.pieces.values()]
    const whole = (piece: Piece) => ({ geometry: piece.geometry, start: 0, count: piece.geometry.getAttribute('position').count })
    const add = (scene: THREE.Scene, material: THREE.Material | null, parts: ReturnType<typeof whole>[]) => {
      if (parts.length === 0) return
      const geometry = merged(parts)
      const mesh = material ? new THREE.Mesh(geometry, material) : new THREE.Mesh(geometry)
      scene.add(mesh)
      this.batches.push({ geometry, meshes: [{ scene, mesh }] })
    }
    add(this.scene, null, pieces.map(whole))
    const shaded = new Map<THREE.Material, ReturnType<typeof whole>[]>()
    const inks = new Map<THREE.Material, ReturnType<typeof whole>[]>()
    for (const piece of pieces) {
      const list = shaded.get(piece.shaded) ?? []
      list.push(whole(piece))
      shaded.set(piece.shaded, list)
      for (const group of piece.geometry.groups) {
        const material = piece.inks[group.materialIndex ?? 0]
        const list = inks.get(material) ?? []
        list.push({ geometry: piece.geometry, start: group.start, count: group.count })
        inks.set(material, list)
      }
    }
    for (const [material, parts] of shaded) add(this.shadedScene, material, parts)
    for (const [material, parts] of inks) add(this.inkScene, material, parts)
  }

  /**
   * Lights the nodes `ids` where the view shows them, tinted and outlined in `accent` (a CSS colour);
   * none, nothing. The pictures saved and copied are drawn by a view of their own, with none.
   */
  setSelected(ids: Iterable<string>, accent?: string): void {
    this.selected = new Set(ids)
    if (accent) this.quad.material.uniforms.accent.value.setStyle(accent, THREE.LinearSRGBColorSpace)
    this.light()
  }

  /** The mesh of the pieces of the nodes selected, made again when they or the pieces change. */
  private light(): void {
    if (this.chosen) this.drop(this.chosen)
    this.chosen = null
    if (this.selected.size === 0) return
    const parts = [...this.pieces.values()].filter((piece) => this.selected.has(piece.node)).map((piece) => ({ geometry: piece.geometry, start: 0, count: piece.geometry.getAttribute('position').count }))
    if (parts.length === 0) return
    const geometry = merged(parts)
    const mesh = new THREE.Mesh(geometry, this.whiteOver)
    this.maskScene.add(mesh)
    this.chosen = { geometry, meshes: [{ scene: this.maskScene, mesh }] }
  }

  /**
   * Puts the solids of the plan in the view, in place of those it had: those it had already, the
   * same in every way, are kept as they were made.
   */
  setSolids(solids: Solid[]): void {
    const pieces = new Map<string, Piece>()
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const solid of solids) {
      // A slab of a finish of its own (a hob's glass, a tap) is its shape and its tone: nothing is painted on it.
      const drawings: Partial<Record<Slot, string>> = {}
      if (solid.drawings && !solid.finish) {
        for (const slot of SLOTS) {
          const prims = solid.drawings[slot]
          if (prims && prims.length > 0) drawings[slot] = this.keyOf(prims)
        }
      }
      let same = this.solidKeys.get(solid)
      if (same === undefined) {
        const { origin, along, facing, base } = solid.drawings ?? {}
        same = JSON.stringify([solid.role, solid.finish, solid.outline, solid.holes, solid.upper, solid.bottom, solid.top, origin, along, facing, base, drawings])
        this.solidKeys.set(solid, same)
      }
      // Two solids the same in every way are two pieces all the same.
      let key = same
      for (let n = 2; pieces.has(key); n++) key = `${same}#${n}`
      const kept = this.pieces.get(key)
      const piece = kept ?? this.piece(solid, drawings)
      if (kept) this.pieces.delete(key)
      if (!piece) continue
      // The same solid may now be another node's (one replaced by another just like it).
      piece.node = solid.node
      pieces.set(key, piece)
      for (const p of solid.outline) [minX, minY, maxX, maxY] = [Math.min(minX, p.x), Math.min(minY, p.y), Math.max(maxX, p.x), Math.max(maxY, p.y)]
    }
    // What the plan no longer holds is let go, and the drawings no solid shows any more.
    for (const piece of this.pieces.values()) piece.geometry.dispose()
    this.pieces = pieces
    this.batch()
    this.light()
    const used = new Set([...pieces.values()].flatMap((piece) => piece.drawings))
    for (const [key, painted] of this.painted) {
      if (used.has(key)) continue
      painted?.texture.dispose()
      painted?.ink.dispose()
      this.painted.delete(key)
    }
    // The ground, well beyond what is drawn, open where a stair goes down through the floor.
    if (this.ground) this.drop(this.ground)
    if (!Number.isFinite(minX)) [minX, minY, maxX, maxY] = [-5000, -5000, 5000, 5000]
    const span = Math.max(maxX - minX, maxY - minY, 10000) * 6
    const wells = solids.filter((solid) => solid.role === 'shaft').flatMap((solid) => solid.holes ?? [])
    const ground = groundGeometry((minX + maxX) / 2, (minY + maxY) / 2, span, wells)
    const groundShaded = this.material('ground', () => new THREE.MeshLambertMaterial({ color: COLOURS.ground }))
    this.ground = {
      geometry: ground,
      meshes: [
        { scene: this.scene, mesh: new THREE.Mesh(ground) },
        { scene: this.shadedScene, mesh: new THREE.Mesh(ground, groundShaded) },
        { scene: this.inkScene, mesh: new THREE.Mesh(ground, this.white) },
      ],
    }
    for (const { scene, mesh } of this.ground.meshes) scene.add(mesh)
    this.corners = solids.flatMap((solid) => solid.outline)
  }

  /**
   * Draws the view from `camera`, `width` by `height` pixels, drawn as `look` says, its lines
   * `spread` pixels thick: as many as the picture is larger than it will be shown.
   */
  render(camera: Camera, look: Look, width: number, height: number, spread = 1): void {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(width, height, false)
    for (const target of [this.target, this.shadedTarget, this.inkTarget, this.maskTarget]) target.setSize(width, height)
    const aspect = width / height
    // Three.js takes the angle from top to bottom; a viewpoint says it from left to right.
    const across = (fovOf(camera) * Math.PI) / 180
    this.eye.fov = (2 * Math.atan(Math.tan(across / 2) / aspect) * 180) / Math.PI
    this.eye.aspect = aspect
    const h = eyeHeightOf(camera)
    const look3 = lookOf(camera) ?? { x: 0, y: -1 }
    this.eye.position.set(camera.a.x, h, camera.a.y)
    this.eye.up.set(0, 1, 0)
    // Tilted, it looks up or down from level; its verticals then converge, as in a photograph.
    this.eye.lookAt(camera.a.x + look3.x * 1000, h + Math.tan((pitchOf(camera) * Math.PI) / 180) * 1000, camera.a.y + look3.y * 1000)
    this.eye.updateProjectionMatrix()

    const pass = (scene: THREE.Scene, target: THREE.WebGLRenderTarget, clear: number) => {
      this.renderer.setRenderTarget(target)
      this.renderer.setClearColor(clear, 1)
      this.renderer.clear()
      this.renderer.render(scene, this.eye)
    }
    this.scene.overrideMaterial = this.normalMaterial
    pass(this.scene, this.target, 0x8080ff)
    if (look === 'clay') pass(this.shadedScene, this.shadedTarget, 0xffffff)
    if (look !== 'depth') pass(this.inkScene, this.inkTarget, 0xffffff)
    // What is selected: the whole view in black, its faces nearest, then the selected over it in white where they are seen.
    const marked = this.chosen !== null
    if (marked) {
      this.scene.overrideMaterial = this.black
      pass(this.scene, this.maskTarget, 0x000000)
      this.renderer.autoClear = false
      this.renderer.render(this.maskScene, this.eye)
      this.renderer.autoClear = true
    }
    this.scene.overrideMaterial = this.normalMaterial
    const uniforms = this.quad.material.uniforms
    uniforms.marked.value = marked
    uniforms.texel.value.set(1 / width, 1 / height)
    uniforms.look.value = look === 'lines' ? 0 : look === 'clay' ? 1 : 2
    // Whole pixels: compared at uneven distances on each side, a flat surface seen at a slant would show lines.
    uniforms.spread.value = Math.max(1, Math.round(spread))
    // A depth map goes from white at the eye to black at the furthest corner ahead of it.
    let reach = 2000
    for (const p of this.corners) {
      const [dx, dy] = [p.x - camera.a.x, p.y - camera.a.y]
      if (dx * look3.x + dy * look3.y > 0) reach = Math.max(reach, Math.hypot(dx, dy) * 1.05)
    }
    uniforms.reach.value = reach
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(0xffffff, 1)
    this.renderer.clear()
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  dispose(): void {
    this.setSolids([])
    if (this.ground) this.drop(this.ground)
    for (const material of this.materials.values()) material.dispose()
    for (const painted of this.painted.values()) {
      painted?.texture.dispose()
      painted?.ink.dispose()
    }
    if (this.chosen) this.drop(this.chosen)
    for (const target of [this.target, this.shadedTarget, this.inkTarget, this.maskTarget]) target.dispose()
    this.black.dispose()
    this.whiteOver.dispose()
    this.quad.geometry.dispose()
    this.quad.material.dispose()
    this.normalMaterial.dispose()
    this.white.dispose()
    this.renderer.dispose()
  }
}
