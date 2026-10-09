// Generates the component libraries shipped in the warehouse (apps/web/src/warehouse/components).
// Run with `pnpm warehouse` after changing a definition below. Each library is an ordinary
// OpenCalque document whose components are the symbols; sizes are in millimetres, origin top-left.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, createDocument, serializeDocument, type NodeInput, type Op } from '@opencalque/core'

type Shape = Record<string, unknown> & { type: string }

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
const poly = (points: [number, number][], closed = false): Shape => ({ type: 'polyline', points: points.map(([x, y]) => ({ x, y })), closed })
/** Part of a circle as a polyline, from angle `from` to `to` in degrees, clockwise on the sheet from the right. */
const arc = (cx: number, cy: number, r: number, from: number, to: number): Shape =>
  poly(Array.from({ length: 17 }, (_, i) => {
    const a = ((from + ((to - from) * i) / 16) * Math.PI) / 180
    return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))] as [number, number]
  }))
const cross = (cx: number, cy: number, r: number): Shape[] => {
  const d = Math.round(r * Math.SQRT1_2)
  return [line(cx - d, cy - d, cx + d, cy + d), line(cx - d, cy + d, cx + d, cy - d)]
}
// Electrical symbols that go on a wall are drawn hanging from their top edge: place that edge on the wall.
/** An earthed socket outlet: a half circle on a stem from the wall, with the earth contact as a bar where they meet. */
const socket = (x: number): Shape[] => [line(x + 150, 0, x + 150, 100), line(x + 90, 100, x + 210, 100), arc(x + 150, 250, 150, 180, 360)]
/** A switch: a small circle with a lever that ends in `ticks` strokes, drawn up to the right or down to the left. */
const lever = (cx: number, cy: number, up: boolean, ticks = 1): Shape[] => {
  const s = up ? 1 : -1
  const end = { x: cx + s * 225, y: cy - s * 225 }
  return [
    line(cx + s * 53, cy - s * 53, end.x, end.y),
    ...Array.from({ length: ticks }, (_, i) => line(end.x - s * i * 60, end.y + s * i * 60, end.x - s * i * 60 + s * 60, end.y + s * i * 60 + s * 60)),
  ]
}
const chair = (x: number, y: number): Shape[] => [rect(x, y, 450, 450), line(x, y + 60, x + 450, y + 60)]

interface Library {
  id: string
  name: string
  description: string
  components: [name: string, description: string, shapes: Shape[]][]
}

