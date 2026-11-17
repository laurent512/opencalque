// Generates the component libraries shipped in the warehouse (packages/warehouse/components).
// Run with `pnpm warehouse` after changing a definition below. Each library is an ordinary
// OpenCalque document whose components are the symbols; sizes are in millimetres, origin top-left.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, createDocument, roundCorners, serializeDocument, type NodeInput, type Op, type Vec2 } from '@opencalque/core'

type Shape = Record<string, unknown> & { type: string }
type Pt = [number, number]

/** A tenth of a millimetre is as fine as a symbol needs, and keeps the generated files short. */
const tenth = (v: number) => Math.round(v * 10) / 10
const vec = ([x, y]: Pt): Vec2 => ({ x: tenth(x), y: tenth(y) })

const rect = (x: number, y: number, width: number, height: number): Shape => ({ type: 'rect', x, y, width, height })
const oval = (cx: number, cy: number, rx: number, ry = rx): Shape => ({ type: 'ellipse', cx, cy, rx, ry })
const line = (x1: number, y1: number, x2: number, y2: number, dashed = false): Shape => ({
  type: 'line',
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  ...(dashed ? { style: { dash: [5, 4] } } : {}),
})
const text = (x: number, y: number, content: string, size: number): Shape => ({ type: 'text', x, y, text: content, size })
const INK = '#1f1f1f'
const filled = (shape: Shape): Shape => ({ ...shape, style: { fill: INK } })
const poly = (points: Pt[], closed = false): Shape => ({ type: 'polyline', points: points.map(vec), closed })
/** The points of part of a circle, from angle `from` to `to` in degrees, clockwise on the sheet from the right. */
const arcPoints = (cx: number, cy: number, r: number, from: number, to: number): [number, number][] =>
  Array.from({ length: 17 }, (_, i) => {
    const a = ((from + ((to - from) * i) / 16) * Math.PI) / 180
    return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))] as [number, number]
  })
/** Part of a circle as a polyline. */
const arc = (cx: number, cy: number, r: number, from: number, to: number): Shape => poly(arcPoints(cx, cy, r, from, to))
// Furniture and fittings are drawn as they are seen from above, with what tells one from another:
// the cushions of a sofa, the pillows and turned-back duvet of a bed, the backrest of a chair. Their
// outlines are drawn at the usual weight and what lies within them in thin lines, the weight the
// built-in objects give their details. A placed component backs each of its closed shapes with
// white, under all of its lines: shapes that touch rather than overlap keep the drawing clear.

/** Drawn in thin lines: what lies within an outline. */
const thin = (shape: Shape): Shape => ({ ...shape, style: { ...(shape.style as object | undefined), strokeWidth: 0.5 } })
/** A path through the points with its corners rounded: one radius for all, or one for each point. */
const rounded = (points: Pt[], radius: number | number[], closed = true): Shape =>
  poly(
    roundCorners(
      points.map(([x, y]) => ({ x, y })),
      radius,
      closed,
    ).map((p): Pt => [p.x, p.y]),
    closed,
  )
/** A rectangle with rounded corners; four radii go clockwise from the top left. */
const roundRect = (x: number, y: number, width: number, height: number, radius: number | [number, number, number, number]): Shape =>
  rounded(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    radius,
  )

interface Library {
  id: string
  name: string
  description: string
  /**
   * In the order they keep: a component is known by its place (see below). One taken out leaves
   * its place empty (null), so that those after it keep theirs. A component may say the room it
   * is for ('bedroom', 'dining'…), under which the component library lists it rather than under
   * the library's name.
   */
  components: ([name: string, description: string, shapes: Shape[], room?: string] | null)[]
}

/** How tall each component stands on the floor, in mm, by its name: what elevations draw it as. */
const HEIGHTS: Record<string, number> = {
  'Coffee table, round': 400,
}