const LIBRARIES: Library[] = [
  {
    id: 'furniture',
    name: 'Furniture',
    description: 'Beds, seating, tables and storage for furnishing a plan.',
    components: [
      ['Double bed', '1600 × 2000', [rect(0, 0, 1600, 2000), rect(100, 80, 650, 400), rect(850, 80, 650, 400), line(0, 600, 1600, 600)]],
      ['Single bed', '900 × 2000', [rect(0, 0, 900, 2000), rect(100, 80, 700, 400), line(0, 600, 900, 600)]],
      ['Sofa, two seats', '1600 × 850', [rect(0, 0, 1600, 850), rect(0, 0, 1600, 200), rect(0, 200, 180, 650), rect(1420, 200, 180, 650), line(800, 200, 800, 850)]],
      ['Armchair', '850 × 850', [rect(0, 0, 850, 850), rect(0, 0, 850, 200), rect(0, 200, 150, 650), rect(700, 200, 150, 650)]],
      ['Chair', '450 × 450', chair(0, 0)],
      ['Dining table, six chairs', '1800 × 900 table', [rect(0, 500, 1800, 900), ...[150, 675, 1200].flatMap((x) => [...chair(x, 0), rect(x, 1450, 450, 450), line(x, 1840, x + 450, 1840)])]],
      ['Desk with chair', '1400 × 700', [rect(0, 0, 1400, 700), oval(700, 980, 250)]],
      ['Wardrobe', '1800 × 600', [rect(0, 0, 1800, 600), line(900, 0, 900, 600), line(50, 300, 1750, 300, true)]],
      ['Coffee table, round', 'Ø 900', [oval(450, 450, 450)]],
    ],
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    description: 'Sanitary fittings.',
    components: [
      ['Toilet', '380 × 700', [rect(0, 0, 380, 200), oval(190, 450, 170, 250)]],
      ['Washbasin', '600 × 450', [rect(0, 0, 600, 450), oval(300, 250, 220, 150), oval(300, 60, 20)]],
      ['Bathtub', '1700 × 750', [rect(0, 0, 1700, 750), rect(60, 60, 1580, 630), oval(200, 375, 25)]],
      ['Shower tray', '900 × 900', [rect(0, 0, 900, 900), line(0, 0, 900, 900), line(900, 0, 0, 900), oval(450, 450, 30)]],
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    description: 'Units and appliances on a 600 mm module.',
    components: [
      ['Base unit', '600 × 600', [rect(0, 0, 600, 600)]],
      ['Sink unit', '1200 × 600', [rect(0, 0, 1200, 600), rect(80, 80, 480, 440), oval(600, 60, 20), ...[700, 800, 900, 1000, 1100].map((x) => line(x, 100, x, 500))]],
      ['Hob', '600 × 600', [rect(0, 0, 600, 600), oval(170, 170, 90), oval(430, 170, 70), oval(170, 430, 70), oval(430, 430, 90)]],
      ['Fridge', '600 × 650', [rect(0, 0, 600, 650), line(0, 50, 600, 50)]],
      ['Washing machine', '600 × 600', [rect(0, 0, 600, 600), line(0, 90, 600, 90), oval(300, 330, 200)]],
    ],
  },
]

LIBRARIES.push({
  id: 'electrical',
  name: 'Electrical',
  description: 'Lights, wall lights, sockets, switches and other symbols for an electrical plan.',
  components: [
    ['Ceiling light', 'Ø 300', [oval(150, 150, 150), ...cross(150, 150, 150)]],
    ['Pendant light', 'Ø 300', [oval(150, 150, 150), oval(150, 150, 90), ...cross(150, 150, 90)]],
    ['Wall light', 'Top edge on the wall', [line(0, 0, 300, 0), arc(150, 0, 150, 0, 180), line(150, 0, 256, 106), line(150, 0, 44, 106)]],
    ['Recessed spotlight', 'Ø 120', [oval(60, 60, 60), filled(oval(60, 60, 25))]],
    ['Light strip', '1200 × 100', [rect(0, 0, 1200, 100), line(0, 50, 1200, 50)]],
    ['Socket', 'Top edge on the wall', socket(0)],
    ['Double socket', 'Top edge on the wall', [...socket(0), ...socket(330)]],
    ['Socket, 32 A', 'For a cooker. Top edge on the wall', [line(150, 0, 150, 100), filled({ ...arc(150, 250, 150, 180, 360), closed: true })]],
    ['TV socket', 'Top edge on the wall', [...socket(0), text(75, 400, 'TV', 130)]],
    ['Network socket', 'RJ45', [rect(0, 0, 300, 300), text(25, 195, 'RJ45', 100)]],
    ['Switch', 'One-way', [oval(75, 300, 75), ...lever(75, 300, true)]],
    ['Double switch', 'Two circuits', [oval(75, 300, 75), ...lever(75, 300, true, 2)]],
    ['Two-way switch', 'One of two controlling the same light', [oval(300, 300, 75), ...lever(300, 300, true), ...lever(300, 300, false)]],
    ['Push button', 'Ø 200', [oval(100, 100, 100), oval(100, 100, 45)]],
    ['Dimmer', 'Switch with a dimmer', [oval(75, 300, 75), ...lever(75, 300, true), filled(poly([[75, 262], [108, 322], [42, 322]], true))]],
    ['Consumer unit', '600 × 250', [rect(0, 0, 600, 250), filled(poly([[0, 250], [600, 0], [600, 250]], true))]],
    ['Junction box', '200 × 200', [rect(0, 0, 200, 200), ...cross(100, 100, 141)]],
    ['Smoke detector', '300 × 300', [rect(0, 0, 300, 300), oval(150, 150, 100), filled(oval(150, 150, 30))]],
    ['Extractor fan', 'Ø 400', [oval(200, 200, 200), poly([[60, 100], [340, 300], [340, 100], [60, 300]], true)]],
    ['Electric radiator', '1000 × 120', [rect(0, 0, 1000, 120), ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((x) => line(x, 0, x, 120))]],
  ],
})

/** Names and descriptions in French, Spanish and German, in that order, by the English text. Sizes need none. */
const TRANSLATIONS: Record<string, [fr: string, es: string, de: string]> = {
  Furniture: ['Mobilier', 'Mobiliario', 'Möbel'],
  'Beds, seating, tables and storage for furnishing a plan.': ['Lits, sièges, tables et rangements pour meubler un plan.', 'Camas, asientos, mesas y almacenaje para amueblar un plano.', 'Betten, Sitzmöbel, Tische und Stauraum zum Möblieren eines Plans.'],
  'Double bed': ['Lit double', 'Cama doble', 'Doppelbett'],
  'Single bed': ['Lit simple', 'Cama individual', 'Einzelbett'],
  'Sofa, two seats': ['Canapé deux places', 'Sofá de dos plazas', 'Sofa, Zweisitzer'],
  Armchair: ['Fauteuil', 'Sillón', 'Sessel'],
  Chair: ['Chaise', 'Silla', 'Stuhl'],
  'Dining table, six chairs': ['Table à manger, six chaises', 'Mesa de comedor, seis sillas', 'Esstisch, sechs Stühle'],
  '1800 × 900 table': ['table 1800 × 900', 'mesa 1800 × 900', 'Tisch 1800 × 900'],
  'Desk with chair': ['Bureau avec chaise', 'Escritorio con silla', 'Schreibtisch mit Stuhl'],
  Wardrobe: ['Armoire', 'Armario', 'Kleiderschrank'],
  'Coffee table, round': ['Table basse ronde', 'Mesa de centro redonda', 'Couchtisch, rund'],
  Bathroom: ['Salle de bain', 'Baño', 'Bad'],
  'Sanitary fittings.': ['Appareils sanitaires.', 'Aparatos sanitarios.', 'Sanitärobjekte.'],
  Toilet: ['WC', 'Inodoro', 'WC'],
  Washbasin: ['Lavabo', 'Lavabo', 'Waschbecken'],
  Bathtub: ['Baignoire', 'Bañera', 'Badewanne'],
  'Shower tray': ['Receveur de douche', 'Plato de ducha', 'Duschwanne'],
  Kitchen: ['Cuisine', 'Cocina', 'Küche'],
  'Units and appliances on a 600 mm module.': ['Meubles et appareils sur un module de 600 mm.', 'Muebles y electrodomésticos en módulo de 600 mm.', 'Schränke und Geräte im 600-mm-Raster.'],
  'Base unit': ['Meuble bas', 'Mueble bajo', 'Unterschrank'],
  'Sink unit': ['Meuble évier', 'Mueble fregadero', 'Spülenschrank'],
  Hob: ['Plaque de cuisson', 'Placa de cocción', 'Kochfeld'],
  Fridge: ['Réfrigérateur', 'Frigorífico', 'Kühlschrank'],
  'Washing machine': ['Lave-linge', 'Lavadora', 'Waschmaschine'],
  Electrical: ['Électricité', 'Electricidad', 'Elektro'],
  'Lights, wall lights, sockets, switches and other symbols for an electrical plan.': ['Luminaires, appliques, prises, interrupteurs et autres symboles pour un plan électrique.', 'Luminarias, apliques, enchufes, interruptores y otros símbolos para un plano eléctrico.', 'Leuchten, Wandleuchten, Steckdosen, Schalter und weitere Symbole für einen Elektroplan.'],
  'Ceiling light': ['Plafonnier', 'Luz de techo', 'Deckenleuchte'],
  'Pendant light': ['Suspension', 'Lámpara colgante', 'Pendelleuchte'],
  'Wall light': ['Applique murale', 'Aplique de pared', 'Wandleuchte'],
  'Top edge on the wall': ['Bord supérieur contre le mur', 'Borde superior contra la pared', 'Oberkante an die Wand'],
  'Recessed spotlight': ['Spot encastré', 'Foco empotrado', 'Einbaustrahler'],
  'Light strip': ['Réglette lumineuse', 'Regleta de luz', 'Lichtleiste'],
  Socket: ['Prise de courant', 'Enchufe', 'Steckdose'],
  'Double socket': ['Prise double', 'Enchufe doble', 'Doppelsteckdose'],
  'Socket, 32 A': ['Prise 32 A', 'Enchufe de 32 A', 'Steckdose, 32 A'],
  'For a cooker. Top edge on the wall': ['Pour une cuisinière. Bord supérieur contre le mur', 'Para una cocina. Borde superior contra la pared', 'Für einen Herd. Oberkante an die Wand'],
  'TV socket': ['Prise TV', 'Toma de TV', 'TV-Dose'],
  'Network socket': ['Prise réseau', 'Toma de red', 'Netzwerkdose'],
  Switch: ['Interrupteur', 'Interruptor', 'Schalter'],
  'One-way': ['Simple allumage', 'Simple', 'Ausschalter'],
  'Double switch': ['Interrupteur double', 'Interruptor doble', 'Serienschalter'],
  'Two circuits': ['Deux circuits', 'Dos circuitos', 'Zwei Stromkreise'],
  'Two-way switch': ['Va-et-vient', 'Conmutador', 'Wechselschalter'],
  'One of two controlling the same light': ['L’un des deux qui commandent la même lumière', 'Uno de los dos que controlan la misma luz', 'Einer von zweien für dieselbe Leuchte'],
  'Push button': ['Bouton-poussoir', 'Pulsador', 'Taster'],
  Dimmer: ['Variateur', 'Regulador de luz', 'Dimmer'],
  'Switch with a dimmer': ['Interrupteur avec variateur', 'Interruptor con regulador', 'Schalter mit Dimmer'],
  'Consumer unit': ['Tableau électrique', 'Cuadro eléctrico', 'Sicherungskasten'],
  'Junction box': ['Boîte de dérivation', 'Caja de derivación', 'Abzweigdose'],
  'Smoke detector': ['Détecteur de fumée', 'Detector de humo', 'Rauchmelder'],
  'Extractor fan': ['Extracteur d’air (VMC)', 'Extractor de aire', 'Abluftventilator'],
  'Electric radiator': ['Radiateur électrique', 'Radiador eléctrico', 'Elektroheizkörper'],
}

/** The translations of the texts one library shows, by language code and then by the English text. */
function translationsOf(library: Library): Record<string, Record<string, string>> {
  const texts = [library.name, library.description, ...library.components.flatMap(([name, description]) => [name, description])]
  const out: Record<string, Record<string, string>> = { fr: {}, es: {}, de: {} }
  for (const english of texts) {
    const found = TRANSLATIONS[english]
    if (!found) continue
    ;(['fr', 'es', 'de'] as const).forEach((language, i) => (out[language][english] = found[i]))
  }
  return out
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src/warehouse/components')
mkdirSync(out, { recursive: true })
const index = LIBRARIES.map((library) => {
  const ops: Op[] = []
  library.components.forEach(([name, description, shapes], i) => {
    const id = `${library.id}_${i + 1}`
    ops.push({ op: 'add_node', node: { type: 'component', id, name, description } })
    for (const shape of shapes) ops.push({ op: 'add_node', node: { ...shape, parent: id } as NodeInput })
  })
  // A fixed document id, so a component imported twice (even after an update) is recognised.
  const doc = { ...applyOps(createDocument(library.name), ops), id: `warehouse.${library.id}` }
  writeFileSync(join(out, `${library.id}.opencalque`), serializeDocument(doc))
  return { id: library.id, name: library.name, description: library.description, file: `${library.id}.opencalque`, components: library.components.length, translations: translationsOf(library) }
})
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Wrote ${index.length} libraries, ${index.reduce((n, l) => n + l.components, 0)} components, to ${out}`)