const LIBRARIES: Library[] = [
  {
    id: 'furniture',
    name: 'Furniture',
    description: 'Beds, seating, tables and storage for furnishing a plan.',
    components: [
      // The double bed and the dining table are the adjustable Double bed and Table with chairs now,
      // which ship with the app (furniture.json), at the same sizes: their places stay empty.
      null,
      // The single bed is the adjustable Single bed, and the wardrobe the adjustable one of
      // the built-in extension, which elevations draw by their fronts: their places stay empty.
      null,
      // The sofa, the armchair, the chair and the desk with its chair are adjustable objects of the
      // built-in extension too, which elevations draw from in front and from the side.
      null,
      null,
      null,
      null,
      null,
      null,
      ['Coffee table, round', 'Ø 900', [oval(450, 450, 450), thin(oval(450, 450, 410))], 'living'],
    ],
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    description: 'Sanitary fittings.',
    components: [
      // The toilet, the shower tray and the wall-hung toilet are parametric objects now (in the
      // built-in extension), which go against walls and are resized by their sides: their places stay empty.
      null,
      // The washbasin is a parametric object now (in the built-in extension): its counter is resized, its bowls keep their size.
      null,
      // The bathtub is a parametric object now (in the built-in extension): its rim keeps its thickness when it is resized.
      null,
      null,
      // This place held a double washbasin while it was being made, then the wall-hung toilet in
      // 1.0.0-rc.3; drawings hold either under it, so it stays empty, neither to be taken for the other.
      null,
      null,
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    description: 'Units and appliances on a 600 mm module.',
    components: [
      // The base unit and the washing machine are parametric objects now too (in the built-in
      // extension), which elevations draw by their fronts: the library holds nothing more.
      null,
      // The sink unit, the hob and the fridge are parametric objects now (in the built-in extension),
      // made wider by their sides: a sink with or without its draining board, a hob of 80 or 90 cm,
      // an American fridge beside the plain one.
      null,
      null,
      null,
      null,
    ],
  },
]


/** Names and descriptions in French, Spanish, German, Chinese, Japanese, Korean and Turkish, in that order, by the English text. Sizes need none. */
const TRANSLATIONS: Record<string, [fr: string, es: string, de: string, zh: string, ja: string, ko: string, tr: string]> = {
  Furniture: ['Mobilier', 'Mobiliario', 'Möbel', '家具', '家具', '가구', 'Mobilya'],
  'Beds, seating, tables and storage for furnishing a plan.': ['Lits, sièges, tables et rangements pour meubler un plan.', 'Camas, asientos, mesas y almacenaje para amueblar un plano.', 'Betten, Sitzmöbel, Tische und Stauraum zum Möblieren eines Plans.', '床、座椅、桌子和储物家具，用于平面布置。', 'ベッド、いす、テーブル、収納で図面に家具を配置します。', '평면도에 가구를 배치하기 위한 침대, 의자, 테이블, 수납가구.', 'Bir planı döşemek için yataklar, oturma elemanları, masalar ve dolaplar.'],
  'Coffee table, round': ['Table basse ronde', 'Mesa de centro redonda', 'Couchtisch, rund', '圆形茶几', '丸いローテーブル', '원형 커피 테이블', 'Sehpa, yuvarlak'],
  Bathroom: ['Salle de bain', 'Baño', 'Bad', '卫生间', '浴室・トイレ', '욕실', 'Banyo'],
  'Sanitary fittings.': ['Appareils sanitaires.', 'Aparatos sanitarios.', 'Sanitärobjekte.', '卫生洁具。', '衛生器具。', '위생 기구.', 'Vitrifiye ve armatürler.'],
  Kitchen: ['Cuisine', 'Cocina', 'Küche', '厨房', 'キッチン', '주방', 'Mutfak'],
  'Units and appliances on a 600 mm module.': ['Meubles et appareils sur un module de 600 mm.', 'Muebles y electrodomésticos en módulo de 600 mm.', 'Schränke und Geräte im 600-mm-Raster.', '按 600 mm 模数排布的橱柜和电器。', '600 mm モジュールのキャビネットと家電。', '600 mm 모듈의 수납장과 가전.', '600 mm modülde dolaplar ve cihazlar.'],
}

/** The translations of the texts one library shows, by language code and then by the English text. */
function translationsOf(library: Library): Record<string, Record<string, string>> {
  const texts = [library.name, library.description, ...library.components.flatMap((component) => (component ? [component[0], component[1]] : []))]
  const out: Record<string, Record<string, string>> = { fr: {}, es: {}, de: {}, zh: {}, ja: {}, ko: {}, tr: {} }
  for (const english of texts) {
    const found = TRANSLATIONS[english]
    if (!found) continue
    ;(['fr', 'es', 'de', 'zh', 'ja', 'ko', 'tr'] as const).forEach((language, i) => (out[language][english] = found[i]))
  }
  return out
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../../warehouse/components')
mkdirSync(out, { recursive: true })
const index = LIBRARIES.map((library) => {
  const ops: Op[] = []
  library.components.forEach((component, i) => {
    if (!component) return
    const [name, description, shapes] = component
    const id = `${library.id}_${i + 1}`
    ops.push({ op: 'add_node', node: { type: 'component', id, name, description, ...(HEIGHTS[name] ? { height: HEIGHTS[name] } : {}) } })
    // Ids of their own, the same each time, so that a library changes only where its components do.
    shapes.forEach((shape, j) => ops.push({ op: 'add_node', node: { ...shape, id: `${id}_${j + 1}`, parent: id } as NodeInput }))
  })
  // A fixed document id, so a component imported twice (even after an update) is recognised.
  const doc = { ...applyOps(createDocument(library.name), ops), id: `warehouse.${library.id}` }
  writeFileSync(join(out, `${library.id}.opencalque`), serializeDocument(doc))
  // The room each component is for, by its id, for those that say one.
  const rooms = Object.fromEntries(library.components.flatMap((component, i) => (component?.[3] ? [[`${library.id}_${i + 1}`, component[3]]] : [])))
  return {
    id: library.id,
    name: library.name,
    description: library.description,
    file: `${library.id}.opencalque`,
    components: library.components.filter(Boolean).length,
    ...(Object.keys(rooms).length > 0 ? { categories: rooms } : {}),
    translations: translationsOf(library),
  }
})
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Wrote ${index.length} libraries, ${index.reduce((n, l) => n + l.components, 0)} components, to ${out}`)
